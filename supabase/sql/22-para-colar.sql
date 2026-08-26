do $$ begin
  create type public.plano_tenant as enum ('gratuito', 'assinante');
exception when duplicate_object then null; end $$;

alter table public.tenants
  add column if not exists plano public.plano_tenant not null default 'assinante';

alter table public.tenants
  add column if not exists plano_desde date;

comment on column public.tenants.plano is
  'gratuito = diagnóstico manual avulso. assinante = cálculo automático, '
  'curva e PDCA. Padrão assinante: quem já existe entrou por contrato.';

do $$ begin
  create type public.status_diagnostico_mensal as enum ('incompleto', 'calculado');
exception when duplicate_object then null; end $$;

create table if not exists public.diagnosticos_mensais (
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  competencia   date not null,

  status        public.status_diagnostico_mensal not null,

  score_total   int check (score_total between 0 and 100),
  nivel         text,
  regua_versao  text,
  entrada       jsonb not null default '{}'::jsonb,
  indicadores   jsonb not null default '{}'::jsonb,
  alertas       jsonb not null default '[]'::jsonb,

  completude    jsonb not null default '{}'::jsonb,

  cobrado_em    timestamptz,
  calculado_em  timestamptz not null default now(),

  primary key (tenant_id, competencia),
  constraint dm_competencia_dia1 check (extract(day from competencia) = 1),
  constraint dm_score_so_se_calculado check (
    (status = 'calculado'  and score_total is not null and regua_versao is not null)
    or
    (status = 'incompleto' and score_total is null)
  )
);

create index if not exists dm_incompletos_idx
  on public.diagnosticos_mensais (tenant_id, competencia)
  where status = 'incompleto';

comment on table public.diagnosticos_mensais is
  'Acompanhamento mensal do assinante. Separado de `diagnosticos` porque '
  'aquela tabela é o funil comercial — misturar corromperia o painel de validação.';

comment on column public.diagnosticos_mensais.cobrado_em is
  'Quando o e-mail de "faltam os dados de X" foi enviado. Sem isto, ou se '
  'cobra todo dia ou não se cobra nunca.';

alter table public.diagnosticos_mensais enable row level security;

drop policy if exists dm_select on public.diagnosticos_mensais;
create policy dm_select on public.diagnosticos_mensais
  for select using (
    public.is_tenant_member(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  );

drop policy if exists dm_write on public.diagnosticos_mensais;
create policy dm_write on public.diagnosticos_mensais
  for all using (public.is_platform_staff()) with check (public.is_platform_staff());

create or replace view public.vw_evolucao_score
with (security_invoker = on) as
with serie as (
  select
    m.tenant_id,
    m.tipo,
    m.assinado_em::timestamptz as em,
    m.score_total,
    m.nivel,
    m.regua_versao,
    true  as marco_zero,
    null::text as protocolo
  from public.marcos_zero m

  union all

  select
    d.tenant_id,
    d.tipo,
    d.created_at,
    d.score_total,
    d.nivel,
    d.regua_versao,
    false,
    d.protocolo
  from public.diagnosticos d
  where d.tenant_id is not null and d.score_total is not null

  union all

  select
    dm.tenant_id,
    'financeiro'::public.diagnostico_tipo,
    (dm.competencia + interval '1 month - 1 second')::timestamptz,
    dm.score_total,
    dm.nivel,
    dm.regua_versao,
    false,
    null::text
  from public.diagnosticos_mensais dm
  where dm.status = 'calculado'
)
select
  s.tenant_id,
  s.tipo,
  s.em,
  s.score_total,
  s.nivel,
  s.regua_versao,
  s.marco_zero,
  s.protocolo,
  s.score_total - first_value(s.score_total) over (
    partition by s.tenant_id, s.tipo order by s.marco_zero desc, s.em
  ) as variacao,
  min(s.regua_versao) over (partition by s.tenant_id, s.tipo)
    <> max(s.regua_versao) over (partition by s.tenant_id, s.tipo)
    as reguas_misturadas
from serie s;

comment on view public.vw_evolucao_score is
  'Curva do score por empresa: marco zero, diagnósticos avulsos e a série '
  'mensal do assinante. Ordene por (tipo, em).';

grant select on public.vw_evolucao_score to authenticated;

create or replace view public.vw_situacao_mensal
with (security_invoker = on) as
with meses as (
  select
    t.id as tenant_id,
    t.name,
    t.consultoria_id,
    (date_trunc('month', current_date) - (n || ' month')::interval)::date as competencia
  from public.tenants t
  cross join generate_series(1, 12) as n
  where t.is_active and t.plano = 'assinante'
)
select
  m.tenant_id,
  m.name,
  m.consultoria_id,
  m.competencia,
  coalesce(dm.status::text, 'nao_apurado') as status,
  dm.score_total,
  dm.nivel,
  dm.completude -> 'faltas'        as faltas,
  (dm.completude ->> 'percentual')::numeric as completude_pct,
  dm.cobrado_em,
  sum(case when dm.status = 'calculado' then 1 else 0 end) over (
    partition by m.tenant_id order by m.competencia desc
    rows between unbounded preceding and current row
  ) as calculados_ate_aqui
from meses m
left join public.diagnosticos_mensais dm
       on dm.tenant_id = m.tenant_id and dm.competencia = m.competencia;

comment on view public.vw_situacao_mensal is
  'Últimos 12 meses de cada assinante. `calculados_ate_aqui = 0` numa linha '
  'significa que dali para o mês corrente nenhum mês fechou.';

grant select on public.vw_situacao_mensal to authenticated;

create or replace function public.fn_fila_apuracao(p_competencia date)
returns table (tenant_id uuid, nome text, email_owner text)
language sql stable security definer
set search_path = public, pg_temp as $$
  select
    t.id,
    t.name,
    (
      select p.email
        from public.memberships mb
        join public.profiles p on p.id = mb.user_id
       where mb.tenant_id = t.id and mb.is_active and mb.role = 'owner'
       order by mb.created_at
       limit 1
    )
  from public.tenants t
  left join public.diagnosticos_mensais dm
         on dm.tenant_id = t.id and dm.competencia = p_competencia
  where t.is_active
    and t.plano = 'assinante'
    and (dm.status is null or dm.status = 'incompleto');
$$;

comment on function public.fn_fila_apuracao(date) is
  'Empresas a apurar numa competência. Reapura incompletos — o cliente pode '
  'ter lançado depois. Nunca reapura calculado: score emitido não muda.';

revoke all on function public.fn_fila_apuracao(date) from public;
