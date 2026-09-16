/**
 * Necessidade de Capital de Giro.
 *
 * =====================================================================
 * POR QUE DUAS CONTAS, E NÃO UMA
 * =====================================================================
 * "Quanto de capital de giro eu preciso?" tem duas respostas legítimas,
 * e a diferença entre elas é o que decide a ação.
 *
 * **NCG realizada** — contas a receber em aberto, mais estoque, menos
 * contas a pagar em aberto. É o dinheiro travado na operação HOJE. Sai
 * dos lançamentos, sem nada digitado.
 *
 * **NCG estrutural** — ciclo financeiro multiplicado pelo desembolso
 * operacional diário. É quanto a operação exige de forma PERMANENTE
 * para girar no ritmo atual.
 *
 * Se a realizada está muito acima da estrutural, houve um pico — um
 * cliente grande atrasou, uma compra concentrou. Se as duas estão
 * próximas, é assim que a empresa é, e resolver exige mudar prazo, não
 * esperar passar.
 *
 * Mostrar só uma delas produz a decisão errada metade das vezes: quem vê
 * só a realizada num mês atípico vai ao banco sem precisar; quem vê só a
 * estrutural ignora um problema de caixa que já está acontecendo.
 *
 * =====================================================================
 * O NÚMERO QUE FAZ ALGUÉM AGIR
 * =====================================================================
 * `custoPorDiaDeCiclo`. Com desembolso diário de R$ 4.000, cada dia
 * cortado do prazo de recebimento devolve R$ 4.000 ao caixa — sem vender
 * nada a mais, sem tomar crédito.
 *
 * É o único número desta tela que vira ligação para o financeiro na
 * mesma tarde, e por isso ele é calculado mesmo quando o resto falta.
 */

export interface EntradaGiro {
  /** Média mensal das despesas fixas, já revisadas pelo usuário. */
  despesasFixasMensais: number;
  /** Custos que variam com a venda, no mês. */
  custosVariaveisMensais: number;

  /** Prazo médio de recebimento, em dias. Medido dos lançamentos. */
  pmrDias: number;
  /** Prazo médio de pagamento a fornecedores, em dias. */
  pmpDias: number;
  /**
   * Prazo médio de estoque. A plataforma não controla estoque, então
   * este é digitado. Serviço fica em zero e a conta continua correta.
   */
  pmeDias?: number;

  /** Total a receber em aberto. */
  contasAReceber?: number;
  /** Total a pagar em aberto. */
  contasAPagar?: number;
  /** Valor do estoque, quando houver. */
  estoque?: number;

  /** Saldo disponível hoje, para dizer se há folga ou buraco. */
  caixaDisponivel?: number;
}

export interface ResultadoGiro {
  cicloFinanceiroDias: number;
  desembolsoDiario: number;

  ncgEstrutural: number;
  ncgRealizada: number | null;

  /** Quanto cada dia de ciclo prende de caixa. */
  custoPorDiaDeCiclo: number;

  /** Caixa menos a NCG estrutural. Negativo é buraco. */
  folga: number | null;
  /** Quantos dias de operação o caixa cobre. */
  coberturaDias: number | null;

  /**
   * A diferença entre as duas NCGs, quando as duas existem.
   * Positiva: a realizada está acima da estrutural — pico.
   */
  descolamento: number | null;

  alertas: string[];
  erro: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function calcularGiro(e: EntradaGiro): ResultadoGiro {
  const fixas = num(e.despesasFixasMensais);
  const variaveis = num(e.custosVariaveisMensais);

  const pmr = num(e.pmrDias);
  const pmp = num(e.pmpDias);
  const pme = num(e.pmeDias);

  const vazio = (erro: string): ResultadoGiro => ({
    cicloFinanceiroDias: 0,
    desembolsoDiario: 0,
    ncgEstrutural: 0,
    ncgRealizada: null,
    custoPorDiaDeCiclo: 0,
    folga: null,
    coberturaDias: null,
    descolamento: null,
    alertas: [],
    erro,
  });

  if (fixas + variaveis <= 0) {
    return vazio(
      'Informe os custos fixos e variáveis mensais. Sem eles não há como saber quanto a operação consome por dia.',
    );
  }

  if ([pmr, pmp, pme].some((d) => d < 0)) {
    return vazio('Prazos não podem ser negativos.');
  }

  // Mês comercial de 30 dias. Usar 30,4 seria mais exato e menos
  // explicável — e num número que serve para decidir, ser conferível na
  // calculadora do celular vale mais que a terceira casa decimal.
  const desembolsoDiario = r2((fixas + variaveis) / 30);

  const ciclo = r2(pme + pmr - pmp);
  const ncgEstrutural = r2(ciclo * desembolsoDiario);

  const alertas: string[] = [];

  if (ciclo < 0) {
    alertas.push(
      `Ciclo financeiro negativo em ${Math.abs(ciclo)} dias: a empresa recebe antes de pagar, e a operação se financia sozinha. É a posição mais confortável possível — vale proteger essa condição em qualquer renegociação com fornecedor.`,
    );
  }

  // ---- A realizada, quando há dados ---------------------------------
  const receber = num(e.contasAReceber);
  const pagar = num(e.contasAPagar);
  const estoque = num(e.estoque);

  const temDados = receber > 0 || pagar > 0 || estoque > 0;
  const ncgRealizada = temDados ? r2(receber + estoque - pagar) : null;

  const descolamento =
    ncgRealizada !== null ? r2(ncgRealizada - ncgEstrutural) : null;

  if (descolamento !== null && ncgEstrutural > 0) {
    const desvio = Math.abs(descolamento) / ncgEstrutural;
    if (desvio > 0.3) {
      alertas.push(
        descolamento > 0
          ? `A necessidade de hoje (${brl(ncgRealizada!)}) está bem acima da estrutural (${brl(ncgEstrutural)}). Isso costuma ser pico — um recebimento grande atrasou ou uma compra concentrou. Antes de buscar crédito, vale conferir se é permanente.`
          : `A necessidade de hoje (${brl(ncgRealizada!)}) está abaixo da estrutural (${brl(ncgEstrutural)}). Momento favorável, mas a operação no ritmo atual exige ${brl(ncgEstrutural)} de forma permanente — o alívio não é o normal.`,
      );
    }
  }

  // ---- Folga de caixa ------------------------------------------------
  const caixa = e.caixaDisponivel === undefined ? null : num(e.caixaDisponivel);

  const folga = caixa === null ? null : r2(caixa - ncgEstrutural);
  const coberturaDias =
    caixa === null || desembolsoDiario <= 0 ? null : Math.floor(caixa / desembolsoDiario);

  if (folga !== null && folga < 0) {
    alertas.push(
      `Faltam ${brl(Math.abs(folga))} para cobrir a necessidade de capital de giro. Essa diferença está sendo financiada por alguém — fornecedor, banco ou o próprio sócio.`,
    );
  }

  if (coberturaDias !== null && coberturaDias < 30) {
    alertas.push(
      `O caixa cobre ${coberturaDias} dias de operação. Abaixo de 30 dias, qualquer atraso de recebimento vira urgência.`,
    );
  }

  return {
    cicloFinanceiroDias: ciclo,
    desembolsoDiario,
    ncgEstrutural,
    ncgRealizada,
    // Um dia de ciclo vale um dia de desembolso. É a mesma conta da NCG
    // com ciclo igual a 1, e é o número que transforma "negocie prazo"
    // em "negocie prazo e ganhe isto".
    custoPorDiaDeCiclo: desembolsoDiario,
    folga,
    coberturaDias,
    descolamento,
    alertas,
    erro: null,
  };
}
