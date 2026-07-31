-- =====================================================================
-- 03_functions.sql — RPCs de negócio (chamadas pelo Node e pelo n8n)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. HELPERS DE DATA
-- ---------------------------------------------------------------------
create or replace function public.fn_add_frequency(
  p_date date, p_freq public.recurrence_frequency, p_count int default 1
) returns date language sql immutable as $$
  select case p_freq
    when 'diaria'     then p_date + (p_count       || ' day')::interval
    when 'semanal'    then p_date + (p_count * 7   || ' day')::interval
    when 'quinzenal'  then p_date + (p_count * 15  || ' day')::interval
    when 'mensal'     then p_date + (p_count       || ' month')::interval
    when 'bimestral'  then p_date + (p_count * 2   || ' month')::interval
    when 'trimestral' then p_date + (p_count * 3   || ' month')::interval
    when 'semestral'  then p_date + (p_count * 6   || ' month')::interval
    when 'anual'      then p_date + (p_count       || ' year')::interval
  end::date;
$$;

-- Dia fixo do mês respeitando meses curtos (31 -> 28/29/30).
-- O ::timestamp é proposital: date_trunc sobre timestamptz seria STABLE.
create or replace function public.fn_apply_day_of_month(p_date date, p_day int)
returns date language sql immutable as $$
  select case
    when p_day is null then p_date
    else (date_trunc('month', p_date::timestamp)
          + (least(p_day, extract(day from (date_trunc('month', p_date::timestamp)
              + interval '1 month - 1 day'))::int) - 1) * interval '1 day')::date
  end;
$$;

-- ---------------------------------------------------------------------
-- 2. SEED DE CATEGORIAS PADRÃO (onboarding da empresa)
-- ---------------------------------------------------------------------
create or replace function public.fn_seed_default_categories(p_tenant_id uuid)
returns int language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_count int;
begin
  if not public.is_tenant_admin(p_tenant_id) then
    raise exception 'Permissão negada para o tenant %', p_tenant_id;
  end if;

  insert into public.categories (tenant_id, name, type, dre_group) values
    (p_tenant_id, 'Venda de Produtos',         'receita', 'receita_bruta'),
    (p_tenant_id, 'Prestação de Serviços',     'receita', 'receita_bruta'),
    (p_tenant_id, 'Outras Receitas',           'receita', 'outras_receitas'),
    (p_tenant_id, 'Impostos sobre Vendas',     'despesa', 'deducao'),
    (p_tenant_id, 'Devoluções e Descontos',    'despesa', 'deducao'),
    (p_tenant_id, 'Mercadoria / Matéria-Prima','despesa', 'custo_variavel'),
    (p_tenant_id, 'Comissões de Vendas',       'despesa', 'custo_variavel'),
    (p_tenant_id, 'Frete sobre Vendas',        'despesa', 'custo_variavel'),
    (p_tenant_id, 'Taxas de Cartão / Gateway', 'despesa', 'custo_variavel'),
    (p_tenant_id, 'Embalagens',                'despesa', 'custo_variavel'),
    (p_tenant_id, 'Folha de Pagamento',        'despesa', 'despesa_fixa'),
    (p_tenant_id, 'Pró-labore',                'despesa', 'despesa_fixa'),
    (p_tenant_id, 'Encargos Sociais',          'despesa', 'despesa_fixa'),
    (p_tenant_id, 'Aluguel e Condomínio',      'despesa', 'despesa_fixa'),
    (p_tenant_id, 'Energia, Água e Internet',  'despesa', 'despesa_fixa'),
    (p_tenant_id, 'Contabilidade',             'despesa', 'despesa_fixa'),
    (p_tenant_id, 'Software e Assinaturas',    'despesa', 'despesa_fixa'),
    (p_tenant_id, 'Marketing e Publicidade',   'despesa', 'despesa_fixa'),
    (p_tenant_id, 'Manutenção e Limpeza',      'despesa', 'despesa_fixa'),
    (p_tenant_id, 'Despesas Financeiras',      'despesa', 'outras_despesas'),
    (p_tenant_id, 'Investimentos / Imobilizado','despesa','outras_despesas')
  on conflict (tenant_id, name, type) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. CRIAÇÃO DE LANÇAMENTO (à vista ou parcelado)
-- ---------------------------------------------------------------------
-- p_amount_mode:     'total' divide entre parcelas | 'parcela' repete o valor
-- p_competence_mode: 'origem' concentra no mês do fato | 'parcela' distribui
create or replace function public.fn_create_transaction(
  p_tenant_id        uuid,
  p_type             public.transaction_type,
  p_description      text,
  p_amount           numeric,
  p_due_date         date,
  p_competence_date  date default null,
  p_category_id      uuid default null,
  p_entity_id        uuid default null,
  p_cost_center_id   uuid default null,
  p_bank_account_id  uuid default null,
  p_installments     int  default 1,
  p_frequency        public.recurrence_frequency default 'mensal',
  p_amount_mode      text default 'total',
  p_competence_mode  text default 'parcela',
  p_document_number  text default null,
  p_notes            text default null
) returns setof public.transactions
language plpgsql security invoker      -- respeita o RLS do usuário chamador
set search_path = public, pg_temp as $$
declare
  v_competence date := coalesce(p_competence_date, p_due_date);
  v_per        numeric(14,2);
  v_residual   numeric(14,2);
  v_parent     uuid;
  v_id         uuid;
  v_due        date;
  v_comp       date;
  v_amount     numeric(14,2);
  v_sched      public.schedule_type;
  i            int;
begin
  if p_installments < 1 then
    raise exception 'Número de parcelas inválido: %', p_installments;
  end if;
  if p_amount <= 0 then
    raise exception 'Valor deve ser maior que zero';
  end if;

  v_sched := case when p_installments = 1 then 'avista' else 'parcelado' end;

  if p_amount_mode = 'total' and p_installments > 1 then
    v_per      := round(p_amount / p_installments, 2);
    v_residual := p_amount - (v_per * p_installments);   -- sobra de arredondamento
  else
    v_per      := round(p_amount, 2);
    v_residual := 0;
  end if;

  for i in 1..p_installments loop
    v_due    := case when i = 1 then p_due_date
                     else public.fn_add_frequency(p_due_date, p_frequency, i - 1) end;
    v_comp   := case when p_competence_mode = 'origem' then v_competence
                     when i = 1 then v_competence
                     else public.fn_add_frequency(v_competence, p_frequency, i - 1) end;
    v_amount := v_per + case when i = p_installments then v_residual else 0 end;

    insert into public.transactions (
      tenant_id, type, description, amount, status,
      competence_date, due_date,
      category_id, entity_id, cost_center_id, bank_account_id,
      schedule_type, parent_id, installment_number, installment_total,
      document_number, notes, created_by
    ) values (
      p_tenant_id, p_type,
      case when p_installments > 1
           then p_description || format(' (%s/%s)', i, p_installments)
           else p_description end,
      v_amount, 'pendente',
      v_comp, v_due,
      p_category_id, p_entity_id, p_cost_center_id, p_bank_account_id,
      v_sched, v_parent,
      case when p_installments > 1 then i end,
      case when p_installments > 1 then p_installments end,
      p_document_number, p_notes, auth.uid()
    )
    returning id into v_id;

    if i = 1 then
      v_parent := v_id;
    end if;

    return query select * from public.transactions where id = v_id;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. BAIXA / ESTORNO
-- ---------------------------------------------------------------------
create or replace function public.fn_settle_transactions(
  p_ids             uuid[],
  p_paid_date       date default current_date,
  p_bank_account_id uuid default null,
  p_paid_amount     numeric default null   -- null = valor cheio de cada título
) returns int language plpgsql security invoker
set search_path = public, pg_temp as $$
declare v_count int;
begin
  update public.transactions t
     set status          = 'liquidado',
         paid_date       = p_paid_date,
         paid_amount     = coalesce(p_paid_amount, t.amount),
         bank_account_id = coalesce(p_bank_account_id, t.bank_account_id)
   where t.id = any(p_ids) and t.status = 'pendente';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.fn_unsettle_transactions(p_ids uuid[])
returns int language plpgsql security invoker
set search_path = public, pg_temp as $$
declare v_count int;
begin
  update public.transactions
     set status = 'pendente', paid_date = null, paid_amount = null
   where id = any(p_ids) and status = 'liquidado';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. MATERIALIZAÇÃO DAS RECORRÊNCIAS (chamada pelo n8n via service_role)
-- ---------------------------------------------------------------------
create or replace function public.fn_generate_recurring(
  p_tenant_id uuid default null,   -- null = todos os tenants
  p_horizon   date default null    -- null = usa generate_ahead_days do template
) returns table (template_id uuid, generated int)
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  r          public.recurring_templates%rowtype;
  v_due      date;
  v_limit    date;
  v_n        int;
  v_inserted int;
begin
  for r in
    select * from public.recurring_templates
     where is_active
       and (p_tenant_id is null or tenant_id = p_tenant_id)
       and next_due_date <= coalesce(p_horizon, current_date + generate_ahead_days)
       and (end_date is null or next_due_date <= end_date)
     order by tenant_id, next_due_date
  loop
    v_limit    := coalesce(p_horizon, current_date + r.generate_ahead_days);
    v_due      := r.next_due_date;
    v_n        := r.occurrences_created;
    v_inserted := 0;

    while v_due <= v_limit
      and (r.end_date is null or v_due <= r.end_date)
      and (r.max_occurrences is null or v_n < r.max_occurrences)
    loop
      insert into public.transactions (
        tenant_id, type, description, amount, status,
        competence_date, due_date,
        category_id, entity_id, cost_center_id, bank_account_id,
        schedule_type, recurring_template_id, created_by
      ) values (
        r.tenant_id, r.type, r.description, r.amount, 'pendente',
        v_due, v_due,
        r.category_id, r.entity_id, r.cost_center_id, r.bank_account_id,
        'recorrente', r.id, r.created_by
      )
      -- O predicado WHERE é obrigatório: o índice único é PARCIAL.
      on conflict (recurring_template_id, due_date)
        where recurring_template_id is not null
        do nothing;

      if found then
        v_inserted := v_inserted + 1;
      end if;

      v_n   := v_n + 1;
      v_due := public.fn_apply_day_of_month(
                 public.fn_add_frequency(v_due, r.frequency, r.interval_count),
                 r.day_of_month);
    end loop;

    update public.recurring_templates
       set next_due_date       = v_due,
           occurrences_created = v_n,
           last_generated_at   = now(),
           is_active           = case
             when r.end_date is not null and v_due > r.end_date then false
             when r.max_occurrences is not null and v_n >= r.max_occurrences then false
             else true end
     where id = r.id;

    template_id := r.id;
    generated   := v_inserted;
    return next;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. CONSULTAS PARA OS ALERTAS DO n8n
-- ---------------------------------------------------------------------
create or replace function public.fn_due_alerts(p_days int default 0)
returns table (
  tenant_id      uuid,
  tenant_name    text,
  transaction_id uuid,
  type           public.transaction_type,
  description    text,
  amount         numeric,
  due_date       date,
  days_to_due    int,
  entity_name    text,
  entity_email   text,
  entity_phone   text,
  category_name  text
) language sql security definer
set search_path = public, pg_temp as $$
  select t.tenant_id, tn.name, t.id, t.type, t.description, t.amount, t.due_date,
         (t.due_date - current_date)::int,
         e.name, e.email, e.phone, c.name
    from public.transactions t
    join public.tenants tn        on tn.id = t.tenant_id and tn.is_active
    left join public.entities e   on e.id  = t.entity_id
    left join public.categories c on c.id  = t.category_id
   where t.status = 'pendente'
     and t.due_date = current_date + p_days
   order by t.tenant_id, t.due_date, t.amount desc;
$$;

create or replace function public.fn_daily_digest(p_tenant_id uuid)
returns jsonb language sql security definer
set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'tenant_id',          p_tenant_id,
    'data',               current_date,
    'vence_hoje_pagar',   coalesce(sum(amount) filter (where type='despesa' and due_date = current_date), 0),
    'vence_hoje_receber', coalesce(sum(amount) filter (where type='receita' and due_date = current_date), 0),
    'atrasado_pagar',     coalesce(sum(amount) filter (where type='despesa' and due_date < current_date), 0),
    'atrasado_receber',   coalesce(sum(amount) filter (where type='receita' and due_date < current_date), 0),
    'qtd_atrasados',      count(*) filter (where due_date < current_date)
  )
  from public.transactions
  where tenant_id = p_tenant_id and status = 'pendente';
$$;

-- ---------------------------------------------------------------------
-- 7. GRANTS
-- ---------------------------------------------------------------------
grant execute on function public.fn_seed_default_categories(uuid) to authenticated;
grant execute on function public.fn_create_transaction(
  uuid, public.transaction_type, text, numeric, date, date, uuid, uuid, uuid, uuid,
  int, public.recurrence_frequency, text, text, text, text) to authenticated;
grant execute on function public.fn_settle_transactions(uuid[], date, uuid, numeric) to authenticated;
grant execute on function public.fn_unsettle_transactions(uuid[]) to authenticated;

-- Jobs do n8n: apenas service_role
revoke all on function public.fn_generate_recurring(uuid, date) from public, authenticated;
revoke all on function public.fn_due_alerts(int)                from public, authenticated;
revoke all on function public.fn_daily_digest(uuid)             from public, authenticated;
grant execute on function public.fn_generate_recurring(uuid, date) to service_role;
grant execute on function public.fn_due_alerts(int)                to service_role;
grant execute on function public.fn_daily_digest(uuid)             to service_role;
