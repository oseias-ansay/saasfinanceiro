//
// Rotas consumidas pelo n8n. NÃO têm usuário logado, então usam service_role
// e são protegidas por um segredo compartilhado + rate limit. Este é o único
// módulo onde supabaseAdmin é a regra, e não a exceção.

import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../../config/env.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { unauthorized, fromPostgrest } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

/** Comparação em tempo constante: evita descobrir o segredo por timing. */
function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function requireWebhookSecret(req: Request, _res: Response, next: NextFunction) {
  const provided = req.header('x-n8n-secret') ?? '';
  if (!safeEqual(provided, env.N8N_WEBHOOK_SECRET)) {
    logger.warn({ ip: req.ip, path: req.path }, 'Webhook com segredo inválido');
    return next(unauthorized('Segredo inválido'));
  }
  next();
}

export const n8nRouter = Router();

n8nRouter.use(
  rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false }),
  requireWebhookSecret,
);

/**
 * Materializa as recorrências. Idempotente por índice único no banco —
 * pode rodar de hora em hora sem duplicar nada.
 * Chamada pelo workflow "Gerar Recorrentes" (cron diário 03:00).
 */
n8nRouter.post('/generate-recurring', async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.rpc('fn_generate_recurring', {
      // Omitidos quando ausentes: a função usa o padrão (todos os tenants,
      // horizonte de cada template).
      p_tenant_id: req.body?.tenant_id as string | undefined,
      p_horizon: req.body?.horizon as string | undefined,
    });
    if (error) throw fromPostgrest(error);

    // Anotação explícita: o retorno da RPC é `any`, e sem isso o TS acusa
    // parâmetros implicitamente `any` sob noImplicitAny.
    const linhas = (data ?? []) as Array<{ template_id: string; generated: number }>;
    const total = linhas.reduce((s: number, r) => s + Number(r.generated ?? 0), 0);
    logger.info({ templates: linhas.length, total }, 'Recorrências geradas');
    res.json({
      templates_processed: linhas.length,
      transactions_created: total,
      detail: linhas,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * Títulos que vencem em N dias (negativo = já vencidos).
 * O n8n itera o retorno e dispara WhatsApp/e-mail por empresa.
 */
n8nRouter.get('/due-alerts', async (req, res, next) => {
  try {
    const days = Number(req.query.days ?? 0);
    if (!Number.isInteger(days) || Math.abs(days) > 365) {
      return res.status(422).json({ error: { code: 'validation_error', message: 'days inválido' } });
    }

    const { data, error } = await supabaseAdmin.rpc('fn_due_alerts', { p_days: days });
    if (error) throw fromPostgrest(error);

    // Agrupa por empresa: o n8n costuma enviar um resumo por tenant.
    const rows = (data ?? []) as Array<Record<string, unknown> & { tenant_id: string }>;
    const byTenant = new Map<string, unknown[]>();
    for (const row of rows) {
      const list = byTenant.get(row.tenant_id) ?? [];
      list.push(row);
      byTenant.set(row.tenant_id, list);
    }

    res.json({
      days,
      total: rows.length,
      tenants: [...byTenant.entries()].map(([tenant_id, items]) => ({ tenant_id, items })),
    });
  } catch (e) {
    next(e);
  }
});

/** Resumo diário de uma empresa (payload do alerta matinal). */
n8nRouter.get('/daily-digest/:tenantId', async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.rpc('fn_daily_digest', {
      p_tenant_id: req.params.tenantId!,
    });
    if (error) throw fromPostgrest(error);
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

/**
 * Digest de TODAS as empresas ativas, já com destinatários e números prontos.
 * Uma chamada só por execução do workflow — evita o n8n fazer N requisições.
 */
n8nRouter.get('/digest', async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.rpc('fn_digest_all');
    if (error) throw fromPostgrest(error);
    res.json({ generated_at: new Date().toISOString(), tenants: data ?? [] });
  } catch (e) {
    next(e);
  }
});

/**
 * Grava notificação in-app (sino do dashboard).
 * O n8n chama DEPOIS de enviar o e-mail, para o sino refletir o que de fato
 * saiu. A RPC tem upsert por (empresa, tipo, dia): reexecutar o workflow
 * atualiza a notificação em vez de empilhar duplicatas.
 */
n8nRouter.post('/notifications', async (req, res, next) => {
  try {
    const b = req.body ?? {};
    if (!b.tenant_id || !b.kind || !b.title) {
      return res.status(422).json({
        error: { code: 'validation_error', message: 'tenant_id, kind e title são obrigatórios' },
      });
    }

    const { data, error } = await supabaseAdmin.rpc('fn_notify', {
      p_tenant_id: b.tenant_id,
      p_kind: b.kind,
      p_title: b.title,
      p_body: b.body ?? null,
      p_severity: b.severity ?? 'info',
      p_link: b.link ?? null,
      p_meta: b.meta ?? {},
    });

    if (error) throw fromPostgrest(error);
    res.status(201).json({ id: data });
  } catch (e) {
    next(e);
  }
});
