/**
 * Imprime no terminal o relatório que o `redator.ts` produz hoje.
 *
 * Existe para encurtar o ciclo de escrita: editar o texto, rodar, ler.
 * Sem deploy, sem banco, sem e-mail, sem chamada paga.
 *
 *   npm run redator:exemplo
 *   npm run redator:exemplo -- saudavel
 *   npm run redator:exemplo -- comercial
 *
 * As três empresas de exemplo cobrem os casos que importam: a que está
 * em dificuldade (quase tudo vermelho), a saudável (quase nada) e a
 * comercial. Se o texto ficar bom nas três, ficou bom.
 */

import { calcularRegua } from '../dist/modules/regua/regua.js';
import { calcularReguaComercial } from '../dist/modules/regua/regua-comercial.js';
import { redigirFinanceiro, redigirComercial } from '../dist/modules/diagnosticos/redator.js';

const EMPRESAS = {
  apertada: {
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
  },

  saudavel: {
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
  },
};

const COMERCIAL = {
  uso_crm: 'PARCIAL',
  processo_funil_definido: 'NAO',
  nivel_metricas_funil: 'BASICO',
  previsibilidade_leads: 'BAIXA',
  origem_leads: 'INDICACAO',
  calcula_cac: 'NAO',
  gestao_metas: 'MENSAL',
  perfil_vendedores: 'GENERALISTA',
  modelo_remuneracao: 'FIXO_MAIS_COMISSAO',
  estrategia_upsell: 'REATIVA',
  pos_venda_estruturado: 'REATIVO',
  ticket_medio: 1_500,
  observacoes: 'A gente perde muito negócio na hora do orçamento.',
};

/* ------------------------------------------------------------------ */

const linha = (c = '─') => c.repeat(74);
const titulo = (t) => `\n${linha()}\n  ${t.toUpperCase()}\n${linha()}`;

/** Quebra o parágrafo em 74 colunas, para ler no terminal como se lê no PDF. */
function envolver(texto, largura = 74) {
  const palavras = String(texto).split(/\s+/);
  const linhas = [];
  let atual = '';

  for (const p of palavras) {
    if ((atual + ' ' + p).trim().length > largura) {
      linhas.push(atual.trim());
      atual = p;
    } else {
      atual += ' ' + p;
    }
  }
  if (atual.trim()) linhas.push(atual.trim());
  return linhas.join('\n');
}

function imprimir(nome, r, score, nivel) {
  console.log(titulo(`${nome} — score ${score} (${nivel})`));

  console.log('\n■ RESUMO EXECUTIVO\n');
  console.log(envolver(r.resumoExecutivo));

  console.log('\n■ AVALIAÇÃO POR PILAR\n');
  for (const texto of Object.values(r.avaliacoes)) {
    console.log(envolver(texto));
    console.log('');
  }

  console.log('■ GARGALOS\n');
  const gargalos = r.gargalosIdentificados ?? r.gargalosCriticos;
  gargalos.forEach((g, i) => {
    console.log(envolver(`${i + 1}. ${g}`, 72));
    console.log('');
  });

  console.log('■ PLANO DE AÇÃO\n');
  for (const a of r.planoDeAcao) {
    console.log(`[${a.prioridade}] ${a.pilar}`);
    console.log(envolver(`    ${a.acaoRecomendada}`, 70));
    console.log('');
  }

  console.log(`(relatório em HTML: ${r.relatorioDetalhadoHtml.length} caracteres)`);
}

/* ------------------------------------------------------------------ */

const qual = (process.argv[2] ?? 'apertada').toLowerCase();

if (qual === 'comercial') {
  const regua = calcularReguaComercial(COMERCIAL);
  imprimir('Comercial', redigirComercial(regua), regua.score.scoreTotal, regua.score.nivelMaturidade);
} else if (qual === 'todos') {
  for (const [nome, dados] of Object.entries(EMPRESAS)) {
    const regua = calcularRegua(dados);
    imprimir(nome, redigirFinanceiro(regua), regua.score.scoreTotal, regua.score.nivelSaude);
  }
  const c = calcularReguaComercial(COMERCIAL);
  imprimir('Comercial', redigirComercial(c), c.score.scoreTotal, c.score.nivelMaturidade);
} else {
  const dados = EMPRESAS[qual];
  if (!dados) {
    console.error(`Empresa desconhecida: "${qual}". Use apertada, saudavel, comercial ou todos.`);
    process.exit(1);
  }
  const regua = calcularRegua(dados);
  imprimir(qual, redigirFinanceiro(regua), regua.score.scoreTotal, regua.score.nivelSaude);
}

console.log('');
