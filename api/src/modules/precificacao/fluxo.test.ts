/**
 * Testes do fluxo de caixa projetado.
 *
 * A aula 2.4 não traz um exemplo numérico fechado, então os testes
 * verificam as regras que ela afirma: a semana esconde menos que o mês,
 * o lançado não se mistura com o estimado, e o buraco a cobrir é o pior
 * saldo — não a soma dos negativos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calcularFluxo, type EntradaFluxo, type SemanaEntrada } from './fluxo.js';

const semana = (numero: number, p: Partial<SemanaEntrada> = {}): SemanaEntrada => ({
  numero,
  inicio: `2026-10-${String(numero).padStart(2, '0')}`,
  entradasLancadas: 0,
  saidasLancadas: 0,
  ...p,
});

/** Doze semanas sem nada lançado: tudo cai na média. */
const base: EntradaFluxo = {
  saldoInicial: 20_000,
  entradaSemanalMedia: 10_000,
  saidaSemanalMedia: 9_000,
  semanasDeHistorico: 12,
  semanas: Array.from({ length: 12 }, (_, i) => semana(i + 1)),
};

describe('a projeção básica', () => {
  it('cada semana soma entradas e subtrai saídas do saldo anterior', () => {
    const r = calcularFluxo(base);
    assert.equal(r.semanas[0]!.saldoFinal, 21_000);
    assert.equal(r.semanas[1]!.saldoFinal, 22_000);
  });

  it('o saldo final é o da última semana', () => {
    const r = calcularFluxo(base);
    // 20.000 + 12 × 1.000
    assert.equal(r.saldoFinal, 32_000);
    assert.equal(r.saldoFinal, r.semanas[11]!.saldoFinal);
  });

  it('sem nada lançado, tudo vem da média', () => {
    const r = calcularFluxo(base);
    assert.ok(r.semanas.every((s) => s.entradasOrigem === 'estimado'));
    assert.equal(r.parteLancadaPct, 0);
  });
});

/**
 * A regra que sustenta a confiança: quando há título com data, ele é a
 * verdade daquela semana. Completar um título existente com média
 * somaria o compromisso com o palpite e inflaria a semana.
 */
describe('o lançado não se mistura com o estimado', () => {
  it('semana com título usa o título, não a média', () => {
    const r = calcularFluxo({
      ...base,
      semanas: [semana(1, { entradasLancadas: 3_000 }), ...base.semanas.slice(1)],
    });
    assert.equal(r.semanas[0]!.entradas, 3_000);
    assert.equal(r.semanas[0]!.entradasOrigem, 'lancado');
  });

  it('entradas e saídas decidem separado', () => {
    const r = calcularFluxo({
      ...base,
      semanas: [semana(1, { saidasLancadas: 15_000 }), ...base.semanas.slice(1)],
    });
    assert.equal(r.semanas[0]!.entradasOrigem, 'estimado');
    assert.equal(r.semanas[0]!.entradas, 10_000);
    assert.equal(r.semanas[0]!.saidasOrigem, 'lancado');
    assert.equal(r.semanas[0]!.saidas, 15_000);
  });

  it('o ajuste do usuário vence o título e a média', () => {
    const r = calcularFluxo({
      ...base,
      semanas: [
        semana(1, { entradasLancadas: 3_000, entradasAjustadas: 50_000 }),
        ...base.semanas.slice(1),
      ],
    });
    assert.equal(r.semanas[0]!.entradas, 50_000);
    assert.equal(r.semanas[0]!.entradasOrigem, 'ajustado');
    // O lançado continua visível, para o usuário ver o que sobrescreveu.
    assert.equal(r.semanas[0]!.entradasLancadas, 3_000);
  });

  it('ajuste em zero é respeitado — não confundido com vazio', () => {
    const r = calcularFluxo({
      ...base,
      semanas: [semana(1, { entradasAjustadas: 0 }), ...base.semanas.slice(1)],
    });
    assert.equal(r.semanas[0]!.entradas, 0);
    assert.equal(r.semanas[0]!.entradasOrigem, 'ajustado');
  });

  it('declara quanto da projeção é compromisso', () => {
    const r = calcularFluxo({
      ...base,
      semanas: base.semanas.map((s, i) =>
        i < 6 ? { ...s, entradasLancadas: 10_000, saidasLancadas: 9_000 } : s,
      ),
    });
    assert.equal(r.parteLancadaPct, 50);
  });
});

/**
 * O buraco a cobrir é o PIOR SALDO, não a soma dos negativos. Somar os
 * negativos contaria o mesmo dinheiro faltando várias vezes.
 */
describe('a semana negativa', () => {
  const comBuraco: EntradaFluxo = {
    ...base,
    saldoInicial: 5_000,
    semanas: base.semanas.map((s, i) =>
      i === 2 || i === 3 ? { ...s, saidasLancadas: 25_000 } : s,
    ),
  };

  it('conta quantas semanas fecham no vermelho', () => {
    const r = calcularFluxo(comBuraco);
    assert.ok(r.semanasNegativas > 0);
  });

  it('o buraco é o pior saldo, não a soma dos negativos', () => {
    const r = calcularFluxo(comBuraco);
    const somaDosNegativos = r.semanas
      .filter((s) => s.negativa)
      .reduce((a, s) => a + s.saldoFinal, 0);
    assert.ok(Math.abs(r.menorSaldo) < Math.abs(somaDosNegativos));
    assert.equal(r.menorSaldo, Math.min(...r.semanas.map((s) => s.saldoFinal)));
  });

  it('diz quantas semanas de antecedência existem', () => {
    const r = calcularFluxo(comBuraco);
    assert.equal(r.primeiraNegativa, 3);
    assert.equal(r.semanasDeAviso, 2);
  });

  it('lista as saídas na ordem do mais barato para o mais caro', () => {
    const r = calcularFluxo(comBuraco);
    assert.equal(
      r.alertas.some((a) => /Antecipação de recebível e cheque especial são os últimos/.test(a)),
      true,
    );
  });

  it('sem semana negativa, aponta o menor saldo mesmo assim', () => {
    const r = calcularFluxo(base);
    assert.equal(r.semanasNegativas, 0);
    assert.equal(r.primeiraNegativa, null);
    assert.equal(r.alertas.some((a) => /Nenhuma semana negativa/.test(a)), true);
  });
});

/**
 * O argumento da aula, em teste: um mês pode fechar positivo e ter
 * passado semanas no vermelho.
 */
describe('a semana mostra o que o mês esconde', () => {
  it('saldo final positivo com semanas negativas no meio', () => {
    const r = calcularFluxo({
      ...base,
      saldoInicial: 5_000,
      semanas: base.semanas.map((s, i) =>
        i === 1
          ? { ...s, saidasLancadas: 30_000 }
          : i === 3
            ? { ...s, entradasLancadas: 40_000 }
            : s,
      ),
    });
    assert.ok(r.saldoFinal > 0);
    assert.ok(r.semanasNegativas > 0);
  });
});

describe('os avisos sobre a qualidade da projeção', () => {
  it('avisa quando quase tudo é estimativa', () => {
    const r = calcularFluxo(base); // 0% lançado
    assert.equal(r.alertas.some((a) => /o resto é a média/.test(a)), true);
  });

  it('cala quando a maior parte tem data', () => {
    const r = calcularFluxo({
      ...base,
      semanas: base.semanas.map((s) => ({
        ...s,
        entradasLancadas: 10_000,
        saidasLancadas: 9_000,
      })),
    });
    assert.equal(r.parteLancadaPct, 100);
    assert.equal(r.alertas.some((a) => /o resto é a média/.test(a)), false);
  });

  it('avisa quando o histórico é curto demais', () => {
    const r = calcularFluxo({ ...base, semanasDeHistorico: 2 });
    assert.equal(r.alertas.some((a) => /ordem de grandeza, não como número/.test(a)), true);
  });

  /**
   * Saldo que cai em TODAS as semanas não é aperto de caixa: é
   * estrutura. Nenhuma renegociação de prazo resolve.
   */
  it('separa aperto pontual de problema estrutural', () => {
    const r = calcularFluxo({ ...base, entradaSemanalMedia: 7_000 });
    assert.ok(r.saldoFinal < base.saldoInicial);
    assert.equal(r.alertas.some((a) => /a margem ou o custo fixo/.test(a)), true);
  });

  it('não chama de estrutural um saldo que sobe', () => {
    const r = calcularFluxo(base);
    assert.equal(r.alertas.some((a) => /a margem ou o custo fixo/.test(a)), false);
  });
});

describe('bordas', () => {
  it('sem semanas é erro', () => {
    assert.equal(calcularFluxo({ ...base, semanas: [] }).erro !== null, true);
  });

  it('saldo inicial negativo funciona — conta no vermelho existe', () => {
    const r = calcularFluxo({ ...base, saldoInicial: -10_000 });
    assert.equal(r.erro, null);
    assert.equal(r.semanas[0]!.saldoFinal, -9_000);
    assert.equal(r.primeiraNegativa, 1);
    assert.equal(r.semanasDeAviso, 0);
  });

  it('a observação da semana atravessa o cálculo', () => {
    const r = calcularFluxo({
      ...base,
      semanas: [semana(1, { observacao: '  13º da equipe  ' }), ...base.semanas.slice(1)],
    });
    assert.equal(r.semanas[0]!.observacao, '13º da equipe');
  });

  it('observação vazia vira nula, não string em branco', () => {
    const r = calcularFluxo({
      ...base,
      semanas: [semana(1, { observacao: '   ' }), ...base.semanas.slice(1)],
    });
    assert.equal(r.semanas[0]!.observacao, null);
  });
});
