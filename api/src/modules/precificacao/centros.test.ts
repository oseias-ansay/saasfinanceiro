/**
 * Testes dos centros de resultado.
 *
 * O primeiro grupo reproduz o exemplo da planilha da Aula 1.8 — a loja
 * das aulas com duas frentes, balcão e entrega.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calcularCentros, type EntradaCentros } from './centros.js';

/** Balcão e entrega, com os números da aula. */
const loja: EntradaCentros = {
  custoComum: 12_000,
  frentes: [
    {
      id: 'balcao',
      nome: 'Balcão',
      receita: 126_000,
      deducoes: 10_080 + 2_480,
      custosVariaveis: 75_600,
      fixosDiretos: 8_000,
      rateioPct: 60,
    },
    {
      id: 'entrega',
      nome: 'Entrega',
      receita: 54_000,
      deducoes: 4_320 + 700,
      custosVariaveis: 32_400,
      fixosDiretos: 6_000,
      rateioPct: 40,
    },
  ],
};

const frente = (r: ReturnType<typeof calcularCentros>, id: string) =>
  r.frentes.find((f) => f.id === id)!;

describe('o exemplo da planilha', () => {
  it('a margem do balcão desconta impostos, cartão e mercadoria', () => {
    // 126.000 − 12.560 − 75.600
    assert.equal(frente(calcularCentros(loja), 'balcao').margemContribuicao, 37_840);
  });

  it('a margem da entrega', () => {
    // 54.000 − 5.020 − 32.400
    assert.equal(frente(calcularCentros(loja), 'entrega').margemContribuicao, 16_580);
  });

  it('a contribuição após diretos desconta o que só existe por causa da frente', () => {
    const r = calcularCentros(loja);
    assert.equal(frente(r, 'balcao').contribuicaoAposDiretos, 29_840);
    assert.equal(frente(r, 'entrega').contribuicaoAposDiretos, 10_580);
  });

  it('o resultado da empresa é a contribuição total menos o comum', () => {
    const r = calcularCentros(loja);
    assert.equal(r.contribuicaoTotal, 40_420);
    assert.equal(r.resultadoTotal, 28_420);
  });
});

/**
 * O ponto da aula: o rateio move resultado entre frentes e não cria
 * nem destrói nada. A soma das diferenças é sempre exatamente zero.
 */
describe('o rateio não cria nem destrói resultado', () => {
  it('a soma das diferenças entre critérios é zero', () => {
    const r = calcularCentros(loja);
    const soma = r.frentes.reduce((s, f) => s + (f.diferencaEntreCriterios ?? 0), 0);
    assert.equal(Math.round(soma * 100) / 100, 0);
  });

  it('o que uma frente ganha, a outra perde', () => {
    const r = calcularCentros(loja);
    const b = frente(r, 'balcao').diferencaEntreCriterios!;
    const e = frente(r, 'entrega').diferencaEntreCriterios!;
    assert.equal(Math.round((b + e) * 100) / 100, 0);
    assert.ok(b * e < 0); // sinais opostos
  });

  it('os dois critérios somam o mesmo resultado de empresa', () => {
    const r = calcularCentros(loja);
    const porReceita = r.frentes.reduce((s, f) => s + (f.resultadoPorReceita ?? 0), 0);
    const porCriterio = r.frentes.reduce((s, f) => s + (f.resultadoPorCriterio ?? 0), 0);
    assert.equal(Math.round(porReceita * 100) / 100, r.resultadoTotal);
    assert.equal(Math.round(porCriterio * 100) / 100, r.resultadoTotal);
  });

  it('o rateio pela receita segue a participação de cada frente', () => {
    const r = calcularCentros(loja);
    // 126.000 de 180.000
    assert.equal(frente(r, 'balcao').rateioReceitaPct, 70);
    assert.equal(frente(r, 'entrega').rateioReceitaPct, 30);
  });

  it('a tela declara quanto o critério move', () => {
    const r = calcularCentros(loja);
    assert.equal(r.alertas.some((a) => /só muda de quem ele é/.test(a)), true);
  });
});

/**
 * A regra de decisão da aula, e o erro caro que ela evita: fechar uma
 * frente que aparece no vermelho só por causa do rateio.
 */
describe('a regra de decisão', () => {
  it('aponta a frente que não paga nem os próprios custos diretos', () => {
    const r = calcularCentros({
      ...loja,
      frentes: [
        loja.frentes[0]!,
        { ...loja.frentes[1]!, fixosDiretos: 30_000 },
      ],
    });
    assert.ok(frente(r, 'entrega').contribuicaoAposDiretos < 0);
    assert.equal(r.alertas.some((a) => /candidata a correção ou fechamento/.test(a)), true);
  });

  it('protege a frente que só fica negativa depois do rateio', () => {
    const r = calcularCentros({ ...loja, custoComum: 38_000 });
    const e = frente(r, 'entrega');
    assert.ok(e.contribuicaoAposDiretos > 0);
    assert.ok(e.resultadoPorReceita! < 0);
    assert.equal(r.alertas.some((a) => /Não feche/.test(a)), true);
  });

  it('não confunde as duas situações', () => {
    // Contribuição positiva e resultado positivo: nenhum dos dois avisos.
    const r = calcularCentros(loja);
    assert.equal(r.alertas.some((a) => /candidata a correção/.test(a)), false);
    assert.equal(r.alertas.some((a) => /Não feche/.test(a)), false);
  });
});

describe('os percentuais do critério informado', () => {
  it('quando não fecham 100%, só o rateio pela receita sai', () => {
    const r = calcularCentros({
      ...loja,
      frentes: [
        { ...loja.frentes[0]!, rateioPct: 50 },
        { ...loja.frentes[1]!, rateioPct: 30 },
      ],
    });
    assert.equal(r.rateioInformadoFecha, false);
    assert.equal(frente(r, 'balcao').resultadoPorCriterio, null);
    assert.equal(frente(r, 'balcao').resultadoPorReceita !== null, true);
    assert.equal(r.alertas.some((a) => /somam 80%/.test(a)), true);
  });

  it('sem nenhum percentual informado, a coluna simplesmente não aparece', () => {
    const r = calcularCentros({
      ...loja,
      frentes: loja.frentes.map((f) => ({ ...f, rateioPct: null })),
    });
    assert.equal(r.rateioInformadoFecha, null);
    assert.equal(frente(r, 'balcao').resultadoPorCriterio, null);
    assert.equal(r.erro, null);
  });
});

describe('o bolo comum', () => {
  it('avisa quando quase tudo está sem centro de custo', () => {
    const r = calcularCentros({
      ...loja,
      custoComum: 50_000,
      frentes: loja.frentes.map((f) => ({ ...f, fixosDiretos: 2_000 })),
    });
    assert.ok(r.comumSobreFixoPct! > 70);
    assert.equal(r.alertas.some((a) => /classifique mais lançamentos/.test(a)), true);
  });

  it('cala quando a classificação está boa', () => {
    const r = calcularCentros(loja); // 12.000 de 26.000 = 46%
    assert.equal(r.alertas.some((a) => /classifique mais lançamentos/.test(a)), false);
  });
});

/**
 * Percentual não paga aluguel: a frente com melhor margem percentual
 * nem sempre é a que mais contribui em reais.
 */
describe('percentual contra reais', () => {
  it('aponta quando as duas leituras discordam', () => {
    const r = calcularCentros({
      custoComum: 5_000,
      frentes: [
        {
          id: 'grande',
          nome: 'Loja grande',
          receita: 200_000,
          deducoes: 20_000,
          custosVariaveis: 140_000,
          fixosDiretos: 5_000,
        },
        {
          id: 'nicho',
          nome: 'Nicho premium',
          receita: 20_000,
          deducoes: 2_000,
          custosVariaveis: 6_000,
          fixosDiretos: 1_000,
        },
      ],
    });
    // Nicho tem margem de 60%; a loja grande, 20% — mas contribui muito mais.
    assert.equal(r.alertas.some((a) => /Percentual não paga aluguel/.test(a)), true);
  });

  /**
   * A própria loja das aulas é um caso desses, e eu não tinha percebido:
   * a ENTREGA tem margem percentual melhor (30,7% contra 30,0%), mas o
   * BALCÃO contribui quase o triplo em reais. É exatamente o ponto da
   * aula acontecendo no exemplo dela.
   */
  it('a loja das aulas também discorda — entrega tem % melhor, balcão dá mais reais', () => {
    const r = calcularCentros(loja);
    assert.ok(frente(r, 'entrega').margemContribuicaoPct! > frente(r, 'balcao').margemContribuicaoPct!);
    assert.ok(frente(r, 'balcao').contribuicaoAposDiretos > frente(r, 'entrega').contribuicaoAposDiretos);
    assert.equal(r.alertas.some((a) => /Percentual não paga aluguel/.test(a)), true);
  });

  it('cala quando a mesma frente lidera nas duas', () => {
    const r = calcularCentros({
      custoComum: 5_000,
      frentes: [
        { id: 'a', nome: 'A', receita: 100_000, deducoes: 10_000, custosVariaveis: 50_000, fixosDiretos: 5_000 },
        { id: 'b', nome: 'B', receita: 20_000, deducoes: 4_000, custosVariaveis: 12_000, fixosDiretos: 1_000 },
      ],
    });
    // A lidera nos dois: 40% de margem contra 20%, e muito mais em reais.
    assert.equal(r.alertas.some((a) => /Percentual não paga aluguel/.test(a)), false);
  });
});

describe('bordas', () => {
  it('uma frente só é erro — não há o que comparar', () => {
    const r = calcularCentros({ custoComum: 1_000, frentes: [loja.frentes[0]!] });
    assert.equal(r.erro !== null, true);
    assert.match(r.erro!, /pelo menos duas frentes/);
  });

  it('frente sem receita não quebra a margem percentual', () => {
    const r = calcularCentros({
      ...loja,
      frentes: [
        loja.frentes[0]!,
        { ...loja.frentes[1]!, receita: 0, deducoes: 0, custosVariaveis: 0 },
      ],
    });
    assert.equal(frente(r, 'entrega').margemContribuicaoPct, null);
    assert.equal(frente(r, 'entrega').rateioReceitaPct, 0);
  });

  it('sem custo comum, o resultado é a própria contribuição', () => {
    const r = calcularCentros({ ...loja, custoComum: 0 });
    assert.equal(frente(r, 'balcao').resultadoPorReceita, 29_840);
    assert.equal(r.resultadoTotal, r.contribuicaoTotal);
  });

  it('três frentes funcionam — a planilha parava em duas', () => {
    const r = calcularCentros({
      custoComum: 9_000,
      frentes: [
        { id: 'a', nome: 'A', receita: 60_000, deducoes: 5_000, custosVariaveis: 30_000, fixosDiretos: 3_000 },
        { id: 'b', nome: 'B', receita: 30_000, deducoes: 2_500, custosVariaveis: 15_000, fixosDiretos: 2_000 },
        { id: 'c', nome: 'C', receita: 10_000, deducoes: 800, custosVariaveis: 5_000, fixosDiretos: 500 },
      ],
    });
    assert.equal(r.frentes.length, 3);
    assert.equal(r.receitaTotal, 100_000);
    const soma = r.frentes.reduce((s, f) => s + (f.resultadoPorReceita ?? 0), 0);
    assert.equal(Math.round(soma * 100) / 100, r.resultadoTotal);
  });
});
