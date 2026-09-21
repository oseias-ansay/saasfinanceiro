/**
 * Testes dos três índices.
 *
 * O primeiro grupo reproduz o exemplo da planilha da Aula 4.8 — a loja
 * das aulas, com margem de 29,4% e lucratividade de 6,4%.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calcularIndices, type EntradaIndices } from './indices.js';

/** A loja das aulas. */
const loja: EntradaIndices = {
  faturamentoMensal: 180_000,
  margemContribuicao: 52_940,
  lucroMensal: 11_600,
  proLabore: 5_800,
  estoque: 144_000,
  clientesAReceber: 134_400,
  imobilizado: 180_000,
  saldoCaixa: 28_500,
  fornecedoresAPagar: 86_400,
  saldoDevedor: 120_000,
  aPagarNoAno: 200_000,
};

describe('o exemplo da planilha', () => {
  it('a margem de contribuição é 29,41%', () => {
    assert.equal(calcularIndices(loja).margemContribuicaoPct, 29.41);
  });

  it('a lucratividade é 6,44%', () => {
    assert.equal(calcularIndices(loja).lucratividadePct, 6.44);
  });

  it('o ativo operacional soma giro, bens e caixa', () => {
    // 144.000 + 134.400 + 180.000 + 28.500
    assert.equal(calcularIndices(loja).ativoOperacional, 486_900);
  });

  it('o capital investido desconta o que é de terceiros', () => {
    // 486.900 − (86.400 + 120.000)
    assert.equal(calcularIndices(loja).capitalInvestido, 280_500);
  });

  it('o lucro econômico desconta o pró-labore', () => {
    assert.equal(calcularIndices(loja).lucroEconomico, 5_800);
  });
});

/**
 * O ponto da aula: os três medem sobras diferentes contra denominadores
 * diferentes, e uma margem boa não garante rentabilidade nenhuma.
 */
describe('margem boa não é rentabilidade boa', () => {
  it('a mesma margem rende menos quando há mais capital preso', () => {
    const enxuta = calcularIndices({ ...loja, estoque: 20_000, clientesAReceber: 20_000 });
    const pesada = calcularIndices({ ...loja, estoque: 300_000, clientesAReceber: 300_000 });

    assert.equal(enxuta.margemContribuicaoPct, pesada.margemContribuicaoPct);
    assert.ok(enxuta.rentabilidadeMesPct! > pesada.rentabilidadeMesPct!);
  });

  it('a tela faz essa leitura em voz alta', () => {
    const r = calcularIndices({ ...loja, estoque: 900_000 });
    assert.equal(r.alertas.some((a) => /Não é problema de preço/.test(a)), true);
  });
});

/**
 * Um por cento ao mês não é doze por cento ao ano. É 12,68% — e a
 * comparação com qualquer aplicação exige a mesma base.
 */
describe('a rentabilidade ao ano é composta', () => {
  it('1% ao mês dá 12,68% ao ano, não 12%', () => {
    const r = calcularIndices({
      ...loja,
      lucroMensal: 8_605, // lucro econômico de 2.805 = 1% de 280.500
      proLabore: 5_800,
    });
    assert.equal(r.rentabilidadeMesPct, 1);
    assert.equal(r.rentabilidadeAnoPct, 12.68);
  });

  it('sempre rende mais que doze vezes a taxa mensal', () => {
    const r = calcularIndices(loja);
    assert.ok(r.rentabilidadeAnoPct! > r.rentabilidadeMesPct! * 12);
  });
});

describe('o dono dentro da conta', () => {
  it('avisa quando o negócio só paga o salário do dono', () => {
    const r = calcularIndices({ ...loja, lucroMensal: 5_000, proLabore: 5_800 });
    assert.equal(r.lucroEconomico, -800);
    assert.equal(r.alertas.some((a) => /pagando o seu salário e nada além/.test(a)), true);
  });

  it('pró-labore maior derruba a rentabilidade, não a lucratividade', () => {
    const baixo = calcularIndices({ ...loja, proLabore: 2_000 });
    const alto = calcularIndices({ ...loja, proLabore: 9_000 });

    assert.equal(baixo.lucratividadePct, alto.lucratividadePct);
    assert.ok(baixo.rentabilidadeMesPct! > alto.rentabilidadeMesPct!);
  });
});

describe('capital negativo', () => {
  const afundada: EntradaIndices = {
    ...loja,
    fornecedoresAPagar: 400_000,
    saldoDevedor: 200_000,
  };

  it('não devolve rentabilidade absurda — devolve nulo', () => {
    const r = calcularIndices(afundada);
    assert.ok(r.capitalInvestido < 0);
    assert.equal(r.rentabilidadeMesPct, null);
    assert.equal(r.rentabilidadeAnoPct, null);
  });

  it('explica por que a conta não sai', () => {
    const r = calcularIndices(afundada);
    assert.equal(r.alertas.some((a) => /financiada por fornecedor e banco/.test(a)), true);
  });

  it('os outros dois índices continuam valendo', () => {
    const r = calcularIndices(afundada);
    assert.equal(r.margemContribuicaoPct, 29.41);
    assert.equal(r.lucratividadePct, 6.44);
  });
});

describe('os índices de apoio', () => {
  it('a liquidez soma estoque, a receber e caixa', () => {
    // (144.000 + 134.400 + 28.500) ÷ 200.000
    assert.equal(calcularIndices(loja).liquidezCorrente, 1.53);
  });

  it('acima de 1, a ressalva sobre estoque aparece', () => {
    const r = calcularIndices(loja);
    assert.equal(r.alertas.some((a) => /estoque não paga boleto/.test(a)), true);
  });

  it('abaixo de 1, o alerta muda de tom', () => {
    const r = calcularIndices({ ...loja, aPagarNoAno: 900_000 });
    assert.equal(r.alertas.some((a) => /não fecha sem crédito novo/.test(a)), true);
  });

  it('sem o valor a pagar no ano, a liquidez é nula em vez de zero', () => {
    assert.equal(calcularIndices({ ...loja, aPagarNoAno: null }).liquidezCorrente, null);
  });

  it('o endividamento é terceiros sobre o ativo operacional', () => {
    // 206.400 ÷ 486.900
    assert.equal(calcularIndices(loja).endividamentoPct, 42.39);
  });

  it('acima de 60%, a tela lembra que quem decide é o serviço da dívida', () => {
    const r = calcularIndices({ ...loja, saldoDevedor: 250_000 });
    assert.equal(r.alertas.some((a) => /serviço dela/.test(a)), true);
  });
});

describe('quanto do capital está preso no ciclo', () => {
  it('é a NCG sobre o capital investido', () => {
    // (144.000 + 134.400 − 86.400) ÷ 280.500
    assert.equal(calcularIndices(loja).presoNoCicloPct, 68.45);
  });

  it('empresa de serviço, sem estoque nem carnê, tem pouco preso', () => {
    const r = calcularIndices({ ...loja, estoque: 0, clientesAReceber: 0 });
    assert.ok(r.presoNoCicloPct! < 0);
  });
});

describe('bordas', () => {
  it('sem faturamento, margem e lucratividade somem — não viram zero', () => {
    const r = calcularIndices({ ...loja, faturamentoMensal: 0 });
    assert.equal(r.margemContribuicaoPct, null);
    assert.equal(r.lucratividadePct, null);
    // O capital continua existindo.
    assert.equal(r.capitalInvestido, 280_500);
  });

  it('valor negativo de estoque é recusado', () => {
    assert.equal(calcularIndices({ ...loja, estoque: -1 }).erro !== null, true);
  });

  it('caixa negativo é aceito — conta no vermelho existe', () => {
    const r = calcularIndices({ ...loja, saldoCaixa: -10_000 });
    assert.equal(r.erro, null);
    assert.equal(r.ativoOperacional, 448_400);
  });

  it('empresa sem dívida nenhuma tem endividamento zero', () => {
    const r = calcularIndices({ ...loja, fornecedoresAPagar: 0, saldoDevedor: 0 });
    assert.equal(r.endividamentoPct, 0);
    assert.equal(r.capitalInvestido, r.ativoOperacional);
  });
});
