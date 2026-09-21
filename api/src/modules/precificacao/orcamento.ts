/**
 * Orçamento anual: três cenários e teto de despesa.
 *
 * Porta da planilha "Orçamento Anual Simplificado — Aula 4.6".
 *
 * =====================================================================
 * A META NÃO SE ESCOLHE, SE CONSTRÓI
 * =====================================================================
 *     faturamento = atendimentos × conversão × ticket
 *
 * "Quero crescer 20%" não é meta, é desejo — não diz o que fazer na
 * segunda-feira. Construir de baixo para cima obriga a responder por
 * QUAL das três variáveis o crescimento vem, e cada uma tem um plano de
 * ação diferente: atendimento é marketing, conversão é vendas, ticket é
 * mix e precificação.
 *
 * =====================================================================
 * A PERGUNTA QUE O ORÇAMENTO EXISTE PARA RESPONDER
 * =====================================================================
 * **O cenário pessimista dá lucro?**
 *
 * Se dá, o ano está estruturalmente seguro e a discussão passa a ser de
 * crescimento. Se não dá, nenhum plano de vendas resolve sozinho: a
 * estrutura de custo precisa mudar antes, porque o pessimista não é uma
 * hipótese remota — é o mês ruim que acontece todo ano.
 *
 * =====================================================================
 * O CUSTO FIXO É O MESMO NOS TRÊS
 * =====================================================================
 * É literalmente a definição de fixo. Deixar o custo crescer junto com
 * a receita transformaria o otimista num cenário que nunca dá lucro, e
 * o pessimista num que sempre dá — o oposto do que o orçamento serve
 * para mostrar.
 *
 * =====================================================================
 * O TETO SAI DO REALISTA, NÃO DE CADA CENÁRIO
 * =====================================================================
 * Um teto por cenário daria três limites para a mesma conta de luz, e o
 * gestor usaria o maior. O limite tem de ser um só, e é o do cenário em
 * que se acredita.
 */

export type NomeCenario = 'pessimista' | 'realista' | 'otimista';

export interface EntradaCenario {
  atendimentos: number;
  /** Em pontos percentuais: 66 e não 0,66. */
  conversaoPct: number;
  ticket: number;
  /** Margem de contribuição do cenário, em %. */
  margemPct: number;
}

export interface EntradaTeto {
  categoriaId: string;
  nome: string;
  /** O que a empresa gasta hoje, por mês. */
  gastoAtual: number;
  /** Limite escolhido, como % da receita do cenário realista. */
  tetoPct: number | null;
}

export interface EntradaOrcamento {
  pessimista: EntradaCenario;
  realista: EntradaCenario;
  otimista: EntradaCenario;
  /** Custo fixo mais juros do mês. O mesmo nos três cenários. */
  custoFixoMensal: number;
  tetos?: EntradaTeto[];
}

export interface CenarioCalculado {
  nome: NomeCenario;
  faturamentoMensal: number;
  faturamentoAnual: number;
  margemContribuicao: number;
  lucroMensal: number;
  lucroAnual: number;
  /** Faturamento que zera o resultado, com a margem deste cenário. */
  pontoEquilibrio: number | null;
  daLucro: boolean;
}

export interface TetoCalculado {
  categoriaId: string;
  nome: string;
  gastoAtual: number;
  tetoPct: number | null;
  tetoValor: number | null;
  /** Teto menos o gasto de hoje. Negativo = já estourou. */
  folga: number | null;
}

export interface ResultadoOrcamento {
  cenarios: CenarioCalculado[];
  /** Atalho para a pergunta central. */
  pessimistaDaLucro: boolean | null;

  tetos: TetoCalculado[];
  totalGastoAtual: number;
  totalTeto: number | null;
  totalFolga: number | null;

  alertas: string[];
  erro: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const ORDEM: NomeCenario[] = ['pessimista', 'realista', 'otimista'];

function calcularCenario(
  nome: NomeCenario,
  e: EntradaCenario,
  custoFixo: number,
): CenarioCalculado {
  const atendimentos = num(e.atendimentos);
  const conversao = num(e.conversaoPct) / 100;
  const ticket = num(e.ticket);
  const margem = num(e.margemPct) / 100;

  const faturamentoMensal = r2(atendimentos * conversao * ticket);
  const margemContribuicao = r2(faturamentoMensal * margem);
  const lucroMensal = r2(margemContribuicao - custoFixo);

  return {
    nome,
    faturamentoMensal,
    faturamentoAnual: r2(faturamentoMensal * 12),
    margemContribuicao,
    lucroMensal,
    lucroAnual: r2(lucroMensal * 12),
    // Quanto precisaria faturar, com ESTA margem, para empatar.
    pontoEquilibrio: margem > 0 ? r2(custoFixo / margem) : null,
    daLucro: lucroMensal > 0,
  };
}

export function calcularOrcamento(e: EntradaOrcamento): ResultadoOrcamento {
  const custoFixo = num(e.custoFixoMensal);

  const vazio = (erro: string): ResultadoOrcamento => ({
    cenarios: [],
    pessimistaDaLucro: null,
    tetos: [],
    totalGastoAtual: 0,
    totalTeto: null,
    totalFolga: null,
    alertas: [],
    erro,
  });

  if (custoFixo < 0) return vazio('O custo fixo não pode ser negativo.');

  const entradas: Record<NomeCenario, EntradaCenario> = {
    pessimista: e.pessimista,
    realista: e.realista,
    otimista: e.otimista,
  };

  for (const nome of ORDEM) {
    const c = entradas[nome];
    const conv = num(c.conversaoPct);
    const margem = num(c.margemPct);
    if (conv < 0 || conv > 100) {
      return vazio(`A taxa de conversão do cenário ${nome} precisa ficar entre 0 e 100%.`);
    }
    if (margem < 0 || margem > 100) {
      return vazio(`A margem de contribuição do cenário ${nome} precisa ficar entre 0 e 100%.`);
    }
    if (num(c.atendimentos) < 0 || num(c.ticket) < 0) {
      return vazio(`Atendimentos e ticket do cenário ${nome} não podem ser negativos.`);
    }
  }

  const cenarios = ORDEM.map((nome) => calcularCenario(nome, entradas[nome], custoFixo));
  const [pess, real, otim] = cenarios as [CenarioCalculado, CenarioCalculado, CenarioCalculado];

  const alertas: string[] = [];

  // Nenhum cenário preenchido: a tela precisa dizer isso em vez de
  // exibir três colunas de zero, que parecem resultado.
  const algumPreenchido = cenarios.some((c) => c.faturamentoMensal > 0);
  if (!algumPreenchido) {
    return vazio(
      'Preencha atendimentos, conversão e ticket de pelo menos um cenário. A meta se constrói a partir dessas três variáveis — qualquer crescimento vem de uma delas.',
    );
  }

  /* ------------------------------------------- A pergunta central */
  if (pess.faturamentoMensal > 0) {
    if (pess.daLucro) {
      alertas.push(
        `O cenário pessimista dá lucro: ${brl(pess.lucroMensal)} por mês, ${brl(pess.lucroAnual)} no ano. O ano está estruturalmente seguro, e a conversa passa a ser de crescimento em vez de sobrevivência.`,
      );
    } else {
      const falta = pess.pontoEquilibrio !== null ? pess.pontoEquilibrio - pess.faturamentoMensal : null;
      alertas.push(
        `O cenário pessimista NÃO dá lucro: faltam ${brl(Math.abs(pess.lucroMensal))} por mês para empatar${
          falta !== null ? `, o que exigiria faturar ${brl(pess.pontoEquilibrio!)} em vez de ${brl(pess.faturamentoMensal)}` : ''
        }. Nenhum plano de vendas resolve isso sozinho — o pessimista não é hipótese remota, é o mês ruim que acontece todo ano.`,
      );
    }
  }

  /* ------------------------- Coerência entre os cenários */
  if (pess.faturamentoMensal > 0 && otim.faturamentoMensal > 0) {
    if (pess.faturamentoMensal > otim.faturamentoMensal) {
      alertas.push(
        'O cenário pessimista está faturando mais que o otimista. Os dois estão trocados, ou uma das três variáveis foi digitada na coluna errada.',
      );
    } else if (real.faturamentoMensal > 0) {
      const amplitude = (otim.faturamentoMensal - pess.faturamentoMensal) / real.faturamentoMensal;
      if (amplitude < 0.1) {
        alertas.push(
          `A distância entre o pior e o melhor cenário é de apenas ${r2(amplitude * 100)}% do realista. Cenários muito próximos não testam nada — vale afastá-los até doer.`,
        );
      }
    }
  }

  /* ------------------------------ O que muda de um cenário ao outro */
  if (pess.faturamentoMensal > 0 && otim.faturamentoMensal > 0) {
    const p = entradas.pessimista;
    const o = entradas.otimista;
    const variacao = (a: number, b: number) => (num(a) > 0 ? (num(b) - num(a)) / num(a) : 0);

    const alavancas: [string, number][] = [
      ['atendimentos', variacao(p.atendimentos, o.atendimentos)],
      ['conversão', variacao(p.conversaoPct, o.conversaoPct)],
      ['ticket', variacao(p.ticket, o.ticket)],
    ];
    alavancas.sort((a, b) => b[1] - a[1]);
    const maior = alavancas[0]!;

    if (maior[1] > 0) {
      alertas.push(
        `O seu otimismo está concentrado em ${maior[0]}: é a variável que mais cresce entre o pior e o melhor cenário (${r2(maior[1] * 100)}%). É por ela que o plano de ação do ano precisa começar.`,
      );
    }
  }

  /* --------------------------------------- O teto de despesa */
  // Sobre a receita do REALISTA. Um teto por cenário daria três limites
  // para a mesma conta de luz, e o gestor usaria o maior.
  const baseTeto = real.faturamentoMensal;

  const tetos: TetoCalculado[] = (e.tetos ?? []).map((t) => {
    const gasto = num(t.gastoAtual);
    const pct = t.tetoPct === null || t.tetoPct === undefined ? null : num(t.tetoPct);
    const valor = pct === null || baseTeto <= 0 ? null : r2(baseTeto * (pct / 100));
    return {
      categoriaId: t.categoriaId,
      nome: t.nome,
      gastoAtual: r2(gasto),
      tetoPct: pct,
      tetoValor: valor,
      folga: valor === null ? null : r2(valor - gasto),
    };
  });

  const totalGastoAtual = r2(tetos.reduce((s, t) => s + t.gastoAtual, 0));
  const comTeto = tetos.filter((t) => t.tetoValor !== null);
  const totalTeto = comTeto.length ? r2(comTeto.reduce((s, t) => s + t.tetoValor!, 0)) : null;
  const totalFolga = totalTeto === null ? null : r2(totalTeto - r2(comTeto.reduce((s, t) => s + t.gastoAtual, 0)));

  const estourados = tetos.filter((t) => t.folga !== null && t.folga < 0);
  if (estourados.length) {
    const nomes = estourados.map((t) => t.nome).join(', ');
    const soma = r2(estourados.reduce((s, t) => s + Math.abs(t.folga!), 0));
    alertas.push(
      `${estourados.length === 1 ? 'Um grupo já passou' : `${estourados.length} grupos já passaram`} do teto definido: ${nomes}. São ${brl(soma)} por mês acima do limite — ${brl(r2(soma * 12))} no ano.`,
    );
  }

  return {
    cenarios,
    pessimistaDaLucro: pess.faturamentoMensal > 0 ? pess.daLucro : null,
    tetos,
    totalGastoAtual,
    totalTeto,
    totalFolga,
    alertas,
    erro: null,
  };
}
