create table if not exists public.recursos (
  codigo    text primary key,
  nome      text not null,
  descricao text,
  ordem     int  not null default 0
);

insert into public.recursos (codigo, nome, descricao, ordem) values
  ('financeiro', 'Controle Financeiro',
   'Lançamentos, contas, extrato e DRE.', 10),
  ('diagnostico_manual', 'Diagnóstico avulso',
   'O formulário preenchido pelo consultor, com relatório em PDF.', 20),
  ('diagnostico_mensal', 'Diagnóstico mensal e curva',
   'Score calculado a partir dos lançamentos, mês a mês, com a evolução.', 30),
  ('pdca_financeiro', 'PDCA financeiro',
   'Plano de ação financeiro com acompanhamento do consultor.', 40),
  ('pdca_comercial', 'PDCA comercial',
   'Plano de ação comercial com acompanhamento do consultor.', 50),
  ('crm', 'CRM',
   'Funil rastreável, integrado à mídia paga.', 60)
on conflict (codigo) do update set
  nome = excluded.nome, descricao = excluded.descricao, ordem = excluded.ordem;

create table if not exists public.planos (
  codigo      text primary key,
  nome        text not null,
  descricao   text,
  ordem       int  not null,
  ofertavel   boolean not null default true,
  created_at  timestamptz not null default now()
);

insert into public.planos (codigo, nome, descricao, ordem, ofertavel) values
  ('gratuito', 'Gratuito',
   'Controle Financeiro completo e um diagnóstico avulso. Sem acompanhamento.', 10, true),
  ('basico', 'Básico',
   'Diagnóstico mensal, curva de evolução e PDCA financeiro com o consultor.', 20, true),
  ('intermediario', 'Intermediário',
   'Tudo do Básico, mais o PDCA comercial.', 30, true),
  ('premium', 'Premium',
   'Tudo do Intermediário, mais o CRM rastreável.', 40, false)
on conflict (codigo) do update set
  nome = excluded.nome, descricao = excluded.descricao, ordem = excluded.ordem;

comment on column public.planos.ofertavel is
  'Falso esconde o plano das telas de venda sem afetar quem já o tem. '
  'O Premium nasce assim: existe e funciona, mas não é oferecido a todos.';

create table if not exists public.plano_recursos (
  plano   text not null references public.planos(codigo)  on delete cascade,
  recurso text not null references public.recursos(codigo) on delete cascade,
  primary key (plano, recurso)
);

delete from public.plano_recursos;

insert into public.plano_recursos (plano, recurso) values
  ('gratuito',      'financeiro'),
  ('gratuito',      'diagnostico_manual'),

  ('basico',        'financeiro'),
  ('basico',        'diagnostico_manual'),
  ('basico',        'diagnostico_mensal'),
  ('basico',        'pdca_financeiro'),

  ('intermediario', 'financeiro'),
  ('intermediario', 'diagnostico_manual'),
  ('intermediario', 'diagnostico_mensal'),
  ('intermediario', 'pdca_financeiro'),
  ('intermediario', 'pdca_comercial'),

  ('premium',       'financeiro'),
  ('premium',       'diagnostico_manual'),
  ('premium',       'diagnostico_mensal'),
  ('premium',       'pdca_financeiro'),
  ('premium',       'pdca_comercial'),
  ('premium',       'crm');

grant select on public.planos, public.recursos, public.plano_recursos to authenticated, anon;

drop view if exists public.vw_situacao_mensal;

alter table public.tenants add column if not exists plano_codigo text;

update public.tenants
   set plano_codigo = case
         when plano::text = 'gratuito' then 'gratuito'
         else 'basico'
       end
 where plano_codigo is null;

alter table public.tenants drop column if exists plano;
alter table public.tenants rename column plano_codigo to plano;

alter table public.tenants
  alter column plano set default 'basico',
  alter column plano set not null;

alter table public.tenants
  drop constraint if exists tenants_plano_fkey;
alter table public.tenants
  add constraint tenants_plano_fkey foreign key (plano)
  references public.planos(codigo);

drop type if exists public.plano_tenant;

alter table public.tenants
  add column if not exists recursos_extras text[] not null default '{}';

comment on column public.tenants.plano is
  'O que a empresa contratou. Para acesso, use fn_tenant_tem_recurso: '
  'ela soma o plano com as liberações extras.';

comment on column public.tenants.recursos_extras is
  'Recursos liberados FORA do plano contratado — piloto, cortesia, '
  'período de teste. Existe para não precisar mentir o plano de quem está '
  'testando algo, o que corromperia a leitura de adoção por plano.';

create or replace function public.fn_tenant_tem_recurso(
  p_tenant_id uuid,
  p_recurso   text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select coalesce((
    select p_recurso = any(t.recursos_extras)
        or exists (
             select 1 from public.plano_recursos pr
              where pr.plano = t.plano and pr.recurso = p_recurso
           )
      from public.tenants t
     where t.id = p_tenant_id and t.is_active
  ), false)
$fn$;

comment on function public.fn_tenant_tem_recurso(uuid, text) is
  'A empresa tem acesso a este recurso? Soma o plano contratado com as '
  'liberações extras. Empresa arquivada não tem recurso nenhum.';

revoke all on function public.fn_tenant_tem_recurso(uuid, text) from public;
grant execute on function public.fn_tenant_tem_recurso(uuid, text) to authenticated;

create or replace view public.vw_meus_recursos
with (security_invoker = on) as
select
  t.id  as tenant_id,
  t.plano,
  pl.nome as plano_nome,
  pl.ordem as plano_ordem,
  t.plano_desde,
  array(
    select r.codigo
      from public.recursos r
     where r.codigo = any(t.recursos_extras)
        or exists (select 1 from public.plano_recursos pr
                    where pr.plano = t.plano and pr.recurso = r.codigo)
     order by r.ordem
  ) as recursos,
  t.recursos_extras
from public.tenants t
join public.planos pl on pl.codigo = t.plano
where t.is_active;

comment on view public.vw_meus_recursos is
  'Plano e lista efetiva de recursos da empresa. O RLS de tenants já '
  'limita as linhas ao que o usuário enxerga.';

grant select on public.vw_meus_recursos to authenticated;

create or replace function public.fn_fila_apuracao(p_competencia date)
returns table (tenant_id uuid, nome text, email_owner text)
language sql stable security definer
set search_path = public, pg_temp as $fn$
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
    and public.fn_tenant_tem_recurso(t.id, 'diagnostico_mensal')
    and (dm.status is null or dm.status = 'incompleto')
$fn$;

comment on function public.fn_fila_apuracao(date) is
  'Empresas a apurar numa competência. Reapura incompletos — o cliente pode '
  'ter lançado depois. Nunca reapura calculado: score emitido não muda.';

revoke all on function public.fn_fila_apuracao(date) from public;

create or replace view public.vw_situacao_mensal
with (security_invoker = on) as
with meses as (
  select
    t.id as tenant_id,
    t.name,
    t.consultoria_id,
    t.plano,
    (date_trunc('month', current_date) - (n || ' month')::interval)::date as competencia
  from public.tenants t
  cross join generate_series(1, 12) as n
  where t.is_active
    and public.fn_tenant_tem_recurso(t.id, 'diagnostico_mensal')
)
select
  m.tenant_id,
  m.name,
  m.consultoria_id,
  m.plano,
  m.competencia,
  coalesce(dm.status::text, 'nao_apurado') as status,
  dm.score_total,
  dm.nivel,
  dm.completude -> 'faltas' as faltas,
  (dm.completude ->> 'percentual')::numeric as completude_pct,
  dm.cobrado_em,
  sum(case when dm.status = 'calculado' then 1 else 0 end) over (
    partition by m.tenant_id order by m.competencia desc
    rows between unbounded preceding and current row
  ) as calculados_ate_aqui
from meses m
left join public.diagnosticos_mensais dm
       on dm.tenant_id = m.tenant_id and dm.competencia = m.competencia;

grant select on public.vw_situacao_mensal to authenticated;

alter table public.planos_acao
  add column if not exists tipo public.diagnostico_tipo not null default 'financeiro';

comment on column public.planos_acao.tipo is
  'Financeiro (Básico) ou comercial (Intermediário). Um plano ativo por '
  'empresa POR TIPO — os dois ciclos correm em paralelo, com reuniões '
  'e causas-raiz próprias.';

drop index if exists planos_acao_um_ativo_idx;
drop index if exists public.planos_acao_um_ativo_idx;

create unique index if not exists planos_acao_um_ativo_por_tipo_idx
  on public.planos_acao (tenant_id, tipo) where status = 'ativo';
