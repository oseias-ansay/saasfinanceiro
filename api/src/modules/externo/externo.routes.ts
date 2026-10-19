/**
 * A porta para o CRM e para o Contábil.
 *
 * =====================================================================
 * O QUE ESTA ROTA É, HOJE
 * =====================================================================
 * Ela devolve o endereço do sistema externo para a empresa ativa, se a
 * empresa tiver o módulo e estiver vinculada. O cliente ainda entra lá
 * com a senha dele.
 *
 * O passo seguinte do projeto é o hand-off: esta mesma rota passa a
 * emitir um token curto e assinado, e o outro sistema cria a sessão
 * sozinho. **A tela não muda** — ela já pede o endereço aqui e abre o
 * que vier. Por isso a rota nasce assim, e não como um link fixo no
 * front: quando o token entrar, nada do lado de cá precisa mudar.
 *
 * =====================================================================
 * O PORTÃO É AQUI, NÃO NO MENU
 * =====================================================================
 * Esconder o item do menu evita frustração. `requireRecurso` evita
 * acesso — e é o que vale, porque quem alterar o JavaScript para exibir
 * o item chega aqui e leva 403.
 *
 * Mesma regra que o resto da plataforma já segue.
 */

import { Router } from 'express';
import { requireAuth, requireTenant } from '../../middlewares/auth.js';
import { requireRecurso, type Recurso } from '../../middlewares/recurso.js';
import { AppError, fromPostgrest } from '../../lib/errors.js';
import { env } from '../../config/env.js';
import {
  ehSistema,
  EnderecoInvalido,
  montarEndereco,
  RECURSO_DO_SISTEMA,
  type SistemaExterno,
} from './endereco.js';

export const externoRouter = Router();
externoRouter.use(requireAuth, requireTenant);

const DOMINIO: Record<SistemaExterno, () => string> = {
  crm: () => env.CRM_DOMINIO,
  contabil: () => env.CONTABIL_DOMINIO,
};

/**
 * O portão por sistema, resolvido na hora.
 *
 * `requireRecurso` é feito para um recurso fixo por rota; aqui o recurso
 * depende do caminho. Envolver assim mantém **uma** implementação do
 * portão — duplicar a consulta daria dois lugares decidindo acesso, e um
 * dia eles discordariam.
 */
function portao(sistema: SistemaExterno) {
  return requireRecurso(RECURSO_DO_SISTEMA[sistema] as Recurso);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tabela = { from: (t: string) => any };
const db = (req: { supabase: unknown }): Tabela => req.supabase as unknown as Tabela;
/* eslint-enable @typescript-eslint/no-explicit-any */

externoRouter.get('/:sistema', async (req, res, next) => {
  const alvo = String(req.params.sistema);

  try {
    if (!ehSistema(alvo)) {
      throw new AppError(404, 'Sistema desconhecido.', 'sistema_invalido');
    }

    /**
     * O portão roda DEPOIS de validar o nome do sistema, porque
     * `RECURSO_DO_SISTEMA[alvo]` só existe para os dois conhecidos.
     * Chamá-lo antes passaria `undefined` ao middleware.
     */
    await new Promise<void>((ok, erro) => {
      portao(alvo)(req, res, (e?: unknown) => (e ? erro(e) : ok()));
    });

    const { data, error } = await db(req)
      .from('tenants')
      .select('slug_externo')
      .eq('id', req.tenantId!)
      .maybeSingle();

    if (error) throw fromPostgrest(error);

    const endereco = montarEndereco(alvo, data?.slug_externo, DOMINIO[alvo]());

    res.json({ data: { sistema: alvo, endereco } });
  } catch (e) {
    /**
     * Empresa sem vínculo não é erro do servidor: é cadastro faltando.
     * 409 com a mensagem do módulo, que já diz o que fazer — a tela
     * mostra isso ao cliente sem precisar traduzir nada.
     */
    if (e instanceof EnderecoInvalido) {
      return next(new AppError(409, e.message, 'sem_vinculo_externo'));
    }
    next(e);
  }
});
