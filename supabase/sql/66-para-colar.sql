-- =====================================================================
-- 66 · IMPORTAÇÃO DE EXTRATO BANCÁRIO
-- =====================================================================
-- Duas tabelas: o ARQUIVO importado e as LINHAS dele.
--
-- ---------------------------------------------------------------------
-- POR QUE A LINHA DE EXTRATO NÃO É UM LANÇAMENTO
-- ---------------------------------------------------------------------
-- Ela é a PROVA de que um lançamento foi pago, e isso é diferente.
--
-- A plataforma separa obrigação de caixa desde o começo: `due_date` é
-- quando vence, `paid_date` é quando o dinheiro andou. O extrato fala
-- exclusivamente do segundo.
--
-- Se cada linha virasse `transaction`, a conta a pagar que já estava
-- cadastrada ganharia uma gêmea, e o mês fecharia com o dobro da
-- despesa. Por isso a linha nasce separada e aponta para a transação
-- que ela liquidou — ou para ninguém, e aí a tela OFERECE criar.
--
-- ---------------------------------------------------------------------
-- REIMPORTAR É O CASO NORMAL
-- ---------------------------------------------------------------------
-- O cliente baixa o extrato dia 10, importa, baixa de novo dia 20 e
-- importa outra vez. As dez primeiras linhas são as mesmas.
--
-- `extrato_linhas_sem_repetir_idx` é quem impede a duplicação, e é
-- índice e não consulta — pela mesma razão do boleto: aplicação erra em
-- corrida, banco não. A `identidade` vem de `identidadeLinha()` no
-- módulo puro, que usa o FITID do OFX quando existe e um hash com
-- POSIÇÃO NO DIA quando não existe. A posição entra de propósito: duas
-- tarifas de R$ 2,90 no mesmo dia são dois fatos, não um repetido.
--
-- ---------------------------------------------------------------------
-- O ARQUIVO FICA GUARDADO
-- ---------------------------------------------------------------------
-- Bucket privado `extratos`. Não é zelo documental: quando a conciliação
-- de um mês for contestada, a pergunta é "o que o banco mandou?", e a
-- resposta não pode ser a nossa própria leitura do que o banco mandou.
-- Mesma razão pela qual a importação do PDCA lê o markdown e não o PDF.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. O ARQUIVO IMPORTADO
-- ---------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'extrato_formato') then
    create type public.extrato_formato as enum ('ofx', 'csv', 'pdf');
  end if;
end $$;

create table if not exists public.extratos_importados (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,

  bank_account_id uuid references public.bank_accounts(id) on delete set null,
  formato         public.extrato_formato not null,

  -- O que o arquivo declarou sobre si. Nulo quando o formato não diz.
  banco           text,
  conta           text,
  periodo_de      date,
  periodo_ate     date,

  -- O portão de saldo, como ficou nesta importação. Guardado porque é a
  -- única prova de integridade que um extrato oferece: sem dígito
  -- verificador, `saldo anterior + movimentos = saldo final` é o que
  -- diz que a leitura está certa. Nulo quando o arquivo não declara.
  saldo_anterior  numeric(14,2),
  saldo_final     numeric(14,2),
  soma_movimentos numeric(14,2),

  arquivo_nome    text not null,
  -- Caminho no bucket `extratos`. Nulo só se a gravação falhar — a
  -- importação não é abortada por isso: o dado lido vale mais que a
  -- cópia do original, e o aviso aparece na tela.
  arquivo_caminho text,

  linhas_lidas    int not null default 0,
  linhas_novas    int not null default 0,
  avisos          text[] not null default '{}',

  importado_por   uuid default auth.uid() references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists extratos_importados_tenant_idx
  on public.extratos_importados (tenant_id, created_at desc);

comment on table public.extratos_importados is
  'Um arquivo de extrato lido. Guarda o que o arquivo declarou de saldo '
  'para que a conferencia aritmetica da importacao seja auditavel depois.';


-- ---------------------------------------------------------------------
-- 2. AS LINHAS
-- ---------------------------------------------------------------------

create table if not exists public.extrato_linhas (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,

  -- `cascade`: apagar a importação apaga as linhas dela. Mesma regra do
  -- movimento diário — a linha não existe fora do arquivo que a trouxe.
  importacao_id uuid not null
                references public.extratos_importados(id) on delete cascade,

  data          date not null,
  -- Positivo entrou, negativo saiu. SEM `check (valor <> 0)`: há banco
  -- que lança estorno de valor zero, e recusar faria o saldo não fechar
  -- por causa de uma linha que não muda nada.
  valor         numeric(14,2) not null,
  historico     text not null,
  fitid         text,

  -- Vem de `identidadeLinha()`. É o que impede dobrar o mês ao
  -- reimportar; ver o índice único abaixo.
  identidade    text not null,

  -- A transação que esta linha liquidou. Nulo = ainda não conciliada.
  --
  -- `set null` e não `cascade`: se o lançamento for apagado, a linha do
  -- extrato CONTINUA — o banco não desfaz o débito porque alguém apagou
  -- o registro aqui. Ela volta a ser uma linha sem par, que é a verdade.
  transaction_id uuid references public.transactions(id) on delete set null,

  -- 'alta' | 'media' quando conciliada por sugestão; nulo no manual.
  -- Guardado para a tela saber o que foi casado automaticamente e o que
  -- uma pessoa confirmou.
  confianca     text check (confianca is null or confianca in ('alta', 'media')),
  conciliada_em timestamptz,
  conciliada_por uuid references auth.users(id) on delete set null,

  -- Linha que a pessoa marcou como "não é da empresa" ou "ignorar".
  -- Melhor que apagar: apagada, ela volta na próxima reimportação.
  ignorada      boolean not null default false,

  created_at    timestamptz not null default now(),

  constraint extrato_conciliacao_ck check (
    (transaction_id is not null and conciliada_em is not null)
    or (transaction_id is null and conciliada_em is null)
  )
);

create index if not exists extrato_linhas_tenant_data_idx
  on public.extrato_linhas (tenant_id, data desc);

create index if not exists extrato_linhas_importacao_idx
  on public.extrato_linhas (importacao_id);

-- Linhas pendentes de conciliação — a consulta que a tela faz ao abrir.
create index if not exists extrato_linhas_pendentes_idx
  on public.extrato_linhas (tenant_id, data)
  where transaction_id is null and not ignorada;

-- ---------------------------------------------------------------------
-- A TRAVA DE REIMPORTAÇÃO
-- ---------------------------------------------------------------------
-- Por `tenant_id` + `identidade`, e NÃO por importação: a mesma linha
-- vinda de dois arquivos diferentes é o caso que precisa ser barrado.
-- Travar dentro do arquivo não barraria nada — o problema nunca foi o
-- arquivo repetir a si mesmo.
--
-- A rota trata `23505` como "já tinha", não como defeito: é o que torna
-- seguro reimportar o mês inteiro. Mesma regra do boleto.
create unique index if not exists extrato_linhas_sem_repetir_idx
  on public.extrato_linhas (tenant_id, identidade);

comment on column public.extrato_linhas.identidade is
  'Chave estavel da linha, de identidadeLinha(): FITID do OFX quando '
  'existe, senao hash de conta+data+valor+historico+posicao no dia. A '
  'posicao entra porque duas tarifas iguais no mesmo dia sao dois fatos.';


-- ---------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------
-- Mesmo desenho do boleto (SQL 62): membro lê, quem escreve na empresa
-- escreve, e staff e consultor da carteira enxergam.

alter table public.extratos_importados enable row level security;
alter table public.extrato_linhas      enable row level security;

drop policy if exists extratos_select on public.extratos_importados;
create policy extratos_select on public.extratos_importados
  for select to authenticated
  using (
    public.is_tenant_member(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  );

drop policy if exists extratos_insert on public.extratos_importados;
create policy extratos_insert on public.extratos_importados
  for insert to authenticated
  with check (
    public.can_write_tenant(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  );

drop policy if exists extratos_delete on public.extratos_importados;
create policy extratos_delete on public.extratos_importados
  for delete to authenticated
  using (
    public.can_write_tenant(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  );

drop policy if exists extrato_linhas_select on public.extrato_linhas;
create policy extrato_linhas_select on public.extrato_linhas
  for select to authenticated
  using (
    public.is_tenant_member(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  );

drop policy if exists extrato_linhas_insert on public.extrato_linhas;
create policy extrato_linhas_insert on public.extrato_linhas
  for insert to authenticated
  with check (
    public.can_write_tenant(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  );

drop policy if exists extrato_linhas_update on public.extrato_linhas;
create policy extrato_linhas_update on public.extrato_linhas
  for update to authenticated
  using (
    public.can_write_tenant(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  );

drop policy if exists extrato_linhas_delete on public.extrato_linhas;
create policy extrato_linhas_delete on public.extrato_linhas
  for delete to authenticated
  using (
    public.can_write_tenant(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  );


-- ---------------------------------------------------------------------
-- 4. O BUCKET
-- ---------------------------------------------------------------------
-- PRIVADO. Extrato bancário é o documento mais sensível que a plataforma
-- guarda: tem saldo, fornecedor, folha e vida pessoal do sócio quando a
-- conta é misturada. Um bucket público aqui seria vazamento, não
-- conveniência.

insert into storage.buckets (id, name, public)
values ('extratos', 'extratos', false)
on conflict (id) do update set public = false;

-- O caminho começa com o tenant_id: `<tenant_id>/<importacao_id>.<ext>`.
-- É o que permite a policy decidir sem consultar outra tabela.

drop policy if exists extratos_storage_select on storage.objects;
create policy extratos_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'extratos'
    and (
      public.is_tenant_member((storage.foldername(name))[1]::uuid)
      or public.is_platform_staff()
      or public.is_consultor_de((storage.foldername(name))[1]::uuid)
    )
  );

drop policy if exists extratos_storage_insert on storage.objects;
create policy extratos_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'extratos'
    and (
      public.can_write_tenant((storage.foldername(name))[1]::uuid)
      or public.is_platform_staff()
      or public.is_consultor_de((storage.foldername(name))[1]::uuid)
    )
  );

drop policy if exists extratos_storage_delete on storage.objects;
create policy extratos_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'extratos'
    and (
      public.can_write_tenant((storage.foldername(name))[1]::uuid)
      or public.is_platform_staff()
      or public.is_consultor_de((storage.foldername(name))[1]::uuid)
    )
  );

notify pgrst, 'reload schema';


-- =====================================================================
-- CONFERÊNCIA — rode depois, separado
-- =====================================================================
-- As quatro colunas têm de vir 2, 1, 1 e 1:
--
-- select
--   (select count(*) from information_schema.tables
--      where table_schema = 'public'
--        and table_name in ('extratos_importados', 'extrato_linhas')) as tabelas,
--   (select count(*) from pg_indexes
--      where indexname = 'extrato_linhas_sem_repetir_idx')            as trava,
--   (select count(*) from pg_type where typname = 'extrato_formato')  as enum_formato,
--   (select count(*) from storage.buckets
--      where id = 'extratos' and public = false)                      as bucket_privado;
--
-- E REGISTRE AS DUAS TABELAS NA PRIMEIRA PARTE DO 52.
-- Tabela nova vai na primeira consulta; coluna acrescentada a tabela que
-- já existe vai na segunda. Esta migração só cria tabelas, então é a
-- primeira.
