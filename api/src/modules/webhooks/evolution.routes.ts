/**
 * A Evolution falando direto com a API, sem o n8n no meio.
 *
 * =====================================================================
 * POR QUE ESTA ROTA EXISTE
 * =====================================================================
 * O caminho anterior era: Evolution → n8n (domínio público) → API. Três
 * saltos, sendo que o do meio era um nó de JavaScript num editor sem
 * git, sem tipos e sem testes, no caminho crítico do atendimento.
 *
 * O custo apareceu inteiro em dois dias de diagnóstico. Nenhum dos
 * defeitos era difícil; todos eram invisíveis:
 *
 *   - o n8n aborta a execução INTEIRA quando um nó falha, então três
 *     ramos desenhados como paralelos não eram independentes, e a falha
 *     do envio da resposta levava junto o registro do lead;
 *   - execução no n8n é fotografia imutável, então reabrir uma antiga
 *     mostrava para sempre o segredo velho, e "eu já troquei" e "não
 *     colou" eram indistinguíveis;
 *   - o nó chamava o domínio público da própria API, e um contêiner
 *     chamando o host de fora não completa a volta — timeout, sem
 *     mensagem.
 *
 * Aqui o caminho é um salto, interno, e cada decisão está num arquivo
 * versionado com teste.
 *
 * =====================================================================
 * RESPONDE 200 QUASE SEMPRE
 * =====================================================================
 * A Evolution reenvia o evento quando não recebe 200 — e reenviar não
 * conserta nada aqui: se a instância não está cadastrada, ela continuará
 * não estando na segunda tentativa. Erro de verdade fica no registro de
 * eventos, que é consultável, em vez de virar uma fila de reentregas que
 * ninguém vê.
 *
 * Esta rota é fina de propósito. A ordem dos passos e o isolamento das
 * falhas moram em `evolution.processar.ts`, onde dá para testá-los.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';

import { env } from '../../config/env.js';
import { unauthorized } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { enviarTexto } from '../../lib/evolution.js';
import { safeEqual } from './secret.js';
import { processarEvento, type Dependencias } from './evolution.processar.js';
import {
  empresaDaInstancia,
  gravarMensagem,
  registrarEvento,
  registrarLead,
  temRecursoCrm,
} from './whatsapp.service.js';

export const evolutionRouter = Router();

/** O segredo esperado. Cai no do n8n quando não há um próprio. */
function segredoEsperado() {
  return env.EVOLUTION_WEBHOOK_TOKEN || env.N8N_WEBHOOK_SECRET;
}

/**
 * A rota é alcançável pelo domínio público — sem guarda, qualquer um
 * criaria lead e mensagem falsos, e envenenaria a otimização da campanha
 * de quebra.
 *
 * Aceita dois nomes de cabeçalho de propósito: nem toda versão da
 * Evolution deixa escolher o nome, e ter dois evita a situação em que a
 * troca depende de atualizar a Evolution.
 */
function guarda(req: Request, _res: Response, next: NextFunction) {
  const enviado = req.header('x-evolution-token') ?? req.header('x-n8n-secret') ?? '';
  if (!safeEqual(enviado, segredoEsperado())) {
    logger.warn({ ip: req.ip }, 'Webhook da Evolution com segredo inválido');
    return next(unauthorized('Segredo inválido'));
  }
  next();
}

evolutionRouter.use(
  // Conversa chega em rajada, e várias pessoas escrevendo ao mesmo tempo
  // durante a campanha é o cenário esperado, não o abuso.
  rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: true, legacyHeaders: false }),
  guarda,
);

const dependencias: Dependencias = {
  empresaDaInstancia,
  temRecursoCrm,
  registrarLead,
  gravarMensagem,
  enviarTexto,
  registrarEvento,
  aviso: (dados, msg) => logger.warn(dados, msg),
};

evolutionRouter.post('/inbound', async (req, res) => {
  const r = await processarEvento(req.body, dependencias);

  if (r.lead_id) {
    logger.info(
      { tenant: r.tenant_id, lead: r.lead_id, criado: r.lead_criado },
      r.lead_criado ? 'Lead criado pelo WhatsApp' : 'Contato de lead já existente',
    );
  }

  res.json({
    data: {
      ok: r.ok,
      motivo: r.motivo,
      lead_id: r.lead_id,
      lead_criado: r.lead_criado,
      mensagem_id: r.mensagem_id,
      respondido: r.respondido,
      resposta_id: r.resposta_id,
    },
  });
});
