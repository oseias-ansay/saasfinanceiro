/**
 * Achar de qual empresa é o e-mail que chegou.
 *
 * =====================================================================
 * ESTA FUNÇÃO É A FRONTEIRA ENTRE EMPRESAS
 * =====================================================================
 * Ela decide em qual `tenant_id` o boleto vai cair. Um defeito aqui não
 * dá erro: coloca a conta a pagar de uma empresa na fila de outra, e a
 * outra vê o valor, o fornecedor e o vencimento de um concorrente.
 *
 * Por isso é função pura, com teste, e por isso ela é CONSERVADORA: na
 * dúvida devolve nulo. E-mail descartado é um boleto que o cliente
 * reenvia; e-mail entregue à empresa errada é vazamento.
 *
 * =====================================================================
 * O REMETENTE NÃO IDENTIFICA NADA
 * =====================================================================
 * O `From` é trivial de falsificar e nem resolve o caso real — quando o
 * fornecedor encaminha o boleto, ele não é usuário de empresa nenhuma.
 * Quem identifica é o token no DESTINATÁRIO, que só quem recebeu o
 * endereço conhece.
 *
 * O remetente é guardado para a pessoa reconhecer na tela ("é o meu
 * fornecedor de bebidas"), nunca para a plataforma decidir.
 */

import { z } from 'zod';

/** O rótulo antes do `+`. Fixo: o que varia é o token. */
const CAIXA = 'boletos';

const anexoSchema = z.object({
  nome: z.string().trim().max(300).optional().default('sem nome'),
  mime: z.string().trim().max(100),
  /** O conteúdo em base64, como o n8n entrega. */
  base64: z.string().min(1),
});

/**
 * O corpo que o fluxo do n8n manda.
 *
 * =====================================================================
 * NÃO HÁ CAMPO DE EMPRESA AQUI, E ISSO É A BARREIRA
 * =====================================================================
 * Mesma regra das ferramentas do assistente: nenhum campo de `tenant`,
 * `empresa` ou `cliente_id`. A empresa sai do token no destinatário,
 * resolvido contra `boleto_entrada_email`.
 *
 * Um campo `tenant_id` aqui seria conveniente e seria uma porta: quem
 * tivesse o segredo do webhook — que é UM segredo, compartilhado por
 * todos os fluxos — escolheria a empresa de destino. Hoje precisaria
 * também do token daquela empresa específica.
 *
 * O schema mora no módulo puro, e não no arquivo de rotas, para que o
 * teste possa varrer os campos sem arrastar `config/env.js` junto.
 * Existe teste que falha se alguém acrescentar campo de empresa.
 */
export const corpoEmailSchema = z.object({
  /** O cabeçalho `To` inteiro, como veio. */
  para: z.string().trim().max(2000),
  cc: z.string().trim().max(2000).optional().default(''),
  de: z.string().trim().max(500).optional().default(''),
  assunto: z.string().trim().max(500).optional().default(''),
  anexos: z.array(anexoSchema).max(20).optional().default([]),
});

/**
 * Tira os tokens de uma lista de destinatários.
 *
 * Devolve TODOS os encontrados, não o primeiro. Quem chama decide o que
 * fazer com mais de um — e a decisão certa é recusar, porque um e-mail
 * endereçado a duas empresas não tem dono.
 *
 * Aceita o que um cabeçalho de e-mail real traz:
 * - vários endereços separados por vírgula
 * - nome exibido: `Financeiro <boletos+abc123@dominio>`
 * - maiúsculas em qualquer parte (a parte local é sensível a caixa pela
 *   RFC, mas nenhum provedor trata assim, e um token em caixa alta
 *   recusado seria um boleto perdido sem explicação)
 * - o mesmo token repetido no Para e no Cc
 */
export function tokensDoDestinatario(cabecalho: string): string[] {
  if (typeof cabecalho !== 'string' || cabecalho.trim() === '') return [];

  const achados = new Set<string>();

  // `boletos+TOKEN@` em qualquer lugar do texto. Não tento validar o
  // domínio: o e-mail só chega aqui porque a caixa que o n8n lê é
  // nossa, e exigir o domínio quebraria no primeiro alias ou
  // redirecionamento que alguém configurar.
  // A flag `i` vale para o rótulo `boletos` também, não só para o token:
  // um e-mail endereçado a `BOLETOS+...` existe, e recusá-lo seria um
  // boleto perdido sem nenhuma explicação para o cliente.
  const padrao = new RegExp(`${CAIXA}\\+([A-Za-z0-9]{8,32})@`, 'gi');

  for (const m of cabecalho.matchAll(padrao)) {
    achados.add(m[1]!.toLowerCase());
  }

  return [...achados];
}

export type MotivoRecusa = 'sem_token' | 'varios_tokens';

export interface Destino {
  token: string | null;
  motivo: MotivoRecusa | null;
}

/**
 * O token único do e-mail, ou o motivo de não dar para saber.
 *
 * Dois tokens é o caso que merece atenção: alguém mandou o mesmo boleto
 * para duas empresas no mesmo e-mail. Gravar nas duas seria inventar
 * uma intenção, e gravar na primeira seria pior ainda — a ordem dos
 * destinatários num cabeçalho não significa nada.
 */
export function destinoDoEmail(cabecalhoPara: string, cabecalhoCc = ''): Destino {
  const tokens = tokensDoDestinatario(`${cabecalhoPara} ${cabecalhoCc}`);

  if (tokens.length === 0) return { token: null, motivo: 'sem_token' };
  if (tokens.length > 1) return { token: null, motivo: 'varios_tokens' };

  return { token: tokens[0]!, motivo: null };
}

/* ==================================================================== */
/* Os anexos                                                             */
/* ==================================================================== */

export interface AnexoRecebido {
  nome: string;
  mime: string;
  base64: string;
}

/**
 * Tipos que vale tentar ler. O resto é descartado sem chamar o modelo.
 *
 * E-mail de boleto vem com logo do banco, ícone de assinatura e às vezes
 * um `.ics`. Cada anexo mandado ao modelo custa dinheiro, então filtrar
 * por tipo e por tamanho antes é economia direta — e um PNG de 3 KB
 * nunca é um boleto, é um logotipo.
 */
const LEGIVEIS = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

/** Abaixo disto é ícone, não documento. */
const MINIMO_BYTES = 20 * 1024;

/** Acima disto não é boleto; é catálogo ou extrato. */
const MAXIMO_BYTES = 10 * 1024 * 1024;

function tamanhoDoBase64(base64: string): number {
  // 4 caracteres viram 3 bytes; o padding no fim desconta.
  const limpo = base64.replace(/[^A-Za-z0-9+/=]/g, '');
  const padding = (limpo.match(/=+$/)?.[0].length ?? 0);
  return Math.max(0, Math.floor((limpo.length * 3) / 4) - padding);
}

export interface TriagemAnexos {
  candidatos: AnexoRecebido[];
  descartados: Array<{ nome: string; porque: string }>;
}

/**
 * Separa o que vale tentar ler do que é enfeite de e-mail.
 *
 * PDF primeiro, de propósito: quando o e-mail traz o boleto em PDF e uma
 * imagem qualquer, o PDF é o que tem a linha digitável em texto. Tentar
 * a imagem antes gastaria uma chamada para provavelmente falhar.
 */
export function triarAnexos(anexos: AnexoRecebido[]): TriagemAnexos {
  const candidatos: AnexoRecebido[] = [];
  const descartados: Array<{ nome: string; porque: string }> = [];

  for (const a of anexos ?? []) {
    const nome = typeof a?.nome === 'string' && a.nome.trim() !== '' ? a.nome : 'sem nome';

    if (!a || typeof a.base64 !== 'string' || a.base64.trim() === '') {
      descartados.push({ nome, porque: 'anexo vazio' });
      continue;
    }
    if (!LEGIVEIS.has(a.mime)) {
      descartados.push({ nome, porque: `tipo ${a.mime || 'desconhecido'}` });
      continue;
    }

    const bytes = tamanhoDoBase64(a.base64);

    if (bytes < MINIMO_BYTES) {
      descartados.push({ nome, porque: 'pequeno demais para ser boleto' });
      continue;
    }
    if (bytes > MAXIMO_BYTES) {
      descartados.push({ nome, porque: 'maior que 10 MB' });
      continue;
    }

    candidatos.push({ nome, mime: a.mime, base64: a.base64 });
  }

  candidatos.sort((x, y) => {
    const peso = (m: string) => (m === 'application/pdf' ? 0 : 1);
    return peso(x.mime) - peso(y.mime);
  });

  return { candidatos, descartados };
}

/**
 * Deixa o remetente num tamanho que caiba na coluna, sem perder o que
 * importa.
 *
 * O `From` real vem como `"Banco X - Cobrança" <cobranca@bancox.com.br>`
 * e pode ser longo. O endereço é o que a pessoa reconhece, então ele é
 * o que fica quando precisa cortar.
 */
export function limparRemetente(bruto: unknown): string {
  const texto = typeof bruto === 'string' ? bruto.trim() : '';
  if (texto === '') return 'remetente não informado';

  const entreSinais = texto.match(/<([^>]+)>/);
  const escolhido = entreSinais ? entreSinais[1]!.trim() : texto;

  return escolhido.slice(0, 320);
}
