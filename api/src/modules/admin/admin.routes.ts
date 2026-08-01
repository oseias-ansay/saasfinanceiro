// Painel de staff da Business Triage.
//
// Escopo deliberado: administra EMPRESAS e USUÁRIOS, não dados financeiros.
// Para ver o financeiro de um cliente, o staff precisa ser adicionado como
// membro (viewer) daquela empresa — o que fica registrado em `memberships`
// e é auditável pelo próprio cliente.

import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { NextFunction, Request, Response } from 'express';
import { requireAuth } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { badRequest, forbidden, fromPostgrest } from '../../lib/errors.js';

export const adminRouter = Router();

/**
 * Confirma que o usuário é staff.
 *
 * A leitura usa o client do próprio usuário: a policy de `profiles` permite
 * ler o próprio registro, e `is_staff` só é gravável via SQL/service_role.
 * Assim ninguém se promove pela aplicação.
 */
async function requireStaff(req: Request, _res: Response, next: NextFunction) {
  try {
    const { data, error } = await req.supabase
      .from('profiles')
      .select('is_staff')
      .eq('id', req.user!.id)
      .maybeSingle();

    if (error) throw fromPostgrest(error);
    if (!data?.is_staff) throw forbidden('Área restrita à equipe Business Triage');
    next();
  } catch (e) {
    next(e);
  }
}

adminRouter.use(requireAuth, requireStaff);

function senhaTemporaria(): string {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digitos = '23456789';
  const b = randomBytes(12);
  const letras = Array.from({ length: 4 }, (_, i) => alfabeto[b[i]! % alfabeto.length]).join('');
  const nums = Array.from({ length: 4 }, (_, i) => digitos[b[i + 4]! % digitos.length]).join('');
  return `BT-${letras}-${nums}`;
}

/** Carteira de clientes. Sem valores financeiros — só uso e cadastro. */
adminRouter.get('/tenants', async (req, res, next) => {
  try {
    const { data, error } = await req.supabase
      .from('vw_staff_tenants')
      .select('*')
      .order('name');
    if (error) throw fromPostgrest(error);
    res.json({ data: data ?? [] });
  } catch (e) {
    next(e);
  }
});

const novaEmpresaSchema = z.object({
  name: z.string().trim().min(2).max(120),
  tax_id: z
    .string()
    .transform((v) => v.replace(/\D/g, ''))
    .refine((v) => v === '' || /^[0-9]{11,14}$/.test(v), 'CNPJ/CPF inválido')
    .optional(),
  /** E-mail do responsável, que vira 'owner' da empresa. */
  owner_email: z.string().email().transform((v) => v.trim().toLowerCase()),
  seed_categories: z.boolean().default(true),
});

/**
 * Cria empresa + usuário responsável + plano de contas, numa operação só.
 *
 * Usa service_role porque envolve criar conta no GoTrue e semear dados numa
 * empresa da qual o staff ainda não é membro. É a operação de onboarding do
 * cliente — o momento em que a consultoria fecha contrato.
 */
adminRouter.post('/tenants', validate(novaEmpresaSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof novaEmpresaSchema>;

    // 1. Usuário responsável
    const { data: perfil } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('email', body.owner_email)
      .maybeSingle();

    let ownerId: string | undefined = perfil?.id;
    let senha: string | undefined;

    if (!ownerId) {
      senha = senhaTemporaria();
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email: body.owner_email,
        password: senha,
        email_confirm: true,
      });
      if (error) throw badRequest(`Não foi possível criar o acesso: ${error.message}`);
      ownerId = data.user.id;
      await supabaseAdmin.from('profiles').upsert({ id: ownerId, email: body.owner_email });
    }

    // 2. Empresa — created_by aponta para o responsável, não para o staff.
    //    O trigger de bootstrap já cria a membership de owner a partir daí.
    const { data: tenant, error: errT } = await supabaseAdmin
      .from('tenants')
      .insert({ name: body.name, tax_id: body.tax_id || null, created_by: ownerId })
      .select()
      .single();
    if (errT) throw fromPostgrest(errT);

    // 3. Garante o vínculo (o trigger já deve ter criado; upsert é rede de segurança)
    await supabaseAdmin
      .from('memberships')
      .upsert(
        { tenant_id: tenant.id, user_id: ownerId, role: 'owner', is_active: true },
        { onConflict: 'tenant_id,user_id' },
      );

    // 4. Conta padrão e plano de contas
    await supabaseAdmin
      .from('bank_accounts')
      .insert({ tenant_id: tenant.id, name: 'Caixa', opening_balance: 0, is_default: true });

    let categorias = 0;
    if (body.seed_categories) {
      const { data: n } = await supabaseAdmin.rpc('fn_seed_default_categories', {
        p_tenant_id: tenant.id,
      });
      categorias = n ?? 0;
    }

    res.status(201).json({
      data: {
        tenant,
        owner_email: body.owner_email,
        categorias_criadas: categorias,
        senha_temporaria: senha ?? null,
        usuario_ja_existia: !senha,
      },
    });
  } catch (e) {
    next(e);
  }
});

const acessoSchema = z.object({
  tenant_id: z.string().uuid(),
  /** 'viewer' é o padrão: acompanhar sem poder alterar nada do cliente. */
  role: z.enum(['viewer', 'admin']).default('viewer'),
});

/**
 * Concede a si mesmo acesso a uma empresa cliente.
 *
 * Não é um atalho: é o registro explícito de que alguém da consultoria passou
 * a ver os dados daquele cliente. Fica em `memberships`, visível para o
 * próprio cliente na tela de Usuários dele.
 */
adminRouter.post('/acesso', validate(acessoSchema), async (req, res, next) => {
  try {
    const { tenant_id, role } = req.body as z.infer<typeof acessoSchema>;

    const { error } = await req.supabase.from('memberships').upsert(
      {
        tenant_id,
        user_id: req.user!.id,
        role,
        is_active: true,
        invited_by: req.user!.id,
      },
      { onConflict: 'tenant_id,user_id' },
    );
    if (error) throw fromPostgrest(error);

    res.status(201).json({ data: { tenant_id, role } });
  } catch (e) {
    next(e);
  }
});
