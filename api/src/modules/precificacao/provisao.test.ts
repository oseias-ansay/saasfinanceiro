/**
 * Testes da provisão.
 *
 * O primeiro grupo reproduz o exemplo da planilha da Aula 4.5 — a loja
 * das aulas, com R$ 14.400 de imposto e R$ 4.581 de provisão
 * trabalhista.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calcularProvisao, type EntradaProvisao } from './provisao.js';

/** A loja das aulas. */
const loja: EntradaProvisao = {
  receitaMensal: 180_000,
  aliquotaPct: 8,
  folhaMensal: 23_560,
  desembolsoFixoMensal: 50_640,
  saldoCaixa: 28_500,
};

describe('o exemplo da planilha', () => {
  it('o imposto do mês é 14.400', () => {
    assert.equal(calcularProvisao(loja).reservaImpostos, 14_400);
  });

  it('a provisão trabalhista é 4.581', () => {
    // 23560/12 = 1963,33  +  23560*(4/3)/12 = 2617,78
    assert.equal(calcularProvisao(loja).reservaTrabalhista, 4_581.11);
  });

  it('o total mensal soma as duas — e só elas', () => {
    const r = calcularProvisao(loja);
    assert.equal(r.totalMensal, r2(14_400 + 4_581.11));
  });

  it('a meta de emergência é três meses de desembolso fixo', () => {
    assert.equal(calcularProvisao(loja).metaEmergencia, 151_920);
  });

  it('o caixa cobre menos de um mês', () => {
    const r = calcularProvisao(loja);
    assert.equal(r.reservaAtualEmMeses, 0.56);
    assert.equal(r.situacao, 'menos_de_um_mes');
  });

  it('faltam 123.420 para a meta', () => {
    assert.equal(calcularProvisao(loja).faltaParaMeta, 123_420);
  });
});

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * O erro que a planilha existe para não cometer.
 *
 * A reserva de emergência é META DE SALDO, não aporte mensal. Somá-la
 * ao total do mês daria um número tão alto que ninguém separaria nada —
 * e a pessoa desistiria das três.
 */
describe('a emergência não entra no total mensal', () => {
  it('o total mensal tem duas parcelas, não três', () => {
    const r = calcularProvisao(loja);
    assert.equal(r.totalMensal, r.reservaImpostos + r.reservaTrabalhista);
    assert.ok(r.totalMensal < r.metaEmergencia);
  });

  it('o total mensal não muda quando o caixa muda', () => {
    const cheio = calcularProvisao({ ...loja, saldoCaixa: 500_000 });
    assert.equal(cheio.totalMensal, calcularProvisao(loja).totalMensal);
  });
});

describe('as faixas de reserva', () => {
  // Desembolso de 10.000/mês: a meta é 30.000.
  const comCaixa = (caixa: number): EntradaProvisao => ({
    ...loja,
    desembolsoFixoMensal: 10_000,
    saldoCaixa: caixa,
  });

  it('abaixo de um mês', () => {
    assert.equal(calcularProvisao(comCaixa(9_999)).situacao, 'menos_de_um_mes');
  });

  it('um mês cravado já é em construção', () => {
    assert.equal(calcularProvisao(comCaixa(10_000)).situacao, 'em_construcao');
  });

  it('dois meses e meio ainda é em construção', () => {
    assert.equal(calcularProvisao(comCaixa(25_000)).situacao, 'em_construcao');
  });

  it('três meses é meta atingida', () => {
    const r = calcularProvisao(comCaixa(30_000));
    assert.equal(r.situacao, 'meta_atingida');
    assert.equal(r.faltaParaMeta, 0);
  });

  it('acima da meta não gera falta negativa', () => {
    assert.equal(calcularProvisao(comCaixa(90_000)).faltaParaMeta, 0);
  });
});

describe('o alerta do dinheiro do imposto', () => {
  it('dispara quando o caixa não cobre o imposto do mês', () => {
    const r = calcularProvisao({ ...loja, saldoCaixa: 5_000 });
    assert.equal(r.alertas.some((a) => /nunca foi seu/.test(a)), true);
  });

  it('cala quando o caixa cobre', () => {
    const r = calcularProvisao({ ...loja, saldoCaixa: 200_000 });
    assert.equal(r.alertas.some((a) => /nunca foi seu/.test(a)), false);
  });
});

describe('empresa de serviço, sem folha', () => {
  it('a provisão trabalhista é zero, e isso não é erro', () => {
    const r = calcularProvisao({ ...loja, folhaMensal: 0 });
    assert.equal(r.reservaTrabalhista, 0);
    assert.equal(r.erro, null);
    assert.equal(r.reservaImpostos, 14_400);
  });
});

describe('bordas', () => {
  it('sem desembolso fixo não há régua de meses', () => {
    const r = calcularProvisao({ ...loja, desembolsoFixoMensal: 0 });
    assert.equal(r.reservaAtualEmMeses, null);
    assert.equal(r.situacao, 'sem_dados');
    // Mas as duas provisões mensais continuam válidas.
    assert.equal(r.reservaImpostos, 14_400);
  });

  it('sem receita, o percentual é nulo em vez de dividir por zero', () => {
    const r = calcularProvisao({ ...loja, receitaMensal: 0 });
    assert.equal(r.percentualDaReceita, null);
    assert.equal(r.reservaImpostos, 0);
  });

  it('alíquota fora da faixa é recusada', () => {
    assert.equal(calcularProvisao({ ...loja, aliquotaPct: -1 }).erro !== null, true);
    assert.equal(calcularProvisao({ ...loja, aliquotaPct: 101 }).erro !== null, true);
  });

  it('alíquota zero é válida — MEI e imune existem', () => {
    const r = calcularProvisao({ ...loja, aliquotaPct: 0 });
    assert.equal(r.erro, null);
    assert.equal(r.reservaImpostos, 0);
    assert.equal(r.reservaTrabalhista, 4_581.11);
  });

  it('caixa negativo é aceito — conta no vermelho existe', () => {
    const r = calcularProvisao({ ...loja, saldoCaixa: -5_000 });
    assert.equal(r.erro, null);
    assert.ok(r.reservaAtualEmMeses! < 0);
    assert.equal(r.situacao, 'menos_de_um_mes');
  });
});

describe('o peso da folha', () => {
  it('acima de 30% da receita, a tela avisa', () => {
    const r = calcularProvisao({ ...loja, receitaMensal: 60_000 }); // folha = 39%
    assert.equal(r.alertas.some((a) => /A folha consome/.test(a)), true);
  });

  it('abaixo disso, não', () => {
    const r = calcularProvisao(loja); // folha = 13%
    assert.equal(r.alertas.some((a) => /A folha consome/.test(a)), false);
  });
});
