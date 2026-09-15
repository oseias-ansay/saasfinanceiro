/**
 * A fila das 8h ligada ao mundo: banco, Storage, SMTP e WhatsApp.
 *
 * =====================================================================
 * O QUE ISTO SUBSTITUI
 * =====================================================================
 * Um fluxo do n8n que chamava `GET /webhooks/diagnosticos/fila`, iterava
 * e mandava os e-mails. Ele parou de funcionar em algum momento antes de
 * 11/09/2026 e ninguém soube — os prospects simplesmente não receberam o
 * relatório prometido, e a descoberta veio de fora, não do sistema.
 *
 * Em 15/09 o vigia acusou a mesma falha em 45 minutos. Este arquivo é a
 * outra metade: parar de depender de um agendador que vive fora do
 * código versionado.
 *
 * A lógica — quando roda, em que ordem, o que é isolado do quê — está em
 * `fila.ts`, sem nada do mundo real, e é lá que os testes moram.
 */

import { supabaseAdmin } from '../../lib/supabase.js';
import { logger } from '../../lib/logger.js';
import { enviarEmail } from '../../lib/email.js';
import { avisar, comRegistro, ultimosSucessos } from '../monitor/monitor.service.js';
import { marcarStatus, obterPdf } from './diagnosticos.service.js';
import {
  devePassar,
  enviarFila,
  PROCESSO_FILA,
  type DependenciasFila,
  type ItemDaFila,
  type ResultadoDaFila,
} from './fila.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabaseAdmin as unknown as {
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

export const dependenciasFila: DependenciasFila = {
  listar: async (limite) => {
    const { data, error } = await db.rpc('fn_diagnosticos_para_enviar', { p_limite: limite });
    if (error) throw new Error(error.message ?? 'Falha ao ler a fila de diagnósticos');
    return (data ?? []) as ItemDaFila[];
  },

  pdf: (protocolo) => obterPdf(protocolo, false),

  enviarEmail: async (m) => {
    const r = await enviarEmail(m);
    return { ok: r.ok, erro: r.erro };
  },

  marcar: (protocolo, status, erro) => marcarStatus(protocolo, status, erro ?? null),

  avisar,

  log: (dados, msg) => logger.info(dados, msg),
};

export interface ResultadoPassada extends Partial<ResultadoDaFila> {
  rodou: boolean;
  motivo?: string;
}

/**
 * Decide se é hora, e se for, roda registrando em `execucoes`.
 *
 * O registro é o que faz o vigia parar de cobrar — e é por isso que a
 * passada que NÃO roda não registra nada. Registrar sucesso às 6h da
 * manhã, antes da janela, faria o vigia considerar o processo em dia
 * quando ele ainda nem devia ter acontecido.
 *
 * =====================================================================
 * POR QUE A PASSADA É "SUCESSO" MESMO COM ITENS FALHOS
 * =====================================================================
 * Porque `execucoes` responde "o processo está vivo?", e ele está: rodou,
 * leu a fila, tentou. O que precisa de gente é reportado na hora pelo
 * caminho do alarme, no WhatsApp.
 *
 * A alternativa — marcar a passada como falha — faria o agendador tentar
 * de novo em cinco minutos. Numa queda de SMTP isso queimaria as três
 * tentativas de cada lead em quinze minutos, e eles sairiam da fila para
 * sempre. Uma vez por dia, a mesma queda custa uma tentativa e dá três
 * dias de folga para consertar.
 */
export async function passadaDaFila(
  agora = new Date(),
  hora = 8,
  dep: DependenciasFila = dependenciasFila,
  limite = 50,
): Promise<ResultadoPassada> {
  const sucessos = await ultimosSucessos();

  if (!devePassar(agora, sucessos[PROCESSO_FILA] ?? null, hora)) {
    return { rodou: false, motivo: 'fora da janela ou já executado hoje' };
  }

  const r = await comRegistro(PROCESSO_FILA, async () => {
    const saida = await enviarFila(dep, limite);
    logger.info(
      { total: saida.total, enviados: saida.enviados, falhas: saida.falhas.length },
      'Fila das 8h processada',
    );
    // `total` em `execucoes` é o que foi ENTREGUE, não o que foi tentado:
    // é o número que você quer ver ao olhar o histórico.
    return { ...saida, total: saida.enviados };
  });

  return { rodou: true, total: r.total, enviados: r.enviados, falhas: r.falhas };
}
