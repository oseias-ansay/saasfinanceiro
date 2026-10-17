/**
 * Cópia do lead do diagnóstico para o Triage CRM.
 *
 * =====================================================================
 * ESTE ARQUIVO VIVEU NOVE DIAS SÓ NO SERVIDOR
 * =====================================================================
 * Escrito direto em produção em 08/10/2026 e nunca commitado. Trazido ao
 * repositório em 17/10/2026, depois de descobrir que ele era a causa de
 * todo `git pull` no VPS abortar em silêncio — o `env.ts` tinha sido
 * editado junto, e o merge não passava.
 *
 * O sintoma não apontava para cá: aparecia como 404 numa rota nova que
 * existia no repositório. Nove dias de deploy que não chegavam.
 *
 * O comportamento abaixo é o que estava rodando, preservado. O que mudou
 * foi só o necessário para existir teste: o `env` entra por importação
 * tardia e o `fetch` é injetável.
 *
 * ---------------------------------------------------------------------
 * NUNCA LANÇA, E ISSO É A REGRA CENTRAL
 * ---------------------------------------------------------------------
 * Chamado DEPOIS da resposta ao site. O CRM fora do ar não pode derrubar
 * nem atrasar o diagnóstico: do outro lado quem espera é um prospect, e
 * lead perdido não volta. Falha vira log e silêncio.
 *
 * ---------------------------------------------------------------------
 * O ENDEREÇO É O INTERNO DO DOCKER
 * ---------------------------------------------------------------------
 * Contêiner chamando o domínio público do próprio host não completa a
 * volta. `CRM_FORMS_URL` tem que ser o nome do serviço na rede do
 * Docker, não `https://...businesstriage.com.br`.
 *
 * Vazio desliga a integração — é o padrão, e é o que faz este módulo ser
 * inerte em desenvolvimento.
 */

/**
 * Nada é importado no topo, de propósito.
 *
 * `config/env.js` e `lib/logger.js` validam o ambiente na carga do
 * módulo — e isso obrigaria o teste de `corpoParaCrm`, que é pura, a ter
 * `SUPABASE_SERVICE_ROLE_KEY` configurada para rodar. A suíte quebrou
 * exatamente assim quando eu trouxe este arquivo para o repositório.
 *
 * Os dois entram por `await import()` dentro de `enviarAoCrm`, que é a
 * única função aqui que fala com o mundo. Mesma regra do
 * `boletoVisao.ts`, registrada no CLAUDE.md.
 */

export interface LeadParaCrm {
  tipo: 'financeiro' | 'comercial';
  protocolo: string;
  score: number;
  nivel: string;
  identificacao: Record<string, unknown>;
  blocos: Record<string, unknown>;
  ip?: string;
}

/**
 * O corpo que o CRM recebe.
 *
 * Função separada porque este formato é um CONTRATO com o outro sistema:
 * mexer num nome de campo aqui quebra a recepção lá, sem erro visível
 * deste lado — a resposta continuaria 200 se o CRM for tolerante, ou
 * viraria um aviso no log que ninguém lê. Há teste fixando a forma.
 *
 * Os blocos do formulário são espalhados na raiz, e não aninhados, porque
 * é assim que o CRM espera recebê-los.
 */
export function corpoParaCrm(l: LeadParaCrm): Record<string, unknown> {
  return {
    protocolo: l.protocolo,
    meta: { formulario: `diagnostico-${l.tipo}`, origem: 'site' },
    identificacao: l.identificacao,
    resultado: { score_total: l.score, nivel: l.nivel },
    ...l.blocos,
  };
}

export async function enviarAoCrm(
  l: LeadParaCrm,
  deps: { fetch?: typeof fetch } = {},
): Promise<void> {
  const { env } = await import('../../config/env.js');
  if (!env.CRM_FORMS_URL) return;

  const { logger } = await import('../../lib/logger.js');

  const buscar = deps.fetch ?? fetch;

  try {
    const resp = await buscar(env.CRM_FORMS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(l.ip ? { 'X-Forwarded-For': l.ip } : {}),
      },
      body: JSON.stringify(corpoParaCrm(l)),
      // Cinco segundos. O diagnóstico já foi respondido, mas deixar a
      // chamada pendurada segura o processo sem benefício nenhum.
      signal: AbortSignal.timeout(5000),
    });

    if (!resp.ok) {
      throw new Error(
        `HTTP ${resp.status} ${await resp.text().catch(() => '')}`.trim(),
      );
    }

    logger.info({ protocolo: l.protocolo, tipo: l.tipo }, 'Lead enviado ao CRM');
  } catch (e) {
    logger.warn(
      {
        protocolo: l.protocolo,
        tipo: l.tipo,
        erro: e instanceof Error ? e.message : String(e),
      },
      'Falha ao enviar lead ao CRM (diagnóstico não afetado)',
    );
  }
}
