-- =====================================================================
-- 14 — EXTRATO DETALHADO (uma linha por lançamento)
-- =====================================================================
-- Substitui a versão do arquivo 12, que agrupava por dia.
--
-- O que os testadores relataram: a linha dizia "9 lançamentos" e um valor
-- somado. Isso serve para ver a curva do saldo, mas não serve para o que
-- o extrato existe — conferir contra o extrato do banco, linha a linha, e
-- descobrir de onde veio cada valor. Agrupado, o número está certo e a
-- pergunta continua sem resposta.
--
-- Agora cada lançamento liquidado ocupa uma linha, com descrição,
-- categoria, contraparte e conta. A linha de abertura, com o saldo
-- inicial, continua existindo sempre — inclusive quando nada foi
-- liquidado ainda, que é justamente quando o saldo inicial precisa
-- aparecer em algum lugar.
--
-- A view precisa ser derrubada antes: `create or replace` não muda a
-- lista de colunas.
-- =====================================================================

drop view if exists public.vw_extrato_caixa;

create view public.vw_extrato_caixa
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
linhas as (
  -- Linha de abertura. Existe mesmo com saldo zero: nesse caso comunica
  -- que ninguém informou o saldo, o que é informação útil e não ruído.
  select
    a.tenant_id,
    coalesce(a.data_inicial, current_date) as data,
    true                                   as abertura,
    null::uuid                             as tx_id,
    'Saldo inicial das contas'::text       as descricao,
    null::text                             as categoria,
    null::text                             as contraparte,
    null::text                             as conta,
    null::text                             as documento,
    null::text                             as tipo,
    0::numeric                             as entradas,
    0::numeric                             as saidas,
    a.saldo_inicial                        as delta,
    -- Desempate dentro do mesmo dia: a abertura vem sempre primeiro.
    '1970-01-01 00:00:00+00'::timestamptz  as ordem
  from abertura a

  union all

  select
    t.tenant_id,
    t.paid_date,
    false,
    t.id,
    t.description,
    c.name,
    e.name,
    b.name,
    t.document_number,
    t.type::text,
    case when t.type = 'receita' then t.paid_amount else 0 end,
    case when t.type = 'despesa' then t.paid_amount else 0 end,
    case when t.type = 'receita' then t.paid_amount else -t.paid_amount end,
    t.created_at
  from public.transactions t
  left join public.categories    c on c.id = t.category_id
  left join public.entities      e on e.id = t.entity_id
  left join public.bank_accounts b on b.id = t.bank_account_id
  where t.status = 'liquidado' and t.paid_date is not null
)
select
  tenant_id,
  data,
  abertura,
  tx_id,
  descricao,
  categoria,
  contraparte,
  conta,
  documento,
  tipo,
  entradas,
  saidas,
  -- O saldo acumulado precisa de ordem total e determinística, senão duas
  -- consultas iguais devolvem saldos diferentes para a mesma linha quando
  -- há empate de data. `ordem` (created_at) desempata; `tx_id` fecha o
  -- caso raro de dois lançamentos criados no mesmo instante.
  sum(delta) over (
    partition by tenant_id
    order by data, abertura desc, ordem, tx_id
    rows between unbounded preceding and current row
  ) as saldo,
  ordem
from linhas;

comment on view public.vw_extrato_caixa is
  'Extrato de caixa realizado, uma linha por lançamento liquidado, com linha '
  'de abertura e saldo acumulado. Ordene por (data, abertura desc, ordem, tx_id) '
  'na consulta — view não tem ordem própria.';

grant select on public.vw_extrato_caixa to authenticated;

-- ---------------------------------------------------------------------
-- CONFERÊNCIA
-- ---------------------------------------------------------------------
-- 1. O último saldo até hoje deve bater com o saldo_hoje dos KPIs:
--
--   select k.tenant_id, k.saldo_hoje,
--     (select e.saldo from public.vw_extrato_caixa e
--       where e.tenant_id = k.tenant_id and e.data <= current_date
--       order by e.data desc, e.abertura asc, e.ordem desc, e.tx_id desc
--       limit 1) as saldo_extrato
--   from public.vw_dashboard_kpis k;
--
-- Divergência significa lançamento liquidado com paid_date no futuro: entra
-- no extrato e não entra no KPI.
--
-- 2. A contagem de linhas deve ser (liquidados + 1) por empresa:
--
--   select tenant_id, count(*) filter (where not abertura) as detalhadas,
--          count(*) filter (where abertura)                as aberturas
--     from public.vw_extrato_caixa group by tenant_id;
--
-- 3. Recarregue o cache do PostgREST depois de aplicar:
--
--   notify pgrst, 'reload schema';
