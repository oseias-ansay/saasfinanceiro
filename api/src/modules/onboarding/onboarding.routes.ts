import { Router } from 'express';
import { randomBytes } from 'node:crypto';
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
  /** 'pessoa_fisica' recebe categorias de vida pessoal, não plano de contas. */
  kind: z.enum(['empresa', 'pessoa_fisica']).default('empresa'),
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
        kind: body.kind,
        created_by: req.user!.id,
      })
      .select()
      .single();

    if (error) throw fromPostgrest(error);

    let categories = 0;
    if (body.seed_categories) {
      // Vida pessoal e empresa têm estruturas de categoria diferentes.
      const rpc =
        body.kind === 'pessoa_fisica'
          ? 'fn_seed_categorias_pessoais'
          : 'fn_seed_default_categories';

      const { data, error: seedErr } = await req.supabase.rpc(rpc, { p_tenant_id: tenant.id });
      if (seedErr) throw fromPostgrest(seedErr);
      categories = data ?? 0;

      await req.supabase.from('bank_accounts').insert({
        tenant_id: tenant.id,
        name: body.kind === 'pessoa_fisica' ? 'Conta corrente' : 'Caixa',
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

const membroSchema = z.object({
  email: z.string().email().transform((v) => v.trim().toLowerCase()),
  role: z.enum(['admin', 'member', 'viewer']).default('member'),
  /**
   * 'senha_temporaria' cria a conta já ativa e devolve a senha uma única vez,
   * para o admin repassar. 'convite' envia e-mail pelo GoTrue — só funciona
   * com SMTP configurado no Supabase.
   */
  modo: z.enum(['senha_temporaria', 'convite']).default('senha_temporaria'),
});

/** Senha temporária legível: fácil de ditar por telefone, sem caracteres ambíguos. */
function senhaTemporaria(): string {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sem I e O
  const digitos = '23456789'; // sem 0 e 1
  const bytes = randomBytes(12);
  const letras = Array.from({ length: 4 }, (_, i) => alfabeto[bytes[i]! % alfabeto.length]).join('');
  const nums = Array.from({ length: 4 }, (_, i) => digitos[bytes[i + 4]! % digitos.length]).join('');
  return `BT-${letras}-${nums}`;
}

/**
 * Adiciona um usuário à empresa.
 *
 * Único lugar da API de usuário que precisa de service_role: criar conta em
 * auth.users é operação administrativa do GoTrue. O vínculo em si é gravado
 * com o client do USUÁRIO, para o RLS confirmar que ele é mesmo admin da
 * empresa — a API não decide isso sozinha.
 */
onboardingRouter.post(
  '/tenants/:tenantId/members',
  requireAuth,
  requireTenant,
  requireRole('owner', 'admin'),
  validate(membroSchema),
  async (req, res, next) => {
    try {
      const { email, role, modo } = req.body as z.infer<typeof membroSchema>;
      if (req.params.tenantId !== req.tenantId) throw badRequest('Empresa divergente do header');

      // 1. O usuário já existe na plataforma?
      const { data: perfil } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('email', email)
        .maybeSingle();

      let userId: string | undefined = perfil?.id;
      let senha: string | undefined;
      let criado = false;

      // 2. Não existe: cria a conta.
      if (!userId) {
        if (modo === 'convite') {
          const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email);
          if (error) {
            throw badRequest(
              `Não foi possível enviar o convite: ${error.message}. ` +
                'Se o Supabase não tem SMTP configurado, use o modo "senha temporária".',
            );
          }
          userId = data.user.id;
        } else {
          senha = senhaTemporaria();
          const { data, error } = await supabaseAdmin.auth.admin.createUser({
            email,
            password: senha,
            email_confirm: true, // sem SMTP não há como o usuário confirmar sozinho
            // Provisória: o front obriga a troca antes de liberar o painel.
            user_metadata: { senha_provisoria: true },
          });
          if (error) throw badRequest(`Não foi possível criar o acesso: ${error.message}`);
          userId = data.user.id;
        }

        criado = true;

        // Espelha o perfil: o trigger cobre cadastros novos, mas garantir aqui
        // evita depender da ordem de execução.
        await supabaseAdmin.from('profiles').upsert({ id: userId, email });
      }

      // 3. Vincula à empresa — com o client do usuário, sujeito ao RLS.
      const { error } = await req.supabase.from('memberships').upsert(
        {
          tenant_id: req.tenantId!,
          user_id: userId!,
          role,
          is_active: true,
          invited_by: req.user!.id,
        },
        { onConflict: 'tenant_id,user_id' },
      );
      if (error) throw fromPostgrest(error);

      res.status(201).json({
        data: {
          email,
          role,
          usuario_criado: criado,
          // Devolvida UMA vez. Não fica gravada em lugar nenhum além do hash.
          senha_temporaria: senha ?? null,
        },
      });
    } catch (e) {
      next(e);
    }
  },
);
