/**
 * Fluxo de caixa projetado — 12 semanas.
 *
 * Porta da planilha "Fluxo de Caixa — Projetado, Aula 2.4".
 *
 * =====================================================================
 * SEMANAS, NÃO MESES. E A RAZÃO NÃO É PRECISÃO
 * =====================================================================
 * O mês ESCONDE a quebra. Um mês pode fechar positivo e ter passado
 * quinze dias no vermelho — com o fornecedor esperando, a antecipação
 * de recebível contratada e o cheque especial usado. O saldo do dia 31
 * não conta nada disso.
 *
 * Doze semanas é o horizonte em que ainda dá para agir: antecipar uma
 * cobrança, adiar uma compra, renegociar um vencimento. Quarenta dias de
 * antecedência transformam um problema de caixa numa conversa; quatro
 * dias transformam no gerente do banco.
 *
 * =====================================================================
 * O CERTO E O ESTIMADO VIVEM SEPARADOS
 * =====================================================================
 * Cada semana tem duas origens:
 *
 *   • **Lançado** — títulos com data e dono, e recorrentes. Isso é
 *     compromisso, não previsão.
 *   • **Estimado** — a média das semanas anteriores, usada para
 *     completar o que ainda não foi lançado. Porque uma semana sem
 *     nenhuma venda lançada não significa uma semana sem vendas.
 *
 * Os dois nunca são somados sem serem declarados. Uma projeção que não
 * diz o que é compromisso e o que é palpite ou assusta sem motivo, ou
 * tranquiliza sem base — e as duas falhas custam caro.
 *
 * =====================================================================
 * O QUE ESTA CONTA NÃO SABE
 * =====================================================================
 * A média histórica assume que as próximas semanas se parecem com as
 * anteriores. Sazonalidade, uma campanha nova, um cliente grande que
 * saiu — nada disso entra. Por isso toda célula é editável e a tela
 * insiste que a estimativa é estimativa.
 */

export type OrigemSemana = 'lancado' | 'estimado' | 'ajustado';

export interface SemanaEntrada {
  /** 1 a 12. */
  numero: number;
  /** Primeiro dia da semana, AAAA-MM-DD. */
  inicio: string;
  /** Entradas com data e dono. */
  entradasLancadas: number;
  /** Saídas com data e dono. */
  saidasLancadas: number;
  /** O que o usuário escreveu, sobrepondo tudo. */
  entradasAjustadas?: number | null;
  saidasAjustadas?: number | null;
  /** O que o usuário anotou de fora do padrão nesta semana. */
  observacao?: string | null;
}

export interface EntradaFluxo {
  saldoInicial: number;
  semanas: SemanaEntrada[];
  /** Média semanal de entradas, medida do histórico. */
  entradaSemanalMedia: number;
  /** Média semanal de saídas, medida do histórico. */
  saidaSemanalMedia: number;
  /** Quantas semanas de histórico sustentam as médias acima. */
  semanasDeHistorico: number;
}

export interface SemanaCalculada {
  numero: number;
  inicio: string;
  entradas: number;
  saidas: number;
  entradasOrigem: OrigemSemana;
  saidasOrigem: OrigemSemana;
  /** Quanto veio de título com data, dentro de `entradas`. */
  entradasLancadas: number;
  saidasLancadas: number;
  saldoFinal: number;
  negativa: boolean;
  observacao: string | null;
}

export interface ResultadoFluxo {
  semanas: SemanaCalculada[];

  totalEntradas: number;
  totalSaidas: number;
  saldoFinal: number;

  semanasNegativas: number;
  /** O buraco a cobrir: o pior saldo da janela. */
  menorSaldo: number;
  /** Número da primeira semana negativa. Nulo se não houver. */
  primeiraNegativa: number | null;
  /** Quantas semanas de antecedência existem para resolver. */
  semanasDeAviso: number | null;

  /** Quanto da projeção é compromisso, e não estimativa, em %. */
  parteLancadaPct: number | null;

  alertas: string[];
  erro: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function calcularFluxo(e: EntradaFluxo): ResultadoFluxo {
  const saldoInicial = num(e.saldoInicial);
  const mediaEntrada = num(e.entradaSemanalMedia);
  const mediaSaida = num(e.saidaSemanalMedia);
  const historico = num(e.semanasDeHistorico);

  const vazio = (erro: string): ResultadoFluxo => ({
    semanas: [],
    totalEntradas: 0,
    totalSaidas: 0,
    saldoFinal: 0,
    semanasNegativas: 0,
    menorSaldo: 0,
    primeiraNegativa: null,
    semanasDeAviso: null,
    parteLancadaPct: null,
    alertas: [],
    erro,
  });

  const entradas = e.semanas ?? [];
  if (!entradas.length) {
    return vazio('Nenhuma semana para projetar.');
  }

  const alertas: string[] = [];
  const semanas: SemanaCalculada[] = [];

  let saldo = saldoInicial;
  let somaLancado = 0;
  let somaTudo = 0;

  for (const s of entradas) {
    const lancEnt = num(s.entradasLancadas);
    const lancSai = num(s.saidasLancadas);

    const ajEnt = s.entradasAjustadas === null || s.entradasAjustadas === undefined
      ? null
      : num(s.entradasAjustadas);
    const ajSai = s.saidasAjustadas === null || s.saidasAjustadas === undefined
      ? null
      : num(s.saidasAjustadas);

    /* -------------------- A regra de qual número vale nesta semana */
    // O ajuste do usuário vence tudo. Depois, o lançado: se há título
    // com data, ele é a verdade daquela semana. A média só entra
    // quando NÃO há nada lançado — completar um título existente com
    // média somaria o compromisso com o palpite e inflaria a semana.
    let entradasVal: number;
    let entradasOrigem: OrigemSemana;
    if (ajEnt !== null) {
      entradasVal = ajEnt;
      entradasOrigem = 'ajustado';
    } else if (lancEnt > 0) {
      entradasVal = lancEnt;
      entradasOrigem = 'lancado';
    } else {
      entradasVal = mediaEntrada;
      entradasOrigem = 'estimado';
    }

    let saidasVal: number;
    let saidasOrigem: OrigemSemana;
    if (ajSai !== null) {
      saidasVal = ajSai;
      saidasOrigem = 'ajustado';
    } else if (lancSai > 0) {
      saidasVal = lancSai;
      saidasOrigem = 'lancado';
    } else {
      saidasVal = mediaSaida;
      saidasOrigem = 'estimado';
    }

    saldo = r2(saldo + entradasVal - saidasVal);

    somaLancado += (entradasOrigem === 'lancado' ? entradasVal : 0) +
      (saidasOrigem === 'lancado' ? saidasVal : 0);
    somaTudo += entradasVal + saidasVal;

    semanas.push({
      numero: s.numero,
      inicio: s.inicio,
      entradas: r2(entradasVal),
      saidas: r2(saidasVal),
      entradasOrigem,
      saidasOrigem,
      entradasLancadas: r2(lancEnt),
      saidasLancadas: r2(lancSai),
      saldoFinal: saldo,
      negativa: saldo < 0,
      observacao: s.observacao?.trim() || null,
    });
  }

  const totalEntradas = r2(semanas.reduce((s, x) => s + x.entradas, 0));
  const totalSaidas = r2(semanas.reduce((s, x) => s + x.saidas, 0));
  const saldoFinal = semanas[semanas.length - 1]!.saldoFinal;

  const negativas = semanas.filter((s) => s.negativa);
  const menorSaldo = Math.min(...semanas.map((s) => s.saldoFinal));
  const primeira = negativas[0] ?? null;
  const primeiraNegativa = primeira?.numero ?? null;
  const semanasDeAviso = primeiraNegativa === null ? null : primeiraNegativa - 1;

  const parteLancadaPct = somaTudo > 0 ? r2((somaLancado / somaTudo) * 100) : null;

  /* --------------------------------------------------- As leituras */
  if (negativas.length) {
    alertas.push(
      `${negativas.length === 1 ? 'Uma semana fecha' : `${negativas.length} semanas fecham`} no vermelho, a primeira daqui a ${semanasDeAviso} ${semanasDeAviso === 1 ? 'semana' : 'semanas'}. O buraco a cobrir é ${brl(Math.abs(menorSaldo))} — o pior saldo da janela, não a soma dos negativos.`,
    );

    alertas.push(
      `Com ${semanasDeAviso} ${semanasDeAviso === 1 ? 'semana' : 'semanas'} de antecedência ainda dá para resolver pelo barato, nesta ordem: antecipar cobrança do que já venceu, adiar compra não essencial, renegociar vencimento com fornecedor. Antecipação de recebível e cheque especial são os últimos da fila, não os primeiros.`,
    );
  } else {
    alertas.push(
      `Nenhuma semana negativa na janela. O menor saldo é ${brl(menorSaldo)}, na semana ${semanas.find((s) => s.saldoFinal === menorSaldo)?.numero}. É esse número que vale acompanhar — não o saldo do fim.`,
    );
  }

  // O aviso que separa esta ferramenta de uma bola de cristal.
  if (parteLancadaPct !== null && parteLancadaPct < 40) {
    alertas.push(
      `Só ${parteLancadaPct}% desta projeção vem de título com data: o resto é a média das suas últimas semanas. Quanto mais você lançar contas a pagar e a receber com vencimento, menos a projeção depende de palpite.`,
    );
  }

  if (historico > 0 && historico < 4) {
    alertas.push(
      `As médias saem de apenas ${historico} ${historico === 1 ? 'semana' : 'semanas'} de histórico. É pouco para representar um padrão — trate as semanas estimadas como ordem de grandeza, não como número.`,
    );
  }

  // Saldo que só cai é sinal de estrutura, não de semana ruim.
  const caiSempre =
    semanas.length > 3 && semanas.every((s, i) => i === 0 || s.saldoFinal <= semanas[i - 1]!.saldoFinal);
  if (caiSempre && saldoFinal < saldoInicial) {
    alertas.push(
      `O saldo cai em todas as doze semanas, de ${brl(saldoInicial)} para ${brl(saldoFinal)}. Isso não é um aperto de caixa pontual: a operação está gastando mais do que entra, e nenhuma renegociação de prazo resolve — o problema é a margem ou o custo fixo.`,
    );
  }

  return {
    semanas,
    totalEntradas,
    totalSaidas,
    saldoFinal,
    semanasNegativas: negativas.length,
    menorSaldo: r2(menorSaldo),
    primeiraNegativa,
    semanasDeAviso,
    parteLancadaPct,
    alertas,
    erro: null,
  };
}
