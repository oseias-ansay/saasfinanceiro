/**
 * O disjuntor de gasto com a IA.
 *
 * =====================================================================
 * É UM DISJUNTOR, NÃO UMA COTA
 * =====================================================================
 * O teto não existe para racionar diagnósticos — existe para que um
 * defeito nosso, ou um dia muito fora da curva, não vire uma fatura
 * descoberta no fim do mês.
 *
 * Por isso ele deve ficar bem acima do movimento normal. Um teto
 * apertado transforma um bom dia de campanha em prospect recusado, e o
 * prejuízo disso é maior que a conta que ele evitaria.
 *
 * =====================================================================
 * O QUE ACONTECE AO BATER
 * =====================================================================
 * A chamada é recusada, o alarme sai por WhatsApp, e o diagnóstico
 * falha de forma registrada — o lead fica gravado, o evento fica em
 * `execucoes`, e dá para reprocessar depois de subir o limite.
 *
 * O que NÃO acontece: seguir chamando o modelo em silêncio.
 */

import { supabaseAdmin } from '../../lib/supabase.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { avisar } from '../monitor/monitor.service.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabaseAdmin as unknown as {
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

export class OrcamentoEstourado extends Error {
  constructor(
    public readonly usadas: number,
    public readonly limite: number,
  ) {
    super(`Teto diário de chamadas à IA atingido (${usadas}/${limite})`);
    this.name = 'OrcamentoEstourado';
  }
}

interface Reserva {
  permitido: boolean;
  usadas: number;
  limite: number;
}

/**
 * Reserva uma chamada. Lança quando o teto foi atingido.
 *
 * Falha de infraestrutura aqui **deixa passar**, de propósito. O teto
 * protege contra gasto excessivo; ele não pode virar a causa de nenhum
 * diagnóstico perdido. Entre pagar uma chamada a mais e deixar um
 * prospect sem relatório porque o contador estava fora do ar, a primeira
 * é barata e a segunda não se recupera.
 */
export async function reservarChamada(): Promise<Reserva | null> {
  try {
    const { data, error } = await db.rpc('fn_ia_reservar', { p_limite: env.IA_LIMITE_DIARIO });
    if (error) throw new Error(error.message);

    const r = data as Reserva;

    if (!r.permitido) {
      logger.error({ usadas: r.usadas, limite: r.limite }, 'TETO DIÁRIO DE IA ATINGIDO');
      await alarmar(r);
      throw new OrcamentoEstourado(r.usadas, r.limite);
    }

    // Avisa ao chegar em 80%, uma vez por dia. Serve para você decidir se
    // sobe o limite ANTES de alguém ser recusado — quando o teto bate, já
    // houve prejuízo.
    if (r.usadas >= Math.floor(r.limite * 0.8)) {
      await alarmar(r, true);
    }

    return r;
  } catch (e) {
    if (e instanceof OrcamentoEstourado) throw e;
    logger.warn({ e }, 'Não foi possível consultar o teto de IA — seguindo sem ele');
    return null;
  }
}

async function alarmar(r: Reserva, aviso = false) {
  try {
    const chave = aviso ? 'ia.orcamento.aviso' : 'ia.orcamento.estouro';
    const { data } = await db.rpc('fn_alarme_cabe', {
      p_processo: chave,
      p_intervalo: '20 hours',
    });
    if (data !== true) return;

    await avisar(
      aviso
        ? `⚠️ *Business Triage* — consumo de IA em ${r.usadas} de ${r.limite} hoje.\n\n` +
            'Se a campanha está indo bem, suba o teto antes que ele recuse alguém.'
        : `🛑 *Business Triage* — TETO DE IA ATINGIDO (${r.usadas}/${r.limite}).\n\n` +
            'Diagnósticos novos estão sendo RECUSADOS. Suba `IA_LIMITE_DIARIO` ' +
            'e reinicie a API, ou investigue o que está consumindo.',
    );
  } catch {
    // O alarme falhar não pode impedir a decisão do teto.
  }
}

/** Contabiliza o consumo real. Nunca lança. */
export async function registrarConsumo(entrada?: number, saida?: number) {
  try {
    await db.rpc('fn_ia_consumo', { p_entrada: entrada ?? 0, p_saida: saida ?? 0 });
  } catch {
    // Perder a contabilidade de uma chamada é aceitável; derrubar o
    // diagnóstico por causa dela, não.
  }
}
