/**
 * Cliente da Evolution API — o pedaço que manda mensagem.
 *
 * ---------------------------------------------------------------------
 * POR QUE ELE NUNCA LANÇA
 * ---------------------------------------------------------------------
 * Mandar a resposta automática é a parte MENOS importante do que
 * acontece quando alguém escreve. Se a Evolution estiver fora do ar, o
 * lead ainda tem de entrar no funil e a mensagem ainda tem de ser
 * guardada — a pessoa escreveu, e esse fato não desaparece porque um
 * contêiner caiu.
 *
 * No n8n era o contrário: a falha do envio abortava a execução inteira e
 * levava junto o registro do lead. Custou dois dias e um teste que
 * parecia estar quebrado no lugar errado. Aqui a falha é um valor de
 * retorno, não uma exceção — quem chama decide o que fazer, e o que ele
 * faz é seguir em frente.
 *
 * ---------------------------------------------------------------------
 * O ENDEREÇO É INTERNO
 * ---------------------------------------------------------------------
 * `http://evolution:8080` é o nome do serviço na rede do Docker. A porta
 * pública foi fechada de propósito, e chamar o domínio público a partir
 * de um contêiner do mesmo host não funciona — foi outro dia perdido.
 */

import { env } from '../config/env.js';
import { logger } from './logger.js';

export interface EnvioResultado {
  ok: boolean;
  /** O id da mensagem no WhatsApp, quando a Evolution devolve. */
  waId: string | null;
  erro: string | null;
}

/**
 * Manda um texto. Sempre resolve — o erro vem no resultado.
 *
 * O `number` tem de ser o telefone em dígitos. Passar um LID faz a
 * Evolution aceitar a requisição e a mensagem não chegar, sem erro
 * nenhum; quem chama garante isso com `temTelefone` do normalizador.
 */
export async function enviarTexto(
  instancia: string,
  numero: string,
  texto: string,
): Promise<EnvioResultado> {
  if (!env.EVOLUTION_APIKEY) {
    return { ok: false, waId: null, erro: 'EVOLUTION_APIKEY não configurada' };
  }

  const url = `${env.EVOLUTION_URL}/message/sendText/${encodeURIComponent(instancia)}`;
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), 20_000);

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: env.EVOLUTION_APIKEY },
      body: JSON.stringify({ number: numero, text: texto, delay: 1200 }),
      signal: controle.signal,
    });

    const corpo = (await resp.json().catch(() => null)) as Record<string, unknown> | null;

    if (!resp.ok) {
      // O corpo do erro entra no log porque a Evolution costuma explicar
      // ali o que recusou — e sem isso sobra só um número de status.
      logger.warn({ instancia, status: resp.status, corpo }, 'Evolution recusou o envio');
      return { ok: false, waId: null, erro: `HTTP ${resp.status}: ${JSON.stringify(corpo)?.slice(0, 500)}` };
    }

    const key = (corpo?.key ?? null) as { id?: string } | null;
    return { ok: true, waId: key?.id ?? null, erro: null };
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e);
    logger.warn({ instancia, erro }, 'Falha ao falar com a Evolution');
    return { ok: false, waId: null, erro };
  } finally {
    clearTimeout(relogio);
  }
}
