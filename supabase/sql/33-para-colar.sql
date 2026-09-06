create table if not exists public.eventos_whatsapp (
  id          uuid primary key default gen_random_uuid(),

  instancia   text,

  tenant_id   uuid references public.tenants(id) on delete cascade,

  wa_id       text,

  motivo      text,
  responder   boolean,
  registrar   boolean,
  guardar     boolean,

  resultado   jsonb,

  erro        text,

  resumo      jsonb,

  recebido_em timestamptz not null default now()
);

create index if not exists eventos_whatsapp_recente_idx
  on public.eventos_whatsapp (recebido_em desc);

create index if not exists eventos_whatsapp_sem_lead_idx
  on public.eventos_whatsapp (recebido_em desc)
  where tenant_id is null or erro is not null;

alter table public.eventos_whatsapp enable row level security;

drop policy if exists eventos_whatsapp_staff on public.eventos_whatsapp;
create policy eventos_whatsapp_staff on public.eventos_whatsapp
  for select using (public.is_platform_staff());

create or replace function public.fn_registrar_evento_whatsapp(
  p_instancia text,
  p_tenant_id uuid default null,
  p_wa_id     text default null,
  p_motivo    text default null,
  p_responder boolean default null,
  p_registrar boolean default null,
  p_guardar   boolean default null,
  p_resultado jsonb default null,
  p_erro      text default null,
  p_resumo    jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_id uuid;
begin
  insert into public.eventos_whatsapp (
    instancia, tenant_id, wa_id, motivo,
    responder, registrar, guardar, resultado, erro, resumo
  )
  values (
    left(p_instancia, 80), p_tenant_id, left(p_wa_id, 120), left(p_motivo, 200),
    p_responder, p_registrar, p_guardar, p_resultado, left(p_erro, 2000), p_resumo
  )
  returning id into v_id;

  return v_id;
exception when others then
  -- Engole de propósito. Ver o comentário acima.
  return null;
end;
$fn$;

revoke all on function public.fn_registrar_evento_whatsapp(
  text, uuid, text, text, boolean, boolean, boolean, jsonb, text, jsonb
) from anon, authenticated;

grant execute on function public.fn_registrar_evento_whatsapp(
  text, uuid, text, text, boolean, boolean, boolean, jsonb, text, jsonb
) to service_role;

create or replace function public.fn_purgar_eventos_whatsapp()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_n integer;
begin
  delete from public.eventos_whatsapp
   where recebido_em < now() - interval '30 days';
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

revoke all on function public.fn_purgar_eventos_whatsapp() from anon, authenticated;
grant execute on function public.fn_purgar_eventos_whatsapp() to service_role;

drop view if exists public.vw_eventos_whatsapp;
create view public.vw_eventos_whatsapp
with (security_invoker = on) as
select
  e.recebido_em,
  e.instancia,
  e.tenant_id,
  case
    when e.tenant_id is null then 'instância não reconhecida'
    when e.erro is not null   then 'falhou'
    when e.registrar and (e.resultado #>> '{lead_id}') is null then 'devia registrar e não registrou'
    when e.guardar   and (e.resultado #>> '{mensagem_id}') is null then 'devia guardar e não guardou'
    when e.responder and (e.resultado #>> '{respondido}') <> 'true' then 'devia responder e não respondeu'
    else 'ok'
  end as veredito,
  e.motivo,
  e.responder,
  e.registrar,
  e.guardar,
  e.resultado,
  e.erro,
  e.wa_id
from public.eventos_whatsapp e
order by e.recebido_em desc;

comment on view public.vw_eventos_whatsapp is
  'O que chegou pelo WhatsApp e o que virou. A coluna `veredito` compara a decisão com o resultado — é onde a falha silenciosa aparece.';

notify pgrst, 'reload schema';
