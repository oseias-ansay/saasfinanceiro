/**
 * A foto do boleto virando dígitos.
 *
 * =====================================================================
 * POR QUE O MODELO SÓ TRANSCREVE
 * =====================================================================
 * Seria mais curto pedir ao modelo "me diga o valor e o vencimento deste
 * boleto". E seria a decisão errada, por um motivo que não é de custo.
 *
 * A linha digitável tem dígitos verificadores. Se o modelo transcrever
 * 4 onde era 9, a conta não fecha e `lerBoleto` recusa — o erro é
 * DETECTÁVEL. É a única parte desta tela com essa propriedade.
 *
 * Se em vez disso ele lesse "R$ 1.247,80" e devolvesse 124.78, nada no
 * sistema teria como saber. O número é plausível, o boleto existe, e a
 * empresa pagaria um décimo da conta — ou dez vezes ela. O cliente
 * descobre no extrato, semanas depois.
 *
 * Então o modelo faz a parte que ele faz bem (ler caracteres de uma
 * foto torta) e nada da parte que precisa estar certa. Valor e
 * vencimento saem da aritmética, em `boleto.ts`, com teste.
 *
 * =====================================================================
 * E SE A FOTO ESTIVER RUIM
 * =====================================================================
 * Devolve nulo e a tela oferece digitar a linha. Não há segunda
 * tentativa automática com a mesma imagem: a foto é a mesma, o modelo é
 * o mesmo, e a segunda chamada custa igual à primeira para dar o mesmo
 * resultado.
 */

/**
 * `env` e `ErroClaude` entram por importação TARDIA, dentro da função de
 * rede.
 *
 * No topo do arquivo eles obrigariam o teste a ter todas as variáveis de
 * ambiente configuradas só para exercitar `extrairLinha`, que é pura e
 * não fala com ninguém. Já custou uma suíte quebrada aqui: o teste da
 * extração falhou pedindo SUPABASE_SERVICE_ROLE_KEY.
 */
const URL_MENSAGENS = 'https://api.anthropic.com/v1/messages';
const VERSAO_API = '2023-06-01';

/**
 * A instrução. Curta de propósito: pedido longo convida o modelo a
 * explicar, e explicação aqui é ruído que a extração tem que filtrar.
 */
export const INSTRUCAO = [
  'Você transcreve a linha digitável de boletos brasileiros a partir de fotos.',
  '',
  'A linha digitável é a sequência de números impressa ACIMA do código de',
  'barras, normalmente separada em grupos por pontos e espaços. Tem 47',
  'dígitos em boleto bancário e 48 em conta de consumo ou tributo.',
  '',
  'Responda APENAS com os dígitos, sem pontos, sem espaços, sem nenhuma',
  'outra palavra. Se a linha não estiver legível ou não houver boleto na',
  'imagem, responda exatamente: NENHUM',
  '',
  'Não leia o valor nem a data impressos. Não os mencione. Transcreva só',
  'a linha digitável.',
].join('\n');

/** Imagens que a API de visão aceita. */
const IMAGENS = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

/**
 * PDF entra como `document`, não como `image`.
 *
 * E isso importa porque boleto por e-mail chega em PDF na esmagadora
 * maioria das vezes — é o que o banco anexa. Tratar PDF como imagem
 * devolve erro da API; não tratar PDF nenhum obrigaria o cliente a
 * imprimir e fotografar um arquivo que já está na tela dele.
 *
 * O PDF também é a melhor entrada das três: ele tem camada de texto, a
 * linha digitável está lá como caractere e não como pixel. Foto torta é
 * o caso difícil; PDF é o fácil.
 */
const PDF = 'application/pdf';

export const MIMES_ACEITOS = new Set([...IMAGENS, PDF]);

/** O bloco de conteúdo, que difere entre imagem e PDF. Puro, testável. */
export function blocoDoArquivo(
  mime: string,
  base64: string,
): { type: string; source: { type: string; media_type: string; data: string } } {
  if (!MIMES_ACEITOS.has(mime)) {
    throw new FotoIlegivel(
      `Não consigo ler ${mime}. Envie em JPEG, PNG, WEBP ou PDF.`,
    );
  }
  return {
    type: mime === PDF ? 'document' : 'image',
    source: { type: 'base64', media_type: mime, data: base64 },
  };
}

export class FotoIlegivel extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FotoIlegivel';
  }
}

/**
 * Tira da resposta do modelo a linha digitável.
 *
 * Função pura, e é ela que carrega o teste. A resposta ideal é só
 * dígitos, mas modelo às vezes acrescenta pontuação ou uma frase — e
 * quebrar por causa de um ponto seria desperdiçar uma leitura boa.
 *
 * O que NÃO faz: cortar sequência longa demais para caber em 47. Se
 * vieram 52 dígitos, alguma coisa entrou junto, e escolher quais 47
 * manter seria um palpite nosso virando valor a pagar.
 */
export function extrairLinha(respostaDoModelo: string): string | null {
  const texto = respostaDoModelo.trim();
  if (texto === '' || /^NENHUM\b/i.test(texto)) return null;

  // Junta os grupos: "34191.09008 12345" é uma sequência só, quebrada
  // pela impressão. Ponto, espaço e hífen entre dígitos somem.
  const colado = texto.replace(/(?<=\d)[.\s-]+(?=\d)/g, '');

  const corridas = colado.match(/\d+/g) ?? [];
  const candidatas = corridas.filter((c) => c.length === 47 || c.length === 48);

  // Mais de uma candidata é ambiguidade real: não há como saber qual é a
  // linha e qual é outro número da página. Melhor pedir para digitar.
  if (candidatas.length !== 1) return null;

  return candidatas[0] ?? null;
}

/**
 * Manda a imagem e devolve a linha digitável, ou nulo se não deu.
 *
 * O `fetch` entra por parâmetro para o teste não precisar de rede nem
 * de chave. Mesmo arranjo das outras chamadas do projeto.
 */
export async function transcreverBoleto(
  arquivoBase64: string,
  mime: string,
  deps: { fetch?: typeof fetch } = {},
): Promise<string | null> {
  // Lança antes de gastar qualquer chamada se o tipo não serve.
  const bloco = blocoDoArquivo(mime, arquivoBase64);

  const { env } = await import('../../config/env.js');
  const { ErroClaude } = await import('../../lib/claude.js');

  if (!env.ANTHROPIC_API_KEY) {
    throw new ErroClaude('ANTHROPIC_API_KEY não configurada', 'config');
  }

  const buscar = deps.fetch ?? fetch;
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), env.ANTHROPIC_TIMEOUT_MS);

  try {
    const resp = await buscar(URL_MENSAGENS, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': VERSAO_API,
      },
      body: JSON.stringify({
        model: env.ANTHROPIC_MODEL,
        // 60 tokens cabem 48 dígitos com folga. Teto baixo é a segunda
        // barreira contra o modelo resolver explicar a resposta.
        max_tokens: 60,
        // Transcrição não é tarefa criativa: a mesma foto deve dar a
        // mesma linha.
        temperature: 0,
        system: INSTRUCAO,
        messages: [
          {
            role: 'user',
            content: [bloco, { type: 'text', text: 'Transcreva a linha digitável.' }],
          },
        ],
      }),
      signal: controle.signal,
    });

    const corpo = (await resp.json().catch(() => null)) as {
      content?: Array<{ type: string; text?: string }>;
      error?: { message?: string; type?: string };
    } | null;

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

    return extrairLinha(texto);
  } catch (e) {
    if (e instanceof ErroClaude || e instanceof FotoIlegivel) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new ErroClaude(`Falha ao ler a foto: ${msg}`, 'rede');
  } finally {
    clearTimeout(relogio);
  }
}
