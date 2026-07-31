-- =====================================================================
-- SaaS Financeiro para EPPs — MVP
-- 01_schema.sql — extensões, ENUMs, tabelas, índices, triggers
-- =====================================================================
-- Ordem: 01_schema -> 02_rls -> 03_functions -> 04_views -> 06_notifications
-- (05_smoke_test é opcional, só para validar)
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 1. ENUMS
-- ---------------------------------------------------------------------
do $$ begin
  create type public.transaction_type as enum ('receita', 'despesa');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.transaction_status as enum ('pendente', 'liquidado', 'cancelado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.schedule_type as enum ('avista', 'parcelado', 'recorrente');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.recurrence_frequency as enum (
    'diaria', 'semanal', 'quinzenal', 'mensal',
    'bimestral', 'trimestral', 'semestral', 'anual'
  );
exception when duplicate_object then null; end $$;

-- Classificação gerencial: define a linha do DRE
do $$ begin
  create type public.dre_group as enum (
    'receita_bruta', 'deducao', 'custo_variavel',
    'despesa_fixa', 'outras_receitas', 'outras_despesas'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.member_role as enum ('owner', 'admin', 'member', 'viewer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.entity_type as enum ('cliente', 'fornecedor', 'ambos');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 2. TRIGGER GENÉRICO DE updated_at
-- ---------------------------------------------------------------------
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. TABELAS
-- ---------------------------------------------------------------------

-- 3.1 TENANTS — cada linha é uma empresa (EPP)
create table if not exists public.tenants (
  id                uuid primary key default gen_random_uuid(),
  name              text not null check (length(btrim(name)) between 2 and 120),
  legal_name        text,
  tax_id            text,
  timezone          text not null default 'America/Sao_Paulo',
  currency          char(3) not null default 'BRL',
  fiscal_regime     text,
  is_active         boolean not null default true,
  created_by        uuid default auth.uid() references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint tenants_tax_id_digits check (tax_id is null or tax_id ~ '^[0-9]{11,14}$')
);
create unique index if not exists tenants_tax_id_uidx
  on public.tenants (tax_id) where tax_id is not null;

drop trigger if exists set_updated_at on public.tenants;
create trigger set_updated_at before update on public.tenants
  for each row execute function public.tg_set_updated_at();

-- 3.2 PROFILES — espelho de auth.users
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text,
  email         text,
  avatar_url    text,
  phone         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists set_updated_at on public.profiles;
create trigger set_updated_at before update on public.profiles
  for each row execute function public.tg_set_updated_at();

-- 3.3 MEMBERSHIPS — vínculo N:N usuário <-> empresa (base do multi-tenancy)
create table if not exists public.memberships (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  role          public.member_role not null default 'member',
  is_active     boolean not null default true,
  invited_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, user_id)
);
create index if not exists memberships_user_idx on public.memberships (user_id) where is_active;
create index if not exists memberships_tenant_idx on public.memberships (tenant_id);

drop trigger if exists set_updated_at on public.memberships;
create trigger set_updated_at before update on public.memberships
  for each row execute function public.tg_set_updated_at();

-- 3.4 BANK_ACCOUNTS — fornecem o SALDO INICIAL do fluxo de caixa
create table if not exists public.bank_accounts (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  name                  text not null,
  bank_code             text,
  agency                text,
  account_number        text,
  opening_balance       numeric(14,2) not null default 0,
  opening_balance_date  date not null default current_date,
  is_default            boolean not null default false,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (tenant_id, name)
);
create unique index if not exists bank_accounts_one_default_uidx
  on public.bank_accounts (tenant_id) where is_default;

drop trigger if exists set_updated_at on public.bank_accounts;
create trigger set_updated_at before update on public.bank_accounts
  for each row execute function public.tg_set_updated_at();

-- 3.5 CATEGORIES — plano de contas gerencial (define a linha do DRE)
create table if not exists public.categories (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  parent_id     uuid references public.categories(id) on delete set null,
  name          text not null,
  type          public.transaction_type not null,
  dre_group     public.dre_group not null,
  color         text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, name, type),
  constraint categories_type_group_ck check (
    (type = 'receita' and dre_group in ('receita_bruta','outras_receitas'))
    or
    (type = 'despesa' and dre_group in ('deducao','custo_variavel','despesa_fixa','outras_despesas'))
  )
);
create index if not exists categories_tenant_idx on public.categories (tenant_id, type) where is_active;

drop trigger if exists set_updated_at on public.categories;
create trigger set_updated_at before update on public.categories
  for each row execute function public.tg_set_updated_at();

-- 3.6 COST_CENTERS
create table if not exists public.cost_centers (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  name          text not null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, name)
);

drop trigger if exists set_updated_at on public.cost_centers;
create trigger set_updated_at before update on public.cost_centers
  for each row execute function public.tg_set_updated_at();

-- 3.7 ENTITIES — clientes e fornecedores
create table if not exists public.entities (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  name          text not null,
  kind          public.entity_type not null default 'cliente',
  tax_id        text,
  email         text,
  phone         text,
  notes         text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, name, kind),
  constraint entities_tax_id_digits check (tax_id is null or tax_id ~ '^[0-9]{11,14}$')
);
create index if not exists entities_tenant_kind_idx on public.entities (tenant_id, kind) where is_active;
create index if not exists entities_name_idx on public.entities (tenant_id, lower(name));

drop trigger if exists set_updated_at on public.entities;
create trigger set_updated_at before update on public.entities
  for each row execute function public.tg_set_updated_at();

-- 3.8 RECURRING_TEMPLATES — molde das recorrências
create table if not exists public.recurring_templates (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  type                public.transaction_type not null,
  description         text not null,
  amount              numeric(14,2) not null check (amount > 0),
  category_id         uuid references public.categories(id) on delete restrict,
  cost_center_id      uuid references public.cost_centers(id) on delete set null,
  entity_id           uuid references public.entities(id) on delete set null,
  bank_account_id     uuid references public.bank_accounts(id) on delete set null,
  frequency           public.recurrence_frequency not null default 'mensal',
  interval_count      int not null default 1 check (interval_count between 1 and 24),
  day_of_month        int check (day_of_month between 1 and 31),
  start_date          date not null,
  end_date            date,
  max_occurrences     int check (max_occurrences > 0),
  generate_ahead_days int not null default 60 check (generate_ahead_days between 1 and 365),
  next_due_date       date not null,
  occurrences_created int not null default 0,
  last_generated_at   timestamptz,
  is_active           boolean not null default true,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint recurring_period_ck check (end_date is null or end_date >= start_date)
);
create index if not exists recurring_due_idx
  on public.recurring_templates (next_due_date) where is_active;
create index if not exists recurring_tenant_idx on public.recurring_templates (tenant_id);

drop trigger if exists set_updated_at on public.recurring_templates;
create trigger set_updated_at before update on public.recurring_templates
  for each row execute function public.tg_set_updated_at();

-- 3.9 TRANSACTIONS — tabela central. 1 linha = 1 parcela/vencimento.
--     competence_date -> COMPETÊNCIA (DRE)
--     due_date        -> contas a pagar/receber e projeção
--     paid_date       -> CAIXA (fluxo realizado)
create table if not exists public.transactions (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,

  type                  public.transaction_type not null,
  description           text not null check (length(btrim(description)) > 0),
  amount                numeric(14,2) not null check (amount > 0),
  status                public.transaction_status not null default 'pendente',

  competence_date       date not null,
  due_date              date not null,
  paid_date             date,
  paid_amount           numeric(14,2) check (paid_amount is null or paid_amount >= 0),

  category_id           uuid references public.categories(id) on delete restrict,
  cost_center_id        uuid references public.cost_centers(id) on delete set null,
  entity_id             uuid references public.entities(id) on delete set null,
  bank_account_id       uuid references public.bank_accounts(id) on delete set null,

  schedule_type         public.schedule_type not null default 'avista',
  parent_id             uuid references public.transactions(id) on delete cascade,
  installment_number    int check (installment_number >= 1),
  installment_total     int check (installment_total >= 1),
  recurring_template_id uuid references public.recurring_templates(id) on delete set null,

  document_number       text,
  notes                 text,
  created_by            uuid default auth.uid() references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint tx_liquidado_ck check (
    (status = 'liquidado' and paid_date is not null and paid_amount is not null)
    or
    (status <> 'liquidado' and paid_date is null and paid_amount is null)
  ),
  constraint tx_installment_ck check (
    (schedule_type = 'parcelado'
       and installment_number is not null
       and installment_total is not null
       and installment_number <= installment_total)
    or
    (schedule_type <> 'parcelado'
       and installment_number is null
       and installment_total is null)
  ),
  constraint tx_recurring_ck check (
    schedule_type = 'recorrente' or recurring_template_id is null
  )
);

-- Índices que sustentam as telas do MVP
create index if not exists tx_tenant_due_idx
  on public.transactions (tenant_id, type, due_date) where status = 'pendente';
create index if not exists tx_tenant_paid_idx
  on public.transactions (tenant_id, paid_date) where status = 'liquidado';
create index if not exists tx_tenant_competence_idx
  on public.transactions (tenant_id, competence_date);
create index if not exists tx_category_idx   on public.transactions (tenant_id, category_id);
create index if not exists tx_entity_idx     on public.transactions (tenant_id, entity_id);
create index if not exists tx_parent_idx     on public.transactions (parent_id) where parent_id is not null;
create index if not exists tx_template_idx   on public.transactions (recurring_template_id)
  where recurring_template_id is not null;

-- Idempotência do job de recorrências (índice PARCIAL — ver ON CONFLICT no 03)
create unique index if not exists tx_recurring_occurrence_uidx
  on public.transactions (recurring_template_id, due_date)
  where recurring_template_id is not null;

drop trigger if exists set_updated_at on public.transactions;
create trigger set_updated_at before update on public.transactions
  for each row execute function public.tg_set_updated_at();

-- Garante que categoria, entidade e conta pertencem AO MESMO tenant
create or replace function public.tg_transactions_validate()
returns trigger language plpgsql as $$
declare v_cat_type public.transaction_type;
begin
  if new.category_id is not null then
    select type into v_cat_type
      from public.categories
     where id = new.category_id and tenant_id = new.tenant_id;
    if not found then
      raise exception 'Categoria % não pertence ao tenant %', new.category_id, new.tenant_id;
    end if;
    if v_cat_type <> new.type then
      raise exception 'Categoria é de natureza % mas o lançamento é %', v_cat_type, new.type;
    end if;
  end if;

  if new.entity_id is not null
     and not exists (select 1 from public.entities
                      where id = new.entity_id and tenant_id = new.tenant_id) then
    raise exception 'Entidade % não pertence ao tenant %', new.entity_id, new.tenant_id;
  end if;

  if new.bank_account_id is not null
     and not exists (select 1 from public.bank_accounts
                      where id = new.bank_account_id and tenant_id = new.tenant_id) then
    raise exception 'Conta bancária % não pertence ao tenant %', new.bank_account_id, new.tenant_id;
  end if;

  if new.cost_center_id is not null
     and not exists (select 1 from public.cost_centers
                      where id = new.cost_center_id and tenant_id = new.tenant_id) then
    raise exception 'Centro de custo % não pertence ao tenant %', new.cost_center_id, new.tenant_id;
  end if;

  return new;
end;
$$;

drop trigger if exists tx_validate on public.transactions;
create trigger tx_validate before insert or update on public.transactions
  for each row execute function public.tg_transactions_validate();

-- 3.10 ATTACHMENTS — comprovantes no Storage (bucket 'comprovantes')
create table if not exists public.attachments (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  storage_path   text not null unique,   -- {tenant_id}/{transaction_id}/{uuid}.pdf
  file_name      text not null,
  mime_type      text,
  size_bytes     bigint check (size_bytes is null or size_bytes <= 20971520),
  uploaded_by    uuid default auth.uid() references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists attachments_tx_idx on public.attachments (transaction_id);

-- 3.11 AUDIT_LOG
create table if not exists public.audit_log (
  id          bigserial primary key,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  table_name  text not null,
  record_id   uuid,
  action      text not null,
  actor_id    uuid,
  diff        jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists audit_log_tenant_idx on public.audit_log (tenant_id, created_at desc);

-- ---------------------------------------------------------------------
-- 4. DOCUMENTAÇÃO DO MODELO
-- ---------------------------------------------------------------------
comment on column public.transactions.competence_date is
  'Data do FATO GERADOR. Base do DRE (regime de competência).';
comment on column public.transactions.due_date is
  'Vencimento. Base de Contas a Pagar/Receber e da projeção de caixa.';
comment on column public.transactions.paid_date is
  'Data da baixa. Base do fluxo de caixa realizado (regime de caixa).';
comment on column public.transactions.parent_id is
  'Aponta para a 1ª parcela do grupo. NULL quando à vista ou quando é a própria origem.';
