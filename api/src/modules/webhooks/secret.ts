//
// Guarda compartilhada pelos webhooks do n8n.
//
// Vive em arquivo próprio porque mais de um módulo precisa dela e
// duplicar comparação de segredo é o tipo de código que diverge sem
// ninguém perceber.

import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../../config/env.js';
import { unauthorized } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

/** Comparação em tempo constante: evita descobrir o segredo por timing. */
export function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function requireWebhookSecret(req: Request, _res: Response, next: NextFunction) {
  const provided = req.header('x-n8n-secret') ?? '';
  if (!safeEqual(provided, env.N8N_WEBHOOK_SECRET)) {
    logger.warn({ ip: req.ip, path: req.path }, 'Webhook com segredo inválido');
    return next(unauthorized('Segredo inválido'));
  }
  next();
}
