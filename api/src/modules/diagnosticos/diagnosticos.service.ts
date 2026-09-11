/**
 * O que o diagnóstico faz no banco e no Storage.
 *
 * Extraído das rotas porque agora há dois caminhos de entrada — o antigo,
 * do n8n, e o novo, direto do site — e os dois precisam fazer exatamente
 * a mesma coisa. Duas cópias divergem em semanas.
 */

import { supabaseAdmin } from '../../lib/supabase.js';
import { fromPostgrest, notFound } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { htmlParaPdf } from '../../lib/pdf.js';
import { env } from '../../config/env.js';
import {
  montarEmailCurto,
  montarHtmlImpressao,
  nomeArquivoPdf,
  type DiagnosticoRegistro,
} from './template.js';

export const BUCKET = 'diagnosticos';

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabaseAdmin as unknown as {
  from: (t: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface DiagnosticoGravado {
  id: string;
  protocolo: string;
  liberar_em: string | null;
  hold_token: string;
  hold_url: string;
  assunto_cliente: string;
  html_cliente: string;
}

/**
 * Grava o diagnóstico.
 *
 * O `liberar_em` é calculado pelo BANCO (`fn_proxima_janela_envio`), não
 * aqui: o fuso do contêiner e o do Postgres já divergiram antes, e essa é
 * a conta que decide se o lead recebe na segunda ou no sábado.
 *
 * A capa do e-mail também sai daqui, num lugar só. O relatório mora no
 * PDF; o e-mail é o que faz a pessoa abrir o anexo. Textos duplicados
 * acabam contando histórias diferentes.
 */
export async function gravarDiagnostico(
  input: Record<string, unknown>,
): Promise<DiagnosticoGravado> {
  const email = montarEmailCurto(input as unknown as DiagnosticoRegistro);

  const { data, error } = await db
    .from('diagnosticos')
    .insert({ ...input, assunto_cliente: email.assunto, html_cliente: email.html })
    .select('id, protocolo, liberar_em, hold_token, assunto_cliente, html_cliente')
    .single();

  if (error) throw fromPostgrest(error);

  logger.info(
    { protocolo: data.protocolo, tipo: input.tipo, liberar_em: data.liberar_em },
    'Diagnóstico gravado',
  );

  return {
    id: data.id,
    protocolo: data.protocolo,
    liberar_em: data.liberar_em,
    hold_token: data.hold_token,
    hold_url: `${env.API_PUBLIC_URL}/diagnosticos/segurar/${data.hold_token}`,
    assunto_cliente: data.assunto_cliente,
    html_cliente: data.html_cliente,
  };
}

/**
 * O PDF do protocolo.
 *
 * A versão do CLIENTE fica no Storage e é servida de lá nas chamadas
 * seguintes — é o que garante que o arquivo revisado e o que chega ao
 * cliente sejam idênticos, byte a byte. Renderizar de novo a cada pedido
 * abriria espaço para o documento mudar entre a revisão e o envio.
 *
 * A versão INTERNA nunca é guardada, de propósito: ela traz o plano de
 * ação completo, que não vai ao cliente. Um segundo arquivo no mesmo
 * bucket só criaria a chance de enviar o errado.
 */
export async function obterPdf(
  protocolo: string,
  interno = false,
): Promise<{ nome: string; conteudo: Buffer }> {
  const { data: registro, error } = await db
    .from('diagnosticos')
    .select('*')
    .eq('protocolo', protocolo)
    .maybeSingle();

  if (error) throw fromPostgrest(error);
  if (!registro) throw notFound('Protocolo não encontrado');

  const reg = registro as DiagnosticoRegistro & { pdf_path?: string | null };
  const nome = nomeArquivoPdf(reg, interno);

  if (interno) {
    const conteudo = await htmlParaPdf(montarHtmlImpressao(reg, { incluirPlano: true }));
    return { nome, conteudo };
  }

  // O sufixo `-v2` invalida os PDFs gerados antes de 09/08/2026, quando o
  // relatório do cliente ainda trazia o plano de ação. Registro apontando
  // para o caminho antigo é renderizado de novo, sem migração nem
  // limpeza manual do Storage.
  const caminho = `${protocolo}-v2.pdf`;
  let pdf: Buffer | null = null;

  if (reg.pdf_path === caminho) {
    const { data: baixado, error: erroDownload } = await supabaseAdmin.storage
      .from(BUCKET)
      .download(caminho);

    if (erroDownload) {
      // Arquivo sumiu do Storage: gerar de novo é melhor que devolver
      // erro. O conteúdo é determinístico, vem do mesmo registro.
      logger.warn({ protocolo, err: erroDownload.message }, 'PDF ausente no Storage, gerando de novo');
    } else {
      pdf = Buffer.from(await baixado.arrayBuffer());
    }
  }

  if (!pdf) {
    pdf = await htmlParaPdf(montarHtmlImpressao(reg));

    const { error: erroUpload } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(caminho, pdf, { contentType: 'application/pdf', upsert: true });

    if (erroUpload) {
      // Falhar o upload não pode impedir a entrega: o PDF está pronto na
      // memória. Só se perde o cache.
      logger.error({ protocolo, err: erroUpload.message }, 'Falha ao guardar o PDF');
    } else {
      await db.from('diagnosticos').update({ pdf_path: caminho }).eq('protocolo', protocolo);
    }
  }

  return { nome, conteudo: pdf };
}

export async function marcarStatus(
  protocolo: string,
  status: 'enviado' | 'falhou' | 'segurado',
  erro?: string | null,
): Promise<void> {
  const { error } = await db.rpc('fn_diagnostico_marcar', {
    p_protocolo: protocolo,
    p_status: status,
    p_erro: erro ?? null,
  });
  if (error) throw fromPostgrest(error);
}

/**
 * O protocolo do atendimento.
 *
 * Oito primeiros dígitos do CNPJ mais o instante em base 36, com `C` no
 * comercial. Não é identificador de banco — é o número que o cliente cita
 * quando liga perguntando do relatório dele.
 */
export function gerarProtocolo(cnpj: string | null | undefined, tipo: 'financeiro' | 'comercial') {
  const base = String(cnpj ?? '00000000').replace(/\D/g, '').slice(0, 8) || '00000000';
  const marca = tipo === 'comercial' ? '-C' : '-';
  return `${base}${marca}${Date.now().toString(36).toUpperCase()}`;
}
