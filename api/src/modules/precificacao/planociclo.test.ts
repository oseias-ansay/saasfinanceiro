/**
 * Testes do plano de redução de ciclo.
 *
 * O primeiro grupo reproduz o exemplo da planilha da Aula 4.3 — as
 * quatro alavancas da loja somam exatamente 5 dias e liberam R$ 30.000.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calcularPlanoCiclo, type Alavanca, type EntradaPlanoCiclo } from './planociclo.js';

const alavanca = (p: Partial<Alavanca> & { id: string; ganhoDias: number }): Alavanca => ({
  titulo: 'Alavanca',
  detalhe: 'o que exatamente vai ser feito',
  responsavel: 'Dono',
  prazo: '2026-10-21',
  status: 'aberta',
  ...p,
});

/** As quatro alavancas da loja das aulas. */
const loja: EntradaPlanoCiclo = {
  cicloHojeDias: 32,
  vendaDiaria: 6_000,
  taxaCapitalGiroMesPct: 2,
  alavancas: [
    alavanca({
      id: '1',
      titulo: 'Girar o estoque parado',
      detalhe: 'Liquidar os itens sem saída há mais de 90 dias',
      ganhoDias: 2,
    }),
    alavanca({
      id: '2',
      titulo: 'Encurtar o recebimento',
      detalhe: 'Reduzir o carnê de 3x para 2x nas vendas abaixo de R$ 300',
      ganhoDias: 1.5,
    }),
    alavanca({
      id: '3',
      titulo: 'Alongar o fornecedor',
      detalhe: 'Negociar 7 dias a mais com os dois maiores',
      ganhoDias: 1,
    }),
    alavanca({
      id: '4',
      titulo: 'Cobrar o vencido',
      detalhe: 'Régua de cobrança aplicada à carteira vencida',
      ganhoDias: 0.5,
    }),
  ],
};

describe('o exemplo da planilha', () => {
  it('as quatro alavancas somam 5 dias', () => {
    assert.equal(calcularPlanoCiclo(loja).ganhoTotalDias, 5);
  });

  it('cinco dias liberam R$ 30.000', () => {
    assert.equal(calcularPlanoCiclo(loja).liberaTotal, 30_000);
  });

  it('o ciclo cai de 32 para 27 dias', () => {
    assert.equal(calcularPlanoCiclo(loja).cicloDepoisDias, 27);
  });

  it('a NCG cai de 192.000 para 162.000', () => {
    const r = calcularPlanoCiclo(loja);
    assert.equal(r.ncgHoje, 192_000);
    assert.equal(r.ncgDepois, 162_000);
  });

  it('cada alavanca libera o seu ganho em dias vezes a venda diária', () => {
    const r = calcularPlanoCiclo(loja);
    assert.equal(r.alavancas.find((a) => a.id === '1')!.liberaReais, 12_000);
    assert.equal(r.alavancas.find((a) => a.id === '4')!.liberaReais, 3_000);
  });
});

/**
 * Liberar capital não é ganhar dinheiro: é deixar de tomar emprestado.
 * O juro evitado é composto, porque capital de giro se renova mês a mês.
 */
describe('o juro que deixa de ser pago', () => {
  it('2% ao mês sobre 30.000 dá 8.047 no ano, não 7.200', () => {
    const r = calcularPlanoCiclo(loja);
    // 30.000 × ((1,02)^12 − 1) = 30.000 × 0,268242
    assert.equal(r.economiaAnual, 8_047.25);
    assert.ok(r.economiaAnual! > 30_000 * 0.02 * 12);
  });

  it('sem taxa informada, a conta não sai — e não vira zero', () => {
    const r = calcularPlanoCiclo({ ...loja, taxaCapitalGiroMesPct: null });
    assert.equal(r.economiaAnual, null);
    // Mas o resto do plano continua.
    assert.equal(r.liberaTotal, 30_000);
  });

  it('a tela explica por que o plano vem antes do crédito', () => {
    const r = calcularPlanoCiclo(loja);
    assert.equal(r.alertas.some((a) => /ANTES da decisão de tomar crédito/.test(a)), true);
  });
});

/**
 * Alavanca concluída já teve efeito, e esse efeito já está dentro do
 * ciclo de hoje. Contá-la de novo prometeria a mesma redução duas vezes.
 */
describe('só alavanca aberta projeta ganho', () => {
  const comConcluida: EntradaPlanoCiclo = {
    ...loja,
    alavancas: [
      alavanca({ id: '1', ganhoDias: 2, status: 'concluida' }),
      alavanca({ id: '2', ganhoDias: 1.5 }),
    ],
  };

  it('a concluída não entra no total', () => {
    const r = calcularPlanoCiclo(comConcluida);
    assert.equal(r.ganhoTotalDias, 1.5);
    assert.equal(r.liberaTotal, 9_000);
  });

  it('mas continua visível, com os dias que já rendeu', () => {
    const r = calcularPlanoCiclo(comConcluida);
    assert.equal(r.concluidasDias, 2);
    assert.equal(r.alavancas.length, 2);
    assert.equal(r.alavancas.find((a) => a.id === '1')!.projeta, false);
    assert.equal(r.alavancas.find((a) => a.id === '1')!.liberaReais, 0);
  });

  it('cancelada também não projeta', () => {
    const r = calcularPlanoCiclo({
      ...loja,
      alavancas: [alavanca({ id: '1', ganhoDias: 5, status: 'cancelada' })],
    });
    assert.equal(r.ganhoTotalDias, 0);
    assert.equal(r.cicloDepoisDias, 32);
  });

  it('plano todo concluído convida à próxima rodada', () => {
    const r = calcularPlanoCiclo({
      ...loja,
      alavancas: [alavanca({ id: '1', ganhoDias: 3, status: 'concluida' })],
    });
    assert.equal(r.alertas.some((a) => /próxima rodada/.test(a)), true);
  });
});

describe('os testes de realidade', () => {
  it('avisa quando as alavancas somam mais da metade do ciclo', () => {
    const r = calcularPlanoCiclo({
      ...loja,
      alavancas: [alavanca({ id: '1', ganhoDias: 20 })],
    });
    assert.equal(r.alertas.some((a) => /otimismo em forma de tabela/.test(a)), true);
  });

  it('não avisa num plano de tamanho razoável', () => {
    const r = calcularPlanoCiclo(loja); // 5 de 32 dias
    assert.equal(r.alertas.some((a) => /otimismo em forma de tabela/.test(a)), false);
  });

  it('avisa quando o ciclo ficaria negativo', () => {
    const r = calcularPlanoCiclo({
      ...loja,
      alavancas: [alavanca({ id: '1', ganhoDias: 40 })],
    });
    assert.equal(r.cicloDepoisDias, -8);
    assert.equal(r.alertas.some((a) => /ciclo negativo/.test(a)), true);
  });

  it('cobra o "o que exatamente vai ser feito"', () => {
    const r = calcularPlanoCiclo({
      ...loja,
      alavancas: [alavanca({ id: '1', ganhoDias: 1, detalhe: null })],
    });
    assert.equal(r.alertas.some((a) => /não é ação/.test(a)), true);
  });

  it('não cobra detalhe de alavanca já concluída', () => {
    const r = calcularPlanoCiclo({
      ...loja,
      alavancas: [alavanca({ id: '1', ganhoDias: 1, detalhe: null, status: 'concluida' })],
    });
    assert.equal(r.alertas.some((a) => /não é ação/.test(a)), false);
  });
});

describe('bordas', () => {
  it('sem venda diária, a conta não converte dias em reais', () => {
    const r = calcularPlanoCiclo({ ...loja, vendaDiaria: 0 });
    assert.equal(r.erro !== null, true);
    assert.match(r.erro!, /converter dias em reais/);
  });

  it('plano vazio sugere por onde começar', () => {
    const r = calcularPlanoCiclo({ ...loja, alavancas: [] });
    assert.equal(r.erro, null);
    assert.equal(r.ganhoTotalDias, 0);
    assert.equal(r.cicloDepoisDias, 32);
    assert.equal(r.alertas.some((a) => /girar o estoque parado/i.test(a)), true);
  });

  it('ganho fracionado funciona — meio dia é meio dia', () => {
    const r = calcularPlanoCiclo({
      ...loja,
      alavancas: [alavanca({ id: '1', ganhoDias: 0.5 })],
    });
    assert.equal(r.ganhoTotalDias, 0.5);
    assert.equal(r.liberaTotal, 3_000);
  });
});
