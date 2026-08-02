//
// Diagnósticos financeiro e comercial — persistência e fila de envio.
//
// O formulário público do site posta no n8n; o n8n calcula, chama a IA e
// grava aqui. O relatório NÃO sai na hora: fica em fila até o próximo dia
// útil às 8h. Entre uma coisa e outra existe uma janela em que o e-mail
// interno permite segurar o envio — que é o motivo de tudo isso existir.
//
// São prospects, não clientes. Nada aqui pertence a um tenant e nenhum
// usuário do SaaS enxerga esta tabela.

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { fromPostgrest, badRequest, notFound } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { htmlParaPdf } from '../../lib/pdf.js';
import {
  montarEmailCurto,
  montarHtmlImpressao,
  nomeArquivoPdf,
  type DiagnosticoRegistro,
} from '../diagnosticos/template.js';
import { requireWebhookSecret } from './secret.js';

const BUCKET = 'diagnosticos';

/**
 * A tabela `diagnosticos` é nova e ainda não está no database.types.ts
 * gerado. Este apelido concentra a falta de tipo em um ponto só, em vez
 * de espalhar `as never` por todas as chamadas.
 *
 * Ao regerar os tipos (ver README da API), apague este bloco e volte a
 * usar `supabaseAdmin` diretamente — o compilador passa a cobrir estas
 * consultas de novo.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabaseAdmin as unknown as {
  from: (tabela: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------
// Rotas para o n8n (protegidas por segredo compartilhado)
// ---------------------------------------------------------------------
export const diagnosticosRouter = Router();

diagnosticosRouter.use(
  rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false }),
  requireWebhookSecret,
);

const registrarSchema = z.object({
  protocolo: z.string().min(3).max(64),
  tipo: z.enum(['financeiro', 'comercial']),

  razao_social: z.string().max(200).optional(),
  cnpj: z.string().max(20).optional(),
  email: z.string().email('E-mail do lead inválido'),
  telefone: z.string().max(40).optional(),
  setor: z.string().max(120).optional(),
  mes_referencia: z.string().max(20).optional(),

  score_total: z.number().int().min(0).max(100).optional(),
  nivel: z.string().max(60).optional(),
  entrada: z.record(z.unknown()).default({}),
  indicadores: z.record(z.unknown()).default({}),
  alertas: z.array(z.record(z.unknown())).default([]),
  analise: z.record(z.unknown()).default({}),
});

/**
 * Grava o diagnóstico e devolve a janela de envio e o link "Segurar".
 *
 * O `liberar_em` é calculado pelo banco (fn_proxima_janela_envio), não
 * pelo n8n: o fuso do container e o do Postgres já divergiram antes, e
 * essa é a conta que decide se o lead recebe na segunda ou no sábado.
 *
 * O corpo do e-mail é montado aqui, e não no n8n. O relatório mora no
 * PDF; o e-mail é só a capa que faz a pessoa abrir o anexo. Manter esse
 * texto num lugar só evita que a mensagem ao cliente e o documento
 * contem histórias diferentes.
 */
diagnosticosRouter.post('/', async (req, res, next) => {
  try {
    const parsed = registrarSchema.safeParse(req.body);
    if (!parsed.success) {
      return next(badRequest('Payload de diagnóstico inválido', parsed.error.flatten().fieldErrors));
    }
    const input = parsed.data;
    const email = montarEmailCurto(input as DiagnosticoRegistro);

    const { data, error } = await db
      .from('diagnosticos')
      .insert({ ...input, assunto_cliente: email.assunto, html_cliente: email.html })
      .select('id, protocolo, liberar_em, hold_token')
      .single();

    if (error) throw fromPostgrest(error);

    logger.info(
      { protocolo: data.protocolo, tipo: input.tipo, liberar_em: data.liberar_em },
      'Diagnóstico enfileirado',
    );

    res.status(201).json({
      id: data.id,
      protocolo: data.protocolo,
      liberar_em: data.liberar_em,
      hold_url: `${env.API_PUBLIC_URL}/diagnosticos/segurar/${data.hold_token}`,
    });
  } catch (e) {
    next(e);
  }
});

/** Fila liberada — consumida pelo cron das 8h. */
diagnosticosRouter.get('/fila', async (req, res, next) => {
  try {
    const limite = Number(req.query.limite ?? 50);
    const { data, error } = await db.rpc('fn_diagnosticos_para_enviar', {
      p_limite: Number.isFinite(limite) ? limite : 50,
    });
    if (error) throw fromPostgrest(error);

    const itens = data ?? [];
    logger.info({ total: itens.length }, 'Fila de diagnósticos consultada');
    res.json({ consultado_em: new Date().toISOString(), total: itens.length, itens });
  } catch (e) {
    next(e);
  }
});

/**
 * Devolve o relatório em PDF.
 *
 * Renderiza na primeira chamada e guarda no Storage. As seguintes servem
 * o mesmo arquivo — é o que garante que o PDF revisado no Drive e o que
 * chega ao cliente às 8h sejam idênticos, byte a byte. Renderizar de novo
 * abriria espaço para o documento mudar entre a revisão e o envio.
 */
diagnosticosRouter.get('/:protocolo/pdf', async (req, res, next) => {
  try {
    const { data: registro, error } = await db
      .from('diagnosticos')
      .select('*')
      .eq('protocolo', req.params.protocolo)
      .maybeSingle();

    if (error) throw fromPostgrest(error);
    if (!registro) return next(notFound('Protocolo não encontrado'));

    const arquivo = nomeArquivoPdf(registro as DiagnosticoRegistro);
    let pdf: Buffer | null = null;

    if (registro.pdf_path) {
      const { data: baixado, error: erroDownload } = await supabaseAdmin.storage
        .from(BUCKET)
        .download(registro.pdf_path);

      if (erroDownload) {
        // Arquivo sumiu do Storage: melhor gerar de novo do que devolver
        // erro. O conteúdo continua determinístico, vem do mesmo registro.
        logger.warn(
          { protocolo: registro.protocolo, err: erroDownload.message },
          'PDF ausente no Storage, gerando novamente',
        );
      } else {
        pdf = Buffer.from(await baixado.arrayBuffer());
      }
    }

    if (!pdf) {
      pdf = await htmlParaPdf(montarHtmlImpressao(registro as DiagnosticoRegistro));

      const caminho = `${registro.protocolo}.pdf`;
      const { error: erroUpload } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(caminho, pdf, { contentType: 'application/pdf', upsert: true });

      if (erroUpload) {
        // Falhar o upload não pode impedir a entrega: o PDF está pronto
        // na memória. Só perde o cache, e a próxima chamada renderiza.
        logger.error({ protocolo: registro.protocolo, err: erroUpload.message }, 'Falha ao guardar o PDF');
      } else {
        await db.from('diagnosticos').update({ pdf_path: caminho }).eq('protocolo', registro.protocolo);
      }
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${arquivo}"`);
    res.setHeader('Content-Length', String(pdf.length));
    res.send(pdf);
  } catch (e) {
    next(e);
  }
});

/** Resultado do envio, item a item. */
diagnosticosRouter.post('/:protocolo/status', async (req, res, next) => {
  try {
    const status = String(req.body?.status ?? '');
    if (!['enviado', 'falhou', 'segurado'].includes(status)) {
      return next(badRequest('status deve ser enviado, falhou ou segurado'));
    }

    const { data, error } = await db.rpc('fn_diagnostico_marcar', {
      p_protocolo: req.params.protocolo,
      p_status: status,
      p_erro: req.body?.erro ? String(req.body.erro).slice(0, 500) : null,
    });

    if (error) {
      // A função levanta no_data_found quando o protocolo não existe.
      if (error.code === 'P0002' || /não encontrado/i.test(error.message ?? '')) {
        return next(notFound('Protocolo não encontrado'));
      }
      throw fromPostgrest(error);
    }

    res.json({ protocolo: req.params.protocolo, status: data });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------
// Rota pública: o link "Segurar" do e-mail interno
//
// Sem autenticação por desenho — é um link clicado no celular, às pressas,
// antes das 8h. A proteção é o token de 122 bits, que só serve para este
// diagnóstico e só funciona enquanto ele ainda não saiu.
// ---------------------------------------------------------------------
export const diagnosticosPublicRouter = Router();

diagnosticosPublicRouter.use(
  rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false }),
);

function pagina(titulo: string, mensagem: string, cor: string) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${titulo}</title></head>
<body style="margin:0;background:#F1F5F9;font-family:Inter,Arial,Helvetica,sans-serif;">
<div style="max-width:520px;margin:14vh auto;background:#fff;border-radius:14px;padding:34px 30px;">
  <div style="font-size:13px;font-weight:800;color:#0B1E3B;letter-spacing:-0.01em;">Business Triage</div>
  <h1 style="font-size:21px;font-weight:800;color:${cor};margin:14px 0 10px;">${titulo}</h1>
  <p style="margin:0;color:#334155;font-size:15px;line-height:1.65;">${mensagem}</p>
</div></body></html>`;
}

diagnosticosPublicRouter.get('/segurar/:token', async (req, res) => {
  const token = String(req.params.token ?? '');

  // Formato conferido antes de ir ao banco: 64 hexadecimais, dois UUIDs.
  if (!/^[0-9a-f]{64}$/.test(token)) {
    return res
      .status(400)
      .type('html')
      .send(pagina('Link inválido', 'Confira se o endereço foi copiado por inteiro.', '#DC2626'));
  }

  try {
    const { data, error } = await db.rpc('fn_diagnostico_segurar', { p_token: token });
    if (error) throw error;

    if (data?.ok) {
      logger.info({ protocolo: data.protocolo }, 'Diagnóstico segurado');
      return res.type('html').send(
        pagina(
          'Envio suspenso',
          `O relatório de <strong>${data.empresa ?? 'a empresa'}</strong> não será enviado às 8h.
           Protocolo ${data.protocolo}. Revise e libere quando quiser.`,
          '#0B1E3B',
        ),
      );
    }

    if (data?.motivo === 'ja_processado') {
      return res.type('html').send(
        pagina(
          'Já era tarde',
          `Este diagnóstico está com status <strong>${data.status}</strong> e não pode mais ser
           segurado. Se já foi enviado, o cliente recebeu o relatório.`,
          '#D97706',
        ),
      );
    }

    return res
      .status(404)
      .type('html')
      .send(pagina('Link não encontrado', 'Este link não corresponde a nenhum diagnóstico.', '#DC2626'));
  } catch (e) {
    logger.error({ err: e }, 'Falha ao segurar diagnóstico');
    return res
      .status(500)
      .type('html')
      .send(pagina('Erro no servidor', 'Não foi possível processar agora. Tente novamente.', '#DC2626'));
  }
});
