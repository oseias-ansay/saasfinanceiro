/**
 * Testes do redator sem IA.
 *
 * Dois grupos importam mais que os outros:
 *
 * 1. **Cobertura.** Todo indicador da régua precisa ter texto. Se alguém
 *    acrescentar um indicador em `regua.ts` e esquecer daqui, o relatório
 *    sai silenciosamente sem mencioná-lo — e ninguém percebe, porque o
 *    texto continua bem formado.
 *
 * 2. **Número em toda frase.** É o que separa relatório personalizado de
 *    carta-modelo, e é a primeira coisa que se perde quando alguém edita
 *    os textos com pressa.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { calcularRegua } from '../regua/regua.js';
import { calcularReguaComercial } from '../regua/regua-comercial.js';
import {
  redigirComercial,
  redigirFinanceiro,
  valorFormatado,
  TEXTOS_FINANCEIRO,
  TEXTOS_COMERCIAL,
} from './redator.js';
import { esquemaAnaliseComercial, esquemaAnaliseFinanceira } from './analise.js';

/* ------------------------------------------------------------------ */
/* Entradas de referência                                              */
/* ------------------------------------------------------------------ */

/** Empresa em dificuldade: dispara a maior parte dos vermelhos. */
const apertada = {
  dre: {
    faturamento_bruto: 100_000,
    impostos_sobre_vendas: 8_000,
    custos_variaveis: 62_000,
    despesas_fixas: 45_000,
    pro_labore_socios: 8_000,
    lucro_liquido_informado: -15_000,
  },
  caixa: {
    saldo_caixa_reservas: 5_000,
    pmr_dias: 60,
    pmp_dias: 15,
    pme_dias: 40,
    inadimplencia_pct: 9,
  },
  endividamento: {
    passivo_curto_prazo: 180_000,
    passivo_longo_prazo: 40_000,
    parcela_dividas_mensal: 28_000,
    custo_divida_pct_am: 3.2,
    uso_antecipacao_recebiveis: 'constantemente',
  },
  qualitativo: {
    mistura_contas_pf_pj: 'sim',
    percentual_maior_cliente: 55,
    regime_tributario: 'Simples Nacional',
  },
};

/** Empresa saudável: quase nada vermelho. */
const saudavel = {
  dre: {
    faturamento_bruto: 200_000,
    impostos_sobre_vendas: 12_000,
    custos_variaveis: 70_000,
    despesas_fixas: 40_000,
    pro_labore_socios: 20_000,
    lucro_liquido_informado: 58_000,
  },
  caixa: {
    saldo_caixa_reservas: 200_000,
    pmr_dias: 10,
    pmp_dias: 40,
    pme_dias: 15,
    inadimplencia_pct: 0.5,
  },
  endividamento: {
    passivo_curto_prazo: 10_000,
    passivo_longo_prazo: 30_000,
    parcela_dividas_mensal: 3_000,
    custo_divida_pct_am: 0.9,
    uso_antecipacao_recebiveis: 'nunca',
  },
  qualitativo: {
    mistura_contas_pf_pj: 'nao',
    percentual_maior_cliente: 12,
    regime_tributario: 'Lucro Presumido',
  },
};

const comercialFraco = {
  uso_crm: 'NAO',
  processo_funil_definido: 'NAO',
  nivel_metricas_funil: 'NENHUM',
  previsibilidade_leads: 'BAIXA',
  origem_leads: 'INDICACAO',
  calcula_cac: 'NAO',
  gestao_metas: 'NAO_ACOMPANHA',
  perfil_vendedores: 'GENERALISTA',
  modelo_remuneracao: 'APENAS_FIXO',
  estrategia_upsell: 'NENHUMA',
  pos_venda_estruturado: 'INEXISTENTE',
  ticket_medio: 1_500,
  observacoes: 'A gente perde muito negócio no orçamento.',
};

/* ------------------------------------------------------------------ */
/* Cobertura                                                           */
/* ------------------------------------------------------------------ */

describe('cobertura dos textos', () => {
  it('todo indicador da régua financeira tem texto', () => {
    const r = calcularRegua(apertada);
    const semTexto = r.alertas
      .map((a) => a.indicador)
      .filter((nome) => !TEXTOS_FINANCEIRO[nome]);

    assert.deepEqual(
      semTexto,
      [],
      `Indicadores sem texto em TEXTOS_FINANCEIRO: ${semTexto.join(', ')}`,
    );
  });

  it('todo critério da régua comercial tem texto', () => {
    const r = calcularReguaComercial(comercialFraco);
    const semTexto = r.criterios
      .map((c) => c.criterio)
      .filter((nome) => !TEXTOS_COMERCIAL[nome]);

    assert.deepEqual(
      semTexto,
      [],
      `Critérios sem texto em TEXTOS_COMERCIAL: ${semTexto.join(', ')}`,
    );
  });
});

/* ------------------------------------------------------------------ */
/* O contrato: o schema que a IA cumpria                               */
/* ------------------------------------------------------------------ */

describe('o resultado passa no mesmo schema da análise por IA', () => {
  it('financeiro, empresa apertada', () => {
    const r = redigirFinanceiro(calcularRegua(apertada));
    assert.doesNotThrow(() => esquemaAnaliseFinanceira.parse(r));
  });

  it('financeiro, empresa saudável', () => {
    const r = redigirFinanceiro(calcularRegua(saudavel));
    assert.doesNotThrow(() => esquemaAnaliseFinanceira.parse(r));
  });

  it('financeiro, formulário vazio', () => {
    // O caso que mais quebra template: tudo nulo, nada calculável.
    const r = redigirFinanceiro(calcularRegua({}));
    assert.doesNotThrow(() => esquemaAnaliseFinanceira.parse(r));
  });

  it('comercial', () => {
    const r = redigirComercial(calcularReguaComercial(comercialFraco));
    assert.doesNotThrow(() => esquemaAnaliseComercial.parse(r));
  });

  it('comercial, formulário vazio', () => {
    const r = redigirComercial(calcularReguaComercial({}));
    assert.doesNotThrow(() => esquemaAnaliseComercial.parse(r));
  });
});

/* ------------------------------------------------------------------ */
/* Número em toda frase                                                */
/* ------------------------------------------------------------------ */

describe('cada frase carrega um número do cliente', () => {
  const temNumero = (s: string) => /\d/.test(s);

  it('os gargalos financeiros citam o valor medido', () => {
    const r = redigirFinanceiro(calcularRegua(apertada));
    const sem = r.gargalosIdentificados.filter((g) => !temNumero(g));
    assert.deepEqual(sem, [], `Gargalos sem número: ${sem.join(' | ')}`);
  });

  it('o resumo executivo cita o score', () => {
    const regua = calcularRegua(apertada);
    const r = redigirFinanceiro(regua);
    assert.match(r.resumoExecutivo, new RegExp(String(regua.score.scoreTotal)));
  });

  it('as avaliações por pilar citam a pontuação', () => {
    const r = redigirFinanceiro(calcularRegua(apertada));
    for (const texto of Object.values(r.avaliacoes)) {
      assert.match(texto, /\d+ de \d+ pontos/);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Prioridade e ordem                                                  */
/* ------------------------------------------------------------------ */

describe('a ordem é a ordem de ataque', () => {
  it('vermelhos vêm antes de amarelos no plano', () => {
    const r = redigirFinanceiro(calcularRegua(apertada));
    const prioridades = r.planoDeAcao.map((a) => a.prioridade);
    const ultimaAlta = prioridades.lastIndexOf('Alta');
    const primeiraMedia = prioridades.indexOf('Média');

    if (ultimaAlta >= 0 && primeiraMedia >= 0) {
      assert.ok(ultimaAlta < primeiraMedia, 'Um "Média" apareceu antes de um "Alta"');
    }
  });

  it('empresa apertada gera plano com prioridade Alta', () => {
    const r = redigirFinanceiro(calcularRegua(apertada));
    assert.ok(r.planoDeAcao.some((a) => a.prioridade === 'Alta'));
  });

  it('empresa saudável não inventa urgência', () => {
    const r = redigirFinanceiro(calcularRegua(saudavel));
    assert.ok(r.planoDeAcao.length >= 1, 'O schema exige ao menos uma ação');
    assert.ok(r.planoDeAcao.length <= 12);
  });

  it('no comercial, quem custa mais pontos entra primeiro', () => {
    const r = redigirComercial(calcularReguaComercial(comercialFraco));
    assert.equal(r.planoDeAcao[0]?.prioridade, 'Alta');
  });
});

/* ------------------------------------------------------------------ */
/* O texto livre do cliente                                            */
/* ------------------------------------------------------------------ */

describe('observações do cliente', () => {
  it('são citadas no relatório, nunca interpretadas', () => {
    const r = redigirComercial(calcularReguaComercial(comercialFraco));
    assert.match(r.relatorioDetalhadoHtml, /perde muito negócio no orçamento/);
    assert.match(r.relatorioDetalhadoHtml, /tratado na conversa com o consultor/);
  });

  it('sem observação, a seção não aparece', () => {
    const r = redigirComercial(
      calcularReguaComercial({ ...comercialFraco, observacoes: null }),
    );
    assert.equal(/O que você nos contou/.test(r.relatorioDetalhadoHtml), false);
  });

  it('HTML no texto do cliente é escapado', () => {
    const r = redigirComercial(
      calcularReguaComercial({
        ...comercialFraco,
        observacoes: '<script>alert(1)</script>',
      }),
    );
    assert.equal(r.relatorioDetalhadoHtml.includes('<script>'), false);
    assert.match(r.relatorioDetalhadoHtml, /&lt;script&gt;/);
  });
});

/* ------------------------------------------------------------------ */
/* Determinismo                                                        */
/* ------------------------------------------------------------------ */

describe('determinismo', () => {
  it('a mesma entrada produz exatamente o mesmo relatório', () => {
    const a = redigirFinanceiro(calcularRegua(apertada));
    const b = redigirFinanceiro(calcularRegua(apertada));
    assert.deepEqual(a, b);
  });

  it('entradas diferentes produzem relatórios diferentes', () => {
    // Trava o pior defeito possível num redator por template: devolver o
    // mesmo texto para empresas diferentes.
    const a = redigirFinanceiro(calcularRegua(apertada));
    const b = redigirFinanceiro(calcularRegua(saudavel));
    assert.notEqual(a.resumoExecutivo, b.resumoExecutivo);
    assert.notEqual(a.relatorioDetalhadoHtml, b.relatorioDetalhadoHtml);
  });
});

/* ------------------------------------------------------------------ */
/* Formatação                                                          */
/* ------------------------------------------------------------------ */

describe('valorFormatado', () => {
  const alerta = (valor: number | null, unidade: string) =>
    ({ indicador: 'x', valor, unidade, status: 'vermelho', formula: '' }) as const;

  it('percentual', () => assert.equal(valorFormatado(alerta(6.2, '%')), '6,2%'));
  it('dias', () => assert.equal(valorFormatado(alerta(47, 'dias')), '47 dias'));
  it('um mês, no singular', () => assert.equal(valorFormatado(alerta(1, 'meses')), '1 mês'));
  it('vários meses', () => assert.equal(valorFormatado(alerta(2.5, 'meses')), '2,5 meses'));
  it('multiplicador', () => assert.equal(valorFormatado(alerta(3, 'x')), '3x'));
  it('sem dados não vira zero', () =>
    assert.equal(valorFormatado(alerta(null, '%')), 'sem dados'));
});
