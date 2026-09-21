/**
 * Testes do pró-labore.
 *
 * O primeiro grupo reproduz o exemplo da planilha da Aula 1.4 — a loja
 * de materiais elétricos das aulas, que retirava R$ 9.000 e comportava
 * R$ 5.800. Se a tela e o material divergirem num número, o aluno
 * confia no papel e desconfia do software, e com razão.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calcularProLabore, type EntradaProLabore } from './prolabore.js';

/** A loja das aulas. */
const loja: EntradaProLabore = {
  salarioMercado: 6_000,
  moradia: 2_400,
  alimentacao: 1_800,
  transporte: 900,
  saudeEducacao: 1_400,
  outrosEssenciais: 700,
  resultados: [11_400, 9_800, 8_200],
  percentualResultado: 60,
  retiradaAtual: 9_000,
  margemContribuicaoPct: 32,
};

describe('o exemplo da planilha', () => {
  it('método 1 é o salário de mercado', () => {
    assert.equal(calcularProLabore(loja).metodo1, 6_000);
  });

  it('método 2 soma os cinco custos da família', () => {
    assert.equal(calcularProLabore(loja).metodo2, 7_200);
  });

  it('a média dos três meses é 9.800', () => {
    assert.equal(calcularProLabore(loja).resultadoMedio, 9_800);
  });

  it('método 3 é 60% da média', () => {
    assert.equal(calcularProLabore(loja).metodo3, 5_880);
  });

  it('o menor dos três é o teto', () => {
    const r = calcularProLabore(loja);
    assert.equal(r.menorDosMetodos, 5_880);
    assert.equal(r.metodoQueManda, 'teto');
  });

  it('o definido desce para o múltiplo de 100', () => {
    assert.equal(calcularProLabore(loja).proLaboreDefinido, 5_800);
  });

  it('o excedente mensal é 3.200 e o anual, 38.400', () => {
    const r = calcularProLabore(loja);
    assert.equal(r.excedenteMensal, 3_200);
    assert.equal(r.excedenteAnual, 38_400);
  });

  it('falta 1.400 para o piso da vida', () => {
    assert.equal(calcularProLabore(loja).faltaParaOPiso, 1_400);
  });

  it('o resultado necessário é 12.000', () => {
    assert.equal(calcularProLabore(loja).resultadoNecessario, 12_000);
  });

  it('faltam 2.200 de resultado por mês', () => {
    assert.equal(calcularProLabore(loja).resultadoAdicional, 2_200);
  });

  it('a venda adicional necessária é 6.875', () => {
    assert.equal(calcularProLabore(loja).vendaAdicionalNecessaria, 6_875);
  });
});

/**
 * A conta que quase todo mundo erra.
 *
 * Faltam R$ 2.200 de RESULTADO. Vender R$ 2.200 a mais não resolve —
 * só a margem daquela venda chega ao resultado. É a mesma armadilha do
 * markup na precificação, na outra ponta da planilha.
 */
describe('venda adicional divide pela margem, não multiplica', () => {
  it('R$ 2.200 de resultado exigem R$ 6.875 de venda a 32%', () => {
    const r = calcularProLabore(loja);
    assert.ok(r.vendaAdicionalNecessaria! > r.resultadoAdicional!);
    assert.equal(r.vendaAdicionalNecessaria, Math.round((2_200 / 0.32) * 100) / 100);
  });

  it('margem menor exige venda maior', () => {
    const magra = calcularProLabore({ ...loja, margemContribuicaoPct: 16 });
    assert.equal(magra.vendaAdicionalNecessaria, 13_750);
  });

  it('sem margem informada, a última conta não sai', () => {
    const r = calcularProLabore({ ...loja, margemContribuicaoPct: null });
    assert.equal(r.vendaAdicionalNecessaria, null);
    // Mas o resultado adicional continua, porque não depende da margem.
    assert.equal(r.resultadoAdicional, 2_200);
  });
});

describe('qual método manda', () => {
  /**
   * Para o piso vencer, os OUTROS DOIS precisam estar acima dele — e é
   * mais raro do que parece. Com a empresa lucrando, quem costuma
   * mandar é o custo de reposição: um dono que faria o trabalho de um
   * funcionário de R$ 6.000 dificilmente se paga R$ 7.200 só porque a
   * família custa isso.
   */
  it('o piso manda quando os outros dois estão acima dele', () => {
    const r = calcularProLabore({
      ...loja,
      salarioMercado: 10_000,
      resultados: [40_000, 40_000, 40_000], // teto de 24.000
    });
    assert.equal(r.metodoQueManda, 'piso');
    assert.equal(r.proLaboreDefinido, 7_200);
  });

  it('com a empresa lucrando, costuma mandar a reposição', () => {
    const r = calcularProLabore({ ...loja, resultados: [40_000, 40_000, 40_000] });
    assert.equal(r.metodoQueManda, 'reposicao');
    assert.equal(r.proLaboreDefinido, 6_000);
  });

  it('a reposição manda quando ela é a menor', () => {
    const r = calcularProLabore({
      ...loja,
      salarioMercado: 3_000,
      resultados: [40_000, 40_000, 40_000],
    });
    assert.equal(r.metodoQueManda, 'reposicao');
    assert.equal(r.proLaboreDefinido, 3_000);
  });

  it('método em branco não vira zero nem vence o mínimo', () => {
    const r = calcularProLabore({ ...loja, salarioMercado: null });
    assert.equal(r.metodo1, null);
    assert.equal(r.metodoQueManda, 'teto');
    assert.equal(r.proLaboreDefinido, 5_800);
  });
});

/**
 * O caso que a MPE vive e a planilha precisa dizer em voz alta.
 *
 * Empresa sem resultado tem teto zero. Devolver "pró-labore definido:
 * R$ 0" pareceria formulário quebrado; o que importa é a frase.
 */
describe('empresa sem resultado', () => {
  const quebrada: EntradaProLabore = {
    ...loja,
    resultados: [-2_000, 500, -1_500],
  };

  it('o teto fica zerado ou negativo', () => {
    assert.ok(calcularProLabore(quebrada).metodo3! <= 0);
  });

  it('avisa que qualquer retirada sai do capital de giro', () => {
    const r = calcularProLabore(quebrada);
    assert.equal(r.alertas.some((a) => /sai do capital de giro/.test(a)), true);
  });

  it('o teto zerado não vence o mínimo — os outros métodos decidem', () => {
    const r = calcularProLabore(quebrada);
    assert.equal(r.metodoQueManda, 'reposicao');
    assert.equal(r.proLaboreDefinido, 6_000);
  });

  it('a média inclui o mês ruim, não o descarta', () => {
    // (-2000 + 500 - 1500) / 3 = -1000
    assert.equal(calcularProLabore(quebrada).resultadoMedio, -1_000);
  });
});

describe('quando a empresa comporta mais do que sai hoje', () => {
  it('o excedente fica negativo e nenhum alarme dispara', () => {
    const r = calcularProLabore({ ...loja, retiradaAtual: 3_000 });
    assert.equal(r.excedenteMensal, -2_800);
    assert.equal(r.alertas.some((a) => /a mais por mês/.test(a)), false);
  });
});

describe('bordas', () => {
  it('nenhum método informado é erro, não zero', () => {
    const r = calcularProLabore({
      resultados: [],
      salarioMercado: null,
      moradia: null,
    });
    assert.equal(r.erro !== null, true);
    assert.match(r.erro!, /ao menos um dos três métodos/);
  });

  it('percentual fora da faixa é recusado', () => {
    assert.equal(calcularProLabore({ ...loja, percentualResultado: 0 }).erro !== null, true);
    assert.equal(calcularProLabore({ ...loja, percentualResultado: 140 }).erro !== null, true);
  });

  it('percentual ausente usa os 60% da aula', () => {
    const r = calcularProLabore({ ...loja, percentualResultado: null });
    assert.equal(r.metodo3, 5_880);
  });

  it('um mês só já calcula, e a tela sabe que foi um só', () => {
    const r = calcularProLabore({ ...loja, resultados: [9_800] });
    assert.equal(r.mesesConsiderados, 1);
    assert.equal(r.metodo3, 5_880);
  });

  it('sem retirada informada, o excedente é nulo — não zero', () => {
    const r = calcularProLabore({ ...loja, retiradaAtual: null });
    assert.equal(r.excedenteMensal, null);
    assert.equal(r.excedenteAnual, null);
  });

  it('o arredondamento nunca sobe', () => {
    const r = calcularProLabore({
      salarioMercado: 5_899.99,
      resultados: [],
    });
    assert.equal(r.proLaboreDefinido, 5_800);
  });

  it('valor abaixo de cem não vira negativo', () => {
    const r = calcularProLabore({ salarioMercado: 40, resultados: [] });
    assert.equal(r.proLaboreDefinido, 0);
  });
});

describe('piso abaixo do teto não gera a conta de crescimento', () => {
  it('quando o pró-labore já paga a vida, não há venda adicional', () => {
    const r = calcularProLabore({
      ...loja,
      moradia: 1_000,
      alimentacao: 500,
      transporte: 300,
      saudeEducacao: 200,
      outrosEssenciais: 100, // piso de 2.100
    });
    assert.equal(r.faltaParaOPiso, 2_100 - 2_100);
    assert.equal(r.resultadoNecessario, null);
    assert.equal(r.vendaAdicionalNecessaria, null);
  });
});
