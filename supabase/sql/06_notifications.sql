-- =====================================================================
-- Etapa 3 — Complemento do banco para os workflows do n8n
-- Rode no SQL Editor DEPOIS dos arquivos 01 a 04.
-- =====================================================================
-- Adiciona:
--   • tabela notifications   -> alertas in-app (sino do dashboard)
--   • fn_notify()            -> grava notificação (usada pelo n8n via API)
--   • fn_digest_all()        -> payload completo do alerta diário, por empresa
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. NOTIFICAÇÕES IN-APP
-- ---------------------------------------------------------------------
do $$ begin
  create type public.notification_severity as enum ('info', 'warning', 'critical');
exception when duplicate_object then null; end $$;

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  kind        text not null,               -- 'digest_diario', 'caixa_negativo', 'recorrencia'
  title       text not null,
  body        text,
  severity    public.notification_severity not null default 'info',
  link        text,                        -- rota do front, ex.: /contas-a-pagar?filtro=atrasado
  meta        jsonb not null default '{}'::jsonb,
  is_read     boolean not null default false,
  read_at     timestamptz,
  -- Coluna simples de data para o índice anti-spam. Não use created_at::date:
  -- o cast de timestamptz para date é STABLE, e o Postgres exige expressão
  -- IMMUTABLE em índice — daria erro na criação.
  ref_date    date not null default current_date,
  created_at  timestamptz not null default now()
);

create index if not exists notifications_tenant_idx
  on public.notifications (tenant_id, created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications (tenant_id) where not is_read;

-- Evita spam: uma notificação do mesmo tipo por empresa por dia.
create unique index if not exists notifications_daily_uidx
  on public.notifications (tenant_id, kind, ref_date);

alter table public.notifications enable row level security;

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

-- Só marcar como lida; o conteúdo é escrito pelo service_role.
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

-- ---------------------------------------------------------------------
-- 2. RPC DE ESCRITA (chamada pelo n8n via API)
-- ---------------------------------------------------------------------
create or replace function public.fn_notify(
  p_tenant_id uuid,
  p_kind      text,
  p_title     text,
  p_body      text default null,
  p_severity  public.notification_severity default 'info',
  p_link      text default null,
  p_meta      jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  insert into public.notifications (tenant_id, kind, title, body, severity, link, meta)
  values (p_tenant_id, p_kind, p_title, p_body, p_severity, p_link, p_meta)
  on conflict (tenant_id, kind, ref_date) do update
     set title = excluded.title,
         body  = excluded.body,
         severity = excluded.severity,
         meta  = excluded.meta,
         is_read = false
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. PAYLOAD DO ALERTA DIÁRIO
-- ---------------------------------------------------------------------
-- Uma linha por empresa ativa, já com destinatários e números prontos.
-- O n8n só precisa decidir se envia e montar o HTML.
create or replace function public.fn_digest_all()
returns table (
  tenant_id             uuid,
  tenant_name           text,
  recipients            text[],
  saldo_atual           numeric,
  vence_hoje_pagar      numeric,
  vence_hoje_receber    numeric,
  atrasado_pagar        numeric,
  atrasado_receber      numeric,
  qtd_atrasados         int,
  primeiro_dia_negativo date,
  titulos               jsonb
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    tn.id,
    tn.name,
    r.recipients,
    coalesce(k.saldo_hoje, 0),
    d.vence_hoje_pagar,
    d.vence_hoje_receber,
    d.atrasado_pagar,
    d.atrasado_receber,
    d.qtd_atrasados,
    neg.primeiro_dia_negativo,
    t.titulos
  from public.tenants tn

  -- Destinatários: donos e administradores com e-mail cadastrado
  cross join lateral (
    select coalesce(
             array_agg(distinct p.email) filter (where p.email is not null),
             '{}'
           )::text[] as recipients
    from public.memberships m
    join public.profiles p on p.id = m.user_id
    where m.tenant_id = tn.id and m.is_active and m.role in ('owner', 'admin')
  ) r

  -- Números do dia
  cross join lateral (
    select
      coalesce(sum(x.amount) filter (where x.type = 'despesa' and x.due_date = current_date), 0) as vence_hoje_pagar,
      coalesce(sum(x.amount) filter (where x.type = 'receita' and x.due_date = current_date), 0) as vence_hoje_receber,
      coalesce(sum(x.amount) filter (where x.type = 'despesa' and x.due_date < current_date), 0) as atrasado_pagar,
      coalesce(sum(x.amount) filter (where x.type = 'receita' and x.due_date < current_date), 0) as atrasado_receber,
      coalesce(count(*) filter (where x.due_date < current_date), 0)::int                        as qtd_atrasados
    from public.transactions x
    where x.tenant_id = tn.id and x.status = 'pendente'
  ) d

  -- Primeiro dia com saldo projetado negativo (o alerta mais acionável)
  cross join lateral (
    select min(cp.data) as primeiro_dia_negativo
    from public.vw_cashflow_projection cp
    where cp.tenant_id = tn.id and cp.alerta_saldo_negativo
  ) neg

  -- Até 15 títulos para detalhar no corpo do e-mail
  cross join lateral (
    select coalesce(jsonb_agg(to_jsonb(y) order by y.due_date), '[]'::jsonb) as titulos
    from (
      select v.id, v.type, v.description, v.amount, v.due_date,
             v.situacao, v.entity_name, v.category_name
      from public.vw_transactions v
      where v.tenant_id = tn.id
        and v.status = 'pendente'
        and v.due_date <= current_date
      order by v.due_date, v.amount desc
      limit 15
    ) y
  ) t

  left join public.vw_dashboard_kpis k on k.tenant_id = tn.id

  where tn.is_active
  order by tn.name;
$$;

-- ---------------------------------------------------------------------
-- 4. GRANTS — só o service_role (API/n8n) executa
-- ---------------------------------------------------------------------
revoke all on function public.fn_notify(uuid, text, text, text, public.notification_severity, text, jsonb)
  from public, authenticated;
revoke all on function public.fn_digest_all() from public, authenticated;

grant execute on function public.fn_notify(uuid, text, text, text, public.notification_severity, text, jsonb)
  to service_role;
grant execute on function public.fn_digest_all() to service_role;

grant select, update on public.notifications to authenticated;
