/**
 * O que acontece quando uma mensagem chega — a orquestração, sozinha.
 *
 * =====================================================================
 * A ORDEM É DELIBERADA: GRAVA PRIMEIRO, RESPONDE DEPOIS
 * =====================================================================
 * Primeiro o lead, depois o histórico, depois a resposta automática. E
 * cada passo tem o seu próprio `try` — falha de um não cancela os
 * outros.
 *
 * É a inversão exata do que o n8n fazia. Lá, os três ramos pareciam
 * paralelos no desenho e não eram: quando a resposta da Evolution
 * falhava, o n8n abortava a execução inteira e levava junto o registro
 * do lead. A pessoa escrevia, e não sobrava nada.
 *
 * A pessoa escreveu. Esse fato precisa sobreviver a um contêiner fora do
 * ar. A saudação automática é a parte descartável.
 *
 * =====================================================================
 * POR QUE AS DEPENDÊNCIAS ENTRAM POR PARÂMETRO
 * =====================================================================
 * Para esta ordem ser testável sem banco e sem rede. A regra "o lead vem
 * antes da mensagem" e a regra "uma falha não contamina o resto" são
 * invisíveis em produção quando quebram — o sintoma é um card que não
 * apareceu, semanas depois, sem erro em lugar nenhum.
 */

import { normalizarEvento, resumoDoEvento } from './evolution.normalizar.js';
import type { MensagemNormalizada } from './evolution.normalizar.js';

export interface Dependencias {
  empresaDaInstancia: (instancia: string) => Promise<string | null>;
  temRecursoCrm: (tenantId: string) => Promise<boolean>;
  registrarLead: (args: {
    tenantId: string;
    telefone: string;
    nome?: string | null;
    waRef?: string | null;
    payload?: unknown;
  }) => Promise<{ lead_id: string | null; criado: boolean; etapa: string | null }>;
  gravarMensagem: (args: {
    instancia: string;
    telefone: string;
    deMim: boolean;
    texto?: string | null;
    tipoMidia?: string | null;
    midiaNome?: string | null;
    waId?: string | null;
    enviadaEm?: string | null;
  }) => Promise<string | null>;
  enviarTexto: (
    instancia: string,
    numero: string,
    texto: string,
  ) => Promise<{ ok: boolean; waId: string | null; erro: string | null }>;
  registrarEvento: (args: {
    instancia: string;
    tenantId?: string | null;
    waId?: string | null;
    motivo?: string | null;
    responder?: boolean;
    registrar?: boolean;
    guardar?: boolean;
    resultado?: unknown;
    erro?: string | null;
    resumo?: unknown;
  }) => Promise<void>;
  aviso?: (dados: Record<string, unknown>, msg: string) => void;
}

export interface Resultado {
  ok: boolean;
  motivo: string;
  tenant_id: string | null;
  lead_id: string | null;
  lead_criado: boolean;
  mensagem_id: string | null;
  respondido: boolean;
  resposta_id: string | null;
  falhas: string[];
  normalizada: MensagemNormalizada;
}

export async function processarEvento(bruto: unknown, dep: Dependencias): Promise<Resultado> {
  const m = normalizarEvento(bruto);
  const resumo = resumoDoEvento(bruto);
  const avisar = dep.aviso ?? (() => {});

  const r: Resultado = {
    ok: false,
    motivo: m.motivo,
    tenant_id: null,
    lead_id: null,
    lead_criado: false,
    mensagem_id: null,
    respondido: false,
    resposta_id: null,
    falhas: [],
    normalizada: m,
  };

  const anota = (passo: string, e: unknown) => {
    const texto = e instanceof Error ? e.message : String(e);
    r.falhas.push(`${passo}: ${texto}`);
    avisar({ passo, erro: texto, instancia: m.instancia }, 'Falha no webhook da Evolution');
  };

  // ---- 1. De quem é esta instância -----------------------------------
  try {
    r.tenant_id = await dep.empresaDaInstancia(m.instancia);
  } catch (e) {
    anota('roteamento', e);
  }

  if (!r.tenant_id) {
    // Nada a fazer, mas fica registrado. É o erro mais provável quando
    // alguém liga um cliente novo, e sem registro ele é invisível.
    r.motivo = m.instancia ? 'instância não cadastrada' : 'evento sem instância';
    avisar({ instancia: m.instancia }, 'Instância de WhatsApp não cadastrada');
    await dep.registrarEvento({
      instancia: m.instancia,
      waId: m.wa_id,
      motivo: r.motivo,
      responder: m.responder,
      registrar: m.registrar,
      guardar: m.guardar,
      resultado: recorte(r),
      erro: r.falhas.join(' | ') || null,
      resumo,
    });
    return r;
  }

  // ---- 2. A empresa tem o CRM? ---------------------------------------
  //
  // Sem o recurso, nada é gravado. Acumular lead invisível numa tela que
  // ninguém abre significa despejar tudo de uma vez no dia em que a
  // empresa contratar — com conversas que ela nunca soube que estavam
  // sendo guardadas.
  let temCrm = false;
  try {
    temCrm = await dep.temRecursoCrm(r.tenant_id);
  } catch (e) {
    anota('recurso', e);
  }

  if (temCrm) {
    // ---- 3. O lead ---------------------------------------------------
    if (m.registrar) {
      try {
        const lead = await dep.registrarLead({
          tenantId: r.tenant_id,
          telefone: m.numero,
          nome: m.contato,
          waRef: m.origem,
          payload: m.contexto,
        });
        r.lead_id = lead.lead_id;
        r.lead_criado = lead.criado;
      } catch (e) {
        anota('lead', e);
      }
    }

    // ---- 4. O histórico ----------------------------------------------
    //
    // Depois do lead de propósito: a função no banco só grava conversa de
    // quem está no funil, e na primeira mensagem o lead acabou de nascer
    // no passo anterior. Invertendo a ordem, a mensagem que abre toda
    // conversa seria a única a se perder — e ela é a que traz o código do
    // anúncio.
    if (m.guardar) {
      try {
        r.mensagem_id = await dep.gravarMensagem({
          instancia: m.instancia,
          telefone: m.numero,
          deMim: m.de_mim,
          texto: m.texto_recebido || null,
          tipoMidia: m.tipo_midia,
          midiaNome: m.midia_nome,
          waId: m.wa_id,
          enviadaEm: m.recebido_em,
        });
      } catch (e) {
        anota('mensagem', e);
      }
    }
  } else {
    r.motivo = 'empresa sem o recurso do CRM';
  }

  // ---- 5. A resposta automática, por último ---------------------------
  if (m.responder && m.resposta) {
    const envio = await dep.enviarTexto(m.instancia, m.numero, m.resposta);
    r.respondido = envio.ok;

    if (!envio.ok) {
      r.falhas.push(`resposta: ${envio.erro}`);
    } else if (temCrm) {
      // Guarda também o que sai daqui. Só metade do diálogo não resolve
      // divergência sobre o que foi combinado — que é para o que este
      // histórico vai ser usado.
      try {
        r.resposta_id = await dep.gravarMensagem({
          instancia: m.instancia,
          telefone: m.numero,
          deMim: true,
          texto: m.resposta,
          waId: envio.waId,
          enviadaEm: new Date().toISOString(),
        });
      } catch (e) {
        anota('resposta no histórico', e);
      }
    }
  }

  r.ok = r.falhas.length === 0;

  await dep.registrarEvento({
    instancia: m.instancia,
    tenantId: r.tenant_id,
    waId: m.wa_id,
    motivo: r.motivo,
    responder: m.responder,
    registrar: m.registrar && temCrm,
    guardar: m.guardar && temCrm,
    resultado: recorte(r),
    erro: r.falhas.join(' | ') || null,
    resumo,
  });

  return r;
}

/** O que vai para a coluna `resultado` do registro de eventos. */
function recorte(r: Resultado) {
  return {
    lead_id: r.lead_id,
    lead_criado: r.lead_criado,
    mensagem_id: r.mensagem_id,
    respondido: r.respondido,
    resposta_id: r.resposta_id,
  };
}
