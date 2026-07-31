import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireTenant, requireRole } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { fromPostgrest, badRequest } from '../../lib/errors.js';
import { supabaseAdmin } from '../../lib/supabase.js';

export const onboardingRouter = Router();

const createTenantSchema = z.object({
  name: z.string().trim().min(2).max(120),
  legal_name: z.string().trim().max(160).optional(),
  tax_id: z
    .string()
    .transform((v) => v.replace(/\D/g, ''))
    .refine((v) => v === '' || /^[0-9]{11,14}$/.test(v), 'CNPJ/CPF inválido')
    .optional(),
  fiscal_regime: z.string().trim().max(60).optional(),
  seed_categories: z.boolean().default(true),
});

/**
 * Cria a empresa e já entrega o plano de contas padrão.
 * Roda com o client do USUÁRIO: o trigger tenant_bootstrap_owner o torna
 * owner automaticamente, e a RPC de seed exige justamente esse papel.
 */
onboardingRouter.post('/tenants', requireAuth, validate(createTenantSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof createTenantSchema>;

    const { data: tenant, error } = await req.supabase
      .from('tenants')
      .insert({
        name: body.name,
        legal_name: body.legal_name ?? null,
        tax_id: body.tax_id || null,
        fiscal_regime: body.fiscal_regime ?? null,
        created_by: req.user!.id,
      })
      .select()
      .single();

    if (error) throw fromPostgrest(error);

    let categories = 0;
    if (body.seed_categories) {
      const { data, error: seedErr } = await req.supabase.rpc('fn_seed_default_categories', {
        p_tenant_id: tenant.id,
      });
      if (seedErr) throw fromPostgrest(seedErr);
      categories = data ?? 0;

      // Conta padrão para o fluxo de caixa ter saldo inicial.
      await req.supabase.from('bank_accounts').insert({
        tenant_id: tenant.id,
        name: 'Caixa',
        opening_balance: 0,
        is_default: true,
      });
    }

    res.status(201).json({ data: tenant, categories_created: categories });
  } catch (e) {
    next(e);
  }
});

/** Empresas do usuário logado (para o seletor de empresa no header). */
onboardingRouter.get('/tenants', requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await req.supabase
      .from('memberships')
      .select('role, tenant:tenants(id, name, tax_id, is_active)')
      .eq('user_id', req.user!.id)
      .eq('is_active', true);

    if (error) throw fromPostgrest(error);
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'member', 'viewer']).default('member'),
});

/**
 * Convida um usuário para a empresa.
 * Único lugar da API de usuário que precisa de service_role: criar contas em
 * auth.users é operação administrativa do GoTrue, indisponível para o token
 * do usuário comum. O vínculo em si é gravado com o client do usuário, para
 * o RLS validar que ele é mesmo admin daquela empresa.
 */
onboardingRouter.post(
  '/tenants/:tenantId/invites',
  requireAuth,
  requireTenant,
  requireRole('owner', 'admin'),
  validate(inviteSchema),
  async (req, res, next) => {
    try {
      const { email, role } = req.body as z.infer<typeof inviteSchema>;
      if (req.params.tenantId !== req.tenantId) throw badRequest('Empresa divergente do header');

      const { data: invited, error: inviteErr } =
        await supabaseAdmin.auth.admin.inviteUserByEmail(email);
      if (inviteErr) throw badRequest(`Falha ao convidar: ${inviteErr.message}`);

      const { error } = await req.supabase.from('memberships').insert({
        tenant_id: req.tenantId!,
        user_id: invited.user.id,
        role,
        invited_by: req.user!.id,
      });
      if (error) throw fromPostgrest(error);

      res.status(201).json({ data: { email, role } });
    } catch (e) {
      next(e);
    }
  },
);
