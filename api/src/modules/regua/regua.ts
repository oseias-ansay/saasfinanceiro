/**
 * A RÉGUA DO SCORE FINANCEIRO — Business Triage
 * =============================================
 *
 * Este arquivo é o ativo central do produto. Ele define o que "score 61"
 * significa, e é o que sustenta a promessa feita na página pública: dois
 * consultores diferentes, com os mesmos números, chegam ao mesmo
 * diagnóstico.
 *
 * ---------------------------------------------------------------------
 * POR QUE ELE EXISTE AQUI, E NÃO NO n8n
 * ---------------------------------------------------------------------
 * A régua nasceu dentro de um nó de código do n8n, e viveu lá enquanto
 * havia um só consumidor: o diagnóstico manual. Com o diagnóstico
 * automático mensal passam a existir dois — e duas implementações da
 * mesma regra divergem. Não é risco, é questão de tempo.
 *
 * Divergir aqui significa o cliente receber 61 pelo formulário e 58 pelo
 * cálculo automático, no mesmo mês, com os mesmos números. Isso destrói
 * exatamente a coisa que o produto vende.
 *
 * Além disso: um nó de workflow não tem histórico, não tem revisão e não
 * tem cópia. Se alguém editar errado, não há como saber o que mudou.
 *
 * ---------------------------------------------------------------------
 * A REGRA DE OURO
 * ---------------------------------------------------------------------
 * Tudo aqui é determinístico. Nenhuma chamada de rede, nenhuma consulta
 * ao banco, nenhum modelo de linguagem. Entra um objeto, sai um número, e
 * a mesma entrada sempre produz a mesma saída — que é o que torna o
 * resultado auditável pelo cliente.
 *
 * A IA entra depois, e só escreve texto sobre números que já existem.
 *
 * ---------------------------------------------------------------------
 * MUDAR A RÉGUA
 * ---------------------------------------------------------------------
 * Alterar qualquer faixa muda o score de TODAS as empresas — inclusive
 * retroativamente, na leitura da curva. Por isso:
 *
 *   1. Suba a `VERSAO_REGUA` (semântico: faixa nova = minor, correção de
 *      erro = patch).
 *   2. Registre a versão em `regua_versoes` no banco.
 *   3. Nunca recalcule diagnósticos antigos com a régua nova. A curva
 *      compara pontos medidos com a mesma vara; misturar versões produz
 *      uma "evolução" que é só troca de critério.
 *
 * O `15_marco_zero.sql` já carimba a versão em cada diagnóstico e alerta
 * quando uma mesma empresa tem pontos de versões diferentes.
 */

export const VERSAO_REGUA = '1.0.0';

/* ------------------------------------------------------------------ */
/* Entrada                                                             */
/* ------------------------------------------------------------------ */

/**
 * Os mesmos quatro blocos do formulário original.
 *
 * O formato foi preservado de propósito: o n8n já envia exatamente isto,
 * e o cálculo automático monta o mesmo objeto a partir dos lançamentos.
 * Um formato só, dois produtores.
 */
export interface EntradaRegua {
  dre?: {
    faturamento_bruto?: number | null;
    impostos_sobre_vendas?: number | null;
    custos_variaveis?: number | null;
    despesas_fixas?: number | null;
    pro_labore_socios?: number | null;
    lucro_liquido_informado?: number | null;
  };
  caixa?: {
    saldo_caixa_reservas?: number | null;
    pmr_dias?: number | null;
    pmp_dias?: number | null;
    pme_dias?: number | null;
    inadimplencia_pct?: number | null;
  };
  endividamento?: {
    passivo_curto_prazo?: number | null;
    passivo_longo_prazo?: number | null;
    parcela_dividas_mensal?: number | null;
    custo_divida_pct_am?: number | null;
    uso_antecipacao_recebiveis?: string | null;
  };
  qualitativo?: {
    mistura_contas_pf_pj?: string | null;
    percentual_maior_cliente?: number | null;
    regime_tributario?: string | null;
    observacoes?: string | null;
  };
}

/* ------------------------------------------------------------------ */
/* Saída                                                               */
/* ------------------------------------------------------------------ */

export type StatusAlerta = 'verde' | 'amarelo' | 'vermelho' | 'sem_dados';

export interface Alerta {
  indicador: string;
  valor: number | null;
  unidade: string;
  status: StatusAlerta;
  formula: string;
}

export interface Pilar {
  pontos: number;
  max: number;
  detalhe: Record<string, number>;
  [extra: string]: unknown;
}

export interface Score {
  scoreTotal: number;
  nivelSaude: string;
  corIdentificadora: string;
  pilares: {
    lucratividade: Pilar;
    liquidez: Pilar;
    endividamento: Pilar;
    governanca: Pilar;
  };
}

export interface ResultadoRegua {
  versao_regua: string;
  score: Score;
  indicadores: Record<string, number | null>;
  alertas: Alerta[];
  tabela_alertas: string;
  indicadores_criticos: string[];
  indicadores_atencao: string[];
  nao_calculaveis: string[];
}

/* ------------------------------------------------------------------ */
/* Auxiliares                                                          */
/* ------------------------------------------------------------------ */

const n = (v: unknown): number => Number(v) || 0;

/** Duas casas, ou nulo quando o número não existe de verdade. */
const r2 = (v: number): number | null =>
  Number.isFinite(v) ? Math.round(v * 100) / 100 : null;

/**
 * Percentual com guarda de divisão por zero.
 *
 * Devolve `null`, e não `0`, quando o denominador é zero. A diferença
 * importa: margem líquida de 0% é um fato sobre a empresa; margem líquida
 * indefinida por não haver faturamento é ausência de fato. Confundir os
 * dois faz "sem dados" virar "vai mal" no relatório.
 */
const pct = (num: number, den: number): number | null =>
  den ? r2((num / den) * 100) : null;

/**
 * Semáforo de um indicador.
 *
 * `maiorMelhor` inverte a comparação. `sem_dados` é status de primeira
 * classe: o relatório precisa poder dizer "não sei" em vez de chutar.
 */
const faixa = (
  v: number | null | undefined,
  verde: number,
  amarelo: number,
  maiorMelhor: boolean,
): StatusAlerta => {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'sem_dados';
  if (maiorMelhor) return v >= verde ? 'verde' : v >= amarelo ? 'amarelo' : 'vermelho';
  return v <= verde ? 'verde' : v <= amarelo ? 'amarelo' : 'vermelho';
};

const brl = (v: number | null): string =>
  'R$ ' +
  Number(v || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/* ------------------------------------------------------------------ */
/* Normalização das escolhas                                           */
/* ------------------------------------------------------------------ */

/**
 * O valor do formulário vira o rótulo da régua.
 *
 * Repare no `|| 'FREQUENTE'`: **ausência é tratada como o pior caso**.
 * Isso foi decidido quando só existia o formulário manual, onde o campo
 * era obrigatório e ausência significava dado corrompido.
 *
 * Com o cálculo automático a situação muda: ausência passa a significar
 * "o cliente ainda não preencheu o fechamento do mês". Punir isso com
 * zero ponto transforma silêncio em mau desempenho, e o cliente vê o
 * score cair sem ter feito nada de errado.
 *
 * A régua NÃO foi alterada para resolver isso — mudar o comportamento
 * aqui mudaria o score de diagnósticos já emitidos. Quem resolve é o
 * limiar de completude: sem os campos, o relatório não é gerado, e a
 * régua nunca chega a ser chamada com eles vazios.
 */
const USO_CREDITO: Record<string, string> = {
  nunca: 'NUNCA',
  raramente: 'PONTUAL',
  mensalmente: 'FREQUENTE',
  constantemente: 'FREQUENTE',
};

const MISTURA_CONTAS: Record<string, string> = {
  nao: 'SEPARADO',
  as_vezes: 'EVENTUAL',
  sim: 'FREQUENTE',
};

/* ------------------------------------------------------------------ */
/* O cálculo                                                           */
/* ------------------------------------------------------------------ */

export function calcularRegua(entrada: EntradaRegua): ResultadoRegua {
  const d = entrada.dre ?? {};
  const c = entrada.caixa ?? {};
  const e = entrada.endividamento ?? {};
  const q = entrada.qualitativo ?? {};

  // ---------- DRE ----------
  const fat = n(d.faturamento_bruto);
  const imp = n(d.impostos_sobre_vendas);
  const cv = n(d.custos_variaveis);
  const df = n(d.despesas_fixas);
  const pro = n(d.pro_labore_socios);
  const ll = n(d.lucro_liquido_informado);

  const margemContribuicaoLiq = r2(fat - imp - cv);
  const margemContribuicaoLiqPct = pct(fat - imp - cv, fat);
  const custoFixoTotal = r2(df + pro);
  const pontoEquilibrio = margemContribuicaoLiqPct
    ? r2(n(custoFixoTotal) / (margemContribuicaoLiqPct / 100))
    : null;
  const margemSeguranca =
    pontoEquilibrio !== null && fat ? pct(fat - pontoEquilibrio, fat) : null;
  const margemLiquida = pct(ll, fat);
  const cargaTributaria = pct(imp, fat);
  const pesoCustoVariavel = pct(cv, fat);
  const pesoDespesaFixa = pct(df, fat);
  const resultadoDRE = r2(fat - imp - cv - df - pro);
  const divergencia = r2(ll - n(resultadoDRE));
  const divergenciaPct = pct(Math.abs(n(divergencia)), fat);

  // ---------- Caixa e ciclo ----------
  const pmr = n(c.pmr_dias);
  const pmp = n(c.pmp_dias);
  const pme = n(c.pme_dias);
  const cicloOperacional = pmr + pme;
  const cicloFinanceiro = pme + pmr - pmp;
  const desembolsoMensal = r2(imp + cv + df + pro);
  const desembolsoDiario = r2(n(desembolsoMensal) / 30);
  const ncg = r2(cicloFinanceiro * n(desembolsoDiario));
  const saldo = n(c.saldo_caixa_reservas);
  const coberturaCaixaDias = desembolsoDiario ? r2(saldo / desembolsoDiario) : null;
  const inadimplencia = n(c.inadimplencia_pct);
  const perdaInadimplencia = r2((fat * inadimplencia) / 100);
  const gapCapitalGiro = r2(saldo - n(ncg));

  // ---------- Endividamento ----------
  const pcp = n(e.passivo_curto_prazo);
  const plp = n(e.passivo_longo_prazo);
  const passivoTotal = r2(pcp + plp);
  const parcelaDividas = n(e.parcela_dividas_mensal);
  const taxaJuros = n(e.custo_divida_pct_am);
  const jurosMensais = r2((n(passivoTotal) * taxaJuros) / 100);
  const coberturaJuros = jurosMensais ? r2(ll / jurosMensais) : null;
  const composicaoEndividamento = pct(pcp, n(passivoTotal));
  const endividamentoSobreFatAnual = pct(n(passivoTotal), fat * 12);
  const pesoJurosSobreFat = pct(n(jurosMensais), fat);
  const caixaVsDividaCurta = pcp ? r2(saldo / pcp) : null;

  // ==================================================================
  // SCORE (0 a 100)
  // ==================================================================

  const usoCreditoEmergencial =
    USO_CREDITO[String(e.uso_antecipacao_recebiveis ?? '')] ?? 'FREQUENTE';
  const misturaContas =
    MISTURA_CONTAS[String(q.mistura_contas_pf_pj ?? '')] ?? 'FREQUENTE';
  const percentualMaiorCliente = n(q.percentual_maior_cliente);

  // --- Pilar 1: Lucratividade e Eficiência (máx 35) ---
  //
  // Margem líquida pesa mais que margem de contribuição (20 contra 15)
  // porque é o que sobra de fato. Margem de contribuição alta com margem
  // líquida negativa é o retrato da empresa que vende bem e quebra — e a
  // régua precisa distinguir as duas.
  const ML = fat ? n(r2((ll / fat) * 100)) : 0;
  const MC = fat ? n(r2(((fat - cv) / fat) * 100)) : 0;
  const ptsML = ML > 15 ? 20 : ML >= 8 ? 15 : ML >= 3 ? 8 : ML >= 0 ? 3 : 0;
  const ptsMC = MC > 40 ? 15 : MC >= 25 ? 10 : MC >= 15 ? 5 : 0;
  const ptsLucratividade = ptsML + ptsMC;

  // --- Pilar 2: Liquidez e Capital de Giro (máx 30) ---
  //
  // Reserva medida contra DESPESA FIXA, não contra desembolso total: é o
  // que a empresa gasta mesmo faturando zero, e portanto o que define
  // quanto tempo ela sobrevive parada.
  const CRO = df ? n(r2(saldo / df)) : 0;
  const ptsCRO = CRO >= 3 ? 15 : CRO >= 1.5 ? 10 : CRO >= 0.5 ? 5 : 0;
  const ptsCF = cicloFinanceiro <= 0 ? 15 : cicloFinanceiro <= 30 ? 10 : cicloFinanceiro <= 60 ? 5 : 0;
  const ptsLiquidez = ptsCRO + ptsCF;

  // --- Pilar 3: Endividamento e Risco (máx 20) ---
  //
  // A régua original não define a faixa 0 < CRD < 1%. Ela é tratada junto
  // com a faixa 1%–10% (8 pts), a vizinha imediata.
  const CRD = fat ? n(r2((parcelaDividas / fat) * 100)) : 0;
  const ptsCRD = CRD === 0 ? 10 : CRD <= 10 ? 8 : CRD <= 20 ? 4 : 0;
  const ptsCredito =
    usoCreditoEmergencial === 'NUNCA' ? 10 : usoCreditoEmergencial === 'PONTUAL' ? 5 : 0;
  const ptsEndividamento = ptsCRD + ptsCredito;

  // --- Pilar 4: Governança e Mercado (máx 15) ---
  const ptsContas = misturaContas === 'SEPARADO' ? 10 : misturaContas === 'EVENTUAL' ? 4 : 0;
  const ptsConcentracao = percentualMaiorCliente < 20 ? 5 : percentualMaiorCliente <= 40 ? 2 : 0;
  const ptsGovernanca = ptsContas + ptsConcentracao;

  const scoreTotal = ptsLucratividade + ptsLiquidez + ptsEndividamento + ptsGovernanca;

  const classificacao =
    scoreTotal >= 85
      ? { nivel: 'Excelente', cor: '#10B981' }
      : scoreTotal >= 70
        ? { nivel: 'Boa', cor: '#84CC16' }
        : scoreTotal >= 41
          ? { nivel: 'Atenção', cor: '#F59E0B' }
          : { nivel: 'Crítica', cor: '#EF4444' };

  const score: Score = {
    scoreTotal,
    nivelSaude: classificacao.nivel,
    corIdentificadora: classificacao.cor,
    pilares: {
      lucratividade: {
        pontos: ptsLucratividade,
        max: 35,
        margemLiquidaPercentual: ML,
        // A chave acentuada é herança do formato original consumido pelo
        // n8n e pelo template do PDF. Renomear quebraria os relatórios
        // já emitidos, então ela fica.
        'margemContribuiçãoPercentual': MC,
        detalhe: { margemLiquida: ptsML, margemContribuicao: ptsMC },
      },
      liquidez: {
        pontos: ptsLiquidez,
        max: 30,
        reservaMeses: CRO,
        cicloFinanceiroDias: cicloFinanceiro,
        detalhe: { reservaOperacional: ptsCRO, cicloFinanceiro: ptsCF },
      },
      endividamento: {
        pontos: ptsEndividamento,
        max: 20,
        comprometimentoReceitaPercentual: CRD,
        usoCreditoEmergencial,
        detalhe: { comprometimentoReceita: ptsCRD, usoCredito: ptsCredito },
      },
      governanca: {
        pontos: ptsGovernanca,
        max: 15,
        misturaContas,
        percentualMaiorCliente,
        detalhe: { separacaoContas: ptsContas, concentracaoClientes: ptsConcentracao },
      },
    },
  };

  // ---------- Semáforo ----------
  const alertas: Alerta[] = [
    {
      indicador: 'Margem de Contribuição (líquida de impostos)',
      valor: margemContribuicaoLiqPct,
      unidade: '%',
      status: faixa(margemContribuicaoLiqPct, 40, 25, true),
      formula: '(Faturamento - Impostos - Custos Variáveis) / Faturamento',
    },
    {
      indicador: 'Margem Líquida',
      valor: margemLiquida,
      unidade: '%',
      status: faixa(margemLiquida, 10, 4, true),
      formula: 'Lucro Líquido / Faturamento',
    },
    {
      indicador: 'Margem de Segurança',
      valor: margemSeguranca,
      unidade: '%',
      status: faixa(margemSeguranca, 20, 5, true),
      formula: '(Faturamento - Ponto de Equilíbrio) / Faturamento',
    },
    {
      indicador: 'Peso das Despesas Fixas',
      valor: pesoDespesaFixa,
      unidade: '%',
      status: faixa(pesoDespesaFixa, 25, 40, false),
      formula: 'Despesas Fixas / Faturamento',
    },
    {
      indicador: 'Ciclo Financeiro',
      valor: cicloFinanceiro,
      unidade: 'dias',
      status: faixa(cicloFinanceiro, 0, 30, false),
      formula: 'PME + PMR - PMP',
    },
    {
      indicador: 'Reserva Operacional',
      valor: CRO,
      unidade: 'meses',
      status: faixa(CRO, 3, 1.5, true),
      formula: 'Saldo de Caixa / Despesas Fixas',
    },
    {
      indicador: 'Cobertura de Caixa',
      valor: coberturaCaixaDias,
      unidade: 'dias',
      status: faixa(coberturaCaixaDias, 60, 30, true),
      formula: 'Saldo de Caixa / Desembolso Diário',
    },
    {
      indicador: 'Folga de Capital de Giro',
      valor: gapCapitalGiro,
      unidade: 'R$',
      status: faixa(gapCapitalGiro, 0, -0.01, true),
      formula: 'Saldo de Caixa - NCG',
    },
    {
      indicador: 'Inadimplência',
      valor: inadimplencia,
      unidade: '%',
      status: faixa(inadimplencia, 2, 5, false),
      formula: 'Informado pela empresa',
    },
    {
      indicador: 'Comprometimento da Receita com Dívidas',
      valor: CRD,
      unidade: '%',
      status: faixa(CRD, 10, 20, false),
      formula: 'Parcela Mensal de Dívidas / Faturamento',
    },
    {
      indicador: 'Endividamento sobre Faturamento Anual',
      valor: endividamentoSobreFatAnual,
      unidade: '%',
      status: faixa(endividamentoSobreFatAnual, 30, 60, false),
      formula: 'Passivo Total / (Faturamento x 12)',
    },
    {
      indicador: 'Composição do Endividamento (curto prazo)',
      valor: composicaoEndividamento,
      unidade: '%',
      status: faixa(composicaoEndividamento, 40, 70, false),
      formula: 'Passivo Curto Prazo / Passivo Total',
    },
    {
      indicador: 'Cobertura de Juros',
      valor: coberturaJuros,
      unidade: 'x',
      status: faixa(coberturaJuros, 3, 1, true),
      formula: 'Lucro Líquido / Juros Mensais',
    },
    {
      indicador: 'Concentração de Clientes',
      valor: percentualMaiorCliente,
      unidade: '%',
      status: faixa(percentualMaiorCliente, 20, 40, false),
      formula: 'Participação do maior cliente na receita',
    },
    {
      indicador: 'Divergência da DRE',
      valor: divergenciaPct,
      unidade: '%',
      status: faixa(divergenciaPct, 1, 5, false),
      formula: '|Lucro Informado - Lucro Calculado| / Faturamento',
    },
  ];

  const rotulo: Record<StatusAlerta, string> = {
    verde: 'SAUDÁVEL',
    amarelo: 'ATENÇÃO',
    vermelho: 'CRÍTICO',
    sem_dados: 'SEM DADOS',
  };

  const tabelaAlertas = alertas
    .map((a) => {
      const v =
        a.valor === null
          ? 'n/d'
          : a.unidade === 'R$'
            ? brl(a.valor)
            : a.valor + (a.unidade ? ' ' + a.unidade : '');
      return `- ${a.indicador}: ${v} [${rotulo[a.status]}] (fórmula: ${a.formula})`;
    })
    .join('\n');

  return {
    versao_regua: VERSAO_REGUA,
    score,
    indicadores: {
      margem_contribuicao_liquida_rs: margemContribuicaoLiq,
      margem_contribuicao_liquida_pct: margemContribuicaoLiqPct,
      margem_contribuicao_bruta_pct: MC,
      margem_liquida_pct: margemLiquida,
      carga_tributaria_pct: cargaTributaria,
      peso_custo_variavel_pct: pesoCustoVariavel,
      peso_despesa_fixa_pct: pesoDespesaFixa,
      custo_fixo_total: custoFixoTotal,
      ponto_equilibrio_rs: pontoEquilibrio,
      margem_seguranca_pct: margemSeguranca,
      resultado_dre_calculado: resultadoDRE,
      divergencia_lucro: divergencia,
      divergencia_lucro_pct: divergenciaPct,
      ciclo_operacional_dias: cicloOperacional,
      ciclo_financeiro_dias: cicloFinanceiro,
      desembolso_mensal: desembolsoMensal,
      desembolso_diario: desembolsoDiario,
      ncg_rs: ncg,
      gap_capital_giro_rs: gapCapitalGiro,
      reserva_operacional_meses: CRO,
      cobertura_caixa_dias: coberturaCaixaDias,
      perda_inadimplencia_rs: perdaInadimplencia,
      passivo_total: passivoTotal,
      parcela_dividas_mensal: parcelaDividas,
      comprometimento_receita_dividas_pct: CRD,
      juros_mensais_rs: jurosMensais,
      cobertura_juros_x: coberturaJuros,
      composicao_endividamento_pct: composicaoEndividamento,
      endividamento_sobre_fat_anual_pct: endividamentoSobreFatAnual,
      peso_juros_sobre_fat_pct: pesoJurosSobreFat,
      caixa_vs_divida_curta_x: caixaVsDividaCurta,
    },
    alertas,
    tabela_alertas: tabelaAlertas,
    indicadores_criticos: alertas.filter((a) => a.status === 'vermelho').map((a) => a.indicador),
    indicadores_atencao: alertas.filter((a) => a.status === 'amarelo').map((a) => a.indicador),
    // O formulário não coleta balanço patrimonial. Declarar a limitação é
    // parte do método: o relatório diz o que não sabe, em vez de estimar.
    nao_calculaveis: [
      'Liquidez Corrente',
      'Liquidez Seca',
      'ROA',
      'ROE',
      'Giro do Ativo',
      'Imobilização do PL',
    ],
  };
}
