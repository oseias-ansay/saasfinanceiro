/**
 * O relógio da fila das 8h.
 *
 * Mesmo desenho do relógio do vigia, e pela mesma razão: um `setInterval`
 * curto que pergunta "é hora?" a cada passada, em vez de um agendamento
 * que dispara uma vez e depende de o processo estar vivo naquele minuto.
 *
 * A diferença prática aparece no dia em que o contêiner é reiniciado às
 * 7h58 por um deploy. Um cron interno perderia a janela das 8h e ninguém
 * receberia relatório naquele dia — em silêncio, porque não houve erro
 * nenhum. Aqui a próxima passada, minutos depois, refaz a conta a partir
 * do banco e envia.
 *
 * O intervalo é curto de propósito: os relatórios prometem "pela manhã",
 * e cinco minutos de atraso são invisíveis para quem espera.
 */

import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { passadaDaFila } from './fila.service.js';

const INTERVALO_MIN = 5;

let relogio: NodeJS.Timeout | null = null;

async function passada() {
  try {
    const r = await passadaDaFila(new Date(), env.DIAGNOSTICOS_HORA_ENVIO);
    if (r.rodou) {
      logger.info({ enviados: r.enviados, falhas: r.falhas?.length ?? 0 }, 'Fila das 8h rodou');
    } else {
      logger.debug({ motivo: r.motivo }, 'Fila das 8h não rodou nesta passada');
    }
  } catch (e) {
    // Uma passada que falha não derruba a API nem para as próximas. E,
    // diferente de antes, ela não some: `comRegistro` já gravou a falha
    // em `execucoes`, e o vigia cobra em 45 minutos.
    logger.error({ e }, 'Falha na passada da fila das 8h');
  }
}

export function iniciarFila() {
  if (!env.DIAGNOSTICOS_ENVIO_ATIVO) {
    logger.warn('Envio das 8h desligado (DIAGNOSTICOS_ENVIO_ATIVO). A fila não será esvaziada.');
    return;
  }

  if (relogio) return;

  // Uma passada logo depois da subida: se a API estava fora do ar às 8h,
  // o relatório sai assim que ela volta, não no dia seguinte.
  setTimeout(() => void passada(), 45_000).unref();

  relogio = setInterval(() => void passada(), INTERVALO_MIN * 60_000);
  relogio.unref();

  logger.info(
    { horaEnvio: env.DIAGNOSTICOS_HORA_ENVIO, intervaloMin: INTERVALO_MIN },
    'Envio das 8h ligado',
  );
}

export function pararFila() {
  if (relogio) clearInterval(relogio);
  relogio = null;
}
