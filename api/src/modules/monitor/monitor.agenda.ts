/**
 * O relógio do vigia.
 *
 * ---------------------------------------------------------------------
 * POR QUE NÃO UMA BIBLIOTECA DE CRON
 * ---------------------------------------------------------------------
 * Porque o vigia não precisa saber que horas são. Ele compara o que
 * rodou com o que deveria ter rodado, e essa comparação dá o mesmo
 * resultado às 8h01 ou às 8h37. Um `setInterval` de dez minutos basta, e
 * não traz dependência nem sintaxe de cron para revisar.
 *
 * A consequência boa é que o relógio pode atrasar, pular, ou o processo
 * reiniciar no meio: nada disso perde um alarme. Na próxima passada a
 * conta é refeita do zero a partir do banco. Agendador que guarda estado
 * na memória é o tipo de coisa que falha em silêncio depois de um
 * `docker compose up` — que é justamente o que estamos eliminando.
 */

import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { verificar } from './monitor.service.js';

let relogio: NodeJS.Timeout | null = null;

async function passada() {
  try {
    const r = await verificar(new Date(), env.MONITOR_HORA_PULSO);
    logger.debug(
      { atrasados: r.atrasados.length, alarme: r.alarmeEnviado, pulso: r.pulsoEnviado },
      'Vigia rodou',
    );
  } catch (e) {
    // Uma passada que falha não pode derrubar a API nem parar as
    // próximas. O `setInterval` continua; a próxima tentativa é em dez
    // minutos e refaz a conta inteira.
    logger.error({ e }, 'Falha na verificação do vigia');
  }
}

export function iniciarVigia() {
  if (!env.MONITOR_ATIVO) {
    logger.warn('Vigia desligado (MONITOR_ATIVO). Nenhum processo será cobrado.');
    return;
  }

  if (relogio) return;

  // A primeira passada sai logo depois da subida, não em dez minutos: se
  // a API caiu durante a madrugada e alguma coisa ficou para trás, você
  // fica sabendo ao voltar, não no próximo ciclo.
  //
  // Meio minuto de folga para o banco e a rede assentarem primeiro.
  setTimeout(() => void passada(), 30_000).unref();

  relogio = setInterval(() => void passada(), env.MONITOR_INTERVALO_MIN * 60_000);
  relogio.unref();

  logger.info(
    { intervaloMin: env.MONITOR_INTERVALO_MIN, horaPulso: env.MONITOR_HORA_PULSO },
    'Vigia ligado',
  );
}

export function pararVigia() {
  if (relogio) clearInterval(relogio);
  relogio = null;
}
