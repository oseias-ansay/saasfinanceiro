-- =====================================================================
-- 04_views.sql — Views de leitura (Módulos B, C e D)
-- =====================================================================
-- Todas usam security_invoker = on (PG15+): o RLS das tabelas de origem
-- continua valendo, então o front pode consultá-las direto pelo supabase-js.
-- =====================================================================

-- ---------------------------------------------------------------------
-- MÓDULO B — Contas a Pagar / Receber
-- ---------------------------------------------------------------------
create or replace view public.vw_transactions
with (security_invoker = on) as
select
  t.id, t.tenant_id, t.type, t.description, t.amount, t.status,
  t.competence_date, t.due_date, t.paid_date, t.paid_amount,
  t.schedule_type, t.installment_number, t.installment_total,
  t.document_number, t.notes,
  t.category_id,      c.name  as category_name, c.dre_group,
  t.entity_id,        e.name  as entity_name, e.email as entity_email, e.phone as entity_phone,
  t.cost_center_id,   cc.name as cost_center_name,
  t.bank_account_id,  ba.name as bank_account_name,
  (t.due_date - current_date)::int as days_to_due,
  case
    when t.status = 'cancelado'         then 'cancelado'
    when t.status = 'liquidado'         then 'liquidado'
    when t.due_date <  current_date     then 'atrasado'
    when t.due_date =  current_date     then 'vence_hoje'
    when t.due_date <= current_date + 7 then 'vence_semana'
    else 'a_vencer'
  end as situacao,
  exists (select 1 from public.attachments a where a.transaction_id = t.id) as has_attachment,
  t.created_at, t.updated_at
from public.transactions t
left join public.categories    c  on c.id  = t.category_id
left join public.entities      e  on e.id  = t.entity_id
left join public.cost_centers  cc on cc.id = t.cost_center_id
left join public.bank_accounts ba on ba.id = t.bank_account_id;

comment on view public.vw_transactions is
  'Base das telas de Contas a Pagar/Receber. Filtre por type, situacao e due_date.';

-- ---------------------------------------------------------------------
-- MÓDULO C.1 — Fluxo de caixa REALIZADO (regime de caixa)
-- ---------------------------------------------------------------------
create or replace view public.vw_cashflow_daily
with (security_invoker = on) as
with mov as (
  select
    t.tenant_id,
    t.paid_date as data,
    sum(t.paid_amount) filter (where t.type = 'receita') as entradas,
    sum(t.paid_amount) filter (where t.type = 'despesa') as saidas
  from public.transactions t
  where t.status = 'liquidado' and t.paid_date is not null
  group by t.tenant_id, t.paid_date
),
saldo_inicial as (
  select tenant_id, sum(opening_balance) as ob
  from public.bank_accounts where is_active group by tenant_id
)
select
  m.tenant_id,
  m.data,
  coalesce(m.entradas, 0)                         as entradas,
  coalesce(m.saidas, 0)                           as saidas,
  coalesce(m.entradas, 0) - coalesce(m.saidas, 0) as resultado_dia,
  coalesce(s.ob, 0)
    + sum(coalesce(m.entradas,0) - coalesce(m.saidas,0))
      over (partition by m.tenant_id order by m.data
            rows between unbounded preceding and current row) as saldo_acumulado
from mov m
left join saldo_inicial s on s.tenant_id = m.tenant_id;

-- ---------------------------------------------------------------------
-- MÓDULO C.2 — Projeção 30/60/90 dias + alerta de saldo negativo
-- ---------------------------------------------------------------------
create or replace view public.vw_cashflow_projection
with (security_invoker = on) as
select
  x.tenant_id,
  x.data,
  (x.data - current_date)::int as dias_a_frente,
  x.entradas_previstas,
  x.saidas_previstas,
  x.entradas_previstas - x.saidas_previstas as resultado_previsto,
  x.valor_em_atraso,
  x.saldo_atual,
  x.saldo_projetado,
  (x.saldo_projetado < 0) as alerta_saldo_negativo
from (
  select
    p.tenant_id, p.data, p.entradas_previstas, p.saidas_previstas,
    p.valor_em_atraso, b.saldo_atual,
    b.saldo_atual
      + sum(p.entradas_previstas - p.saidas_previstas)
        over (partition by p.tenant_id order by p.data
              rows between unbounded preceding and current row) as saldo_projetado
  from (
    -- Pendentes. Vencidos entram no "dia de hoje" da projeção.
    select
      t.tenant_id,
      greatest(t.due_date, current_date) as data,
      coalesce(sum(t.amount) filter (where t.type = 'receita'), 0) as entradas_previstas,
      coalesce(sum(t.amount) filter (where t.type = 'despesa'), 0) as saidas_previstas,
      coalesce(sum(t.amount) filter (where t.due_date < current_date), 0) as valor_em_atraso
    from public.transactions t
    where t.status = 'pendente'
    group by t.tenant_id, greatest(t.due_date, current_date)
  ) p
  join (
    -- Saldo hoje = saldo inicial das contas + tudo que já foi liquidado
    select
      tn.id as tenant_id,
      coalesce((select sum(b2.opening_balance) from public.bank_accounts b2
                 where b2.tenant_id = tn.id and b2.is_active), 0)
      + coalesce((select sum(case when t2.type = 'receita' then t2.paid_amount
                                  else -t2.paid_amount end)
                    from public.transactions t2
                   where t2.tenant_id = tn.id and t2.status = 'liquidado'
                     and t2.paid_date <= current_date), 0) as saldo_atual
    from public.tenants tn
  ) b on b.tenant_id = p.tenant_id
) x;

comment on view public.vw_cashflow_projection is
  'Módulo C: projeção de caixa. Filtre dias_a_frente <= 30/60/90.';

-- ---------------------------------------------------------------------
-- MÓDULO D — DRE Gerencial por COMPETÊNCIA
-- ---------------------------------------------------------------------
create or replace view public.vw_dre_monthly
with (security_invoker = on) as
select
  d.tenant_id,
  d.competencia,
  d.receita_bruta,
  d.deducoes,
  d.receita_bruta - d.deducoes                                        as receita_liquida,
  d.custos_variaveis,
  d.receita_bruta - d.deducoes - d.custos_variaveis                   as margem_contribuicao,
  case when (d.receita_bruta - d.deducoes) > 0
       then round(((d.receita_bruta - d.deducoes - d.custos_variaveis)
                   / (d.receita_bruta - d.deducoes)) * 100, 2)
  end                                                                 as margem_contribuicao_pct,
  d.despesas_fixas,
  d.receita_bruta - d.deducoes - d.custos_variaveis - d.despesas_fixas as resultado_operacional,
  d.outras_receitas,
  d.outras_despesas,
  d.receita_bruta - d.deducoes - d.custos_variaveis - d.despesas_fixas
    + d.outras_receitas - d.outras_despesas                           as resultado_liquido,
  case when d.despesas_fixas > 0
        and (d.receita_bruta - d.deducoes) > 0
        and (d.receita_bruta - d.deducoes - d.custos_variaveis) > 0
       then round(d.despesas_fixas
                  / ((d.receita_bruta - d.deducoes - d.custos_variaveis)
                     / (d.receita_bruta - d.deducoes)), 2)
  end                                                                 as ponto_equilibrio
from (
  select
    t.tenant_id,
    date_trunc('month', t.competence_date::timestamp)::date as competencia,
    coalesce(sum(t.amount) filter (where g.grp = 'receita_bruta'),   0) as receita_bruta,
    coalesce(sum(t.amount) filter (where g.grp = 'deducao'),         0) as deducoes,
    coalesce(sum(t.amount) filter (where g.grp = 'custo_variavel'),  0) as custos_variaveis,
    coalesce(sum(t.amount) filter (where g.grp = 'despesa_fixa'),    0) as despesas_fixas,
    coalesce(sum(t.amount) filter (where g.grp = 'outras_receitas'), 0) as outras_receitas,
    coalesce(sum(t.amount) filter (where g.grp = 'outras_despesas'), 0) as outras_despesas
  from public.transactions t
  left join public.categories c on c.id = t.category_id
  cross join lateral (
    -- Sem categoria: receita cai em receita_bruta, despesa em despesa_fixa.
    -- Decisão deliberada para o DRE nunca "sumir" com dinheiro.
    select coalesce(c.dre_group,
             case when t.type = 'receita' then 'receita_bruta'::public.dre_group
                  else 'despesa_fixa'::public.dre_group end) as grp
  ) g
  where t.status <> 'cancelado'
  group by t.tenant_id, date_trunc('month', t.competence_date::timestamp)
) d;

comment on view public.vw_dre_monthly is
  'Módulo D: DRE por regime de competência. Exclui lançamentos cancelados.';

-- Distribuição de despesas por categoria (gráfico)
create or replace view public.vw_expenses_by_category
with (security_invoker = on) as
select
  t.tenant_id,
  date_trunc('month', t.competence_date::timestamp)::date as competencia,
  coalesce(c.name, 'Sem categoria') as category_name,
  coalesce(c.dre_group, 'despesa_fixa'::public.dre_group) as dre_group,
  c.color,
  sum(t.amount) as total,
  count(*)      as qtd
from public.transactions t
left join public.categories c on c.id = t.category_id
where t.type = 'despesa' and t.status <> 'cancelado'
group by t.tenant_id, date_trunc('month', t.competence_date::timestamp),
         coalesce(c.name, 'Sem categoria'),
         coalesce(c.dre_group, 'despesa_fixa'::public.dre_group), c.color;

-- KPIs do topo do dashboard
create or replace view public.vw_dashboard_kpis
with (security_invoker = on) as
select
  tn.id as tenant_id,
  coalesce((select sum(b.opening_balance) from public.bank_accounts b
             where b.tenant_id = tn.id and b.is_active), 0)
  + coalesce((select sum(case when t.type='receita' then t.paid_amount else -t.paid_amount end)
                from public.transactions t
               where t.tenant_id = tn.id and t.status='liquidado'
                 and t.paid_date <= current_date), 0) as saldo_hoje,
  coalesce((select sum(t.amount) from public.transactions t
             where t.tenant_id = tn.id and t.status='pendente'
               and t.type='receita' and t.due_date < current_date), 0) as receber_atrasado,
  coalesce((select sum(t.amount) from public.transactions t
             where t.tenant_id = tn.id and t.status='pendente'
               and t.type='despesa' and t.due_date < current_date), 0) as pagar_atrasado,
  coalesce((select sum(t.amount) from public.transactions t
             where t.tenant_id = tn.id and t.status='pendente' and t.type='receita'
               and t.due_date between current_date and current_date + 30), 0) as receber_30d,
  coalesce((select sum(t.amount) from public.transactions t
             where t.tenant_id = tn.id and t.status='pendente' and t.type='despesa'
               and t.due_date between current_date and current_date + 30), 0) as pagar_30d
from public.tenants tn;

grant select on public.vw_transactions,
                public.vw_cashflow_daily,
                public.vw_cashflow_projection,
                public.vw_dre_monthly,
                public.vw_expenses_by_category,
                public.vw_dashboard_kpis
  to authenticated;
