-- =====================================================================
-- 16 — PAINEL DE VALIDAÇÃO COMERCIAL
-- =====================================================================
-- Os três indicadores dos 90 dias de validação, calculados no banco:
--
--   1. CONVERSÃO   — quantos diagnósticos viraram contrato.
--   2. RETENÇÃO    — por coorte de mês de entrada, quantos continuam.
--   3. ENGAJAMENTO — há quantos dias cada cliente não lança nada.
--
-- O terceiro é o que menos se mede e mais revela. Ferramenta financeira
-- para PME raramente morre de cancelamento: morre de abandono silencioso,
-- e o abandono aparece semanas antes da conversa sobre cancelar.
--
-- Tudo aqui é restrito ao staff. Não são dados de uma empresa — são dados
-- SOBRE o negócio da Business Triage.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. FUNIL: DIAGNÓSTICO → CONTRATO
-- ---------------------------------------------------------------------
-- Um diagnóstico conta como convertido quando ganhou `tenant_id` — que é
-- o que acontece ao registrar o marco zero da empresa.
--
-- Duas ressalvas que a leitura precisa ter em mente, e que por isso saem
-- no próprio resultado:
--
--   • `dias_ate_conversao` usa o marco zero, não a data do cadastro da
--     empresa. É o momento em que o contrato foi assinado, não o momento
--     em que alguém digitou o nome no sistema.
--
--   • diagnósticos do mês corrente ainda estão em jogo. Contá-los como
--     "não convertidos" derruba a taxa artificialmente, então a coluna
--     `em_aberto` separa quem ainda tem chance.

create or replace view public.vw_funil_diagnosticos
with (security_invoker = on) as
select
  date_trunc('month', d.created_at)::date            as mes,
  d.tipo,
  count(*)                                           as diagnosticos,
  count(*) filter (where d.tenant_id is not null)    as convertidos,
  count(*) filter (
    where d.tenant_id is null
      and d.created_at >= date_trunc('month', now())
  )                                                  as em_aberto,
  round(
    100.0 * count(*) filter (where d.tenant_id is not null)
    / nullif(count(*), 0)
  , 1)                                               as taxa_conversao_pct,
  round(avg(
    extract(epoch from (mz.assinado_em::timestamptz - d.created_at)) / 86400
  ) filter (where mz.tenant_id is not null)::numeric, 1) as dias_ate_conversao,
  round(avg(d.score_total) filter (where d.score_total is not null)::numeric, 1)
                                                     as score_medio,
  round(avg(d.score_total) filter (where d.tenant_id is not null)::numeric, 1)
                                                     as score_medio_convertidos
from public.diagnosticos d
left join public.marcos_zero mz on mz.diagnostico_id = d.id
where public.is_platform_staff()
group by 1, 2;

comment on view public.vw_funil_diagnosticos is
  'Conversão de diagnóstico em contrato, por mês e tipo. Restrita ao staff.';

grant select on public.vw_funil_diagnosticos to authenticated;

-- ---------------------------------------------------------------------
-- 2. RETENÇÃO POR COORTE
-- ---------------------------------------------------------------------
-- Coorte = mês da assinatura, tirado do marco zero. Empresa sem marco
-- zero não entra: não se sabe quando ela começou, e chutar a data de
-- cadastro contaminaria a série logo no primeiro mês.
--
-- "Ativa" aqui significa não arquivada. Cancelamento é registrado
-- arquivando a empresa — e é por isso que arquivar em vez de excluir
-- importa também para a medição, não só para o cliente.

create or replace view public.vw_retencao_coortes
with (security_invoker = on) as
select
  date_trunc('month', mz.assinado_em)::date                   as coorte,
  count(*)                                                    as entraram,
  count(*) filter (where t.is_active)                         as ativas,
  count(*) filter (where not t.is_active)                     as sairam,
  round(100.0 * count(*) filter (where t.is_active)
        / nullif(count(*), 0), 1)                             as retencao_pct,
  -- Idade média da coorte em meses completos. Retenção de uma coorte com
  -- 20 dias de vida não diz nada, e este número é o aviso.
  round(avg(
    extract(epoch from (now() - mz.assinado_em::timestamptz)) / 2592000
  )::numeric, 1)                                              as meses_de_vida
from public.marcos_zero mz
join public.tenants t on t.id = mz.tenant_id
where public.is_platform_staff()
group by 1;

comment on view public.vw_retencao_coortes is
  'Retenção por mês de assinatura. Só empresas com marco zero registrado.';

grant select on public.vw_retencao_coortes to authenticated;

-- ---------------------------------------------------------------------
-- 3. ENGAJAMENTO — QUEM PAROU DE LANÇAR
-- ---------------------------------------------------------------------
-- O sinal que antecede o cancelamento. Mede o último lançamento CRIADO,
-- não o último vencimento: o que interessa é quando a pessoa usou o
-- sistema pela última vez, não a data que ela digitou no campo.

create or replace view public.vw_engajamento_clientes
with (security_invoker = on) as
with ultimo as (
  select
    t.id                                            as tenant_id,
    t.name,
    t.is_active,
    mz.assinado_em,
    mz.score_total                                  as score_inicial,
    (select max(x.created_at) from public.transactions x
      where x.tenant_id = t.id)                     as ultimo_lancamento,
    (select count(*) from public.transactions x
      where x.tenant_id = t.id
        and x.created_at >= now() - interval '30 days')  as lancamentos_30d
  from public.tenants t
  left join public.marcos_zero mz on mz.tenant_id = t.id
  where public.is_platform_staff()
)
select
  u.*,
  case
    when u.ultimo_lancamento is null then null
    else floor(extract(epoch from (now() - u.ultimo_lancamento)) / 86400)::int
  end                                               as dias_sem_lancar,
  case
    when u.ultimo_lancamento is null                              then 'nunca usou'
    when u.ultimo_lancamento >= now() - interval '7 days'         then 'ativo'
    when u.ultimo_lancamento >= now() - interval '21 days'        then 'esfriando'
    else 'abandonado'
  end                                               as situacao_uso
from ultimo u;

comment on view public.vw_engajamento_clientes is
  'Uso real por cliente: dias sem lançar e classificação de risco de abandono. '
  'Restrita ao staff.';

grant select on public.vw_engajamento_clientes to authenticated;

-- ---------------------------------------------------------------------
-- 4. RESUMO — OS NÚMEROS DE UMA OLHADA SÓ
-- ---------------------------------------------------------------------
-- Uma linha, para o topo do painel. Deliberadamente pobre em métricas:
-- painel com vinte números não é lido: é decorado e ignorado.

create or replace function public.fn_resumo_validacao()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when not public.is_platform_staff() then null::jsonb else
    jsonb_build_object(
      'clientes_ativos',
        (select count(*) from public.tenants where is_active),
      'clientes_com_marco_zero',
        (select count(*) from public.marcos_zero mz
          join public.tenants t on t.id = mz.tenant_id where t.is_active),
      'diagnosticos_total',
        (select count(*) from public.diagnosticos),
      'diagnosticos_convertidos',
        (select count(*) from public.diagnosticos where tenant_id is not null),
      'taxa_conversao_pct',
        (select round(100.0 * count(*) filter (where tenant_id is not null)
                / nullif(count(*), 0), 1) from public.diagnosticos),
      'abandonados',
        (select count(*) from public.tenants t
          where t.is_active
            and coalesce((select max(x.created_at) from public.transactions x
                           where x.tenant_id = t.id), '-infinity'::timestamptz)
                < now() - interval '21 days'),
      -- Evolução média do score entre marco zero e diagnóstico mais recente.
      -- Só entra quem tem os dois pontos: com um ponto só não há evolução,
      -- e preencher com zero inventaria estabilidade que ninguém mediu.
      'evolucao_media',
        (select round(avg(ultimo.score_total - mz.score_total)::numeric, 1)
           from public.marcos_zero mz
           join lateral (
             select d.score_total
               from public.diagnosticos d
              where d.tenant_id = mz.tenant_id
                and d.score_total is not null
                and d.created_at > mz.assinado_em::timestamptz
              order by d.created_at desc
              limit 1
           ) ultimo on true)
    )
  end;
$$;

revoke all on function public.fn_resumo_validacao() from public;
grant execute on function public.fn_resumo_validacao() to authenticated;

comment on function public.fn_resumo_validacao is
  'Números de topo do painel de validação. Devolve null para quem não é staff.';

-- ---------------------------------------------------------------------
-- 5. CONFERÊNCIA
-- ---------------------------------------------------------------------
--   select public.fn_resumo_validacao();
--   select * from public.vw_funil_diagnosticos order by mes desc;
--   select * from public.vw_engajamento_clientes order by dias_sem_lancar desc nulls first;
--
-- Logado como usuário comum, as três precisam voltar vazias.
--
-- Depois de aplicar:  notify pgrst, 'reload schema';
