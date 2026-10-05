/**
 * Indicadores econômicos públicos: IPCA, IGP-M, Selic, dólar e euro.
 *
 * =====================================================================
 * POR QUE ISTO É FERRAMENTA, E NÃO CONHECIMENTO DO MODELO
 * =====================================================================
 * O modelo tem uma Selic na cabeça — a da época em que foi treinado. Ela
 * está errada, e ele não tem como saber disso.
 *
 * Um número macroeconômico dito com confiança e desatualizado é pior que
 * resposta nenhuma: o cliente usa numa projeção, e o erro só aparece
 * quando a decisão já foi tomada.
 *
 * =====================================================================
 * A DATA DE REFERÊNCIA ANDA JUNTO COM O VALOR
 * =====================================================================
 * Sempre. "O IPCA é 0,44%" é incompleto a ponto de enganar: o índice sai
 * com defasagem de semanas, e quem lê entende que é o do mês corrente.
 *
 * É a mesma regra das telas da plataforma — o número grande declara de
 * onde veio —, aplicada a dado de fora.
 *
 * =====================================================================
 * DADO VELHO É DITO, NÃO ESCONDIDO
 * =====================================================================
 * Se a coleta falhar por dias, o valor guardado continua sendo melhor
 * que nada: a Selic de ontem é a Selic de hoje em 99% dos dias. Mas o
 * texto avisa quando a leitura está velha, e o limite é por tipo —
 * câmbio de três dias atrás é um problema; IPCA de três dias atrás é
 * normal, porque ele é mensal.
 */

/** Séries do SGS do Banco Central. */
export const SERIES = {
  ipca: { serie: 433, nome: 'IPCA (variação mensal)', unidade: '%', mensal: true },
  igpm: { serie: 189, nome: 'IGP-M (variação mensal)', unidade: '%', mensal: true },
  selic: { serie: 432, nome: 'Selic meta', unidade: '% a.a.', mensal: false },
  dolar: { serie: 1, nome: 'Dólar (PTAX venda)', unidade: 'R$', mensal: false },
  euro: { serie: 21619, nome: 'Euro (PTAX venda)', unidade: 'R$', mensal: false },
} as const;

export type CodigoIndicador = keyof typeof SERIES;

export const CODIGOS = Object.keys(SERIES) as CodigoIndicador[];

export interface Indicador {
  codigo: string;
  nome: string;
  /** ISO `aaaa-mm-dd`. O mês ou dia do indicador, nunca o da coleta. */
  referencia: string;
  valor: number;
  unidade: string;
  fonte: string;
  coletado_em: string;
}

/**
 * Quantos dias uma leitura pode ter antes de valer um aviso.
 *
 * Diferente por tipo, e a diferença importa: IPCA de 40 dias atrás é o
 * número corrente, porque ele é mensal e sai com defasagem. Dólar de 40
 * dias atrás é inútil. Um limite único faria o assistente alarmar sobre o
 * IPCA todo mês ou calar sobre um câmbio velho — os dois ruins.
 */
export const VALIDADE_DIAS: Record<CodigoIndicador, number> = {
  ipca: 45,
  igpm: 45,
  selic: 10,
  dolar: 5,
  euro: 5,
};

/**
 * Converte o número do BCB, que vem em DOIS formatos.
 *
 * =====================================================================
 * O PONTO NEM SEMPRE É SEPARADOR DE MILHAR
 * =====================================================================
 * A primeira versão removia todos os pontos e trocava a vírgula por
 * ponto — assumindo formato brasileiro. A resposta real da série 433, em
 * 05/10/2026, é `"valor":"-0.32"`: ponto DECIMAL.
 *
 * O resultado era -0,32% virando **-32%**. Cem vezes maior, com toda a
 * aparência de um número plausível de inflação em crise. O teste com a
 * resposta real pegou; a leitura do código não teria pego.
 *
 * A regra: se há vírgula, ela é o decimal e os pontos são milhar. Se não
 * há vírgula, o ponto é o decimal e não se mexe nele.
 */
export function numeroBCB(bruto: unknown): number | null {
  if (typeof bruto === 'number') return Number.isFinite(bruto) ? bruto : null;
  if (typeof bruto !== 'string') return null;

  const t = bruto.trim();
  // Vazio não é zero. Série sem dado publicado devolve string vazia, e
  // zero seria um número — errado e crível ao mesmo tempo.
  if (t === '') return null;

  const normalizado = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;

  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

/** Converte "01/10/2026" do BCB em ISO. */
export function dataBCB(bruto: unknown): string | null {
  if (typeof bruto !== 'string') return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(bruto.trim());
  if (!m) return null;

  const [, d, mes, a] = m;
  const data = new Date(Date.UTC(Number(a), Number(mes) - 1, Number(d)));
  if (data.getUTCMonth() !== Number(mes) - 1) return null;

  return `${a}-${mes}-${d}`;
}

/**
 * Lê a resposta do SGS: `[{ "data": "01/10/2026", "valor": "0.44" }]`.
 *
 * Devolve `null` em vez de lançar quando o formato não bate. A coleta
 * roda sozinha, diariamente — e uma exceção numa rotina sem ninguém
 * olhando vira log que ninguém lê. Nulo vira contador de falha, que
 * aparece na tabela.
 */
export function lerRespostaBCB(
  bruto: unknown,
): { referencia: string; valor: number } | null {
  if (!Array.isArray(bruto) || bruto.length === 0) return null;

  // O último da lista é o mais recente: o SGS devolve em ordem crescente.
  const ultimo = bruto[bruto.length - 1] as Record<string, unknown>;
  if (!ultimo || typeof ultimo !== 'object') return null;

  const referencia = dataBCB(ultimo.data);
  const valor = numeroBCB(ultimo.valor);

  if (!referencia || valor === null) return null;
  return { referencia, valor };
}

const dataBR = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');

const mesBR = (iso: string) => {
  const meses = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  ];
  const [a, m] = iso.split('-');
  return `${meses[Number(m) - 1] ?? m}/${a}`;
};

function diasDesde(iso: string, hoje: Date): number {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return Math.floor((hoje.getTime() - d.getTime()) / 86_400_000);
}

const numeroBR = (v: number, casas: number) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

/**
 * O texto que vai ao modelo.
 *
 * Cada linha carrega valor, unidade e referência. Câmbio sai com quatro
 * casas porque é assim que a PTAX é publicada, e arredondar para duas
 * mudaria o número que o cliente confere no contrato dele.
 */
export function resumirIndicadores(indicadores: Indicador[], hoje: Date): string {
  if (indicadores.length === 0) {
    return 'Os indicadores econômicos ainda não foram coletados. Diga ao cliente que essa informação não está disponível no momento — não estime nenhum valor.';
  }

  const l: string[] = [];

  for (const i of indicadores) {
    const mensal = SERIES[i.codigo as CodigoIndicador]?.mensal ?? false;
    const cambio = i.unidade === 'R$';

    const quando = mensal
      ? `referente a ${mesBR(i.referencia)}`
      : `em ${dataBR(i.referencia)}`;

    const valor = cambio
      ? `R$ ${numeroBR(i.valor, 4)}`
      : `${numeroBR(i.valor, 2)}${i.unidade === '%' ? '%' : ` ${i.unidade}`}`;

    const dias = diasDesde(i.referencia, hoje);
    const limite = VALIDADE_DIAS[i.codigo as CodigoIndicador] ?? 30;
    const velho = dias > limite ? ` — ATENÇÃO: esta leitura tem ${dias} dias, pode estar desatualizada` : '';

    l.push(`- ${i.nome}: ${valor}, ${quando}${velho}`);
  }

  l.push('');
  l.push(`Fonte: Banco Central do Brasil. Sempre informe a data de referência junto com o valor.`);

  return l.join('\n');
}
