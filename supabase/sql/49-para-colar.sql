-- =====================================================================
-- 49 · CENTROS DE RESULTADO
-- =====================================================================
-- Uma coluna e uma view. A tabela `cost_centers` já existe desde o
-- schema inicial, e `transactions.cost_center_id` também — o que
-- faltava era ler os dois juntos.
--
-- ---------------------------------------------------------------------
-- A REGRA QUE DEFINE TUDO
-- ---------------------------------------------------------------------
-- **Lançamento COM centro de custo pertence àquela frente. Lançamento
-- SEM centro é custo comum.**
--
-- É deliberadamente simples, e tem efeito pedagógico: quanto mais o
-- cliente classifica, menor fica o bolo comum e mais honesta fica a
-- leitura de cada frente. Quando quase tudo é comum, a tela diz isso em
-- vez de fingir precisão — porque aí o resultado de cada frente depende
-- mais do critério de rateio que da operação.
--
-- Isso é melhor do que a planilha da aula 1.8, que pede o rateio de
-- cada linha à mão. Aqui a frente é MEDIDA.
--
-- ---------------------------------------------------------------------
-- O SEGUNDO CRITÉRIO DE RATEIO
-- ---------------------------------------------------------------------
-- A aula compara DOIS critérios de propósito: um pela receita, outro
-- pela área ocupada — ou por qualquer régua que o gestor defenda. O
-- primeiro a plataforma calcula sozinha; o segundo precisa de um
-- percentual por frente, e é o que a coluna guarda.
--
-- Mostrar só um faria o número parecer verdade. Mostrar os dois, com a
-- diferença somando exatamente zero, ensina o que o rateio é.
-- =====================================================================

alter table public.cost_centers
  add column if not exists rateio_pct numeric(5,2)
    check (rateio_pct >= 0 and rateio_pct <= 100);

comment on column public.cost_centers.rateio_pct is
  'Percentual do custo fixo comum atribuido a esta frente pelo criterio do '
  'gestor -- area ocupada, numero de pessoas, o que ele defender. Segundo '
  'criterio da aula 1.8; o primeiro (pela receita) e calculado. So vale '
  'quando os percentuais de todas as frentes somam 100.';


-- ---------------------------------------------------------------------
-- A APURAÇÃO POR FRENTE
-- ---------------------------------------------------------------------
-- Um mês, uma linha por centro de custo, mais uma linha de comum.
--
-- `despesa_fixa` COM centro é fixo DIRETO da frente — o que sumiria se
-- ela fechasse amanhã. Sem centro, é comum.
--
-- Receita, dedução e custo variável sem centro ficam de fora do rateio
-- de propósito: uma receita que não se sabe de qual frente veio não
-- ajuda a decidir nada, e distribuí-la pela participação seria circular
-- (a participação sai justamente da receita).

drop view if exists public.vw_centros_resultado;

create view public.vw_centros_resultado
with (security_invoker = on) as
select
  t.tenant_id,
  date_trunc('month', t.competence_date::timestamp)::date as competencia,
  t.cost_center_id,
  cc.name as centro,

  coalesce(sum(t.amount) filter (where g.grp = 'receita_bruta'),  0) as receita,
  coalesce(sum(t.amount) filter (where g.grp = 'deducao'),        0) as deducoes,
  coalesce(sum(t.amount) filter (where g.grp = 'custo_variavel'), 0) as custos_variaveis,
  coalesce(sum(t.amount) filter (where g.grp = 'despesa_fixa'),   0) as despesas_fixas

from public.transactions t
left join public.categories c on c.id = t.category_id
left join public.cost_centers cc on cc.id = t.cost_center_id
cross join lateral (
  select coalesce(c.dre_group,
           case when t.type = 'receita' then 'receita_bruta'::public.dre_group
                else 'despesa_fixa'::public.dre_group end) as grp
) g
where t.status <> 'cancelado'
  -- Retirada de sócio fica fora: é destinação do lucro, não custo de
  -- operar, e não pertence a frente nenhuma.
  and g.grp <> 'retirada_socios'
group by
  t.tenant_id,
  date_trunc('month', t.competence_date::timestamp),
  t.cost_center_id,
  cc.name;

comment on view public.vw_centros_resultado is
  'Apuracao mensal por centro de custo. A linha com cost_center_id nulo e o '
  'custo comum -- o que nao foi classificado e por isso precisa de rateio.';

notify pgrst, 'reload schema';


-- =====================================================================
-- CONFERÊNCIA — rode depois, separado
-- =====================================================================
-- 1. Como está a classificação num mês:
--
-- select coalesce(centro, '(sem centro — comum)') as frente,
--        receita, deducoes, custos_variaveis, despesas_fixas
--   from public.vw_centros_resultado
--  where tenant_id = 'SEU-TENANT'
--    and competencia = '2026-08-01'
--  order by receita desc;
--
-- 2. O teste que importa: a soma das frentes tem de bater com o DRE do
--    mesmo mês.
--
-- select
--   (select sum(receita) from public.vw_centros_resultado
--     where tenant_id = 'SEU-TENANT' and competencia = '2026-08-01')
--   -
--   (select receita_bruta from public.vw_dre_monthly
--     where tenant_id = 'SEU-TENANT' and competencia = '2026-08-01')
--   as diferenca_receita;
--
-- Tem de vir ZERO. Diferente de zero significa lançamento com centro de
-- custo de outro tenant, o que o trigger do schema deveria impedir.
