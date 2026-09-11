create table if not exists public.ia_uso (
  dia             date primary key,
  chamadas        int    not null default 0,

  tokens_entrada  bigint not null default 0,
  tokens_saida    bigint not null default 0,

  recusadas       int    not null default 0,

  atualizado_em   timestamptz not null default now()
);

alter table public.ia_uso enable row level security;

drop policy if exists ia_uso_staff on public.ia_uso;
create policy ia_uso_staff on public.ia_uso
  for select using (public.is_platform_staff());

create or replace function public.fn_ia_reservar(p_limite int)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_atual int;
begin
  insert into public.ia_uso (dia, chamadas)
  values (current_date, 0)
  on conflict (dia) do nothing;

  -- `for update` serializa as concorrentes aqui. Sem isso, duas
  -- requisições simultâneas leem o mesmo valor e as duas passam.
  select u.chamadas into v_atual
  from public.ia_uso u
  where u.dia = current_date
  for update;

  if v_atual >= p_limite then
    update public.ia_uso
       set recusadas = recusadas + 1, atualizado_em = now()
     where dia = current_date;

    return jsonb_build_object('permitido', false, 'usadas', v_atual, 'limite', p_limite);
  end if;

  update public.ia_uso
     set chamadas = chamadas + 1, atualizado_em = now()
   where dia = current_date;

  return jsonb_build_object('permitido', true, 'usadas', v_atual + 1, 'limite', p_limite);
end;
$fn$;

create or replace function public.fn_ia_consumo(
  p_entrada bigint,
  p_saida   bigint
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  update public.ia_uso
     set tokens_entrada = tokens_entrada + coalesce(p_entrada, 0),
         tokens_saida   = tokens_saida   + coalesce(p_saida, 0),
         atualizado_em  = now()
   where dia = current_date;
exception when others then
  null;
end;
$fn$;

revoke all on function public.fn_ia_reservar(int) from anon, authenticated;
grant execute on function public.fn_ia_reservar(int) to service_role;

revoke all on function public.fn_ia_consumo(bigint, bigint) from anon, authenticated;
grant execute on function public.fn_ia_consumo(bigint, bigint) to service_role;

drop view if exists public.vw_ia_uso;
create view public.vw_ia_uso
with (security_invoker = on) as
select
  u.dia,
  u.chamadas,
  u.recusadas,
  u.tokens_entrada,
  u.tokens_saida,
  case when u.chamadas > 0
       then round((u.tokens_entrada + u.tokens_saida)::numeric / u.chamadas)
  end as tokens_por_chamada,
  u.atualizado_em
from public.ia_uso u
order by u.dia desc;

comment on view public.vw_ia_uso is
  'Consumo diário da IA. `recusadas` diferente de zero significa que alguém ficou sem diagnóstico.';

notify pgrst, 'reload schema';
