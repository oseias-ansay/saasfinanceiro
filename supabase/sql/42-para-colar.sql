-- =====================================================================
-- 42 — Imposto em valor por unidade (ICMS-ST, alíquota ad rem)
-- =====================================================================
-- Nem toda carga tributária é percentual. Substituição Tributária e
-- alíquota ad rem cobram um VALOR por unidade — R$ por litro, por quilo,
-- por peça — e esse valor não cresce quando o preço sobe.
--
-- ---------------------------------------------------------------------
-- POR QUE UMA COLUNA NOVA E NÃO O CAMPO DE PERCENTUAL
-- ---------------------------------------------------------------------
-- Porque a aritmética é outra. No markup divisor, percentual vai no
-- DENOMINADOR e valor fixo vai no NUMERADOR, junto do custo:
--
--     preço = (custo direto + imposto fixo) / (1 − soma dos percentuais)
--
-- Convertido em percentual, o ST inflaria o preço; ignorado, deixaria
-- barato. Nos dois casos o erro é silencioso — o número sai plausível.
-- =====================================================================

alter table public.mix_produtos
  add column if not exists imposto_fixo numeric(14,2) not null default 0
    check (imposto_fixo >= 0);

comment on column public.mix_produtos.imposto_fixo is
  'Imposto em valor por unidade (ICMS-ST, ad rem). Entra no custo variavel como encargo que NAO acompanha o preco - diferente de imposto_pct.';

notify pgrst, 'reload schema';
