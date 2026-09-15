drop view if exists public.vw_contas_por_pessoa;

create view public.vw_contas_por_pessoa
with (security_invoker = on) as
select
  t.tenant_id,
  case when t.type = 'receita' then 'a_receber' else 'a_pagar' end as natureza,
  t.entity_id,
  coalesce(e.name, 'Sem cliente/fornecedor informado') as pessoa,
  e.kind        as tipo_pessoa,
  e.tax_id      as documento,
  e.email       as contato_email,
  e.phone       as contato_telefone,

  sum(t.amount)  as total_aberto,
  count(*)::int  as titulos_abertos,

  coalesce(sum(t.amount) filter (where t.due_date < current_date), 0) as total_vencido,
  count(*) filter (where t.due_date < current_date)::int              as titulos_vencidos,

  coalesce(sum(t.amount) filter (
    where t.due_date < current_date and t.due_date >= current_date - 30), 0) as vencido_ate_30,
  coalesce(sum(t.amount) filter (
    where t.due_date < current_date - 30 and t.due_date >= current_date - 60), 0) as vencido_31_60,
  coalesce(sum(t.amount) filter (
    where t.due_date < current_date - 60), 0) as vencido_mais_60,

  max(current_date - t.due_date) filter (where t.due_date < current_date)::int as dias_atraso_max,

  round(
    sum(t.amount * (current_date - t.due_date)) filter (where t.due_date < current_date)
    / nullif(sum(t.amount) filter (where t.due_date < current_date), 0)
  )::int as dias_atraso_medio,

  min(t.due_date) filter (where t.due_date >= current_date) as proximo_vencimento,
  coalesce(sum(t.amount) filter (
    where t.due_date >= current_date and t.due_date <= current_date + 30), 0) as a_vencer_30d,
  coalesce(sum(t.amount) filter (
    where t.due_date > current_date + 30 and t.due_date <= current_date + 60), 0) as a_vencer_31_60,
  coalesce(sum(t.amount) filter (
    where t.due_date > current_date + 60), 0) as a_vencer_mais_60

from public.transactions t
left join public.entities e on e.id = t.entity_id
where t.status = 'pendente'
group by
  t.tenant_id,
  case when t.type = 'receita' then 'a_receber' else 'a_pagar' end,
  t.entity_id, e.name, e.kind, e.tax_id, e.email, e.phone;

comment on view public.vw_contas_por_pessoa is
  'Contas a pagar/receber consolidadas por cliente e fornecedor. Ordenada por total_vencido, e a lista de quem cobrar hoje. Filtre por natureza (a_receber / a_pagar).';


drop view if exists public.vw_contas_resumo;

create view public.vw_contas_resumo
with (security_invoker = on) as
select
  t.tenant_id,
  case when t.type = 'receita' then 'a_receber' else 'a_pagar' end as natureza,

  sum(t.amount)                   as total_aberto,
  count(*)::int                   as titulos_abertos,
  count(distinct t.entity_id)::int as pessoas,

  coalesce(sum(t.amount) filter (where t.due_date < current_date), 0) as total_vencido,
  count(*) filter (where t.due_date < current_date)::int              as titulos_vencidos,

  coalesce(sum(t.amount) filter (where t.due_date = current_date), 0) as vence_hoje,
  coalesce(sum(t.amount) filter (
    where t.due_date > current_date and t.due_date <= current_date + 7), 0)  as vence_7d,
  coalesce(sum(t.amount) filter (
    where t.due_date > current_date and t.due_date <= current_date + 30), 0) as vence_30d,

  round(
    100.0 * coalesce(sum(t.amount) filter (where t.due_date < current_date), 0)
    / nullif(sum(t.amount), 0)
  , 2) as pct_vencido,

  coalesce(sum(t.amount) filter (where t.entity_id is null), 0) as sem_pessoa_informada

from public.transactions t
where t.status = 'pendente'
group by t.tenant_id, case when t.type = 'receita' then 'a_receber' else 'a_pagar' end;

comment on view public.vw_contas_resumo is
  'Totais de contas a pagar/receber para o cabecalho da tela. Separado da lista por pessoa para o total nao mudar quando o usuario troca de pagina.';

notify pgrst, 'reload schema';


-- =====================================================================
-- CONFERENCIA — rode depois, separado
-- =====================================================================
-- A unica coisa que importa checar: a soma por pessoa tem de ser igual a
-- soma dos titulos pendentes. Se divergir, algum titulo sumiu da tela —
-- quase sempre o que esta sem cliente/fornecedor cadastrado.
--
-- As tres colunas `diferenca` tem de vir ZERO.
--
-- select
--   f.tenant_id,
--   sum(f.total_aberto)  - sum(p.total_aberto)  as diferenca_aberto,
--   sum(f.total_vencido) - sum(p.total_vencido) as diferenca_vencido,
--   sum(f.titulos)       - sum(p.titulos)       as diferenca_titulos
-- from (
--   select tenant_id,
--          sum(amount) as total_aberto,
--          coalesce(sum(amount) filter (where due_date < current_date), 0) as total_vencido,
--          count(*) as titulos
--   from public.transactions where status = 'pendente' group by tenant_id
-- ) f
-- join (
--   select tenant_id,
--          sum(total_aberto)  as total_aberto,
--          sum(total_vencido) as total_vencido,
--          sum(titulos_abertos) as titulos
--   from public.vw_contas_por_pessoa group by tenant_id
-- ) p on p.tenant_id = f.tenant_id
-- group by f.tenant_id;
