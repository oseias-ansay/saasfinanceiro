/**
 * Testes dos indicadores comerciais.
 *
 * O primeiro grupo reproduz o exemplo da planilha da Aula 4.7 — ticket
 * de R$ 150, conversão de 64,9% e CAC de R$ 34,44.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calcularComercial, type EntradaComercial } from './comercial.js';

/** A loja das aulas. */
const loja: EntradaComercial = {
  faturamentoMensal: 180_000,
  vendas: 1_200,
  atendimentos: 1_850,
  verbaMarketing: 620,
  clientesNovos: 18,
  margemContribuicaoPct: 29.41,
  comprasPorAno: 3.2,
  anosRelacionamento: 2.5,
};

describe('o exemplo da planilha', () => {
  it('o ticket médio é 150', () => {
    assert.equal(calcularComercial(loja).ticketMedio, 150);
  });

  it('a conversão é 64,86%', () => {
    assert.equal(calcularComercial(loja).taxaConversaoPct, 64.86);
  });

  it('o CAC é 34,44', () => {
    assert.equal(calcularComercial(loja).cac, 34.44);
  });

  it('a margem do primeiro pedido é 44,12', () => {
    assert.equal(calcularComercial(loja).margemDoPrimeiroPedido, 44.12);
  });

  it('o teto prudente de verba é 794,16', () => {
    // 44,12 × 18 clientes novos
    assert.equal(calcularComercial(loja).tetoDeVerbaMensal, 794.16);
  });

  it('o marketing se paga no primeiro pedido', () => {
    assert.equal(calcularComercial(loja).situacao, 'paga_no_primeiro');
  });
});

/**
 * O ponto inteiro da aula.
 *
 * O CAC sobre o ticket parece folgado; sobre a margem, aperta. A
 * primeira conta tranquiliza e não decide nada.
 */
describe('CAC sobre o ticket engana; sobre a margem, decide', () => {
  it('as duas contas dão respostas bem diferentes', () => {
    const r = calcularComercial(loja);
    assert.equal(r.cacSobreTicketPct, 22.96);
    assert.equal(r.cacSobreMargemPct, 78.06);
    assert.ok(r.cacSobreMargemPct! > r.cacSobreTicketPct! * 3);
  });

  it('a tela mostra as duas lado a lado', () => {
    const r = calcularComercial(loja);
    assert.equal(r.alertas.some((a) => /tranquiliza e a que decide/.test(a)), true);
  });

  it('margem menor piora a conta certa e não muda a errada', () => {
    const magra = calcularComercial({ ...loja, margemContribuicaoPct: 10 });
    assert.equal(magra.cacSobreTicketPct, 22.96); // igual
    assert.ok(magra.cacSobreMargemPct! > 200); // muito pior
    assert.equal(magra.situacao, 'depende_da_recompra');
  });
});

describe('as três alavancas', () => {
  it('um real a mais de ticket vale vendas × margem por mês', () => {
    // 1200 vendas × 29,41% = 352,92
    assert.equal(calcularComercial(loja).ganhoPorRealDeTicket, 352.92);
  });

  it('um ponto a mais de conversão vale atendimentos × 1% × ticket × margem', () => {
    // 1850 × 0,01 × 150 × 0,2941 = 816,13
    assert.equal(calcularComercial(loja).ganhoPorPontoDeConversao, 816.13);
  });

  it('a conversão é a alavanca mais valiosa nesta loja', () => {
    const r = calcularComercial(loja);
    assert.ok(r.ganhoPorPontoDeConversao! > r.ganhoPorRealDeTicket!);
  });
});

describe('as faixas do CAC', () => {
  // Ticket de 100, margem de 20% → margem do 1º pedido = 20.
  const comCac = (cac: number): EntradaComercial => ({
    ...loja,
    faturamentoMensal: 100_000,
    vendas: 1_000,
    margemContribuicaoPct: 20,
    clientesNovos: 10,
    verbaMarketing: cac * 10,
  });

  it('abaixo de 100% da margem, se paga no primeiro', () => {
    assert.equal(calcularComercial(comCac(19.99)).situacao, 'paga_no_primeiro');
  });

  it('igual à margem já depende da recompra', () => {
    assert.equal(calcularComercial(comCac(20)).situacao, 'depende_da_recompra');
  });

  it('até três vezes a margem, depende da recompra', () => {
    assert.equal(calcularComercial(comCac(59)).situacao, 'depende_da_recompra');
  });

  it('acima de três vezes, insustentável', () => {
    const r = calcularComercial(comCac(60));
    assert.equal(r.situacao, 'insustentavel');
    assert.equal(r.alertas.some((a) => /aumenta o prejuízo/.test(a)), true);
  });
});

describe('o valor do cliente no tempo', () => {
  it('é a margem do primeiro pedido vezes compras vezes anos', () => {
    // 44,12 × 3,2 × 2,5 = 352,96
    assert.equal(calcularComercial(loja).valorDoClienteNoTempo, 352.96);
  });

  it('some quando a estimativa não foi informada', () => {
    const r = calcularComercial({ ...loja, comprasPorAno: null, anosRelacionamento: null });
    assert.equal(r.valorDoClienteNoTempo, null);
    assert.equal(r.cacSobreValorDoClientePct, null);
    // Mas o resto da tela continua inteiro.
    assert.equal(r.cac, 34.44);
    assert.equal(r.tetoDeVerbaMensal, 794.16);
  });

  /**
   * O teto de verba NÃO usa o valor no tempo de propósito.
   *
   * Frequência e tempo de vida são estimativa; apoiar o teto neles daria
   * um limite muito maior, sustentado por um número que ninguém mediu.
   */
  it('o teto de verba ignora a recompra estimada', () => {
    const com = calcularComercial(loja);
    const sem = calcularComercial({ ...loja, comprasPorAno: null, anosRelacionamento: null });
    assert.equal(com.tetoDeVerbaMensal, sem.tetoDeVerbaMensal);
  });
});

describe('o teto de verba', () => {
  it('avisa quando a verba passa dele', () => {
    const r = calcularComercial({ ...loja, verbaMarketing: 2_000 });
    assert.equal(r.alertas.some((a) => /acima do teto prudente/.test(a)), true);
  });

  it('cala quando a verba cabe', () => {
    const r = calcularComercial(loja); // 620 contra teto de 794
    assert.equal(r.alertas.some((a) => /acima do teto prudente/.test(a)), false);
  });
});

/**
 * Mais vendas que atendimentos é impossível, e o sintoma é uma
 * conversão acima de 100% — que ninguém questiona porque parece boa.
 */
describe('o número que não pode acontecer', () => {
  it('recusa mais vendas do que atendimentos', () => {
    const r = calcularComercial({ ...loja, vendas: 2_000, atendimentos: 1_850 });
    assert.equal(r.erro !== null, true);
    assert.match(r.erro!, /medindo outra coisa/);
  });

  it('vendas iguais a atendimentos é válido — conversão de 100%', () => {
    const r = calcularComercial({ ...loja, vendas: 1_850, atendimentos: 1_850 });
    assert.equal(r.erro, null);
    assert.equal(r.taxaConversaoPct, 100);
  });
});

describe('o que ainda não é medido', () => {
  it('sem atendimentos, a conversão some e a tela pede o número', () => {
    const r = calcularComercial({ ...loja, atendimentos: 0 });
    assert.equal(r.taxaConversaoPct, null);
    assert.equal(r.ganhoPorPontoDeConversao, null);
    assert.equal(r.alertas.some((a) => /folha no balcão/.test(a)), true);
    // O ticket e o CAC continuam.
    assert.equal(r.ticketMedio, 150);
    assert.equal(r.cac, 34.44);
  });

  it('verba sem cliente novo contado é apontada', () => {
    const r = calcularComercial({ ...loja, clientesNovos: 0 });
    assert.equal(r.cac, null);
    assert.equal(r.situacao, 'sem_dados');
    assert.equal(r.alertas.some((a) => /decidida por sensação/.test(a)), true);
  });

  it('sem verba nenhuma, o CAC é zero e nada disso é erro', () => {
    const r = calcularComercial({ ...loja, verbaMarketing: 0 });
    assert.equal(r.cac, 0);
    assert.equal(r.situacao, 'paga_no_primeiro');
    assert.equal(r.erro, null);
  });
});

describe('bordas', () => {
  it('sem vendas, não há ticket nem margem de primeiro pedido', () => {
    const r = calcularComercial({ ...loja, vendas: 0, faturamentoMensal: 0 });
    assert.equal(r.ticketMedio, null);
    assert.equal(r.margemDoPrimeiroPedido, null);
    assert.equal(r.situacao, 'sem_dados');
    assert.equal(r.erro, null);
  });

  it('margem fora da faixa é recusada', () => {
    assert.equal(calcularComercial({ ...loja, margemContribuicaoPct: 101 }).erro !== null, true);
  });

  it('número negativo é recusado', () => {
    assert.equal(calcularComercial({ ...loja, verbaMarketing: -1 }).erro !== null, true);
  });

  it('margem zero não quebra — dá margem de primeiro pedido zero', () => {
    const r = calcularComercial({ ...loja, margemContribuicaoPct: 0 });
    assert.equal(r.margemDoPrimeiroPedido, 0);
    assert.equal(r.cacSobreMargemPct, null);
    assert.equal(r.situacao, 'sem_dados');
    assert.equal(r.erro, null);
  });
});
