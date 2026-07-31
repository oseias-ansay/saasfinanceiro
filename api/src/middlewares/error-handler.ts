import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { isProd } from '../config/env.js';

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { code: 'not_found', message: 'Rota não encontrada' } });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    if (err.status >= 500) logger.error({ err, path: req.path }, err.message);
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
  }

  if (err instanceof ZodError) {
    return res.status(422).json({
      error: {
        code: 'validation_error',
        message: 'Dados inválidos',
        details: err.flatten().fieldErrors,
      },
    });
  }

  logger.error({ err, path: req.path, tenantId: req.tenantId }, 'Erro não tratado');
  res.status(500).json({
    error: {
      code: 'internal_error',
      message: 'Erro interno. Tente novamente.',
      // Em produção nunca devolva o stack para o cliente.
      details: isProd ? undefined : String(err),
    },
  });
}
