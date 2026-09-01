/**
 * O WhatsApp entrando no CRM: o contato vira lead, e a conversa fica.
 *
 * ---------------------------------------------------------------------
 * A EMPRESA VEM DA INSTÂNCIA, NÃO DO CORPO
 * ---------------------------------------------------------------------
 * A primeira versão recebia `tenant_id` do n8n, com o valor fixo no nó.
 * Funcionava com uma empresa e não sobreviveria à segunda: cada cliente
 * novo exigiria duplicar o fluxo, e dez cópias do mesmo fluxo divergem
 * em semanas — alguém corrige uma e esquece as outras.
 *
 * Agora a Evolution manda o nome da instância em todo evento, e a tabela
 * `whatsapp_instancias` diz de quem ela é. Um fluxo atende a rede
 * inteira, e ligar um cliente novo é uma linha no banco.
 *
 * O efeito colateral é bom: o n8n deixa de poder escrever em qualquer
 * empresa. Ele só alcança a que estiver ligada à instância que
 * realmente lhe entregou a mensagem.
 *
 * ---------------------------------------------------------------------
 * O QUE ESTAS ROTAS RECUSAM A FAZER
 * ---------------------------------------------------------------------
 * Não movem etapa, não qualificam, não escrevem valor. Colocam a pessoa
 * no quadro e guardam o que foi dito. Quem qualifica é gente olhando a
 * conversa.
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { supabaseAdmin } from '../../lib/supabase.js';
import { fromPostgrest, badRequest } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { requireWebhookSecret } from './secret.js';

export const whatsappRouter = Router();

whatsappRouter.use(
  // Mais folgado que os outros webhooks: conversa chega em rajada, e
  // várias pessoas escrevendo ao mesmo tempo durante a campanha é o
  // cenário esperado, não o abuso.
  rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: true, legacyHeaders: false }),
  requireWebhookSecret,
);

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabaseAdmin as unknown as {
  from: (t: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

/** De qual empresa é esta instância. Nulo se não estiver cadastrada. */
async function empresaDaInstancia(instancia: string): Promise<string | null> {
  const { data, error } = await db
    .from('whatsapp_instancias')
    .select('tenant_id')
    .eq('instancia', instancia)
    .eq('ativa', true)
    .maybeSingle();

  if (error) throw fromPostgrest(error);
  return (data as { tenant_id: string } | null)?.tenant_id ?? null;
}

/* ==================================================================== */
/* O contato vira lead                                                   */
/* ==================================================================== */

const contatoSchema = z.object({
  instancia: z.string().trim().min(1).max(80),
  telefone: z.string().trim().min(8).max(30),
  nome: z.string().trim().max(160).nullish(),
  /** O `(ref: …)` da mensagem pré-escrita, quando houver. */
  wa_ref: z.string().trim().max(40).nullish(),
  /**
   * O contexto que a Evolution entregou junto da primeira mensagem.
   *
   * Guardado sem interpretação — ver `contato_payload` no arquivo 30 do
   * SQL. É a única chance de descobrir o que um clique de anúncio traz.
   */
  payload: z.unknown().nullish(),
});

/**
 * Responde 200 mesmo quando o lead já existia.
 *
 * Do ponto de vista do n8n o resultado é o mesmo — a pessoa está no
 * quadro — e devolver erro faria o fluxo marcar como falha a segunda
 * mensagem de toda conversa, enchendo a lista de execuções de vermelho
 * que não significa nada. Execução vermelha rotineira treina quem olha
 * a ignorá-la, e aí a falha que importa passa batido.
 */
whatsappRouter.post('/contato', async (req, res, next) => {
  try {
    const parsed = contatoSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'Dados inválidos');
    const body = parsed.data;

    const tenantId = await empresaDaInstancia(body.instancia);
    if (!tenantId) {
      logger.warn({ instancia: body.instancia }, 'Instância de WhatsApp não cadastrada');
      return res.json({ data: { registrado: false, motivo: 'instancia_desconhecida' } });
    }

    // Sem o recurso, nada é gravado. Acumular lead invisível numa tela
    // que ninguém abre significa despejar tudo de uma vez no dia em que
    // a empresa contratar — com conversas que ela nunca soube que
    // estavam sendo guardadas.
    const { data: temCrm, error: errRec } = await db.rpc('fn_tenant_tem_recurso', {
      p_tenant_id: tenantId,
      p_recurso: 'crm',
    });
    if (errRec) throw fromPostgrest(errRec);
    if (!temCrm) return res.json({ data: { registrado: false, motivo: 'sem_crm' } });

    const { data, error } = await db.rpc('fn_lead_do_whatsapp', {
      p_tenant_id: tenantId,
      p_telefone: body.telefone,
      p_nome: body.nome ?? null,
      p_wa_ref: body.wa_ref ?? null,
      p_origem: 'anuncio',
      p_payload: body.payload ?? null,
    });
    if (error) throw fromPostgrest(error);

    const r = Array.isArray(data) ? data[0] : data;

    logger.info(
      { tenant: tenantId, lead: r?.lead_id, criado: r?.criado, ref: body.wa_ref },
      r?.criado ? 'Lead criado pelo WhatsApp' : 'Contato de lead já existente',
    );

    res.json({
      data: {
        registrado: true,
        lead_id: r?.lead_id ?? null,
        criado: r?.criado ?? false,
        etapa: r?.etapa_atual ?? null,
      },
    });
  } catch (e) {
    next(e);
  }
});

/* ==================================================================== */
/* A conversa fica                                                       */
/* ==================================================================== */

const mensagemSchema = z.object({
  instancia: z.string().trim().min(1).max(80),
  telefone: z.string().trim().min(8).max(30),
  de_mim: z.boolean(),
  texto: z.string().max(20_000).nullish(),
  tipo_midia: z
    .enum(['audio', 'imagem', 'documento', 'video', 'figurinha', 'localizacao', 'contato'])
    .nullish(),
  midia_nome: z.string().max(200).nullish(),
  wa_id: z.string().max(120).nullish(),
  enviada_em: z.string().datetime().nullish(),
});

/**
 * Guarda uma mensagem.
 *
 * A função no banco devolve nulo — e esta rota responde 200 com
 * `gravada: false` — em três situações legítimas: instância não
 * cadastrada, empresa sem CRM, e telefone que não corresponde a nenhum
 * lead. A terceira é a regra de escopo: conversa de fornecedor, de
 * conhecido e de engano não é guardada.
 *
 * Nenhuma delas é erro, e tratá-las como erro encheria o log de alarme
 * falso justamente no caminho mais movimentado do sistema.
 */
whatsappRouter.post('/mensagem', async (req, res, next) => {
  try {
    const parsed = mensagemSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'Dados inválidos');
    const b = parsed.data;

    if (!b.texto && !b.tipo_midia) {
      return res.json({ data: { gravada: false, motivo: 'sem_conteudo' } });
    }

    const { data, error } = await db.rpc('fn_gravar_mensagem', {
      p_instancia: b.instancia,
      p_telefone: b.telefone,
      p_de_mim: b.de_mim,
      p_texto: b.texto ?? null,
      p_tipo_midia: b.tipo_midia ?? null,
      p_midia_nome: b.midia_nome ?? null,
      p_wa_id: b.wa_id ?? null,
      p_enviada_em: b.enviada_em ?? new Date().toISOString(),
    });
    if (error) throw fromPostgrest(error);

    res.json({ data: { gravada: data !== null, id: data ?? null } });
  } catch (e) {
    next(e);
  }
});

/* ==================================================================== */
/* O expurgo                                                             */
/* ==================================================================== */

/**
 * Apaga o que passou do prazo. Chamado uma vez por dia pelo n8n.
 *
 * Registra quantas linhas apagou. Apagamento silencioso é
 * indistinguível de apagamento que não aconteceu — e este mecanismo é o
 * que sustenta a promessa de retenção feita ao cliente.
 */
whatsappRouter.post('/purgar', async (_req, res, next) => {
  try {
    const { data, error } = await db.rpc('fn_purgar_mensagens');
    if (error) throw fromPostgrest(error);

    logger.info({ apagadas: data ?? 0 }, 'Expurgo de mensagens executado');
    res.json({ data: { apagadas: data ?? 0 } });
  } catch (e) {
    next(e);
  }
});
