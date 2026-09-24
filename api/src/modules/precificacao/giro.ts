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
 * `valorDeUmDiaDeCiclo`. Com venda diária de R$ 6.000, cada dia cortado
 * do prazo de recebimento devolve R$ 6.000 ao caixa — sem vender nada a
 * mais, sem tomar crédito.
 *
 * É o único número desta tela que vira ligação para o financeiro na
 * mesma tarde, e por isso ele é calculado mesmo quando o resto falta.
 *
 * =====================================================================
 * UM DIA DE CICLO VALE UMA VENDA DIÁRIA — 24/09/2026
 * =====================================================================
 * Até esta data o valor de um dia aqui era o DESEMBOLSO diário,
 * (fixas + variáveis) / 30, enquanto a tela de Ciclo Financeiro usava a
 * VENDA diária, receita / 30. O mesmo cliente via duas respostas para a
 * mesma pergunta em duas telas, e a segunda que ele abrisse destruía a
 * confiança na primeira.
 *
 * A régua escolhida é a venda diária, por três motivos. O ciclo, na
 * plataforma, é medido em dias de venda — `ciclo.ts` deriva os prazos de
 * saldo ÷ venda diária e tem teste para a identidade
 * `ciclo × venda diária = estoque + a receber − a pagar`. Usar outro
 * multiplicador quebraria a identidade que o próprio código promete. O
 * Plano de Redução de Ciclo já convertia dias em reais por venda diária.
 * E é a régua da planilha da aula 4.1, que o aluno tem em mãos.
 *
 * Nenhum multiplicador único é exato, e vale registrar por quê: estoque
 * e fornecedor são financiados a CUSTO, enquanto o a receber carrega
 * PREÇO DE VENDA. O rigoroso seria
 * `PME × CMV/30 + PMR × receita/30 − PMP × compras/30`, que exige CMV e
 * compras que a plataforma ainda não mede. Entre errar para cima com uma
 * régua só e acertar com três números que ninguém preenche, a escolha é
 * a régua só — declarada na tela.
 *
 * O desembolso diário NÃO sumiu: ele responde a outra pergunta, que é
 * quantos dias de operação o caixa cobre. O que saiu foi o rótulo que o
 * fazia parecer resposta para esta.
 */

export interface EntradaGiro {
  /**
   * Receita do último mês fechado. A régua que converte dias em reais.
   *
   * Mesma fonte da tela de Ciclo (`receita_bruta` de `vw_dre_monthly`),
   * de propósito: as duas telas têm de partir do mesmo número.
   */
  receitaMensal: number;

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

  /** Receita ÷ 30. A régua que converte dias de ciclo em reais. */
  vendaDiaria: number;

  /**
   * (Fixas + variáveis) ÷ 30 — quanto a operação QUEIMA por dia.
   *
   * Serve à cobertura de caixa, não ao valor do ciclo. São perguntas
   * diferentes: uma é "quanto tempo o caixa aguenta", a outra é "quanto
   * um dia de prazo devolve".
   */
  desembolsoDiario: number;

  ncgEstrutural: number;
  ncgRealizada: number | null;

  /** Quanto cada dia de ciclo prende de caixa. Igual à venda diária. */
  valorDeUmDiaDeCiclo: number;

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
  const receita = num(e.receitaMensal);
  const fixas = num(e.despesasFixasMensais);
  const variaveis = num(e.custosVariaveisMensais);

  const pmr = num(e.pmrDias);
  const pmp = num(e.pmpDias);
  const pme = num(e.pmeDias);

  const vazio = (erro: string): ResultadoGiro => ({
    cicloFinanceiroDias: 0,
    vendaDiaria: 0,
    desembolsoDiario: 0,
    ncgEstrutural: 0,
    ncgRealizada: null,
    valorDeUmDiaDeCiclo: 0,
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

  // A receita entrou como obrigatória em 24/09/2026, junto com a régua
  // de venda diária. Sem ela o ciclo continua saindo em dias, mas não há
  // como convertê-lo em reais — e o número em reais é o que faz agir.
  if (receita <= 0) {
    return vazio(
      'Informe a receita do último mês fechado. Ela é a régua que converte dias de ciclo em reais — a mesma usada na tela de Ciclo Financeiro.',
    );
  }

  if ([pmr, pmp, pme].some((d) => d < 0)) {
    return vazio('Prazos não podem ser negativos.');
  }

  // Mês comercial de 30 dias. Usar 30,4 seria mais exato e menos
  // explicável — e num número que serve para decidir, ser conferível na
  // calculadora do celular vale mais que a terceira casa decimal.
  const desembolsoDiario = r2((fixas + variaveis) / 30);
  const vendaDiaria = r2(receita / 30);

  const ciclo = r2(pme + pmr - pmp);
  // Venda diária, e não desembolso: ver a nota do topo do arquivo.
  const ncgEstrutural = r2(ciclo * vendaDiaria);

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

  // NCG negativa significa que a operação NÃO PRECISA de capital de giro
  // — não que ela devolva capital. Descontar um número negativo aqui
  // inflaria a folga: um caixa zerado apareceria com "R$ 50 de folga" ao
  // lado de "cobre 0 dias de operação", e as duas frases se contradiriam
  // na mesma linha.
  const necessidade = Math.max(ncgEstrutural, 0);
  const folga = caixa === null ? null : r2(caixa - necessidade);
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
    vendaDiaria,
    desembolsoDiario,
    ncgEstrutural,
    ncgRealizada,
    // Um dia de ciclo vale uma venda diária. É a mesma conta da NCG com
    // ciclo igual a 1, é o número que transforma "negocie prazo" em
    // "negocie prazo e ganhe isto", e é o MESMO que a tela de Ciclo
    // Financeiro mostra — que era o ponto de toda esta mudança.
    valorDeUmDiaDeCiclo: vendaDiaria,
    folga,
    coberturaDias,
    descolamento,
    alertas,
    erro: null,
  };
}
