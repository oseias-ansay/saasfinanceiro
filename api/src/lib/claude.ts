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

/* ==================================================================== */
/* Conversa                                                              */
/* ==================================================================== */

/**
 * Uma volta de conversa: texto livre, sem schema.
 *
 * =====================================================================
 * POR QUE NÃO REUSAR `gerarAnalise`
 * =====================================================================
 * Aquela função existe para arrancar um objeto validado do modelo, e a
 * retentativa dela é "você errou o formato, refaça". Numa conversa não
 * há formato para errar: qualquer texto é resposta válida. Reusar
 * significaria inventar um schema só para ter o que validar.
 *
 * E tem a diferença que decide: ali o prompt é único e descartável; aqui
 * o bloco de sistema é o MESMO em todos os turnos da conversa, o que
 * permite cache.
 *
 * =====================================================================
 * O CACHE DE PROMPT É O QUE TORNA ISTO VIÁVEL
 * =====================================================================
 * O plano de ação inteiro vai no bloco de sistema — alguns milhares de
 * tokens, idênticos a cada pergunta. Sem cache, cada "e a terceira?"
 * custaria a releitura do plano completo, e a conversa de dez turnos
 * pagaria dez vezes pelo mesmo texto.
 *
 * Com `cache_control: ephemeral`, a primeira pergunta grava e as
 * seguintes leem por cerca de um décimo do preço. A janela do cache é de
 * uns cinco minutos e se renova a cada leitura, o que casa com o ritmo
 * de uma conversa de verdade.
 *
 * Duas consequências práticas:
 *
 *   • O BLOCO CACHEADO PRECISA SER BYTE A BYTE IGUAL. Qualquer coisa
 *     variável nele — a hora, um contador, um "olá, Maria" — invalida o
 *     cache a cada turno e o custo volta ao cheio sem nenhum sintoma
 *     visível. É por isso que o contexto declara a DATA de hoje, e não a
 *     hora.
 *   • O CONSUMO DE CACHE É DEVOLVIDO E GRAVADO. Se a coluna
 *     `tokens_cache` viver em zero, o cache parou de funcionar — e essa é
 *     a única forma de descobrir, porque tudo continua respondendo certo.
 */
export interface RespostaConversa {
  texto: string;
  consumo: {
    entrada: number;
    saida: number;
    /** Tokens lidos do cache. Zero sempre significa cache quebrado. */
    cacheLido: number;
    cacheEscrito: number;
  };
}

interface RespostaApiConversa extends RespostaApi {
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

/* ==================================================================== */
/* Conversa com ferramentas                                              */
/* ==================================================================== */

/**
 * Uma volta de conversa em que o modelo pode consultar dados.
 *
 * =====================================================================
 * COMO FUNCIONA
 * =====================================================================
 * O modelo não recebe os dados da empresa. Recebe a lista do que pode
 * perguntar. Quando ele decide consultar, a resposta volta com
 * `stop_reason: tool_use` e os pedidos; nós executamos, devolvemos os
 * resultados como mensagem do usuário, e ele continua. Repete até ele
 * parar de pedir.
 *
 * =====================================================================
 * O TETO DE RODADAS
 * =====================================================================
 * Quatro. Não é proteção contra laço infinito do modelo — é contra o
 * custo: cada rodada é uma chamada paga, e o cliente está esperando na
 * tela. Quatro cobre com folga a pergunta composta de verdade ("quanto
 * tenho a pagar e a receber este mês?"), que são duas.
 *
 * Ao estourar, a última chamada vai SEM ferramentas. Isso força o modelo
 * a responder com o que já tem, em vez de a conversa terminar sem
 * resposta — que é o pior desfecho possível para quem perguntou.
 *
 * =====================================================================
 * O CACHE CONTINUA VALENDO
 * =====================================================================
 * A marca de cache fica no bloco de sistema, como antes. As definições
 * de ferramenta são fixas e vão antes dele na ordem do prompt, então
 * entram no mesmo prefixo cacheado — desde que a lista não mude entre
 * perguntas. Por isso o catálogo é constante, e não montado por tenant.
 */
export interface FerramentaParaModelo {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface PedidoDeFerramenta {
  id: string;
  nome: string;
  parametros: Record<string, unknown>;
}

export interface RespostaComFerramentas extends RespostaConversa {
  /** Quantas idas ao modelo foram necessárias. */
  rodadas: number;
  /** Quais ferramentas foram chamadas, na ordem. Para o log de uso. */
  usou: string[];
}

export async function conversarComFerramentas(opcoes: {
  instrucao: string;
  contexto: string;
  mensagens: Array<{ role: 'user' | 'assistant'; content: unknown }>;
  ferramentas: FerramentaParaModelo[];
  /** Executa o pedido e devolve o texto do resultado. Nunca deve lançar. */
  executar: (p: PedidoDeFerramenta) => Promise<string>;
  modelo: string;
  maxTokens: number;
  maxRodadas?: number;
}): Promise<RespostaComFerramentas> {
  const maxRodadas = opcoes.maxRodadas ?? 4;
  const mensagens = [...opcoes.mensagens];
  const usou: string[] = [];

  const consumo = { entrada: 0, saida: 0, cacheLido: 0, cacheEscrito: 0 };

  for (let rodada = 1; rodada <= maxRodadas; rodada++) {
    // Na última rodada, sem ferramentas: obriga a responder com o que
    // tem. Deixar as ferramentas disponíveis faria o modelo pedir mais
    // uma vez e a conversa terminar sem resposta.
    const ultima = rodada === maxRodadas;

    const corpo = await chamarBruto({
      modelo: opcoes.modelo,
      maxTokens: opcoes.maxTokens,
      instrucao: opcoes.instrucao,
      contexto: opcoes.contexto,
      mensagens,
      ferramentas: ultima ? undefined : opcoes.ferramentas,
    });

    consumo.entrada += corpo?.usage?.input_tokens ?? 0;
    consumo.saida += corpo?.usage?.output_tokens ?? 0;
    consumo.cacheLido += corpo?.usage?.cache_read_input_tokens ?? 0;
    consumo.cacheEscrito += corpo?.usage?.cache_creation_input_tokens ?? 0;

    const blocos = corpo?.content ?? [];
    const pedidos = blocos.filter((b) => b.type === 'tool_use');

    if (corpo?.stop_reason !== 'tool_use' || pedidos.length === 0) {
      const texto = blocos
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('')
        .trim();

      if (!texto) throw new ErroClaude('Claude devolveu resposta vazia', 'formato');

      logger.info({ ...consumo, rodadas: rodada, usou }, 'Resposta do assistente');
      return { texto, consumo, rodadas: rodada, usou };
    }

    // A resposta do modelo entra inteira no histórico — os blocos de
    // `tool_use` precisam estar lá para os resultados abaixo casarem por
    // id. Remontar só o texto quebraria o pareamento.
    mensagens.push({ role: 'assistant', content: blocos });

    const resultados = [];
    for (const p of pedidos) {
      usou.push(String(p.name));
      const texto = await opcoes.executar({
        id: String(p.id),
        nome: String(p.name),
        parametros: (p.input ?? {}) as Record<string, unknown>,
      });
      resultados.push({ type: 'tool_result', tool_use_id: p.id, content: texto });
    }

    mensagens.push({ role: 'user', content: resultados });
  }

  // Inalcançável: a última rodada vai sem ferramentas e sempre devolve
  // texto. Fica como rede, porque "inalcançável" envelhece mal.
  throw new ErroClaude('O assistente não concluiu a resposta', 'formato');
}

interface BlocoResposta {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

interface CorpoComFerramentas {
  content?: BlocoResposta[];
  stop_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  error?: { type?: string; message?: string };
}

/** A chamada crua. Separada para o laço acima ficar legível. */
async function chamarBruto(o: {
  modelo: string;
  maxTokens: number;
  instrucao: string;
  contexto: string;
  mensagens: Array<{ role: string; content: unknown }>;
  ferramentas?: FerramentaParaModelo[];
}): Promise<CorpoComFerramentas> {
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
        model: o.modelo,
        max_tokens: o.maxTokens,
        temperature: 0.2,
        ...(o.ferramentas ? { tools: o.ferramentas } : {}),
        system: [
          { type: 'text', text: o.instrucao },
          { type: 'text', text: o.contexto, cache_control: { type: 'ephemeral' } },
        ],
        messages: o.mensagens,
      }),
      signal: controle.signal,
    });

    const corpo = (await resp.json().catch(() => null)) as CorpoComFerramentas | null;

    if (!resp.ok) {
      throw new ErroClaude(
        `Claude respondeu ${resp.status}: ${corpo?.error?.message ?? 'sem detalhe'}`,
        'http',
        { status: resp.status, tipo: corpo?.error?.type },
      );
    }

    return corpo ?? {};
  } catch (e) {
    if (e instanceof ErroClaude) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new ErroClaude(`Falha ao falar com o Claude: ${msg}`, 'rede');
  } finally {
    clearTimeout(relogio);
  }
}

export async function conversar(opcoes: {
  /** Instrução fixa do assistente. */
  instrucao: string;
  /** O contexto grande e repetido — é este bloco que vai para o cache. */
  contexto: string;
  mensagens: Array<{ role: 'user' | 'assistant'; content: string }>;
  modelo: string;
  maxTokens: number;
}): Promise<RespostaConversa> {
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
        model: opcoes.modelo,
        max_tokens: opcoes.maxTokens,
        // Mais baixa que a da análise. Aqui a resposta precisa ser
        // reprodutível: a mesma pergunta sobre o mesmo plano, feita duas
        // vezes, não deveria sugerir prioridades diferentes.
        temperature: 0.2,
        system: [
          // A instrução vem primeiro e também entra no cache: ela é fixa
          // para todos os clientes, então a parte dela do cache é
          // compartilhada entre conversas.
          { type: 'text', text: opcoes.instrucao },
          {
            type: 'text',
            text: opcoes.contexto,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: opcoes.mensagens,
      }),
      signal: controle.signal,
    });

    const corpo = (await resp.json().catch(() => null)) as RespostaApiConversa | null;

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
      .join('')
      .trim();

    if (!texto) throw new ErroClaude('Claude devolveu resposta vazia', 'formato');

    const consumo = {
      entrada: corpo?.usage?.input_tokens ?? 0,
      saida: corpo?.usage?.output_tokens ?? 0,
      cacheLido: corpo?.usage?.cache_read_input_tokens ?? 0,
      cacheEscrito: corpo?.usage?.cache_creation_input_tokens ?? 0,
    };

    // Resposta cortada no meio é pior num chat que numa análise: o
    // cliente lê a frase incompleta e acredita nela.
    if (corpo?.stop_reason === 'max_tokens') {
      logger.warn({ max: opcoes.maxTokens }, 'Resposta do chat cortada pelo limite de tokens');
    }

    logger.info(consumo, 'Resposta do chat do PDCA');

    return { texto, consumo };
  } catch (e) {
    if (e instanceof ErroClaude) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new ErroClaude(`Falha ao falar com o Claude: ${msg}`, 'rede');
  } finally {
    clearTimeout(relogio);
  }
}
