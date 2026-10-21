-- =====================================================================
-- 67 · PEDIDOS DE INTERESSE (UPGRADE)
-- =====================================================================
-- O cliente que não tem o treinamento passa a ver o card bloqueado, e o
-- clique leva a uma tela que explica o curso e oferece falar com a
-- consultoria. Esta tabela guarda esse pedido.
--
-- ---------------------------------------------------------------------
-- POR QUE GRAVAR ANTES DE AVISAR
-- ---------------------------------------------------------------------
-- O aviso vai por WhatsApp, pela Evolution. Ela cai: instância fora,
-- número trocado, container reiniciando. Aviso que não chega não deixa
-- rastro nenhum — e o que se perde aqui é um cliente PEDINDO para
-- contratar.
--
-- É a mesma razão pela qual `MOTOR_PUBLICO` é `codigo` no formulário
-- público: quem está do outro lado não volta para tentar de novo.
--
-- Com a linha gravada, o WhatsApp vira conveniência. Sem ela, vira a
-- única cópia.
--
-- ---------------------------------------------------------------------
-- `assunto` É TEXTO LIVRE, E NÃO UM ENUM
-- ---------------------------------------------------------------------
-- Hoje só o treinamento tem tela de oferta. Amanhã pode ser o CRM, o
-- Contábil ou um plano acima. Enum aqui obrigaria uma migração manual a
-- cada oferta nova — e migração manual é a dívida mais cara do projeto.
--
-- O `check` de tamanho existe só para impedir lixo; a semântica fica com
-- quem lê.
--
-- ---------------------------------------------------------------------
-- NÃO HÁ CAMPO DE EMPRESA NO CORPO DA ROTA
-- ---------------------------------------------------------------------
-- O `tenant_id` é injetado pelo servidor a partir do JWT, igual às
-- ferramentas do assistente e ao webhook de boleto. Cliente não diz de
-- qual empresa ele é.
-- =====================================================================

create table if not exists public.interesses (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,

  -- Sobre o que é o pedido. Ex.: 'treinamento', 'crm', 'contabil'.
  assunto     text not null check (length(btrim(assunto)) between 2 and 60),

  -- O que a pessoa escreveu, se escreveu. Opcional de propósito: exigir
  -- texto para pedir contato acrescenta um obstáculo exatamente onde se
  -- quer o contrário.
  mensagem    text check (mensagem is null or length(mensagem) <= 2000),

  -- Telefone que a pessoa informou nesta tela. Nulo quando ela não
  -- informou — o cadastro nem sempre tem, e o consultor responde pelo
  -- canal que tiver.
  telefone    text check (telefone is null or length(btrim(telefone)) between 8 and 20),

  -- Quando o aviso saiu. Nulo = ninguém foi avisado ainda, e isso é
  -- consultável: `where avisado_em is null` lista o que caiu no vão.
  avisado_em  timestamptz,

  -- Quem da consultoria tratou. A tela de carteira pode usar depois.
  atendido_em timestamptz,

  criado_por  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists interesses_tenant_idx
  on public.interesses (tenant_id, created_at desc);

-- Os que ainda não foram avisados. É a consulta que diz se o WhatsApp
-- está entregando — e a que salva o pedido quando ele não está.
create index if not exists interesses_sem_aviso_idx
  on public.interesses (created_at)
  where avisado_em is null;

comment on table public.interesses is
  'Pedido de contato sobre algo que a empresa ainda nao contratou. '
  'Gravado ANTES do aviso por WhatsApp: aviso que falha nao deixa rastro, '
  'e o que se perde aqui e um cliente pedindo para contratar.';


-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
-- O cliente CRIA e LÊ os próprios pedidos. Não edita nem apaga: pedido
-- registrado é fato histórico, e apagar o próprio pedido depois de o
-- consultor ter sido avisado só criaria confusão na conversa.
--
-- Quem trata é staff ou o consultor da carteira — e são os únicos que
-- podem marcar `atendido_em`.

alter table public.interesses enable row level security;

drop policy if exists interesses_select on public.interesses;
create policy interesses_select on public.interesses
  for select to authenticated
  using (
    public.is_tenant_member(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  );

drop policy if exists interesses_insert on public.interesses;
create policy interesses_insert on public.interesses
  for insert to authenticated
  with check (
    public.can_write_tenant(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  );

-- Update só para quem atende. `avisado_em` é escrito pela API com a
-- chave de serviço; `atendido_em` é do consultor na tela.
drop policy if exists interesses_update on public.interesses;
create policy interesses_update on public.interesses
  for update to authenticated
  using (public.is_platform_staff() or public.is_consultor_de(tenant_id))
  with check (public.is_platform_staff() or public.is_consultor_de(tenant_id));

notify pgrst, 'reload schema';


-- =====================================================================
-- CONFERÊNCIA — rode depois, separado
-- =====================================================================
-- As três colunas têm de vir 1, 2 e 3:
--
-- select
--   (select count(*) from information_schema.tables
--      where table_schema = 'public' and table_name = 'interesses')   as tabela,
--   (select count(*) from pg_indexes
--      where indexname in ('interesses_tenant_idx',
--                          'interesses_sem_aviso_idx'))               as indices,
--   (select count(*) from pg_policies
--      where tablename = 'interesses')                                as policies;
--
-- E REGISTRE `interesses` NA PRIMEIRA PARTE DO 52.
--
-- Depois de a funcionalidade estar no ar, esta é a consulta que importa
-- — pedido que ninguém foi avisado:
--
-- select i.created_at, t.name, i.assunto, i.mensagem
--   from public.interesses i
--   join public.tenants t on t.id = i.tenant_id
--  where i.avisado_em is null
--  order by i.created_at;
