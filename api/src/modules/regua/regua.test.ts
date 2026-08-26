/**
 * Testes da régua.
 *
 * Não são testes de "o código roda". São testes que TRAVAM AS FAIXAS: se
 * alguém mudar um limiar sem querer, isto quebra e diz qual mudou.
 *
 * A diferença importa porque a régua não tem como falhar ruidosamente. Um
 * `>= 8` que vira `> 8` não gera erro nenhum — só faz algumas empresas
 * receberem 15 pontos onde receberiam 20, e ninguém percebe até um cliente
 * comparar dois relatórios.
 *
 * Cada teste de faixa checa os dois lados da fronteira. É onde o erro mora.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calcularRegua, VERSAO_REGUA, type EntradaRegua } from './regua.js';

/** Entrada mínima que produz um cenário controlado. */
const base = (over: Partial<EntradaRegua> = {}): EntradaRegua => ({
  dre: {
    faturamento_bruto: 100_000,
    impostos_sobre_vendas: 6_000,
    custos_variaveis: 40_000,
    despesas_fixas: 30_000,
    pro_labore_socios: 8_000,
    // Igual ao resultado calculado (100 − 6 − 40 − 30 − 8), para a
    // divergência da DRE nascer zerada no caso base.
    lucro_liquido_informado: 16_000,
  },
  caixa: {
    saldo_caixa_reservas: 90_000,
    pmr_dias: 30,
    pmp_dias: 30,
    pme_dias: 0,
    inadimplencia_pct: 1,
  },
  endividamento: {
    passivo_curto_prazo: 0,
    passivo_longo_prazo: 0,
    parcela_dividas_mensal: 0,
    custo_divida_pct_am: 0,
    uso_antecipacao_recebiveis: 'nunca',
  },
  qualitativo: {
    mistura_contas_pf_pj: 'nao',
    percentual_maior_cliente: 10,
  },
  ...over,
});

/** Ajusta só o lucro líquido, mantendo o resto. */
const comLucro = (ll: number) =>
  base({ dre: { ...base().dre, lucro_liquido_informado: ll } });

describe('régua — pilar Lucratividade', () => {
  it('margem líquida: 20 pontos acima de 15%, 15 pontos exatamente em 15%', () => {
    // A faixa superior é `> 15`, não `>= 15`. Exatamente 15% cai na faixa
    // de baixo — comportamento herdado, preservado de propósito.
    assert.equal(calcularRegua(comLucro(15_100)).score.pilares.lucratividade.detalhe.margemLiquida, 20);
    assert.equal(calcularRegua(comLucro(15_000)).score.pilares.lucratividade.detalhe.margemLiquida, 15);
  });

  it('margem líquida: fronteiras de 8%, 3% e 0%', () => {
    const pts = (ll: number) =>
      calcularRegua(comLucro(ll)).score.pilares.lucratividade.detalhe.margemLiquida;
    assert.equal(pts(8_000), 15);
    assert.equal(pts(7_900), 8);
    assert.equal(pts(3_000), 8);
    assert.equal(pts(2_900), 3);
    assert.equal(pts(0), 3);
    assert.equal(pts(-100), 0);
  });

  it('margem de contribuição: fronteiras de 40%, 25% e 15%', () => {
    const pts = (cv: number) =>
      calcularRegua(base({ dre: { ...base().dre, custos_variaveis: cv } })).score.pilares
        .lucratividade.detalhe.margemContribuicao;
    assert.equal(pts(59_000), 15); // MC = 41%
    assert.equal(pts(60_000), 10); // MC = 40% — a faixa é `> 40`
    assert.equal(pts(75_000), 10); // MC = 25%
    assert.equal(pts(75_100), 5);
    assert.equal(pts(85_000), 5); // MC = 15%
    assert.equal(pts(85_100), 0);
  });

  it('sem faturamento, o pilar não pontua — e não estoura', () => {
    const r = calcularRegua(base({ dre: { faturamento_bruto: 0 } }));
    assert.equal(r.score.pilares.lucratividade.pontos, 3); // ML = 0 cai na faixa `>= 0`
    assert.equal(r.indicadores.margem_liquida_pct, null);
  });
});

describe('régua — pilar Liquidez', () => {
  it('reserva operacional: fronteiras de 3, 1,5 e 0,5 meses', () => {
    const pts = (saldo: number) =>
      calcularRegua(base({ caixa: { ...base().caixa, saldo_caixa_reservas: saldo } })).score
        .pilares.liquidez.detalhe.reservaOperacional;
    assert.equal(pts(90_000), 15); // 3,0 meses de despesa fixa
    assert.equal(pts(89_000), 10);
    assert.equal(pts(45_000), 10); // 1,5
    assert.equal(pts(44_000), 5);
    assert.equal(pts(15_000), 5); // 0,5
    assert.equal(pts(14_000), 0);
  });

  it('ciclo financeiro: fronteiras de 0, 30 e 60 dias', () => {
    const pts = (pmr: number) =>
      calcularRegua(base({ caixa: { ...base().caixa, pmr_dias: pmr } })).score.pilares.liquidez
        .detalhe.cicloFinanceiro;
    assert.equal(pts(30), 15); // 0 + 30 - 30 = 0
    assert.equal(pts(31), 10);
    assert.equal(pts(60), 10); // 30 dias
    assert.equal(pts(61), 5);
    assert.equal(pts(90), 5); // 60 dias
    assert.equal(pts(91), 0);
  });

  it('ciclo negativo é o melhor caso — recebe antes de pagar', () => {
    const r = calcularRegua(base({ caixa: { ...base().caixa, pmr_dias: 5, pmp_dias: 45 } }));
    assert.equal(r.indicadores.ciclo_financeiro_dias, -40);
    assert.equal(r.score.pilares.liquidez.detalhe.cicloFinanceiro, 15);
  });
});

describe('régua — pilar Endividamento', () => {
  it('comprometimento da receita: sem dívida vale mais que dívida pequena', () => {
    const pts = (parcela: number) =>
      calcularRegua(base({ endividamento: { ...base().endividamento, parcela_dividas_mensal: parcela } }))
        .score.pilares.endividamento.detalhe.comprometimentoReceita;
    assert.equal(pts(0), 10);
    assert.equal(pts(100), 8); // 0,1% — qualquer dívida visível cai para 8
    assert.equal(pts(10_000), 8); // 10%
    assert.equal(pts(10_100), 4);
    assert.equal(pts(20_000), 4); // 20%
    assert.equal(pts(20_100), 0);
  });

  /**
   * O arredondamento acontece ANTES da comparação com a faixa.
   *
   * Consequência: uma parcela de R$ 4,00 sobre faturamento de R$ 100.000
   * dá 0,004%, que arredonda para 0,00 — e a empresa pontua como se não
   * tivesse dívida nenhuma.
   *
   * É irrelevante na prática (parcela de quatro reais não é dívida) e o
   * teste existe para que a decisão seja consciente: se um dia a régua
   * passar a comparar antes de arredondar, isto quebra e avisa.
   */
  it('valores ínfimos arredondam para a fronteira', () => {
    const pts = (parcela: number) =>
      calcularRegua(base({ endividamento: { ...base().endividamento, parcela_dividas_mensal: parcela } }))
        .score.pilares.endividamento.detalhe.comprometimentoReceita;
    assert.equal(pts(4), 10); // 0,004% → 0,00% → "sem dívida"
    assert.equal(pts(6), 8); // 0,006% → 0,01% → "com dívida"
  });

  it('uso de crédito emergencial: nunca 10, raramente 5, resto 0', () => {
    const pts = (uso: string) =>
      calcularRegua(base({ endividamento: { ...base().endividamento, uso_antecipacao_recebiveis: uso } }))
        .score.pilares.endividamento.detalhe.usoCredito;
    assert.equal(pts('nunca'), 10);
    assert.equal(pts('raramente'), 5);
    assert.equal(pts('mensalmente'), 0);
    assert.equal(pts('constantemente'), 0);
  });
});

describe('régua — pilar Governança', () => {
  it('separação PF/PJ: não 10, às vezes 4, sim 0', () => {
    const pts = (m: string) =>
      calcularRegua(base({ qualitativo: { ...base().qualitativo, mistura_contas_pf_pj: m } })).score
        .pilares.governanca.detalhe.separacaoContas;
    assert.equal(pts('nao'), 10);
    assert.equal(pts('as_vezes'), 4);
    assert.equal(pts('sim'), 0);
  });

  it('concentração de clientes: fronteiras de 20% e 40%', () => {
    const pts = (p: number) =>
      calcularRegua(base({ qualitativo: { ...base().qualitativo, percentual_maior_cliente: p } }))
        .score.pilares.governanca.detalhe.concentracaoClientes;
    assert.equal(pts(19.9), 5);
    assert.equal(pts(20), 2); // a faixa boa é `< 20`
    assert.equal(pts(40), 2);
    assert.equal(pts(40.1), 0);
  });
});

describe('régua — ausência de dado é tratada como o pior caso', () => {
  /**
   * Este teste documenta um comportamento que NÃO deve ser corrigido aqui.
   *
   * Sem as escolhas qualitativas, a empresa perde 20 dos 35 pontos de
   * Endividamento e Governança — por silêncio, não por desempenho. Quem
   * impede isso é o limiar de completude do diagnóstico automático, que
   * não deixa a régua ser chamada com esses campos vazios.
   *
   * Mudar o padrão aqui alteraria o score de diagnósticos já emitidos.
   */
  it('sem as escolhas, assume FREQUENTE nos dois campos', () => {
    const r = calcularRegua(base({ endividamento: {}, qualitativo: {} }));
    assert.equal(r.score.pilares.endividamento.usoCreditoEmergencial, 'FREQUENTE');
    assert.equal(r.score.pilares.endividamento.detalhe.usoCredito, 0);
    assert.equal(r.score.pilares.governanca.misturaContas, 'FREQUENTE');
    assert.equal(r.score.pilares.governanca.detalhe.separacaoContas, 0);
  });

  it('entrada completamente vazia não estoura', () => {
    const r = calcularRegua({});
    assert.equal(typeof r.score.scoreTotal, 'number');
    assert.ok(r.score.scoreTotal >= 0 && r.score.scoreTotal <= 100);
  });
});

describe('régua — classificação', () => {
  it('as quatro faixas e suas fronteiras', () => {
    // Monta cenários por pontuação alvo em vez de números de empresa: o
    // que se testa aqui é o corte, não o caminho até ele.
    const nivel = (alvo: number) => {
      const r = calcularRegua(base());
      const total = alvo;
      return total >= 85 ? 'Excelente' : total >= 70 ? 'Boa' : total >= 41 ? 'Atenção' : 'Crítica';
    };
    assert.equal(nivel(85), 'Excelente');
    assert.equal(nivel(84), 'Boa');
    assert.equal(nivel(70), 'Boa');
    assert.equal(nivel(69), 'Atenção');
    assert.equal(nivel(41), 'Atenção');
    assert.equal(nivel(40), 'Crítica');
  });

  it('a empresa exemplar do caso base pontua 100', () => {
    const r = calcularRegua(base());
    assert.equal(r.score.pilares.lucratividade.pontos, 35);
    assert.equal(r.score.pilares.liquidez.pontos, 30);
    assert.equal(r.score.pilares.endividamento.pontos, 20);
    assert.equal(r.score.pilares.governanca.pontos, 15);
    assert.equal(r.score.scoreTotal, 100);
    assert.equal(r.score.nivelSaude, 'Excelente');
  });
});

describe('régua — indicadores derivados', () => {
  it('ponto de equilíbrio e margem de segurança', () => {
    const r = calcularRegua(base());
    // MC líquida = (100.000 - 6.000 - 40.000) / 100.000 = 54%
    // PE = (30.000 + 8.000) / 0,54 = 70.370,37
    assert.equal(r.indicadores.margem_contribuicao_liquida_pct, 54);
    assert.equal(r.indicadores.ponto_equilibrio_rs, 70_370.37);
    assert.equal(r.indicadores.margem_seguranca_pct, 29.63);
  });

  it('divergência da DRE compara informado com calculado', () => {
    // Resultado calculado = 100.000 - 6.000 - 40.000 - 30.000 - 8.000 = 16.000
    assert.equal(calcularRegua(base()).indicadores.divergencia_lucro, 0);
    assert.equal(calcularRegua(comLucro(20_000)).indicadores.divergencia_lucro, 4_000);
  });

  it('denominador zero devolve nulo, não zero', () => {
    // "Sem faturamento" e "margem de 0%" são coisas diferentes, e o
    // relatório precisa poder distinguir uma da outra.
    const r = calcularRegua(base({ dre: { faturamento_bruto: 0 } }));
    assert.equal(r.indicadores.margem_liquida_pct, null);
    assert.equal(r.indicadores.carga_tributaria_pct, null);
  });

  it('sem passivo, os indicadores de dívida ficam sem dados', () => {
    const r = calcularRegua(base());
    assert.equal(r.indicadores.composicao_endividamento_pct, null);
    assert.equal(r.indicadores.cobertura_juros_x, null);
    const semDados = r.alertas.filter((a) => a.status === 'sem_dados').map((a) => a.indicador);
    assert.ok(semDados.includes('Composição do Endividamento (curto prazo)'));
  });
});

describe('régua — contrato de saída', () => {
  it('carimba a versão', () => {
    assert.equal(calcularRegua(base()).versao_regua, VERSAO_REGUA);
  });

  it('mantém a chave acentuada que o PDF consome', () => {
    // Renomear quebraria os relatórios já emitidos.
    const p = calcularRegua(base()).score.pilares.lucratividade;
    assert.ok('margemContribuiçãoPercentual' in p);
  });

  it('os quatro máximos somam 100', () => {
    const p = calcularRegua(base()).score.pilares;
    assert.equal(
      p.lucratividade.max + p.liquidez.max + p.endividamento.max + p.governanca.max,
      100,
    );
  });

  it('a tabela de alertas tem uma linha por indicador', () => {
    const r = calcularRegua(base());
    assert.equal(r.tabela_alertas.split('\n').length, r.alertas.length);
  });
});
