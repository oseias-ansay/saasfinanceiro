/**
 * O contrato do pedido de interesse, e o texto do aviso.
 *
 * Módulo puro: nenhuma rede, nenhum relógio, nenhum `env`. É o que
 * permite testar o schema e a mensagem sem subir nada — e é por isso que
 * o `env` da rota NÃO é importado aqui no topo (ver a nota do
 * `boletoVisao.ts` no CLAUDE.md).
 */

import { z } from 'zod';

/**
 * O corpo que a rota aceita.
 *
 * =====================================================================
 * NÃO HÁ CAMPO DE EMPRESA, E ISSO TEM TESTE
 * =====================================================================
 * `tenant_id` é injetado pelo servidor a partir do JWT. Mesma regra das
 * ferramentas do assistente e do webhook de boleto: se o cliente
 * pudesse dizer de qual empresa é o pedido, poderia dizer o de outra.
 *
 * Aqui o dano seria pequeno — um pedido de contato no lugar errado —,
 * mas a regra vale pela consistência: uma exceção ensina que existem
 * exceções, e a próxima pode ser numa rota que importa.
 *
 * =====================================================================
 * MENSAGEM E TELEFONE SÃO OPCIONAIS DE PROPÓSITO
 * =====================================================================
 * Exigir texto para pedir uma conversa acrescenta um obstáculo
 * exatamente onde se quer o contrário. Quem só quer sinalizar interesse
 * clica e pronto; quem tem contexto escreve.
 */
export const corpoInteresseSchema = z.object({
  assunto: z.string().trim().min(2).max(60),
  mensagem: z.string().trim().max(2000).optional(),
  telefone: z.string().trim().min(8).max(20).optional(),
});

export type CorpoInteresse = z.infer<typeof corpoInteresseSchema>;

/** Rótulo legível para os assuntos conhecidos. Desconhecido sai como veio. */
const ROTULO: Record<string, string> = {
  treinamento: 'o Treinamento — Finanças para Pequenas Empresas',
  crm: 'o CRM',
  contabil: 'a Contabilidade gerencial',
};

/**
 * A mensagem que chega no WhatsApp de quem atende.
 *
 * Função separada porque é a parte que se lê de verdade, e a que mais
 * muda. Ela diz QUEM pediu e O QUÊ — e inclui a mensagem do cliente
 * quando existe, porque o que a pessoa escreveu costuma valer mais que
 * o fato de ter clicado.
 *
 * Sem link para o painel: quem recebe isso já sabe onde ele fica, e um
 * link a mais numa mensagem de WhatsApp é um motivo a mais para ela
 * parecer automática.
 */
export function textoDoAviso(
  empresa: string | null,
  assunto: string,
  mensagem?: string,
): string {
  const quem = empresa?.trim() || 'Uma empresa';
  const oque = ROTULO[assunto] ?? `"${assunto}"`;

  const base = `💬 *Pedido de contato*\n${quem} quer falar sobre ${oque}.`;
  const extra = mensagem?.trim();

  return extra ? `${base}\n\n_"${extra}"_` : base;
}
