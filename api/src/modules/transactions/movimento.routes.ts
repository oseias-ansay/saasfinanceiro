/**
 * O movimento do dia.
 *
 * =====================================================================
 * SALVAR SUBSTITUI, NÃO ACRESCENTA
 * =====================================================================
 * O cliente fecha o caixa, lança, e meia hora depois percebe que esqueceu
 * uma despesa. Ele vai abrir o mesmo dia e salvar de novo — e a única
 * coisa que ele NÃO espera é o faturamento do dia dobrar.
 *
 * Então: existe um registro por empresa por data, e salvar apaga os
 * lançamentos daquele movimento antes de recriar. O `on delete cascade`
 * do SQL 61 faz o trabalho.
 *
 * Lançamento manual tem `movimento_id` nulo e fica fora disso. Quem
 * cadastrou à mão não quer aquilo apagado porque alguém reenviou o dia.
 *
 * =====================================================================
 * O QUE ACONTECE SE A GRAVAÇÃO FALHAR NO MEIO
 * =====================================================================
 * Não há transação aqui: o PostgREST não oferece uma, e a sequência é
 * apagar os antigos e inserir os novos. Se a inserção falhar depois do
 * apagamento, o dia fica VAZIO.
 *
 * É ruim, e é o menos ruim dos dois. A alternativa — inserir antes de
 * apagar — deixaria o dia DUPLICADO na mesma falha, e dia duplicado é
 * invisível: o cliente vê um faturamento maior e acredita. Dia vazio ele
 * percebe na hora e lança de novo.
 *
 * Se um dia isto precisar de garantia real, o caminho é uma função no
 * banco recebendo o movimento inteiro em JSON.
 */

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireTenant, requireRole } from '../../middlewares/auth.js';
import { requireRecurso } from '../../middlewares/recurso.js';
import { validate } from '../../middlewares/validate.js';
import { AppError, fromPostgrest } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import {
  gerarLancamentos,
  MovimentoInvalido,
  resumir,
  type FormaRecebimento,
} from './movimento.js';

export const movimentoRouter = Router();
movimentoRouter.use(requireAuth, requireTenant, requireRecurso('financeiro'));

const ESCREVE = requireRole('owner', 'admin', 'member');

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tabela = { from: (t: string) => any };
const db = (req: { supabase: unknown }): Tabela => req.supabase as unknown as Tabela;
/* eslint-enable @typescript-eslint/no-explicit-any */

const hojeISO = () => new Date().toISOString().slice(0, 10);

async function formasDaEmpresa(req: Parameters<typeof db>[0], tenant: string) {
  const { data, error } = await db(req)
    .from('formas_recebimento')
    .select('id, nome, prazo_dias, ordem')
    .eq('tenant_id', tenant)
    .eq('ativa', true)
    .order('ordem');

  if (error) throw fromPostgrest(error);
  return (data ?? []) as FormaRecebimento[];
}

/* ==================================================================== */
/* As formas de recebimento                                              */
/* ==================================================================== */

movimentoRouter.get('/formas', async (req, res, next) => {
  try {
    res.json({ data: await formasDaEmpresa(req, req.tenantId!) });
  } catch (e) {
    next(e);
  }
});

/**
 * Cria as formas padrão para quem não tem nenhuma.
 *
 * Existe porque a tela sem formas é um beco sem saída: ela informa que
 * não há e não oferece saída, e a empresa criada depois do SQL 61 — ou
 * que estava inativa quando ele rodou — cai nele.
 *
 * Idempotente: se já houver formas, não faz nada e devolve as que
 * existem. Clicar duas vezes não duplica.
 *
 * Os prazos são os usuais do varejo e são SUGESTÃO. A tela avisa para
 * conferir com a adquirente do cliente — errar o prazo corrompe o PMR e
 * a cobertura de caixa a partir do primeiro lançamento.
 */
movimentoRouter.post('/formas/padrao', ESCREVE, async (req, res, next) => {
  try {
    const tenant = req.tenantId!;
    const existentes = await formasDaEmpresa(req, tenant);

    if (existentes.length > 0) {
      return res.json({ data: existentes, criadas: 0 });
    }

    const padrao = [
      { nome: 'Dinheiro', prazo_dias: 0, ordem: 10 },
      { nome: 'Pix', prazo_dias: 0, ordem: 20 },
      { nome: 'Cartão de débito', prazo_dias: 1, ordem: 30 },
      { nome: 'Cartão de crédito', prazo_dias: 30, ordem: 40 },
      { nome: 'A prazo', prazo_dias: 30, ordem: 50 },
    ];

    const { error } = await db(req)
      .from('formas_recebimento')
      .insert(padrao.map((f) => ({ ...f, tenant_id: tenant })) as never);

    if (error) throw fromPostgrest(error);

    logger.info({ tenant }, 'Formas de recebimento padrão criadas');
    res.json({ data: await formasDaEmpresa(req, tenant), criadas: padrao.length });
  } catch (e) {
    next(e);
  }
});

const formaSchema = z.object({
  nome: z.string().trim().min(2).max(40),
  /**
   * O prazo é o campo que importa aqui. Ver o cabeçalho do SQL 61: ele é
   * o que separa venda de recebimento, e errá-lo corrompe o PMR e a
   * cobertura de caixa a partir do primeiro lançamento.
   */
  prazo_dias: z.number().int().min(0).max(180),
  ordem: z.number().int().min(0).max(999).optional(),
  ativa: z.boolean().optional(),
});

movimentoRouter.patch('/formas/:id', ESCREVE, validate(formaSchema.partial()), async (req, res, next) => {
  try {
    const tenant = req.tenantId!;
    const { error } = await db(req)
      .from('formas_recebimento')
      .update(req.body as never)
      .eq('id', req.params.id)
      .eq('tenant_id', tenant);

    if (error) throw fromPostgrest(error);
    res.json({ data: await formasDaEmpresa(req, tenant) });
  } catch (e) {
    next(e);
  }
});

/* ==================================================================== */
/* Um dia                                                                */
/* ==================================================================== */

const dataParam = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.');

/**
 * Carrega o movimento de uma data, para a tela abrir preenchida.
 *
 * Devolve as formas junto: a tela precisa delas mesmo quando não há
 * movimento, e duas chamadas para montar um formulário é meia tela
 * piscando.
 */
movimentoRouter.get('/:data', async (req, res, next) => {
  try {
    const tenant = req.tenantId!;
    const data = dataParam.parse(req.params.data);
    const formas = await formasDaEmpresa(req, tenant);

    const { data: mov, error } = await db(req)
      .from('movimentos_diarios')
      .select('id, data, observacao, created_at, updated_at')
      .eq('tenant_id', tenant)
      .eq('data', data)
      .maybeSingle();

    if (error) throw fromPostgrest(error);

    if (!mov) {
      return res.json({ data: { data, formas, existe: false, vendas: [], despesas: [] } });
    }

    const { data: lanc, error: e2 } = await db(req)
      .from('transactions')
      .select('type, description, amount, status, category_id, entity_id, due_date')
      .eq('movimento_id', mov.id)
      .order('type');

    if (e2) throw fromPostgrest(e2);

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const linhas = (lanc ?? []) as any[];

    // As receitas voltam para a forma pelo NOME, que é como foram
    // gravadas na descrição. Guardar o `forma_id` em cada lançamento
    // seria mais direto, mas acrescentaria uma coluna em `transactions`
    // que só este formulário usaria — e a tabela já é a mais compartilhada
    // do sistema.
    const vendas = linhas
      .filter((l) => l.type === 'receita')
      .map((l) => {
        const nome = String(l.description).replace(/^Vendas do dia — /, '');
        return { forma_id: formas.find((f) => f.nome === nome)?.id ?? null, valor: Number(l.amount) };
      })
      .filter((v) => v.forma_id);

    const despesas = linhas
      .filter((l) => l.type === 'despesa')
      .map((l) => ({
        descricao: String(l.description),
        valor: Number(l.amount),
        category_id: l.category_id ?? null,
        entity_id: l.entity_id ?? null,
        paga: l.status === 'liquidado',
      }));
    /* eslint-enable @typescript-eslint/no-explicit-any */

    res.json({
      data: {
        data,
        formas,
        existe: true,
        observacao: mov.observacao,
        atualizado_em: mov.updated_at,
        vendas,
        despesas,
      },
    });
  } catch (e) {
    next(e);
  }
});

/* ==================================================================== */
/* Salvar                                                                */
/* ==================================================================== */

const salvarSchema = z.object({
  data: dataParam,
  observacao: z.string().trim().max(500).nullish(),
  vendas: z
    .array(z.object({ forma_id: z.string().uuid(), valor: z.number().min(0).max(100_000_000) }))
    .max(20),
  despesas: z
    .array(
      z.object({
        descricao: z.string().trim().min(1).max(200),
        valor: z.number().positive().max(100_000_000),
        category_id: z.string().uuid().nullish(),
        entity_id: z.string().uuid().nullish(),
        paga: z.boolean(),
      }),
    )
    .max(50),
});

movimentoRouter.post('/', ESCREVE, validate(salvarSchema), async (req, res, next) => {
  try {
    const tenant = req.tenantId!;
    const corpo = req.body as z.infer<typeof salvarSchema>;
    const formas = await formasDaEmpresa(req, tenant);

    // A conversão acontece ANTES de qualquer escrita. Se o movimento for
    // inválido, nada foi apagado — e o cliente recebe o erro com o dia
    // anterior intacto.
    const lancamentos = gerarLancamentos(corpo, formas, hojeISO());

    const { data: mov, error: e1 } = await db(req)
      .from('movimentos_diarios')
      .upsert(
        { tenant_id: tenant, data: corpo.data, observacao: corpo.observacao ?? null } as never,
        { onConflict: 'tenant_id,data' },
      )
      .select('id')
      .single();

    if (e1) throw fromPostgrest(e1);
    const movimentoId = String(mov.id);

    const { error: e2 } = await db(req)
      .from('transactions')
      .delete()
      .eq('movimento_id', movimentoId);

    if (e2) throw fromPostgrest(e2);

    const { error: e3 } = await db(req)
      .from('transactions')
      .insert(
        lancamentos.map((l) => ({
          ...l,
          tenant_id: tenant,
          movimento_id: movimentoId,
          schedule_type: 'avista',
        })) as never,
      );

    if (e3) {
      // O dia ficou vazio. Avisa com todas as letras, porque o cliente
      // precisa lançar de novo — e porque silenciar aqui produziria um
      // mês com um buraco que ninguém explica depois.
      logger.error({ tenant, data: corpo.data, erro: e3.message }, 'Movimento diário não gravou');
      throw new AppError(
        500,
        'Não consegui gravar o movimento, e os lançamentos anteriores deste dia foram ' +
          'removidos. Confira os valores e salve de novo.',
        'movimento_nao_gravou',
      );
    }

    logger.info(
      { tenant, data: corpo.data, lancamentos: lancamentos.length },
      'Movimento diário gravado',
    );

    res.json({
      data: {
        movimento_id: movimentoId,
        lancamentos: lancamentos.length,
        resumo: resumir(corpo, formas),
      },
    });
  } catch (e) {
    if (e instanceof MovimentoInvalido) {
      return next(new AppError(400, e.message, 'movimento_invalido'));
    }
    next(e);
  }
});

/* ==================================================================== */
/* Apagar o dia                                                          */
/* ==================================================================== */

movimentoRouter.delete('/:data', ESCREVE, async (req, res, next) => {
  try {
    const tenant = req.tenantId!;
    const data = dataParam.parse(req.params.data);

    // Apaga o movimento; o cascade leva os lançamentos. Lançamento manual
    // do mesmo dia continua onde está.
    const { error } = await db(req)
      .from('movimentos_diarios')
      .delete()
      .eq('tenant_id', tenant)
      .eq('data', data);

    if (error) throw fromPostgrest(error);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
