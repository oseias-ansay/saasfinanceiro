-- =====================================================================
-- 07_staff.sql — Perfil de staff da plataforma (Business Triage)
-- Rode DEPOIS de 01 a 06.
-- =====================================================================
-- Cria o conceito de "equipe da plataforma": quem administra as empresas
-- clientes sem precisar do SQL Editor.
--
-- DECISÃO DELIBERADA DE ESCOPO:
-- O staff enxerga e gerencia EMPRESAS e USUÁRIOS — não os dados financeiros.
-- Para ver lançamentos, DRE ou fluxo de caixa de um cliente, o staff precisa
-- ser adicionado como membro daquela empresa (normalmente 'viewer'). Isso
-- é privilégio mínimo e, principalmente, deixa rastro: existe uma linha em
-- `memberships` dizendo quem tem acesso a quê, que o cliente pode auditar.
--
-- Um staff com acesso irrestrito a todo dado financeiro seria mais cômodo e
-- muito pior — nem você conseguiria provar, em caso de disputa, quem olhou o
-- quê e quando.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. MARCAÇÃO
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists is_staff boolean not null default false;

comment on column public.profiles.is_staff is
  'Equipe da Business Triage. Alterável apenas via SQL/service_role (ver gatilho profiles_protege_staff).';

create index if not exists profiles_staff_idx on public.profiles (id) where is_staff;

-- ---------------------------------------------------------------------
-- 2. FUNÇÃO AUXILIAR
-- ---------------------------------------------------------------------
create or replace function public.is_platform_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select p.is_staff from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

revoke all on function public.is_platform_staff() from public;
grant execute on function public.is_platform_staff() to authenticated;

-- ---------------------------------------------------------------------
-- 3. POLICIES — apenas tenants, memberships e profiles
-- ---------------------------------------------------------------------

-- 3.1 TENANTS
drop policy if exists tenants_select on public.tenants;
create policy tenants_select on public.tenants
  for select to authenticated
  using (public.is_tenant_member(id) or public.is_platform_staff());

drop policy if exists tenants_insert on public.tenants;
create policy tenants_insert on public.tenants
  for insert to authenticated
  with check (created_by = auth.uid() or public.is_platform_staff());

drop policy if exists tenants_update on public.tenants;
create policy tenants_update on public.tenants
  for update to authenticated
  using (public.is_tenant_admin(id) or public.is_platform_staff())
  with check (public.is_tenant_admin(id) or public.is_platform_staff());

-- Exclusão continua exclusiva do proprietário. Apagar empresa apaga em
-- cascata todo o financeiro — não é operação de suporte.

-- 3.2 MEMBERSHIPS
drop policy if exists memberships_select on public.memberships;
create policy memberships_select on public.memberships
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_tenant_member(tenant_id)
    or public.is_platform_staff()
  );

drop policy if exists memberships_insert on public.memberships;
create policy memberships_insert on public.memberships
  for insert to authenticated
  with check (public.is_tenant_admin(tenant_id) or public.is_platform_staff());

drop policy if exists memberships_update on public.memberships;
create policy memberships_update on public.memberships
  for update to authenticated
  using (public.is_tenant_admin(tenant_id) or public.is_platform_staff())
  with check (public.is_tenant_admin(tenant_id) or public.is_platform_staff());

-- 3.3 PROFILES — staff precisa localizar usuários pelo e-mail
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.is_platform_staff()
    or exists (
      select 1 from public.memberships m
       where m.user_id = public.profiles.id
         and m.tenant_id in (select public.auth_tenant_ids())
    )
  );

-- 3.4 PROTEÇÃO CONTRA AUTOPROMOÇÃO
--
-- A policy de UPDATE continua sendo a original (id = auth.uid()), o que por
-- si só permitiria alguém marcar o próprio is_staff como true. O bloqueio é
-- feito por gatilho, e não dentro da policy, por dois motivos: uma subconsulta
-- na própria tabela dentro do WITH CHECK é candidata a recursão sob RLS, e o
-- gatilho vale para qualquer caminho de escrita, inclusive service_role
-- passando pela API.
create or replace function public.tg_profiles_protege_staff()
returns trigger
language plpgsql
as $$
begin
  if new.is_staff is distinct from old.is_staff
     and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'is_staff só pode ser alterado pela administração do banco';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protege_staff on public.profiles;
create trigger profiles_protege_staff
  before update on public.profiles
  for each row execute function public.tg_profiles_protege_staff();

-- ---------------------------------------------------------------------
-- 4. SEED DE CATEGORIAS — permitir staff e service_role
-- ---------------------------------------------------------------------
-- Ao criar uma empresa pelo painel de staff, quem chama não é admin dela
-- ainda. Sem isso, a criação falharia no último passo.
create or replace function public.fn_seed_default_categories(p_tenant_id uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_count int;
begin
  if not (
    public.is_tenant_admin(p_tenant_id)
    or public.is_platform_staff()
    or current_user = 'service_role'
  ) then
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
-- 5. VISÃO DA CARTEIRA (para o painel de staff)
-- ---------------------------------------------------------------------
-- Só contagens e datas — nenhum valor financeiro. Coerente com a decisão
-- de escopo: o staff administra, não audita o caixa dos clientes.
create or replace view public.vw_staff_tenants
with (security_invoker = on) as
select
  t.id,
  t.name,
  t.tax_id,
  t.is_active,
  t.created_at,
  (select count(*) from public.memberships m
    where m.tenant_id = t.id and m.is_active)            as qtd_usuarios,
  (select count(*) from public.transactions x
    where x.tenant_id = t.id)                            as qtd_lancamentos,
  (select max(x.created_at) from public.transactions x
    where x.tenant_id = t.id)                            as ultimo_lancamento
from public.tenants t;

comment on view public.vw_staff_tenants is
  'Carteira de clientes para o painel de staff. Sem valores financeiros.';

grant select on public.vw_staff_tenants to authenticated;

-- ---------------------------------------------------------------------
-- 6. PROMOVER O PRIMEIRO STAFF
-- ---------------------------------------------------------------------
-- Troque o e-mail e rode. Esta é a ÚNICA forma de criar um staff:
-- não existe caminho pela aplicação, de propósito.
--
--   update public.profiles set is_staff = true
--    where lower(email) = lower('seu-email@dominio.com');
--
-- Conferir depois:
--   select email, is_staff from public.profiles where is_staff;
