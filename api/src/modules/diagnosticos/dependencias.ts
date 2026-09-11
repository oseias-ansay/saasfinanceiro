/**
 * As dependências reais da orquestração: régua, Claude, banco, PDF, SMTP.
 *
 * Este arquivo é a única parte da cadeia que toca o mundo. `processar.ts`
 * continua sem saber o que é banco, rede ou `.env` — é o que permite
 * testar a ordem dos passos e o isolamento das falhas sem configuração
 * nenhuma.
 */

import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { gerarAnalise } from '../../lib/claude.js';
import { enviarEmail } from '../../lib/email.js';
import { calcularRegua, type ResultadoRegua } from '../regua/regua.js';
import { calcularReguaComercial, type ResultadoComercial } from '../regua/regua-comercial.js';
import {
  esquemaAnaliseComercial,
  esquemaAnaliseFinanceira,
  extrairJson,
  montarPromptComercial,
  montarPromptFinanceiro,
  type AnaliseComercial,
  type AnaliseFinanceira,
} from './analise.js';
import { gravarDiagnostico, marcarStatus, obterPdf } from './diagnosticos.service.js';
import { registrarConsumo, reservarChamada } from './orcamento.js';
import { esc } from './template.js';
import type { Dependencias, TipoDiagnostico } from './processar.js';

const rotulo: Record<TipoDiagnostico, string> = {
  financeiro: 'Financeiro',
  comercial: 'Comercial',
};

export const dependenciasReais: Dependencias = {
  calcular: (tipo, entrada) =>
    tipo === 'comercial'
      ? calcularReguaComercial(entrada)
      : calcularRegua(entrada as Parameters<typeof calcularRegua>[0]),

  montarPrompt: (tipo, lead, entrada, regua) => {
    // Só setor, mês, funcionários e regime. Razão social, CNPJ, e-mail e
    // telefone ficam de fora — é a promessa da página de privacidade, e
    // ela é cumprida aqui, não pedindo ao modelo.
    const publico = {
      setor: lead.setor,
      mes_referencia: lead.mes_referencia,
      num_funcionarios: lead.num_funcionarios,
    };

    return tipo === 'comercial'
      ? montarPromptComercial(publico, regua as ResultadoComercial)
      : montarPromptFinanceiro(publico, entrada, regua as ResultadoRegua);
  },

  analisar: async (tipo, prompt) => {
    // Reserva ANTES de falar com o modelo. Depois seria contabilizar o
    // que já foi gasto, que é o oposto de um teto.
    await reservarChamada();

    const { analise, consumo } =
      tipo === 'comercial'
        ? await gerarAnalise(prompt, esquemaAnaliseComercial, extrairJson)
        : await gerarAnalise(prompt, esquemaAnaliseFinanceira, extrairJson);

    await registrarConsumo(consumo.entrada, consumo.saida);

    return analise as AnaliseFinanceira | AnaliseComercial;
  },

  gravar: async (dados) => {
    const g = await gravarDiagnostico(dados);
    return {
      protocolo: g.protocolo,
      assunto_cliente: g.assunto_cliente,
      html_cliente: g.html_cliente,
      liberar_em: g.liberar_em,
      hold_token: g.hold_token,
    };
  },

  pdf: (protocolo, interno) => obterPdf(protocolo, interno),

  enviarEmail: async (m) => {
    const r = await enviarEmail({
      para: m.para,
      assunto: m.assunto,
      html: m.html,
      anexos: m.anexos,
      copiaOculta: m.copiaOculta,
    });
    return { ok: r.ok, erro: r.erro };
  },

  marcarEnviado: (protocolo) => marcarStatus(protocolo, 'enviado'),

  /**
   * O aviso que chega para você.
   *
   * Traz o link "Segurar" quando o relatório ainda não saiu, e a lista de
   * falhas quando houve alguma. Um aviso que só diz "chegou um lead" faz
   * você abrir o banco para descobrir o resto; este já diz o que houve e
   * o que dá para fazer a respeito.
   */
  avisoInterno: ({ tipo, lead, registro, regua, politica, falhas }) => {
    const score = regua.score.scoreTotal;
    const nivel = 'nivelSaude' in regua.score ? regua.score.nivelSaude : regua.score.nivelMaturidade;

    const linha = (r: string, v: string) =>
      `<tr><td style="padding:4px 10px 4px 0;color:#64748B;">${esc(r)}</td><td style="padding:4px 0;color:#0B1E3B;"><strong>${esc(v)}</strong></td></tr>`;

    const problemas = falhas.length
      ? `<p style="margin:16px 0 6px;color:#B91C1C;"><strong>Falhas nesta execução:</strong></p>
         <ul style="margin:0 0 12px;color:#B91C1C;">${falhas.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>`
      : '';

    const janela =
      politica === 'janela'
        ? `<p style="margin:16px 0;">O relatório sai em <strong>${esc(registro.liberar_em ?? 'próxima janela')}</strong>.<br>
           Para impedir o envio: <a href="${esc(env.API_PUBLIC_URL)}/diagnosticos/segurar/${esc(registro.hold_token)}">segurar este diagnóstico</a>.</p>`
        : `<p style="margin:16px 0;">O relatório <strong>já foi enviado</strong> ao cliente.</p>`;

    return {
      para: env.EMAIL_INTERNO,
      assunto: `[${rotulo[tipo]}] ${lead.razao_social ?? 'Sem razão social'} — score ${score} (${nivel})`,
      html: `<div style="font-family:Arial,sans-serif;color:#334155;">
        <h2 style="color:#0B1E3B;margin:0 0 12px;">Diagnóstico ${esc(rotulo[tipo])}</h2>
        <table style="border-collapse:collapse;font-size:14px;">
          ${linha('Protocolo', registro.protocolo)}
          ${linha('Empresa', lead.razao_social ?? '—')}
          ${linha('CNPJ', lead.cnpj ?? '—')}
          ${linha('E-mail', lead.email)}
          ${linha('Telefone', lead.telefone ?? '—')}
          ${linha('Setor', lead.setor ?? '—')}
          ${linha('Score', `${score} — ${nivel}`)}
        </table>
        ${problemas}
        ${janela}
      </div>`,
    };
  },

  confirmacaoAoLead: ({ lead, registro }) => ({
    assunto: 'Recebemos os dados da sua empresa',
    html: `<div style="font-family:Arial,sans-serif;color:#334155;">
      <p>Recebemos as informações${lead.razao_social ? ` da ${esc(lead.razao_social)}` : ''}.</p>
      <p>O relatório completo é revisado e enviado <strong>no próximo dia útil pela manhã</strong>, em PDF, sem custo.</p>
      <p style="color:#64748B;font-size:13px;">Protocolo: <strong>${esc(registro.protocolo)}</strong></p>
    </div>`,
  }),

  aviso: (dados, msg) => logger.error(dados, msg),
};
