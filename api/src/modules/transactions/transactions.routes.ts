import { Router } from 'express';
import { requireAuth, requireTenant, requireRole } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import {
  createTransactionSchema,
  listTransactionsSchema,
  settleSchema,
  unsettleSchema,
} from './transactions.schema.js';
import * as service from './transactions.service.js';

export const transactionsRouter = Router();

// Todas as rotas exigem usuário autenticado + empresa ativa resolvida.
transactionsRouter.use(requireAuth, requireTenant);

const WRITE = requireRole('owner', 'admin', 'member');

transactionsRouter.get('/', validate(listTransactionsSchema, 'query'), async (req, res, next) => {
  try {
    res.json(await service.listTransactions(req.supabase, req.tenantId!, req.query as never));
  } catch (e) {
    next(e);
  }
});

transactionsRouter.post('/', WRITE, validate(createTransactionSchema), async (req, res, next) => {
  try {
    const rows = await service.createTransaction(req.supabase, req.tenantId!, req.body);
    res.status(201).json({
      data: rows,
      installments_created: Array.isArray(rows) ? rows.length : 1,
    });
  } catch (e) {
    next(e);
  }
});

transactionsRouter.post('/settle', WRITE, validate(settleSchema), async (req, res, next) => {
  try {
    res.json(await service.settleTransactions(req.supabase, req.body));
  } catch (e) {
    next(e);
  }
});

transactionsRouter.post('/unsettle', WRITE, validate(unsettleSchema), async (req, res, next) => {
  try {
    res.json(await service.unsettleTransactions(req.supabase, req.body.ids));
  } catch (e) {
    next(e);
  }
});

transactionsRouter.delete('/:id/group', requireRole('owner', 'admin'), async (req, res, next) => {
  try {
    res.json(await service.deleteTransactionGroup(req.supabase, req.tenantId!, req.params.id!));
  } catch (e) {
    next(e);
  }
});
