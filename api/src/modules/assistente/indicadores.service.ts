/**
 * Coleta os indicadores no Banco Central e guarda a última leitura.
 *
 * =====================================================================
 * UMA VEZ POR DIA, NÃO A CADA PERGUNTA
 * =====================================================================
 * IPCA e IGP-M mudam uma vez por mês; a Selic, quando o Copom se reúne;
 * a PTAX, uma vez por dia útil. Buscar na hora da pergunta adicionaria
 * latência, um ponto de falha e nenhuma informação nova.
 *
 * =====================================================================
 * FALHA DE UM NÃO DERRUBA OS OUTROS
 * =====================================================================
 * Cada indicador é uma chamada independente, com o erro contado na
 * própria linha. Se o BCB recusar a série do euro e servir as demais, o
 * cliente perde o euro — não os cinco.
 *
 * E o valor anterior permanece. A Selic de ontem é a Selic de hoje em
 * quase todos os dias; apagar a leitura por causa de uma coleta falha
 * trocaria um dado levemente velho por nenhum dado.
 */

import { supabaseAdmin } from '../../lib/supabase.js';
import { logger } from '../../lib/logger.js';
import { CODIGOS, lerRespostaBCB, SERIES, type CodigoIndicador } from './indicadores.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = () =>
  supabaseAdmin as unknown as {
    from: (t: string) => any;
    rpc: (fn: string, args: Record<string, unknown>) => Promise<any>;
  };
/* eslint-enable @typescript-eslint/no-explicit-any */

const BASE = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs';
const FONTE = 'Banco Central do Brasil (SGS)';

/** Tempo máximo por série. Curto de propósito: são cinco em sequência. */
const TIMEOUT_MS = 15_000;

async function buscar(codigo: CodigoIndicador) {
  const { serie } = SERIES[codigo];
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), TIMEOUT_MS);

  try {
    const resp = await fetch(`${BASE}.${serie}/dados/ultimos/1?formato=json`, {
      signal: controle.signal,
      headers: { accept: 'application/json' },
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const lido = lerRespostaBCB(await resp.json());
    if (!lido) throw new Error('resposta em formato inesperado');

    return lido;
  } finally {
    clearTimeout(relogio);
  }
}

export interface ResultadoColeta {
  atualizados: string[];
  falhas: Array<{ codigo: string; erro: string }>;
}

/**
 * Atualiza os cinco indicadores. Nunca lança.
 *
 * Chamada pelo relógio da API e pelo script de carga inicial. Falhar
 * silenciosamente aqui seria ruim; derrubar o processo da API por causa
 * de uma cotação seria pior.
 */
export async function coletarIndicadores(): Promise<ResultadoColeta> {
  const r: ResultadoColeta = { atualizados: [], falhas: [] };

  for (const codigo of CODIGOS) {
    try {
      const { referencia, valor } = await buscar(codigo);
      const meta = SERIES[codigo];

      const { error } = await db()
        .from('indicadores_economicos')
        .upsert(
          {
            codigo,
            nome: meta.nome,
            referencia,
            valor,
            unidade: meta.unidade,
            fonte: FONTE,
            coletado_em: new Date().toISOString(),
            falhas: 0,
            ultimo_erro: null,
          } as never,
          { onConflict: 'codigo' },
        );

      if (error) throw new Error(error.message);
      r.atualizados.push(codigo);
    } catch (e) {
      const erro = e instanceof Error ? e.message : String(e);
      r.falhas.push({ codigo, erro });

      // Marca a falha SEM tocar no valor: o número anterior continua
      // valendo e sendo respondido, agora com o contador subindo. É o que
      // permite o assistente seguir útil enquanto a fonte está fora.
      await db()
        .rpc('fn_indicador_falhou', { p_codigo: codigo, p_erro: erro.slice(0, 300) })
        .then(
          () => undefined,
          () => undefined,
        );
    }
  }

  if (r.falhas.length > 0) {
    logger.warn({ falhas: r.falhas }, 'Coleta de indicadores com falhas');
  } else {
    logger.info({ atualizados: r.atualizados.length }, 'Indicadores econômicos atualizados');
  }

  return r;
}

/* ==================================================================== */
/* O relógio                                                             */
/* ==================================================================== */

/**
 * Uma passada a cada seis horas.
 *
 * Não é cron de horário fixo pela mesma razão do resto do projeto: um
 * deploy às 7h58 faria o agendamento das 8h ser perdido e ninguém
 * perceberia. Intervalo curto que pergunta "preciso atualizar?" sobrevive
 * a reinício.
 *
 * Seis horas cobre a PTAX, que é o mais volátil da lista, e mantém o
 * número de chamadas em quatro por dia — irrelevante para o BCB e barato
 * para nós.
 */
const INTERVALO_H = 6;
let relogio: NodeJS.Timeout | null = null;

export function iniciarIndicadores() {
  if (relogio) return;

  // A primeira coleta sai logo após o boot, com um atraso curto para não
  // competir com a abertura da porta. Sem ela, uma instalação nova
  // responderia "indicadores não coletados" até a primeira virada de
  // intervalo.
  setTimeout(() => void coletarIndicadores(), 30_000);

  relogio = setInterval(() => void coletarIndicadores(), INTERVALO_H * 3_600_000);
  logger.info({ intervalo_h: INTERVALO_H }, 'Relógio dos indicadores econômicos iniciado');
}

export function pararIndicadores() {
  if (relogio) clearInterval(relogio);
  relogio = null;
}
