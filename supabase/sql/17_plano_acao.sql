-- =====================================================================
-- 17 — PLANO DE AÇÃO (PDCA)
-- =====================================================================
-- O cliente vê as ações que precisa executar e marca conforme realiza.
-- O consultor vê o quadro consolidado e sabe, sem perguntar, o que está
-- parado.
--
-- É a peça que muda o que a reunião de consultoria é. Sem o quadro, ela
-- começa com "e aí, como foram as ações?" e a resposta é uma versão
-- editada da memória. Com ele, começa com "a ação 3 está 40 dias parada".
--
-- ESCOPO DELIBERADAMENTE PEQUENO. Ações com dono, prazo e check, mais a
-- visão do consultor. Matriz GUT, 5W2H completo e o resto do PDCA ficam
-- fora: o que decide se isto funciona não é a riqueza do modelo, é o
-- cliente marcar o check na terceira semana.
--
-- Três decisões que valem mais que o schema:
--
--   • POUCAS AÇÕES ABERTAS. O limite não é técnico, é de método — lista
--     longa não é acompanhada, é ignorada. A view expõe a contagem para a
--     tela poder avisar.
--
--   • HISTÓRICO DE MARCAÇÃO, não um booleano. Saber QUANDO foi marcado é
--     o que permite ver ritmo. E desmarcar precisa deixar rastro: ação
--     que foi concluída e voltou a aberta é informação, não erro.
--
--   • O SINAL É A AUSÊNCIA. Não o que foi marcado, e sim quem parou de
--     marcar. Catorze dias sem movimento antecede o cancelamento.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TIPOS
-- ---------------------------------------------------------------------
do $$ begin
  create type public.acao_status as enum ('aberta', 'concluida', 'cancelada');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.plano_status as enum ('rascunho', 'ativo', 'encerrado');
exception when duplicate_object then null; end $$;

-- Taxonomia fixa de causas-raiz, igual à do ROTEIRO-PDCA.md.
--
-- Lista fechada de propósito: com etiqueta livre, cada diagnóstico é
-- único e nada se acumula. Com dez etiquetas, depois de trinta entrevistas
-- dá para perguntar "o que funcionou nas empresas com `sem-dono`?" — e aí
-- existe acervo, em vez de recomeçar do zero toda vez.
--
-- Como enum, e não texto livre: o banco recusa a etiqueta inventada no
-- calor da entrevista, que é exatamente quando a disciplina cede.
do $$ begin
  create type public.causa_raiz as enum (
    'sem-registro',
    'sem-dono',
    'sem-criterio',
    'sem-padrao',
    'dependencia-pessoa',
    'ferramenta-inadequada',
    'capacidade',
    'demanda-irregular',
    'mistura-pf-pj',
    'concentracao'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 2. PLANO
-- ---------------------------------------------------------------------
-- Um plano por ciclo de PDCA. A empresa pode ter vários ao longo do
-- tempo, mas só um ativo — é o que impede o quadro de virar depósito de
-- tudo que já foi prescrito.

create table if not exists public.planos_acao (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  titulo         text not null check (length(btrim(titulo)) between 3 and 160),
  ciclo          text,                       -- "1º ciclo", "Set-Nov/2026"
  origem_tipo    public.diagnostico_tipo,
  diagnostico_id uuid references public.diagnosticos(id) on delete set null,
  status         public.plano_status not null default 'ativo',
  pdf_path       text,                       -- o PLAN apresentado, no Storage
  observacao     text,
  criado_por     uuid default auth.uid() references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index if not exists planos_acao_um_ativo_idx
  on public.planos_acao (tenant_id) where status = 'ativo';

create index if not exists planos_acao_tenant_idx
  on public.planos_acao (tenant_id, created_at desc);

drop trigger if exists set_updated_at on public.planos_acao;
create trigger set_updated_at before update on public.planos_acao
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------
-- 3. AÇÃO
-- ---------------------------------------------------------------------
-- `responsavel_nome` é texto, não referência a usuário. O dono da ação
-- costuma ser alguém que não tem login — o gerente, a recepcionista, o
-- contador externo. Exigir conta para poder ser responsável faria a
-- prescrição caber no sistema em vez de caber na empresa.

create table if not exists public.acoes (
  id              uuid primary key default gen_random_uuid(),
  plano_id        uuid not null references public.planos_acao(id) on delete cascade,
  tenant_id       uuid not null references public.tenants(id) on delete cascade,

  titulo          text not null check (length(btrim(titulo)) between 3 and 200),
  detalhe         text,
  causa_raiz      public.causa_raiz,
  pilar           text,                      -- "Liquidez", "Geração de Demanda"

  responsavel_nome text not null check (length(btrim(responsavel_nome)) >= 2),
  prazo           date not null,
  ordem           int not null default 0,

  status          public.acao_status not null default 'aberta',
  concluida_em    timestamptz,
  concluida_por   uuid references auth.users(id) on delete set null,

  -- Quando a ação puder ser verificada pelo próprio sistema, este campo
  -- diz por qual sinal. Fica nulo nas ações de check manual, que são a
  -- maioria no começo. Ex.: 'retiradas_separadas', 'lancamentos_semanais'.
  verificacao     text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- Coerência entre status e data: 'concluida' sem data, ou data em ação
  -- aberta, são estados que a tela mostraria de forma contraditória.
  constraint acao_conclusao_ck check (
    (status = 'concluida' and concluida_em is not null)
    or (status <> 'concluida' and concluida_em is null)
  )
);

create index if not exists acoes_tenant_status_idx
  on public.acoes (tenant_id, status, prazo);

create index if not exists acoes_plano_idx
  on public.acoes (plano_id, ordem);

drop trigger if exists set_updated_at on public.acoes;
create trigger set_updated_at before update on public.acoes
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------
-- 4. HISTÓRICO DE MARCAÇÃO
-- ---------------------------------------------------------------------
-- Cada vez que alguém marca ou desmarca, uma linha. É daqui que sai o
-- ritmo: uma ação concluída no prazo e cinco marcadas de uma vez na
-- véspera da reunião contam histórias diferentes, e o booleano não
-- distingue as duas.

create table if not exists public.acao_eventos (
  id         bigserial primary key,
  acao_id    uuid not null references public.acoes(id) on delete cascade,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  de         public.acao_status,
  para       public.acao_status not null,
  comentario text,
  quem       uuid default auth.uid() references auth.users(id) on delete set null,
  em         timestamptz not null default now()
);

create index if not exists acao_eventos_tenant_idx
  on public.acao_eventos (tenant_id, em desc);

-- Registra sozinho. Deixar isso a cargo da aplicação significaria que a
-- primeira alteração feita direto no banco — ou por outro cliente da API —
-- passaria despercebida.
create or replace function public.tg_acao_evento()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    insert into public.acao_eventos (acao_id, tenant_id, de, para)
    values (new.id, new.tenant_id, null, new.status);
  elsif new.status is distinct from old.status then
    insert into public.acao_eventos (acao_id, tenant_id, de, para)
    values (new.id, new.tenant_id, old.status, new.status);
  end if;
  return new;
end $$;

drop trigger if exists acao_evento on public.acoes;
create trigger acao_evento after insert or update on public.acoes
  for each row execute function public.tg_acao_evento();

-- ---------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------
-- A divisão de papéis é o coração desta parte:
--
--   O CONSULTOR PRESCREVE  — cria, edita e apaga planos e ações.
--   O CLIENTE EXECUTA      — lê tudo e altera apenas o status da ação.
--
-- Se o cliente pudesse editar o texto, o prazo ou o responsável, o plano
-- deixaria de ser um compromisso combinado e viraria uma lista de desejos
-- reescrita conforme a conveniência. E o consultor perderia a única coisa
-- que o quadro precisa preservar: o que foi realmente acordado.

alter table public.planos_acao  enable row level security;
alter table public.acoes        enable row level security;
alter table public.acao_eventos enable row level security;

-- Planos: cliente lê, staff faz tudo.
drop policy if exists planos_select on public.planos_acao;
create policy planos_select on public.planos_acao
  for select to authenticated
  using (public.is_tenant_member(tenant_id) or public.is_platform_staff());

drop policy if exists planos_write on public.planos_acao;
create policy planos_write on public.planos_acao
  for all to authenticated
  using (public.is_platform_staff())
  with check (public.is_platform_staff());

-- Ações: cliente lê.
drop policy if exists acoes_select on public.acoes;
create policy acoes_select on public.acoes
  for select to authenticated
  using (public.is_tenant_member(tenant_id) or public.is_platform_staff());

-- Só o staff cria e apaga.
drop policy if exists acoes_insert on public.acoes;
create policy acoes_insert on public.acoes
  for insert to authenticated
  with check (public.is_platform_staff());

drop policy if exists acoes_delete on public.acoes;
create policy acoes_delete on public.acoes
  for delete to authenticated
  using (public.is_platform_staff());

-- Update: o cliente passa, mas o gatilho abaixo limita o que ele pode
-- mudar. A policy sozinha não consegue comparar valor antigo com novo
-- coluna a coluna — por isso a regra fina vive num trigger.
drop policy if exists acoes_update on public.acoes;
create policy acoes_update on public.acoes
  for update to authenticated
  using (public.can_write_tenant(tenant_id) or public.is_platform_staff())
  with check (public.can_write_tenant(tenant_id) or public.is_platform_staff());

create or replace function public.tg_acao_protege_campos()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if public.is_platform_staff() then
    return new;
  end if;

  -- Cliente: só o status muda. Qualquer outra alteração é revertida em
  -- silêncio para o valor original, em vez de gerar erro — assim uma tela
  -- que mande o registro inteiro no PATCH continua funcionando, e o que
  -- não pode mudar simplesmente não muda.
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

  -- Coerência da conclusão, para o cliente não precisar mandar a data.
  if new.status = 'concluida' and old.status <> 'concluida' then
    new.concluida_em  := now();
    new.concluida_por := auth.uid();
  elsif new.status <> 'concluida' then
    new.concluida_em  := null;
    new.concluida_por := null;
  end if;

  return new;
end $$;

drop trigger if exists acao_protege_campos on public.acoes;
create trigger acao_protege_campos before update on public.acoes
  for each row execute function public.tg_acao_protege_campos();

-- Eventos: leitura para quem pertence à empresa; escrita só pelo gatilho.
drop policy if exists acao_eventos_select on public.acao_eventos;
create policy acao_eventos_select on public.acao_eventos
  for select to authenticated
  using (public.is_tenant_member(tenant_id) or public.is_platform_staff());

grant select on public.planos_acao  to authenticated;
grant select on public.acoes        to authenticated;
grant select on public.acao_eventos to authenticated;
grant insert, update, delete on public.planos_acao to authenticated;
grant insert, update, delete on public.acoes       to authenticated;

-- ---------------------------------------------------------------------
-- 6. O QUADRO DO CLIENTE
-- ---------------------------------------------------------------------
create or replace view public.vw_quadro_acoes
with (security_invoker = on) as
select
  a.id,
  a.tenant_id,
  a.plano_id,
  p.titulo                                   as plano,
  a.titulo,
  a.detalhe,
  a.pilar,
  a.causa_raiz,
  a.responsavel_nome,
  a.prazo,
  a.status,
  a.concluida_em,
  a.ordem,
  (a.prazo - current_date)                   as dias_para_o_prazo,
  a.status = 'aberta' and a.prazo < current_date  as atrasada,
  (select max(e.em) from public.acao_eventos e where e.acao_id = a.id)
                                             as ultimo_movimento
from public.acoes a
join public.planos_acao p on p.id = a.plano_id
where p.status = 'ativo';

comment on view public.vw_quadro_acoes is
  'Ações do plano ativo, para o quadro do cliente. Ordene por (status, prazo, ordem).';

grant select on public.vw_quadro_acoes to authenticated;

-- ---------------------------------------------------------------------
-- 7. O CONSOLIDADO DO CONSULTOR
-- ---------------------------------------------------------------------
-- Uma linha por empresa. `dias_sem_movimento` é a coluna que importa: é
-- ela que responde "quem parou", que é a pergunta que antecede todas as
-- outras.

create or replace view public.vw_pdca_consultor
with (security_invoker = on) as
select
  t.id                                          as tenant_id,
  t.name,
  p.id                                          as plano_id,
  p.titulo                                      as plano,
  p.ciclo,
  count(a.id)                                   as total,
  count(a.id) filter (where a.status = 'aberta')     as abertas,
  count(a.id) filter (where a.status = 'concluida')  as concluidas,
  count(a.id) filter (
    where a.status = 'aberta' and a.prazo < current_date
  )                                             as atrasadas,
  round(100.0 * count(a.id) filter (where a.status = 'concluida')
        / nullif(count(a.id), 0), 0)            as conclusao_pct,
  max(e.em)                                     as ultimo_movimento,
  case
    when max(e.em) is null then null
    else floor(extract(epoch from (now() - max(e.em))) / 86400)::int
  end                                           as dias_sem_movimento
from public.tenants t
join public.planos_acao p on p.tenant_id = t.id and p.status = 'ativo'
left join public.acoes a on a.plano_id = p.id
left join public.acao_eventos e on e.acao_id = a.id
where t.is_active
group by t.id, t.name, p.id, p.titulo, p.ciclo;

comment on view public.vw_pdca_consultor is
  'Consolidado dos planos ativos por empresa. `dias_sem_movimento` é o sinal '
  'que antecede o cancelamento.';

grant select on public.vw_pdca_consultor to authenticated;

-- ---------------------------------------------------------------------
-- 8. CONFERÊNCIA
-- ---------------------------------------------------------------------
--   select * from public.vw_pdca_consultor;
--
-- Teste da proteção de campos — logado como CLIENTE (não staff):
--
--   update public.acoes set titulo = 'mudei' where id = '<uuid>';
--   -- deve gravar sem erro e o título deve continuar o original
--   update public.acoes set status = 'concluida' where id = '<uuid>';
--   -- deve concluir e preencher concluida_em sozinho
--
-- E o histórico deve ter duas linhas por ação marcada e desmarcada:
--   select de, para, em from public.acao_eventos where acao_id = '<uuid>' order by em;
--
-- Depois de aplicar:  notify pgrst, 'reload schema';
