-- =====================================================================
-- 13_exclusao_empresas.sql — arquivar e excluir empresas
-- =====================================================================
-- Duas operações distintas, de propósito:
--
--   ARQUIVAR  → tenants.is_active = false. Reversível. Bloqueia o acesso
--               do cliente e some da lista dele, mas nada é apagado.
--               É o caso do dia a dia: cadastro de teste, cliente que
--               encerrou o contrato, engano.
--
--   EXCLUIR   → delete from tenants. Irreversível. Todo o financeiro vai
--               junto por cascata. É o pedido formal de exclusão de dados
--               previsto na LGPD, e só isso.
--
-- O campo `is_active` já existia na tabela desde o início — mas era
-- decorativo: nenhuma função de RLS o consultava. Uma empresa "inativa"
-- continuava plenamente acessível. Este arquivo resolve isso primeiro,
-- porque sem essa parte o botão de arquivar seria teatro.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. AS FUNÇÕES DE ACESSO PASSAM A EXIGIR EMPRESA ATIVA
-- ---------------------------------------------------------------------
-- Continuam SECURITY DEFINER e com search_path fixo, pelos mesmos motivos
-- do 02_rls.sql: policy que faz subquery direta em memberships entra em
-- recursão infinita, já que memberships também tem RLS.
--
-- O staff NÃO é afetado. A policy de leitura de tenants usa
-- `is_tenant_member(id) or is_platform_staff()`, e é o segundo termo que
-- sustenta o painel — senão a empresa arquivada sumiria da tela de quem
-- precisa reativá-la.

create or replace function public.auth_tenant_ids()
returns setof uuid language sql stable security definer
set search_path = public, pg_temp as $$
  select m.tenant_id
    from public.memberships m
    join public.tenants t on t.id = m.tenant_id
   where m.user_id = auth.uid() and m.is_active and t.is_active;
$$;

create or replace function public.is_tenant_member(p_tenant_id uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (
    select 1
      from public.memberships m
      join public.tenants t on t.id = m.tenant_id
     where m.tenant_id = p_tenant_id and m.user_id = auth.uid()
       and m.is_active and t.is_active
  );
$$;

create or replace function public.is_tenant_admin(p_tenant_id uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (
    select 1
      from public.memberships m
      join public.tenants t on t.id = m.tenant_id
     where m.tenant_id = p_tenant_id and m.user_id = auth.uid()
       and m.is_active and t.is_active and m.role in ('owner','admin')
  );
$$;

create or replace function public.can_write_tenant(p_tenant_id uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (
    select 1
      from public.memberships m
      join public.tenants t on t.id = m.tenant_id
     where m.tenant_id = p_tenant_id and m.user_id = auth.uid()
       and m.is_active and t.is_active and m.role in ('owner','admin','member')
  );
$$;

-- ---------------------------------------------------------------------
-- 2. REGISTRO DAS EXCLUSÕES
-- ---------------------------------------------------------------------
-- Fica FORA do modelo multi-tenant de propósito. Se guardássemos no
-- audit_log, o registro da exclusão seria apagado pela mesma cascata que
-- ele documenta — e não sobraria prova de nada.
--
-- Sob a LGPD, quem exclui dados a pedido do titular precisa conseguir
-- demonstrar que excluiu. Estas linhas são essa demonstração, e por isso
-- guardam o mínimo: nome, documento e volume. Nenhum dado financeiro.

create table if not exists public.exclusoes_empresas (
  id                bigserial primary key,
  tenant_id         uuid not null,
  nome              text not null,
  tax_id            text,
  criada_em         timestamptz,
  excluida_em       timestamptz not null default now(),
  excluida_por      uuid references auth.users(id) on delete set null,
  excluida_por_email text,
  motivo            text,
  qtd_lancamentos   integer not null default 0,
  qtd_usuarios      integer not null default 0,
  qtd_anexos        integer not null default 0
);

comment on table public.exclusoes_empresas is
  'Trilha das exclusões definitivas de empresas. Fora do modelo multi-tenant '
  'para sobreviver à cascata que documenta. Só metadados, nunca financeiro.';

create index if not exists exclusoes_empresas_data_idx
  on public.exclusoes_empresas (excluida_em desc);

alter table public.exclusoes_empresas enable row level security;

-- Só o staff lê. Ninguém escreve pela aplicação: a inserção acontece na
-- API, com service_role, dentro da mesma operação que apaga.
drop policy if exists exclusoes_select on public.exclusoes_empresas;
create policy exclusoes_select on public.exclusoes_empresas
  for select to authenticated using (public.is_platform_staff());

grant select on public.exclusoes_empresas to authenticated;

-- ---------------------------------------------------------------------
-- 3. INVENTÁRIO ANTES DE APAGAR
-- ---------------------------------------------------------------------
-- Devolve o que existe hoje na empresa. A API chama isto duas vezes: uma
-- para mostrar na confirmação o tamanho do estrago, outra imediatamente
-- antes de apagar, para gravar os números no registro de exclusão.
--
-- `caminhos_anexos` importa: o `delete` em cascata limpa as LINHAS de
-- attachments, mas os ARQUIVOS continuam no Storage, que é outro sistema
-- e não participa da transação. Sem esta lista eles viram lixo órfão
-- ocupando disco para sempre.

create or replace function public.fn_inventario_empresa(p_tenant_id uuid)
returns jsonb language sql stable security definer
set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'tenant_id',       t.id,
    'nome',            t.name,
    'tax_id',          t.tax_id,
    'criada_em',       t.created_at,
    'arquivada',       not t.is_active,
    'qtd_lancamentos', (select count(*) from public.transactions x where x.tenant_id = t.id),
    'qtd_usuarios',    (select count(*) from public.memberships m  where m.tenant_id = t.id),
    'qtd_anexos',      (select count(*) from public.attachments a  where a.tenant_id = t.id),
    'qtd_contas',      (select count(*) from public.bank_accounts b where b.tenant_id = t.id),
    'caminhos_anexos', coalesce(
                         (select jsonb_agg(a.storage_path)
                            from public.attachments a where a.tenant_id = t.id),
                         '[]'::jsonb)
  )
  from public.tenants t
  where t.id = p_tenant_id;
$$;

-- Sem grant para `authenticated`, de propósito.
--
-- A função é SECURITY DEFINER: quem a executa enxerga qualquer empresa,
-- independentemente de RLS. Liberá-la para todo usuário logado deixaria
-- qualquer cliente descobrir o nome, o CNPJ e o volume de qualquer outra
-- empresa da base, bastando chutar um uuid pelo PostgREST — a proteção da
-- API não vale aqui, porque o PostgREST expõe RPC direto.
--
-- A API chama com service_role, que ignora grants.
revoke all on function public.fn_inventario_empresa(uuid) from public;
revoke all on function public.fn_inventario_empresa(uuid) from authenticated;

-- ---------------------------------------------------------------------
-- 4. USUÁRIOS QUE FICARIAM SEM NENHUMA EMPRESA
-- ---------------------------------------------------------------------
-- Apagar a empresa deixa órfão quem só pertencia a ela: a conta continua
-- no GoTrue, consegue fazer login e cai numa tela vazia. Pior, o e-mail
-- fica ocupado — se a pessoa voltar como cliente, o cadastro falha por
-- duplicidade e ninguém entende por quê.
--
-- Staff nunca entra nesta lista: a conta dele existe independentemente de
-- vínculo com empresa.

create or replace function public.fn_usuarios_orfaos_apos_exclusao(p_tenant_id uuid)
returns table (user_id uuid, email text)
language sql stable security definer
set search_path = public, pg_temp as $$
  select p.id, p.email
    from public.memberships m
    join public.profiles p on p.id = m.user_id
   where m.tenant_id = p_tenant_id
     and coalesce(p.is_staff, false) = false
     and not exists (
       select 1 from public.memberships outros
        where outros.user_id = m.user_id
          and outros.tenant_id <> p_tenant_id
     );
$$;

-- Mesma razão da anterior: devolve e-mails de usuários de outra empresa.
revoke all on function public.fn_usuarios_orfaos_apos_exclusao(uuid) from public;
revoke all on function public.fn_usuarios_orfaos_apos_exclusao(uuid) from authenticated;

-- ---------------------------------------------------------------------
-- 5. CONFERÊNCIA
-- ---------------------------------------------------------------------
-- Rode depois de aplicar. As funções devem existir e a tabela também.
--
--   select proname from pg_proc
--    where proname in ('fn_inventario_empresa','fn_usuarios_orfaos_apos_exclusao');
--
--   select count(*) from public.exclusoes_empresas;
--
-- E o teste que realmente importa, com uma empresa de teste:
--
--   update public.tenants set is_active = false where id = '<uuid>';
--   -- logado como membro dessa empresa, a lista tem que voltar vazia:
--   select * from public.vw_extrato_caixa;
--
-- Depois de aplicar, o PostgREST precisa recarregar o cache de schema:
--   notify pgrst, 'reload schema';
