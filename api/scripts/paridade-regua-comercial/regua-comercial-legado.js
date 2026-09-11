/**
 * A régua comercial COMO ELA RODAVA NO n8n. Cópia literal.
 *
 * Não corrija nada aqui. Este arquivo é a testemunha: ele existe para
 * provar que a versão em TypeScript produz os mesmos números que a
 * produção produzia. Um "melhoramento" neste arquivo destrói a única
 * evidência que temos de que a migração não mudou score de ninguém.
 *
 * Extraído em 11/09/2026 do nó `Calcular Score Comercial` do fluxo
 * `jYxPWbwjQZ7SyRbE`. As únicas mudanças são de embalagem: recebe o
 * bloco `comercial` como argumento em vez de ler `$input`, e devolve o
 * objeto em vez de `[{ json: ... }]`.
 */

export function original(c) {
  c = c || {};

  const n = (v) => Number(v) || 0;
  const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
  const pt = (valor, tabela) => (tabela[valor] !== undefined ? tabela[valor] : 0);

  const ptsCRM = pt(c.uso_crm, { SIM: 10, PARCIAL: 5, NAO: 0 });
  const ptsFunil = pt(c.processo_funil_definido, { SIM: 10, PARCIAL: 5, NAO: 0 });
  const ptsMetricas = pt(c.nivel_metricas_funil, { COMPLETO: 10, BASICO: 5, NENHUM: 0 });
  const ptsProcessoEFunil = ptsCRM + ptsFunil + ptsMetricas;

  const ptsPrevisibilidade = pt(c.previsibilidade_leads, { ALTA: 12, MEDIA: 6, BAIXA: 0 });
  const ptsOrigem = pt(c.origem_leads, { PROPRIA: 10, MISTA: 8, INDICACAO: 3 });
  const ptsCAC = pt(c.calcula_cac, { SIM: 8, NAO: 0 });
  const ptsGeracaoDemanda = ptsPrevisibilidade + ptsOrigem + ptsCAC;

  const ptsMetas = pt(c.gestao_metas, { FREQUENTE: 8, MENSAL: 4, SEM_METAS: 0 });
  const ptsEquipe = pt(c.perfil_vendedores, { DEDICADA: 6, HIBRIDA: 3, SOCIOS: 1 });
  const ptsRemuneracao = pt(c.modelo_remuneracao, { FIXO_MAIS_COMISSAO: 6, APENAS_COMISSAO: 4, APENAS_FIXO: 0, NAO_SE_APLICA: 0 });
  const ptsGestaoEEquipe = ptsMetas + ptsEquipe + ptsRemuneracao;

  const ptsUpsell = pt(c.estrategia_upsell, { ATIVA: 10, REATIVA: 4, INEXISTENTE: 0 });
  const ptsPosVenda = pt(c.pos_venda_estruturado, { ATIVO: 10, REATIVO: 4, INEXISTENTE: 0 });
  const ptsPosVendaETicket = ptsUpsell + ptsPosVenda;

  const scoreTotal = ptsProcessoEFunil + ptsGeracaoDemanda + ptsGestaoEEquipe + ptsPosVendaETicket;
  const classificacao = scoreTotal >= 85 ? { nivel: 'Operação Escalável', cor: '#10B981' }
    : scoreTotal >= 66 ? { nivel: 'Comercial em Estruturação', cor: '#84CC16' }
    : scoreTotal >= 41 ? { nivel: 'Comercial Informal', cor: '#F59E0B' }
    : { nivel: 'Comercial Não Estruturado', cor: '#EF4444' };

  const rotuloCiclo = ({ MENOS_7: 'Menos de 7 dias', DE_8_A_30: 'De 8 a 30 dias', DE_31_A_90: 'De 31 a 90 dias', MAIS_90: 'Mais de 90 dias', NAO_SEI: 'Não sabe informar' })[c.ciclo_vendas] || 'Não informado';
  const rotuloOrigem = ({ PROPRIA: 'Geração própria', MISTA: 'Mista', INDICACAO: 'Dependente de indicação' })[c.origem_leads] || 'Não informado';

  const criterios = [
    { pilar: 'Estrutura, Processo e Funil', criterio: 'Uso de CRM', resposta: c.uso_crm, obtido: ptsCRM, maximo: 10 },
    { pilar: 'Estrutura, Processo e Funil', criterio: 'Etapas do funil definidas', resposta: c.processo_funil_definido, obtido: ptsFunil, maximo: 10 },
    { pilar: 'Estrutura, Processo e Funil', criterio: 'Métricas do funil', resposta: c.nivel_metricas_funil, obtido: ptsMetricas, maximo: 10 },
    { pilar: 'Atração e Geração de Demanda', criterio: 'Previsibilidade de leads', resposta: c.previsibilidade_leads, obtido: ptsPrevisibilidade, maximo: 12 },
    { pilar: 'Atração e Geração de Demanda', criterio: 'Origem dos leads', resposta: c.origem_leads, obtido: ptsOrigem, maximo: 10 },
    { pilar: 'Atração e Geração de Demanda', criterio: 'Monitoramento do CAC', resposta: c.calcula_cac, obtido: ptsCAC, maximo: 8 },
    { pilar: 'Equipe, Metas e Gestão', criterio: 'Acompanhamento de metas', resposta: c.gestao_metas, obtido: ptsMetas, maximo: 8 },
    { pilar: 'Equipe, Metas e Gestão', criterio: 'Estrutura da equipe', resposta: c.perfil_vendedores, obtido: ptsEquipe, maximo: 6 },
    { pilar: 'Equipe, Metas e Gestão', criterio: 'Modelo de remuneração', resposta: c.modelo_remuneracao, obtido: ptsRemuneracao, maximo: 6 },
    { pilar: 'Ticket Médio e Pós-Venda', criterio: 'Cross-sell e up-sell', resposta: c.estrategia_upsell, obtido: ptsUpsell, maximo: 10 },
    { pilar: 'Ticket Médio e Pós-Venda', criterio: 'Pós-venda e retenção', resposta: c.pos_venda_estruturado, obtido: ptsPosVenda, maximo: 10 }
  ].map(x => ({ ...x, perdido: x.maximo - x.obtido, aproveitamento: Math.round((x.obtido / x.maximo) * 100) }));

  const oportunidades = criterios.filter(x => x.perdido > 0).sort((a, b) => b.perdido - a.perdido);
  const zerados = criterios.filter(x => x.obtido === 0).map(x => x.criterio);

  const tabelaCriterios = criterios
    .map(x => '- [' + x.pilar + '] ' + x.criterio + ': ' + x.obtido + '/' + x.maximo + ' pts (resposta: ' + (x.resposta || 'n/d') + ')')
    .join('\n');

  const rankingOportunidades = oportunidades
    .map((x, i) => (i + 1) + '. ' + x.criterio + ' — perde ' + x.perdido + ' pts (' + x.pilar + ')')
    .join('\n') || 'Nenhuma — pontuação máxima em todos os critérios.';

  const ticket = n(c.ticket_medio);
  const cac = c.cac_medio === null || c.cac_medio === undefined ? null : n(c.cac_medio);
  const relacaoTicketCac = (cac && cac > 0) ? r2(ticket / cac) : null;

  let alertaCac = null;
  if (relacaoTicketCac !== null) {
    if (relacaoTicketCac < 1) alertaCac = 'CRÍTICO: o CAC é maior que o ticket médio. Cada venda nova nasce no prejuízo, a menos que haja recorrência ou recompra que o formulário não capturou.';
    else if (relacaoTicketCac < 3) alertaCac = 'ATENÇÃO: o ticket médio cobre menos de 3x o CAC. Margem estreita para sustentar a operação comercial.';
    else alertaCac = 'SAUDÁVEL: o ticket médio cobre ' + relacaoTicketCac + 'x o CAC.';
  }

  return {
    score: {
      scoreTotal,
      nivelMaturidade: classificacao.nivel,
      corIdentificadora: classificacao.cor,
      pilares: {
        processoEFunil: { pontos: ptsProcessoEFunil, max: 30, detalhe: { crm: ptsCRM, funil: ptsFunil, metricas: ptsMetricas } },
        geracaoDemanda: { pontos: ptsGeracaoDemanda, max: 30, detalhe: { previsibilidade: ptsPrevisibilidade, origem: ptsOrigem, cac: ptsCAC } },
        gestaoEEquipe: { pontos: ptsGestaoEEquipe, max: 20, detalhe: { metas: ptsMetas, equipe: ptsEquipe, remuneracao: ptsRemuneracao } },
        posVendaETicket: { pontos: ptsPosVendaETicket, max: 20, detalhe: { upsell: ptsUpsell, posVenda: ptsPosVenda } }
      }
    },
    criterios,
    oportunidades,
    criterios_zerados: zerados,
    tabela_criterios: tabelaCriterios,
    ranking_oportunidades: rankingOportunidades,
    contexto: {
      ciclo_vendas: c.ciclo_vendas,
      ciclo_vendas_rotulo: rotuloCiclo,
      origem_leads_rotulo: rotuloOrigem,
      canais_leads: c.canais_leads || [],
      ticket_medio: ticket,
      cac_medio: cac,
      relacao_ticket_cac: relacaoTicketCac,
      alerta_cac: alertaCac,
      observacoes: c.observacoes || null
    },
    nao_pontuados: ['Ciclo de vendas (pergunta 4)', 'Ticket médio (pergunta 11)']
  };
}
