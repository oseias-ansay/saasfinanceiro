/**
 * Conversions API da Meta.
 *
 * Traduz um evento da fila em uma requisição para o Graph API e devolve
 * o que a Meta respondeu. Não decide o que enviar — isso é do gatilho no
 * banco — e não persiste nada. Só monta, manda e relata.
 *
 * ---------------------------------------------------------------------
 * O HASH NÃO É PRIVACIDADE, É FORMATO
 * ---------------------------------------------------------------------
 * É tentador ler o SHA-256 exigido pela Meta como uma proteção que
 * resolve a questão de dados pessoais. Não resolve. O hash existe para
 * a Meta comparar sem receber o valor em claro — mas o objetivo da
 * comparação é justamente reencontrar a pessoa, e um telefone brasileiro
 * tem espaço de busca pequeno o bastante para ser revertido por força
 * bruta em minutos.
 *
 * Ou seja: enviar `ph` hasheado É compartilhar dado pessoal com um
 * terceiro, e depende de a política de privacidade dizer isso. O hash
 * satisfaz a Meta, não a LGPD.
 *
 * ---------------------------------------------------------------------
 * NORMALIZAR ANTES DE HASHEAR É A REGRA INTEIRA
 * ---------------------------------------------------------------------
 * Hash não perdoa diferença nenhuma. `+55 (41) 99999-8888` e
 * `5541999998888` são a mesma pessoa e geram hashes completamente
 * diferentes — e o erro é invisível: a Meta aceita o evento, responde
 * 200, e simplesmente não casa com ninguém. A campanha otimiza para
 * nada e ninguém descobre por semanas.
 *
 * Por isso a normalização tem teste próprio. É o ponto onde um engano
 * silencioso custa mais.
 */

import { createHash } from 'node:crypto';

/** A versão do Graph API. Ver o comentário em `env.ts`. */
export interface ConfigCapi {
  datasetId: string;
  accessToken: string;
  apiVersion: string;
  /** Código de teste do Gerenciador de Eventos. Vazio em produção. */
  testEventCode?: string;
}

export interface EventoParaMeta {
  id: string;
  event_id: string;
  event_name: 'Lead' | 'Purchase';
  event_time: string;
  telefone: string | null;
  email: string | null;
  ctwa_clid: string | null;
  valor: number | string | null;
}

/* ==================================================================== */
/* Normalização                                                          */
/* ==================================================================== */

const sha256 = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');

/**
 * Telefone no formato que a Meta espera: só dígitos, com código de país,
 * sem `+`.
 *
 * O tratamento do "55" repete o cuidado de `fn_tel_chave` no banco, e
 * pela mesma razão: DDD 55 existe (Santa Maria, no Rio Grande do Sul).
 * Decidir por prefixo transformaria um número de lá no número de outra
 * pessoa — e, com hash, o erro não deixa rastro nenhum.
 */
export function normalizarTelefone(bruto: string | null): string | null {
  if (!bruto) return null;
  const d = bruto.replace(/\D/g, '');
  if (!d) return null;

  // Já veio com código de país.
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d;

  // Fixo brasileiro: DDD + 8 dígitos.
  if (d.length === 10) return `55${d}`;

  // Onze dígitos são ambíguos, e o teste é que descobriu isso.
  //
  // `14155552671` pode ser um celular brasileiro de DDD 14 ou um número
  // dos Estados Unidos (país 1 + 415 555 2671). Assumir Brasil sempre
  // colava um "55" na frente de números estrangeiros e produzia um hash
  // que casa com uma pessoa real — em outro país.
  //
  // O que desfaz o empate: celular brasileiro de 11 dígitos SEMPRE tem
  // o nono dígito, e ele é sempre 9, logo depois do DDD. Se a terceira
  // casa não for 9, não é número brasileiro de celular.
  if (d.length === 11) return d[2] === '9' ? `55${d}` : d;

  // Qualquer outro comprimento é estrangeiro ou lixo. Devolve os dígitos
  // como vieram, em vez de adivinhar.
  return d.length >= 8 ? d : null;
}

/** Minúsculas e sem espaços nas pontas, como a Meta exige. */
export function normalizarEmail(bruto: string | null): string | null {
  if (!bruto) return null;
  const e = bruto.trim().toLowerCase();
  return e.includes('@') ? e : null;
}

/* ==================================================================== */
/* Montagem                                                              */
/* ==================================================================== */

/**
 * Monta o corpo que vai para a Meta.
 *
 * `action_source: 'business_messaging'` com `messaging_channel: 'whatsapp'`
 * não é detalhe: sem esses dois campos a Meta não entende que a conversão
 * veio de um anúncio de clique-para-WhatsApp, e o `ctwa_clid` é ignorado.
 * A especificação original pedia o padrão de site, que casaria zero
 * eventos nesta campanha.
 */
export function montarPayload(ev: EventoParaMeta, testEventCode?: string) {
  const telefone = normalizarTelefone(ev.telefone);
  const email = normalizarEmail(ev.email);

  const user_data: Record<string, unknown> = {};
  if (telefone) user_data.ph = [sha256(telefone)];
  if (email) user_data.em = [sha256(email)];
  // Não vai hasheado: é identificador de clique, não dado pessoal.
  if (ev.ctwa_clid) user_data.ctwa_clid = ev.ctwa_clid;

  const valor = ev.valor === null ? null : Number(ev.valor);

  const evento: Record<string, unknown> = {
    event_name: ev.event_name,
    // A Meta espera segundos, não milissegundos. Em milissegundos o
    // evento cai no ano 56000 e é recusado — com uma mensagem que não
    // diz isso.
    event_time: Math.floor(new Date(ev.event_time).getTime() / 1000),
    event_id: ev.event_id,
    action_source: 'business_messaging',
    messaging_channel: 'whatsapp',
    user_data,
    custom_data: {
      lead_event_source: 'Business Triage CRM',
      // Declara que o dado veio de um CRM. A Meta usa isto para separar
      // conversão de fundo de funil de evento de navegação.
      event_source: 'crm',
      ...(valor !== null && Number.isFinite(valor) && valor > 0
        ? { value: valor, currency: 'BRL' }
        : {}),
    },
  };

  return {
    data: [evento],
    ...(testEventCode ? { test_event_code: testEventCode } : {}),
  };
}

/* ==================================================================== */
/* Envio                                                                 */
/* ==================================================================== */

export interface ResultadoEnvio {
  ok: boolean;
  status: number;
  corpo: unknown;
  erro?: string;
}

export async function enviarEvento(
  ev: EventoParaMeta,
  cfg: ConfigCapi,
): Promise<ResultadoEnvio> {
  const payload = montarPayload(ev, cfg.testEventCode);
  const url = `https://graph.facebook.com/${cfg.apiVersion}/${cfg.datasetId}/events`;

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // No cabeçalho, e não na query string: token em URL vaza para
        // log de proxy, histórico e relatório de erro.
        Authorization: `Bearer ${cfg.accessToken}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    // Rede caiu ou estourou o tempo. Não sabemos se a Meta recebeu — e é
    // exatamente para este caso que o `event_id` existe: tentar de novo
    // é seguro.
    return { ok: false, status: 0, corpo: null, erro: (e as Error).message };
  }

  let corpo: unknown = null;
  try {
    corpo = await resp.json();
  } catch {
    corpo = { texto: await resp.text().catch(() => '') };
  }

  if (!resp.ok) {
    const c = corpo as { error?: { message?: string; error_user_msg?: string } };
    return {
      ok: false,
      status: resp.status,
      corpo,
      erro: c?.error?.error_user_msg ?? c?.error?.message ?? `HTTP ${resp.status}`,
    };
  }

  // A Meta responde 200 com `events_received` mesmo quando não casou com
  // ninguém. Sucesso aqui significa "recebido", não "atribuído" — e
  // confundir os dois é a forma mais comum de achar que a integração
  // funciona quando ela não está casando nada.
  return { ok: true, status: resp.status, corpo };
}
