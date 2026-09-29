-- =====================================================================
-- 55 · DOSSIÊ DE CRÉDITO — DOCUMENTOS PARA ANÁLISE DE EMPRÉSTIMO
-- =====================================================================
-- Uma pasta por cliente, alimentada aos poucos. A entrega é parcial por
-- natureza: ninguém junta balanço de três anos, IR dos sócios e matrícula
-- de imóvel numa sessão só.
--
-- ---------------------------------------------------------------------
-- O ARQUIVO CHEGA PRIMEIRO AO STORAGE, DEPOIS AO DRIVE
-- ---------------------------------------------------------------------
-- O envio do cliente termina quando o arquivo está no Supabase. O Google
-- Drive é destino secundário, alimentado pelo n8n a partir de uma URL
-- assinada.
--
-- A ordem não é detalhe. Se o navegador subisse direto para o Drive,
-- toda indisponibilidade do Google — credencial expirada, cota, API fora
-- — viraria documento perdido e cliente reenviando. Aqui o documento
-- está guardado e a sincronização é reprocessável: `drive_file_id` nulo
-- com `sync_tentativas` alto é a fila de quem precisa de atenção.
--
-- Efeito colateral bom: a funcionalidade sobe hoje, mesmo sem nenhuma
-- credencial do Google configurada. O que falta é a cópia, não o
-- recebimento.
--
-- ---------------------------------------------------------------------
-- POR QUE O DOSSIÊ É UM POR EMPRESA, E NÃO UM POR OPERAÇÃO
-- ---------------------------------------------------------------------
-- O pedido foi explícito: cada cliente tem UMA pasta, e todos os
-- documentos ficam nela. Modelar por operação criaria a segunda pasta na
-- segunda tentativa de crédito, com o contrato social duplicado nas
-- duas, e a pergunta "qual é a boa?" sem resposta.
--
-- Se um dia houver necessidade de separar por operação, o caminho é uma
-- tabela de operações referenciando os mesmos documentos — e não quebrar
-- a pasta.
-- =====================================================================

create table if not exists public.credito_dossies (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,

  -- Decide se o grupo do imóvel entra na contagem. Nem toda operação tem
  -- garantia real, e cobrar matrícula de quem não vai dar imóvel faz a
  -- lista parecer impossível.
  tem_imovel boolean not null default false,

  -- Preenchidos pelo n8n quando a pasta é criada no Drive.
  drive_folder_id  text,
  drive_folder_url text,

  -- Último aviso enviado ao consultor. Serve de represa: sem isso, um
  -- cliente que sobe quinze arquivos numa tarde dispara quinze mensagens
  -- e o consultor silencia o número.
  avisado_em timestamptz,

  observacao text check (observacao is null or length(observacao) <= 1000),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.credito_dossies is
  'Um dossie de credito por empresa. A pasta no Drive e unica e acumula '
  'todos os documentos, inclusive de operacoes diferentes ao longo do tempo.';

comment on column public.credito_dossies.avisado_em is
  'Represa do aviso ao consultor. Quinze arquivos numa tarde sao um evento, '
  'nao quinze -- e quinze mensagens fazem o consultor silenciar o numero.';


create table if not exists public.credito_documentos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- Chave do catálogo em `api/src/modules/credito/catalogo.ts`. Texto e
  -- não enum: a lista muda por decisão de negócio, e migração de enum a
  -- cada documento novo é atrito sem retorno.
  item  text not null check (item ~ '^[a-z0-9_]+$'),
  grupo text not null check (grupo in ('empresa', 'socios', 'imovel')),

  nome_arquivo  text not null check (length(btrim(nome_arquivo)) between 1 and 300),
  storage_path  text not null unique,
  tamanho_bytes bigint check (tamanho_bytes >= 0),
  content_type  text,

  enviado_por uuid references auth.users(id) on delete set null,
  enviado_em  timestamptz not null default now(),

  -- ---- Sincronização com o Drive ----
  drive_file_id   text,
  sincronizado_em timestamptz,
  sync_tentativas int not null default 0 check (sync_tentativas >= 0),
  sync_erro       text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.credito_documentos is
  'Um registro por arquivo enviado. drive_file_id nulo com sync_tentativas '
  'alto e a fila do que nao chegou ao Drive e precisa de atencao.';

-- A tela agrupa por item; a fila de sincronização varre os pendentes.
create index if not exists credito_doc_tenant_item_idx
  on public.credito_documentos (tenant_id, item);
create index if not exists credito_doc_pendente_sync_idx
  on public.credito_documentos (tenant_id, enviado_em)
  where drive_file_id is null;

drop trigger if exists set_updated_at on public.credito_dossies;
create trigger set_updated_at before update on public.credito_dossies
  for each row execute function public.tg_set_updated_at();

drop trigger if exists set_updated_at on public.credito_documentos;
create trigger set_updated_at before update on public.credito_documentos
  for each row execute function public.tg_set_updated_at();


-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
-- Documento de crédito é o material mais sensível da plataforma: IR dos
-- sócios, extrato bancário, matrícula de imóvel. A leitura segue a mesma
-- regra do resto — membro da empresa, staff e consultor da carteira —
-- mas vale registrar que aqui o custo de um vazamento é outro.

alter table public.credito_dossies    enable row level security;
alter table public.credito_documentos enable row level security;

drop policy if exists credito_dossies_select on public.credito_dossies;
create policy credito_dossies_select on public.credito_dossies
  for select using (
    public.is_tenant_member(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  );

drop policy if exists credito_dossies_write on public.credito_dossies;
create policy credito_dossies_write on public.credito_dossies
  for all using (
    public.can_write_tenant(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  ) with check (
    public.can_write_tenant(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  );

drop policy if exists credito_documentos_select on public.credito_documentos;
create policy credito_documentos_select on public.credito_documentos
  for select using (
    public.is_tenant_member(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  );

drop policy if exists credito_documentos_write on public.credito_documentos;
create policy credito_documentos_write on public.credito_documentos
  for all using (
    public.can_write_tenant(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  ) with check (
    public.can_write_tenant(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  );


-- ---------------------------------------------------------------------
-- BUCKET
-- ---------------------------------------------------------------------
-- Privado, com teto de 25 MB. Extrato de seis meses em PDF passa longe
-- disso; foto de celular de imóvel, não — e um limite baixo demais vira
-- suporte para converter arquivo.
--
-- O caminho é `{tenant_id}/{item}/{arquivo}`, e as policies leem o
-- primeiro segmento como o tenant. Mesma convenção do bucket de
-- comprovantes, para não haver duas regras de nomenclatura.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'credito', 'credito', false, 26214400,
  array[
    'application/pdf',
    'image/jpeg', 'image/png', 'image/heic', 'image/webp',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/csv'
  ]
)
on conflict (id) do update
  set file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists credito_storage_select on storage.objects;
create policy credito_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'credito'
    and (
      public.is_tenant_member(((storage.foldername(name))[1])::uuid)
      or public.is_platform_staff()
      or public.is_consultor_de(((storage.foldername(name))[1])::uuid)
    )
  );

drop policy if exists credito_storage_insert on storage.objects;
create policy credito_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'credito'
    and (
      public.can_write_tenant(((storage.foldername(name))[1])::uuid)
      or public.is_platform_staff()
      or public.is_consultor_de(((storage.foldername(name))[1])::uuid)
    )
  );

drop policy if exists credito_storage_delete on storage.objects;
create policy credito_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'credito'
    and (
      public.can_write_tenant(((storage.foldername(name))[1])::uuid)
      or public.is_platform_staff()
      or public.is_consultor_de(((storage.foldername(name))[1])::uuid)
    )
  );


-- ---------------------------------------------------------------------
-- A CARTEIRA, PARA O CONSULTOR
-- ---------------------------------------------------------------------
-- Quem parou no meio é a informação que a operação de crédito precisa, e
-- ela não existe olhando pasta do Drive: lá se vê o que chegou, não o
-- que falta.

drop view if exists public.vw_credito_carteira;

create view public.vw_credito_carteira
with (security_invoker = on) as
select
  d.tenant_id,
  t.name as empresa,
  d.tem_imovel,
  d.drive_folder_url,
  d.created_at as iniciado_em,
  count(doc.id)                                             as arquivos,
  count(distinct doc.item)                                  as itens_entregues,
  count(doc.id) filter (where doc.drive_file_id is null)    as pendentes_no_drive,
  max(doc.enviado_em)                                       as ultimo_envio
from public.credito_dossies d
join public.tenants t on t.id = d.tenant_id
left join public.credito_documentos doc on doc.tenant_id = d.tenant_id
group by d.tenant_id, t.name, d.tem_imovel, d.drive_folder_url, d.created_at;

comment on view public.vw_credito_carteira is
  'Andamento do dossie por empresa. itens_entregues conta ITENS distintos do '
  'catalogo, nao arquivos: seis extratos sao um item cumprido, nao seis.';

grant select on public.vw_credito_carteira to authenticated;

notify pgrst, 'reload schema';


-- =====================================================================
-- CONFERÊNCIA — rode depois, separado
-- =====================================================================
-- 1. As duas tabelas, a view e o bucket existem:
--
-- select table_name from information_schema.tables
--  where table_schema = 'public'
--    and table_name in ('credito_dossies','credito_documentos','vw_credito_carteira');
--
-- select id, public, file_size_limit from storage.buckets where id = 'credito';
--
-- 2. O bucket TEM de vir com public = false. Documento de credito em
--    bucket publico e URL adivinhavel com o IR do socio dentro.
