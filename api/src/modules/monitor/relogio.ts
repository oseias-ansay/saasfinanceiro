/**
 * Contas de calendário no fuso de São Paulo.
 *
 * ---------------------------------------------------------------------
 * POR QUE NÃO FIXAR UTC-3 E ACABAR
 * ---------------------------------------------------------------------
 * Seria mais simples, e funcionaria hoje: o Brasil aboliu o horário de
 * verão em 2019. Mas a volta dele é assunto político recorrente, e no dia
 * em que voltasse todo processo agendado passaria a ser considerado
 * atrasado ou adiantado em uma hora — por uma hora, todo dia, em
 * silêncio, exatamente o tipo de defeito que este módulo existe para
 * eliminar.
 *
 * O deslocamento é perguntado ao sistema para cada instante. Custa uma
 * formatação e nunca mente.
 */

export const FUSO = 'America/Sao_Paulo';

export interface ParteLocal {
  ano: number;
  mes: number; // 1-12
  dia: number;
  hora: number;
  minuto: number;
  /** 1 = segunda … 7 = domingo (ISO). */
  diaSemana: number;
}

const FORMATADOR = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  weekday: 'short',
});

const ISO_DA_SEMANA: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

function partes(d: Date): Record<string, string> {
  return Object.fromEntries(FORMATADOR.formatToParts(d).map((p) => [p.type, p.value]));
}

/** Que horas são em São Paulo neste instante. */
export function emSaoPaulo(d: Date): ParteLocal {
  const p = partes(d);
  return {
    ano: Number(p.year),
    mes: Number(p.month),
    dia: Number(p.day),
    // `24` aparece à meia-noite em algumas versões do ICU. Normalizar aqui
    // evita um erro de um dia que só apareceria entre 00h e 01h.
    hora: Number(p.hour) % 24,
    minuto: Number(p.minute),
    diaSemana: ISO_DA_SEMANA[p.weekday ?? 'Mon'] ?? 1,
  };
}

/** Quantos minutos São Paulo está à frente do UTC neste instante. */
function deslocamentoMin(d: Date): number {
  const p = partes(d);
  const comoSeFosseUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second),
  );
  return (comoSeFosseUtc - d.getTime()) / 60_000;
}

/**
 * Converte uma data e hora do relógio de parede de São Paulo no instante
 * correspondente.
 *
 * Faz duas passadas de propósito. A primeira chuta o deslocamento usando
 * o próprio palpite; se o palpite cair do outro lado de uma mudança de
 * fuso, a segunda corrige. Sem isso, o único dia do ano em que a conta
 * erra é justamente o da virada — e o erro seria de uma hora, silencioso.
 */
export function instanteEmSaoPaulo(
  ano: number,
  mes: number,
  dia: number,
  hora: number,
  minuto = 0,
): Date {
  const ingenuo = Date.UTC(ano, mes - 1, dia, hora, minuto);
  let d = new Date(ingenuo - deslocamentoMin(new Date(ingenuo)) * 60_000);
  d = new Date(ingenuo - deslocamentoMin(d) * 60_000);
  return d;
}

/** Sábado e domingo. Feriado não conta — ver o comentário em `monitor.ts`. */
export function ehFimDeSemana(p: ParteLocal): boolean {
  return p.diaSemana === 6 || p.diaSemana === 7;
}

/** O mesmo relógio, um número de dias antes. */
export function diasAntes(p: ParteLocal, n: number): ParteLocal {
  const d = new Date(Date.UTC(p.ano, p.mes - 1, p.dia - n, 12));
  return {
    ano: d.getUTCFullYear(),
    mes: d.getUTCMonth() + 1,
    dia: d.getUTCDate(),
    hora: p.hora,
    minuto: p.minuto,
    diaSemana: ((d.getUTCDay() + 6) % 7) + 1,
  };
}
