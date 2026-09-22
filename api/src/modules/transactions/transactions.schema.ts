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

    /**
     * Já nasce liquidado.
     *
     * Venda no débito, compra no Pix, conta paga no balcão: o dinheiro já se
     * moveu quando o usuário abre a tela. Obrigá-lo a lançar e depois voltar
     * para dar baixa é um passo a mais em que ele esquece — e o título fica
     * "em aberto" para sempre, inflando o contas a pagar sem estar devendo.
     */
    paid: z.boolean().default(false),
    /** Sem informar, usa a data do lançamento (competência) ou o vencimento. */
    paid_date: isoDate.optional(),
  })
  .refine(
    (v) => v.installments === 1 || v.amount_mode !== 'total' || v.amount >= v.installments * 0.01,
    { message: 'Valor total insuficiente para o número de parcelas', path: ['amount'] },
  )
  // Parcelado nasce em aberto: marcar doze parcelas futuras como pagas no
  // mesmo dia seria mentir para o fluxo de caixa. Baixa-se parcela a parcela.
  .refine((v) => !v.paid || v.installments === 1, {
    message: 'Lançamento parcelado nasce em aberto; dê baixa em cada parcela ao pagar',
    path: ['paid'],
  });

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

/**
 * Exclusão em lote.
 *
 * Existe porque apagar um a um não é só lento: quem está limpando uma
 * base inteira desiste no meio e fica com metade dos lançamentos, o que
 * é pior do que não ter começado — o DRE e o extrato passam a mostrar um
 * pedaço do histórico sem que ninguém perceba por quê.
 */
export const deleteManySchema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'Selecione ao menos um lançamento').max(500),
});

/**
 * Edição de um título já existente.
 *
 * Não permite alterar `type` nem o parcelamento: mudar uma despesa para
 * receita, ou o número de parcelas, desmonta a coerência do grupo. Para isso,
 * o caminho é excluir e lançar de novo — operação explícita, não um efeito
 * colateral de editar um campo.
 */
export const updateTransactionSchema = z
  .object({
    description: z.string().trim().min(2).max(200).optional(),
    amount: money.optional(),
    due_date: isoDate.optional(),
    competence_date: isoDate.optional(),
    category_id: z.string().uuid().nullable().optional(),
    entity_id: z.string().uuid().nullable().optional(),
    cost_center_id: z.string().uuid().nullable().optional(),
    bank_account_id: z.string().uuid().nullable().optional(),
    document_number: z.string().trim().max(60).nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nada para atualizar' });

export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;
export type ListTransactionsQuery = z.infer<typeof listTransactionsSchema>;
export type SettleInput = z.infer<typeof settleSchema>;
