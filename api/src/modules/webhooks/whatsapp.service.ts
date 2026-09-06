/**
 * O que o WhatsApp faz no banco.
 *
 * Existe separado das rotas porque agora há DOIS caminhos de entrada: o
 * antigo, vindo do n8n com o payload já normalizado, e o novo, vindo
 * direto da Evolution. Enquanto a troca não estiver consolidada os dois
 * precisam funcionar, e precisam fazer exatamente a mesma coisa.
 *
 * Duas cópias da mesma regra divergem em semanas — alguém corrige uma e
 * esquece a outra. Aqui há uma cópia só, e o caminho de volta continua
 * sendo apontar o webhook da Evolution para o n8n.
 */

import { supabaseAdmin } from '../../lib/supabase.js';
import { fromPostgrest } from '../../lib/errors.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabaseAdmin as unknown as {
  from: (t: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

/** De qual empresa é esta instância. Nulo se não estiver cadastrada. */
export async function empresaDaInstancia(instancia: string): Promise<string | null> {
  if (!instancia) return null;

  const { data, error } = await db
    .from('whatsapp_instancias')
    .select('tenant_id')
    .eq('instancia', instancia)
    .eq('ativa', true)
    .maybeSingle();

  if (error) throw fromPostgrest(error);
  return (data as { tenant_id: string } | null)?.tenant_id ?? null;
}

export async function temRecursoCrm(tenantId: string): Promise<boolean> {
  const { data, error } = await db.rpc('fn_tenant_tem_recurso', {
    p_tenant_id: tenantId,
    p_recurso: 'crm',
  });
  if (error) throw fromPostgrest(error);
  return data === true;
}

export interface ResultadoLead {
  lead_id: string | null;
  criado: boolean;
  etapa: string | null;
}

/** Põe a pessoa no funil, ou encontra quem já estava. */
export async function registrarLead(args: {
  tenantId: string;
  telefone: string;
  nome?: string | null;
  waRef?: string | null;
  payload?: unknown;
}): Promise<ResultadoLead> {
  const { data, error } = await db.rpc('fn_lead_do_whatsapp', {
    p_tenant_id: args.tenantId,
    p_telefone: args.telefone,
    p_nome: args.nome ?? null,
    p_wa_ref: args.waRef ?? null,
    p_origem: 'anuncio',
    p_payload: args.payload ?? null,
  });
  if (error) throw fromPostgrest(error);

  const r = Array.isArray(data) ? data[0] : data;
  return {
    lead_id: r?.lead_id ?? null,
    criado: r?.criado ?? false,
    etapa: r?.etapa_atual ?? null,
  };
}

/**
 * Guarda uma mensagem no histórico.
 *
 * Devolve nulo em três situações legítimas: instância não cadastrada,
 * empresa sem CRM, e telefone que não corresponde a nenhum lead. A
 * terceira é a regra de escopo — conversa de fornecedor, de conhecido e
 * de engano não é guardada. Nenhuma delas é erro.
 */
export async function gravarMensagem(args: {
  instancia: string;
  telefone: string;
  deMim: boolean;
  texto?: string | null;
  tipoMidia?: string | null;
  midiaNome?: string | null;
  waId?: string | null;
  enviadaEm?: string | null;
}): Promise<string | null> {
  if (!args.texto && !args.tipoMidia) return null;

  const { data, error } = await db.rpc('fn_gravar_mensagem', {
    p_instancia: args.instancia,
    p_telefone: args.telefone,
    p_de_mim: args.deMim,
    p_texto: args.texto ?? null,
    p_tipo_midia: args.tipoMidia ?? null,
    p_midia_nome: args.midiaNome ?? null,
    p_wa_id: args.waId ?? null,
    p_enviada_em: args.enviadaEm ?? new Date().toISOString(),
  });
  if (error) throw fromPostgrest(error);

  return (data as string | null) ?? null;
}

/**
 * Registra que um evento chegou e o que ele virou.
 *
 * NUNCA lança. Está no caminho do atendimento, e diagnóstico que derruba
 * atendimento é pior do que diagnóstico nenhum — foi esse erro, com
 * outro nome, que fez a resposta da Evolution abortar a execução inteira
 * no n8n.
 */
export async function registrarEvento(args: {
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
}): Promise<void> {
  try {
    await db.rpc('fn_registrar_evento_whatsapp', {
      p_instancia: args.instancia,
      p_tenant_id: args.tenantId ?? null,
      p_wa_id: args.waId ?? null,
      p_motivo: args.motivo ?? null,
      p_responder: args.responder ?? null,
      p_registrar: args.registrar ?? null,
      p_guardar: args.guardar ?? null,
      p_resultado: args.resultado ?? null,
      p_erro: args.erro ?? null,
      p_resumo: args.resumo ?? null,
    });
  } catch {
    // Ver o comentário acima.
  }
}
