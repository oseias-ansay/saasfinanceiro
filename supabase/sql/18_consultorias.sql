-- =====================================================================
-- 18 — CAMADA DE CONSULTORIA (microfranquia)
-- =====================================================================
-- Introduz o terceiro nível da hierarquia:
--
--     plataforma (Business Triage)
--       └── consultoria (franqueado)
--             └── empresa (cliente)
--
-- Até aqui existiam dois níveis, e `profiles.is_staff` era uma chave
-- global: quem é staff enxerga TODAS as empresas. Com franqueados, cada
-- um precisa ver apenas a própria carteira.
--
-- =====================================================================
-- ESTA MIGRAÇÃO NASCE INERTE. LEIA ANTES DE APLICAR.
-- =====================================================================
-- Aplicar isto às vésperas da operação comercial só é aceitável porque
-- nada aqui altera o comportamento atual. O mecanismo é simples:
--
--   • As policies existentes ganham UM TERMO A MAIS, unido por `or`.
--     Termo com `or` só AMPLIA acesso — nunca reduz. Nenhum usuário
--     perde nada.
--
--   • Esse termo novo é `is_consultor_de(tenant)`, que consulta a tabela
--     `consultores`. Ela nasce vazia, então a função retorna `false`
--     para todo mundo, e a expressão inteira continua valendo
--     exatamente o que valia antes.
--
--   • O que NÃO se faz agora: estreitar `is_platform_staff()` para que o
--     franqueador veja apenas a própria carteira. Essa é a mudança que
--     de fato reduz acesso, e ela pode quebrar telas em produção. Fica
--     para quando existir franqueado de verdade — momento em que dá para
--     testar com dois perfis lado a lado.
--
-- Ou seja: hoje isto é estrutura de dados dormindo. O dia em que o
-- primeiro franqueado for cadastrado é o dia em que ela acorda, e aí a
-- mudança de comportamento é observável num usuário só.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. CONSULTORIAS
-- ---------------------------------------------------------------------
create table if not exists public.consultorias (
  id               uuid primary key default gen_random_uuid(),
  nome             text not null check (length(btrim(nome)) between 2 and 120),
  cnpj             text,
  responsavel      text,
  email_contato    text,
  -- Data da certificação no método. Nula = ainda em formação.
  -- Não bloqueia nada por si; existe para a auditoria da franquia
  -- responder "desde quando esta consultoria está apta".
  certificada_em   date,
  is_active        boolean not null default true,
  observacao       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint consultorias_cnpj_digitos check (cnpj is null or cnpj ~ '^[0-9]{14}$')
);

create unique index if not exists consultorias_cnpj_uidx
  on public.consultorias (cnpj) where cnpj is not null;

drop trigger if exists set_updated_at on public.consultorias;
create trigger set_updated_at before update on public.consultorias
  for each row execute function public.tg_set_updated_at();

comment on table public.consultorias is
  'Franqueados da microfranquia Business Triage. Cada um responde por uma '
  'carteira de empresas.';

-- ---------------------------------------------------------------------
-- 2. QUEM TRABALHA EM CADA CONSULTORIA
-- ---------------------------------------------------------------------
-- Separado de `memberships` de propósito: aquilo é vínculo com EMPRESA,
-- isto é vínculo com CONSULTORIA. Misturar os dois faria o consultor
-- precisar de uma membership em cada cliente só para enxergar a carteira
-- — e cada uma dessas linhas apareceria na tela de Usuários do cliente,
-- sugerindo um acesso que não é o que está acontecendo.

do $$ begin
  create type public.papel_consultor as enum ('titular', 'consultor');
exception when duplicate_object then null; end $$;

create table if not exists public.consultores (
  consultoria_id uuid not null references public.consultorias(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  papel          public.papel_consultor not null default 'consultor',
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  primary key (consultoria_id, user_id)
);

create index if not exists consultores_user_idx
  on public.consultores (user_id) where is_active;

comment on table public.consultores is
  'Vínculo pessoa ↔ consultoria. Distinto de memberships, que é o vínculo '
  'com a empresa cliente.';

-- ---------------------------------------------------------------------
-- 3. A EMPRESA PASSA A TER DONO
-- ---------------------------------------------------------------------
-- Nulo significa "carteira da própria Business Triage". Todas as empresas
-- existentes ficam assim, e é o comportamento correto: elas são suas.
--
-- `on delete set null` de propósito. Se uma consultoria for encerrada, as
-- empresas dela não podem desaparecer junto — voltam para a franqueadora,
-- que é exatamente o que acontece na vida real quando um franqueado sai.

alter table public.tenants
  add column if not exists consultoria_id uuid references public.consultorias(id) on delete set null;

create index if not exists tenants_consultoria_idx
  on public.tenants (consultoria_id) where consultoria_id is not null;

comment on column public.tenants.consultoria_id is
  'Consultoria responsável pela empresa. Nulo = carteira da própria Business '
  'Triage. Encerrar uma consultoria devolve as empresas dela à franqueadora.';

-- ---------------------------------------------------------------------
-- 4. AS FUNÇÕES DO NÍVEL NOVO
-- ---------------------------------------------------------------------
-- SECURITY DEFINER e search_path fixo, pelos mesmos motivos das demais:
-- policy que faz subquery direta em tabela com RLS entra em recursão.

/** Consultorias ativas às quais o usuário pertence. */
create or replace function public.minhas_consultorias()
returns setof uuid language sql stable security definer
set search_path = public, pg_temp as $$
  select c.consultoria_id
    from public.consultores c
    join public.consultorias k on k.id = c.consultoria_id
   where c.user_id = auth.uid() and c.is_active and k.is_active;
$$;

/**
 * O usuário é consultor responsável por esta empresa?
 *
 * Enquanto `consultores` estiver vazia, isto devolve `false` para todo
 * mundo — que é o que mantém esta migração inerte.
 */
create or replace function public.is_consultor_de(p_tenant_id uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (
    select 1
      from public.tenants t
      join public.consultores c on c.consultoria_id = t.consultoria_id
      join public.consultorias k on k.id = c.consultoria_id
     where t.id = p_tenant_id
       and c.user_id = auth.uid()
       and c.is_active and k.is_active
  );
$$;

/** Titular da consultoria — pode gerir consultores e a própria carteira. */
create or replace function public.is_titular_de_consultoria(p_consultoria_id uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.consultores c
     where c.consultoria_id = p_consultoria_id
       and c.user_id = auth.uid()
       and c.is_active and c.papel = 'titular'
  );
$$;

revoke all on function public.minhas_consultorias()             from public;
revoke all on function public.is_consultor_de(uuid)             from public;
revoke all on function public.is_titular_de_consultoria(uuid)   from public;
grant execute on function public.minhas_consultorias()           to authenticated;
grant execute on function public.is_consultor_de(uuid)           to authenticated;
grant execute on function public.is_titular_de_consultoria(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. RLS DAS TABELAS NOVAS
-- ---------------------------------------------------------------------
alter table public.consultorias enable row level security;
alter table public.consultores  enable row level security;

-- O franqueador vê todas; o consultor vê a própria.
drop policy if exists consultorias_select on public.consultorias;
create policy consultorias_select on public.consultorias
  for select to authenticated
  using (public.is_platform_staff() or id in (select public.minhas_consultorias()));

-- Criar e encerrar consultoria é ato da franqueadora. Não se autoriza a si
-- mesmo a operar a marca.
drop policy if exists consultorias_write on public.consultorias;
create policy consultorias_write on public.consultorias
  for all to authenticated
  using (public.is_platform_staff())
  with check (public.is_platform_staff());

drop policy if exists consultores_select on public.consultores;
create policy consultores_select on public.consultores
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_platform_staff()
    or consultoria_id in (select public.minhas_consultorias())
  );

-- O titular monta a própria equipe; a franqueadora pode tudo.
drop policy if exists consultores_write on public.consultores;
create policy consultores_write on public.consultores
  for all to authenticated
  using (public.is_platform_staff() or public.is_titular_de_consultoria(consultoria_id))
  with check (public.is_platform_staff() or public.is_titular_de_consultoria(consultoria_id));

grant select on public.consultorias to authenticated;
grant select on public.consultores  to authenticated;
grant insert, update, delete on public.consultorias to authenticated;
grant insert, update, delete on public.consultores  to authenticated;

-- ---------------------------------------------------------------------
-- 6. AS POLICIES EXISTENTES GANHAM O TERMO NOVO
-- ---------------------------------------------------------------------
-- Só leitura e só onde o consultor precisa enxergar para trabalhar. As
-- policies de ESCRITA no financeiro do cliente permanecem como estão: o
-- consultor que precisar lançar algo continua tendo de virar membro da
-- empresa, e isso continua aparecendo na tela de Usuários do cliente.
--
-- Essa assimetria é deliberada. Ver a carteira é função do papel; mexer
-- no caixa de alguém é ato que precisa deixar rastro visível ao dono.

drop policy if exists tenants_select on public.tenants;
create policy tenants_select on public.tenants
  for select to authenticated
  using (
    public.is_tenant_member(id)
    or public.is_platform_staff()
    or public.is_consultor_de(id)
  );

drop policy if exists marcos_zero_select on public.marcos_zero;
create policy marcos_zero_select on public.marcos_zero
  for select to authenticated
  using (
    public.is_tenant_member(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  );

drop policy if exists planos_select on public.planos_acao;
create policy planos_select on public.planos_acao
  for select to authenticated
  using (
    public.is_tenant_member(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  );

drop policy if exists planos_write on public.planos_acao;
create policy planos_write on public.planos_acao
  for all to authenticated
  using (public.is_platform_staff() or public.is_consultor_de(tenant_id))
  with check (public.is_platform_staff() or public.is_consultor_de(tenant_id));

drop policy if exists acoes_select on public.acoes;
create policy acoes_select on public.acoes
  for select to authenticated
  using (
    public.is_tenant_member(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  );

drop policy if exists acoes_insert on public.acoes;
create policy acoes_insert on public.acoes
  for insert to authenticated
  with check (public.is_platform_staff() or public.is_consultor_de(tenant_id));

drop policy if exists acoes_delete on public.acoes;
create policy acoes_delete on public.acoes
  for delete to authenticated
  using (public.is_platform_staff() or public.is_consultor_de(tenant_id));

drop policy if exists acoes_update on public.acoes;
create policy acoes_update on public.acoes
  for update to authenticated
  using (
    public.can_write_tenant(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  )
  with check (
    public.can_write_tenant(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  );

drop policy if exists acao_eventos_select on public.acao_eventos;
create policy acao_eventos_select on public.acao_eventos
  for select to authenticated
  using (
    public.is_tenant_member(tenant_id)
    or public.is_platform_staff()
    or public.is_consultor_de(tenant_id)
  );

-- O trigger que protege os campos da ação também precisa reconhecer o
-- consultor: sem isto, ele reverteria as edições do próprio autor do plano.
create or replace function public.tg_acao_protege_campos()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if public.is_platform_staff() or public.is_consultor_de(new.tenant_id) then
    return new;
  end if;

  -- Cliente: só o status muda.
  new.titulo           := old.titulo;
  new.detalhe          := old.detalhe;
  new.causa_raiz       := old.causa_raiz;
  new.pilar            := old.pilar;
  new.responsavel_nome := old.responsavel_nome;
  new.prazo            := old.prazo;
  new.ordem            := old.ordem;
  new.plano_id         := old.plano_id;
  new.tenant_id        := old.tenant_id;
  new.verificacao      := old.verificacao;

  if new.status = 'concluida' and old.status <> 'concluida' then
    new.concluida_em  := now();
    new.concluida_por := auth.uid();
  elsif new.status <> 'concluida' then
    new.concluida_em  := null;
    new.concluida_por := null;
  end if;

  return new;
end $$;

-- ---------------------------------------------------------------------
-- 7. A CARTEIRA PASSA A MOSTRAR DE QUEM É CADA EMPRESA
-- ---------------------------------------------------------------------
-- Derrubada antes de recriar: `create or replace view` só acrescenta
-- coluna no fim da lista, e `consultoria_id` entra no meio. Trocar a
-- ordem por isso deixaria a leitura da view pior para sempre.
drop view if exists public.vw_staff_tenants;

create view public.vw_staff_tenants
with (security_invoker = on) as
select
  t.id,
  t.name,
  t.tax_id,
  t.is_active,
  t.created_at,
  t.consultoria_id,
  k.nome                                                 as consultoria,
  (select count(*) from public.memberships m
    where m.tenant_id = t.id and m.is_active)            as qtd_usuarios,
  (select count(*) from public.transactions x
    where x.tenant_id = t.id)                            as qtd_lancamentos,
  (select max(x.created_at) from public.transactions x
    where x.tenant_id = t.id)                            as ultimo_lancamento,
  mz.score_total                                         as marco_zero_score,
  mz.assinado_em                                         as marco_zero_em,
  (select d.score_total from public.diagnosticos d
    where d.tenant_id = t.id and d.score_total is not null
    order by d.created_at desc limit 1)                  as score_atual
from public.tenants t
left join public.marcos_zero mz on mz.tenant_id = t.id
left join public.consultorias k on k.id = t.consultoria_id;

grant select on public.vw_staff_tenants to authenticated;

-- Visão da franquia: uma linha por consultoria, para a auditoria do método.
create or replace view public.vw_consultorias
with (security_invoker = on) as
select
  k.id,
  k.nome,
  k.cnpj,
  k.responsavel,
  k.email_contato,
  k.certificada_em,
  k.is_active,
  (select count(*) from public.consultores c
    where c.consultoria_id = k.id and c.is_active)        as qtd_consultores,
  (select count(*) from public.tenants t
    where t.consultoria_id = k.id and t.is_active)        as qtd_clientes,
  (select count(*) from public.tenants t
    join public.marcos_zero m on m.tenant_id = t.id
   where t.consultoria_id = k.id and t.is_active)         as com_marco_zero,
  (select count(*) from public.tenants t
    join public.planos_acao p on p.tenant_id = t.id and p.status = 'ativo'
   where t.consultoria_id = k.id and t.is_active)         as com_plano_ativo
from public.consultorias k
where public.is_platform_staff() or k.id in (select public.minhas_consultorias());

comment on view public.vw_consultorias is
  'Carteira por franqueado, com os indicadores de aderência ao método: quantos '
  'clientes têm marco zero e plano ativo. É a auditoria da franquia em painel.';

grant select on public.vw_consultorias to authenticated;

-- ---------------------------------------------------------------------
-- 8. CONFERÊNCIA
-- ---------------------------------------------------------------------
-- A prova de que a migração é inerte — todas devem voltar vazias ou zero:
--
--   select count(*) from public.consultorias;   -- 0
--   select count(*) from public.consultores;    -- 0
--   select count(*) from public.tenants where consultoria_id is not null;  -- 0
--
-- E a carteira precisa continuar exatamente como estava:
--
--   select name, consultoria, marco_zero_score from public.vw_staff_tenants;
--
-- Quando for cadastrar o primeiro franqueado:
--
--   insert into public.consultorias (nome, responsavel, email_contato)
--   values ('Consultoria Silva', 'João Silva', 'joao@exemplo.com');
--
--   insert into public.consultores (consultoria_id, user_id, papel)
--   select k.id, p.id, 'titular'
--     from public.consultorias k, public.profiles p
--    where k.nome = 'Consultoria Silva' and p.email = 'joao@exemplo.com';
--
--   update public.tenants set consultoria_id = (
--     select id from public.consultorias where nome = 'Consultoria Silva'
--   ) where name = 'Empresa Cliente';
--
-- Depois de aplicar:  notify pgrst, 'reload schema';
