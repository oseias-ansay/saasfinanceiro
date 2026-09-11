create table if not exists public.execucoes (
  id           uuid primary key default gen_random_uuid(),

  processo     text not null,

  iniciado_em  timestamptz not null default now(),
  terminado_em timestamptz,

  ok           boolean,

  total        int,

  detalhe      jsonb,
  erro         text
);

create index if not exists execucoes_ultimo_idx
  on public.execucoes (processo, terminado_em desc)
  where ok;

create index if not exists execucoes_recentes_idx
  on public.execucoes (iniciado_em desc);

alter table public.execucoes enable row level security;

drop policy if exists execucoes_staff on public.execucoes;
create policy execucoes_staff on public.execucoes
  for select using (public.is_platform_staff());

create or replace function public.fn_execucao_inicio(p_processo text)
returns uuid
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.execucoes (processo) values (left(p_processo, 80))
  returning id;
$$;

create or replace function public.fn_execucao_fim(
  p_id      uuid,
  p_ok      boolean,
  p_total   int default null,
  p_detalhe jsonb default null,
  p_erro    text default null
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.execucoes
     set terminado_em = now(),
         ok           = p_ok,
         total        = p_total,
         detalhe      = p_detalhe,
         erro         = left(p_erro, 4000)
   where id = p_id;
$$;

create or replace function public.fn_execucoes_ultimo_sucesso()
returns table (processo text, ultimo_sucesso timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.processo, max(e.terminado_em)
  from public.execucoes e
  where e.ok
  group by e.processo;
$$;

create table if not exists public.monitor_alarmes (
  processo     text primary key,
  ultimo_envio timestamptz not null default now(),
  vezes        int not null default 1
);

alter table public.monitor_alarmes enable row level security;

drop policy if exists monitor_alarmes_staff on public.monitor_alarmes;
create policy monitor_alarmes_staff on public.monitor_alarmes
  for select using (public.is_platform_staff());

create or replace function public.fn_alarme_cabe(
  p_processo   text,
  p_intervalo  interval default '6 hours'
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_anterior timestamptz;
begin
  -- `for update` trava a linha: dois processos da API chamando ao mesmo
  -- tempo entram em fila aqui em vez de decidirem os dois que cabe.
  select a.ultimo_envio into v_anterior
  from public.monitor_alarmes a
  where a.processo = p_processo
  for update;

  if v_anterior is null then
    insert into public.monitor_alarmes (processo) values (left(p_processo, 80));
    return true;
  end if;

  if v_anterior < now() - p_intervalo then
    update public.monitor_alarmes
       set ultimo_envio = now(), vezes = vezes + 1
     where processo = p_processo;
    return true;
  end if;

  return false;
exception when unique_violation then
  -- Outro processo inseriu entre o select e o insert. Ele alarma; este
  -- não. Perder um alarme repetido é melhor que mandar dois.
  return false;
end;
$fn$;

create or replace function public.fn_alarme_limpar(p_processo text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.monitor_alarmes where processo = p_processo;
$$;

create table if not exists public.monitor_pulso (
  dia         date primary key,
  enviado_em  timestamptz not null default now()
);

alter table public.monitor_pulso enable row level security;

drop policy if exists monitor_pulso_staff on public.monitor_pulso;
create policy monitor_pulso_staff on public.monitor_pulso
  for select using (public.is_platform_staff());

create or replace function public.fn_pulso_reservar(p_dia date)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  insert into public.monitor_pulso (dia) values (p_dia);
  return true;
exception when unique_violation then
  return false;
end;
$fn$;

create or replace function public.fn_purgar_execucoes()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare v_n integer;
begin
  delete from public.execucoes where iniciado_em < now() - interval '90 days';
  get diagnostics v_n = row_count;

  delete from public.monitor_pulso where dia < current_date - 90;

  return v_n;
end;
$fn$;

revoke all on function public.fn_execucao_inicio(text) from anon, authenticated;
grant execute on function public.fn_execucao_inicio(text) to service_role;

revoke all on function public.fn_execucao_fim(uuid, boolean, int, jsonb, text) from anon, authenticated;
grant execute on function public.fn_execucao_fim(uuid, boolean, int, jsonb, text) to service_role;

revoke all on function public.fn_execucoes_ultimo_sucesso() from anon, authenticated;
grant execute on function public.fn_execucoes_ultimo_sucesso() to service_role;

revoke all on function public.fn_alarme_cabe(text, interval) from anon, authenticated;
grant execute on function public.fn_alarme_cabe(text, interval) to service_role;

revoke all on function public.fn_alarme_limpar(text) from anon, authenticated;
grant execute on function public.fn_alarme_limpar(text) to service_role;

revoke all on function public.fn_pulso_reservar(date) from anon, authenticated;
grant execute on function public.fn_pulso_reservar(date) to service_role;

revoke all on function public.fn_purgar_execucoes() from anon, authenticated;
grant execute on function public.fn_purgar_execucoes() to service_role;

drop view if exists public.vw_execucoes;
create view public.vw_execucoes
with (security_invoker = on) as
select
  e.processo,
  e.iniciado_em,
  e.terminado_em,
  case
    when e.terminado_em is null and e.iniciado_em < now() - interval '1 hour'
      then 'travado'
    when e.terminado_em is null then 'rodando'
    when e.ok then 'ok'
    else 'falhou'
  end as situacao,
  round(extract(epoch from (e.terminado_em - e.iniciado_em)))::int as duracao_seg,
  e.total,
  e.erro
from public.execucoes e
order by e.iniciado_em desc;

comment on view public.vw_execucoes is
  'O que rodou. `travado` é a linha que começou e nunca terminou — invisível sem o registro em dois tempos.';

notify pgrst, 'reload schema';
