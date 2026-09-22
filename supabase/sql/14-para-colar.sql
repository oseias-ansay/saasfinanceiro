-- =====================================================================
-- 14 · EXTRATO DETALHADO — versão para colar no SQL Editor do Supabase
-- =====================================================================
-- Recria a vw_extrato_caixa com uma linha por lançamento (tx_id,
-- descricao, categoria, contraparte, conta, documento, tipo, ordem).
-- O front-end já consulta essas colunas; sem este script o Extrato
-- quebra com "column vw_extrato_caixa.tx_id does not exist".
--
-- Cole TUDO de uma vez e rode. O `notify` no fim recarrega o cache do
-- PostgREST — sem ele a API continua enxergando a view antiga.
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

notify pgrst, 'reload schema';


-- =====================================================================
-- CONFERÊNCIA — rode depois, separado
-- =====================================================================
-- Tem de listar a coluna tx_id. Se não listar, a view não foi recriada.
--
-- select column_name
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'vw_extrato_caixa'
--  order by ordinal_position;
