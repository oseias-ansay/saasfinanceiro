// Cópia literal do nó "Calcular Indicadores e Score" do n8n,
// adaptada só no invólucro (recebe objeto, devolve objeto).
export function original(b) {
const id = b.identificacao || {};
const d = b.dre || {};
const c = b.caixa || {};
const e = b.endividamento || {};
const q = b.qualitativo || {};
const n = v => Number(v) || 0;
const r2 = v => Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
const pct = (num, den) => den ? r2((num / den) * 100) : null;
const fat = n(d.faturamento_bruto);
const imp = n(d.impostos_sobre_vendas);
const cv  = n(d.custos_variaveis);
const df  = n(d.despesas_fixas);
const pro = n(d.pro_labore_socios);
const ll  = n(d.lucro_liquido_informado);
const margemContribuicaoLiq = r2(fat - imp - cv);
const margemContribuicaoLiqPct = pct(margemContribuicaoLiq, fat);
const custoFixoTotal = r2(df + pro);
const pontoEquilibrio = margemContribuicaoLiqPct ? r2(custoFixoTotal / (margemContribuicaoLiqPct / 100)) : null;
const margemSeguranca = (pontoEquilibrio !== null && fat) ? pct(fat - pontoEquilibrio, fat) : null;
const margemLiquida = pct(ll, fat);
const cargaTributaria = pct(imp, fat);
const pesoCustoVariavel = pct(cv, fat);
const pesoDespesaFixa = pct(df, fat);
const resultadoDRE = r2(fat - imp - cv - df - pro);
const divergencia = r2(ll - resultadoDRE);
const divergenciaPct = pct(Math.abs(divergencia), fat);
const pmr = n(c.pmr_dias), pmp = n(c.pmp_dias), pme = n(c.pme_dias);
const cicloOperacional = pmr + pme;
const cicloFinanceiro = pme + pmr - pmp;
const desembolsoMensal = r2(imp + cv + df + pro);
const desembolsoDiario = r2(desembolsoMensal / 30);
const ncg = r2(cicloFinanceiro * desembolsoDiario);
const saldo = n(c.saldo_caixa_reservas);
const coberturaCaixaDias = desembolsoDiario ? r2(saldo / desembolsoDiario) : null;
const inadimplencia = n(c.inadimplencia_pct);
const perdaInadimplencia = r2(fat * inadimplencia / 100);
const gapCapitalGiro = r2(saldo - ncg);
const pcp = n(e.passivo_curto_prazo);
const plp = n(e.passivo_longo_prazo);
const passivoTotal = r2(pcp + plp);
const parcelaDividas = n(e.parcela_dividas_mensal);
const taxaJuros = n(e.custo_divida_pct_am);
const jurosMensais = r2(passivoTotal * taxaJuros / 100);
const coberturaJuros = jurosMensais ? r2(ll / jurosMensais) : null;
const composicaoEndividamento = pct(pcp, passivoTotal);
const endividamentoSobreFatAnual = pct(passivoTotal, fat * 12);
const pesoJurosSobreFat = pct(jurosMensais, fat);
const caixaVsDividaCurta = pcp ? r2(saldo / pcp) : null;
const usoCreditoEmergencial = ({ nunca: 'NUNCA', raramente: 'PONTUAL', mensalmente: 'FREQUENTE', constantemente: 'FREQUENTE' })[e.uso_antecipacao_recebiveis] || 'FREQUENTE';
const misturaContas = ({ nao: 'SEPARADO', as_vezes: 'EVENTUAL', sim: 'FREQUENTE' })[q.mistura_contas_pf_pj] || 'FREQUENTE';
const percentualMaiorCliente = n(q.percentual_maior_cliente);
const ML = fat ? r2(ll / fat * 100) : 0;
const MC = fat ? r2((fat - cv) / fat * 100) : 0;
const ptsML = ML > 15 ? 20 : (ML >= 8 ? 15 : (ML >= 3 ? 8 : (ML >= 0 ? 3 : 0)));
const ptsMC = MC > 40 ? 15 : (MC >= 25 ? 10 : (MC >= 15 ? 5 : 0));
const ptsLucratividade = ptsML + ptsMC;
const CRO = df ? r2(saldo / df) : 0;
const ptsCRO = CRO >= 3 ? 15 : (CRO >= 1.5 ? 10 : (CRO >= 0.5 ? 5 : 0));
const ptsCF = cicloFinanceiro <= 0 ? 15 : (cicloFinanceiro <= 30 ? 10 : (cicloFinanceiro <= 60 ? 5 : 0));
const ptsLiquidez = ptsCRO + ptsCF;
const CRD = fat ? r2(parcelaDividas / fat * 100) : 0;
const ptsCRD = CRD === 0 ? 10 : (CRD <= 10 ? 8 : (CRD <= 20 ? 4 : 0));
const ptsCredito = usoCreditoEmergencial === 'NUNCA' ? 10 : (usoCreditoEmergencial === 'PONTUAL' ? 5 : 0);
const ptsEndividamento = ptsCRD + ptsCredito;
const ptsContas = misturaContas === 'SEPARADO' ? 10 : (misturaContas === 'EVENTUAL' ? 4 : 0);
const ptsConcentracao = percentualMaiorCliente < 20 ? 5 : (percentualMaiorCliente <= 40 ? 2 : 0);
const ptsGovernanca = ptsContas + ptsConcentracao;
const scoreTotal = ptsLucratividade + ptsLiquidez + ptsEndividamento + ptsGovernanca;
const classificacao = scoreTotal >= 85 ? { nivel: 'Excelente', cor: '#10B981' }
  : scoreTotal >= 70 ? { nivel: 'Boa', cor: '#84CC16' }
  : scoreTotal >= 41 ? { nivel: 'Atenção', cor: '#F59E0B' }
  : { nivel: 'Crítica', cor: '#EF4444' };
const score = { scoreTotal, nivelSaude: classificacao.nivel, corIdentificadora: classificacao.cor,
  pilares: {
    lucratividade: { pontos: ptsLucratividade, max: 35, margemLiquidaPercentual: ML, 'margemContribuiçãoPercentual': MC, detalhe: { margemLiquida: ptsML, margemContribuicao: ptsMC } },
    liquidez: { pontos: ptsLiquidez, max: 30, reservaMeses: CRO, cicloFinanceiroDias: cicloFinanceiro, detalhe: { reservaOperacional: ptsCRO, cicloFinanceiro: ptsCF } },
    endividamento: { pontos: ptsEndividamento, max: 20, comprometimentoReceitaPercentual: CRD, usoCreditoEmergencial, detalhe: { comprometimentoReceita: ptsCRD, usoCredito: ptsCredito } },
    governanca: { pontos: ptsGovernanca, max: 15, misturaContas, percentualMaiorCliente, detalhe: { separacaoContas: ptsContas, concentracaoClientes: ptsConcentracao } }
  } };
const faixa = (v, verde, amarelo, maiorMelhor) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'sem_dados';
  if (maiorMelhor) return v >= verde ? 'verde' : (v >= amarelo ? 'amarelo' : 'vermelho');
  return v <= verde ? 'verde' : (v <= amarelo ? 'amarelo' : 'vermelho');
};
const alertas = [
  { indicador: 'Margem de Contribuição (líquida de impostos)', valor: margemContribuicaoLiqPct, unidade: '%', status: faixa(margemContribuicaoLiqPct, 40, 25, true), formula: '(Faturamento - Impostos - Custos Variáveis) / Faturamento' },
  { indicador: 'Margem Líquida', valor: margemLiquida, unidade: '%', status: faixa(margemLiquida, 10, 4, true), formula: 'Lucro Líquido / Faturamento' },
  { indicador: 'Margem de Segurança', valor: margemSeguranca, unidade: '%', status: faixa(margemSeguranca, 20, 5, true), formula: '(Faturamento - Ponto de Equilíbrio) / Faturamento' },
  { indicador: 'Peso das Despesas Fixas', valor: pesoDespesaFixa, unidade: '%', status: faixa(pesoDespesaFixa, 25, 40, false), formula: 'Despesas Fixas / Faturamento' },
  { indicador: 'Ciclo Financeiro', valor: cicloFinanceiro, unidade: 'dias', status: faixa(cicloFinanceiro, 0, 30, false), formula: 'PME + PMR - PMP' },
  { indicador: 'Reserva Operacional', valor: CRO, unidade: 'meses', status: faixa(CRO, 3, 1.5, true), formula: 'Saldo de Caixa / Despesas Fixas' },
  { indicador: 'Cobertura de Caixa', valor: coberturaCaixaDias, unidade: 'dias', status: faixa(coberturaCaixaDias, 60, 30, true), formula: 'Saldo de Caixa / Desembolso Diário' },
  { indicador: 'Folga de Capital de Giro', valor: gapCapitalGiro, unidade: 'R$', status: faixa(gapCapitalGiro, 0, -0.01, true), formula: 'Saldo de Caixa - NCG' },
  { indicador: 'Inadimplência', valor: inadimplencia, unidade: '%', status: faixa(inadimplencia, 2, 5, false), formula: 'Informado pela empresa' },
  { indicador: 'Comprometimento da Receita com Dívidas', valor: CRD, unidade: '%', status: faixa(CRD, 10, 20, false), formula: 'Parcela Mensal de Dívidas / Faturamento' },
  { indicador: 'Endividamento sobre Faturamento Anual', valor: endividamentoSobreFatAnual, unidade: '%', status: faixa(endividamentoSobreFatAnual, 30, 60, false), formula: 'Passivo Total / (Faturamento x 12)' },
  { indicador: 'Composição do Endividamento (curto prazo)', valor: composicaoEndividamento, unidade: '%', status: faixa(composicaoEndividamento, 40, 70, false), formula: 'Passivo Curto Prazo / Passivo Total' },
  { indicador: 'Cobertura de Juros', valor: coberturaJuros, unidade: 'x', status: faixa(coberturaJuros, 3, 1, true), formula: 'Lucro Líquido / Juros Mensais' },
  { indicador: 'Concentração de Clientes', valor: percentualMaiorCliente, unidade: '%', status: faixa(percentualMaiorCliente, 20, 40, false), formula: 'Participação do maior cliente na receita' },
  { indicador: 'Divergência da DRE', valor: divergenciaPct, unidade: '%', status: faixa(divergenciaPct, 1, 5, false), formula: '|Lucro Informado - Lucro Calculado| / Faturamento' }
];
const rotulo = { verde: 'SAUDÁVEL', amarelo: 'ATENÇÃO', vermelho: 'CRÍTICO', sem_dados: 'SEM DADOS' };
const brl = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const tabelaAlertas = alertas.map(a => {
  const v = a.valor === null ? 'n/d' : (a.unidade === 'R$' ? brl(a.valor) : a.valor + (a.unidade ? ' ' + a.unidade : ''));
  return '- ' + a.indicador + ': ' + v + ' [' + rotulo[a.status] + '] (fórmula: ' + a.formula + ')';
}).join('\n');
return { score, indicadores: {
      margem_contribuicao_liquida_rs: margemContribuicaoLiq, margem_contribuicao_liquida_pct: margemContribuicaoLiqPct,
      margem_contribuicao_bruta_pct: MC, margem_liquida_pct: margemLiquida, carga_tributaria_pct: cargaTributaria,
      peso_custo_variavel_pct: pesoCustoVariavel, peso_despesa_fixa_pct: pesoDespesaFixa, custo_fixo_total: custoFixoTotal,
      ponto_equilibrio_rs: pontoEquilibrio, margem_seguranca_pct: margemSeguranca, resultado_dre_calculado: resultadoDRE,
      divergencia_lucro: divergencia, divergencia_lucro_pct: divergenciaPct, ciclo_operacional_dias: cicloOperacional,
      ciclo_financeiro_dias: cicloFinanceiro, desembolso_mensal: desembolsoMensal, desembolso_diario: desembolsoDiario,
      ncg_rs: ncg, gap_capital_giro_rs: gapCapitalGiro, reserva_operacional_meses: CRO, cobertura_caixa_dias: coberturaCaixaDias,
      perda_inadimplencia_rs: perdaInadimplencia, passivo_total: passivoTotal, parcela_dividas_mensal: parcelaDividas,
      comprometimento_receita_dividas_pct: CRD, juros_mensais_rs: jurosMensais, cobertura_juros_x: coberturaJuros,
      composicao_endividamento_pct: composicaoEndividamento, endividamento_sobre_fat_anual_pct: endividamentoSobreFatAnual,
      peso_juros_sobre_fat_pct: pesoJurosSobreFat, caixa_vs_divida_curta_x: caixaVsDividaCurta
    },
    alertas, tabela_alertas: tabelaAlertas,
    indicadores_criticos: alertas.filter(a => a.status === 'vermelho').map(a => a.indicador),
    indicadores_atencao: alertas.filter(a => a.status === 'amarelo').map(a => a.indicador),
    nao_calculaveis: ['Liquidez Corrente', 'Liquidez Seca', 'ROA', 'ROE', 'Giro do Ativo', 'Imobilização do PL'] };
}
