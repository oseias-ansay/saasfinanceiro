/**
 * Chamada a um provedor com API compatível com a da OpenAI.
 *
 * Serve ao DeepSeek, e serviria a qualquer outro que fale o mesmo
 * protocolo. A escolha de qual usar é do `.env`, não do código.
 *
 * =====================================================================
 * POR QUE UM ARQUIVO SEPARADO, E NÃO UM `if` DENTRO DO `claude.ts`
 * =====================================================================
 * Os dois protocolos divergem em quase tudo que importa: o cabeçalho de
 * autenticação, o lugar da instrução de sistema, o formato da resposta,
 * e principalmente o CACHE — a Anthropic exige marcar o bloco, o
 * compatível com OpenAI costuma cachear sozinho por prefixo.
 *
 * Um arquivo com dois caminhos entrelaçados é onde o defeito do segundo
 * provedor passa despercebido porque os testes cobrem o primeiro.
 *
 * =====================================================================
 * A RETENTATIVA É A MESMA, E PELO MESMO MOTIVO
 * =====================================================================
 * O modo de falha mais comum não é a rede: é o modelo devolver JSON que
 * não passa na validação. Uma segunda tentativa, com o erro no texto,
 * corrige a maioria. Uma terceira quase nunca corrige e custa.
 *
 * Aqui isso pesa MAIS que na Anthropic: modelo mais barato costuma ser
 * menos obediente a formato, e é exatamente por isso que o esquema Zod é
 * o mesmo nos dois. Se o provedor barato não conseguir produzir o
 * formato, a validação recusa — e é melhor descobrir no teste comparativo
 * que no relatório do prospect.
 */

import type { ZodType } from 'zod';
import { env } from '../config/env.js';
import { logger } from './logger.js';
import { ErroClaude } from './claude.js';

interface RespostaOpenAI {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_cache_hit_tokens?: number;
  };
  error?: { message?: string; type?: string };
}

async function chamar(mensagens: Array<{ role: string; content: string }>) {
  if (!env.DEEPSEEK_API_KEY) {
    throw new ErroClaude('DEEPSEEK_API_KEY não configurada', 'config');
  }

  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), env.ANTHROPIC_TIMEOUT_MS);

  try {
    const resp = await fetch(`${env.DEEPSEEK_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.DEEPSEEK_MODEL,
        max_tokens: env.ANTHROPIC_MAX_TOKENS,
        temperature: 0.3,
        messages: mensagens,
        // Força JSON no nível do protocolo. Não substitui a validação —
        // JSON bem formado ainda pode ter campo faltando —, mas elimina a
        // classe de falha em que o modelo escreve "Claro! Aqui está:"
        // antes do objeto.
        response_format: { type: 'json_object' },
      }),
      signal: controle.signal,
    });

    const corpo = (await resp.json().catch(() => null)) as RespostaOpenAI | null;

    if (!resp.ok) {
      throw new ErroClaude(
        `Provedor respondeu ${resp.status}: ${corpo?.error?.message ?? 'sem detalhe'}`,
        'http',
        { status: resp.status, tipo: corpo?.error?.type },
      );
    }

    const texto = corpo?.choices?.[0]?.message?.content ?? '';
    if (!texto) throw new ErroClaude('Provedor devolveu resposta vazia', 'formato');

    if (corpo?.choices?.[0]?.finish_reason === 'length') {
      logger.warn(
        { max: env.ANTHROPIC_MAX_TOKENS },
        'Resposta cortada pelo limite de tokens — JSON provavelmente incompleto',
      );
    }

    return {
      texto,
      usou: {
        entrada: corpo?.usage?.prompt_tokens ?? 0,
        saida: corpo?.usage?.completion_tokens ?? 0,
        // O compatível com OpenAI costuma cachear por prefixo, sem marca
        // no corpo. Zero aqui pode significar "sem cache" ou "o provedor
        // não informa" — por isso o log diz o número, e não uma conclusão.
        cache: corpo?.usage?.prompt_cache_hit_tokens ?? 0,
      },
    };
  } catch (e) {
    if (e instanceof ErroClaude) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new ErroClaude(`Falha ao falar com o provedor: ${msg}`, 'rede');
  } finally {
    clearTimeout(relogio);
  }
}

/**
 * Mesma assinatura de `gerarAnalise`, de propósito.
 *
 * As duas são intercambiáveis em `dependencias.ts`, e trocar provedor é
 * trocar qual função é chamada — não reescrever o que vem depois.
 */
export async function gerarAnaliseOpenAI<T>(
  prompt: string,
  esquema: ZodType<T>,
  extrair: (bruto: string) => unknown,
): Promise<{
  analise: T;
  tentativas: number;
  consumo: { entrada: number; saida: number; cache: number };
}> {
  const mensagens: Array<{ role: string; content: string }> = [
    { role: 'user', content: prompt },
  ];

  let ultimoErro: unknown = null;
  const consumo = { entrada: 0, saida: 0, cache: 0 };

  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    const { texto, usou } = await chamar(mensagens);
    consumo.entrada += usou.entrada;
    consumo.saida += usou.saida;
    consumo.cache += usou.cache;

    try {
      const analise = esquema.parse(extrair(texto));
      logger.info({ tentativa, ...consumo, provedor: env.DEEPSEEK_MODEL }, 'Análise gerada');
      return { analise, tentativas: tentativa, consumo };
    } catch (e) {
      ultimoErro = e;
      const motivo = e instanceof Error ? e.message : String(e);
      logger.warn({ tentativa, motivo: motivo.slice(0, 500) }, 'Resposta do provedor recusada');

      if (tentativa === 2) break;

      mensagens.push({ role: 'assistant', content: texto.slice(0, 4000) });
      mensagens.push({
        role: 'user',
        content:
          'A resposta anterior não passou na validação. Erro:\n' +
          motivo.slice(0, 1500) +
          '\n\nRefaça devolvendo APENAS o objeto JSON completo, no formato exato pedido.',
      });
    }
  }

  throw new ErroClaude(
    'O provedor não devolveu uma análise válida em duas tentativas',
    'validacao',
    ultimoErro instanceof Error ? ultimoErro.message : String(ultimoErro),
  );
}
