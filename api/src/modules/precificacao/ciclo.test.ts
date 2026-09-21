/**
 * Testes do ciclo financeiro.
 *
 * O primeiro grupo reproduz o exemplo da planilha da Aula 4.1 — a loja
 * de materiais elétricos usada no curso. Se a tela e o material
 * divergirem num número, o aluno confia no papel e desconfia do
 * software, e com razão.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calcularCiclo, type EntradaCiclo } from './ciclo.js';

/** A loja das aulas: 32 dias de ciclo, R$ 192.000 presos. */
const loja: EntradaCiclo = {
  receitaMensal: 180_000,
  estoque: 144_000,
  aReceber: 134_400,
  aPagar: 86_400,
};

describe('o exemplo da planilha', () => {
  it('venda diária é a receita sobre 30', () => {
    assert.equal(calcularCiclo(loja).vendaDiaria, 6_000);
  });

  it('os três prazos batem com o material do curso', () => {
    const r = calcularCiclo(loja);
    assert.equal(r.diasEstoque, 24);
    assert.equal(r.diasRecebimento, 22.4);
    assert.equal(r.diasFornecedor, 14.4);
  });

  it('operacional é estoque mais recebimento', () => {
    assert.equal(calcularCiclo(loja).cicloOperacional, 46.4);
  });

  it('financeiro desconta o fornecedor', () => {
    assert.equal(calcularCiclo(loja).cicloFinanceiro, 32);
  });

  it('dinheiro preso é o número da aula', () => {
    assert.equal(calcularCiclo(loja).dinheiroPreso, 192_000);
  });

  it('um dia de ciclo vale uma venda diária', () => {
    assert.equal(calcularCiclo(loja).valorDeUmDia, 6_000);
  });

  /**
   * 32 está ACIMA dos 30 da faixa verde — a planilha marca ATENÇÃO.
   *
   * O exemplo do curso não é uma empresa saudável: é uma loja com
   * R$ 192 mil parados, usada justamente para mostrar o problema.
   */
  it('32 dias é ATENÇÃO, não confortável', () => {
    assert.equal(calcularCiclo(loja).situacao, 'atencao');
  });
});

/**
 * A identidade que sustenta a ferramenta inteira.
 *
 * `ciclo × venda diária` tem de dar o mesmo que
 * `estoque + a receber − a pagar`. É o que faz o resultado daqui fechar
 * com a NCG da aula 4.2 — e é o que a régua "dias de venda" existe para
 * garantir.
 */
describe('a identidade entre dias e reais', () => {
  const casos: EntradaCiclo[] = [
    loja,
    { receitaMensal: 50_000, estoque: 10_000, aReceber: 30_000, aPagar: 5_000 },
    { receitaMensal: 300_000, estoque: 0, aReceber: 120_000, aPagar: 90_000 },
    { receitaMensal: 12_345, estoque: 6_789, aReceber: 4_321, aPagar: 1_234 },
  ];

  for (const [i, c] of casos.entries()) {
    it(`fecha no caso ${i + 1}`, () => {
      const r = calcularCiclo(c);
      const porDias = r.cicloFinanceiro * r.vendaDiaria;

      // Tolerância de um real: os dias são arredondados para uma casa,
      // e o dinheiro preso sai dos valores exatos de propósito.
      assert.ok(
        Math.abs(porDias - r.dinheiroPreso) < 1,
        `${porDias} contra ${r.dinheiroPreso}`,
      );
    });
  }
});

describe('as faixas de gestão', () => {
  const comCiclo = (dias: number): EntradaCiclo => ({
    receitaMensal: 30_000, // venda diária de 1.000
    estoque: dias * 1_000,
    aReceber: 0,
    aPagar: 0,
  });

  it('até 30 dias é confortável', () => {
    assert.equal(calcularCiclo(comCiclo(30)).situacao, 'confortavel');
  });

  it('31 já é atenção', () => {
    assert.equal(calcularCiclo(comCiclo(31)).situacao, 'atencao');
  });

  it('até 40 continua atenção', () => {
    assert.equal(calcularCiclo(comCiclo(40)).situacao, 'atencao');
  });

  it('41 é crítico', () => {
    assert.equal(calcularCiclo(comCiclo(41)).situacao, 'critico');
  });
});

describe('ciclo negativo', () => {
  it('recebe antes de pagar: a operação se financia sozinha', () => {
    const r = calcularCiclo({
      receitaMensal: 180_000,
      estoque: 0,
      aReceber: 0,
      aPagar: 90_000,
    });

    assert.equal(r.cicloFinanceiro, -15);
    assert.equal(r.dinheiroPreso, -90_000);
    assert.equal(r.alertas.some((a) => /se financia sozinha/.test(a)), true);
  });
});

describe('a alavanca que rende mais', () => {
  it('aponta o estoque quando ele é o maior pedaço', () => {
    const r = calcularCiclo({
      receitaMensal: 30_000,
      estoque: 40_000, // 40 dias
      aReceber: 10_000, // 10 dias
      aPagar: 0,
    });
    assert.equal(r.alertas.some((a) => /estoque é o maior pedaço/.test(a)), true);
  });

  it('aponta o recebimento quando é ele', () => {
    const r = calcularCiclo({
      receitaMensal: 30_000,
      estoque: 10_000,
      aReceber: 40_000,
      aPagar: 0,
    });
    assert.equal(r.alertas.some((a) => /recebimento é o maior pedaço/.test(a)), true);
  });

  it('não aponta nada quando o ciclo está dentro da faixa verde', () => {
    const r = calcularCiclo({
      receitaMensal: 30_000,
      estoque: 10_000, // 10 dias
      aReceber: 10_000, // 10 dias
      aPagar: 0,
    });
    assert.equal(r.cicloFinanceiro, 20);
    assert.equal(r.alertas.some((a) => /maior pedaço/.test(a)), false);
  });
});

describe('bordas', () => {
  it('sem receita não há régua, e a tela precisa dizer isso', () => {
    const r = calcularCiclo({ ...loja, receitaMensal: 0 });
    assert.equal(r.erro !== null, true);
    assert.match(r.erro!, /régua que converte reais em dias/);
  });

  it('valor negativo é recusado', () => {
    assert.equal(calcularCiclo({ ...loja, estoque: -1 }).erro !== null, true);
  });

  it('empresa de serviço, sem estoque, funciona', () => {
    const r = calcularCiclo({ ...loja, estoque: 0 });
    assert.equal(r.diasEstoque, 0);
    assert.equal(r.cicloOperacional, 22.4);
    assert.equal(r.cicloFinanceiro, 8);
  });

  it('tudo zerado fora a receita dá ciclo zero, não erro', () => {
    const r = calcularCiclo({ receitaMensal: 180_000, estoque: 0, aReceber: 0, aPagar: 0 });
    assert.equal(r.erro, null);
    assert.equal(r.cicloFinanceiro, 0);
    assert.equal(r.situacao, 'confortavel');
  });
});
