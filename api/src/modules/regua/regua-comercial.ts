/**
 * A régua comercial: respostas do formulário viram pontos.
 *
 * =====================================================================
 * DE ONDE VEIO
 * =====================================================================
 * Era o nó `Calcular Score Comercial` do fluxo *Business Triage —
 * Diagnóstico Comercial* no n8n. Até 11/09/2026 existia em um lugar só,
 * sem cópia, sem histórico e sem teste — e é o cálculo que dá nome ao
 * produto.
 *
 * A tradução é **fiel de propósito**, inclusive onde eu faria diferente.
 * O script de paridade compara esta versão com a original sobre milhares
 * de entradas, e ele só tem valor enquanto as duas concordarem ponto a
 * ponto. Melhoria vem depois, com a versão da régua subindo junto.
 *
 * =====================================================================
 * POR QUE ISTO NÃO PODE SER FEITO PELA IA
 * =====================================================================
 * O prompt diz, em maiúsculas, que a pontuação já foi calculada e que o
 * modelo não deve recalcular nada. Esta é a razão: o score é a promessa
 * auditável do diagnóstico. Duas empresas com as mesmas respostas têm de
 * receber o mesmo número, hoje e daqui a um ano — e modelo de linguagem
 * não oferece isso.
 */

export const VERSAO_REGUA_COMERCIAL = '1.0.0';

/* ------------------------------------------------------------------ */
/* Entrada                                                             */
/* ------------------------------------------------------------------ */

/**
 * O bloco `comercial` do formulário, como o site já envia.
 *
 * Todo campo é opcional porque ausência é resposta possível: quem não
 * respondeu pontua zero, e recusar o diagnóstico inteiro por um campo em
 * branco seria pior para o prospect do que calcular com o que há.
 */
export interface EntradaComercial {
  uso_crm?: string | null;
  processo_funil_definido?: string | null;
  nivel_metricas_funil?: string | null;

  previsibilidade_leads?: string | null;
  origem_leads?: string | null;
  calcula_cac?: string | null;

  gestao_metas?: string | null;
  perfil_vendedores?: string | null;
  modelo_remuneracao?: string | null;

  estrategia_upsell?: string | null;
  pos_venda_estruturado?: string | null;

  ciclo_vendas?: string | null;
  canais_leads?: string[] | null;
  ticket_medio?: number | string | null;
  cac_medio?: number | string | null;
  observacoes?: string | null;
}

/* ------------------------------------------------------------------ */
/* Saída                                                               */
/* ------------------------------------------------------------------ */

export interface CriterioComercial {
  pilar: string;
  criterio: string;
  resposta: string | null | undefined;
  obtido: number;
  maximo: number;
  perdido: number;
  aproveitamento: number;
}

export interface PilarComercial {
  pontos: number;
  max: number;
  detalhe: Record<string, number>;
}

export interface ScoreComercial {
  scoreTotal: number;
  nivelMaturidade: string;
  corIdentificadora: string;
  pilares: {
    processoEFunil: PilarComercial;
    geracaoDemanda: PilarComercial;
    gestaoEEquipe: PilarComercial;
    posVendaETicket: PilarComercial;
  };
}

export interface ContextoComercial {
  ciclo_vendas: string | null | undefined;
  ciclo_vendas_rotulo: string;
  origem_leads_rotulo: string;
  canais_leads: string[];
  ticket_medio: number;
  cac_medio: number | null;
  relacao_ticket_cac: number | null;
  alerta_cac: string | null;
  observacoes: string | null;
}

export interface ResultadoComercial {
  versao_regua: string;
  score: ScoreComercial;
  criterios: CriterioComercial[];
  oportunidades: CriterioComercial[];
  criterios_zerados: string[];
  tabela_criterios: string;
  ranking_oportunidades: string;
  contexto: ContextoComercial;
  nao_pontuados: string[];
}

/* ------------------------------------------------------------------ */
/* Auxiliares                                                          */
/* ------------------------------------------------------------------ */

const n = (v: unknown): number => Number(v) || 0;
const r2 = (v: number): number | null =>
  Number.isFinite(v) ? Math.round(v * 100) / 100 : null;

/**
 * Resposta desconhecida vale zero.
 *
 * Inclui o caso em que o formulário ganha uma opção nova e a tabela aqui
 * não é atualizada. Zerar é a escolha certa: o score fica baixo demais e
 * alguém repara. O contrário — assumir pontuação média para o que não se
 * reconhece — produziria um número plausível e errado, que ninguém
 * questiona.
 *
 * ---------------------------------------------------------------------
 * A ÚNICA DIVERGÊNCIA DELIBERADA EM RELAÇÃO AO n8n
 * ---------------------------------------------------------------------
 * O original testava `tabela[valor] !== undefined`. Isso encontra as
 * propriedades herdadas do protótipo: `uso_crm: "toString"` devolvia a
 * própria função, e o score virava a string
 * `"function toString() { [native code] }00000"` — sem erro, sem alerta,
 * seguindo para o prompt e para o PDF.
 *
 * Era alcançável de fora: o webhook do diagnóstico é público e não pede
 * autenticação. Bastava um POST com essa palavra para gerar um relatório
 * sem sentido e consumir uma chamada paga ao modelo.
 *
 * `Object.hasOwn` olha só as chaves que a tabela realmente tem. Os casos
 * com nome de método do protótipo estão excluídos da comparação de
 * paridade, e este é o único ponto em que as duas versões discordam.
 */
const pt = (valor: unknown, tabela: Record<string, number>): number =>
  typeof valor === 'string' && Object.hasOwn(tabela, valor) ? (tabela[valor] as number) : 0;

const ROTULO_CICLO: Record<string, string> = {
  MENOS_7: 'Menos de 7 dias',
  DE_8_A_30: 'De 8 a 30 dias',
  DE_31_A_90: 'De 31 a 90 dias',
  MAIS_90: 'Mais de 90 dias',
  NAO_SEI: 'Não sabe informar',
};

const ROTULO_ORIGEM: Record<string, string> = {
  PROPRIA: 'Geração própria',
  MISTA: 'Mista',
  INDICACAO: 'Dependente de indicação',
};

/* ------------------------------------------------------------------ */
/* O cálculo                                                           */
/* ------------------------------------------------------------------ */

export function calcularReguaComercial(c: EntradaComercial = {}): ResultadoComercial {
  // ---- Pilar 1: Estrutura, Processo e Funil (30) --------------------
  const ptsCRM = pt(c.uso_crm, { SIM: 10, PARCIAL: 5, NAO: 0 });
  const ptsFunil = pt(c.processo_funil_definido, { SIM: 10, PARCIAL: 5, NAO: 0 });
  const ptsMetricas = pt(c.nivel_metricas_funil, { COMPLETO: 10, BASICO: 5, NENHUM: 0 });
  const ptsProcessoEFunil = ptsCRM + ptsFunil + ptsMetricas;

  // ---- Pilar 2: Atração e Geração de Demanda (30) -------------------
  const ptsPrevisibilidade = pt(c.previsibilidade_leads, { ALTA: 12, MEDIA: 6, BAIXA: 0 });
  const ptsOrigem = pt(c.origem_leads, { PROPRIA: 10, MISTA: 8, INDICACAO: 3 });
  const ptsCAC = pt(c.calcula_cac, { SIM: 8, NAO: 0 });
  const ptsGeracaoDemanda = ptsPrevisibilidade + ptsOrigem + ptsCAC;

  // ---- Pilar 3: Equipe, Metas e Gestão (20) -------------------------
  const ptsMetas = pt(c.gestao_metas, { FREQUENTE: 8, MENSAL: 4, SEM_METAS: 0 });
  const ptsEquipe = pt(c.perfil_vendedores, { DEDICADA: 6, HIBRIDA: 3, SOCIOS: 1 });
  const ptsRemuneracao = pt(c.modelo_remuneracao, {
    FIXO_MAIS_COMISSAO: 6,
    APENAS_COMISSAO: 4,
    APENAS_FIXO: 0,
    NAO_SE_APLICA: 0,
  });
  const ptsGestaoEEquipe = ptsMetas + ptsEquipe + ptsRemuneracao;

  // ---- Pilar 4: Ticket Médio e Pós-Venda (20) -----------------------
  const ptsUpsell = pt(c.estrategia_upsell, { ATIVA: 10, REATIVA: 4, INEXISTENTE: 0 });
  const ptsPosVenda = pt(c.pos_venda_estruturado, { ATIVO: 10, REATIVO: 4, INEXISTENTE: 0 });
  const ptsPosVendaETicket = ptsUpsell + ptsPosVenda;

  const scoreTotal = ptsProcessoEFunil + ptsGeracaoDemanda + ptsGestaoEEquipe + ptsPosVendaETicket;

  // NOTA: o corte do segundo patamar é 66 aqui e 70 no `corDoScore` do
  // template do PDF. Entre 66 e 69 a etiqueta diz "em estruturação" e a
  // cor impressa é a de "informal". Preservado como está para não quebrar
  // a paridade — ver o comentário no fim do arquivo.
  const classificacao =
    scoreTotal >= 85
      ? { nivel: 'Operação Escalável', cor: '#10B981' }
      : scoreTotal >= 66
        ? { nivel: 'Comercial em Estruturação', cor: '#84CC16' }
        : scoreTotal >= 41
          ? { nivel: 'Comercial Informal', cor: '#F59E0B' }
          : { nivel: 'Comercial Não Estruturado', cor: '#EF4444' };

  // ---- Detalhamento critério a critério -----------------------------
  const base: Omit<CriterioComercial, 'perdido' | 'aproveitamento'>[] = [
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
    { pilar: 'Ticket Médio e Pós-Venda', criterio: 'Pós-venda e retenção', resposta: c.pos_venda_estruturado, obtido: ptsPosVenda, maximo: 10 },
  ];

  const criterios: CriterioComercial[] = base.map((x) => ({
    ...x,
    perdido: x.maximo - x.obtido,
    aproveitamento: Math.round((x.obtido / x.maximo) * 100),
  }));

  // Onde estão os maiores ganhos possíveis, em ordem de pontos perdidos.
  // É o que o prompt manda o modelo seguir para montar o plano de ação:
  // atacar primeiro o que mais custa pontos.
  const oportunidades = criterios
    .filter((x) => x.perdido > 0)
    .sort((a, b) => b.perdido - a.perdido);

  const criterios_zerados = criterios.filter((x) => x.obtido === 0).map((x) => x.criterio);

  const tabela_criterios = criterios
    .map(
      (x) =>
        `- [${x.pilar}] ${x.criterio}: ${x.obtido}/${x.maximo} pts (resposta: ${x.resposta || 'n/d'})`,
    )
    .join('\n');

  const ranking_oportunidades =
    oportunidades
      .map((x, i) => `${i + 1}. ${x.criterio} — perde ${x.perdido} pts (${x.pilar})`)
      .join('\n') || 'Nenhuma — pontuação máxima em todos os critérios.';

  // ---- Contexto não pontuado ----------------------------------------
  const ticket = n(c.ticket_medio);
  const cac = c.cac_medio === null || c.cac_medio === undefined ? null : n(c.cac_medio);

  // CAC zero devolve nulo, não infinito: empresa que respondeu zero não
  // calcula CAC de verdade, e uma relação "infinita" viraria elogio no
  // relatório — o oposto da leitura correta.
  const relacao_ticket_cac = cac && cac > 0 ? r2(ticket / cac) : null;

  let alerta_cac: string | null = null;
  if (relacao_ticket_cac !== null) {
    if (relacao_ticket_cac < 1) {
      alerta_cac =
        'CRÍTICO: o CAC é maior que o ticket médio. Cada venda nova nasce no prejuízo, a menos que haja recorrência ou recompra que o formulário não capturou.';
    } else if (relacao_ticket_cac < 3) {
      alerta_cac =
        'ATENÇÃO: o ticket médio cobre menos de 3x o CAC. Margem estreita para sustentar a operação comercial.';
    } else {
      alerta_cac = `SAUDÁVEL: o ticket médio cobre ${relacao_ticket_cac}x o CAC.`;
    }
  }

  return {
    versao_regua: VERSAO_REGUA_COMERCIAL,
    score: {
      scoreTotal,
      nivelMaturidade: classificacao.nivel,
      corIdentificadora: classificacao.cor,
      pilares: {
        processoEFunil: {
          pontos: ptsProcessoEFunil,
          max: 30,
          detalhe: { crm: ptsCRM, funil: ptsFunil, metricas: ptsMetricas },
        },
        geracaoDemanda: {
          pontos: ptsGeracaoDemanda,
          max: 30,
          detalhe: { previsibilidade: ptsPrevisibilidade, origem: ptsOrigem, cac: ptsCAC },
        },
        gestaoEEquipe: {
          pontos: ptsGestaoEEquipe,
          max: 20,
          detalhe: { metas: ptsMetas, equipe: ptsEquipe, remuneracao: ptsRemuneracao },
        },
        posVendaETicket: {
          pontos: ptsPosVendaETicket,
          max: 20,
          detalhe: { upsell: ptsUpsell, posVenda: ptsPosVenda },
        },
      },
    },
    criterios,
    oportunidades,
    criterios_zerados,
    tabela_criterios,
    ranking_oportunidades,
    contexto: {
      ciclo_vendas: c.ciclo_vendas,
      ciclo_vendas_rotulo: (c.ciclo_vendas && ROTULO_CICLO[c.ciclo_vendas]) || 'Não informado',
      origem_leads_rotulo: (c.origem_leads && ROTULO_ORIGEM[c.origem_leads]) || 'Não informado',
      canais_leads: c.canais_leads || [],
      ticket_medio: ticket,
      cac_medio: cac,
      relacao_ticket_cac,
      alerta_cac,

      // `||` e não `??`, de propósito. O original converte string vazia
      // em nulo, e observação em branco é o caso mais comum do
      // formulário. Com `??`, o prompt receberia `Observações do
      // cliente:` seguido de nada — e o modelo tende a inventar contexto
      // para preencher um campo que parece existir e está vazio.
      observacoes: c.observacoes || null,
    },
    nao_pontuados: ['Ciclo de vendas (pergunta 4)', 'Ticket médio (pergunta 11)'],
  };
}

/* =====================================================================
 * DUAS COISAS PARA CORRIGIR NA PRÓXIMA VERSÃO DA RÉGUA
 * =====================================================================
 *
 * Não foram corrigidas agora porque quebrariam a paridade com o n8n, e a
 * paridade é o que prova que a migração não mudou nenhum score. Corrigir
 * junto com a mudança de casa esconderia uma na outra.
 *
 * 1. O CORTE DE 66 CONTRA O DE 70.
 *    Aqui o segundo patamar começa em 66; o `corDoScore` do template do
 *    PDF usa 70. Um score de 67 sai com a etiqueta "Comercial em
 *    Estruturação" e a cor de "Comercial Informal". O cliente vê a
 *    contradição antes de você.
 *
 * 2. `APENAS_FIXO` E `NAO_SE_APLICA` VALEM O MESMO ZERO.
 *    São situações diferentes: a primeira é uma escolha de gestão
 *    discutível; a segunda é "não tenho vendedor". Pontuar igual faz o
 *    diagnóstico tratar um empresário que vende sozinho como se ele
 *    tivesse montado um modelo ruim de remuneração.
 * ===================================================================== */
