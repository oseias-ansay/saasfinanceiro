-- =====================================================================
-- 47 · O GANHO EM DIAS NAS AÇÕES DO PLANO
-- =====================================================================
-- Uma coluna. O Plano de Redução de Ciclo (aula 4.3) não ganha tabela
-- própria: as alavancas viram `acoes` do plano de ação que já existe.
--
-- ---------------------------------------------------------------------
-- POR QUE REAPROVEITAR E NÃO CRIAR
-- ---------------------------------------------------------------------
-- A regra da aula 4.3 é "só entra no plano o que tem RESPONSÁVEL e
-- PRAZO". A tabela `acoes` já exige os dois — `responsavel_nome not
-- null` e `prazo not null` — no próprio banco. Uma tabela nova
-- precisaria reimplementar isso, e provavelmente com menos rigor.
--
-- E há a razão que decide: as ações do plano aparecem no painel inicial
-- como pendências, com o card de "ações em atraso". Uma alavanca numa
-- tabela separada seria vista uma vez, no dia em que foi escrita. Numa
-- `acao`, ela cobra o dono toda semana — que é exatamente o que a aula
-- quer de um plano.
--
-- ---------------------------------------------------------------------
-- COMO SE RECONHECE UMA ALAVANCA DE CICLO
-- ---------------------------------------------------------------------
-- Por `ganho_dias is not null`. Não inventei um `tipo` novo: a coluna
-- que a ferramenta precisa já é o marcador dela, e uma ação comum do
-- PDCA simplesmente não tem ganho em dias.
--
-- O `pilar` também é preenchido com 'Ciclo financeiro' para as
-- alavancas aparecerem agrupadas no relatório do plano — mas quem manda
-- na conta é a coluna, não o texto do pilar, que o consultor pode
-- reescrever.
-- =====================================================================

alter table public.acoes
  add column if not exists ganho_dias numeric(5,1) check (ganho_dias >= 0);

comment on column public.acoes.ganho_dias is
  'Dias que esta alavanca tira do ciclo financeiro (aula 4.3). Nulo em acao '
  'comum do PDCA. Preenchido, marca a acao como alavanca de ciclo e entra na '
  'projecao da ferramenta -- mas so enquanto estiver com status aberta: '
  'alavanca concluida ja teve efeito, e esse efeito ja esta dentro do ciclo '
  'medido dos lancamentos.';

create index if not exists acoes_ganho_dias_idx
  on public.acoes (tenant_id) where ganho_dias is not null;

notify pgrst, 'reload schema';


-- =====================================================================
-- CONFERÊNCIA — rode depois, separado
-- =====================================================================
-- A coluna existe e está vazia (ninguém criou alavanca ainda):
--
-- select count(*) filter (where ganho_dias is not null) as alavancas,
--        count(*) as acoes_total
--   from public.acoes;
--
-- Depois de criar a primeira alavanca pela tela, confira que ela entrou
-- no plano ATIVO do tenant — é ele que alimenta o card de pendências:
--
-- select p.titulo as plano, a.titulo, a.ganho_dias, a.responsavel_nome,
--        a.prazo, a.status
--   from public.acoes a
--   join public.planos_acao p on p.id = a.plano_id
--  where a.ganho_dias is not null
--  order by a.created_at desc;
