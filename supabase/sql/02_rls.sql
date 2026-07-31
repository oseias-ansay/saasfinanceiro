-- =====================================================================
-- 02_rls.sql — Row Level Security (multi-tenancy)
-- =====================================================================
-- Princípio: NENHUMA policy faz subquery direta em memberships (isso causa
-- recursão infinita quando memberships também tem RLS). Todas usam funções
-- SECURITY DEFINER, que rodam com o owner do schema e ignoram RLS.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. FUNÇÕES AUXILIARES
-- ---------------------------------------------------------------------
create or replace function public.auth_tenant_ids()
returns setof uuid language sql stable security definer
set search_path = public, pg_temp as $$
  select m.tenant_id from public.memberships m
   where m.user_id = auth.uid() and m.is_active;
$$;

create or replace function public.is_tenant_member(p_tenant_id uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.memberships m
     where m.tenant_id = p_tenant_id and m.user_id = auth.uid() and m.is_active
  );
$$;

create or replace function public.is_tenant_admin(p_tenant_id uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.memberships m
     where m.tenant_id = p_tenant_id and m.user_id = auth.uid()
       and m.is_active and m.role in ('owner','admin')
  );
$$;

-- viewer é somente leitura
create or replace function public.can_write_tenant(p_tenant_id uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.memberships m
     where m.tenant_id = p_tenant_id and m.user_id = auth.uid()
       and m.is_active and m.role in ('owner','admin','member')
  );
$$;

revoke all on function public.auth_tenant_ids()        from public;
revoke all on function public.is_tenant_member(uuid)   from public;
revoke all on function public.is_tenant_admin(uuid)    from public;
revoke all on function public.can_write_tenant(uuid)   from public;
grant execute on function public.auth_tenant_ids()      to authenticated;
grant execute on function public.is_tenant_member(uuid) to authenticated;
grant execute on function public.is_tenant_admin(uuid)  to authenticated;
grant execute on function public.can_write_tenant(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2. BOOTSTRAP
-- ---------------------------------------------------------------------
create or replace function public.tg_tenant_after_insert()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_user uuid := coalesce(new.created_by, auth.uid());
begin
  -- Sem usuário no contexto (seed via SQL Editor/service_role): não cria vínculo.
  if v_user is null then
    return new;
  end if;

  insert into public.memberships (tenant_id, user_id, role)
  values (new.id, v_user, 'owner')
  on conflict (tenant_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists tenant_bootstrap_owner on public.tenants;
create trigger tenant_bootstrap_owner after insert on public.tenants
  for each row execute function public.tg_tenant_after_insert();

create or replace function public.tg_handle_new_user()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.tg_handle_new_user();

-- ---------------------------------------------------------------------
-- 3. HABILITAR RLS
-- ---------------------------------------------------------------------
alter table public.tenants             enable row level security;
alter table public.profiles            enable row level security;
alter table public.memberships         enable row level security;
alter table public.bank_accounts       enable row level security;
alter table public.categories          enable row level security;
alter table public.cost_centers        enable row level security;
alter table public.entities            enable row level security;
alter table public.recurring_templates enable row level security;
alter table public.transactions        enable row level security;
alter table public.attachments         enable row level security;
alter table public.audit_log           enable row level security;

alter table public.transactions force row level security;
alter table public.memberships  force row level security;

-- ---------------------------------------------------------------------
-- 4. POLICIES
-- ---------------------------------------------------------------------

-- 4.1 TENANTS
drop policy if exists tenants_select on public.tenants;
create policy tenants_select on public.tenants
  for select to authenticated using (public.is_tenant_member(id));

drop policy if exists tenants_insert on public.tenants;
create policy tenants_insert on public.tenants
  for insert to authenticated with check (created_by = auth.uid());

drop policy if exists tenants_update on public.tenants;
create policy tenants_update on public.tenants
  for update to authenticated
  using (public.is_tenant_admin(id)) with check (public.is_tenant_admin(id));

drop policy if exists tenants_delete on public.tenants;
create policy tenants_delete on public.tenants
  for delete to authenticated
  using (exists (select 1 from public.memberships m
                  where m.tenant_id = tenants.id and m.user_id = auth.uid()
                    and m.role = 'owner' and m.is_active));

-- 4.2 PROFILES
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1 from public.memberships m
       where m.user_id = public.profiles.id
         and m.tenant_id in (select public.auth_tenant_ids())
    )
  );

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- 4.3 MEMBERSHIPS
drop policy if exists memberships_select on public.memberships;
create policy memberships_select on public.memberships
  for select to authenticated
  using (user_id = auth.uid() or public.is_tenant_member(tenant_id));

drop policy if exists memberships_insert on public.memberships;
create policy memberships_insert on public.memberships
  for insert to authenticated with check (public.is_tenant_admin(tenant_id));

drop policy if exists memberships_update on public.memberships;
create policy memberships_update on public.memberships
  for update to authenticated
  using (public.is_tenant_admin(tenant_id)) with check (public.is_tenant_admin(tenant_id));

drop policy if exists memberships_delete on public.memberships;
create policy memberships_delete on public.memberships
  for delete to authenticated
  using (public.is_tenant_admin(tenant_id) and role <> 'owner');

-- 4.4 CADASTROS — leitura: membro | escrita: member+ | exclusão: admin
do $$
declare t text;
begin
  foreach t in array array['bank_accounts','categories','cost_centers','entities','recurring_templates']
  loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format($f$
      create policy %I_select on public.%I for select to authenticated
        using (public.is_tenant_member(tenant_id));
    $f$, t, t);

    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format($f$
      create policy %I_insert on public.%I for insert to authenticated
        with check (public.can_write_tenant(tenant_id));
    $f$, t, t);

    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format($f$
      create policy %I_update on public.%I for update to authenticated
        using (public.can_write_tenant(tenant_id))
        with check (public.can_write_tenant(tenant_id));
    $f$, t, t);

    execute format('drop policy if exists %I_delete on public.%I', t, t);
    execute format($f$
      create policy %I_delete on public.%I for delete to authenticated
        using (public.is_tenant_admin(tenant_id));
    $f$, t, t);
  end loop;
end $$;

-- 4.5 TRANSACTIONS
drop policy if exists transactions_select on public.transactions;
create policy transactions_select on public.transactions
  for select to authenticated using (public.is_tenant_member(tenant_id));

drop policy if exists transactions_insert on public.transactions;
create policy transactions_insert on public.transactions
  for insert to authenticated with check (public.can_write_tenant(tenant_id));

drop policy if exists transactions_update on public.transactions;
create policy transactions_update on public.transactions
  for update to authenticated
  using (public.can_write_tenant(tenant_id)) with check (public.can_write_tenant(tenant_id));

drop policy if exists transactions_delete on public.transactions;
create policy transactions_delete on public.transactions
  for delete to authenticated using (public.can_write_tenant(tenant_id));

-- 4.6 ATTACHMENTS
drop policy if exists attachments_select on public.attachments;
create policy attachments_select on public.attachments
  for select to authenticated using (public.is_tenant_member(tenant_id));

drop policy if exists attachments_insert on public.attachments;
create policy attachments_insert on public.attachments
  for insert to authenticated
  with check (public.can_write_tenant(tenant_id) and uploaded_by = auth.uid());

drop policy if exists attachments_delete on public.attachments;
create policy attachments_delete on public.attachments
  for delete to authenticated using (public.can_write_tenant(tenant_id));

-- 4.7 AUDIT_LOG (insert só via service_role)
drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log
  for select to authenticated using (public.is_tenant_admin(tenant_id));

-- ---------------------------------------------------------------------
-- 5. STORAGE — bucket de comprovantes
-- ---------------------------------------------------------------------
-- Convenção de path: {tenant_id}/{transaction_id}/{arquivo}
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comprovantes', 'comprovantes', false, 20971520,
        array['application/pdf','image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

drop policy if exists comprovantes_select on storage.objects;
create policy comprovantes_select on storage.objects
  for select to authenticated
  using (bucket_id = 'comprovantes'
         and public.is_tenant_member(((storage.foldername(name))[1])::uuid));

drop policy if exists comprovantes_insert on storage.objects;
create policy comprovantes_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'comprovantes'
              and public.can_write_tenant(((storage.foldername(name))[1])::uuid));

drop policy if exists comprovantes_delete on storage.objects;
create policy comprovantes_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'comprovantes'
         and public.can_write_tenant(((storage.foldername(name))[1])::uuid));

-- ---------------------------------------------------------------------
-- 6. GRANTS
-- ---------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
