/**
 * Pró-labore: os três métodos lado a lado.
 *
 * Porta da planilha "Calculadora de Pró-labore — Aula 1.4".
 *
 * =====================================================================
 * TRÊS PERGUNTAS DIFERENTES, NÃO TRÊS TENTATIVAS DA MESMA
 * =====================================================================
 * • **Custo de reposição** — quanto custaria contratar alguém para fazer
 *   o que o dono faz. Diz se ele está se pagando menos que um
 *   funcionário.
 * • **Piso da vida** — o custo real da família, sem supérfluo. Abaixo
 *   disso, o dono tira do PJ pelo cartão ou pelo cheque especial.
 * • **Teto da empresa** — um percentual do resultado médio de três
 *   meses. Acima disso, a retirada sai do capital de giro.
 *
 * A decisão é o MENOR dos três, e quem quase sempre manda é o teto: a
 * empresa não paga o que não tem. Um pró-labore "justo" que ela não
 * gera vira dívida, não salário.
 *
 * =====================================================================
 * O PISO ACIMA DO TETO É O DIAGNÓSTICO, NÃO UM ERRO DE CONTA
 * =====================================================================
 * Quando o piso da vida supera o teto da empresa, a planilha não
 * conserta nada — ela mostra a distância. E a leitura é dura e
 * necessária: o problema não é a retirada do dono, é a margem do
 * negócio. Daí o último bloco, que converte essa distância em quanto a
 * empresa precisa VENDER a mais por mês.
 *
 * =====================================================================
 * ARREDONDAR PARA BAIXO
 * =====================================================================
 * O valor definido desce para o múltiplo de R$ 100 inferior. Não é
 * estética: R$ 5.880 é um número de planilha, R$ 5.800 é um número que
 * alguém consegue repetir todo mês sem conferir a conta.
 */

export interface EntradaProLabore {
  /** Método 1 — salário de mercado do cargo. Zero ou nulo: não conta. */
  salarioMercado?: number | null;

  /** Método 2 — os cinco custos da família. */
  moradia?: number | null;
  alimentacao?: number | null;
  transporte?: number | null;
  saudeEducacao?: number | null;
  outrosEssenciais?: number | null;

  /**
   * Método 3 — resultado dos meses fechados, ANTES da retirada do dono.
   * Um por mês, do mais recente para trás. A aula pede três e proíbe
   * usar só o melhor.
   */
  resultados: number[];

  /** Percentual do resultado que pode ir para o pró-labore. Padrão 60. */
  percentualResultado?: number | null;

  /** Tudo que sai hoje para o dono — pró-labore mais retiradas. */
  retiradaAtual?: number | null;

  /** Margem de contribuição da empresa, em %. Sem ela, a última conta não sai. */
  margemContribuicaoPct?: number | null;
}

export interface ResultadoProLabore {
  /** Nulo quando o método não foi informado — e nulo não é zero. */
  metodo1: number | null;
  metodo2: number | null;
  metodo3: number | null;

  resultadoMedio: number;
  mesesConsiderados: number;

  /** O menor dos métodos informados. */
  menorDosMetodos: number | null;
  /** O menor, arredondado para baixo em múltiplo de R$ 100. */
  proLaboreDefinido: number | null;
  /** Qual método mandou: 'reposicao' | 'piso' | 'teto'. */
  metodoQueManda: 'reposicao' | 'piso' | 'teto' | null;

  /** Retirada atual menos o definido. Positivo = sai mais do que cabe. */
  excedenteMensal: number | null;
  excedenteAnual: number | null;

  /** Piso da vida menos o definido. Positivo = o pró-labore não paga a vida. */
  faltaParaOPiso: number | null;

  /** Piso ÷ percentual. O resultado que a empresa teria de gerar. */
  resultadoNecessario: number | null;
  resultadoAdicional: number | null;
  vendaAdicionalNecessaria: number | null;

  alertas: string[];
  erro: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Múltiplo de R$ 100 inferior. Nunca abaixo de zero. */
const paraBaixoEmCem = (n: number) => Math.max(0, Math.floor(n / 100) * 100);

export function calcularProLabore(e: EntradaProLabore): ResultadoProLabore {
  const vazio = (erro: string): ResultadoProLabore => ({
    metodo1: null,
    metodo2: null,
    metodo3: null,
    resultadoMedio: 0,
    mesesConsiderados: 0,
    menorDosMetodos: null,
    proLaboreDefinido: null,
    metodoQueManda: null,
    excedenteMensal: null,
    excedenteAnual: null,
    faltaParaOPiso: null,
    resultadoNecessario: null,
    resultadoAdicional: null,
    vendaAdicionalNecessaria: null,
    alertas: [],
    erro,
  });

  const alertas: string[] = [];

  /* ------------------------------------------- Método 1: reposição */
  const salario = num(e.salarioMercado);
  const metodo1 = salario > 0 ? r2(salario) : null;

  /* ------------------------------------------ Método 2: piso da vida */
  const itensVida = [
    e.moradia,
    e.alimentacao,
    e.transporte,
    e.saudeEducacao,
    e.outrosEssenciais,
  ].map(num);
  const somaVida = itensVida.reduce((s, v) => s + v, 0);
  const metodo2 = somaVida > 0 ? r2(somaVida) : null;

  /* ------------------------------------- Método 3: teto da empresa */
  const meses = (e.resultados ?? []).map(num);

  // A média inclui mês negativo de propósito. Descartar o mês ruim é
  // exatamente o que a aula proíbe — "nunca só o melhor mês" — e é o que
  // produz um teto que a empresa não sustenta.
  const resultadoMedio = meses.length
    ? r2(meses.reduce((s, v) => s + v, 0) / meses.length)
    : 0;

  const pct = e.percentualResultado === null || e.percentualResultado === undefined
    ? 60
    : num(e.percentualResultado);

  if (pct <= 0 || pct > 100) {
    return vazio('O percentual do resultado precisa ficar entre 1 e 100.');
  }

  const tetoBruto = resultadoMedio * (pct / 100);
  const metodo3 = meses.length ? r2(tetoBruto) : null;

  if (metodo3 !== null && metodo3 <= 0) {
    alertas.push(
      `Nos ${meses.length === 1 ? 'último mês fechado' : `últimos ${meses.length} meses fechados`} a empresa gerou um resultado médio de ${brl(resultadoMedio)} antes da sua retirada. Enquanto isso não mudar, QUALQUER valor retirado sai do capital de giro — não do lucro.`,
    );
  }

  /* ------------------------------------------------- A decisão */
  const candidatos: [number, ResultadoProLabore['metodoQueManda']][] = [];
  if (metodo1 !== null) candidatos.push([metodo1, 'reposicao']);
  if (metodo2 !== null) candidatos.push([metodo2, 'piso']);
  // Teto zero ou negativo não entra como candidato de MÍNIMO: ele já foi
  // denunciado no alerta acima, e deixá-lo vencer devolveria "pró-labore
  // definido: R$ 0", que parece resposta de formulário quebrado em vez
  // do diagnóstico que é.
  if (metodo3 !== null && metodo3 > 0) candidatos.push([metodo3, 'teto']);

  if (!candidatos.length) {
    return vazio(
      'Informe ao menos um dos três métodos: o salário de mercado do seu cargo, os custos da sua família ou os resultados dos meses fechados.',
    );
  }

  let menorDosMetodos = candidatos[0]![0];
  let metodoQueManda = candidatos[0]![1];
  for (const [valor, qual] of candidatos) {
    if (valor < menorDosMetodos) {
      menorDosMetodos = valor;
      metodoQueManda = qual;
    }
  }

  const proLaboreDefinido = paraBaixoEmCem(menorDosMetodos);

  if (metodoQueManda === 'teto') {
    alertas.push(
      `Quem manda aqui é o teto da empresa: ${brl(metodo3!)}. Os outros métodos pedem mais, mas a empresa não paga o que não gera.`,
    );
  }

  /* ------------------------------------- O que o número revela */
  const retirada = e.retiradaAtual === null || e.retiradaAtual === undefined
    ? null
    : num(e.retiradaAtual);

  const excedenteMensal = retirada === null ? null : r2(retirada - proLaboreDefinido);
  const excedenteAnual = excedenteMensal === null ? null : r2(excedenteMensal * 12);

  if (excedenteMensal !== null && excedenteMensal > 0) {
    alertas.push(
      `Saem ${brl(excedenteMensal)} a mais por mês do que a empresa comporta — ${brl(excedenteAnual!)} em doze meses. É esse o valor que saiu do capital de giro no último ano.`,
    );
  }

  const faltaParaOPiso = metodo2 === null ? null : r2(metodo2 - proLaboreDefinido);

  /* ---------------- Quanto a empresa precisa crescer para pagar o piso */
  let resultadoNecessario: number | null = null;
  let resultadoAdicional: number | null = null;
  let vendaAdicionalNecessaria: number | null = null;

  if (metodo2 !== null && faltaParaOPiso !== null && faltaParaOPiso > 0) {
    alertas.push(
      `O pró-labore possível fica ${brl(faltaParaOPiso)} abaixo do custo da sua família. Quando isso acontece, o problema não é a sua retirada — é a margem do negócio.`,
    );

    resultadoNecessario = r2(metodo2 / (pct / 100));
    resultadoAdicional = r2(resultadoNecessario - resultadoMedio);

    const mc = num(e.margemContribuicaoPct);
    if (mc > 0 && resultadoAdicional > 0) {
      // Cada real de venda adicional entrega apenas a margem de
      // contribuição. Dividir pelo percentual — e não multiplicar — é a
      // mesma armadilha do markup na precificação.
      vendaAdicionalNecessaria = r2(resultadoAdicional / (mc / 100));
      alertas.push(
        `Para a empresa pagar o seu piso, ela precisa gerar ${brl(resultadoAdicional)} a mais de resultado por mês — o que, com a sua margem de ${mc}%, significa ${brl(vendaAdicionalNecessaria)} de venda adicional todo mês.`,
      );
    }
  }

  return {
    metodo1,
    metodo2,
    metodo3,
    resultadoMedio,
    mesesConsiderados: meses.length,
    menorDosMetodos: r2(menorDosMetodos),
    proLaboreDefinido,
    metodoQueManda,
    excedenteMensal,
    excedenteAnual,
    faltaParaOPiso,
    resultadoNecessario,
    resultadoAdicional,
    vendaAdicionalNecessaria,
    alertas,
    erro: null,
  };
}
