/**
 * A chamada ao Claude.
 *
 * =====================================================================
 * POR QUE UMA RETENTATIVA, E SÓ UMA
 * =====================================================================
 * O modo de falha mais comum não é a API cair: é o modelo devolver algo
 * que não passa na validação — um campo faltando, o JSON cortado no meio
 * por limite de tokens, uma frase antes do objeto.
 *
 * Uma segunda tentativa, com o erro no texto, corrige a maioria. Uma
 * terceira quase nunca corrige e custa: cada chamada é paga, e o
 * prospect está esperando do outro lado do formulário. Falhar na segunda
 * e alarmar é melhor que insistir em silêncio.
 *
 * =====================================================================
 * O QUE ACONTECE QUANDO FALHA DE VEZ
 * =====================================================================
 * Lança. Quem chama decide — e no caso do diagnóstico a decisão é
 * registrar a falha, avisar por WhatsApp e NÃO mandar relatório nenhum.
 * Um PDF com metade da análise é pior que um e-mail dizendo que houve um
 * problema e que você entrará em contato.
 */

import type { ZodType } from 'zod';
import { env } from '../config/env.js';
import { logger } from './logger.js';

const URL_MENSAGENS = 'https://api.anthropic.com/v1/messages';
const VERSAO_API = '2023-06-01';

export class ErroClaude extends Error {
  constructor(
    message: string,
    public readonly etapa: 'rede' | 'http' | 'formato' | 'validacao' | 'config',
    public readonly detalhe?: unknown,
  ) {
    super(message);
    this.name = 'ErroClaude';
  }
}

interface RespostaApi {
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { type?: string; message?: string };
}

async function chamar(mensagens: Array<{ role: 'user' | 'assistant'; content: string }>) {
  if (!env.ANTHROPIC_API_KEY) {
    throw new ErroClaude('ANTHROPIC_API_KEY não configurada', 'config');
  }

  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), env.ANTHROPIC_TIMEOUT_MS);

  try {
    const resp = await fetch(URL_MENSAGENS, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': VERSAO_API,
      },
      body: JSON.stringify({
        model: env.ANTHROPIC_MODEL,
        max_tokens: env.ANTHROPIC_MAX_TOKENS,
        temperature: 0.3,
        messages: mensagens,
      }),
      signal: controle.signal,
    });

    const corpo = (await resp.json().catch(() => null)) as RespostaApi | null;

    if (!resp.ok) {
      throw new ErroClaude(
        `Claude respondeu ${resp.status}: ${corpo?.error?.message ?? 'sem detalhe'}`,
        'http',
        { status: resp.status, tipo: corpo?.error?.type },
      );
    }

    const texto = (corpo?.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');

    if (!texto) throw new ErroClaude('Claude devolveu resposta vazia', 'formato');

    // `max_tokens` é a causa silenciosa de JSON cortado. Vale distinguir
    // no log: aumentar o limite resolve, e insistir na retentativa não.
    if (corpo?.stop_reason === 'max_tokens') {
      logger.warn(
        { max: env.ANTHROPIC_MAX_TOKENS, usou: corpo?.usage?.output_tokens },
        'Claude atingiu o limite de tokens — a resposta veio cortada',
      );
    }

    return { texto, usou: corpo?.usage };
  } catch (e) {
    if (e instanceof ErroClaude) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new ErroClaude(`Falha ao falar com o Claude: ${msg}`, 'rede');
  } finally {
    clearTimeout(relogio);
  }
}

/**
 * Pede a análise e devolve o objeto já validado.
 *
 * @param prompt   texto completo, montado por `analise.ts`
 * @param esquema  o validador Zod do tipo esperado
 * @param extrair  como tirar o objeto do texto (trata bloco markdown)
 */
export async function gerarAnalise<T>(
  prompt: string,
  esquema: ZodType<T>,
  extrair: (bruto: string) => unknown,
): Promise<{
  analise: T;
  tentativas: number;
  /** Consumo somado de todas as tentativas — é o que foi cobrado. */
  consumo: { entrada: number; saida: number };
}> {
  const mensagens: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: prompt },
  ];

  let ultimoErro: unknown = null;

  // Somado, e não o da última tentativa: a cobrança é por chamada, e uma
  // retentativa que deu certo ainda custou as duas.
  const consumo = { entrada: 0, saida: 0 };

  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    const { texto, usou } = await chamar(mensagens);
    consumo.entrada += usou?.input_tokens ?? 0;
    consumo.saida += usou?.output_tokens ?? 0;

    try {
      const analise = esquema.parse(extrair(texto));
      logger.info(
        { tentativa, entrada: consumo.entrada, saida: consumo.saida },
        'Análise gerada',
      );
      return { analise, tentativas: tentativa, consumo };
    } catch (e) {
      ultimoErro = e;
      const motivo = e instanceof Error ? e.message : String(e);
      logger.warn({ tentativa, motivo: motivo.slice(0, 500) }, 'Resposta do Claude recusada');

      if (tentativa === 2) break;

      // A correção vai como conversa, não como prompt novo: o modelo vê
      // o que escreveu e o que está errado nisso. Repetir o pedido do
      // zero costuma produzir o mesmo defeito.
      mensagens.push({ role: 'assistant', content: texto.slice(0, 4000) });
      mensagens.push({
        role: 'user',
        content:
          'A resposta anterior não passou na validação. Erro:\n' +
          motivo.slice(0, 1500) +
          '\n\nRefaça devolvendo APENAS o objeto JSON completo, no formato exato pedido, sem texto antes ou depois e sem bloco de código.',
      });
    }
  }

  throw new ErroClaude(
    'O Claude não devolveu uma análise válida em duas tentativas',
    'validacao',
    ultimoErro instanceof Error ? ultimoErro.message : String(ultimoErro),
  );
}
