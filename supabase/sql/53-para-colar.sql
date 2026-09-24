-- =====================================================================
-- 53 · A FOLHA DA HORA PRODUTIVA PODE SER INFORMADA À MÃO
-- =====================================================================
-- Até aqui, "Folha do mês" era só medida: a soma dos lançamentos nas
-- categorias marcadas com `papel = 'folha'` (SQL 44). Quando nenhuma
-- categoria estava marcada, o campo mostrava R$ 0,00, não aceitava
-- digitação, e a ferramenta inteira ficava inútil — o custo da hora sai
-- da folha, e sem folha não há custo de hora nenhum.
--
-- O desenho estava certo em preferir o medido: número digitado envelhece
-- e ninguém revisa. O erro foi não ter saída quando o medido não existe.
--
-- ---------------------------------------------------------------------
-- NULO SIGNIFICA "USE O QUE VOCÊ MEDIU"
-- ---------------------------------------------------------------------
-- Não é o mesmo que zero. Zero seria uma empresa que declara não ter
-- folha; nulo é a empresa que não informou nada e aceita o cálculo dos
-- lançamentos. Guardar um valor copiado do medido quebraria isso: ele
-- congelaria no dia em que foi salvo e deixaria de acompanhar os meses
-- seguintes, sem ninguém perceber.
-- =====================================================================

alter table public.hora_produtiva_config
  add column if not exists folha_mensal numeric(14,2)
    check (folha_mensal is null or folha_mensal >= 0);

comment on column public.hora_produtiva_config.folha_mensal is
  'Folha informada a mao. NULO = use a media medida das categorias com '
  'papel folha. Existe para a empresa que ainda nao classificou as '
  'categorias de pessoal, ou que nao lanca a folha na plataforma.';

notify pgrst, 'reload schema';


-- =====================================================================
-- CONFERÊNCIA — rode depois, separado
-- =====================================================================
-- A coluna tem de aparecer na lista:
--
-- select column_name, data_type, is_nullable
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'hora_produtiva_config'
--  order by ordinal_position;
