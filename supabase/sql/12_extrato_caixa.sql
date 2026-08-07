-- =====================================================================
-- 12 — EXTRATO DE CAIXA
--
-- Fluxo de caixa realizado no formato de extrato bancário: uma linha por
-- dia com entradas, saídas e saldo acumulado, precedida pela linha de
-- abertura com o saldo inicial das contas.
--
-- Por que uma view nova em vez de ajustar a vw_cashflow_daily: aquela só
-- produz linhas para dias que tiveram movimento liquidado. Uma empresa
-- recém-cadastrada, que informou o saldo inicial mas ainda não liquidou
-- nada, ficava sem nenhuma linha — e o saldo inicial simplesmente não
-- aparecia em lugar nenhum. Aqui a linha de abertura existe sempre.
--
-- O objetivo é conciliação: o empresário abre o extrato do banco ao lado
-- e confere linha a linha.
-- =====================================================================

create or replace view public.vw_extrato_caixa
with (security_invoker = on) as
with abertura as (
  select
    tn.id as tenant_id,
    coalesce((select sum(b.opening_balance)
                from public.bank_accounts b
               where b.tenant_id = tn.id and b.is_active), 0) as saldo_inicial,
    (select min(b.opening_balance_date)
       from public.bank_accounts b
      where b.tenant_id = tn.id and b.is_active)              as data_inicial
  from public.tenants tn
),
mov as (
  select
    t.tenant_id,
    t.paid_date as data,
    coalesce(sum(t.paid_amount) filter (where t.type = 'receita'), 0) as entradas,
    coalesce(sum(t.paid_amount) filter (where t.type = 'despesa'), 0) as saidas,
    count(*)                                                          as qtd
  from public.transactions t
  where t.status = 'liquidado' and t.paid_date is not null
  group by t.tenant_id, t.paid_date
),
linhas as (
  -- Linha de abertura. Existe mesmo quando o saldo é zero: nesse caso ela
  -- comunica que ninguém informou o saldo, que é informação útil.
  select
    a.tenant_id,
    coalesce(a.data_inicial, current_date) as data,
    true                                   as abertura,
    0::numeric                             as entradas,
    0::numeric                             as saidas,
    0                                      as qtd,
    a.saldo_inicial                        as delta
  from abertura a

  union all

  select
    m.tenant_id, m.data, false, m.entradas, m.saidas, m.qtd::int,
    m.entradas - m.saidas
  from mov m
)
select
  tenant_id,
  data,
  abertura,
  entradas,
  saidas,
  qtd                    as lancamentos,
  (entradas - saidas)    as resultado_dia,
  -- `abertura desc` garante que a linha de abertura venha antes dos
  -- movimentos do mesmo dia: em Postgres false < true, então DESC coloca
  -- a abertura primeiro.
  sum(delta) over (
    partition by tenant_id
    order by data, abertura desc
    rows between unbounded preceding and current row
  )                      as saldo
from linhas;

comment on view public.vw_extrato_caixa is
  'Extrato de caixa realizado, com linha de abertura e saldo acumulado. '
  'Ordene por (data, abertura desc) na consulta — view não tem ordem própria.';

grant select on public.vw_extrato_caixa to authenticated;

-- ---------------------------------------------------------------------
-- CONFERÊNCIA
-- ---------------------------------------------------------------------
-- O último saldo do extrato até hoje deve bater com o saldo_hoje dos KPIs:
--
--   select
--     k.tenant_id,
--     k.saldo_hoje,
--     (select e.saldo from public.vw_extrato_caixa e
--       where e.tenant_id = k.tenant_id and e.data <= current_date
--       order by e.data desc, e.abertura asc limit 1) as saldo_extrato
--   from public.vw_dashboard_kpis k;
--
-- Divergência aqui significa lançamento liquidado com paid_date no futuro,
-- que entra no extrato mas não no KPI.
