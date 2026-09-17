-- =====================================================================
-- 40 — Treinamento: módulos, aulas, atividades e progresso
-- =====================================================================
-- A ementa é DADO, não código. O curso está sendo gravado e a estrutura
-- vai mudar; um layout esculpido sobre uma lista fixa de aulas quebraria
-- na primeira alteração. Aqui as aulas entram por cadastro.
--
-- ---------------------------------------------------------------------
-- A DECISÃO QUE DEFINE O MÓDULO
-- ---------------------------------------------------------------------
-- As atividades do curso são exercícios com os números da própria
-- empresa: "liste seus custos fixos", "informe seus prazos médios". As
-- tabelas que guardam isso já existem — `mix_custos_fixos`,
-- `mix_produtos`, `transactions`.
--
-- Então a atividade tem um `destino`: quando ele existe, a resposta é
-- gravada NA TABELA REAL, e a ferramenta correspondente já aparece
-- preenchida. O curso vira o onboarding da plataforma.
--
-- Quando não há destino — reflexão, texto livre, múltipla escolha —, a
-- resposta fica em `curso_respostas` e serve ao acompanhamento.
--
-- ---------------------------------------------------------------------
-- O CURSO NÃO É POR EMPRESA; O PROGRESSO É
-- ---------------------------------------------------------------------
-- Módulos, aulas e atividades são o MESMO conteúdo para todo mundo, e
-- por isso não têm `tenant_id`: são catálogo, como `recursos` e `planos`.
-- Só progresso e resposta pertencem a uma empresa.
--
-- Copiar o curso por empresa seria o erro clássico: corrigir um erro de
-- digitação numa aula viraria uma migração em sessenta linhas.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. CATÁLOGO
-- ---------------------------------------------------------------------

create table if not exists public.curso_modulos (
  id          uuid primary key default gen_random_uuid(),

  -- Prepara para mais de um curso sem exigir uma tabela `cursos` agora.
  -- Com um só no ar, uma tabela a mais seria cerimônia.
  curso       text not null default 'financas-mpe',

  ordem       int  not null,
  titulo      text not null check (length(btrim(titulo)) between 2 and 160),
  descricao   text,
  duracao_min int,

  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (curso, ordem)
);

create table if not exists public.curso_aulas (
  id          uuid primary key default gen_random_uuid(),
  modulo_id   uuid not null references public.curso_modulos(id) on delete cascade,

  ordem       int  not null,
  titulo      text not null check (length(btrim(titulo)) between 2 and 200),
  descricao   text,

  -- Só o ID do vídeo, não a URL inteira. O YouTube muda o formato do
  -- endereço de tempos em tempos, e guardar a URL significaria reescrever
  -- todas as linhas quando isso acontecer.
  youtube_id  text check (youtube_id is null or youtube_id ~ '^[A-Za-z0-9_-]{6,20}$'),

  duracao_min int,

  -- Material de apoio: PDF, planilha. Lista de {nome, url}.
  anexos      jsonb not null default '[]'::jsonb,

  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (modulo_id, ordem)
);

create index if not exists curso_aulas_modulo_idx
  on public.curso_aulas (modulo_id, ordem) where is_active;

-- ---------------------------------------------------------------------
-- 2. ATIVIDADES
-- ---------------------------------------------------------------------
do $$ begin
  create type public.atividade_tipo as enum (
    'texto',        -- resposta dissertativa
    'numero',       -- um valor
    'multipla',     -- escolha entre opções de `config.opcoes`
    'checklist',    -- várias marcações
    'ferramenta'    -- preenche uma tabela real da plataforma
  );
exception when duplicate_object then null; end $$;

do $$ begin
  -- Para onde a resposta vai quando o tipo é `ferramenta`.
  create type public.atividade_destino as enum (
    'custos_fixos',   -- mix_custos_fixos
    'produtos',       -- mix_produtos
    'prazos',         -- PMR/PMP/PME usados no capital de giro
    'lancamentos'     -- transactions
  );
exception when duplicate_object then null; end $$;

create table if not exists public.curso_atividades (
  id         uuid primary key default gen_random_uuid(),

  -- Atividade de aula OU de módulo (a dinâmica de fechamento). Uma das
  -- duas, nunca as duas.
  aula_id    uuid references public.curso_aulas(id) on delete cascade,
  modulo_id  uuid references public.curso_modulos(id) on delete cascade,

  ordem      int  not null default 0,
  titulo     text not null check (length(btrim(titulo)) between 2 and 200),
  enunciado  text not null,

  tipo       public.atividade_tipo not null default 'texto',
  destino    public.atividade_destino,

  -- Opções, unidade, limites, texto de ajuda. O que cada tipo precisa
  -- sem exigir uma coluna por variação.
  config     jsonb not null default '{}'::jsonb,

  obrigatoria boolean not null default false,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint curso_atividades_dono_ck check (
    (aula_id is not null and modulo_id is null)
    or (aula_id is null and modulo_id is not null)
  ),

  -- `destino` só faz sentido em atividade de ferramenta, e atividade de
  -- ferramenta sem destino não teria onde gravar.
  constraint curso_atividades_destino_ck check (
    (tipo = 'ferramenta' and destino is not null)
    or (tipo <> 'ferramenta' and destino is null)
  )
);

create index if not exists curso_atividades_aula_idx
  on public.curso_atividades (aula_id, ordem) where is_active;
create index if not exists curso_atividades_modulo_idx
  on public.curso_atividades (modulo_id, ordem) where is_active;

-- ---------------------------------------------------------------------
-- 3. PROGRESSO E RESPOSTAS — por empresa
-- ---------------------------------------------------------------------

create table if not exists public.curso_progresso (
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  aula_id       uuid not null references public.curso_aulas(id) on delete cascade,

  -- Quem assistiu, dentro da empresa. Duas pessoas da mesma empresa
  -- fazem o curso em ritmos diferentes.
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,

  segundos      int not null default 0 check (segundos >= 0),
  concluida     boolean not null default false,
  concluida_em  timestamptz,

  atualizado_em timestamptz not null default now(),

  primary key (tenant_id, aula_id, user_id)
);

create index if not exists curso_progresso_tenant_idx
  on public.curso_progresso (tenant_id, concluida);

create table if not exists public.curso_respostas (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  atividade_id uuid not null references public.curso_atividades(id) on delete cascade,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,

  -- jsonb porque o formato muda com o tipo: texto, número, lista de
  -- marcações. Uma coluna por tipo deixaria quatro nulas em cada linha.
  resposta     jsonb not null,

  -- Quando a atividade tem destino, isto registra que a gravação na
  -- tabela real aconteceu. Sem esse campo, "respondi e não apareceu na
  -- ferramenta" vira investigação em vez de consulta.
  aplicada_em  timestamptz,
  aplicada_erro text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  unique (tenant_id, atividade_id, user_id)
);

create index if not exists curso_respostas_tenant_idx
  on public.curso_respostas (tenant_id);

-- ---------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------
-- Catálogo: leitura para qualquer autenticado. O conteúdo é o mesmo para
-- todo mundo, e o que separa quem vê de quem não vê é o RECURSO, não o
-- RLS — a aba some para quem não tem, como o CRM e o diagnóstico.
--
-- Escrita no catálogo: só staff.
alter table public.curso_modulos    enable row level security;
alter table public.curso_aulas      enable row level security;
alter table public.curso_atividades enable row level security;
alter table public.curso_progresso  enable row level security;
alter table public.curso_respostas  enable row level security;

drop policy if exists curso_modulos_leitura on public.curso_modulos;
create policy curso_modulos_leitura on public.curso_modulos
  for select to authenticated using (true);

drop policy if exists curso_modulos_staff on public.curso_modulos;
create policy curso_modulos_staff on public.curso_modulos
  for all using (public.is_platform_staff()) with check (public.is_platform_staff());

drop policy if exists curso_aulas_leitura on public.curso_aulas;
create policy curso_aulas_leitura on public.curso_aulas
  for select to authenticated using (true);

drop policy if exists curso_aulas_staff on public.curso_aulas;
create policy curso_aulas_staff on public.curso_aulas
  for all using (public.is_platform_staff()) with check (public.is_platform_staff());

drop policy if exists curso_atividades_leitura on public.curso_atividades;
create policy curso_atividades_leitura on public.curso_atividades
  for select to authenticated using (true);

drop policy if exists curso_atividades_staff on public.curso_atividades;
create policy curso_atividades_staff on public.curso_atividades
  for all using (public.is_platform_staff()) with check (public.is_platform_staff());

-- Progresso e resposta: cada um vê e escreve o da sua empresa.
drop policy if exists curso_progresso_rw on public.curso_progresso;
create policy curso_progresso_rw on public.curso_progresso
  for all
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

drop policy if exists curso_respostas_rw on public.curso_respostas;
create policy curso_respostas_rw on public.curso_respostas
  for all
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

-- ---------------------------------------------------------------------
-- 5. O RECURSO
-- ---------------------------------------------------------------------
-- Fora de `plano_recursos` de propósito: é isso que o mantém desligado
-- por padrão. O período de gratuidade é uma concessão em
-- `tenant_recursos` com `fim` preenchido — o recurso cai sozinho no
-- vencimento, sem ninguém precisar lembrar.
insert into public.recursos (codigo, nome, descricao, ordem) values
  ('treinamento', 'Treinamento',
   'Curso em video com atividades que alimentam as ferramentas da plataforma.', 35)
on conflict (codigo) do update set
  nome = excluded.nome, descricao = excluded.descricao, ordem = excluded.ordem;

-- ---------------------------------------------------------------------
-- 6. OS QUATRO MÓDULOS
-- ---------------------------------------------------------------------
-- Só o esqueleto. Aulas e atividades entram pelo cadastro, conforme os
-- vídeos ficarem prontos.
insert into public.curso_modulos (curso, ordem, titulo, descricao, duracao_min) values
  ('financas-mpe', 1, 'Fundamentos e Organização Financeira',
   'Separar as contas, entender de onde vem e para onde vai o dinheiro, e montar a base sobre a qual todo o resto se apoia.', 120),
  ('financas-mpe', 2, 'Gestão de Caixa e Operação Diária',
   'O dia a dia do caixa: contas a pagar e receber, ciclo financeiro e a rotina que evita o susto do fim do mes.', 120),
  ('financas-mpe', 3, 'Formação de Preço e Margens de Lucro',
   'Quanto cobrar, quanto sobra e por que vender mais nem sempre melhora o resultado.', 120),
  ('financas-mpe', 4, 'Planejamento, Capital de Giro e Indicadores de Decisão',
   'Do retrovisor para o para-brisa: projetar, dimensionar o giro e escolher os poucos numeros que guiam a decisao.', 120)
on conflict (curso, ordem) do update set
  titulo = excluded.titulo,
  descricao = excluded.descricao,
  duracao_min = excluded.duracao_min;

-- ---------------------------------------------------------------------
-- 7. VISÃO DE PROGRESSO
-- ---------------------------------------------------------------------
drop view if exists public.vw_curso_progresso;

create view public.vw_curso_progresso
with (security_invoker = on) as
select
  p.tenant_id,
  m.curso,
  m.id      as modulo_id,
  m.ordem   as modulo_ordem,
  m.titulo  as modulo,
  count(a.id)::int                                  as aulas,
  count(*) filter (where p.concluida)::int          as concluidas,
  round(
    100.0 * count(*) filter (where p.concluida) / nullif(count(a.id), 0)
  , 0)::int as percentual,
  max(p.concluida_em) as ultima_conclusao
from public.curso_aulas a
join public.curso_modulos m on m.id = a.modulo_id
left join public.curso_progresso p on p.aula_id = a.id
where a.is_active and m.is_active
group by p.tenant_id, m.curso, m.id, m.ordem, m.titulo;

comment on view public.vw_curso_progresso is
  'Progresso do treinamento por modulo e empresa.';

notify pgrst, 'reload schema';
