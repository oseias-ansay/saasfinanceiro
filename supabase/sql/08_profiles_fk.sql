-- =====================================================================
-- 08_profiles_fk.sql — Relação memberships -> profiles
-- =====================================================================
-- Problema que este script resolve:
--
-- `memberships.user_id` referencia `auth.users(id)`. O PostgREST só permite
-- embutir tabelas relacionadas quando existe uma FOREIGN KEY declarada entre
-- elas — e não havia nenhuma entre `memberships` e `public.profiles`.
--
-- Resultado: a consulta da tela de Usuários
--     .select('user_id, role, profiles(email, full_name)')
-- falhava com PGRST200 ("could not find a relationship"), e a lista vinha
-- vazia mesmo havendo membros.
--
-- A solução é declarar a segunda FK. Ela é redundante do ponto de vista de
-- integridade (profiles.id já aponta para auth.users), mas é o que dá ao
-- PostgREST o caminho para fazer o join.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. BACKFILL — todo usuário precisa ter perfil antes da FK existir
-- ---------------------------------------------------------------------
-- O trigger on_auth_user_created só cobre cadastros feitos DEPOIS do
-- 02_rls.sql. Quem veio antes (ou foi criado pela API admin) pode não ter
-- linha em profiles — e aí a FK falharia na criação.
insert into public.profiles (id, email, full_name)
select u.id, u.email, u.raw_user_meta_data->>'full_name'
from auth.users u
on conflict (id) do update
  set email = coalesce(excluded.email, public.profiles.email);

-- ---------------------------------------------------------------------
-- 2. A CHAVE ESTRANGEIRA
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'memberships_user_id_profiles_fkey'
  ) then
    alter table public.memberships
      add constraint memberships_user_id_profiles_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. CONFERÊNCIA
-- ---------------------------------------------------------------------
-- Deve listar uma linha por membro, com o e-mail preenchido:
--
--   select m.role, m.is_active, p.email, t.name
--   from public.memberships m
--   join public.profiles p on p.id = m.user_id
--   join public.tenants  t on t.id = m.tenant_id;
--
-- Depois de rodar, o PostgREST precisa recarregar o cache de schema.
-- Ele faz isso sozinho em alguns segundos; para forçar:
--
--   notify pgrst, 'reload schema';
notify pgrst, 'reload schema';
