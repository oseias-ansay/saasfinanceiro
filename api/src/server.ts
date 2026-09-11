import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { iniciarVigia, pararVigia } from './modules/monitor/monitor.agenda.js';

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info(`API financeira ouvindo na porta ${env.PORT} (${env.NODE_ENV})`);
  iniciarVigia();
});

// Encerramento limpo: espera as requisições em voo antes de morrer.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    logger.info(`${signal} recebido, encerrando...`);
    pararVigia();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}

process.on('unhandledRejection', (reason) => logger.error({ reason }, 'unhandledRejection'));
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaughtException');
  process.exit(1);
});
