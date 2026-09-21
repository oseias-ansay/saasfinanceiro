/**
 * Indicadores comerciais: ticket, conversão e CAC.
 *
 * Porta da planilha "Indicadores Comerciais — Aula 4.7".
 *
 * =====================================================================
 * A COMPARAÇÃO QUE DECIDE, E A QUE ENGANA
 * =====================================================================
 * Quase todo mundo compara o CAC com o TICKET. Um CAC de R$ 34 contra
 * um ticket de R$ 150 parece folgadíssimo — 23% — e essa conta não
 * decide nada, porque o ticket não é seu: dele saem imposto, cartão,
 * mercadoria e comissão.
 *
 * A conta certa é o CAC contra a MARGEM DE CONTRIBUIÇÃO do primeiro
 * pedido. Os mesmos R$ 34 contra R$ 44 de margem viram 78%: ainda se
 * paga, mas a folga era metade do que parecia. É a mesma confusão entre
 * preço e sobra que a precificação resolve na outra ponta.
 *
 * =====================================================================
 * TRÊS ALAVANCAS, E O QUE CADA UMA VALE
 * =====================================================================
 *     faturamento = atendimentos × conversão × ticket
 *
 * Qualquer crescimento vem de um desses três. A planilha calcula quanto
 * UMA unidade a mais em cada um vale por mês, em margem — porque o dono
 * precisa saber onde empurrar, não só quanto está hoje.
 *
 * =====================================================================
 * O QUE ESTA CONTA NÃO SABE
 * =====================================================================
 * Frequência de compra e tempo de vida do cliente são ESTIMATIVA. O
 * valor do cliente no tempo serve pela ordem de grandeza, não pela
 * precisão — e por isso o teto de verba usa o critério conservador de
 * pagar o CAC já no primeiro pedido, sem contar com recompra que
 * ninguém mediu.
 */

export interface EntradaComercial {
  faturamentoMensal: number;
  /** Cupons, notas ou pedidos. Não clientes. */
  vendas: number;
  /** Pessoas atendidas. O denominador da conversão. */
  atendimentos: number;
  verbaMarketing: number;
  clientesNovos: number;
  /** Margem de contribuição da empresa, em %. */
  margemContribuicaoPct: number;

  /** Estimativa. Sem ela, o bloco de valor no tempo não aparece. */
  comprasPorAno?: number | null;
  anosRelacionamento?: number | null;
}

export type SituacaoCac =
  | 'sem_dados'
  | 'paga_no_primeiro'
  | 'depende_da_recompra'
  | 'insustentavel';

export interface ResultadoComercial {
  ticketMedio: number | null;
  /** Em pontos percentuais: 64.86 e não 0.6486. */
  taxaConversaoPct: number | null;
  cac: number | null;

  /** Quanto um real a mais de ticket vale por mês, em margem. */
  ganhoPorRealDeTicket: number | null;
  /** Quanto um ponto a mais de conversão vale por mês, em margem. */
  ganhoPorPontoDeConversao: number | null;

  /** A conta errada. Existe para ser mostrada ao lado da certa. */
  cacSobreTicketPct: number | null;
  margemDoPrimeiroPedido: number | null;
  /** A conta certa. */
  cacSobreMargemPct: number | null;
  situacao: SituacaoCac;

  valorDoClienteNoTempo: number | null;
  cacSobreValorDoClientePct: number | null;
  tetoDeVerbaMensal: number | null;

  alertas: string[];
  erro: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function calcularComercial(e: EntradaComercial): ResultadoComercial {
  const faturamento = num(e.faturamentoMensal);
  const vendas = num(e.vendas);
  const atendimentos = num(e.atendimentos);
  const verba = num(e.verbaMarketing);
  const novos = num(e.clientesNovos);
  const mcPct = num(e.margemContribuicaoPct);

  const vazio = (erro: string): ResultadoComercial => ({
    ticketMedio: null,
    taxaConversaoPct: null,
    cac: null,
    ganhoPorRealDeTicket: null,
    ganhoPorPontoDeConversao: null,
    cacSobreTicketPct: null,
    margemDoPrimeiroPedido: null,
    cacSobreMargemPct: null,
    situacao: 'sem_dados',
    valorDoClienteNoTempo: null,
    cacSobreValorDoClientePct: null,
    tetoDeVerbaMensal: null,
    alertas: [],
    erro,
  });

  if ([faturamento, vendas, atendimentos, verba, novos].some((v) => v < 0)) {
    return vazio('Nenhum destes números pode ser negativo.');
  }
  if (mcPct < 0 || mcPct > 100) {
    return vazio('A margem de contribuição precisa ficar entre 0 e 100%.');
  }

  if (vendas > 0 && atendimentos > 0 && vendas > atendimentos) {
    // Uma venda exige um atendimento. Mais vendas que atendimentos
    // significa que os dois números vieram de fontes diferentes — e a
    // conversão sairia acima de 100%, o que ninguém questiona porque
    // parece bom.
    return vazio(
      `Há ${vendas} vendas para ${atendimentos} atendimentos. Toda venda passa por um atendimento, então um dos dois números está medindo outra coisa — normalmente o atendimento, que costuma ser contado só em parte.`,
    );
  }

  const alertas: string[] = [];

  /* ----------------------------------------------- Os três indicadores */
  const ticketMedio = vendas > 0 ? r2(faturamento / vendas) : null;
  const taxaConversaoPct = atendimentos > 0 ? r2((vendas / atendimentos) * 100) : null;
  const cac = novos > 0 ? r2(verba / novos) : null;

  // Quanto vale mexer uma unidade em cada alavanca, por mês, em margem.
  const ganhoPorRealDeTicket = vendas > 0 ? r2(vendas * (mcPct / 100)) : null;
  const ganhoPorPontoDeConversao =
    atendimentos > 0 && ticketMedio !== null
      ? r2(atendimentos * 0.01 * ticketMedio * (mcPct / 100))
      : null;

  /* ------------------------------------ A comparação que decide verba */
  const margemDoPrimeiroPedido = ticketMedio !== null ? r2(ticketMedio * (mcPct / 100)) : null;

  const cacSobreTicketPct =
    cac !== null && ticketMedio !== null && ticketMedio > 0
      ? r2((cac / ticketMedio) * 100)
      : null;

  const cacSobreMargemPct =
    cac !== null && margemDoPrimeiroPedido !== null && margemDoPrimeiroPedido > 0
      ? r2((cac / margemDoPrimeiroPedido) * 100)
      : null;

  // As faixas saem do valor exato, não do arredondado — a mesma
  // correção que a provisão precisou: 99,996% arredonda para 100 e
  // mudaria de faixa sozinho.
  const razaoExata =
    cac !== null && margemDoPrimeiroPedido !== null && margemDoPrimeiroPedido > 0
      ? cac / margemDoPrimeiroPedido
      : null;

  const situacao: SituacaoCac =
    razaoExata === null
      ? 'sem_dados'
      : razaoExata < 1
        ? 'paga_no_primeiro'
        : razaoExata < 3
          ? 'depende_da_recompra'
          : 'insustentavel';

  if (situacao === 'paga_no_primeiro' && cacSobreMargemPct !== null) {
    alertas.push(
      `Cada cliente novo custa ${brl(cac!)} e deixa ${brl(margemDoPrimeiroPedido!)} de margem já na primeira compra. O marketing se paga no primeiro pedido — e enquanto isso for verdade, aumentar a verba tende a valer a pena.`,
    );
  } else if (situacao === 'depende_da_recompra') {
    alertas.push(
      `Cada cliente novo custa ${brl(cac!)} e a primeira compra deixa ${brl(margemDoPrimeiroPedido!)}. O marketing só se paga se o cliente voltar — e a empresa precisa SABER que ele volta, não supor.`,
    );
  } else if (situacao === 'insustentavel') {
    alertas.push(
      `Cada cliente novo custa ${brl(cac!)}, mais de três vezes a margem da primeira compra (${brl(margemDoPrimeiroPedido!)}). Nessa faixa, vender mais aumenta o prejuízo em vez de diluí-lo.`,
    );
  }

  if (cacSobreTicketPct !== null && cacSobreMargemPct !== null) {
    alertas.push(
      `Sobre o ticket, o CAC parece consumir ${cacSobreTicketPct}%. Sobre a margem — que é o que sobra de verdade — ele consome ${cacSobreMargemPct}%. É essa a diferença entre a conta que tranquiliza e a que decide.`,
    );
  }

  /* -------------------------------------- O valor do cliente no tempo */
  const compras = num(e.comprasPorAno);
  const anos = num(e.anosRelacionamento);

  let valorDoClienteNoTempo: number | null = null;
  let cacSobreValorDoClientePct: number | null = null;

  if (margemDoPrimeiroPedido !== null && compras > 0 && anos > 0) {
    valorDoClienteNoTempo = r2(margemDoPrimeiroPedido * compras * anos);
    cacSobreValorDoClientePct =
      cac !== null && valorDoClienteNoTempo > 0
        ? r2((cac / valorDoClienteNoTempo) * 100)
        : null;
  }

  // Teto conservador: pagar o CAC já no PRIMEIRO pedido, para os mesmos
  // clientes novos do mês. Usar o valor no tempo aqui daria um teto
  // muito maior, apoiado numa recompra que é estimativa.
  const tetoDeVerbaMensal =
    margemDoPrimeiroPedido !== null && novos > 0 ? r2(margemDoPrimeiroPedido * novos) : null;

  if (tetoDeVerbaMensal !== null && verba > tetoDeVerbaMensal) {
    alertas.push(
      `A verba de ${brl(verba)} está acima do teto prudente de ${brl(tetoDeVerbaMensal)} — o valor que os ${novos} clientes novos deste mês devolvem já na primeira compra. Acima disso, o retorno depende de recompra.`,
    );
  }

  /* ------------------------------------------ O que falta para medir */
  if (atendimentos === 0) {
    alertas.push(
      'Sem o número de atendimentos não há taxa de conversão — e é a conversão que mostra quanto da demanda que já chega está sendo perdida. Uma folha no balcão e um traço por pessoa atendida já basta para começar.',
    );
  }
  if (novos === 0 && verba > 0) {
    alertas.push(
      `Há ${brl(verba)} de verba e nenhum cliente novo contado. Sem esse número o CAC não existe, e a verba passa a ser decidida por sensação. Pergunte "como você chegou até a gente?" e anote.`,
    );
  }

  return {
    ticketMedio,
    taxaConversaoPct,
    cac,
    ganhoPorRealDeTicket,
    ganhoPorPontoDeConversao,
    cacSobreTicketPct,
    margemDoPrimeiroPedido,
    cacSobreMargemPct,
    situacao,
    valorDoClienteNoTempo,
    cacSobreValorDoClientePct,
    tetoDeVerbaMensal,
    alertas,
    erro: null,
  };
}
