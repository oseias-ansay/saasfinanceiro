-- =====================================================================
-- 38 — Alíquota de imposto separada dos demais custos variáveis
-- =====================================================================
-- Até aqui, `variaveis_pct` guardava imposto, comissão, frete e taxa de
-- cartão somados. A margem de contribuição já era líquida — o imposto
-- sempre foi descontado. O que faltava era poder LER quanto dele é
-- imposto, que é o número que faz alguém perguntar sobre regime
-- tributário.
--
-- ---------------------------------------------------------------------
-- POR QUE O PADRÃO É ZERO, E NÃO UM VALOR ESTIMADO
-- ---------------------------------------------------------------------
-- Produtos já cadastrados têm o imposto embutido em `variaveis_pct`.
-- Preencher esta coluna com qualquer coisa diferente de zero faria o
-- imposto ser descontado DUAS vezes, e a margem apareceria menor do que
-- é — silenciosamente, porque o número continuaria plausível.
--
-- Zerada, nada muda até alguém editar o produto e separar os dois na
-- tela. A interface avisa.
-- =====================================================================

alter table public.mix_produtos
  add column if not exists imposto_pct numeric(6,2) not null default 0
    check (imposto_pct >= 0 and imposto_pct < 100);

comment on column public.mix_produtos.imposto_pct is
  'Aliquota de imposto sobre o preco de venda. Separada de variaveis_pct porque muda por produto (ISS, ICMS, anexo do Simples), enquanto comissao e taxa de cartao costumam ser uniformes.';

comment on column public.mix_produtos.variaveis_pct is
  'Comissao, frete, embalagem e taxa de cartao. NAO inclui imposto - ele tem coluna propria desde 16/09/2026.';

-- A soma das duas não pode chegar a 100%: aí o preço não cobriria nem os
-- percentuais, antes mesmo do custo direto. O check vive aqui, e não na
-- aplicação, porque é invariante do dado.
alter table public.mix_produtos
  drop constraint if exists mix_produtos_percentuais_ck;

alter table public.mix_produtos
  add constraint mix_produtos_percentuais_ck
    check (imposto_pct + variaveis_pct < 100);

notify pgrst, 'reload schema';
