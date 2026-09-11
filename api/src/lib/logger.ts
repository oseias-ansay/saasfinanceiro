import pino from 'pino';
import { env, isProd } from '../config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  transport: isProd ? undefined : { target: 'pino-pretty', options: { colorize: true } },
  // Nunca logar credenciais nem payload financeiro completo.
  //
  // A lista é por NOME de cabeçalho, então cada cabeçalho novo que
  // carregue segredo precisa entrar aqui à mão. Esquecer é fácil e o
  // efeito é silencioso: o valor vai para o log em texto puro, e log é
  // lido por muito mais gente e guardado por muito mais tempo do que o
  // `.env` — foi o que aconteceu com o `x-evolution-token`, que existiu
  // por algumas horas sem estar nesta lista.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-n8n-secret"]',
      'req.headers["x-evolution-token"]',
      'req.headers.apikey',
      '*.service_role_key',
      '*.apikey',
    ],
    censor: '[REDACTED]',
  },
});
