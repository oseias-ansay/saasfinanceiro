-- =====================================================================
-- 25 — MÉTRICAS DO FUNIL E CAC (módulo 1.4.0, parte 2)
-- =====================================================================
-- O CRM só se paga quando vira número. Este arquivo é onde os leads
-- deixam de ser uma lista e viram as respostas que o diagnóstico
-- comercial pergunta:
--
--   quantos entram, quantos fecham, e em quanto tempo
--   onde o funil trava
--   quanto custa um cliente
--   quanto ele vale
--
-- ---------------------------------------------------------------------
-- ESTIMATIVA E REALIZADO SÃO COISAS DIFERENTES
-- ---------------------------------------------------------------------
-- `leads.valor_estimado` é o que alguém achou que o negócio valia no
-- momento do cadastro. O faturamento real vem dos lançamentos da
-- entidade vinculada.
--
-- As duas leituras convivem aqui, separadas e nomeadas: `ticket_estimado`
-- e `ticket_realizado`. Misturá-las produziria um ticket médio que
-- ninguém sabe se é promessa ou fato — e a diferença entre os dois é,
-- por si só, um dos diagnósticos mais úteis que este módulo entrega.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. O INVESTIMENTO EM MÍDIA
-- ---------------------------------------------------------------------
-- Informado à mão por enquanto. Quando a integração com o Meta entrar,
-- ela preenche esta mesma tabela — e é por isso que `fonte` existe: o
-- dia em que o valor passar a vir da API, dá para saber quais meses são
-- informados e quais são medidos, em vez de descobrir que a série mudou
-- de natureza no meio.

create table if not exists public.investimentos_midia (
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  competencia date not null,
  canal       text not null check (canal in ('meta', 'google', 'outro')),
  valor       numeric(14,2) not null check (valor >= 0),
  fonte       text not null default 'informado'
              check (fonte in ('informado', 'api')),
  atualizado_em timestamptz not null default now(),

  primary key (tenant_id, competencia, canal),
  constraint investimento_dia1 check (extract(day from competencia) = 1)
);

comment on table public.investimentos_midia is
  'Verba de mídia por mês e canal. `fonte` distingue o que foi digitado do '
  'que veio da API — sem isso, a série muda de natureza sem aviso.';

alter table public.investimentos_midia enable row level security;

drop policy if exists investimentos_rw on public.investimentos_midia;
create policy investimentos_rw on public.investimentos_midia
  for all using (
    public.fn_tenant_tem_recurso(tenant_id, 'crm')
    and (
      public.can_write_tenant(tenant_id) or public.is_platform_staff()
      or public.is_consultor_de(tenant_id)
    )
  ) with check (
    public.fn_tenant_tem_recurso(tenant_id, 'crm')
    and (
      public.can_write_tenant(tenant_id) or public.is_platform_staff()
      or public.is_consultor_de(tenant_id)
    )
  );

-- ---------------------------------------------------------------------
-- 2. O FATURAMENTO REAL DE CADA LEAD GANHO
-- ---------------------------------------------------------------------
-- Só conta receita lançada A PARTIR do fechamento. Um cliente que já
-- comprava antes teria todo o histórico dele creditado à venda nova, e
-- o ticket do funil viraria ficção — especialmente em negócio
-- recorrente, onde o mesmo cliente aparece todo mês.

create or replace view public.vw_leads_realizado
with (security_invoker = on) as
select
  l.id            as lead_id,
  l.tenant_id,
  l.entity_id,
  l.fechado_em,
  coalesce((
    select sum(t.amount)
      from public.transactions t
      left join public.categories c on c.id = t.category_id
     where t.tenant_id = l.tenant_id
       and t.entity_id = l.entity_id
       and t.type = 'receita'
       and t.status <> 'cancelado'
       and coalesce(c.dre_group, 'receita_bruta') = 'receita_bruta'
       and t.competence_date >= l.fechado_em::date
  ), 0) as faturado
from public.leads l
where l.etapa = 'ganho' and l.entity_id is not null;

comment on view public.vw_leads_realizado is
  'Faturamento lançado para cada lead ganho, contado a partir do fechamento. '
  'Antes disso é histórico do cliente, não resultado da venda.';

grant select on public.vw_leads_realizado to authenticated;

-- ---------------------------------------------------------------------
-- 3. O FUNIL POR MÊS
-- ---------------------------------------------------------------------
-- A leitura principal. Uma linha por mês de ENTRADA do lead — não de
-- fechamento.
--
-- A escolha importa e é contraintuitiva: por mês de fechamento, a taxa
-- de conversão de um mês pode passar de 100%, porque fecham leads que
-- entraram antes. Por mês de entrada, a coorte é honesta — "dos 40 que
-- chegaram em julho, 6 fecharam" — ao custo de os meses recentes
-- parecerem piores, já que ainda têm negócio em aberto.
--
-- `em_aberto` existe justamente para ler isso sem se enganar.

create or replace view public.vw_funil_mensal
with (security_invoker = on) as
select
  l.tenant_id,
  date_trunc('month', l.created_at)::date as competencia,
  count(*)                                                    as entraram,
  count(*) filter (where l.etapa = 'ganho')                   as ganhos,
  count(*) filter (where l.etapa = 'perdido')                 as perdidos,
  count(*) filter (where not ef.terminal)                     as em_aberto,
  round(100.0 * count(*) filter (where l.etapa = 'ganho')
        / nullif(count(*), 0), 1)                             as conversao_pct,
  -- Sobre os já decididos: responde "quando o cliente decide, quanto
  -- eu ganho?" sem o ruído dos que ainda não decidiram.
  round(100.0 * count(*) filter (where l.etapa = 'ganho')
        / nullif(count(*) filter (where ef.terminal), 0), 1)  as conversao_decididos_pct,
  sum(l.valor_estimado) filter (where l.etapa = 'ganho')      as valor_ganho_estimado,
  round(avg(l.valor_estimado) filter (where l.etapa = 'ganho'), 2) as ticket_estimado,
  round(avg(extract(day from l.fechado_em - l.created_at))
        filter (where l.etapa = 'ganho'), 1)                  as ciclo_medio_dias
from public.leads l
join public.etapas_funil ef on ef.codigo = l.etapa
group by l.tenant_id, date_trunc('month', l.created_at);

comment on view public.vw_funil_mensal is
  'Funil por mês de ENTRADA do lead — coorte honesta. Meses recentes parecem '
  'piores porque ainda têm negócio em aberto; leia junto com `em_aberto`.';

grant select on public.vw_funil_mensal to authenticated;

-- ---------------------------------------------------------------------
-- 4. ONDE O FUNIL TRAVA
-- ---------------------------------------------------------------------
-- Tempo médio parado em cada etapa, e quantos estão lá agora.
--
-- Saber que a conversão é 8% não diz o que consertar. Saber que o lead
-- passa onze dias em "proposta" e dois em "qualificado" diz: o problema
-- é o seguimento depois do preço, não a qualificação.

create or replace view public.vw_funil_etapas
with (security_invoker = on) as
with permanencia as (
  -- Quanto tempo cada lead ficou em cada etapa: do movimento que o
  -- trouxe até o próximo. Quem está na etapa agora conta até hoje.
  select
    m.tenant_id,
    m.para as etapa,
    extract(epoch from coalesce(
      lead(m.em) over (partition by m.lead_id order by m.em),
      now()
    ) - m.em) / 86400.0 as dias
  from public.lead_movimentos m
)
select
  ef.codigo                as etapa,
  ef.nome,
  ef.ordem,
  ef.terminal,
  t.id                     as tenant_id,
  coalesce(rf.rotulo, ef.nome) as rotulo,
  (select count(*) from public.leads l
    where l.tenant_id = t.id and l.etapa = ef.codigo)          as agora,
  (select coalesce(sum(l.valor_estimado), 0) from public.leads l
    where l.tenant_id = t.id and l.etapa = ef.codigo)          as valor_parado,
  (select round(avg(p.dias)::numeric, 1) from permanencia p
    where p.tenant_id = t.id and p.etapa = ef.codigo)          as dias_medios
from public.tenants t
cross join public.etapas_funil ef
left join public.rotulos_funil rf on rf.tenant_id = t.id and rf.etapa = ef.codigo
where t.is_active;

comment on view public.vw_funil_etapas is
  'Uma linha por etapa e empresa: quantos estão ali, quanto valor está parado '
  'e há quantos dias em média. É o que aponta ONDE consertar.';

grant select on public.vw_funil_etapas to authenticated;

-- ---------------------------------------------------------------------
-- 5. CANAIS, CAC E TICKET REALIZADO
-- ---------------------------------------------------------------------
-- O indicador que o diagnóstico pergunta e que quase nenhuma PME
-- calcula, porque exige cruzar investimento com venda fechada.
--
-- Duas honestidades embutidas:
--
-- • O CAC é calculado SÓ sobre leads de anúncio. Dividir a verba pelo
--   total de clientes, incluindo indicação e orgânico, produz um número
--   bonito e falso — o anúncio levaria crédito por venda que não trouxe.
--
-- • O investimento é do mês de ENTRADA do lead, não do fechamento. Foi
--   a verba daquele mês que comprou aquele contato.

create or replace view public.vw_funil_canais
with (security_invoker = on) as
with por_origem as (
  select
    l.tenant_id,
    date_trunc('month', l.created_at)::date as competencia,
    l.origem,
    count(*)                                  as entraram,
    count(*) filter (where l.etapa = 'ganho') as ganhos,
    coalesce(sum(r.faturado), 0)              as faturado
  from public.leads l
  left join public.vw_leads_realizado r on r.lead_id = l.id
  group by l.tenant_id, date_trunc('month', l.created_at), l.origem
),
verba as (
  select tenant_id, competencia, sum(valor) as investido
    from public.investimentos_midia
   group by tenant_id, competencia
)
select
  o.tenant_id,
  o.competencia,
  o.origem,
  o.entraram,
  o.ganhos,
  round(100.0 * o.ganhos / nullif(o.entraram, 0), 1) as conversao_pct,
  o.faturado,
  round(o.faturado / nullif(o.ganhos, 0), 2)         as ticket_realizado,
  case when o.origem = 'anuncio' then v.investido end as investido,
  case when o.origem = 'anuncio'
       then round(v.investido / nullif(o.ganhos, 0), 2) end as cac,
  case when o.origem = 'anuncio' and v.investido > 0
       then round(o.faturado / v.investido, 2) end          as retorno_sobre_investimento
from por_origem o
left join verba v on v.tenant_id = o.tenant_id and v.competencia = o.competencia;

comment on view public.vw_funil_canais is
  'Desempenho por canal e mês. O CAC só é calculado para a origem anúncio: '
  'dividir a verba por todos os clientes daria crédito ao anúncio por venda '
  'que ele não trouxe.';

grant select on public.vw_funil_canais to authenticated;

-- ---------------------------------------------------------------------
-- 6. O RESUMO PARA A TELA
-- ---------------------------------------------------------------------
-- Os últimos 90 dias num objeto só. A tela abre com isso e não precisa
-- montar quatro consultas para desenhar o cabeçalho.

create or replace function public.fn_resumo_funil(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  with base as (
    select l.*, ef.terminal
      from public.leads l
      join public.etapas_funil ef on ef.codigo = l.etapa
     where l.tenant_id = p_tenant_id
       and l.created_at >= now() - interval '90 days'
  )
  select jsonb_build_object(
    'entraram',      (select count(*) from base),
    'ganhos',        (select count(*) from base where etapa = 'ganho'),
    'perdidos',      (select count(*) from base where etapa = 'perdido'),
    'em_aberto',     (select count(*) from base where not terminal),
    'valor_aberto',  (select coalesce(sum(valor_estimado), 0) from base where not terminal),
    'conversao_pct', (select round(100.0 * count(*) filter (where etapa = 'ganho')
                                   / nullif(count(*), 0), 1) from base),
    'ciclo_medio',   (select round(avg(extract(day from fechado_em - created_at)), 1)
                        from base where etapa = 'ganho'),
    'parados',       (select count(*) from public.vw_funil_leads
                       where tenant_id = p_tenant_id
                         and not etapa_terminal and dias_na_etapa >= 14)
  )
$fn$;

comment on function public.fn_resumo_funil(uuid) is
  'Cabeçalho do funil: 90 dias, num objeto só. `parados` conta quem não se '
  'move há duas semanas — o número que costuma doer.';

revoke all on function public.fn_resumo_funil(uuid) from public;
grant execute on function public.fn_resumo_funil(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 7. CONFERÊNCIA
-- ---------------------------------------------------------------------
--   select * from public.vw_funil_etapas
--    where tenant_id = '<tenant>' order by ordem;
--
--   select public.fn_resumo_funil('<tenant>');
--
-- Depois:  notify pgrst, 'reload schema';
