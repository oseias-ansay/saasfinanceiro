import pino from 'pino';
import { env, isProd } from '../config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  transport: isProd ? undefined : { target: 'pino-pretty', options: { colorize: true } },
  // Nunca logar credenciais nem payload financeiro completo.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-n8n-secret"]',
      '*.service_role_key',
    ],
    censor: '[REDACTED]',
  },
});
