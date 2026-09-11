/**
 * O envio de e-mail.
 *
 * =====================================================================
 * MESMO SERVIDOR, MESMO REMETENTE
 * =====================================================================
 * Os fluxos de entrada do n8n já mandavam por SMTP, não pelo Gmail —
 * `contato@businesstriage.com.br`, com as credenciais do `emailSend`.
 * Mudar de casa aqui não mexe em SPF, DKIM nem reputação de domínio,
 * porque o servidor e o endereço continuam os mesmos.
 *
 * Quem usa Gmail é só o fluxo das 8h, e é justamente o que quebrou.
 *
 * =====================================================================
 * NUNCA LANÇA
 * =====================================================================
 * Devolve o resultado. Quem chama decide o que fazer — e a decisão certa
 * quase nunca é abortar tudo: o diagnóstico já foi calculado, gravado e
 * tem PDF. Um e-mail que não saiu é um reenvio; um processo abortado no
 * meio é um registro inconsistente que ninguém sabe consertar.
 */

import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from './logger.js';

export interface Anexo {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface EnvioEmail {
  para: string;
  assunto: string;
  html: string;
  anexos?: Anexo[];
  /** Cópia oculta. O fluxo antigo mandava cópia de tudo para o interno. */
  copiaOculta?: string;
}

export interface ResultadoEmail {
  ok: boolean;
  id: string | null;
  erro: string | null;
}

let transporte: Transporter | null = null;

function obterTransporte(): Transporter | null {
  if (!env.SMTP_HOST || !env.SMTP_USER) return null;
  if (transporte) return transporte;

  transporte = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    // 465 é TLS direto; 587 começa em claro e sobe para TLS com STARTTLS.
    // Errar isto dá "connection closed" sem explicação.
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });

  return transporte;
}

export async function enviarEmail(m: EnvioEmail): Promise<ResultadoEmail> {
  const t = obterTransporte();

  if (!t) {
    logger.error({ para: m.para, assunto: m.assunto }, 'SMTP não configurado — e-mail NÃO enviado');
    return { ok: false, id: null, erro: 'SMTP não configurado (SMTP_HOST/SMTP_USER)' };
  }

  try {
    const r = await t.sendMail({
      from: env.EMAIL_REMETENTE,
      to: m.para,
      bcc: m.copiaOculta,
      subject: m.assunto,
      html: m.html,
      attachments: m.anexos,
    });

    logger.info({ para: m.para, id: r.messageId }, 'E-mail enviado');
    return { ok: true, id: r.messageId ?? null, erro: null };
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e);
    logger.error({ para: m.para, assunto: m.assunto, erro }, 'Falha ao enviar e-mail');
    return { ok: false, id: null, erro };
  }
}

/**
 * Confere se o SMTP responde, sem mandar nada.
 *
 * Serve para o deploy: credencial errada só se manifestaria no primeiro
 * diagnóstico de verdade, com um prospect esperando do outro lado.
 */
export async function conferirSmtp(): Promise<ResultadoEmail> {
  const t = obterTransporte();
  if (!t) return { ok: false, id: null, erro: 'SMTP não configurado' };

  try {
    await t.verify();
    return { ok: true, id: null, erro: null };
  } catch (e) {
    return { ok: false, id: null, erro: e instanceof Error ? e.message : String(e) };
  }
}
