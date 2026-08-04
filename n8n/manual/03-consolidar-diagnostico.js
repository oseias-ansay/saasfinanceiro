// ============================================================
// Consolida o JSON final no schema definido e monta os e-mails.
// Os números vêm do nó de cálculo; da IA vêm apenas os textos.
// ============================================================

const dados = $('Calcular Indicadores e Score').first().json;
const saida = $input.first().json;
const s = dados.score;

// ---------- Parse tolerante do JSON devolvido pelo modelo ----------
let ia;
try {
  const bruto = String(saida.text || saida.response || '')
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/, '')
    .trim();
  const ini = bruto.indexOf('{');
  const fim = bruto.lastIndexOf('}');
  ia = JSON.parse(ini >= 0 && fim > ini ? bruto.slice(ini, fim + 1) : bruto);
} catch (err) {
  ia = {
    resumoExecutivo: 'A análise textual automática falhou nesta execução (' + err.message + '). A pontuação e os indicadores abaixo foram calculados normalmente e permanecem válidos.',
    avaliacoes: {},
    gargalosIdentificados: [],
    planoDeAcao: [],
    relatorioDetalhadoHtml: ''
  };
}

const av = ia.avaliacoes || {};

// ---------- Objeto final no schema definido ----------
const diagnostico = {
  diagnostico: {
    scoreTotal: s.scoreTotal,
    nivelSaude: s.nivelSaude,
    corIdentificadora: s.corIdentificadora,
    resumoExecutivo: ia.resumoExecutivo || ''
  },
  pilares: {
    lucratividade: {
      pontos: s.pilares.lucratividade.pontos,
      max: 35,
      margemLiquidaPercentual: s.pilares.lucratividade.margemLiquidaPercentual,
      'margemContribuiçãoPercentual': s.pilares.lucratividade['margemContribuiçãoPercentual'],
      avaliacao: av.lucratividade || ''
    },
    liquidez: {
      pontos: s.pilares.liquidez.pontos,
      max: 30,
      reservaMeses: s.pilares.liquidez.reservaMeses,
      cicloFinanceiroDias: s.pilares.liquidez.cicloFinanceiroDias,
      avaliacao: av.liquidez || ''
    },
    endividamento: {
      pontos: s.pilares.endividamento.pontos,
      max: 20,
      comprometimentoReceitaPercentual: s.pilares.endividamento.comprometimentoReceitaPercentual,
      avaliacao: av.endividamento || ''
    },
    governanca: {
      pontos: s.pilares.governanca.pontos,
      max: 15,
      avaliacao: av.governanca || ''
    }
  },
  gargalosIdentificados: Array.isArray(ia.gargalosIdentificados) ? ia.gargalosIdentificados : [],
  planoDeAcao: Array.isArray(ia.planoDeAcao) ? ia.planoDeAcao : []
};

// ---------- Helpers de renderização ----------
const brl = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = t => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cor = s.corIdentificadora;
const empresa = dados.identificacao.razao_social || 'Empresa';
const geradoEm = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

const barra = (rot, p, max) => `<tr>
  <td style='padding:7px 0;font-size:13px;color:#334155;width:42%;'>${rot}</td>
  <td style='padding:7px 0;'><div style='background:#E2E8F0;border-radius:6px;height:8px;'><div style='background:${cor};height:8px;border-radius:6px;width:${Math.round((p / max) * 100)}%;'></div></div></td>
  <td style='padding:7px 0 7px 12px;font-size:13px;font-weight:700;color:#0B1E3B;white-space:nowrap;'>${p}/${max}</td>
</tr>`;

const painelPilares = `<table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='margin-top:6px;'>
  ${barra('Lucratividade e Eficiência', s.pilares.lucratividade.pontos, 35)}
  ${barra('Liquidez e Capital de Giro', s.pilares.liquidez.pontos, 30)}
  ${barra('Endividamento e Risco', s.pilares.endividamento.pontos, 20)}
  ${barra('Governança e Mercado', s.pilares.governanca.pontos, 15)}
</table>`;

const blocoPilar = (titulo, p, max, texto) => texto ? `<h3 style='font-size:15px;font-weight:700;color:#0B1E3B;margin:18px 0 6px;'>${titulo} <span style='font-weight:600;color:#64748B;font-size:13px;'>(${p}/${max})</span></h3><p style='margin:0 0 12px;color:#334155;'>${esc(texto)}</p>` : '';

const gargalosHtml = diagnostico.gargalosIdentificados.length
  ? `<h2 style='font-size:18px;font-weight:800;color:#0B1E3B;margin:26px 0 10px;'>Gargalos identificados</h2><ul style='margin:0 0 12px;padding-left:20px;color:#334155;'>${diagnostico.gargalosIdentificados.map(g => `<li style='margin-bottom:7px;'>${esc(g)}</li>`).join('')}</ul>`
  : '';

const corPrioridade = { Alta: '#DC2626', Média: '#D97706', Media: '#D97706', Baixa: '#059669' };
const planoHtml = diagnostico.planoDeAcao.length
  ? `<h2 style='font-size:18px;font-weight:800;color:#0B1E3B;margin:26px 0 10px;'>Plano de ação</h2>
<table style='width:100%;border-collapse:collapse;margin:12px 0;font-size:13px;'>
<tr><th style='background:#0B1E3B;color:#fff;text-align:left;padding:8px 10px;'>Prioridade</th><th style='background:#0B1E3B;color:#fff;text-align:left;padding:8px 10px;'>Pilar</th><th style='background:#0B1E3B;color:#fff;text-align:left;padding:8px 10px;'>Ação recomendada</th></tr>
${diagnostico.planoDeAcao.map(a => `<tr><td style='border-bottom:1px solid #E2E8F0;padding:8px 10px;font-weight:700;color:${corPrioridade[a.prioridade] || '#334155'};white-space:nowrap;'>${esc(a.prioridade)}</td><td style='border-bottom:1px solid #E2E8F0;padding:8px 10px;color:#64748B;white-space:nowrap;'>${esc(a.pilar)}</td><td style='border-bottom:1px solid #E2E8F0;padding:8px 10px;color:#334155;'>${esc(a.acaoRecomendada)}</td></tr>`).join('')}
</table>`
  : '';

// ---------- E-mail do cliente ----------
const htmlCliente = `<!DOCTYPE html><html lang='pt-BR'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'></head>
<body style='margin:0;padding:0;background:#F1F5F9;font-family:Inter,Arial,Helvetica,sans-serif;'>
<table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='background:#F1F5F9;padding:24px 12px;'>
<tr><td align='center'>
<table role='presentation' width='660' cellpadding='0' cellspacing='0' style='max-width:660px;width:100%;background:#FFFFFF;border-radius:14px;overflow:hidden;'>
  <tr><td style='background:#0B1E3B;padding:26px 30px;'>
    <div style='font-size:20px;font-weight:800;color:#FFFFFF;letter-spacing:-0.02em;'>Business Triage</div>
    <div style='font-size:13px;color:#94A3B8;margin-top:4px;'>Relatório de Diagnóstico Financeiro</div>
  </td></tr>
  <tr><td style='padding:24px 30px 0;'>
    <div style='font-size:15px;font-weight:700;color:#0B1E3B;margin-bottom:14px;'>${esc(empresa)} &middot; ${esc(dados.identificacao.mes_referencia || '')}</div>
    <table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='border:1px solid #E2E8F0;border-radius:12px;'>
      <tr><td style='padding:18px 20px;'>
        <table role='presentation' width='100%' cellpadding='0' cellspacing='0'><tr>
          <td style='vertical-align:middle;'>
            <div style='font-size:11px;color:#64748B;text-transform:uppercase;letter-spacing:0.06em;font-weight:600;'>Score financeiro</div>
            <div style='font-size:38px;font-weight:800;color:${cor};line-height:1.1;margin-top:2px;'>${s.scoreTotal}<span style='font-size:18px;color:#94A3B8;font-weight:700;'>/100</span></div>
          </td>
          <td style='vertical-align:middle;text-align:right;'>
            <span style='display:inline-block;background:${cor};color:#FFFFFF;font-size:13px;font-weight:800;padding:8px 18px;border-radius:999px;'>${s.nivelSaude}</span>
          </td>
        </tr></table>
        ${painelPilares}
      </td></tr>
    </table>
  </td></tr>
  <tr><td style='padding:22px 30px 0;'>
    <h2 style='font-size:18px;font-weight:800;color:#0B1E3B;margin:0 0 10px;'>Resumo executivo</h2>
    <p style='margin:0 0 12px;color:#334155;font-size:14px;line-height:1.7;'>${esc(diagnostico.diagnostico.resumoExecutivo)}</p>
    ${blocoPilar('Lucratividade e Eficiência', s.pilares.lucratividade.pontos, 35, av.lucratividade)}
    ${blocoPilar('Liquidez e Capital de Giro', s.pilares.liquidez.pontos, 30, av.liquidez)}
    ${blocoPilar('Endividamento e Risco', s.pilares.endividamento.pontos, 20, av.endividamento)}
    ${blocoPilar('Governança e Mercado', s.pilares.governanca.pontos, 15, av.governanca)}
    ${gargalosHtml}
    ${planoHtml}
  </td></tr>
  <tr><td style='padding:0 30px 26px;font-size:14px;line-height:1.7;color:#334155;'>
    ${ia.relatorioDetalhadoHtml || ''}
  </td></tr>
  <tr><td style='background:#F8FAFC;border-top:1px solid #E2E8F0;padding:20px 30px;font-size:11.5px;color:#64748B;line-height:1.6;'>
    Protocolo ${dados.protocolo} &middot; gerado em ${geradoEm}<br>
    Este diagnóstico é uma leitura gerencial baseada exclusivamente nos dados informados pela empresa e não substitui a análise do contador ou consultor responsável.
  </td></tr>
</table>
</td></tr></table></body></html>`;

// ---------- E-mail interno ----------
const i = dados.indicadores;
const linha = (rot, val) => `<tr><td style='padding:6px 10px;border-bottom:1px solid #E2E8F0;color:#64748B;'>${rot}</td><td style='padding:6px 10px;border-bottom:1px solid #E2E8F0;color:#0B1E3B;font-weight:600;text-align:right;'>${val}</td></tr>`;

const htmlInterno = `<!DOCTYPE html><html lang='pt-BR'><head><meta charset='utf-8'></head>
<body style='margin:0;padding:20px;background:#F1F5F9;font-family:Inter,Arial,Helvetica,sans-serif;'>
<table role='presentation' width='560' cellpadding='0' cellspacing='0' style='max-width:560px;background:#FFFFFF;border-radius:12px;overflow:hidden;'>
  <tr><td style='background:#0B1E3B;padding:18px 22px;color:#FFFFFF;font-size:15px;font-weight:800;'>Novo diagnóstico recebido</td></tr>
  <tr><td style='padding:18px 22px;'>
    <div style='font-size:17px;font-weight:800;color:#0B1E3B;'>${esc(empresa)}</div>
    <div style='font-size:12.5px;color:#64748B;margin:2px 0 14px;'>${esc(dados.identificacao.cnpj_formatado || '')} &middot; ${esc(dados.identificacao.setor || '')} &middot; ref. ${esc(dados.identificacao.mes_referencia || '')}</div>
    <div style='display:inline-block;background:${cor};color:#FFFFFF;font-size:13px;font-weight:800;padding:7px 16px;border-radius:999px;'>Score ${s.scoreTotal}/100 &middot; ${s.nivelSaude}</div>
    ${painelPilares}
    <table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='margin-top:16px;font-size:13px;border-collapse:collapse;'>
      ${linha('Faturamento do mês', brl(dados.entrada.dre.faturamento_bruto))}
      ${linha('Margem líquida', (s.pilares.lucratividade.margemLiquidaPercentual ?? '-') + '%')}
      ${linha('Margem de contribuição', (s.pilares.lucratividade['margemContribuiçãoPercentual'] ?? '-') + '%')}
      ${linha('Reserva operacional', (s.pilares.liquidez.reservaMeses ?? '-') + ' meses')}
      ${linha('Ciclo financeiro', s.pilares.liquidez.cicloFinanceiroDias + ' dias')}
      ${linha('Ponto de equilíbrio', brl(i.ponto_equilibrio_rs))}
      ${linha('NCG estimada', brl(i.ncg_rs))}
      ${linha('Comprometimento com dívidas', (s.pilares.endividamento.comprometimentoReceitaPercentual ?? '-') + '%')}
      ${linha('Divergência da DRE', brl(i.divergencia_lucro))}
    </table>
    <div style='margin-top:16px;font-size:13px;color:#DC2626;'><strong>Críticos:</strong> ${esc(dados.indicadores_criticos.join(', ') || 'nenhum')}</div>
    <div style='margin-top:4px;font-size:13px;color:#D97706;'><strong>Atenção:</strong> ${esc(dados.indicadores_atencao.join(', ') || 'nenhum')}</div>
    <div style='margin-top:16px;font-size:12.5px;color:#64748B;'>Contato: ${esc(dados.identificacao.email || '')} &middot; ${esc(dados.identificacao.telefone || '')}<br>Protocolo ${dados.protocolo}</div>
  </td></tr>
</table></body></html>`;

return [{
  json: {
    protocolo: dados.protocolo,
    relatorio_detalhado_html: ia.relatorioDetalhadoHtml || '',
    ...diagnostico,
    email_cliente: dados.identificacao.email,
    assunto_cliente: 'Seu Diagnóstico Financeiro — ' + empresa + ' (score ' + s.scoreTotal + '/100)',
    html_cliente: htmlCliente,
    assunto_interno: '[' + s.nivelSaude.toUpperCase() + ' ' + s.scoreTotal + '/100] Novo diagnóstico: ' + empresa,
    html_interno: htmlInterno
  }
}];
