/**
 * Testes da precificação.
 *
 * O primeiro grupo existe porque este é o cálculo mais fácil de errar da
 * plataforma inteira, e o erro é silencioso: some percentual sobre o
 * custo em vez de dividir, e o preço sai plausível, coerente, e baixo
 * demais. Ninguém percebe até a margem não aparecer no fim do mês.
 *
 * Por isso os números abaixo são conferidos à mão, não gerados pela
 * própria função.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calcularPreco, type EntradaPreco } from './precificacao.js';

const base: EntradaPreco = {
  custoDireto: 40,
  impostosPct: 6,
  comissaoPct: 3,
  outrasVariaveisPct: 0,
  despesasFixasPct: 18,
  margemPct: 15,
};

describe('a fórmula', () => {
  it('divide, não multiplica', () => {
    // Soma = 42%. Divisor = 0,58. 40 / 0,58 = 68,9655…
    const r = calcularPreco(base);
    assert.equal(r.viavel, true);
    assert.equal(r.precoSugerido, 68.97);

    // O erro comum daria 40 × 1,42 = 56,80 — quase 18% mais barato.
    assert.notEqual(r.precoSugerido, 56.8);
  });

  it('o preço devolve exatamente os percentuais pedidos', () => {
    const r = calcularPreco(base);
    const p = r.precoSugerido!;

    // Imposto é 6% DO PREÇO, não do custo.
    assert.equal(Math.round(p * 0.06 * 100) / 100, 4.14);
    // E o que sobra para o custo é o divisor.
    assert.equal(Math.round(p * 0.58 * 100) / 100, 40);
  });

  it('sem percentual nenhum, o preço é o custo', () => {
    const r = calcularPreco({
      ...base,
      impostosPct: 0,
      comissaoPct: 0,
      despesasFixasPct: 0,
      margemPct: 0,
    });
    assert.equal(r.precoSugerido, 40);
  });

  it('aceita percentual escrito com vírgula', () => {
    const r = calcularPreco({ ...base, impostosPct: '6,5' as unknown as number });
    assert.equal(r.viavel, true);
  });
});

describe('o denominador', () => {
  it('soma de 100% é inviável, e diz por quê', () => {
    const r = calcularPreco({ ...base, margemPct: 73 }); // 6+3+0+18+73 = 100
    assert.equal(r.viavel, false);
    assert.equal(r.precoSugerido, null);
    assert.match(r.erro ?? '', /não sobra nada para o custo/);
  });

  it('acima de 100% também é recusado', () => {
    const r = calcularPreco({ ...base, margemPct: 200 });
    assert.equal(r.viavel, false);
  });

  it('perto de 100% calcula, mas avisa da sensibilidade', () => {
    const r = calcularPreco({ ...base, margemPct: 65 }); // soma 92%
    assert.equal(r.viavel, true);
    assert.equal(r.alertas.some((a) => /sensível/.test(a)), true);
  });

  it('custo zero não produz preço', () => {
    const r = calcularPreco({ ...base, custoDireto: 0 });
    assert.equal(r.viavel, false);
    assert.match(r.erro ?? '', /custo direto/i);
  });

  it('percentual negativo é recusado', () => {
    const r = calcularPreco({ ...base, comissaoPct: -5 });
    assert.equal(r.viavel, false);
  });

  it('margem zero avisa que é preço de empatar', () => {
    const r = calcularPreco({ ...base, margemPct: 0 });
    assert.equal(r.viavel, true);
    assert.equal(r.alertas.some((a) => /empatar/.test(a)), true);
  });
});

describe('margem de contribuição', () => {
  it('NÃO desconta despesa fixa — é ela que a MC paga', () => {
    const r = calcularPreco(base);
    const p = r.precoSugerido!; // 68,97

    // Variáveis: custo 40 + imposto 4,14 + comissão 2,07 = 46,21
    // MC = 68,97 − 46,21 = 22,76
    assert.equal(r.margemContribuicao, 22.76);

    // Se descontasse a fixa (18% = 12,41), daria 10,35 — e seria o lucro,
    // não a margem de contribuição. É a confusão que este teste trava.
    assert.notEqual(r.margemContribuicao, 10.35);

    assert.equal(r.margemContribuicaoPct, Math.round((22.76 / p) * 10000) / 100);
  });

  it('o índice de MC é a soma da fixa com a margem, quando não há outras', () => {
    // Coerência interna: 18% + 15% = 33%, e a MC tem de bater com isso.
    const r = calcularPreco(base);
    assert.ok(Math.abs(r.margemContribuicaoPct! - 33) < 0.05);
  });
});

describe('ponto de equilíbrio', () => {
  it('quantas unidades pagam a estrutura', () => {
    const r = calcularPreco({ ...base, despesasFixasMensais: 10_000 });
    // 10.000 / 22,76 = 439,4 -> arredonda para cima: vender 439 não paga.
    assert.equal(r.pontoEquilibrioUnidades, 440);
  });

  it('e quanto de faturamento', () => {
    const r = calcularPreco({ ...base, despesasFixasMensais: 10_000 });
    // 10.000 / 0,33 ≈ 30.303
    assert.ok(Math.abs(r.pontoEquilibrioFaturamento! - 30_303) < 50);
  });

  it('sem despesa fixa mensal, não inventa o ponto de equilíbrio', () => {
    const r = calcularPreco(base);
    assert.equal(r.pontoEquilibrioUnidades, null);
    assert.equal(r.pontoEquilibrioFaturamento, null);
  });
});

describe('o faturamento que o rateio pressupõe', () => {
  it('revela a premissa escondida no percentual de despesa fixa', () => {
    // 18% de rateio com R$ 10.000 de fixa só é verdade faturando 55.555.
    const r = calcularPreco({ ...base, despesasFixasMensais: 10_000 });
    assert.ok(Math.abs(r.faturamentoReferencia! - 55_556) < 5);
  });

  it('não calcula quando não há como', () => {
    const r = calcularPreco({ ...base, despesasFixasPct: 0, despesasFixasMensais: 10_000 });
    assert.equal(r.faturamentoReferencia, null);
  });
});

describe('comparação com o preço praticado', () => {
  it('acima do mínimo, sem alarme', () => {
    const r = calcularPreco({ ...base, precoPraticado: 80 });
    assert.equal(r.comparacao?.acimaDoMinimo, true);
    assert.equal(r.comparacao?.diferenca, 11.03);
    assert.equal(r.alertas.some((a) => /abaixo do mínimo/.test(a)), false);
  });

  it('abaixo do mínimo, diz quanto falta por unidade', () => {
    const r = calcularPreco({ ...base, precoPraticado: 60 });
    assert.equal(r.comparacao?.acimaDoMinimo, false);
    assert.equal(r.alertas.some((a) => /abaixo do mínimo/.test(a)), true);
  });

  it('a margem real cai quando se vende mais barato', () => {
    const cheio = calcularPreco({ ...base, precoPraticado: 68.97 });
    const barato = calcularPreco({ ...base, precoPraticado: 60 });

    // No preço sugerido a margem real é a desejada; abaixo dele, encolhe.
    assert.ok(Math.abs(cheio.comparacao!.margemRealPct - 15) < 0.1);
    assert.ok(barato.comparacao!.margemRealPct < 15);
  });

  it('sem preço praticado, não há comparação', () => {
    assert.equal(calcularPreco(base).comparacao, null);
  });
});

/* ------------------------------------------------------------------ */
/* Imposto fixo por unidade — ICMS-ST, ad rem                          */
/* ------------------------------------------------------------------ */

describe('imposto fixo por unidade', () => {
  it('entra no numerador, como custo', () => {
    // Custo 40 + ST 6 = 46. Soma 42% -> divisor 0,58. 46/0,58 = 79,31.
    const r = calcularPreco({ ...base, impostoFixo: 6 });
    assert.equal(r.precoSugerido, 79.31);
  });

  /**
   * O erro que o campo existe para evitar.
   *
   * Tratar R$ 6 de ST como se fosse percentual — ou simplesmente
   * ignorá-lo — dá preços diferentes e ambos errados. Este teste fixa
   * qual é o certo.
   */
  it('não é o mesmo que ignorar nem que somar ao custo depois', () => {
    const com = calcularPreco({ ...base, impostoFixo: 6 });
    const sem = calcularPreco(base);

    // Ignorar dá 68,97 — R$ 10,34 mais barato, e a diferença some da margem.
    assert.equal(sem.precoSugerido, 68.97);
    assert.ok(com.precoSugerido! > sem.precoSugerido!);

    // E equivale exatamente a ter R$ 6 a mais de custo direto.
    const comoCusto = calcularPreco({ ...base, custoDireto: 46 });
    assert.equal(com.precoSugerido, comoCusto.precoSugerido);
  });

  it('aparece na composição como imposto, não como custo', () => {
    const r = calcularPreco({ ...base, impostoFixo: 6 });

    const custo = r.composicao.find((c) => c.rotulo === 'Custo direto');
    const st = r.composicao.find((c) => c.rotulo.includes('ST'));

    assert.equal(custo?.valor, 40, 'O custo direto não pode absorver o ST');
    assert.equal(st?.valor, 6);
  });

  it('não aparece na composição quando é zero', () => {
    const r = calcularPreco(base);
    assert.equal(r.composicao.some((c) => c.rotulo.includes('ST')), false);
  });

  it('reduz a margem de contribuição no mesmo valor', () => {
    const com = calcularPreco({ ...base, impostoFixo: 6 });
    const p = com.precoSugerido!;

    // MC = preço − custo − ST − imposto% − comissão%
    const esperado = Math.round((p - 40 - 6 - p * 0.09) * 100) / 100;
    assert.equal(com.margemContribuicao, esperado);
  });

  it('negativo é recusado', () => {
    const r = calcularPreco({ ...base, impostoFixo: -1 });
    assert.equal(r.viavel, false);
    assert.match(r.erro ?? '', /imposto fixo/i);
  });

  it('custo direto zero continua sendo erro, mesmo com ST informado', () => {
    // Senão um produto sem custo passaria a "ter custo" pelo imposto, e
    // a tela deixaria de cobrar o campo que importa.
    const r = calcularPreco({ ...base, custoDireto: 0, impostoFixo: 10 });
    assert.equal(r.viavel, false);
    assert.match(r.erro ?? '', /custo direto/i);
  });
});
