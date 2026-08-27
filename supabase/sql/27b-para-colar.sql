insert into public.etapas_funil (codigo, nome, ordem, terminal, descricao) values
  ('reuniao', 'Reunião', 25, false, 'Conversa marcada ou realizada com o decisor.')
on conflict (codigo) do update set
  nome = excluded.nome, ordem = excluded.ordem, descricao = excluded.descricao;

update public.etapas_funil
   set descricao = 'Tem o problema, o orçamento e a decisão. Opcional: em '
                || 'venda consultiva isso costuma se resolver na reunião.'
 where codigo = 'qualificado';

create table if not exists public.funil_etapas (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,

  nome       text not null check (length(btrim(nome)) between 2 and 40),
  ordem      int  not null check (ordem > 0),

  canonica   public.etapa_lead not null references public.etapas_funil(codigo),

  cor        text,
  ativa      boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (tenant_id, nome)
);

create index if not exists funil_etapas_tenant_idx
  on public.funil_etapas (tenant_id, ordem) where ativa;

drop trigger if exists set_updated_at on public.funil_etapas;
create trigger set_updated_at before update on public.funil_etapas
  for each row execute function public.tg_set_updated_at();

comment on table public.funil_etapas is
  'O funil como a empresa o desenha. `canonica` amarra cada etapa própria a '
  'uma etapa do método — é o que permite processo livre com diagnóstico comparável.';

comment on column public.funil_etapas.canonica is
  'A que etapa do método esta corresponde. "Visita técnica" conta como '
  'reuniao; "Medição" conta como proposta. O quadro mostra o nome da empresa, '
  'o diagnóstico lê este campo.';

alter table public.funil_etapas enable row level security;

drop policy if exists funil_etapas_select on public.funil_etapas;
create policy funil_etapas_select on public.funil_etapas
  for select using (
    public.fn_tenant_tem_recurso(tenant_id, 'crm')
    and (
      public.is_tenant_member(tenant_id)
      or public.is_platform_staff()
      or public.is_consultor_de(tenant_id)
    )
  );

drop policy if exists funil_etapas_write on public.funil_etapas;
create policy funil_etapas_write on public.funil_etapas
  for all using (
    public.fn_tenant_tem_recurso(tenant_id, 'crm')
    and (
      public.can_write_tenant(tenant_id)
      or public.is_platform_staff()
      or public.is_consultor_de(tenant_id)
    )
  ) with check (
    public.fn_tenant_tem_recurso(tenant_id, 'crm')
    and (
      public.can_write_tenant(tenant_id)
      or public.is_platform_staff()
      or public.is_consultor_de(tenant_id)
    )
  );

create or replace function public.fn_semear_funil(p_tenant_id uuid)
returns int
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_criadas int := 0;
begin
  if not (public.is_tenant_member(p_tenant_id)
          or public.is_platform_staff()
          or public.is_consultor_de(p_tenant_id)) then
    raise exception 'Sem permissão para esta empresa' using errcode = '42501';
  end if;

  if exists (select 1 from public.funil_etapas where tenant_id = p_tenant_id) then
    return 0;
  end if;

  insert into public.funil_etapas (tenant_id, nome, ordem, canonica)
  values
    (p_tenant_id, 'Novo',           10, 'novo'),
    (p_tenant_id, 'Contato feito',  20, 'contato'),
    (p_tenant_id, 'Reunião',        30, 'reuniao'),
    (p_tenant_id, 'Proposta',       40, 'proposta'),
    (p_tenant_id, 'Fechado',        50, 'ganho'),
    (p_tenant_id, 'Não fechou',     60, 'perdido');

  get diagnostics v_criadas = row_count;
  return v_criadas;
end;
$$;

comment on function public.fn_semear_funil(uuid) is
  'Cria o funil padrão da empresa na primeira abertura do CRM. Idempotente: '
  'nunca sobrescreve o que já foi ajustado.';

revoke all on function public.fn_semear_funil(uuid) from public;
grant execute on function public.fn_semear_funil(uuid) to authenticated;

alter table public.leads
  add column if not exists etapa_id uuid references public.funil_etapas(id) on delete restrict;

create index if not exists leads_etapa_id_idx on public.leads (etapa_id);

do $$
declare
  t record;
begin
  for t in
    select distinct tenant_id from public.leads
     where not exists (select 1 from public.funil_etapas f where f.tenant_id = leads.tenant_id)
  loop
    insert into public.funil_etapas (tenant_id, nome, ordem, canonica)
    values
      (t.tenant_id, 'Novo',           10, 'novo'),
      (t.tenant_id, 'Contato feito',  20, 'contato'),
      (t.tenant_id, 'Reunião',        30, 'reuniao'),
      (t.tenant_id, 'Proposta',       40, 'proposta'),
      (t.tenant_id, 'Fechado',        50, 'ganho'),
      (t.tenant_id, 'Não fechou',     60, 'perdido');
  end loop;
end $$;

update public.leads l
   set etapa_id = (
     select f.id from public.funil_etapas f
      where f.tenant_id = l.tenant_id
        and f.canonica = case when l.etapa = 'qualificado' then 'reuniao'::public.etapa_lead
                              else l.etapa end
      order by f.ordem
      limit 1
   )
 where l.etapa_id is null;

update public.leads set etapa = 'reuniao' where etapa = 'qualificado';

create or replace function public.tg_lead_canonica()
returns trigger language plpgsql
set search_path = public, pg_temp as $$
declare
  v_canonica public.etapa_lead;
begin
  if new.etapa_id is null then
    return new;
  end if;

  select f.canonica into v_canonica
    from public.funil_etapas f
   where f.id = new.etapa_id and f.tenant_id = new.tenant_id;

  if v_canonica is null then
    raise exception 'Etapa não pertence a esta empresa' using errcode = '23503';
  end if;

  new.etapa := v_canonica;
  return new;
end;
$$;

drop trigger if exists tg_a_lead_canonica on public.leads;
create trigger tg_a_lead_canonica
  before insert or update of etapa_id on public.leads
  for each row execute function public.tg_lead_canonica();

create or replace function public.tg_funil_tem_saida()
returns trigger language plpgsql
set search_path = public, pg_temp as $$
declare
  v_tenant uuid := coalesce(old.tenant_id, new.tenant_id);
begin
  if not exists (
    select 1 from public.funil_etapas
     where tenant_id = v_tenant and ativa and canonica = 'ganho'
  ) then
    raise exception 'O funil precisa de pelo menos uma etapa de fechamento'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.funil_etapas
     where tenant_id = v_tenant and ativa and canonica = 'perdido'
  ) then
    raise exception 'O funil precisa de pelo menos uma etapa de perda'
      using errcode = 'P0001';
  end if;

  return null;
end;
$$;

drop trigger if exists tg_funil_tem_saida on public.funil_etapas;
create constraint trigger tg_funil_tem_saida
  after update or delete on public.funil_etapas
  deferrable initially deferred
  for each row execute function public.tg_funil_tem_saida();

drop view if exists public.vw_funil_leads;

create view public.vw_funil_leads
with (security_invoker = on) as
select
  l.id,
  l.tenant_id,
  l.nome,
  l.telefone,
  l.email,
  l.etapa,
  l.etapa_id,
  fe.nome                      as etapa_rotulo,
  fe.ordem                     as etapa_ordem,
  ef.terminal                  as etapa_terminal,
  fe.canonica,
  l.valor_estimado,
  l.origem,
  l.origem_detalhe,
  l.utm_source,
  l.utm_campaign,
  l.entity_id,
  l.responsavel_nome,
  l.observacao,
  l.motivo_perda,
  l.created_at,
  l.fechado_em,
  (select max(m.em) from public.lead_movimentos m where m.lead_id = l.id) as ultimo_movimento,
  extract(day from now() - coalesce(
    (select max(m.em) from public.lead_movimentos m where m.lead_id = l.id),
    l.created_at))::int as dias_na_etapa,
  extract(day from coalesce(l.fechado_em, now()) - l.created_at)::int as dias_no_funil
from public.leads l
join public.funil_etapas fe on fe.id = l.etapa_id
join public.etapas_funil ef on ef.codigo = fe.canonica;

grant select on public.vw_funil_leads to authenticated;

drop view if exists public.vw_funil_etapas;

create view public.vw_funil_etapas
with (security_invoker = on) as
with permanencia as (
  select
    m.tenant_id,
    m.para as canonica,
    extract(epoch from coalesce(
      lead(m.em) over (partition by m.lead_id order by m.em),
      now()
    ) - m.em) / 86400.0 as dias
  from public.lead_movimentos m
)
select
  fe.id                    as etapa_id,
  fe.tenant_id,
  fe.nome                  as rotulo,
  fe.ordem,
  fe.canonica,
  ef.nome                  as canonica_nome,
  ef.terminal,
  fe.cor,
  (select count(*) from public.leads l where l.etapa_id = fe.id)              as agora,
  (select coalesce(sum(l.valor_estimado), 0) from public.leads l
    where l.etapa_id = fe.id)                                                 as valor_parado,
  (select round(avg(p.dias)::numeric, 1) from permanencia p
    where p.tenant_id = fe.tenant_id and p.canonica = fe.canonica)            as dias_medios
from public.funil_etapas fe
join public.etapas_funil ef on ef.codigo = fe.canonica
where fe.ativa;

comment on view public.vw_funil_etapas is
  'As colunas do quadro, como a empresa as desenhou. `canonica` viaja junto '
  'para a tela poder mostrar a que etapa do método cada uma corresponde.';

grant select on public.vw_funil_etapas to authenticated;

drop table if exists public.rotulos_funil;
