import type { Db } from '../../lib/supabase.js';
import { fromPostgrest } from '../../lib/errors.js';
import type {
  CreateTransactionInput,
  ListTransactionsQuery,
  SettleInput,
} from './transactions.schema.js';

/**
 * Cria lançamento à vista ou parcelado.
 *
 * A geração das parcelas fica na RPC fn_create_transaction, não aqui.
 * Motivo: é uma transação atômica no banco — ou nascem as 12 parcelas, ou
 * nenhuma. Se o loop estivesse no Node, uma queda no meio deixaria o título
 * pela metade, e conciliar isso depois é um pesadelo.
 */
export async function createTransaction(db: Db, tenantId: string, input: CreateTransactionInput) {
  const { data, error } = await db.rpc('fn_create_transaction', {
    p_tenant_id: tenantId,
    p_type: input.type,
    p_description: input.description,
    p_amount: input.amount,
    p_due_date: input.due_date,
    p_competence_date: input.competence_date ?? null,
    p_category_id: input.category_id ?? null,
    p_entity_id: input.entity_id ?? null,
    p_cost_center_id: input.cost_center_id ?? null,
    p_bank_account_id: input.bank_account_id ?? null,
    p_installments: input.installments,
    p_frequency: input.frequency,
    p_amount_mode: input.amount_mode,
    p_competence_mode: input.competence_mode,
    p_document_number: input.document_number ?? null,
    p_notes: input.notes ?? null,
  });

  if (error) throw fromPostgrest(error);
  return data;
}

/** Listagem paginada de Contas a Pagar/Receber sobre a view enriquecida. */
export async function listTransactions(db: Db, tenantId: string, q: ListTransactionsQuery) {
  const from = (q.page - 1) * q.per_page;
  let query = db.from('vw_transactions').select('*', { count: 'exact' }).eq('tenant_id', tenantId);

  if (q.type) query = query.eq('type', q.type);
  if (q.status) query = query.eq('status', q.status);
  if (q.situacao) query = query.eq('situacao', q.situacao);
  if (q.category_id) query = query.eq('category_id', q.category_id);
  if (q.entity_id) query = query.eq('entity_id', q.entity_id);
  if (q.from) query = query.gte('due_date', q.from);
  if (q.to) query = query.lte('due_date', q.to);
  if (q.search) query = query.ilike('description', `%${q.search}%`);

  const { data, error, count } = await query
    .order(q.order_by, { ascending: q.order_dir === 'asc' })
    .range(from, from + q.per_page - 1);

  if (error) throw fromPostgrest(error);

  // Anotação explícita enquanto database.types.ts for o stub (`any`).
  const rows: any[] = (data ?? []) as any[];
  const total = count ?? 0;

  return {
    data: rows,
    pagination: {
      page: q.page,
      per_page: q.per_page,
      total,
      total_pages: Math.ceil(total / q.per_page),
    },
    totals: {
      // Soma da página. Para o total geral, use vw_dashboard_kpis.
      amount: rows.reduce((s, r) => s + Number(r.amount ?? 0), 0),
    },
  };
}

/** Baixa em lote. A RPC ignora títulos já liquidados, então é idempotente. */
export async function settleTransactions(db: Db, input: SettleInput) {
  const { data, error } = await db.rpc('fn_settle_transactions', {
    p_ids: input.ids,
    p_paid_date: input.paid_date ?? new Date().toISOString().slice(0, 10),
    p_bank_account_id: input.bank_account_id ?? null,
    p_paid_amount: input.paid_amount ?? null,
  });

  if (error) throw fromPostgrest(error);
  return { settled: data ?? 0 };
}

export async function unsettleTransactions(db: Db, ids: string[]) {
  const { data, error } = await db.rpc('fn_unsettle_transactions', { p_ids: ids });
  if (error) throw fromPostgrest(error);
  return { reverted: data ?? 0 };
}

/** Exclui o grupo inteiro de parcelas (o ON DELETE CASCADE cuida dos filhos). */
export async function deleteTransactionGroup(db: Db, tenantId: string, id: string) {
  const { data: tx, error: e1 } = await db
    .from('transactions')
    .select('id, parent_id')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .maybeSingle();

  if (e1) throw fromPostgrest(e1);
  if (!tx) return { deleted: 0 };

  const rootId = tx.parent_id ?? tx.id;
  const { error } = await db
    .from('transactions')
    .delete()
    .or(`id.eq.${rootId},parent_id.eq.${rootId}`);

  if (error) throw fromPostgrest(error);
  return { deleted: 1 };
}
