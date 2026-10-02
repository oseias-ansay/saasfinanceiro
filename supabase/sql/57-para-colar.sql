-- =====================================================================
-- 57 · O CONTEXTO DO PLANO
-- =====================================================================
-- Uma coluna. O diagnóstico e a análise de causa-raiz que o relatório de
-- PDCA tem e as `acoes` não têm.
--
-- ---------------------------------------------------------------------
-- O PROBLEMA QUE ELA RESOLVE
-- ---------------------------------------------------------------------
-- O relatório entregue ao cliente tem 18 a 30 páginas. As ações são a
-- parte final dele: antes vêm a leitura dos números, a análise cruzada
-- entre áreas, a Matriz GUT que decidiu a ordem, os KPIs e os gatilhos
-- de contingência.
--
-- Cadastrando só as ações, o quadro sabe O QUE fazer e não sabe POR QUÊ.
-- E "por que isso é prioridade?" é a primeira pergunta que o cliente faz
-- — tanto na reunião quanto no chat.
--
-- ---------------------------------------------------------------------
-- POR QUE UMA COLUNA, E NÃO O PDF
-- ---------------------------------------------------------------------
-- A tentação é anexar o relatório e deixar a máquina ler. Dois problemas,
-- medidos no PDF do Auto Posto Esperança em 02/10/2026:
--
--   · ELE NÃO TEM TEXTO. Zero fontes, 18 páginas desenhadas como vetor.
--     `pdftotext` extrai 18 bytes do documento inteiro. O único caminho
--     seria OCR — e OCR de relatório financeiro erra onde dói: 8 virando
--     3, ponto virando vírgula em valor de R$.
--
--   · ELE É UM RENDER CONGELADO. Foi emitido em setembro. A ação que o
--     cliente concluir amanhã continua "aberta" nele para sempre.
--
-- Então o consultor cola o que importa, em texto, uma vez. É trabalho
-- manual e é deliberado: o que entra aqui é a síntese que vale ser dita
-- de novo, não o relatório inteiro.
--
-- ---------------------------------------------------------------------
-- O LIMITE DE TAMANHO É A DECISÃO DE PRODUTO
-- ---------------------------------------------------------------------
-- Oito mil caracteres — umas três páginas. Não é restrição técnica: cabe
-- muito mais no modelo.
--
-- Ele existe porque campo sem limite convida a colar o relatório inteiro,
-- e aí duas coisas pioram ao mesmo tempo. O custo de cada pergunta sobe
-- (o contexto vai em TODA chamada, mesmo com cache), e a resposta fica
-- pior: o modelo passa a ter trinta páginas para pescar a frase certa, em
-- vez de três com a síntese.
--
-- Três páginas é o tamanho de um resumo executivo. Se não cabe, o que não
-- cabe provavelmente não era síntese.
-- =====================================================================

alter table public.planos_acao
  add column if not exists contexto text
    check (contexto is null or length(contexto) <= 8000);

comment on column public.planos_acao.contexto is
  'Diagnóstico e análise de causa-raiz do relatório, em texto, colado pelo '
  'consultor. Vai ao contexto do chat junto com as ações — é o que responde '
  '"por que isso é prioridade?". Até 8000 caracteres (~3 páginas): o campo é '
  'para a síntese, não para o relatório inteiro, que encareceria cada '
  'pergunta e pioraria a resposta.';

-- ---------------------------------------------------------------------
-- QUEM ESCREVE
-- ---------------------------------------------------------------------
-- Ninguém novo. A policy `planos_write` do SQL 17 já restringe escrita em
-- `planos_acao` a `is_platform_staff()`, e o contexto é prescrição como o
-- resto do plano — o cliente lê, não edita.
--
-- Registrado aqui porque a ausência de policy nova neste arquivo é
-- intencional, e sem a nota pareceria esquecimento.

notify pgrst, 'reload schema';


-- =====================================================================
-- CONFERÊNCIA — rode depois, separado
-- =====================================================================
-- A coluna existe e está vazia:
--
--   select count(*) filter (where contexto is not null) as com_contexto,
--          count(*) as planos
--     from public.planos_acao;
--
-- O limite morde (deve dar erro de check constraint):
--
--   update public.planos_acao set contexto = repeat('x', 8001)
--    where id = (select id from public.planos_acao limit 1);
