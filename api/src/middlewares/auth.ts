import type { NextFunction, Request, Response } from 'express';
import { supabaseAdmin, userClient, type Db } from '../lib/supabase.js';
import { forbidden, unauthorized } from '../lib/errors.js';

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email?: string };
      accessToken?: string;
      supabase: Db;          // cliente já no contexto do usuário (RLS ativo)
      tenantId?: string;
      role?: 'owner' | 'admin' | 'member' | 'viewer';
    }
  }
}

/** Valida o JWT do Supabase e injeta req.user + req.supabase. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized('Token ausente');

    const token = header.slice(7);
    // getUser valida assinatura e expiração junto ao GoTrue.
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user) throw unauthorized('Token inválido ou expirado');

    req.user = { id: data.user.id, email: data.user.email ?? undefined };
    req.accessToken = token;
    req.supabase = userClient(token);
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Resolve a empresa ativa a partir do header X-Tenant-Id e confirma o vínculo.
 * A consulta roda com o client do usuário: se ele não for membro, o RLS
 * devolve zero linhas e o acesso é negado. Dupla proteção (API + banco).
 */
export async function requireTenant(req: Request, _res: Response, next: NextFunction) {
  try {
    const tenantId = req.header('x-tenant-id');
    if (!tenantId) throw forbidden('Header X-Tenant-Id é obrigatório');

    const { data, error } = await req.supabase
      .from('memberships')
      .select('role')
      .eq('tenant_id', tenantId)
      .eq('user_id', req.user!.id)
      .eq('is_active', true)
      .maybeSingle();

    if (error || !data) throw forbidden('Você não pertence a esta empresa');

    req.tenantId = tenantId;
    req.role = data.role as NonNullable<Request['role']>;
    next();
  } catch (err) {
    next(err);
  }
}

/** Restringe a rota a determinados papéis. Ex.: requireRole('owner','admin') */
export function requireRole(...roles: Array<'owner' | 'admin' | 'member' | 'viewer'>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.role || !roles.includes(req.role)) {
      return next(forbidden('Seu perfil não permite esta ação'));
    }
    next();
  };
}
