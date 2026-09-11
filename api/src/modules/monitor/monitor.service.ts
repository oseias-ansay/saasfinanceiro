/**
 * O vigia ligado ao mundo: lê o banco, decide, e avisa pelo WhatsApp.
 *
 * =====================================================================
 * POR QUE WHATSAPP E NÃO E-MAIL
 * =====================================================================
 * O alarme anterior desta plataforma era um nó de Gmail no n8n, e ele
 * usava a MESMA credencial do envio que deveria vigiar. Quando o Gmail
 * quebrou, o relatório não saiu e o aviso de que não saiu também não —
 * o alarme compartilhava o modo de falha do incêndio.
 *
 * O WhatsApp aqui passa pela Evolution, que é outro processo, outra
 * credencial, outra rede e outro fornecedor. Não é preferência de canal:
 * é a única propriedade que importa num alarme, que é falhar por motivos
 * diferentes daquilo que ele vigia.
 */

import { supabaseAdmin } from '../../lib/supabase.js';
import { logger } from '../../lib/logger.js';
import { enviarTexto } from '../../lib/evolution.js';
import { env } from '../../config/env.js';
import { avaliar, textoDoAlarme, textoDoPulso, PROCESSOS, type Situacao } from './monitor.js';
import { emSaoPaulo } from './relogio.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabaseAdmin as unknown as {
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ==================================================================== */
/* Registrar que um processo rodou                                       */
/* ==================================================================== */

/**
 * Envolve um processo automático no registro de início e fim.
 *
 * Devolve o que a função devolveu, e relança o erro depois de registrar
 * — quem chama continua tratando falha como sempre. O registro é efeito
 * colateral, nunca dono do fluxo.
 *
 * Se o próprio registro falhar, o processo continua. Vigia que derruba o
 * que vigia é pior que vigia nenhum, e foi exatamente esse erro, com
 * outro nome, que fez a resposta da Evolution abortar a execução inteira
 * no n8n.
 */
export async function comRegistro<T extends { total?: number }>(
  processo: string,
  tarefa: () => Promise<T>,
): Promise<T> {
  let id: string | null = null;
  try {
    const { data } = await db.rpc('fn_execucao_inicio', { p_processo: processo });
    id = (data as string | null) ?? null;
  } catch (e) {
    logger.warn({ processo, e }, 'Não foi possível abrir o registro de execução');
  }

  try {
    const r = await tarefa();
    await fecharRegistro(id, true, r.total ?? null, null);
    return r;
  } catch (e) {
    await fecharRegistro(id, false, null, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

async function fecharRegistro(
  id: string | null,
  ok: boolean,
  total: number | null,
  erro: string | null,
) {
  if (!id) return;
  try {
    await db.rpc('fn_execucao_fim', {
      p_id: id,
      p_ok: ok,
      p_total: total,
      p_detalhe: null,
      p_erro: erro,
    });
  } catch (e) {
    logger.warn({ id, e }, 'Não foi possível fechar o registro de execução');
  }
}

/* ==================================================================== */
/* A verificação                                                         */
/* ==================================================================== */

export async function ultimosSucessos(): Promise<Record<string, Date | null>> {
  const { data, error } = await db.rpc('fn_execucoes_ultimo_sucesso');
  if (error) throw new Error(error.message ?? 'Falha ao ler execuções');

  const mapa: Record<string, Date | null> = {};
  for (const linha of (data ?? []) as Array<{ processo: string; ultimo_sucesso: string | null }>) {
    mapa[linha.processo] = linha.ultimo_sucesso ? new Date(linha.ultimo_sucesso) : null;
  }
  return mapa;
}

export interface ResultadoVerificacao {
  situacoes: Situacao[];
  atrasados: Situacao[];
  alarmeEnviado: boolean;
  pulsoEnviado: boolean;
}

/**
 * Uma passada do vigia.
 *
 * @param horaDoPulso Hora local em que o pulso diário sai. Fora dela, só
 *   alarme. Um pulso a cada verificação viraria ruído, e ruído treina
 *   quem lê a ignorar — que é como um alarme morre sem ninguém desligar.
 */
export async function verificar(
  agora = new Date(),
  horaDoPulso = 7,
): Promise<ResultadoVerificacao> {
  const situacoes = avaliar(agora, await ultimosSucessos(), PROCESSOS);
  const atrasados = situacoes.filter((s) => s.atrasado);

  // Processo que voltou ao normal esquece o histórico, para que uma
  // recaída amanhã avise na hora em vez de esperar a janela de repetição.
  for (const s of situacoes.filter((x) => !x.atrasado)) {
    await silenciar('fn_alarme_limpar', { p_processo: s.processo.chave });
  }

  let alarmeEnviado = false;
  if (atrasados.length > 0) {
    // A janela é por processo: o diagnóstico parado não pode calar o
    // alarme dos eventos da Meta pararem em seguida.
    const cabem: Situacao[] = [];
    for (const s of atrasados) {
      const { data } = await db.rpc('fn_alarme_cabe', {
        p_processo: s.processo.chave,
        p_intervalo: '6 hours',
      });
      if (data === true) cabem.push(s);
    }

    if (cabem.length > 0) {
      alarmeEnviado = await avisar(textoDoAlarme(cabem, agora));
      logger.error(
        { processos: cabem.map((s) => s.processo.chave), enviado: alarmeEnviado },
        'Processos atrasados',
      );
    }
  }

  let pulsoEnviado = false;
  const local = emSaoPaulo(agora);
  if (local.hora === horaDoPulso) {
    const dia = `${local.ano}-${String(local.mes).padStart(2, '0')}-${String(local.dia).padStart(2, '0')}`;
    const { data } = await db.rpc('fn_pulso_reservar', { p_dia: dia });
    if (data === true) pulsoEnviado = await avisar(textoDoPulso(situacoes, agora));
  }

  return { situacoes, atrasados, alarmeEnviado, pulsoEnviado };
}

async function silenciar(fn: string, args: Record<string, unknown>) {
  try {
    await db.rpc(fn, args);
  } catch {
    // Limpeza de estado do alarme nunca derruba a verificação.
  }
}

/* ==================================================================== */
/* O aviso                                                               */
/* ==================================================================== */

/**
 * Manda o texto pelo WhatsApp.
 *
 * Quando não há número configurado, o alarme vira linha de log em nível
 * de erro. Não é o ideal, mas é honesto: melhor um alarme que só aparece
 * no log do que a impressão de que existe vigilância onde não existe.
 */
export async function avisar(texto: string): Promise<boolean> {
  if (!env.MONITOR_WHATSAPP || !env.MONITOR_INSTANCIA) {
    logger.error(
      { texto },
      'ALARME sem destino: configure MONITOR_WHATSAPP e MONITOR_INSTANCIA',
    );
    return false;
  }

  const envio = await enviarTexto(env.MONITOR_INSTANCIA, env.MONITOR_WHATSAPP, texto);
  if (!envio.ok) {
    // O alarme não conseguiu sair. Isto precisa ser gritante no log,
    // porque é o ponto cego final: a partir daqui não há mais ninguém
    // para avisar.
    logger.error({ erro: envio.erro, texto }, 'FALHA AO ENVIAR O ALARME');
  }
  return envio.ok;
}
