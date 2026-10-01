/**
 * A conversa: instrução do assistente, janela de histórico e limites.
 *
 * =====================================================================
 * O QUE ESTE ASSISTENTE É, E O QUE ELE NÃO É
 * =====================================================================
 * Ele explica o plano que já existe. Não prescreve plano novo, não
 * recalcula diagnóstico e não dá parecer sobre decisão que não está no
 * plano — "devo pegar esse empréstimo?" é pergunta para o consultor, com
 * nome e CRC, não para um chat.
 *
 * A instrução abaixo diz isso ao modelo em voz direta. Mas a garantia de
 * verdade não é textual: o chat simplesmente não tem permissão de
 * escrita em `planos_acao` nem em `acoes` (ver SQL 56). Instrução no
 * prompt é cortesia; o portão é o banco.
 *
 * =====================================================================
 * O ISOLAMENTO NÃO É PEDIDO NO PROMPT
 * =====================================================================
 * Não existe aqui nenhuma frase do tipo "responda apenas sobre a empresa
 * X". Ela seria inútil e, pior, daria a sensação de proteção: o modelo
 * não decide a que dados tem acesso, quem decide é a consulta que montou
 * o contexto, com o tenant tirado do JWT e o RLS por cima.
 *
 * O contexto que chega aqui JÁ é só de uma empresa. Não há como pedir
 * dado de outra, porque não há outro dado.
 *
 * =====================================================================
 * A JANELA DE HISTÓRICO
 * =====================================================================
 * Dez turnos. O plano inteiro já está no bloco de sistema, que é fixo e
 * cacheado — o histórico serve para o fio da conversa ("e a terceira?"),
 * não para carregar informação. Vinte turnos de "obrigado" e "de nada"
 * custariam tokens para não acrescentar nada.
 */

import { z } from 'zod';

/**
 * O corpo aceito na rota de pergunta.
 *
 * Mora aqui, num módulo puro, para poder ser testado sem subir a
 * aplicação — e o que ele precisa provar é uma AUSÊNCIA: que não existe
 * campo de empresa, de plano por id, nem de "contexto adicional".
 *
 * O Zod descarta chave desconhecida em vez de recusar o corpo, e nesse
 * detalhe está a garantia: um `tenant_id` enviado pelo cliente não causa
 * erro, simplesmente não chega a existir do lado de cá. Um campo livre
 * que fosse para o modelo seria injeção de prompt com nome de
 * funcionalidade.
 */
export const corpoPerguntaSchema = z.object({
  pergunta: z.string(),
  /** Qual dos dois PDCAs. Não é id: é a escolha entre duas opções fixas. */
  tipo: z.enum(['financeiro', 'comercial']).optional(),
});

export type CorpoPergunta = z.infer<typeof corpoPerguntaSchema>;

/** Teto de perguntas por empresa em 24 horas. Ver `fn_pdca_cabe`. */
export const LIMITE_PERGUNTAS_24H = 30;

/** Turnos de histórico que vão junto da pergunta. */
export const TURNOS_NO_CONTEXTO = 10;

export const MAX_CARACTERES_PERGUNTA = 1000;

export type Papel = 'cliente' | 'assistente';

export interface MensagemGuardada {
  papel: Papel;
  texto: string;
}

export interface MensagemParaModelo {
  role: 'user' | 'assistant';
  content: string;
}

export class PerguntaInvalida extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PerguntaInvalida';
  }
}

/**
 * A instrução do assistente.
 *
 * Escrita em segunda pessoa e em português porque o cliente é brasileiro
 * e dono de micro ou pequena empresa — e porque resposta em jargão de
 * consultoria é o jeito mais rápido de um plano de ação não ser
 * executado.
 */
export const INSTRUCAO = `Você é o assistente do plano de ação da Business Triage, uma consultoria para micro e pequenas empresas brasileiras.

O plano de ação desta empresa está abaixo, no contexto. Ele foi acordado entre o dono do negócio e o consultor numa reunião. Você conversa com quem precisa executá-lo.

COMO RESPONDER

- Em português do Brasil, direto, sem jargão de consultoria. Quem lê administra uma empresa pequena e tem pouco tempo.
- Curto. Duas ou três frases resolvem a maioria das perguntas. Lista só quando a pergunta pede mais de um item.
- Sempre com o número da empresa. "A ação 2 está 20 dias atrasada" vale mais que "algumas ações precisam de atenção".
- Refira-se às ações pelo número e pelo título, como aparecem no contexto. É assim que elas estão na tela dele.

O QUE VOCÊ FAZ

- Explica o que cada ação significa na prática e por que ela entrou no plano.
- Diz o que está atrasado, o que vence primeiro e por onde começar.
- Traduz os termos do plano (causa-raiz, pilar, ciclo financeiro) em linguagem de dia a dia.
- Ajuda a quebrar uma ação grande nos primeiros passos concretos da semana.

O QUE VOCÊ NÃO FAZ

- Você não altera o plano. Não marca ação como concluída, não muda prazo, não troca responsável. Quando pedirem isso, diga que a marcação é feita na tela do plano, no botão da própria ação — é lá que ele vê exatamente o que está marcando.
- Você não cria ação nova nem substitui uma por outra. O plano é o que foi combinado com o consultor; mudar exige a reunião.
- Você não responde o que não está no contexto. Se perguntarem sobre faturamento, estoque, imposto, contrato, processo trabalhista ou qualquer dado que não esteja aqui, diga que não tem essa informação e indique falar com o consultor.
- Você não dá recomendação de investimento, de empréstimo, nem orientação jurídica ou contábil. Isso é conversa com o consultor.

QUANDO NÃO SOUBER

Diga que não está no plano. Não estime, não arredonde para um número plausível, não complete com o que costuma ser verdade em empresas parecidas. Um número inventado aqui entra numa decisão de verdade sobre o dinheiro de alguém.`;

/**
 * Valida a pergunta antes de gastar uma chamada.
 *
 * O limite de mil caracteres não é técnico — cabe muito mais no modelo.
 * Ele existe porque pergunta de mil caracteres quase nunca é pergunta: é
 * texto colado. E texto colado num chat sobre plano de ação costuma ser
 * exatamente o que não deve ir para um modelo (extrato, contrato, dado
 * de terceiro).
 */
export function validarPergunta(bruta: unknown): string {
  if (typeof bruta !== 'string') {
    throw new PerguntaInvalida('A pergunta precisa ser um texto.');
  }

  const p = bruta.trim();

  if (p.length === 0) {
    throw new PerguntaInvalida('Escreva a sua pergunta.');
  }

  if (p.length > MAX_CARACTERES_PERGUNTA) {
    throw new PerguntaInvalida(
      `A pergunta ficou longa demais (${p.length} caracteres, o limite é ${MAX_CARACTERES_PERGUNTA}). ` +
        'Tente resumir em uma pergunta por vez.',
    );
  }

  return p;
}

/**
 * Os últimos turnos, em ordem cronológica e começando pelo cliente.
 *
 * A API do modelo exige alternância a partir de `user`. Um histórico que
 * comece com `assistant` — o que acontece se a janela cortar no meio de
 * um par — é recusado com erro 400, e o cliente veria uma falha genérica
 * numa conversa que estava funcionando.
 */
export function janelaDeHistorico(
  guardadas: MensagemGuardada[],
  turnos = TURNOS_NO_CONTEXTO,
): MensagemParaModelo[] {
  const recentes = guardadas.slice(-turnos * 2);

  // Descarta do início até achar uma mensagem do cliente.
  const comeco = recentes.findIndex((m) => m.papel === 'cliente');
  if (comeco === -1) return [];

  const mensagens: MensagemParaModelo[] = [];
  let esperando: Papel = 'cliente';

  // Alternância garantida aqui, e não confiada ao banco: duas perguntas
  // seguidas ficam gravadas se a primeira falhou depois de salva, e esse
  // par quebrado derrubaria a requisição seguinte.
  for (const m of recentes.slice(comeco)) {
    if (m.papel !== esperando) continue;
    mensagens.push({ role: m.papel === 'cliente' ? 'user' : 'assistant', content: m.texto });
    esperando = m.papel === 'cliente' ? 'assistente' : 'cliente';
  }

  // Sobrou uma pergunta sem resposta no fim: sai, senão o modelo
  // receberia duas mensagens de `user` em sequência.
  if (mensagens.at(-1)?.role === 'user') {
    mensagens.pop();
  }

  return mensagens;
}

/** Histórico + pergunta nova, prontos para a chamada. */
export function montarMensagens(
  historico: MensagemGuardada[],
  pergunta: string,
): MensagemParaModelo[] {
  return [...janelaDeHistorico(historico), { role: 'user', content: pergunta }];
}
