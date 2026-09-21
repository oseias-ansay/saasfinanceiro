/**
 * Portão de recurso.
 *
 * O front esconde o menu; isto recusa a requisição. A diferença importa:
 * esconder evita frustração, recusar evita acesso. Quem alterar o
 * JavaScript para exibir a tela do CRM chega aqui e leva 403.
 *
 * A consulta usa `fn_tenant_tem_recurso`, a mesma função que a view do
 * front lê. Um lugar só define o que cada empresa acessa — se a regra
 * morasse aqui E no banco, um dia elas discordariam, e o sintoma seria
 * um cliente vendo um menu que não abre.
 */

import type { NextFunction, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { AppError, fromPostgrest } from '../lib/errors.js';

export type Recurso =
  | 'financeiro'
  | 'diagnostico_manual'
  | 'diagnostico_mensal'
  | 'pdca_financeiro'
  | 'pdca_comercial'
  | 'crm';

/** Frase que o cliente lê. Diz o que falta, não o que ele fez de errado. */
const EXPLICACAO: Record<Recurso, string> = {
  financeiro: 'o Controle Financeiro',
  diagnostico_manual: 'o diagnóstico avulso',
  diagnostico_mensal: 'o diagnóstico mensal e a curva de evolução',
  pdca_financeiro: 'o plano de ação financeiro',
  pdca_comercial: 'o plano de ação comercial',
  crm: 'o CRM',
};

/**
 * Pergunta se a empresa tem o recurso, sem recusar a requisição.
 *
 * Existe para a rota que serve DOIS públicos. O fechamento mensal é o
 * caso: os cinco números operacionais valem para qualquer empresa com o
 * financeiro, e os campos de passivo e comportamento só existem por
 * causa do diagnóstico. Um portão no router inteiro deixaria o cliente
 * sem diagnóstico sem conseguir informar o próprio estoque — e as
 * calculadoras que dependem dele passariam a mentir em silêncio.
 */
export async function temRecurso(tenantId: string, recurso: Recurso): Promise<boolean> {
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const db = supabaseAdmin as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<any>;
  };

  const { data, error } = await db.rpc('fn_tenant_tem_recurso', {
    p_tenant_id: tenantId,
    p_recurso: recurso,
  });

  if (error) throw fromPostgrest(error);
  return data === true;
}

/**
 * Exige um recurso na empresa ativa.
 *
 * Precisa vir depois de `requireTenant` — sem empresa resolvida não há o
 * que perguntar. Usa `supabaseAdmin` de propósito: a função é
 * `security definer` e a resposta não depende de quem pergunta, só de
 * qual empresa. Passar pelo client do usuário só somaria uma chance de
 * o RLS esconder a linha e a resposta virar "não tem" por engano.
 */
export function requireRecurso(recurso: Recurso) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.tenantId) {
        throw new AppError(400, 'Nenhuma empresa selecionada', 'sem_tenant');
      }

      // `fn_tenant_tem_recurso` ainda não está no database.types.ts gerado.
      // O apelido concentra a falta de tipo aqui, em vez de espalhar
      // `as never` — que silenciaria o compilador sem verificar nada.
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      const db = supabaseAdmin as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<any>;
      };

      const { data, error } = await db.rpc('fn_tenant_tem_recurso', {
        p_tenant_id: req.tenantId,
        p_recurso: recurso,
      });

      if (error) throw fromPostgrest(error);

      if (data !== true) {
        throw new AppError(
          403,
          `O plano desta empresa não inclui ${EXPLICACAO[recurso]}. ` +
            'Fale com seu consultor para liberar.',
          'recurso_indisponivel',
          { recurso },
        );
      }

      next();
    } catch (e) {
      next(e);
    }
  };
}
