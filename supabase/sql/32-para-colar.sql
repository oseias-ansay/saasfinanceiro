create table if not exists public.whatsapp_instancias (
  instancia   text primary key,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,

  rotulo      text,
  numero      text,

  ativa       boolean not null default true,

  retencao_dias int not null default 180
    check (retencao_dias between 7 and 1825),

  created_at  timestamptz not null default now()
);

create index if not exists whatsapp_instancias_tenant_idx
  on public.whatsapp_instancias (tenant_id);

alter table public.whatsapp_instancias enable row level security;

drop policy if exists whatsapp_instancias_leitura on public.whatsapp_instancias;
create policy whatsapp_instancias_leitura on public.whatsapp_instancias
  for select using (
    public.is_tenant_member(tenant_id) or public.is_platform_staff()
  );

drop policy if exists whatsapp_instancias_escrita on public.whatsapp_instancias;
create policy whatsapp_instancias_escrita on public.whatsapp_instancias
  for all using (public.is_platform_staff())
  with check (public.is_platform_staff());

create table if not exists public.lead_mensagens (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,

  lead_id     uuid not null references public.leads(id) on delete cascade,

  de_mim      boolean not null,

  texto       text,

  tipo_midia  text,
  midia_nome  text,

  wa_id       text,

  enviada_em  timestamptz not null,
  created_at  timestamptz not null default now(),

  constraint mensagem_tem_conteudo check (texto is not null or tipo_midia is not null)
);

create unique index if not exists lead_mensagens_wa_uidx
  on public.lead_mensagens (tenant_id, wa_id)
  where wa_id is not null;

create index if not exists lead_mensagens_lead_idx
  on public.lead_mensagens (lead_id, enviada_em desc);

create index if not exists lead_mensagens_purga_idx
  on public.lead_mensagens (enviada_em);

alter table public.lead_mensagens enable row level security;

drop policy if exists lead_mensagens_leitura on public.lead_mensagens;
create policy lead_mensagens_leitura on public.lead_mensagens
  for select using (
    public.fn_tenant_tem_recurso(tenant_id, 'crm')
    and (
      public.is_tenant_member(tenant_id)
      or public.is_platform_staff()
      or public.is_consultor_de(tenant_id)
    )
  );

create or replace function public.fn_gravar_mensagem(
  p_instancia   text,
  p_telefone    text,
  p_de_mim      boolean,
  p_texto       text default null,
  p_tipo_midia  text default null,
  p_midia_nome  text default null,
  p_wa_id       text default null,
  p_enviada_em  timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_tenant uuid;
  v_lead   uuid;
  v_id     uuid;
begin
  select i.tenant_id into v_tenant
  from public.whatsapp_instancias i
  where i.instancia = p_instancia and i.ativa;

  if v_tenant is null then
    return null;
  end if;

  if not public.fn_tenant_tem_recurso(v_tenant, 'crm') then
    return null;
  end if;

  select l.id into v_lead
  from public.leads l
  where l.tenant_id = v_tenant
    and l.telefone_chave = public.fn_tel_chave(p_telefone)
  limit 1;

  if v_lead is null then
    return null;
  end if;

  insert into public.lead_mensagens (
    tenant_id, lead_id, de_mim, texto, tipo_midia, midia_nome, wa_id, enviada_em
  )
  values (
    v_tenant, v_lead, p_de_mim,
    left(nullif(btrim(coalesce(p_texto, '')), ''), 4000),
    p_tipo_midia, left(p_midia_nome, 200), p_wa_id, p_enviada_em
  )
  on conflict (tenant_id, wa_id) where wa_id is not null do nothing
  returning id into v_id;

  return v_id;
end;
$fn$;

revoke all on function public.fn_gravar_mensagem(text, text, boolean, text, text, text, text, timestamptz)
  from public, anon, authenticated;

create or replace function public.fn_purgar_mensagens()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_total integer := 0;
  v_n     integer;
  r       record;
begin
  for r in
    select i.tenant_id, max(i.retencao_dias) as dias
    from public.whatsapp_instancias i
    group by i.tenant_id
  loop
    delete from public.lead_mensagens m
     where m.tenant_id = r.tenant_id
       and m.enviada_em < now() - make_interval(days => r.dias);
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
  end loop;

  delete from public.lead_mensagens m
   where not exists (
     select 1 from public.whatsapp_instancias i where i.tenant_id = m.tenant_id
   )
   and m.enviada_em < now() - interval '180 days';
  get diagnostics v_n = row_count;

  return v_total + v_n;
end;
$fn$;

revoke all on function public.fn_purgar_mensagens() from public, anon, authenticated;

drop view if exists public.vw_lead_conversa;
create view public.vw_lead_conversa
with (security_invoker = on) as
select
  m.tenant_id,
  m.lead_id,
  m.id,
  m.de_mim,
  m.texto,
  m.tipo_midia,
  m.midia_nome,
  m.enviada_em
from public.lead_mensagens m
order by m.enviada_em;

notify pgrst, 'reload schema';
