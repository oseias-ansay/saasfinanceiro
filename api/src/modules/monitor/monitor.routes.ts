/**
 * O vigia por HTTP.
 *
 * Serve para duas coisas: olhar a situação sem abrir o banco, e testar o
 * alarme de propósito. A segunda importa mais do que parece — alarme que
 * nunca foi disparado de propósito é alarme que ninguém sabe se funciona,
 * e a hora de descobrir não é a hora em que ele precisava ter tocado.
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireWebhookSecret } from '../webhooks/secret.js';
import { enviarFila } from '../diagnosticos/fila.js';
import { dependenciasFila } from '../diagnosticos/fila.service.js';
import { avaliar, PROCESSOS } from './monitor.js';
import { avisar, comRegistro, ultimosSucessos, verificar } from './monitor.service.js';

export const monitorRouter = Router();

monitorRouter.use(
  rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false }),
  requireWebhookSecret,
);

/** A situação agora, sem mandar nada a ninguém. */
monitorRouter.get('/situacao', async (_req, res, next) => {
  try {
    const situacoes = avaliar(new Date(), await ultimosSucessos(), PROCESSOS);
    res.json({
      data: {
        verificado_em: new Date().toISOString(),
        atrasados: situacoes.filter((s) => s.atrasado).length,
        processos: situacoes.map((s) => ({
          chave: s.processo.chave,
          nome: s.processo.nome,
          atrasado: s.atrasado,
          atraso_min: s.atrasoMin,
          ultimo_sucesso: s.ultimoSucesso?.toISOString() ?? null,
          prazo: s.prazo?.toISOString() ?? null,
          consequencia: s.processo.consequencia,
        })),
      },
    });
  } catch (e) {
    next(e);
  }
});

/** Força uma passada, inclusive o alarme se houver o que alarmar. */
monitorRouter.post('/verificar', async (_req, res, next) => {
  try {
    const r = await verificar();
    res.json({
      data: {
        atrasados: r.atrasados.map((s) => s.processo.chave),
        alarme_enviado: r.alarmeEnviado,
        pulso_enviado: r.pulsoEnviado,
      },
    });
  } catch (e) {
    next(e);
  }
});

/**
 * O SMTP responde?
 *
 * Não manda e-mail nenhum: abre a conexão, autentica e desliga. Existe
 * porque credencial errada de SMTP só se manifestaria no primeiro
 * diagnóstico de verdade, com um prospect esperando do outro lado — e o
 * erro mais provável não é a senha, é a porta: 465 fala TLS direto, 587
 * começa em claro e sobe com STARTTLS. Trocar as duas dá "connection
 * closed" sem nenhuma explicação.
 */
monitorRouter.get('/smtp', async (_req, res, next) => {
  try {
    const { conferirSmtp } = await import('../../lib/email.js');
    const r = await conferirSmtp();
    res.status(r.ok ? 200 : 503).json({ data: { ok: r.ok, erro: r.erro } });
  } catch (e) {
    next(e);
  }
});

/**
 * Dispara uma mensagem de teste pelo caminho real do alarme.
 *
 * Existe porque o caminho do alarme tem quatro pontos que podem quebrar
 * em silêncio — número, instância, rede e apikey — e nenhum deles se
 * manifesta até o dia em que era para tocar.
 */
monitorRouter.post('/teste', async (_req, res, next) => {
  try {
    const enviado = await avisar(
      '🔔 Teste do vigia da Business Triage.\n\n' +
        'Se esta mensagem chegou, o caminho do alarme está de pé.',
    );
    res.json({ data: { enviado } });
  } catch (e) {
    next(e);
  }
});

/**
 * Esvazia a fila das 8h AGORA, ignorando o relógio.
 *
 * Existe por duas razões. A primeira é poder testar o caminho inteiro sem
 * esperar amanhecer. A segunda é operacional: quando a fila fica represada
 * por uma queda, você quer soltá-la no minuto em que o conserto ficou
 * pronto, não no dia seguinte.
 *
 * Ignora a janela de propósito — quem chama esta rota já decidiu que é
 * hora. O que ela NÃO ignora é o resto: `liberar_em`, `tentativas < 3` e
 * o status `pendente` continuam valendo, porque são as regras que impedem
 * envio duplicado e as que respeitam o "segurar".
 *
 * Registra em `execucoes` como qualquer passada: um envio manual também é
 * o processo tendo rodado, e o vigia precisa contar com ele.
 */
monitorRouter.post('/fila', async (req, res, next) => {
  try {
    const limite = Number(req.query.limite ?? 50);

    const r = await comRegistro('diagnosticos.envio', async () => {
      const saida = await enviarFila(dependenciasFila, Number.isFinite(limite) ? limite : 50);
      return { ...saida, total: saida.enviados };
    });

    res.json({
      data: {
        tentados: r.falhas.length + r.enviados,
        enviados: r.enviados,
        falhas: r.falhas,
      },
    });
  } catch (e) {
    next(e);
  }
});
