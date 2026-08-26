/**
 * CRM — leads e funil.
 *
 * O portão do recurso está no router inteiro, e também nas policies do
 * banco. Parece redundante e não é: a policy protege o PostgREST, que o
 * front acessa direto para leituras; o middleware protege estas rotas.
 * Tirar qualquer um dos dois deixa uma porta.
 *
 * ---------------------------------------------------------------------
 * O QUE ESTE MÓDULO NÃO FAZ
 * ---------------------------------------------------------------------
 * Não tem tarefa, não tem agenda, não tem e-mail em sequência, não tem
 * campo personalizado. Cada uma dessas coisas é razoável isolada, e
 * juntas transformariam isto no CRM genérico que já existe em dez
 * concorrentes maduros.
 *
 * O que justifica este CRM existir é uma coisa só: ele alimenta o
 * diagnóstico. Todo campo aqui responde a uma pergunta que a régua faz.
 */

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireTenant, requireRole } from '../../middlewares/auth.js';
import { requireRecurso } from '../../middlewares/recurso.js';
import { validate } from '../../middlewares/validate.js';
import { fromPostgrest, badRequest, notFound } from '../../lib/errors.js';

export const crmRouter = Router();

crmRouter.use(requireAuth, requireTenant, requireRecurso('crm'));

const ESCREVE = requireRole('owner', 'admin', 'member');

/* eslint-disable @typescript-eslint/no-explicit-any */
const semTipos = (req: { supabase: unknown }) =>
  req.supabase as unknown as {
    from: (t: string) => any;
    rpc: (fn: string, args?: Record<string, unknown>) => any;
  };
/* eslint-enable @typescript-eslint/no-explicit-any */

const ETAPAS = ['novo', 'contato', 'qualificado', 'proposta', 'ganho', 'perdido'] as const;
const ORIGENS = ['anuncio', 'indicacao', 'organico', 'prospeccao', 'recorrente', 'outro'] as const;

/** O quadro inteiro: leads, etapas com rótulo e o resumo de 90 dias. */
crmRouter.get('/funil', async (req, res, next) => {
  try {
    const db = semTipos(req);

    const [leads, etapas, resumo] = await Promise.all([
      db
        .from('vw_funil_leads')
        .select('*')
        .eq('tenant_id', req.tenantId!)
        // Dentro da coluna, quem está parado há mais tempo primeiro. É a
        // ordem que faz a tela cobrar ação em vez de só listar.
        .order('dias_na_etapa', { ascending: false }),
      db
        .from('vw_funil_etapas')
        .select('*')
        .eq('tenant_id', req.tenantId!)
        .order('ordem'),
      db.rpc('fn_resumo_funil', { p_tenant_id: req.tenantId! }),
    ]);

    const falha = [leads, etapas, resumo].find((r) => r.error);
    if (falha?.error) throw fromPostgrest(falha.error);

    res.json({
      data: {
        leads: leads.data ?? [],
        etapas: etapas.data ?? [],
        resumo: resumo.data ?? null,
      },
    });
  } catch (e) {
    next(e);
  }
});

const leadSchema = z.object({
  nome: z.string().trim().min(2).max(160),
  telefone: z
    .string()
    .transform((v) => v.replace(/\D/g, ''))
    .refine((v) => v === '' || /^[0-9]{10,13}$/.test(v), 'Telefone inválido')
    .optional(),
  email: z.string().email().optional().or(z.literal('')),
  etapa: z.enum(ETAPAS).default('novo'),
  valor_estimado: z.number().min(0).nullable().optional(),
  origem: z.enum(ORIGENS).default('outro'),
  origem_detalhe: z.string().trim().max(160).nullable().optional(),
  utm_source: z.string().trim().max(120).nullable().optional(),
  utm_medium: z.string().trim().max(120).nullable().optional(),
  utm_campaign: z.string().trim().max(160).nullable().optional(),
  utm_content: z.string().trim().max(160).nullable().optional(),
  responsavel_nome: z.string().trim().max(120).nullable().optional(),
  observacao: z.string().trim().max(2000).nullable().optional(),
});

/**
 * Cadastra um lead.
 *
 * O cadastro mínimo é nome mais um meio de contato — a restrição
 * `lead_tem_contato` no banco exige isso. Não é burocracia: lead sem
 * telefone nem e-mail não pode ser trabalhado, e existe só para inflar
 * o topo do funil.
 */
crmRouter.post('/leads', ESCREVE, validate(leadSchema), async (req, res, next) => {
  try {
    const db = semTipos(req);
    const body = req.body as z.infer<typeof leadSchema>;

    if (!body.telefone && !body.email) {
      throw badRequest('Informe telefone ou e-mail — sem contato o lead não é trabalhável.');
    }

    const { data, error } = await db
      .from('leads')
      .insert({
        ...body,
        telefone: body.telefone || null,
        email: body.email || null,
        tenant_id: req.tenantId!,
      })
      .select()
      .single();

    if (error) throw fromPostgrest(error);
    res.status(201).json({ data });
  } catch (e) {
    next(e);
  }
});

const editarSchema = leadSchema.partial().extend({
  motivo_perda: z.string().trim().max(500).nullable().optional(),
  entity_id: z.string().uuid().nullable().optional(),
});

crmRouter.patch('/leads/:id', ESCREVE, validate(editarSchema), async (req, res, next) => {
  try {
    const db = semTipos(req);
    const id = req.params.id;
    if (!id) throw notFound('Lead não encontrado');

    const { data, error } = await db
      .from('leads')
      .update(req.body)
      .eq('id', id)
      .eq('tenant_id', req.tenantId!)
      .select()
      .maybeSingle();

    if (error) throw fromPostgrest(error);
    if (!data) throw notFound('Lead não encontrado');

    res.json({ data });
  } catch (e) {
    next(e);
  }
});

const moverSchema = z.object({
  etapa: z.enum(ETAPAS),
  motivo_perda: z.string().trim().max(500).optional(),
  /**
   * Ao ganhar, vincula o lead a um cliente do financeiro. Sem isso o
   * ticket realizado nunca aparece — fica só a estimativa de quem
   * cadastrou, e a comparação entre o que se esperava e o que se
   * faturou, que é um dos diagnósticos mais úteis, deixa de existir.
   */
  entity_id: z.string().uuid().nullable().optional(),
  /** Cria a entidade na hora, com este nome, e vincula. */
  criar_entidade: z.string().trim().min(2).max(160).optional(),
});

/** Move o lead de etapa. O histórico é gravado por trigger. */
crmRouter.post('/leads/:id/mover', ESCREVE, validate(moverSchema), async (req, res, next) => {
  try {
    const db = semTipos(req);
    const id = req.params.id;
    if (!id) throw notFound('Lead não encontrado');

    const body = req.body as z.infer<typeof moverSchema>;

    if (body.etapa === 'perdido' && !body.motivo_perda) {
      // Exigido de propósito. "Perdemos" sem motivo é a informação que
      // some primeiro e faz mais falta depois: sem ela não há como
      // saber se o problema é preço, prazo ou concorrente.
      throw badRequest('Informe o motivo da perda.');
    }

    let entityId = body.entity_id ?? null;

    if (body.etapa === 'ganho' && body.criar_entidade && !entityId) {
      const { data: nova, error: errE } = await db
        .from('entities')
        .insert({ tenant_id: req.tenantId!, name: body.criar_entidade, kind: 'cliente' })
        .select('id')
        .single();
      if (errE) throw fromPostgrest(errE);
      entityId = nova.id;
    }

    const { data, error } = await db
      .from('leads')
      .update({
        etapa: body.etapa,
        motivo_perda: body.etapa === 'perdido' ? body.motivo_perda : null,
        ...(entityId !== null ? { entity_id: entityId } : {}),
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId!)
      .select()
      .maybeSingle();

    if (error) throw fromPostgrest(error);
    if (!data) throw notFound('Lead não encontrado');

    res.json({ data });
  } catch (e) {
    next(e);
  }
});

crmRouter.delete('/leads/:id', ESCREVE, async (req, res, next) => {
  try {
    const db = semTipos(req);
    const id = req.params.id;
    if (!id) throw notFound('Lead não encontrado');

    const { error } = await db
      .from('leads')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenantId!);

    if (error) throw fromPostgrest(error);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

/** Desempenho por canal e mês, e o investimento informado. */
crmRouter.get('/canais', async (req, res, next) => {
  try {
    const db = semTipos(req);

    const [canais, mensal, investimentos] = await Promise.all([
      db
        .from('vw_funil_canais')
        .select('*')
        .eq('tenant_id', req.tenantId!)
        .order('competencia', { ascending: false }),
      db
        .from('vw_funil_mensal')
        .select('*')
        .eq('tenant_id', req.tenantId!)
        .order('competencia', { ascending: false })
        .limit(12),
      db
        .from('investimentos_midia')
        .select('*')
        .eq('tenant_id', req.tenantId!)
        .order('competencia', { ascending: false }),
    ]);

    const falha = [canais, mensal, investimentos].find((r) => r.error);
    if (falha?.error) throw fromPostgrest(falha.error);

    res.json({
      data: {
        canais: canais.data ?? [],
        mensal: mensal.data ?? [],
        investimentos: investimentos.data ?? [],
      },
    });
  } catch (e) {
    next(e);
  }
});

const investimentoSchema = z.object({
  competencia: z.string().regex(/^\d{4}-\d{2}/, 'Use AAAA-MM'),
  canal: z.enum(['meta', 'google', 'outro']),
  valor: z.number().min(0),
});

/** Registra a verba de mídia do mês. Enquanto a API do Meta não entra. */
crmRouter.put('/investimento', ESCREVE, validate(investimentoSchema), async (req, res, next) => {
  try {
    const db = semTipos(req);
    const body = req.body as z.infer<typeof investimentoSchema>;
    const competencia = `${body.competencia.slice(0, 7)}-01`;

    const { data, error } = await db
      .from('investimentos_midia')
      .upsert(
        {
          tenant_id: req.tenantId!,
          competencia,
          canal: body.canal,
          valor: body.valor,
          fonte: 'informado',
          atualizado_em: new Date().toISOString(),
        },
        { onConflict: 'tenant_id,competencia,canal' },
      )
      .select()
      .single();

    if (error) throw fromPostgrest(error);
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

const rotuloSchema = z.object({
  etapa: z.enum(ETAPAS),
  rotulo: z.string().trim().min(2).max(40),
});

/** Renomeia uma etapa na tela desta empresa. A etapa por trás não muda. */
crmRouter.put('/rotulos', ESCREVE, validate(rotuloSchema), async (req, res, next) => {
  try {
    const db = semTipos(req);
    const body = req.body as z.infer<typeof rotuloSchema>;

    const { data, error } = await db
      .from('rotulos_funil')
      .upsert(
        { tenant_id: req.tenantId!, etapa: body.etapa, rotulo: body.rotulo },
        { onConflict: 'tenant_id,etapa' },
      )
      .select()
      .single();

    if (error) throw fromPostgrest(error);
    res.json({ data });
  } catch (e) {
    next(e);
  }
});
