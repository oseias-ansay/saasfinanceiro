import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';

import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorHandler, notFoundHandler } from './middlewares/error-handler.js';
import { transactionsRouter } from './modules/transactions/transactions.routes.js';
import { reportsRouter } from './modules/reports/reports.routes.js';
import { onboardingRouter } from './modules/onboarding/onboarding.routes.js';
import { adminRouter } from './modules/admin/admin.routes.js';
import { n8nRouter } from './modules/webhooks/n8n.routes.js';

export function createApp() {
  const app = express();

  // Atrás do Nginx/Traefik: necessário para req.ip e rate limit corretos.
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(pinoHttp({ logger }));

  app.use(
    cors({
      origin: env.CORS_ORIGINS.length ? env.CORS_ORIGINS : false,
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Id'],
    }),
  );

  // Limite global. O /webhooks tem o seu próprio, mais restrito.
  app.use(
    '/api',
    rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false }),
  );

  app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

  app.use('/api/v1', onboardingRouter);
  app.use('/api/v1/admin', adminRouter);
  app.use('/api/v1/transactions', transactionsRouter);
  app.use('/api/v1/reports', reportsRouter);
  app.use('/api/v1/webhooks/n8n', n8nRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
