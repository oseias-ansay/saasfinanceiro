/**
 * O movimento do dia vira lançamentos.
 *
 * =====================================================================
 * A VENDA É UMA COISA; O RECEBIMENTO É OUTRA
 * =====================================================================
 * Esta é a regra inteira do arquivo. O cliente vendeu R$ 10.000 hoje:
 * R$ 3.000 em dinheiro, R$ 5.000 no crédito e R$ 2.000 a prazo.
 *
 * A competência dos três é hoje — foi hoje que ele vendeu, e é isso que
 * a DRE do mês tem que mostrar. Mas só os R$ 3.000 são caixa hoje. Os
 * outros R$ 7.000 entram depois, e até lá são contas a receber.
 *
 * Tratar tudo como recebido no dia infla a cobertura de caixa e encurta
 * o prazo médio de recebimento — os dois indicadores que sustentam o
 * diagnóstico. Um formulário que facilita o lançamento e corrompe o
 * indicador troca adoção por confiança.
 *
 * =====================================================================
 * O QUE ESTE MÓDULO NÃO FAZ
 * =====================================================================
 * Não grava. Recebe o formulário e devolve a lista de lançamentos que
 * deveriam existir. Quem grava é a rota, e ela apaga os do mesmo dia
 * antes — é assim que reenviar um dia corrige em vez de duplicar.
 *
 * Separado porque a regra acima é o que precisa de teste, e testar regra
 * através de banco é lento e frágil.
 */

export interface FormaRecebimento {
  id: string;
  nome: string;
  /** Dias até o dinheiro entrar. Zero = à vista. */
  prazo_dias: number;
}

export interface VendaDoDia {
  forma_id: string;
  valor: number;
}

export interface DespesaDoDia {
  descricao: string;
  valor: number;
  category_id?: string | null;
  entity_id?: string | null;
  /** Falso quando a despesa foi apenas registrada, não paga. */
  paga: boolean;
}

export interface MovimentoDoDia {
  /** ISO `aaaa-mm-dd`. */
  data: string;
  vendas: VendaDoDia[];
  despesas: DespesaDoDia[];
  observacao?: string | null;
}

export interface LancamentoGerado {
  type: 'receita' | 'despesa';
  description: string;
  amount: number;
  /** O dia da venda ou da despesa. Nunca muda com o prazo. */
  competence_date: string;
  /** O dia em que o dinheiro entra ou sai. */
  due_date: string;
  status: 'pendente' | 'liquidado';
  paid_date: string | null;
  paid_amount: number | null;
  category_id: string | null;
  entity_id: string | null;
}

export class MovimentoInvalido extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MovimentoInvalido';
  }
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function somarDias(iso: string, dias: number): string {
  const [a, m, d] = iso.split('-').map(Number);
  const base = Date.UTC(a!, (m ?? 1) - 1, d ?? 1) + dias * 86_400_000;
  const r = new Date(base);
  return `${r.getUTCFullYear()}-${String(r.getUTCMonth() + 1).padStart(2, '0')}-${String(
    r.getUTCDate(),
  ).padStart(2, '0')}`;
}

/** Arredonda para centavos. O banco tem numeric(14,2). */
const centavos = (v: number) => Math.round(v * 100) / 100;

/**
 * Valida o formulário antes de gerar qualquer coisa.
 *
 * Erro em texto, não em código: quem lê é o dono do negócio fechando o
 * caixa às nove da noite, e "valor inválido no índice 2" não ajuda
 * ninguém.
 */
export function validarMovimento(m: MovimentoDoDia, hoje: string): void {
  if (!ISO.test(m.data ?? '')) {
    throw new MovimentoInvalido('Informe a data do movimento.');
  }

  if (m.data > hoje) {
    throw new MovimentoInvalido(
      'A data do movimento é no futuro. Lançar venda que ainda não aconteceu ' +
        'faz o faturamento do mês ficar maior do que foi.',
    );
  }

  for (const v of m.vendas ?? []) {
    if (!Number.isFinite(v.valor) || v.valor < 0) {
      throw new MovimentoInvalido('Há um valor de venda inválido ou negativo.');
    }
  }

  for (const d of m.despesas ?? []) {
    if (!d.descricao?.trim()) {
      throw new MovimentoInvalido('Toda despesa precisa de uma descrição.');
    }
    if (!Number.isFinite(d.valor) || d.valor <= 0) {
      throw new MovimentoInvalido(`A despesa "${d.descricao}" está sem valor.`);
    }
  }

  const temVenda = (m.vendas ?? []).some((v) => v.valor > 0);
  const temDespesa = (m.despesas ?? []).length > 0;

  if (!temVenda && !temDespesa) {
    throw new MovimentoInvalido(
      'O movimento está vazio. Para registrar um dia sem venda, lance zero ' +
        'em alguma forma de recebimento — dia zerado é informação, dia em ' +
        'branco é ausência.',
    );
  }
}

/**
 * Os lançamentos do dia.
 *
 * Uma receita por forma de recebimento com valor, e uma despesa por
 * linha. Formas com zero não geram lançamento: zero não é um fato
 * financeiro, e encheria o extrato de linhas vazias.
 */
export function gerarLancamentos(
  m: MovimentoDoDia,
  formas: FormaRecebimento[],
  hoje: string,
): LancamentoGerado[] {
  validarMovimento(m, hoje);

  const porId = new Map(formas.map((f) => [f.id, f]));
  const saida: LancamentoGerado[] = [];

  for (const v of m.vendas ?? []) {
    const valor = centavos(v.valor);
    if (valor <= 0) continue;

    const forma = porId.get(v.forma_id);
    if (!forma) {
      throw new MovimentoInvalido('Há uma forma de recebimento que não existe nesta empresa.');
    }

    const vencimento = somarDias(m.data, forma.prazo_dias);

    // À vista entra como liquidado no próprio dia. Com prazo, vira conta
    // a receber — e é isso que mantém o PMR e a cobertura de caixa
    // verdadeiros.
    const avista = forma.prazo_dias === 0;

    saida.push({
      type: 'receita',
      description: `Vendas do dia — ${forma.nome}`,
      amount: valor,
      competence_date: m.data,
      due_date: vencimento,
      status: avista ? 'liquidado' : 'pendente',
      paid_date: avista ? m.data : null,
      paid_amount: avista ? valor : null,
      category_id: null,
      entity_id: null,
    });
  }

  for (const d of m.despesas ?? []) {
    const valor = centavos(d.valor);

    saida.push({
      type: 'despesa',
      description: d.descricao.trim(),
      amount: valor,
      competence_date: m.data,
      due_date: m.data,
      status: d.paga ? 'liquidado' : 'pendente',
      paid_date: d.paga ? m.data : null,
      paid_amount: d.paga ? valor : null,
      category_id: d.category_id ?? null,
      entity_id: d.entity_id ?? null,
    });
  }

  return saida;
}

export interface ResumoMovimento {
  vendido: number;
  /** O que entra em caixa no próprio dia. */
  recebido_hoje: number;
  /** O que fica a receber, e em quantos dias o último cai. */
  a_receber: number;
  prazo_maximo: number;
  despesas: number;
  despesas_pagas: number;
  /** Caixa do dia: o que entrou menos o que saiu pago. */
  caixa_do_dia: number;
}

/**
 * Os números que a tela mostra enquanto a pessoa preenche.
 *
 * `vendido` e `recebido_hoje` aparecem separados de propósito. É a
 * primeira vez que muita gente vê que vendeu dez e recebeu três — e essa
 * distinção é metade do que a consultoria tenta ensinar.
 */
export function resumir(
  m: MovimentoDoDia,
  formas: FormaRecebimento[],
): ResumoMovimento {
  const porId = new Map(formas.map((f) => [f.id, f]));

  let vendido = 0;
  let recebidoHoje = 0;
  let aReceber = 0;
  let prazoMaximo = 0;

  for (const v of m.vendas ?? []) {
    const valor = Number.isFinite(v.valor) ? centavos(v.valor) : 0;
    if (valor <= 0) continue;

    vendido += valor;
    const prazo = porId.get(v.forma_id)?.prazo_dias ?? 0;

    if (prazo === 0) recebidoHoje += valor;
    else {
      aReceber += valor;
      if (prazo > prazoMaximo) prazoMaximo = prazo;
    }
  }

  let despesas = 0;
  let pagas = 0;

  for (const d of m.despesas ?? []) {
    const valor = Number.isFinite(d.valor) ? centavos(d.valor) : 0;
    if (valor <= 0) continue;

    despesas += valor;
    if (d.paga) pagas += valor;
  }

  return {
    vendido: centavos(vendido),
    recebido_hoje: centavos(recebidoHoje),
    a_receber: centavos(aReceber),
    prazo_maximo: prazoMaximo,
    despesas: centavos(despesas),
    despesas_pagas: centavos(pagas),
    caixa_do_dia: centavos(recebidoHoje - pagas),
  };
}
