/**
 * Drenagem da fila de eventos para a Meta.
 *
 * Chamada pelo n8n de tempos em tempos. Pega os pendentes, manda um a um,
 * dá baixa no que deu certo e conta a tentativa no que não deu.
 *
 * ---------------------------------------------------------------------
 * UM A UM, E NÃO EM LOTE
 * ---------------------------------------------------------------------
 * A Meta aceita vários eventos numa requisição só, e seria mais rápido.
 * Mas a resposta de um lote é agregada: se três dos dez forem recusados,
 * não dá para saber quais. Ou se marca os dez como enviados — e três
 * somem para sempre — ou se marca os dez como falhos, e sete são
 * reenviados.
 *
 * O volume aqui é de dezenas por dia. Trocar clareza sobre o destino de
 * cada evento por milissegundos seria péssimo negócio.
 *
 * ---------------------------------------------------------------------
 * NUNCA RESPONDE ERRO POR EVENTO RECUSADO
 * ---------------------------------------------------------------------
 * Se a Meta recusar tudo, esta rota ainda devolve 200 com o relatório
 * dentro. O n8n não deve marcar a execução como falha por causa disso:
 * a fila registrou o erro, as tentativas serão refeitas, e execução
 * vermelha recorrente treina quem olha a lista a ignorá-la.
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { supabaseAdmin } from '../../lib/supabase.js';
import { env } from '../../config/env.js';
import { fromPostgrest, badRequest } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { requireWebhookSecret } from '../webhooks/secret.js';
import { enviarEvento, type EventoParaMeta } from './capi.js';

export const metaRouter = Router();

metaRouter.use(
  rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false }),
  requireWebhookSecret,
);

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabaseAdmin as unknown as {
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

metaRouter.post('/enviar', async (req, res, next) => {
  try {
    if (!env.META_DATASET_ID || !env.META_ACCESS_TOKEN) {
      // Não é erro de servidor: é a integração desligada de propósito.
      // Diz isso claramente em vez de estourar com "undefined".
      throw badRequest(
        'Integração com a Meta não configurada. Defina META_DATASET_ID e META_ACCESS_TOKEN.',
      );
    }

    const limite = Number((req.body as { limite?: number } | undefined)?.limite ?? 50);

    const { data: pendentes, error } = await db.rpc('fn_eventos_meta_pendentes', {
      p_limite: limite,
    });
    if (error) throw fromPostgrest(error);

    const lista = (pendentes ?? []) as EventoParaMeta[];
    const cfg = {
      datasetId: env.META_DATASET_ID,
      accessToken: env.META_ACCESS_TOKEN,
      apiVersion: env.META_API_VERSION,
      testEventCode: env.META_TEST_EVENT_CODE || undefined,
    };

    let enviados = 0;
    let falhas = 0;
    const erros: { event_id: string; erro: string }[] = [];

    for (const ev of lista) {
      const r = await enviarEvento(ev, cfg);

      await db.rpc('fn_evento_meta_baixa', {
        p_id: ev.id,
        p_sucesso: r.ok,
        p_erro: r.erro ?? null,
        p_resposta: r.corpo ?? null,
      });

      if (r.ok) {
        enviados++;
      } else {
        falhas++;
        erros.push({ event_id: ev.event_id, erro: r.erro ?? 'desconhecido' });
        logger.warn({ event_id: ev.event_id, status: r.status, erro: r.erro }, 'Evento recusado');
      }
    }

    // Quantos levaram o identificador do clique. É o indicador que diz se
    // a atribuição está funcionando de verdade — zero aqui significa que
    // a Meta está casando só por telefone, com acerto bem menor.
    const comClique = lista.filter((e) => e.ctwa_clid).length;

    logger.info({ total: lista.length, enviados, falhas, comClique }, 'Fila da Meta drenada');

    res.json({
      data: {
        total: lista.length,
        enviados,
        falhas,
        com_clique: comClique,
        modo: env.META_TEST_EVENT_CODE ? 'teste' : 'producao',
        erros: erros.slice(0, 10),
      },
    });
  } catch (e) {
    next(e);
  }
});
