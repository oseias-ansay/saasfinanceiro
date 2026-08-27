/**
 * CRM — leads, funil e as etapas da empresa.
 *
 * O portão do recurso está no router inteiro, e também nas policies do
 * banco. Parece redundante e não é: a policy protege o PostgREST, que o
 * front acessa direto para leituras; o middleware protege estas rotas.
 * Tirar qualquer um dos dois deixa uma porta.
 *
 * ---------------------------------------------------------------------
 * MOVER É MUDAR `etapa_id`, NÃO `etapa`
 * ---------------------------------------------------------------------
 * O lead aponta para uma etapa da EMPRESA. A etapa canônica do método é
 * derivada dela por gatilho, no banco. Nenhuma rota aqui escreve
 * `leads.etapa` diretamente — se escrevesse, o valor poderia divergir da
 * coluna em que o card está, e o diagnóstico passaria a medir uma coisa
 * enquanto a tela mostra outra.
 *
 * ---------------------------------------------------------------------
 * O QUE ESTE MÓDULO NÃO FAZ
 * ---------------------------------------------------------------------
 * Não tem tarefa, não tem agenda, não tem e-mail em sequência, não tem
 * campo personalizado. Cada uma dessas coisas é razoável isolada, e
 * juntas transformariam isto no CRM genérico que já existe em dez
 * concorrentes maduros.
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

const CANONICAS = [
  'novo',
  'contato',
  'reuniao',
  'qualificado',
  'proposta',
  'ganho',
  'perdido',
] as const;

const ORIGENS = ['anuncio', 'indicacao', 'organico', 'prospeccao', 'recorrente', 'outro'] as const;

/**
 * O quadro inteiro.
 *
 * Semeia o funil padrão antes de ler. A alternativa seria criar as
 * etapas no momento em que o CRM é contratado — mas aí um cliente
 * cadastrado por SQL, ou que teve o recurso liberado à mão, abriria a
 * tela sem coluna nenhuma e sem entender por quê.
 */
crmRouter.get('/funil', async (req, res, next) => {
  try {
    const db = semTipos(req);

    const { error: errSeed } = await db.rpc('fn_semear_funil', { p_tenant_id: req.tenantId! });
    if (errSeed) throw fromPostgrest(errSeed);

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

/* ================================================================== */
/* Etapas                                                              */
/* ================================================================== */

const etapaSchema = z.object({
  nome: z.string().trim().min(2).max(40),
  canonica: z.enum(CANONICAS),
  ordem: z.number().int().min(1).max(999).optional(),
  cor: z.string().trim().max(20).nullable().optional(),
});

/**
 * Cria uma etapa própria.
 *
 * `canonica` é obrigatória e não tem padrão de propósito: é a pergunta
 * que o cliente precisa responder — "esta etapa conta como o quê?".
 * Aceitar um padrão silencioso faria toda etapa nova cair na mesma
 * gaveta, e o diagnóstico começaria a mentir sem aviso.
 */
crmRouter.post('/etapas', ESCREVE, validate(etapaSchema), async (req, res, next) => {
  try {
    const db = semTipos(req);
    const body = req.body as z.infer<typeof etapaSchema>;

    let ordem = body.ordem;
    if (!ordem) {
      // Entra antes das terminais: etapa nova é passo do meio até prova
      // em contrário, e nascer depois de "Fechado" a deixaria invisível
      // no fim do quadro.
      const { data: ultimas } = await db
        .from('vw_funil_etapas')
        .select('ordem, terminal')
        .eq('tenant_id', req.tenantId!)
        .order('ordem');

      const naoTerminais = (ultimas ?? []).filter((e: { terminal: boolean }) => !e.terminal);
      ordem = naoTerminais.length
        ? Math.max(...naoTerminais.map((e: { ordem: number }) => e.ordem)) + 5
        : 10;
    }

    const { data, error } = await db
      .from('funil_etapas')
      .insert({
        tenant_id: req.tenantId!,
        nome: body.nome,
        canonica: body.canonica,
        ordem,
        cor: body.cor ?? null,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') throw badRequest('Já existe uma etapa com esse nome.');
      throw fromPostgrest(error);
    }

    res.status(201).json({ data });
  } catch (e) {
    next(e);
  }
});

const editarEtapaSchema = etapaSchema.partial().extend({
  ativa: z.boolean().optional(),
});

crmRouter.patch('/etapas/:id', ESCREVE, validate(editarEtapaSchema), async (req, res, next) => {
  try {
    const db = semTipos(req);
    const id = req.params.id;
    if (!id) throw notFound('Etapa não encontrada');

    const { data, error } = await db
      .from('funil_etapas')
      .update(req.body)
      .eq('id', id)
      .eq('tenant_id', req.tenantId!)
      .select()
      .maybeSingle();

    if (error) {
      // O gatilho `tg_funil_tem_saida` protege o funil de ficar sem
      // fechamento ou sem perda. A mensagem dele já é legível.
      if (error.code === 'P0001') throw badRequest(error.message);
      throw fromPostgrest(error);
    }
    if (!data) throw notFound('Etapa não encontrada');

    res.json({ data });
  } catch (e) {
    next(e);
  }
});

/**
 * Apaga uma etapa.
 *
 * Recusa se houver lead nela. `on delete restrict` no banco já barraria,
 * mas com uma mensagem de chave estrangeira que ninguém entende — e o
 * caminho certo é o cliente mover os leads antes, decidindo para onde,
 * em vez de o sistema escolher por ele.
 */
crmRouter.delete('/etapas/:id', ESCREVE, async (req, res, next) => {
  try {
    const db = semTipos(req);
    const id = req.params.id;
    if (!id) throw notFound('Etapa não encontrada');

    const { count, error: errC } = await db
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('etapa_id', id);
    if (errC) throw fromPostgrest(errC);

    if ((count ?? 0) > 0) {
      throw badRequest(
        `Esta etapa tem ${count} lead(s). Mova-os para outra coluna antes de apagá-la.`,
      );
    }

    const { error } = await db
      .from('funil_etapas')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenantId!);

    if (error) {
      if (error.code === 'P0001') throw badRequest(error.message);
      throw fromPostgrest(error);
    }
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

const ordenarSchema = z.object({
  /** Ids na ordem desejada, da esquerda para a direita. */
  ids: z.array(z.string().uuid()).min(1).max(30),
});

/** Reordena as colunas. Regrava `ordem` em múltiplos de dez. */
crmRouter.put('/etapas/ordem', ESCREVE, validate(ordenarSchema), async (req, res, next) => {
  try {
    const db = semTipos(req);
    const { ids } = req.body as z.infer<typeof ordenarSchema>;

    // Múltiplos de dez deixam espaço para inserir entre duas colunas sem
    // reescrever a lista inteira.
    for (const [i, id] of ids.entries()) {
      const { error } = await db
        .from('funil_etapas')
        .update({ ordem: (i + 1) * 10 })
        .eq('id', id)
        .eq('tenant_id', req.tenantId!);
      if (error) throw fromPostgrest(error);
    }

    res.json({ data: { ordenadas: ids.length } });
  } catch (e) {
    next(e);
  }
});

/* ================================================================== */
/* Leads                                                               */
/* ================================================================== */

const leadSchema = z.object({
  nome: z.string().trim().min(2).max(160),
  telefone: z
    .string()
    .transform((v) => v.replace(/\D/g, ''))
    .refine((v) => v === '' || /^[0-9]{10,13}$/.test(v), 'Telefone inválido')
    .optional(),
  email: z.string().email().optional().or(z.literal('')),
  etapa_id: z.string().uuid().optional(),
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

crmRouter.post('/leads', ESCREVE, validate(leadSchema), async (req, res, next) => {
  try {
    const db = semTipos(req);
    const body = req.body as z.infer<typeof leadSchema>;

    if (!body.telefone && !body.email) {
      throw badRequest('Informe telefone ou e-mail — sem contato o lead não é trabalhável.');
    }

    let etapaId = body.etapa_id;
    if (!etapaId) {
      const { data: primeira, error } = await db
        .from('funil_etapas')
        .select('id')
        .eq('tenant_id', req.tenantId!)
        .eq('ativa', true)
        .order('ordem')
        .limit(1)
        .maybeSingle();
      if (error) throw fromPostgrest(error);
      if (!primeira) throw badRequest('O funil desta empresa não tem etapas.');
      etapaId = primeira.id;
    }

    const { etapa_id: _ignorado, ...resto } = body;

    const { data, error } = await db
      .from('leads')
      .insert({
        ...resto,
        etapa_id: etapaId,
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
  etapa_id: z.string().uuid(),
  motivo_perda: z.string().trim().max(500).optional(),
  entity_id: z.string().uuid().nullable().optional(),
  criar_entidade: z.string().trim().min(2).max(160).optional(),
});

/**
 * Move o lead para outra coluna.
 *
 * A exigência de motivo e a oferta de vincular cliente dependem da
 * ETAPA CANÔNICA do destino, não do nome que a empresa deu. Uma coluna
 * chamada "Arquivado" que conta como perda pede motivo do mesmo jeito —
 * senão bastaria renomear para escapar da disciplina.
 */
crmRouter.post('/leads/:id/mover', ESCREVE, validate(moverSchema), async (req, res, next) => {
  try {
    const db = semTipos(req);
    const id = req.params.id;
    if (!id) throw notFound('Lead não encontrado');

    const body = req.body as z.infer<typeof moverSchema>;

    const { data: destino, error: errE } = await db
      .from('funil_etapas')
      .select('id, nome, canonica')
      .eq('id', body.etapa_id)
      .eq('tenant_id', req.tenantId!)
      .maybeSingle();
    if (errE) throw fromPostgrest(errE);
    if (!destino) throw badRequest('Etapa não pertence a esta empresa.');

    if (destino.canonica === 'perdido' && !body.motivo_perda) {
      // Exigido de propósito. "Perdemos" sem motivo é a informação que
      // some primeiro e faz mais falta depois: sem ela não há como
      // saber se o problema é preço, prazo ou concorrente.
      throw badRequest('Informe o motivo da perda.');
    }

    let entityId = body.entity_id ?? null;

    if (destino.canonica === 'ganho' && body.criar_entidade && !entityId) {
      const { data: nova, error: errN } = await db
        .from('entities')
        .insert({ tenant_id: req.tenantId!, name: body.criar_entidade, kind: 'cliente' })
        .select('id')
        .single();
      if (errN) throw fromPostgrest(errN);
      entityId = nova.id;
    }

    const { data, error } = await db
      .from('leads')
      .update({
        etapa_id: destino.id,
        motivo_perda: destino.canonica === 'perdido' ? body.motivo_perda : null,
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

/** Detalhe do lead com o histórico de movimentações. */
crmRouter.get('/leads/:id', async (req, res, next) => {
  try {
    const db = semTipos(req);
    const id = req.params.id;
    if (!id) throw notFound('Lead não encontrado');

    const [lead, movimentos] = await Promise.all([
      db
        .from('vw_funil_leads')
        .select('*')
        .eq('id', id)
        .eq('tenant_id', req.tenantId!)
        .maybeSingle(),
      db
        .from('lead_movimentos')
        .select('de, para, em')
        .eq('lead_id', id)
        .order('em'),
    ]);

    const falha = [lead, movimentos].find((r) => r.error);
    if (falha?.error) throw fromPostgrest(falha.error);
    if (!lead.data) throw notFound('Lead não encontrado');

    res.json({ data: { lead: lead.data, movimentos: movimentos.data ?? [] } });
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

/* ================================================================== */
/* Canais e investimento                                               */
/* ================================================================== */

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

crmRouter.put('/investimento', ESCREVE, validate(investimentoSchema), async (req, res, next) => {
  try {
    const db = semTipos(req);
    const body = req.body as z.infer<typeof investimentoSchema>;

    const { data, error } = await db
      .from('investimentos_midia')
      .upsert(
        {
          tenant_id: req.tenantId!,
          competencia: `${body.competencia.slice(0, 7)}-01`,
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
