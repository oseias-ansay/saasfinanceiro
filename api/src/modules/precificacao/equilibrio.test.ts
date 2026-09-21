/**
 * Testes do ponto de equilíbrio com mix de produtos.
 *
 * O primeiro grupo trava a diferença entre média simples e média
 * ponderada, que é o erro que este módulo existe para eliminar. Os
 * números foram conferidos à mão.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calcularEquilibrio, type ProdutoEntrada } from './equilibrio.js';

/** 80% do faturamento num item de 20% de MC. */
const magro: ProdutoEntrada = {
  nome: 'Item magro',
  preco: 100,
  custoDireto: 80,
  variaveisPct: 0,
  participacaoPct: 80,
};

/** 20% do faturamento num item de 60% de MC. */
const gordo: ProdutoEntrada = {
  nome: 'Item gordo',
  preco: 100,
  custoDireto: 40,
  variaveisPct: 0,
  participacaoPct: 20,
};

describe('a média ponderada', () => {
  it('não é a média simples das margens', () => {
    const r = calcularEquilibrio({ produtos: [magro, gordo], custosFixosMensais: 20_000 });

    // 0,8×20 + 0,2×60 = 28. A média simples daria 40.
    assert.equal(r.indiceMargemContribuicao, 28);
    assert.notEqual(r.indiceMargemContribuicao, 40);
  });

  it('e o ponto de equilíbrio muda junto', () => {
    const r = calcularEquilibrio({ produtos: [magro, gordo], custosFixosMensais: 20_000 });

    // 20.000 / 0,28 = 71.428,57. Com 40% daria 50.000 — R$ 21 mil de
    // diferença, que é a distância entre fechar no azul e no vermelho.
    assert.equal(r.pontoEquilibrioFaturamento, 71_428.57);
  });

  it('com um produto só, cai na fórmula clássica', () => {
    const r = calcularEquilibrio({
      produtos: [{ ...gordo, participacaoPct: 100 }],
      custosFixosMensais: 30_000,
    });
    assert.equal(r.indiceMargemContribuicao, 60);
    assert.equal(r.pontoEquilibrioFaturamento, 50_000);
  });

  it('inverter os pesos inverte o resultado', () => {
    const r = calcularEquilibrio({
      produtos: [
        { ...magro, participacaoPct: 20 },
        { ...gordo, participacaoPct: 80 },
      ],
      custosFixosMensais: 20_000,
    });
    // 0,2×20 + 0,8×60 = 52
    assert.equal(r.indiceMargemContribuicao, 52);
  });
});

describe('os percentuais variáveis entram no custo', () => {
  it('imposto e comissão reduzem a margem de contribuição', () => {
    const r = calcularEquilibrio({
      produtos: [
        { nome: 'A', preco: 100, custoDireto: 40, variaveisPct: 15, participacaoPct: 100 },
      ],
      custosFixosMensais: 10_000,
    });
    // Custo variável = 40 + 15 = 55. MC = 45.
    assert.equal(r.produtos[0]?.margemContribuicao, 45);
    assert.equal(r.indiceMargemContribuicao, 45);
  });
});

describe('imposto separado dos demais variáveis', () => {
  const p = {
    nome: 'A',
    preco: 100,
    custoDireto: 40,
    impostoPct: 9,
    variaveisPct: 6,
    participacaoPct: 100,
  };

  it('a MC bruta ignora imposto e comissão', () => {
    const r = calcularEquilibrio({ produtos: [p], custosFixosMensais: 10_000 });
    assert.equal(r.produtos[0]?.margemContribuicaoBruta, 60);
    assert.equal(r.produtos[0]?.margemContribuicaoBrutaPct, 60);
  });

  it('a MC líquida desconta os dois, e é ela que vale', () => {
    const r = calcularEquilibrio({ produtos: [p], custosFixosMensais: 10_000 });
    assert.equal(r.produtos[0]?.imposto, 9);
    assert.equal(r.produtos[0]?.outrosVariaveis, 6);
    assert.equal(r.produtos[0]?.margemContribuicao, 45);
    assert.equal(r.indiceMargemContribuicao, 45);
  });

  /**
   * A garantia de que a separação não mudou nenhum número.
   *
   * Importa porque a coluna nasce em zero para quem já tinha produtos
   * cadastrados: enquanto ninguém editar, 9+6 continua morando em
   * `variaveisPct`, e o resultado tem de ser idêntico. Se estes dois
   * cálculos divergirem, alguém passou a contar imposto duas vezes.
   */
  it('9% + 6% separados dá o mesmo que 15% juntos', () => {
    const separado = calcularEquilibrio({ produtos: [p], custosFixosMensais: 10_000 });
    const junto = calcularEquilibrio({
      produtos: [{ ...p, impostoPct: 0, variaveisPct: 15 }],
      custosFixosMensais: 10_000,
    });

    assert.equal(separado.produtos[0]?.margemContribuicao, junto.produtos[0]?.margemContribuicao);
    assert.equal(separado.pontoEquilibrioFaturamento, junto.pontoEquilibrioFaturamento);
  });

  it('sem imposto informado, o campo vem zerado e nada muda', () => {
    const r = calcularEquilibrio({
      produtos: [{ ...p, impostoPct: undefined }],
      custosFixosMensais: 10_000,
    });
    assert.equal(r.produtos[0]?.imposto, 0);
    assert.equal(r.produtos[0]?.margemContribuicao, 54); // 100 − 40 − 6
  });

  /**
   * O caso que a separação torna visível.
   *
   * Olhando só a MC bruta, o item parece dar 15% e o dono acha que está
   * ganhando pouco. Com imposto e comissão, ele está PERDENDO dois reais
   * por unidade. Antes de separar, esse diagnóstico exigia refazer a
   * conta à mão.
   *
   * O acompanhante saudável existe para o mix não ficar negativo — com
   * mix negativo a função recusa a conta inteira, que é outro teste.
   */
  it('imposto revela o item que parece lucrativo e não é', () => {
    const r = calcularEquilibrio({
      produtos: [
        { ...p, nome: 'Parece bom', custoDireto: 85, impostoPct: 12, variaveisPct: 5, participacaoPct: 20 },
        { ...p, nome: 'Saudável', custoDireto: 30, impostoPct: 9, variaveisPct: 6, participacaoPct: 80 },
      ],
      custosFixosMensais: 10_000,
    });

    const ruim = r.produtos.find((x) => x.nome === 'Parece bom');
    assert.equal(ruim?.margemContribuicaoBruta, 15);
    assert.equal(ruim?.margemContribuicao, -2);
    assert.equal(ruim?.destruiValor, true);
    assert.equal(r.alertas.some((a) => /Parece bom/.test(a)), true);
  });
});

describe('participações que não somam 100', () => {
  it('normaliza proporcionalmente', () => {
    const r = calcularEquilibrio({
      produtos: [
        { ...magro, participacaoPct: 40 },
        { ...gordo, participacaoPct: 10 },
      ],
      custosFixosMensais: 20_000,
    });
    // 40 e 10 viram 80 e 20 — mesma proporção, mesmo índice de antes.
    assert.equal(r.produtos[0]?.participacaoPct, 80);
    assert.equal(r.indiceMargemContribuicao, 28);
  });

  it('avisa quando o desvio é relevante', () => {
    const r = calcularEquilibrio({
      produtos: [{ ...magro, participacaoPct: 50 }],
      custosFixosMensais: 10_000,
    });
    assert.equal(r.alertas.some((a) => /somam 50%/.test(a)), true);
  });

  it('não incomoda por um ponto de arredondamento', () => {
    const r = calcularEquilibrio({
      produtos: [
        { ...magro, participacaoPct: 79.7 },
        { ...gordo, participacaoPct: 20 },
      ],
      custosFixosMensais: 10_000,
    });
    assert.equal(r.alertas.some((a) => /somam/.test(a)), false);
  });

  it('soma zero é erro, não normalização', () => {
    const r = calcularEquilibrio({
      produtos: [{ ...magro, participacaoPct: 0 }],
      custosFixosMensais: 10_000,
    });
    assert.equal(r.viavel, false);
    assert.match(r.erro ?? '', /participação/i);
  });
});

describe('o produto que destrói valor', () => {
  it('margem negativa é apontada pelo nome', () => {
    const r = calcularEquilibrio({
      produtos: [
        { nome: 'Combo promocional', preco: 100, custoDireto: 95, variaveisPct: 15, participacaoPct: 50 },
        { ...gordo, participacaoPct: 50 },
      ],
      custosFixosMensais: 10_000,
    });

    const ruim = r.produtos.find((p) => p.nome === 'Combo promocional');
    assert.equal(ruim?.destruiValor, true);
    assert.equal(r.alertas.some((a) => /Combo promocional/.test(a)), true);
    assert.equal(r.alertas.some((a) => /vender mais piora/.test(a)), true);
  });

  it('mix inteiro negativo não produz ponto de equilíbrio', () => {
    const r = calcularEquilibrio({
      produtos: [
        { nome: 'A', preco: 100, custoDireto: 110, variaveisPct: 0, participacaoPct: 100 },
      ],
      custosFixosMensais: 10_000,
    });
    assert.equal(r.viavel, false);
    assert.match(r.erro ?? '', /nenhum volume de vendas paga/);
  });
});

describe('quanto vender de cada produto', () => {
  it('reparte o ponto de equilíbrio pelos pesos', () => {
    const r = calcularEquilibrio({ produtos: [magro, gordo], custosFixosMensais: 20_000 });

    // 71.428,57 repartido em 80/20.
    assert.equal(r.produtos[0]?.equilibrioFaturamento, 57_142.86);
    assert.equal(r.produtos[1]?.equilibrioFaturamento, 14_285.71);
  });

  it('e converte em unidades, arredondando para cima', () => {
    const r = calcularEquilibrio({ produtos: [magro, gordo], custosFixosMensais: 20_000 });
    // 57.142,86 / 100 = 571,4 -> 572. Vender 571 não paga a conta.
    assert.equal(r.produtos[0]?.equilibrioUnidades, 572);
    assert.equal(r.produtos[1]?.equilibrioUnidades, 143);
  });
});

describe('margem de segurança', () => {
  const mix = { produtos: [magro, gordo], custosFixosMensais: 20_000 };

  it('faturando acima do equilíbrio, mostra a folga e o lucro', () => {
    const r = calcularEquilibrio({ ...mix, faturamentoAtual: 100_000 });
    // MC total = 28.000; lucro = 28.000 − 20.000 = 8.000
    assert.equal(r.resultadoNoFaturamentoAtual, 8_000);
    // (100.000 − 71.428,57) / 100.000 = 28,57%
    assert.equal(r.margemSegurancaPct, 28.57);
  });

  it('abaixo do equilíbrio, diz o tamanho do prejuízo', () => {
    const r = calcularEquilibrio({ ...mix, faturamentoAtual: 60_000 });
    assert.equal(r.resultadoNoFaturamentoAtual, -3_200);
    assert.ok((r.margemSegurancaPct ?? 0) < 0);
    assert.equal(r.alertas.some((a) => /abaixo do ponto de/.test(a)), true);
  });

  it('folga pequena também é avisada', () => {
    const r = calcularEquilibrio({ ...mix, faturamentoAtual: 75_000 });
    assert.ok((r.margemSegurancaPct ?? 0) > 0);
    assert.equal(r.alertas.some((a) => /Margem de segurança de apenas/.test(a)), true);
  });

  it('sem faturamento informado, não inventa margem de segurança', () => {
    const r = calcularEquilibrio(mix);
    assert.equal(r.margemSegurancaPct, null);
    assert.equal(r.resultadoNoFaturamentoAtual, null);
  });
});

describe('bordas', () => {
  it('sem produtos, não calcula', () => {
    const r = calcularEquilibrio({ produtos: [], custosFixosMensais: 10_000 });
    assert.equal(r.viavel, false);
  });

  it('produto sem preço é ignorado', () => {
    const r = calcularEquilibrio({
      produtos: [{ ...magro, preco: 0 }, { ...gordo, participacaoPct: 100 }],
      custosFixosMensais: 10_000,
    });
    assert.equal(r.produtos.length, 1);
  });

  it('sem custo fixo, calcula a margem mas avisa', () => {
    const r = calcularEquilibrio({ produtos: [magro, gordo], custosFixosMensais: 0 });
    assert.equal(r.viavel, true);
    assert.equal(r.indiceMargemContribuicao, 28);
    assert.equal(r.pontoEquilibrioFaturamento, null);
    assert.equal(r.alertas.some((a) => /Sem despesas fixas/.test(a)), true);
  });
});

/* ------------------------------------------------------------------ */
/* Imposto fixo por unidade no mix                                     */
/* ------------------------------------------------------------------ */

describe('imposto fixo por unidade', () => {
  const comST: ProdutoEntrada = {
    nome: 'Com ST',
    preco: 100,
    custoDireto: 40,
    impostoFixo: 6,
    impostoPct: 9,
    variaveisPct: 6,
    participacaoPct: 100,
  };

  it('soma ao imposto percentual', () => {
    const r = calcularEquilibrio({ produtos: [comST], custosFixosMensais: 10_000 });
    // 6 fixo + 9% de 100 = 15
    assert.equal(r.produtos[0]?.imposto, 15);
    assert.equal(r.produtos[0]?.impostoFixo, 6);
  });

  it('reduz a MC líquida, e não a bruta', () => {
    const r = calcularEquilibrio({ produtos: [comST], custosFixosMensais: 10_000 });
    // Bruta ignora imposto: 100 − 40 = 60
    assert.equal(r.produtos[0]?.margemContribuicaoBruta, 60);
    // Líquida: 100 − 40 − 6 − 9 − 6 = 39
    assert.equal(r.produtos[0]?.margemContribuicao, 39);
  });

  it('sem ST informado, nada muda', () => {
    const a = calcularEquilibrio({
      produtos: [{ ...comST, impostoFixo: undefined }],
      custosFixosMensais: 10_000,
    });
    const b = calcularEquilibrio({
      produtos: [{ ...comST, impostoFixo: 0 }],
      custosFixosMensais: 10_000,
    });
    assert.equal(a.produtos[0]?.margemContribuicao, 45);
    assert.equal(a.produtos[0]?.margemContribuicao, b.produtos[0]?.margemContribuicao);
  });

  it('ST alto pode zerar a margem de um item que parecia bom', () => {
    const r = calcularEquilibrio({
      produtos: [
        { ...comST, nome: 'Bebida com ST', impostoFixo: 46, participacaoPct: 30 },
        { ...comST, nome: 'Saudável', impostoFixo: 0, participacaoPct: 70 },
      ],
      custosFixosMensais: 10_000,
    });

    const ruim = r.produtos.find((x) => x.nome === 'Bebida com ST');
    assert.equal(ruim?.margemContribuicaoBruta, 60);
    assert.equal(ruim?.margemContribuicao, -1);
    assert.equal(ruim?.destruiValor, true);
  });
});
