import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD');

/** Dinheiro sempre em número com 2 casas. Rejeita negativo e zero. */
const money = z.coerce.number().positive('Valor deve ser maior que zero').multipleOf(0.01);

export const createTransactionSchema = z
  .object({
    type: z.enum(['receita', 'despesa']),
    description: z.string().trim().min(2).max(200),
    amount: money,
    due_date: isoDate,
    competence_date: isoDate.optional(),

    category_id: z.string().uuid().optional(),
    entity_id: z.string().uuid().optional(),
    cost_center_id: z.string().uuid().optional(),
    bank_account_id: z.string().uuid().optional(),

    installments: z.coerce.number().int().min(1).max(120).default(1),
    frequency: z
      .enum(['diaria', 'semanal', 'quinzenal', 'mensal', 'bimestral', 'trimestral', 'semestral', 'anual'])
      .default('mensal'),
    /** 'total' divide o valor entre as parcelas; 'parcela' repete o valor. */
    amount_mode: z.enum(['total', 'parcela']).default('total'),
    /** 'origem' concentra a competência no mês do fato; 'parcela' distribui. */
    competence_mode: z.enum(['origem', 'parcela']).default('parcela'),

    document_number: z.string().trim().max(60).optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .refine(
    (v) => v.installments === 1 || v.amount_mode !== 'total' || v.amount >= v.installments * 0.01,
    { message: 'Valor total insuficiente para o número de parcelas', path: ['amount'] },
  );

export const listTransactionsSchema = z.object({
  type: z.enum(['receita', 'despesa']).optional(),
  status: z.enum(['pendente', 'liquidado', 'cancelado']).optional(),
  situacao: z.enum(['atrasado', 'vence_hoje', 'vence_semana', 'a_vencer', 'liquidado']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  category_id: z.string().uuid().optional(),
  entity_id: z.string().uuid().optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),
  order_by: z.enum(['due_date', 'amount', 'competence_date']).default('due_date'),
  order_dir: z.enum(['asc', 'desc']).default('asc'),
});

export const settleSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'Selecione ao menos um título').max(500),
  paid_date: isoDate.optional(),
  bank_account_id: z.string().uuid().optional(),
  paid_amount: money.optional(),
});

export const unsettleSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
});

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;
export type ListTransactionsQuery = z.infer<typeof listTransactionsSchema>;
export type SettleInput = z.infer<typeof settleSchema>;
