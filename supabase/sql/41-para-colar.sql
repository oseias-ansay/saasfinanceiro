-- =====================================================================
-- 41 — Treinamento: as 40 microaulas e as 4 missões
-- =====================================================================
-- Roda DEPOIS do 40 e DEPOIS do 41a.
--
-- O 41a precisa vir antes e sozinho: ele acrescenta dois valores ao enum
-- `atividade_destino`, e o Postgres não deixa USAR um valor de enum na
-- mesma transação em que ele foi CRIADO. Com os dois juntos, o erro é
-- `55P04: unsafe use of new value`.
--
-- ---------------------------------------------------------------------
-- SEM LIBERAÇÃO POR SEMANA — DECISÃO DE 17/09/2026
-- ---------------------------------------------------------------------
-- A ementa previa um módulo por semana, com a missão do anterior como
-- condição de avanço. Não foi implementado, de propósito: **todos os
-- módulos ficam abertos desde o primeiro dia.**
--
-- O aluno é dono de empresa e estuda no tempo que sobra. Travar o
-- avanço não cria disciplina — cria a semana em que ele tinha três horas
-- livres, não pôde usar, e não voltou.
--
-- O abandono previsto nas aulas 2.3 a 2.5 continua sendo um risco real,
-- mas o remédio é o que a própria ementa propõe e que a plataforma já
-- sabe fazer: e-mail de resgate no dia 7 sem progresso e aviso no
-- WhatsApp no dia 10. Puxar quem parou funciona; impedir quem quer
-- seguir, não.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. AS 40 MICROAULAS
-- ---------------------------------------------------------------------
-- `descricao` guarda o "o que o aluno sai com" da ementa. É a promessa
-- da aula, e é o texto que faz alguém clicar — melhor no card do que
-- escondido num material de apoio.
with m as (
  select ordem, id from public.curso_modulos where curso = 'financas-mpe'
),
aulas(mod, ord, titulo, min, saida) as (values
  -- Módulo 1 — Fundamentos e Organização Financeira
  (1,  1, 'Descubra para onde o seu dinheiro está indo', 12, 'Autoavaliação dos 5 sintomas'),
  (1,  2, 'Pare de confundir faturamento, lucro e caixa', 13, 'Os 3 conceitos separados em exemplo real'),
  (1,  3, 'Separe a conta da empresa da sua conta pessoal', 15, 'Roteiro de separação em 30 dias'),
  (1,  4, 'Calcule quanto você deve tirar de pró-labore', 10, 'Valor calculado pelos 3 métodos'),
  (1,  5, 'Entenda a diferença entre pró-labore e lucro', 14, 'Decisão de como fazer a própria retirada'),
  (1,  6, 'Monte seu plano de contas em uma página', 12, 'Plano adaptado ao próprio negócio'),
  (1,  7, 'Classifique qualquer lançamento sem errar', 10, 'Regra de bolso para custo x despesa'),
  (1,  8, 'Use centro de custo para saber o que dá lucro', 12, 'Definição de separar ou não por unidade'),
  (1,  9, 'Escolha entre planilha, aplicativo e ERP', 12, 'Decisão de ferramenta com orçamento'),
  (1, 10, 'Instale sua rotina financeira mínima', 10, 'Agenda diária, semanal e mensal + Missão 1'),

  -- Módulo 2 — Gestão de Caixa e Operação Diária
  (2,  1, 'Entenda por que empresa lucrativa quebra', 13, 'Caso real de descasamento de prazo'),
  (2,  2, 'Domine as três datas: vendeu, faturou, recebeu', 10, 'Classificação correta das próprias vendas'),
  (2,  3, 'Monte seu fluxo de caixa realizado do zero', 15, 'Planilha do último mês preenchida'),
  (2,  4, 'Projete os próximos 90 dias do seu caixa', 15, 'Curva de 12 semanas'),
  (2,  5, 'Feche o dia em 15 minutos com conciliação', 12, 'Rotina de fechamento diário'),
  (2,  6, 'Organize seu calendário de contas a pagar', 12, 'Duas datas fixas de pagamento no mês'),
  (2,  7, 'Negocie prazo com fornecedor sem perder condição', 10, 'Script de negociação'),
  (2,  8, 'Monte uma régua de cobrança que não perde cliente', 10, '5 mensagens prontas para disparar'),
  (2,  9, 'Monte sua DRE gerencial e ache o vazamento', 13, 'DRE do último mês com análise vertical'),
  (2, 10, 'Faça as 5 perguntas do fechamento do mês', 10, 'Checklist de fechamento + Missão 2'),

  -- Módulo 3 — Formação de Preço e Margens de Lucro
  (3,  1, 'Pare de copiar o preço do concorrente', 10, 'Os 3 métodos errados desmontados'),
  (3,  2, 'Separe custo fixo, custo variável e despesa', 12, 'Gastos do negócio classificados'),
  (3,  3, 'Calcule o custo real do que você vende', 13, 'Custo com as linhas esquecidas incluídas'),
  (3,  4, 'Descubra quanto custa a hora da sua equipe', 12, 'Hora-homem com ocupação real'),
  (3,  5, 'Calcule sua margem de contribuição', 13, 'MC em R$ e em % por produto'),
  (3,  6, 'Descubra quanto precisa vender para não perder', 13, 'Ponto de equilíbrio e meta diária'),
  (3,  7, 'Nunca mais confunda markup com margem', 12, 'Conversão correta entre os dois'),
  (3,  8, 'Monte sua planilha de precificação', 15, 'Tabela de preço recalculada'),
  (3,  9, 'Recupere o preço que some em taxas e descontos', 10, 'Limite de desconto por produto'),
  (3, 10, 'Venda mais do que dá margem: ajuste seu mix', 10, 'Ranking do mix + Missão 3'),

  -- Módulo 4 — Planejamento, Capital de Giro e Indicadores
  (4,  1, 'Descubra por que você vende bem e vive apertado', 13, 'Ciclo financeiro do próprio negócio'),
  (4,  2, 'Calcule sua Necessidade de Capital de Giro', 14, 'NCG em reais'),
  (4,  3, 'Encurte seu ciclo mexendo em três prazos', 13, 'Plano de redução de 5 dias'),
  (4,  4, 'Decida se você deve mesmo tomar crédito', 12, 'Comparação por CET, não por parcela'),
  (4,  5, 'Separe a reserva de impostos no dia certo', 10, 'Percentual de provisão definido'),
  (4,  6, 'Monte seu orçamento anual em três cenários', 13, 'Meta de faturamento e teto de despesa'),
  (4,  7, 'Acompanhe ticket médio, conversão e CAC', 13, 'Indicadores comerciais calculados'),
  (4,  8, 'Leia margem, lucratividade e rentabilidade', 12, 'Os 3 índices sem confusão'),
  (4,  9, 'Monte o painel de 8 números da sua semana', 10, 'Painel preenchido com semáforo'),
  (4, 10, 'Dê nota à sua gestão e escolha 3 prioridades', 10, 'Nota 0–100 + Missão 4')
)
insert into public.curso_aulas (modulo_id, ordem, titulo, descricao, duracao_min)
select m.id, a.ord, a.titulo, a.saida, a.min
from aulas a join m on m.ordem = a.mod
on conflict (modulo_id, ordem) do update set
  titulo = excluded.titulo,
  descricao = excluded.descricao,
  duracao_min = excluded.duracao_min;

-- ---------------------------------------------------------------------
-- 2. AS QUATRO MISSÕES
-- ---------------------------------------------------------------------
-- Cada entrega vira uma atividade. As que pedem número da empresa têm
-- `destino` e gravam na tabela real; as demais ficam em
-- `curso_respostas`.
--
-- O `on conflict` não existe aqui porque não há chave natural — rodar
-- duas vezes duplicaria. O `where not exists` resolve, e mantém o
-- arquivo repetível.
insert into public.curso_atividades (modulo_id, ordem, titulo, enunciado, tipo, destino, config, obrigatoria)
select m.id, v.ord, v.titulo, v.enunciado, v.tipo::public.atividade_tipo,
       nullif(v.destino,'')::public.atividade_destino, v.config::jsonb, v.obrig
from public.curso_modulos m
join (values
  -- ---- Missão 1: Seu plano de contas e seu salário ----
  (1, 1, 'Adapte o plano de contas ao seu negócio',
   'Renomeie, exclua e inclua categorias do plano modelo até ele descrever a sua operação. Toda categoria precisa responder a uma decisão: se ninguém decide nada com ela, ela não existe.',
   'ferramenta', 'categorias', '{"ferramenta":"Cadastros"}', true),
  (1, 2, 'Classifique 30 lançamentos reais',
   'Abra o extrato PJ de um mês e classifique os 30 primeiros lançamentos, marcando os gastos pessoais. Ao final, anote quantos ficaram sem categoria óbvia.',
   'ferramenta', 'lancamentos', '{"minimo":30}', true),
  (1, 3, 'Calcule seu pró-labore pelos três métodos',
   'Custo de reposição no mercado, orçamento pessoal mínimo e teto pela margem do negócio. Compare os três e escolha.',
   'numero', '', '{"unidade":"R$","rotulo":"Pró-labore calculado"}', true),
  (1, 4, 'Compare o calculado com o que você retira hoje',
   'Meu pró-labore calculado é ___% maior ou menor do que o que eu retiro. Este número vira insumo do diagnóstico final do módulo 4.',
   'numero', '', '{"unidade":"%","rotulo":"Diferença","permite_negativo":true}', true),

  -- ---- Missão 2: 90 dias à frente ----
  (2, 1, 'Lance o caixa realizado dos últimos 30 dias',
   'Lance e concilie com o extrato. A diferença tem de ser exatamente zero — enquanto não for, o fluxo projetado não é confiável.',
   'ferramenta', 'lancamentos', '{"ferramenta":"Extrato","dias":30}', true),
  (2, 2, 'Projete as próximas 12 semanas',
   'Com o caixa lançado, a projeção sai sozinha. Encontre a semana de menor saldo e registre o valor.',
   'numero', '', '{"unidade":"R$","rotulo":"Saldo mínimo projetado","permite_negativo":true}', true),
  (2, 3, 'Dispare a régua de cobrança',
   'Envie a mensagem 1 para todos os títulos vencidos há mais de 5 dias. A tela "A pagar / receber" lista quem são, com o telefone ao lado.',
   'checklist', '', '{"opcoes":["Disparei para todos os vencidos há mais de 5 dias"]}', false),
  (2, 4, 'Registre o total vencido a receber',
   'O número aparece no topo da tela "A pagar / receber", em Vencido.',
   'numero', '', '{"unidade":"R$","rotulo":"Total vencido a receber"}', true),

  -- ---- Missão 3: Recalcule seu carro-chefe ----
  (3, 1, 'Cadastre seu carro-chefe com o custo real completo',
   'O produto ou serviço que mais fatura, com todas as linhas escondidas incluídas: taxa de cartão, comissão, imposto, frete e desconto médio concedido.',
   'ferramenta', 'produtos', '{"ferramenta":"Margem de Contribuição","minimo":1}', true),
  (3, 2, 'Registre a margem de contribuição do carro-chefe',
   'Em percentual. A ferramenta calcula assim que o produto estiver cadastrado.',
   'numero', '', '{"unidade":"%","rotulo":"MC do carro-chefe","permite_negativo":true}', true),
  (3, 3, 'Registre seu faturamento de equilíbrio',
   'Quanto a empresa precisa faturar no mês para não perder dinheiro. Converta em meta diária antes de comunicar à equipe.',
   'numero', '', '{"unidade":"R$","rotulo":"Faturamento de equilíbrio"}', true),
  (3, 4, 'Defina o desconto máximo permitido',
   'Por faixa de margem. Comunique a quem vende — desconto sem limite escrito é limite decidido pelo cliente.',
   'numero', '', '{"unidade":"%","rotulo":"Desconto máximo"}', true),

  -- ---- Missão 4: Seu painel e seu número de giro ----
  (4, 1, 'Informe seus três prazos médios',
   'Estoque, recebimento e pagamento. Recebimento e pagamento a plataforma mede dos seus lançamentos; o de estoque você informa.',
   'ferramenta', 'prazos', '{"ferramenta":"Cálculo de Capital de Giro"}', true),
  (4, 2, 'Registre sua NCG atual',
   'Quanto a operação exige parado para funcionar no tamanho de hoje.',
   'numero', '', '{"unidade":"R$","rotulo":"NCG atual","permite_negativo":true}', true),
  (4, 3, 'Simule a NCG com 30% a mais de faturamento',
   'Mantenha os mesmos prazos e recalcule. A diferença é quanto vai faltar de caixa se a empresa crescer sem mudar nada — o dado que explica por que crescer quebra empresa.',
   'numero', '', '{"unidade":"R$","rotulo":"NCG com +30%","permite_negativo":true}', true),
  (4, 4, 'Defina as três prioridades dos próximos 90 dias',
   'Uma por linha. Concretas o bastante para alguém conferir se aconteceram.',
   'texto', '', '{"linhas":3,"placeholder":"1. …"}', true),
  (4, 5, 'Responda o autodiagnóstico e receba sua nota',
   'O formulário de diagnóstico financeiro da plataforma. A nota de 0 a 100 fecha o treinamento e é o ponto de partida da conversa com o consultor.',
   'ferramenta', 'diagnostico', '{"ferramenta":"Diagnóstico"}', true)
) as v(mod, ord, titulo, enunciado, tipo, destino, config, obrig)
  on m.ordem = v.mod and m.curso = 'financas-mpe'
where not exists (
  select 1 from public.curso_atividades a
   where a.modulo_id = m.id and a.ordem = v.ord
);

notify pgrst, 'reload schema';

-- =====================================================================
-- CONFERÊNCIA — rode depois, separado
-- =====================================================================
-- select m.ordem, m.titulo,
--        count(distinct a.id)  as aulas,
--        count(distinct at.id) as atividades
-- from public.curso_modulos m
-- left join public.curso_aulas a       on a.modulo_id = m.id
-- left join public.curso_atividades at on at.modulo_id = m.id
-- where m.curso = 'financas-mpe'
-- group by m.id, m.ordem, m.titulo
-- order by m.ordem;
--
-- Esperado: 4 linhas, 10 aulas cada, e 4/4/4/5 atividades.
