/**
 * Importação de extrato bancário — o núcleo.
 *
 * =====================================================================
 * O QUE UMA LINHA DE EXTRATO É, NESTE SISTEMA
 * =====================================================================
 * Não é um lançamento novo. É a PROVA de que um lançamento foi pago.
 *
 * A plataforma separa obrigação de caixa desde o começo: `due_date` é
 * quando vence, `paid_date` é quando o dinheiro andou. O extrato fala
 * exclusivamente do segundo. Então o trabalho da importação é CONCILIAR
 * — achar a `transaction` pendente que aquela linha liquidou — e só
 * oferecer a criação de lançamento quando não existir par.
 *
 * Importar criando lançamento para cada linha seria mais simples e
 * destruiria o que a tela de contas a pagar sabe: a obrigação que já
 * estava cadastrada viraria uma segunda despesa, e o mês fecharia com o
 * dobro.
 *
 * =====================================================================
 * O PORTÃO DE SALDO É O QUE SUBSTITUI O DÍGITO VERIFICADOR
 * =====================================================================
 * No boleto, a linha digitável tem DV: leitura errada é detectável.
 * Extrato não tem nada parecido — e em PDF, lido por modelo de visão,
 * um valor trocado de 1.247,80 para 124,78 passaria sem sintoma.
 *
 * Mas extrato tem uma verificação própria, e ela é aritmética:
 *
 *     saldo anterior + soma dos movimentos = saldo final
 *
 * Os dois saldos vêm declarados (impressos no PDF, no `LEDGERBAL` do
 * OFX). Se a soma não fecha, a leitura está errada — não importa qual
 * linha. É o mesmo princípio do balancete: o teste não diz onde está o
 * erro, diz que existe.
 *
 * `conferirFechamento` é esse portão, e ele vale para os três formatos.
 * Para PDF ele é OBRIGATÓRIO; para OFX, quando o arquivo traz o saldo.
 */

/** Uma linha do extrato, já normalizada, vinda de qualquer formato. */
export interface LinhaExtrato {
  /** ISO, só a data. Hora não interessa: conciliação é por dia. */
  data: string;
  /** Positivo entrou, negativo saiu. Em reais. */
  valor: number;
  /** O histórico do banco, como veio. É o que a pessoa reconhece. */
  historico: string;
  /**
   * Identificador do próprio banco, quando existe (FITID do OFX).
   * Nulo em CSV e PDF — aí a identidade é calculada.
   */
  fitid: string | null;
}

export type FormatoExtrato = 'ofx' | 'csv' | 'pdf';

export interface ExtratoLido {
  formato: FormatoExtrato;
  /** Agência e conta, quando o arquivo declara. */
  banco: string | null;
  conta: string | null;
  /** Saldo declarado no arquivo, quando existe. */
  saldo_anterior: number | null;
  saldo_final: number | null;
  linhas: LinhaExtrato[];
  avisos: string[];
}

export class ExtratoInvalido extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtratoInvalido';
  }
}

/* ==================================================================== */
/* Números                                                               */
/* ==================================================================== */

/**
 * Converte o valor que o banco escreveu, com qualquer convenção.
 *
 * Esta função existe por causa de um erro que já me custou caro no
 * `indicadores.ts`: eu tirei os pontos tratando-os como separador de
 * milhar, e `-0.32` virou `-32`. A regra certa é olhar o ÚLTIMO
 * separador — ele é o decimal — e não assumir convenção.
 *
 * Num extrato o estrago seria pior que num indicador: `1.234` virando
 * 1234 ou 1,234 muda o saldo, e o saldo é o número que o empresário
 * confere primeiro.
 */
export function valorBancario(bruto: unknown): number | null {
  if (typeof bruto === 'number') return Number.isFinite(bruto) ? bruto : null;
  if (typeof bruto !== 'string') return null;

  let t = bruto.trim();
  if (t === '') return null;

  // Sinal pode vir antes, depois, ou entre parênteses (contábil).
  let negativo = false;
  if (/^\(.*\)$/.test(t)) {
    negativo = true;
    t = t.slice(1, -1);
  }
  if (/[-−]\s*$/.test(t)) {
    negativo = true;
    t = t.replace(/[-−]\s*$/, '');
  }
  if (/^[-−]/.test(t)) {
    negativo = true;
    t = t.replace(/^[-−]\s*/, '');
  }
  if (/^\+/.test(t)) t = t.slice(1);

  // Tira moeda, espaço comum e o espaço insecável que PDF adora.
  t = t.replace(/R\$|\s| /g, '');
  if (t === '') return null;
  if (!/^[\d.,]+$/.test(t)) return null;

  const ultimoPonto = t.lastIndexOf('.');
  const ultimaVirgula = t.lastIndexOf(',');
  const corte = Math.max(ultimoPonto, ultimaVirgula);

  let normalizado: string;

  if (corte === -1) {
    normalizado = t;
  } else {
    const inteiro = t.slice(0, corte).replace(/[.,]/g, '');
    const decimal = t.slice(corte + 1);

    /**
     * Separador com três dígitos depois e nenhum outro separador é
     * MILHAR, não decimal: `1.234` é mil duzentos e trinta e quatro.
     *
     * Um extrato com `1.234` significando um real e 234 milésimos não
     * existe — conta bancária tem dois decimais.
     */
    if (decimal.length === 3 && !/[.,]/.test(t.slice(0, corte))) {
      normalizado = inteiro + decimal;
    } else if (!/^\d+$/.test(decimal)) {
      return null;
    } else {
      normalizado = `${inteiro}.${decimal}`;
    }
  }

  const n = Number(normalizado);
  if (!Number.isFinite(n)) return null;

  return negativo ? -n : n;
}

/** Arredonda para centavo. Soma de float acumula sujeira. */
export const centavos = (v: number) => Math.round(v * 100) / 100;

/* ==================================================================== */
/* Datas                                                                 */
/* ==================================================================== */

/**
 * Normaliza a data do extrato para ISO.
 *
 * Aceita o que os três formatos entregam: `20261015` e
 * `20261015120000[-3:BRT]` do OFX, `15/10/2026` do CSV e do PDF, e
 * `15/10` sem ano — que aparece em PDF de extrato mensal.
 *
 * O ano ausente usa `anoDeReferencia`, e isso é deliberado em vez de
 * assumir o ano atual: extrato de dezembro importado em janeiro cairia
 * no ano errado, e o lançamento apareceria doze meses fora de lugar.
 */
export function dataExtrato(bruto: string, anoDeReferencia?: number): string | null {
  const t = String(bruto ?? '').trim();
  if (t === '') return null;

  const compacta = t.match(/^(\d{4})(\d{2})(\d{2})/);
  if (compacta) {
    return validarISO(`${compacta[1]}-${compacta[2]}-${compacta[3]}`);
  }

  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return validarISO(`${iso[1]}-${iso[2]}-${iso[3]}`);

  const br = t.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?/);
  if (br) {
    const dia = br[1]!.padStart(2, '0');
    const mes = br[2]!.padStart(2, '0');
    let ano = br[3];

    if (!ano) {
      if (!anoDeReferencia) return null;
      ano = String(anoDeReferencia);
    } else if (ano.length === 2) {
      ano = `20${ano}`;
    }

    return validarISO(`${ano}-${mes}-${dia}`);
  }

  return null;
}

/** Recusa 31/02 e afins: data que não existe não vira lançamento. */
function validarISO(iso: string): string | null {
  const [a, m, d] = iso.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(a, m - 1, d));
  if (
    dt.getUTCFullYear() !== a ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return iso;
}

/* ==================================================================== */
/* Identidade da linha                                                   */
/* ==================================================================== */

/**
 * A chave que impede importar o mesmo extrato duas vezes.
 *
 * Reimportar é o caso NORMAL, não o excepcional: o cliente baixa o
 * extrato do mês dia 10, importa, baixa de novo dia 20 e importa outra
 * vez. As dez primeiras linhas são as mesmas. Sem identidade estável,
 * ele dobra o mês.
 *
 * Com FITID a identidade é do banco e é confiável. Sem ele, é hash do
 * que identifica a linha — e a posição entra no hash de propósito: duas
 * tarifas de R$ 2,90 no mesmo dia, com o mesmo histórico, são DOIS
 * fatos, não um repetido. Sem a posição, a segunda seria descartada como
 * duplicata e o saldo não fecharia.
 */
export function identidadeLinha(
  linha: LinhaExtrato,
  conta: string | null,
  posicaoNoDia: number,
): string {
  if (linha.fitid && linha.fitid.trim() !== '') {
    return `fitid:${conta ?? '-'}:${linha.fitid.trim()}`;
  }

  const historico = linha.historico
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);

  return [
    'hash',
    conta ?? '-',
    linha.data,
    centavos(linha.valor).toFixed(2),
    historico,
    posicaoNoDia,
  ].join(':');
}

/** Numera as linhas dentro do dia, para a identidade sem FITID. */
export function comIdentidade(
  linhas: LinhaExtrato[],
  conta: string | null,
): Array<LinhaExtrato & { identidade: string }> {
  const vistasNoDia = new Map<string, number>();

  return linhas.map((l) => {
    const chaveDia = `${l.data}|${centavos(l.valor)}|${l.historico}`;
    const posicao = vistasNoDia.get(chaveDia) ?? 0;
    vistasNoDia.set(chaveDia, posicao + 1);

    return { ...l, identidade: identidadeLinha(l, conta, posicao) };
  });
}

/* ==================================================================== */
/* O portão de saldo                                                     */
/* ==================================================================== */

export interface Fechamento {
  fecha: boolean;
  soma: number;
  esperado: number | null;
  diferenca: number | null;
  aviso: string | null;
}

/**
 * Confere se as linhas lidas somam o saldo declarado.
 *
 * É a única verificação de integridade possível num extrato, e a razão
 * de ela existir é o PDF: leitura por modelo não tem dígito verificador,
 * e valor trocado passaria sem sintoma nenhum.
 *
 * Tolerância de um centavo cobre arredondamento de apresentação. Mais
 * que isso é erro de leitura ou linha faltando, e nos dois casos a
 * resposta certa é recusar a importação inteira — não importar "o que
 * deu". Extrato pela metade fecha o mês com um saldo que não existe, e
 * ninguém desconfia de um número que parece plausível.
 */
export function conferirFechamento(
  linhas: LinhaExtrato[],
  saldoAnterior: number | null,
  saldoFinal: number | null,
): Fechamento {
  const soma = centavos(linhas.reduce((t, l) => t + l.valor, 0));

  if (saldoAnterior === null || saldoFinal === null) {
    return {
      fecha: false,
      soma,
      esperado: null,
      diferenca: null,
      aviso:
        'O arquivo não trouxe saldo anterior e saldo final, então não dá para ' +
        'conferir se todas as linhas foram lidas. Confira o total antes de importar.',
    };
  }

  const esperado = centavos(saldoFinal - saldoAnterior);
  const diferenca = centavos(soma - esperado);

  if (Math.abs(diferenca) <= 0.01) {
    return { fecha: true, soma, esperado, diferenca, aviso: null };
  }

  return {
    fecha: false,
    soma,
    esperado,
    diferenca,
    aviso:
      `A soma dos lançamentos lidos (${soma.toFixed(2)}) não bate com a ` +
      `variação de saldo do extrato (${esperado.toFixed(2)}). ` +
      `Faltam ${Math.abs(diferenca).toFixed(2)} — alguma linha não foi lida ` +
      `ou um valor saiu errado.`,
  };
}

/* ==================================================================== */
/* Conciliação                                                           */
/* ==================================================================== */

/** O lançamento em aberto, como a rota vai buscar do banco. */
export interface LancamentoAberto {
  id: string;
  tipo: 'receita' | 'despesa';
  descricao: string;
  valor: number;
  due_date: string;
}

export interface Par {
  identidade: string;
  linha: LinhaExtrato;
  lancamento: LancamentoAberto;
  /** Dias entre o vencimento e a data do extrato. */
  distancia_dias: number;
  /** Quando o par não é obvio, a tela pede confirmação. */
  confianca: 'alta' | 'media';
}

export interface Conciliacao {
  pares: Par[];
  /** Linhas que não casaram com nada. Viram oferta de lançamento. */
  sem_par: Array<LinhaExtrato & { identidade: string }>;
  /** Lançamentos em aberto que o extrato não explicou. */
  nao_explicados: LancamentoAberto[];
}

/** Dias de diferença entre duas datas ISO. */
function distancia(a: string, b: string): number {
  const d = (s: string) => Date.parse(`${s}T00:00:00Z`);
  return Math.round(Math.abs(d(a) - d(b)) / 86_400_000);
}

/**
 * Casa linha de extrato com lançamento em aberto.
 *
 * =====================================================================
 * O CASAMENTO É POR VALOR EXATO, E A DATA SÓ DESEMPATA
 * =====================================================================
 * Valor é o único campo em que os dois lados concordam de verdade. A
 * data divergir é normal: o cliente cadastra o vencimento para o dia 10,
 * o banco debita no dia 11 porque o 10 caiu no domingo. O histórico do
 * banco quase nunca parece com a descrição que a pessoa digitou —
 * "PAGTO ELETRON COBRANCA" contra "Fornecedor de bebidas".
 *
 * Então: mesmo valor, mesmo sinal, e vencimento dentro de uma janela.
 * Entre vários candidatos, vence o mais próximo da data do extrato.
 *
 * `confianca: 'media'` quando a distância passa de uma semana — a tela
 * mostra esses separados, para a pessoa olhar antes de dar baixa. Casar
 * no automático um pagamento de 20 dias de diferença acerta na média e
 * erra exatamente no cliente que paga duas contas iguais por mês.
 *
 * Um lançamento só casa UMA vez: duas tarifas idênticas no extrato não
 * podem liquidar a mesma obrigação duas vezes.
 */
export function conciliar(
  linhas: Array<LinhaExtrato & { identidade: string }>,
  abertos: LancamentoAberto[],
  janelaDias = 30,
): Conciliacao {
  const pares: Par[] = [];
  const semPar: Array<LinhaExtrato & { identidade: string }> = [];
  const usados = new Set<string>();

  for (const linha of linhas) {
    const entrada = linha.valor > 0;
    const absoluto = centavos(Math.abs(linha.valor));

    const candidatos = abertos
      .filter((a) => !usados.has(a.id))
      .filter((a) => (entrada ? a.tipo === 'receita' : a.tipo === 'despesa'))
      .filter((a) => centavos(a.valor) === absoluto)
      .map((a) => ({ a, d: distancia(a.due_date, linha.data) }))
      .filter((c) => c.d <= janelaDias)
      .sort((x, y) => x.d - y.d);

    const escolhido = candidatos[0];

    if (!escolhido) {
      semPar.push(linha);
      continue;
    }

    usados.add(escolhido.a.id);
    pares.push({
      identidade: linha.identidade,
      linha,
      lancamento: escolhido.a,
      distancia_dias: escolhido.d,
      confianca: escolhido.d <= 7 ? 'alta' : 'media',
    });
  }

  return {
    pares,
    sem_par: semPar,
    nao_explicados: abertos.filter((a) => !usados.has(a.id)),
  };
}
