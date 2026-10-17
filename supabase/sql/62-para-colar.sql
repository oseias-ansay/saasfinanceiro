-- =====================================================================
-- 62 · CAPTURA DE BOLETO POR FOTO
-- =====================================================================
-- O cliente fotografa o boleto que vai pagar, confere na tela o que foi
-- lido, e o boleto vira uma conta a pagar.
--
-- ---------------------------------------------------------------------
-- O QUE O MODELO FAZ, E O QUE ELE NÃO FAZ
-- ---------------------------------------------------------------------
-- O modelo de visão tem UMA tarefa: transcrever os 47 dígitos da linha
-- digitável impressa. Ele não lê valor, não lê data, não interpreta.
--
-- A razão é que essa é a única tarefa cuja saída é VERIFICÁVEL. A linha
-- digitável carrega dígitos verificadores; se o modelo trocar um número,
-- a conta não fecha e nós sabemos. Já se ele lesse o valor impresso em
-- "R$ 1.247,80", um erro devolveria R$ 124,78 — plausível, errado, e
-- indistinguível do certo.
--
-- Valor e vencimento saem da aritmética sobre os dígitos, em
-- `modules/transactions/boleto.ts`, com teste ao lado.
--
-- ---------------------------------------------------------------------
-- NADA VIRA LANÇAMENTO SOZINHO
-- ---------------------------------------------------------------------
-- A captura grava aqui, com status `pendente`. O `transactions` só nasce
-- quando alguém clica em confirmar.
--
-- É dinheiro saindo. Automatizar a leitura economiza digitação;
-- automatizar a confirmação transferiria para o modelo a decisão de
-- quanto a empresa vai pagar, e um erro só apareceria no extrato.
--
-- ---------------------------------------------------------------------
-- PAGAR O MESMO BOLETO DUAS VEZES É O ERRO CARO DESTA TELA
-- ---------------------------------------------------------------------
-- Fotografar é fácil, e fotografar duas vezes é mais fácil ainda — a
-- pessoa não tem certeza se o primeiro envio funcionou e repete.
--
-- Então a mesma linha digitável não entra duas vezes na mesma empresa,
-- e isso é garantido por índice, não por verificação na aplicação. A
-- aplicação erra em corrida; o índice não.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. A TABELA
-- ---------------------------------------------------------------------

create table if not exists public.boletos_capturados (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,

  /**
   * Caminho no bucket `boletos`. Nulo quando a pessoa digitou a linha
   * em vez de fotografar — o caminho digitado existe de propósito, para
   * a foto ruim não ser um beco sem saída.
   */
  arquivo     text,

  /** Só dígitos, 47 (cobrança) ou 48 (arrecadação). */
  linha_digitavel text not null
    check (linha_digitavel ~ '^[0-9]{47,48}$'),

  /** Os 44 dígitos remontados. Guardados porque é o que o banco lê. */
  codigo_barras   text not null check (codigo_barras ~ '^[0-9]{44}$'),

  tipo        text not null check (tipo in ('cobranca', 'arrecadacao')),

  /**
   * Nulos quando o código não traz o dado: arrecadação não codifica
   * vencimento, e boleto em branco não codifica valor. Fica nulo e a
   * pessoa preenche — mesma regra do resto da plataforma.
   */
  valor       numeric(14,2) check (valor is null or valor > 0),
  vencimento  date,
  banco       text,

  /** O que a leitura não conseguiu garantir. Vai inteiro para a tela. */
  avisos      text[] not null default '{}',

  status      text not null default 'pendente'
    check (status in ('pendente', 'lancado', 'descartado')),

  /**
   * A conta a pagar que nasceu daqui. `set null` porque apagar o
   * lançamento não deve apagar o registro da captura: some o motivo de
   * o boleto estar marcado como já lançado.
   */
  transaction_id uuid references public.transactions(id) on delete set null,

  criado_por  uuid references auth.users(id) on delete set null,
  criado_em   timestamptz not null default now(),
  lancado_em  timestamptz,

  /* Lançado tem que ter lançamento, e vice-versa. */
  constraint boleto_lancado_coerente check (
    (status = 'lancado' and lancado_em is not null)
    or (status <> 'lancado' and lancado_em is null)
  )
);

/**
 * A trava contra pagamento duplicado.
 *
 * Parcial: um boleto descartado libera a linha, porque descartar é
 * dizer "esta leitura não presta" — e a pessoa vai fotografar de novo.
 */
create unique index if not exists boletos_sem_repetir_idx
  on public.boletos_capturados (tenant_id, linha_digitavel)
  where status <> 'descartado';

create index if not exists boletos_pendentes_idx
  on public.boletos_capturados (tenant_id, status, criado_em desc);


-- ---------------------------------------------------------------------
-- 2. RLS
-- ---------------------------------------------------------------------

alter table public.boletos_capturados enable row level security;

drop policy if exists boletos_select on public.boletos_capturados;
create policy boletos_select on public.boletos_capturados
  for select to authenticated
  using (
    public.is_tenant_member(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  );

drop policy if exists boletos_insert on public.boletos_capturados;
create policy boletos_insert on public.boletos_capturados
  for insert to authenticated
  with check (
    public.can_write_tenant(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  );

drop policy if exists boletos_update on public.boletos_capturados;
create policy boletos_update on public.boletos_capturados
  for update to authenticated
  using (
    public.can_write_tenant(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  );

drop policy if exists boletos_delete on public.boletos_capturados;
create policy boletos_delete on public.boletos_capturados
  for delete to authenticated
  using (
    public.can_write_tenant(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  );


-- ---------------------------------------------------------------------
-- 3. O BUCKET
-- ---------------------------------------------------------------------
-- Privado. A foto do boleto traz o nome do sacado, o CNPJ e o valor —
-- é documento financeiro da empresa, não imagem pública.
--
-- Caminho `{tenant_id}/{arquivo}`, mesma convenção dos buckets
-- `comprovantes` e `credito`: as policies leem o primeiro segmento.
--
-- 10 MB porque é foto de celular, não PDF de extrato. PDF entra na
-- lista porque muito boleto chega por e-mail já em PDF, e obrigar a
-- pessoa a imprimir para fotografar seria absurdo.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'boletos', 'boletos', false, 10485760,
  array['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf']
)
on conflict (id) do update
  set file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists boletos_storage_select on storage.objects;
create policy boletos_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'boletos'
    and (
      public.is_tenant_member(((storage.foldername(name))[1])::uuid)
      or public.is_platform_staff()
      or public.is_consultor_de(((storage.foldername(name))[1])::uuid)
    )
  );

drop policy if exists boletos_storage_insert on storage.objects;
create policy boletos_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'boletos'
    and (
      public.can_write_tenant(((storage.foldername(name))[1])::uuid)
      or public.is_platform_staff()
      or public.is_consultor_de(((storage.foldername(name))[1])::uuid)
    )
  );

drop policy if exists boletos_storage_delete on storage.objects;
create policy boletos_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'boletos'
    and (
      public.can_write_tenant(((storage.foldername(name))[1])::uuid)
      or public.is_platform_staff()
      or public.is_consultor_de(((storage.foldername(name))[1])::uuid)
    )
  );


-- ---------------------------------------------------------------------
-- 4. CONFERIR
-- ---------------------------------------------------------------------
-- Rode depois de colar. Deve devolver uma linha com a tabela, o índice
-- único e o bucket privado.

-- select
--   (select count(*) from information_schema.tables
--      where table_schema = 'public' and table_name = 'boletos_capturados') as tabela,
--   (select count(*) from pg_indexes
--      where schemaname = 'public' and indexname = 'boletos_sem_repetir_idx') as trava_duplicado,
--   (select count(*) from storage.buckets
--      where id = 'boletos' and public = false) as bucket_privado;
