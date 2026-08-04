// ============================================================
// Monta a confirmação imediata ao lead e a notificação interna.
//
// Nenhum PDF é anexado aqui. O relatório foi arquivado no Drive e
// segue para o cliente no fluxo das 8h — a notificação traz só o
// essencial para você decidir se deixa sair ou segura.
// ============================================================

const drive = $input.first().json;
const api = $('API — Enfileirar Diagnóstico').first().json;
const cons = $('Consolidar Diagnóstico').first().json;
const dados = $('Calcular Indicadores e Score').first().json;
const s = dados.score;

const esc = t => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const empresa = dados.identificacao.razao_social || 'sua empresa';

// Formatado no fuso de Brasília: o container roda em UTC e a data crua
// mostraria 11h para um envio das 8h.
const quando = new Date(api.liberar_em).toLocaleString('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
});

// O nó do Drive nem sempre devolve webViewLink; o id vem sempre.
const linkDrive = drive.webViewLink || (drive.id ? 'https://drive.google.com/file/d/' + drive.id + '/view' : null);

// ---------- Confirmação ao lead (sai agora) ----------
const htmlConfirmacao = `<!DOCTYPE html><html lang='pt-BR'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'></head>
<body style='margin:0;padding:0;background:#F1F5F9;font-family:Inter,Arial,Helvetica,sans-serif;'>
<table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='background:#F1F5F9;padding:24px 12px;'>
<tr><td align='center'>
<table role='presentation' width='560' cellpadding='0' cellspacing='0' style='max-width:560px;width:100%;background:#FFFFFF;border-radius:14px;overflow:hidden;'>
  <tr><td style='background:#0B1E3B;padding:24px 30px;'>
    <div style='font-size:19px;font-weight:800;color:#FFFFFF;letter-spacing:-0.02em;'>Business Triage</div>
    <div style='font-size:13px;color:#94A3B8;margin-top:4px;'>Confirmação de recebimento</div>
  </td></tr>
  <tr><td style='padding:26px 30px 8px;'>
    <p style='margin:0 0 14px;color:#334155;font-size:15px;line-height:1.7;'>Recebemos os dados de <strong>${esc(empresa)}</strong>.</p>
    <p style='margin:0 0 14px;color:#334155;font-size:15px;line-height:1.7;'>Seu diagnóstico está sendo preparado e será enviado para este mesmo endereço <strong>${esc(quando)}</strong>, em PDF.</p>
    <p style='margin:0 0 14px;color:#334155;font-size:15px;line-height:1.7;'>O relatório traz a pontuação da sua empresa em quatro pilares, os indicadores calculados a partir do que você informou — cada um com a fórmula usada — e um plano de ação priorizado.</p>
    <div style='margin:22px 0 6px;padding:14px 16px;background:#F8FAFC;border-left:3px solid #0B1E3B;border-radius:6px;'>
      <div style='font-size:11px;color:#64748B;text-transform:uppercase;letter-spacing:0.06em;font-weight:700;'>Protocolo</div>
      <div style='font-size:15px;font-weight:800;color:#0B1E3B;margin-top:3px;'>${esc(api.protocolo)}</div>
    </div>
  </td></tr>
  <tr><td style='background:#F8FAFC;border-top:1px solid #E2E8F0;padding:18px 30px;font-size:11.5px;color:#64748B;line-height:1.6;'>
    Guarde este protocolo. Se precisar falar conosco antes, é só responder a este e-mail.
  </td></tr>
</table>
</td></tr></table></body></html>`;

// ---------- Notificação interna ----------
// Curta de propósito: os números completos estão no PDF, a um clique.
// Repetir tudo aqui faria você ler duas vezes a mesma coisa.
const linha = (rot, val) => `<tr><td style='padding:6px 10px;border-bottom:1px solid #E2E8F0;color:#64748B;'>${rot}</td><td style='padding:6px 10px;border-bottom:1px solid #E2E8F0;color:#0B1E3B;font-weight:600;text-align:right;'>${val}</td></tr>`;

const htmlInterno = `<!DOCTYPE html><html lang='pt-BR'><head><meta charset='utf-8'></head>
<body style='margin:0;padding:20px;background:#F1F5F9;font-family:Inter,Arial,Helvetica,sans-serif;'>
<table role='presentation' width='560' cellpadding='0' cellspacing='0' style='max-width:560px;background:#FFFFFF;border-radius:12px;overflow:hidden;'>
  <tr><td style='background:#0B1E3B;padding:18px 22px;color:#FFFFFF;font-size:15px;font-weight:800;'>Novo diagnóstico financeiro</td></tr>
  <tr><td style='padding:18px 22px;'>
    <div style='font-size:17px;font-weight:800;color:#0B1E3B;'>${esc(empresa)}</div>
    <div style='font-size:12.5px;color:#64748B;margin:2px 0 14px;'>${esc(dados.identificacao.cnpj_formatado || '')} &middot; ${esc(dados.identificacao.setor || '')} &middot; ref. ${esc(dados.identificacao.mes_referencia || '')}</div>
    <div style='display:inline-block;background:${s.corIdentificadora};color:#FFFFFF;font-size:13px;font-weight:800;padding:7px 16px;border-radius:999px;'>Score ${s.scoreTotal}/100 &middot; ${esc(s.nivelSaude)}</div>

    <table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='margin-top:16px;font-size:13px;border-collapse:collapse;'>
      ${linha('Margem líquida', (s.pilares.lucratividade.margemLiquidaPercentual ?? '-') + '%')}
      ${linha('Reserva operacional', (s.pilares.liquidez.reservaMeses ?? '-') + ' meses')}
      ${linha('Ciclo financeiro', s.pilares.liquidez.cicloFinanceiroDias + ' dias')}
    </table>

    <div style='margin-top:14px;font-size:13px;color:#DC2626;'><strong>Críticos:</strong> ${esc(dados.indicadores_criticos.join(', ') || 'nenhum')}</div>
    <div style='margin-top:4px;font-size:13px;color:#D97706;'><strong>Atenção:</strong> ${esc(dados.indicadores_atencao.join(', ') || 'nenhum')}</div>

    ${linkDrive ? `<div style='margin-top:18px;'><a href='${linkDrive}' style='display:inline-block;background:#0B1E3B;color:#FFFFFF;font-size:13px;font-weight:800;padding:11px 22px;border-radius:8px;text-decoration:none;'>Abrir o relatório em PDF</a></div>` : `<div style='margin-top:18px;font-size:13px;color:#DC2626;'><strong>O PDF não foi arquivado no Drive.</strong> Confira a execução deste workflow.</div>`}

    <div style='margin-top:20px;padding-top:16px;border-top:1px solid #E2E8F0;'>
      <div style='font-size:11px;color:#64748B;text-transform:uppercase;letter-spacing:0.06em;font-weight:700;'>Envio programado</div>
      <div style='font-size:15px;font-weight:800;color:#0B1E3B;margin:3px 0 10px;'>${esc(quando)}</div>
      <p style='margin:0 0 12px;color:#334155;font-size:13px;line-height:1.6;'>O lead já recebeu a confirmação. O relatório sai automaticamente no horário acima. Se algo estiver errado, segure agora:</p>
      <a href='${api.hold_url}' style='display:inline-block;background:#DC2626;color:#FFFFFF;font-size:13px;font-weight:800;padding:11px 22px;border-radius:8px;text-decoration:none;'>Segurar este envio</a>
      <p style='margin:10px 0 0;color:#94A3B8;font-size:11.5px;line-height:1.5;'>O link deixa de funcionar depois que o relatório é enviado.</p>
    </div>

    <div style='margin-top:18px;font-size:12.5px;color:#64748B;'>Contato: ${esc(dados.identificacao.email || '')} &middot; ${esc(dados.identificacao.telefone || '')}<br>Protocolo ${esc(api.protocolo)}</div>
  </td></tr>
</table></body></html>`;

return [{
  json: {
    protocolo: api.protocolo,
    liberar_em: api.liberar_em,
    liberar_em_texto: quando,
    link_drive: linkDrive,
    email_cliente: cons.email_cliente,
    assunto_confirmacao: 'Recebemos seus dados — ' + empresa + ' (protocolo ' + api.protocolo + ')',
    html_confirmacao: htmlConfirmacao,
    assunto_interno: '[' + String(s.nivelSaude).toUpperCase() + ' ' + s.scoreTotal + '/100] ' + empresa + ' — envia ' + quando,
    html_interno: htmlInterno
  }
}];
