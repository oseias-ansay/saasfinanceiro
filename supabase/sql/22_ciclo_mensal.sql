-- =====================================================================
-- 22 — O CICLO MENSAL E A FRONTEIRA DO PLANO
-- =====================================================================
-- O `21` construiu as peças: os agregados, o fechamento e a completude.
-- Este arquivo faz o ciclo girar — e decide de quem ele gira.
--
-- ---------------------------------------------------------------------
-- POR QUE UMA TABELA NOVA, E NÃO `diagnosticos`
-- ---------------------------------------------------------------------
-- A tentação era guardar o diagnóstico mensal em `diagnosticos`, que já
-- tem score, entrada, indicadores e alertas. Seria errado, por um motivo
-- que não aparece no schema: `vw_funil_diagnosticos` e
-- `vw_funil_por_consultor` contam linhas daquela tabela como LEADS.
--
-- Dez clientes gerando doze diagnósticos por ano colocariam 120 leads
-- falsos no painel de validação — justamente o painel que existe para
-- responder se o mercado quer isso. O indicador que mede o negócio seria
-- corrompido pelo uso do produto.
--
-- Então: `diagnosticos` é o funil (prospect que pediu diagnóstico),
-- `diagnosticos_mensais` é o acompanhamento (cliente que assina). A
-- curva do score une os dois, porque para o cliente é uma história só.
--
-- ---------------------------------------------------------------------
-- A PENDÊNCIA É REGISTRO DE PRIMEIRA CLASSE
-- ---------------------------------------------------------------------
-- Um mês que não fechou não é ausência de linha — é uma linha com
-- `status = 'incompleto'` e a lista do que faltou. Duas razões:
--
--   • O consultor precisa ver "três meses seguidos sem fechamento" no
--     painel. Isso é sinal de cliente que parou, e é acionável.
--   • O e-mail de cobrança precisa saber se já foi enviado. Sem registro,
--     ou cobra todo dia ou não cobra nunca.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. O PLANO DA EMPRESA
-- ---------------------------------------------------------------------
-- A fronteira decidida no roadmap:
--
--   gratuito   — formulário manual, uma vez, sem histórico e sem plano
--                de ação. Amostra honesta: mostra o método e o rigor.
--   assinante  — cálculo automático a partir dos lançamentos, curva ao
--                longo do tempo e acompanhamento das ações do PDCA.
--
-- O gratuito vende o DIAGNÓSTICO. O pago vende a CONTINUIDADE. São
-- coisas diferentes o suficiente para não competirem — e é isso que
-- impede o gratuito de canibalizar a assinatura.
--
-- Nasce 'assinante' de propósito. Toda empresa que existe hoje entrou
-- por contrato de consultoria; marcá-las como gratuitas por padrão
-- tiraria acesso de quem já paga, que é o pior erro possível numa
-- migração. Quem for gratuito passa a ser exceção declarada.

do $$ begin
  create type public.plano_tenant as enum ('gratuito', 'assinante');
exception when duplicate_object then null; end $$;

alter table public.tenants
  add column if not exists plano public.plano_tenant not null default 'assinante';

alter table public.tenants
  add column if not exists plano_desde date;

comment on column public.tenants.plano is
  'gratuito = diagnóstico manual avulso. assinante = cálculo automático, '
  'curva e PDCA. Padrão assinante: quem já existe entrou por contrato.';

-- ---------------------------------------------------------------------
-- 2. O DIAGNÓSTICO MENSAL
-- ---------------------------------------------------------------------

do $$ begin
  create type public.status_diagnostico_mensal as enum ('incompleto', 'calculado');
exception when duplicate_object then null; end $$;

create table if not exists public.diagnosticos_mensais (
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  competencia   date not null,

  status        public.status_diagnostico_mensal not null,

  -- Preenchidos apenas quando `status = 'calculado'`. A restrição no fim
  -- da tabela garante que não exista score sem completude — que seria
  -- exatamente o número errado com cara de certo.
  score_total   int check (score_total between 0 and 100),
  nivel         text,
  regua_versao  text,
  entrada       jsonb not null default '{}'::jsonb,
  indicadores   jsonb not null default '{}'::jsonb,
  alertas       jsonb not null default '[]'::jsonb,

  -- O veredito da completude, guardado como estava no momento do
  -- cálculo. Não é redundante com a função: a função responde sobre o
  -- HOJE, e se o cliente lançar o que faltava em novembro, ela passa a
  -- dizer que outubro está completo. Isto aqui registra o que se sabia
  -- quando o mês foi apurado.
  completude    jsonb not null default '{}'::jsonb,

  cobrado_em    timestamptz,
  calculado_em  timestamptz not null default now(),

  primary key (tenant_id, competencia),
  constraint dm_competencia_dia1 check (extract(day from competencia) = 1),
  constraint dm_score_so_se_calculado check (
    (status = 'calculado'  and score_total is not null and regua_versao is not null)
    or
    (status = 'incompleto' and score_total is null)
  )
);

create index if not exists dm_incompletos_idx
  on public.diagnosticos_mensais (tenant_id, competencia)
  where status = 'incompleto';

comment on table public.diagnosticos_mensais is
  'Acompanhamento mensal do assinante. Separado de `diagnosticos` porque '
  'aquela tabela é o funil comercial — misturar corromperia o painel de validação.';

comment on column public.diagnosticos_mensais.cobrado_em is
  'Quando o e-mail de "faltam os dados de X" foi enviado. Sem isto, ou se '
  'cobra todo dia ou não se cobra nunca.';

alter table public.diagnosticos_mensais enable row level security;

drop policy if exists dm_select on public.diagnosticos_mensais;
create policy dm_select on public.diagnosticos_mensais
  for select using (
    public.is_tenant_member(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  );

-- Escrita só por service_role: quem calcula é a API, com a régua. Deixar
-- o cliente gravar aqui seria deixá-lo escolher o próprio score.
drop policy if exists dm_write on public.diagnosticos_mensais;
create policy dm_write on public.diagnosticos_mensais
  for all using (public.is_platform_staff()) with check (public.is_platform_staff());

-- ---------------------------------------------------------------------
-- 3. A CURVA, AGORA COM OS MESES
-- ---------------------------------------------------------------------
-- Mesmas colunas de antes — só a origem dos pontos muda. Para o cliente
-- é uma história só: o marco zero de quando ele entrou, o diagnóstico
-- manual que porventura tenha feito, e a série mensal daí em diante.
--
-- `reguas_misturadas` continua fazendo o trabalho mais importante desta
-- view: avisar quando a série compara pontos medidos com varas
-- diferentes. Uma linha bonita e mentirosa é pior que nenhuma linha.

create or replace view public.vw_evolucao_score
with (security_invoker = on) as
with serie as (
  select
    m.tenant_id,
    m.tipo,
    m.assinado_em::timestamptz as em,
    m.score_total,
    m.nivel,
    m.regua_versao,
    true  as marco_zero,
    null::text as protocolo
  from public.marcos_zero m

  union all

  select
    d.tenant_id,
    d.tipo,
    d.created_at,
    d.score_total,
    d.nivel,
    d.regua_versao,
    false,
    d.protocolo
  from public.diagnosticos d
  where d.tenant_id is not null and d.score_total is not null

  union all

  -- O ponto mensal fica no ÚLTIMO instante da competência, não no dia em
  -- que o cálculo rodou. Assim o mês de julho aparece em julho na curva,
  -- mesmo que a apuração tenha acontecido em 5 de agosto.
  select
    dm.tenant_id,
    'financeiro'::public.diagnostico_tipo,
    (dm.competencia + interval '1 month - 1 second')::timestamptz,
    dm.score_total,
    dm.nivel,
    dm.regua_versao,
    false,
    null::text
  from public.diagnosticos_mensais dm
  where dm.status = 'calculado'
)
select
  s.tenant_id,
  s.tipo,
  s.em,
  s.score_total,
  s.nivel,
  s.regua_versao,
  s.marco_zero,
  s.protocolo,
  s.score_total - first_value(s.score_total) over (
    partition by s.tenant_id, s.tipo order by s.marco_zero desc, s.em
  ) as variacao,
  min(s.regua_versao) over (partition by s.tenant_id, s.tipo)
    <> max(s.regua_versao) over (partition by s.tenant_id, s.tipo)
    as reguas_misturadas
from serie s;

comment on view public.vw_evolucao_score is
  'Curva do score por empresa: marco zero, diagnósticos avulsos e a série '
  'mensal do assinante. Ordene por (tipo, em).';

grant select on public.vw_evolucao_score to authenticated;

-- ---------------------------------------------------------------------
-- 4. QUEM PRECISA DE ATENÇÃO
-- ---------------------------------------------------------------------
-- Uma linha por assinante ativo, com o retrato do último mês fechado.
-- É o que alimenta o painel do consultor e o e-mail de cobrança.
--
-- A leitura que interessa não é "quantos por cento estão completos". É
-- `meses_incompletos_seguidos`: cliente que não fecha há três meses
-- parou de usar, e isso aparece muito antes do cancelamento.

create or replace view public.vw_situacao_mensal
with (security_invoker = on) as
with meses as (
  -- Os últimos 12 meses fechados, por empresa assinante. Não inclui o mês
  -- corrente: cobrar julho no dia 12 de julho é cobrar dado que ainda
  -- nem aconteceu.
  select
    t.id as tenant_id,
    t.name,
    t.consultoria_id,
    (date_trunc('month', current_date) - (n || ' month')::interval)::date as competencia
  from public.tenants t
  cross join generate_series(1, 12) as n
  where t.is_active and t.plano = 'assinante'
)
select
  m.tenant_id,
  m.name,
  m.consultoria_id,
  m.competencia,
  coalesce(dm.status::text, 'nao_apurado') as status,
  dm.score_total,
  dm.nivel,
  dm.completude -> 'faltas'        as faltas,
  (dm.completude ->> 'percentual')::numeric as completude_pct,
  dm.cobrado_em,
  -- Quantos meses seguidos, contando deste para trás, ficaram sem score.
  -- Zera assim que aparece um mês calculado.
  sum(case when dm.status = 'calculado' then 1 else 0 end) over (
    partition by m.tenant_id order by m.competencia desc
    rows between unbounded preceding and current row
  ) as calculados_ate_aqui
from meses m
left join public.diagnosticos_mensais dm
       on dm.tenant_id = m.tenant_id and dm.competencia = m.competencia;

comment on view public.vw_situacao_mensal is
  'Últimos 12 meses de cada assinante. `calculados_ate_aqui = 0` numa linha '
  'significa que dali para o mês corrente nenhum mês fechou.';

grant select on public.vw_situacao_mensal to authenticated;

-- ---------------------------------------------------------------------
-- 5. A FILA DO CICLO
-- ---------------------------------------------------------------------
-- Quais empresas precisam ser apuradas para uma competência. Chamada
-- pela API uma vez por mês, e depois pela cobrança.
--
-- Reapura de propósito o que está `incompleto`: o cliente pode ter
-- lançado o que faltava depois, e o mês passa a fechar. O que NÃO é
-- reapurado é o que já está `calculado` — score emitido não muda, senão
-- o cliente vê o passado se mexer.

create or replace function public.fn_fila_apuracao(p_competencia date)
returns table (tenant_id uuid, nome text, email_owner text)
language sql stable security definer
set search_path = public, pg_temp as $$
  select
    t.id,
    t.name,
    (
      select p.email
        from public.memberships mb
        join public.profiles p on p.id = mb.user_id
       where mb.tenant_id = t.id and mb.is_active and mb.role = 'owner'
       order by mb.created_at
       limit 1
    )
  from public.tenants t
  left join public.diagnosticos_mensais dm
         on dm.tenant_id = t.id and dm.competencia = p_competencia
  where t.is_active
    and t.plano = 'assinante'
    and (dm.status is null or dm.status = 'incompleto');
$$;

comment on function public.fn_fila_apuracao(date) is
  'Empresas a apurar numa competência. Reapura incompletos — o cliente pode '
  'ter lançado depois. Nunca reapura calculado: score emitido não muda.';

revoke all on function public.fn_fila_apuracao(date) from public;

-- ---------------------------------------------------------------------
-- 6. CONFERÊNCIA
-- ---------------------------------------------------------------------
--   select id, name, plano from public.tenants order by name;
--
--   select * from public.fn_fila_apuracao(
--     (date_trunc('month', current_date) - interval '1 month')::date);
--
-- A fila deve trazer todas as empresas ativas, porque nenhuma foi
-- apurada ainda.
--
-- Depois:  notify pgrst, 'reload schema';
