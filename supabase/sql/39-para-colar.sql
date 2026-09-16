-- =====================================================================
-- 39 — Corrige a gravação dos custos fixos revisados
-- =====================================================================
-- O QUE ESTAVA QUEBRADO
-- ---------------------------------------------------------------------
-- O índice único de `mix_custos_fixos` era PARCIAL:
--
--   create unique index ... (tenant_id, category_id) where category_id is not null
--
-- A API grava com `upsert ... on conflict (tenant_id, category_id)`, e o
-- Postgres não consegue inferir um índice parcial sem a cláusula `where`
-- junto. Toda gravação falhava.
--
-- O sintoma foi o pior possível: a tela aceitava o clique, não mostrava
-- erro nenhum, e o valor simplesmente não mudava.
--
-- ---------------------------------------------------------------------
-- A CORREÇÃO
-- ---------------------------------------------------------------------
-- Índice único completo. Em Postgres, dois NULL não conflitam entre si
-- por padrão — então itens avulsos (`category_id` nulo) continuam podendo
-- existir vários, e cada revisão de categoria continua sendo única.
--
-- É a diferença entre um índice que o `on conflict` enxerga e um que ele
-- ignora.
-- =====================================================================

drop index if exists public.mix_custos_fixos_categoria_uidx;

create unique index if not exists mix_custos_fixos_categoria_uidx
  on public.mix_custos_fixos (tenant_id, category_id);

comment on index public.mix_custos_fixos_categoria_uidx is
  'Completo, nao parcial: on conflict nao infere indice parcial sem a clausula where. Itens avulsos tem category_id nulo e nao conflitam entre si.';

notify pgrst, 'reload schema';
