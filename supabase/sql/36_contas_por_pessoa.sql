-- =====================================================================
-- 36_contas_por_pessoa.sql — Contas a pagar e a receber, por pessoa
-- =====================================================================
-- O QUE FALTAVA
-- ---------------------------------------------------------------------
-- A plataforma já sabia listar títulos um a um (`vw_transactions`) e já
-- projetava o caixa dia a dia (`vw_cashflow_projection`). O que não
-- existia era a pergunta que o dono da empresa faz de verdade:
--
--   "Quem me deve, quanto, e há quanto tempo?"
--   "A quem eu devo, e o que vence primeiro?"
--
-- Um extrato de vencimentos responde isso só depois de alguém somar na
-- cabeça. Esta view soma antes, e ordenada por valor vencido ela vira a
-- lista de quem ligar hoje — que é a diferença entre um relatório e uma
-- ferramenta de cobrança.
--
-- ---------------------------------------------------------------------
-- TRÊS DECISÕES QUE MUDAM O NÚMERO
-- ---------------------------------------------------------------------
-- 1. TÍTULO SEM PESSOA NÃO SOME. Muita gente lança "Aluguel" sem
--    cadastrar o fornecedor. Esses títulos viram uma linha agregada com
--    `entity_id` nulo, em vez de desaparecerem. Se sumissem, a soma desta
--    tela não bateria com a do contas a pagar — e duas telas que
--    discordam fazem o usuário não confiar em nenhuma das duas.
--
-- 2. ATRASO MÉDIO PONDERADO POR VALOR. Um título de R$ 10 com 90 dias e
--    um de R$ 10.000 com 3 dias dão média simples de 46 dias, o que
--    descreve mal a situação. Ponderado por valor dá 3, que é a verdade
--    do dinheiro parado.
--
-- 3. SÓ O QUE ESTÁ EM ABERTO. `liquidado` e `cancelado` ficam de fora: a
--    pergunta é sobre o que ainda vai acontecer. Quem costuma atrasar é
--    outra pergunta — histórico —, e merece view própria em vez de
--    contaminar esta com regime de competência.
--
-- ---------------------------------------------------------------------
-- SEGURANÇA
-- ---------------------------------------------------------------------
-- `security_invoker = on`: o RLS de `transactions` e `entities` continua
-- valendo, e o front pode consultar direto pelo supabase-js sem proxy.
-- =====================================================================

-- O DROP é obrigatório quando a lista de colunas muda: `create or replace
-- view` só aceita acrescentar colunas no fim, nunca renomear nem
-- reordenar. Sem ele, um deploy futuro falharia com uma mensagem que não
-- explica nada.
drop view if exists public.vw_contas_por_pessoa;

create view public.vw_contas_por_pessoa
with (security_invoker = on) as
select
  t.tenant_id,

  -- Uma view para as duas telas. `receita` é o que entra (cliente me
  -- deve); `despesa` é o que sai (eu devo ao fornecedor). Separar em duas
  -- views duplicaria a mesma lógica de envelhecimento, e cópias divergem.
  case when t.type = 'receita' then 'a_receber' else 'a_pagar' end as natureza,

  t.entity_id,
  coalesce(e.name, 'Sem cliente/fornecedor informado') as pessoa,
  e.kind        as tipo_pessoa,
  e.tax_id      as documento,
  e.email       as contato_email,
  e.phone       as contato_telefone,

  -- ---- O total em aberto -------------------------------------------
  sum(t.amount)                                            as total_aberto,
  count(*)::int                                            as titulos_abertos,

  -- ---- A parte vencida ---------------------------------------------
  coalesce(sum(t.amount) filter (where t.due_date < current_date), 0)  as total_vencido,
  count(*) filter (where t.due_date < current_date)::int               as titulos_vencidos,

  -- Envelhecimento clássico. As faixas são as que a cobrança usa: até 30
  -- dias ainda é esquecimento, de 31 a 60 já é sinal, acima de 60 é
  -- conversa diferente — e possivelmente provisão para perda.
  coalesce(sum(t.amount) filter (
    where t.due_date < current_date and t.due_date >= current_date - 30), 0) as vencido_ate_30,
  coalesce(sum(t.amount) filter (
    where t.due_date < current_date - 30 and t.due_date >= current_date - 60), 0) as vencido_31_60,
  coalesce(sum(t.amount) filter (
    where t.due_date < current_date - 60), 0)                               as vencido_mais_60,

  -- O mais antigo é o que decide a urgência da ligação.
  max(current_date - t.due_date) filter (where t.due_date < current_date)::int as dias_atraso_max,

  -- Ponderado por valor — ver a decisão 2 no cabeçalho. `nullif` evita a
  -- divisão por zero quando não há nada vencido; nulo aqui significa "não
  -- se aplica", que é diferente de zero dias de atraso.
  round(
    sum(t.amount * (current_date - t.due_date)) filter (where t.due_date < current_date)
    / nullif(sum(t.amount) filter (where t.due_date < current_date), 0)
  )::int as dias_atraso_medio,

  -- ---- O que ainda vai vencer ---------------------------------------
  min(t.due_date) filter (where t.due_date >= current_date)            as proximo_vencimento,
  coalesce(sum(t.amount) filter (
    where t.due_date >= current_date and t.due_date <= current_date + 30), 0) as a_vencer_30d,
  coalesce(sum(t.amount) filter (
    where t.due_date > current_date + 30 and t.due_date <= current_date + 60), 0) as a_vencer_31_60,
  coalesce(sum(t.amount) filter (
    where t.due_date > current_date + 60), 0)                               as a_vencer_mais_60

from public.transactions t
left join public.entities e on e.id = t.entity_id
where t.status = 'pendente'
group by
  t.tenant_id,
  case when t.type = 'receita' then 'a_receber' else 'a_pagar' end,
  t.entity_id, e.name, e.kind, e.tax_id, e.email, e.phone;

comment on view public.vw_contas_por_pessoa is
  'Contas a pagar/receber consolidadas por cliente e fornecedor. Ordenada por total_vencido, é a lista de quem cobrar hoje. Filtre por natureza (a_receber / a_pagar).';

-- ---------------------------------------------------------------------
-- O total geral, para o cabeçalho da tela
-- ---------------------------------------------------------------------
-- Existe separada em vez de ser somada no front por um motivo prático: a
-- tela pagina a lista de pessoas, e somar só a página visível daria um
-- total que muda conforme se navega. Total que muda ao trocar de página
-- é o tipo de defeito que destrói a confiança no número inteiro.
drop view if exists public.vw_contas_resumo;

create view public.vw_contas_resumo
with (security_invoker = on) as
select
  t.tenant_id,
  case when t.type = 'receita' then 'a_receber' else 'a_pagar' end as natureza,

  sum(t.amount)  as total_aberto,
  count(*)::int  as titulos_abertos,
  count(distinct t.entity_id)::int as pessoas,

  coalesce(sum(t.amount) filter (where t.due_date < current_date), 0) as total_vencido,
  count(*) filter (where t.due_date < current_date)::int              as titulos_vencidos,

  coalesce(sum(t.amount) filter (where t.due_date = current_date), 0)   as vence_hoje,
  coalesce(sum(t.amount) filter (
    where t.due_date > current_date and t.due_date <= current_date + 7), 0)  as vence_7d,
  coalesce(sum(t.amount) filter (
    where t.due_date > current_date and t.due_date <= current_date + 30), 0) as vence_30d,

  -- Quanto do que está em aberto já venceu. É o indicador que a régua do
  -- diagnóstico chama de inadimplência — mas aqui sobre a carteira em
  -- aberto, não sobre o faturamento. Nomes parecidos, contas diferentes:
  -- o campo se chama `pct_vencido` de propósito, para ninguém confundir.
  round(
    100.0 * coalesce(sum(t.amount) filter (where t.due_date < current_date), 0)
    / nullif(sum(t.amount), 0)
  , 2) as pct_vencido,

  -- Sem título sem pessoa cadastrada a cobrança não acontece: não há para
  -- quem ligar. O número existe para virar tarefa de cadastro.
  coalesce(sum(t.amount) filter (where t.entity_id is null), 0) as sem_pessoa_informada

from public.transactions t
where t.status = 'pendente'
group by t.tenant_id, case when t.type = 'receita' then 'a_receber' else 'a_pagar' end;

comment on view public.vw_contas_resumo is
  'Totais de contas a pagar/receber para o cabeçalho da tela. Separado da lista por pessoa para o total não mudar quando o usuário troca de página.';

-- ---------------------------------------------------------------------
-- Índice
-- ---------------------------------------------------------------------
-- `tx_tenant_due_idx` já cobre (tenant_id, type, due_date) where pendente,
-- que é exatamente o filtro destas views. Nada novo é necessário — fica
-- registrado aqui para o próximo que vier conferir não procurar em vão.

notify pgrst, 'reload schema';
