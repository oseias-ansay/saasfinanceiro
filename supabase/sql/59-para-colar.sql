-- =====================================================================
-- 59 · A CONVERSA DEIXA DE SER SÓ SOBRE O PLANO
-- =====================================================================
-- O chat sai de dentro do plano de ação e vira assistente do Controle
-- Financeiro. Ele passa a responder sobre contas, caixa, resultado e
-- conceitos — e o plano vira só mais um assunto.
--
-- ---------------------------------------------------------------------
-- POR QUE REAPROVEITAR AS TABELAS, E NÃO CRIAR OUTRAS
-- ---------------------------------------------------------------------
-- `pdca_conversas` e `pdca_mensagens` já têm RLS testado, gatilho de
-- `ultima_em`, contagem de tokens e a função de teto por empresa. Criar
-- um par novo significaria reescrever tudo isso e manter dois conjuntos
-- de policies que precisam concordar para sempre.
--
-- O nome fica, mesmo tendo envelhecido. Renomear tabela em produção
-- quebra o código publicado no intervalo entre o SQL e o deploy, e o
-- ganho seria cosmético. O comentário registra o que ela virou.
--
-- ---------------------------------------------------------------------
-- UMA CONVERSA GERAL POR EMPRESA
-- ---------------------------------------------------------------------
-- `plano_id` passa a aceitar nulo: nulo significa "conversa geral da
-- empresa", a do assistente. As conversas amarradas a um plano continuam
-- existindo para quem já as tem.
--
-- O índice único precisa ser parcial porque o `unique (tenant_id,
-- plano_id)` do SQL 56 não impede duas linhas com `plano_id` nulo — no
-- Postgres, nulo nunca é igual a nulo. Sem o índice abaixo, cada
-- pergunta criaria uma conversa nova e o histórico sumiria.
-- =====================================================================

alter table public.pdca_conversas
  alter column plano_id drop not null;

create unique index if not exists pdca_conversas_geral_idx
  on public.pdca_conversas (tenant_id)
  where plano_id is null;

comment on table public.pdca_conversas is
  'Conversas do assistente. Com plano_id: conversa sobre aquele plano de '
  'ação. Com plano_id nulo: a conversa geral da empresa, sobre o Controle '
  'Financeiro inteiro. O nome é histórico — nasceu só para o PDCA.';

comment on column public.pdca_conversas.plano_id is
  'Nulo = conversa geral do assistente. Preenchido = conversa daquele '
  'ciclo de plano, que encerra junto com ele.';

-- ---------------------------------------------------------------------
-- O QUE FOI CONSULTADO EM CADA RESPOSTA
-- ---------------------------------------------------------------------
-- O assistente consulta dados por ferramenta. Guardar quais foram
-- chamadas é o que permite responder três perguntas que ninguém consegue
-- responder depois sem isto:
--
--   · qual ferramenta ninguém usa (candidata a sair)
--   · qual pergunta não tem ferramenta (candidata a entrar)
--   · quando uma resposta saiu errada, de onde o número veio
--
-- A terceira é a que importa num chat sobre dinheiro: sem o registro, a
-- investigação começa pelo "o modelo deve ter inventado", que é a
-- hipótese mais confortável e nem sempre a verdadeira.

alter table public.pdca_mensagens
  add column if not exists ferramentas text[];

comment on column public.pdca_mensagens.ferramentas is
  'Ferramentas que o assistente chamou para produzir esta resposta, na '
  'ordem. Nulo nas mensagens do cliente e nas respostas que não '
  'consultaram nada.';

notify pgrst, 'reload schema';


-- =====================================================================
-- CONFERÊNCIA — rode depois, separado
-- =====================================================================
-- A coluna aceita nulo e o índice parcial existe:
--
--   select is_nullable from information_schema.columns
--    where table_name = 'pdca_conversas' and column_name = 'plano_id';
--   -- esperado: YES
--
--   select indexname from pg_indexes
--    where tablename = 'pdca_conversas' and indexname = 'pdca_conversas_geral_idx';
--   -- esperado: uma linha
--
-- E a coluna de ferramentas:
--
--   select column_name from information_schema.columns
--    where table_name = 'pdca_mensagens' and column_name = 'ferramentas';
