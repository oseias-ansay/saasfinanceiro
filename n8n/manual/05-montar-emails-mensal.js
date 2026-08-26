// ============================================================
// Business Triage — e-mails do ciclo mensal
//
// Recebe a resposta de /mensal/apurar e devolve UM ITEM POR
// E-MAIL A ENVIAR. O nó de envio adiante é um só: assunto,
// destinatário e corpo vêm do próprio item.
//
// Dois tipos de item:
//   cobranca — para o cliente cujo mês não fechou
//   interno  — o resumo da rodada, para você
//
// O interno é emitido SEMPRE, inclusive quando está tudo certo.
// Um relatório que só aparece quando há problema tem um defeito
// conhecido: no dia em que o agendamento parar de rodar, o
// silêncio é indistinguível de "nenhum problema".
// ============================================================

const r = $input.first().json.data;

const esc = (t) =>
  String(t == null ? '' : t)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const CAB = (titulo, sub) => `
  <tr><td style='background:#0B1E3B;padding:24px 30px;'>
    <div style='font-size:19px;font-weight:800;color:#FFFFFF;letter-spacing:-0.02em;'>Business Triage</div>
    <div style='font-size:13px;color:#94A3B8;margin-top:4px;'>${esc(sub)}</div>
  </td></tr>`;

const MOLDURA = (largura, miolo) => `<!DOCTYPE html><html lang='pt-BR'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'></head>
<body style='margin:0;padding:0;background:#F1F5F9;font-family:Inter,Arial,Helvetica,sans-serif;'>
<table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='background:#F1F5F9;padding:24px 12px;'>
<tr><td align='center'>
<table role='presentation' width='${largura}' cellpadding='0' cellspacing='0' style='max-width:${largura}px;width:100%;background:#FFFFFF;border-radius:14px;overflow:hidden;'>
${miolo}
</table>
</td></tr></table></body></html>`;

const itens = [];

// ---------------- Cobranças ----------------
//
// Só quem ainda não foi avisado deste mês. A API já filtra em
// `a_cobrar`, e a marcação de "cobrado" acontece DEPOIS do envio —
// nunca antes, senão uma falha de SMTP deixaria o cliente sem aviso
// para sempre, e o sistema achando que avisou.
for (const c of r.a_cobrar || []) {
  if (!c.email) continue;

  const lista = (c.faltas || []).map((f) => `<li style='margin-bottom:6px;'>${esc(f)}</li>`).join('');

  const miolo = `
  ${CAB('', 'Diagnóstico de ' + r.mes_por_extenso)}
  <tr><td style='padding:26px 30px 8px;'>
    <p style='margin:0 0 14px;color:#334155;font-size:15px;line-height:1.7;'>
      O diagnóstico de <strong>${esc(c.nome)}</strong> referente a ${esc(r.mes_por_extenso)} não pôde ser calculado.
    </p>
    <div style='margin:18px 0;padding:16px 18px;background:#FFFBEB;border-left:3px solid #F59E0B;border-radius:6px;'>
      <div style='font-size:13px;font-weight:700;color:#92400E;margin-bottom:8px;'>Falta registrar:</div>
      <ul style='margin:0;padding-left:20px;color:#92400E;font-size:14px;line-height:1.6;'>${lista}</ul>
    </div>
    <p style='margin:0 0 14px;color:#334155;font-size:15px;line-height:1.7;'>
      Assim que isso estiver no sistema, a pontuação é calculada e entra na sua curva de evolução.
    </p>
    <p style='margin:0 0 20px;color:#64748B;font-size:13.5px;line-height:1.7;'>
      Preferimos não pontuar a pontuar errado: um score calculado sobre metade dos dados sai alto
      e falso, e é justamente o número que você usaria para decidir.
    </p>
    <a href='https://businesstriage.com.br/painel/financeiro/diagnostico'
       style='display:inline-block;background:#10B981;color:#06281c;font-size:15px;font-weight:800;padding:13px 26px;border-radius:8px;text-decoration:none;'>
      Completar o mês
    </a>
  </td></tr>
  <tr><td style='background:#F8FAFC;border-top:1px solid #E2E8F0;padding:18px 30px;font-size:11.5px;color:#64748B;line-height:1.6;'>
    Este aviso é enviado uma única vez por mês. Se precisar de ajuda para localizar o que falta, é só responder a este e-mail.
  </td></tr>`;

  itens.push({
    json: {
      tipo: 'cobranca',
      tenant_id: c.tenant_id,
      para: c.email,
      assunto: `Faltam dados para o diagnóstico de ${r.mes_por_extenso} — ${c.nome}`,
      html: MOLDURA(560, miolo),
    },
  });
}

// ---------------- Resumo interno ----------------
const linha = (rot, val, cor) =>
  `<tr><td style='padding:7px 10px;border-bottom:1px solid #E2E8F0;color:#64748B;font-size:13px;'>${rot}</td>` +
  `<td style='padding:7px 10px;border-bottom:1px solid #E2E8F0;color:${cor || '#0B1E3B'};font-weight:700;text-align:right;font-size:13px;'>${val}</td></tr>`;

const detalhe = (r.resultados || [])
  .map((x) => {
    const cor =
      x.status === 'calculado' ? '#059669' : x.status === 'incompleto' ? '#D97706' : '#DC2626';
    const dir =
      x.status === 'calculado'
        ? `${x.score_total}/100 · ${esc(x.nivel)}`
        : x.status === 'erro'
          ? esc(x.erro)
          : `${(x.faltas || []).length} pendência(s)`;
    return `<tr><td style='padding:6px 10px;border-bottom:1px solid #E2E8F0;font-size:13px;color:#0B1E3B;'>${esc(x.nome)}</td>
            <td style='padding:6px 10px;border-bottom:1px solid #E2E8F0;font-size:12.5px;color:${cor};text-align:right;'>${dir}</td></tr>`;
  })
  .join('');

// Erro é o único estado que exige alguém olhar hoje. Ele vai para o
// assunto para não depender de o e-mail ser aberto.
const prefixo = r.erros > 0 ? `[${r.erros} ERRO(S)] ` : '';

const mioloInterno = `
  ${CAB('', 'Apuração mensal · ' + r.mes_por_extenso)}
  <tr><td style='padding:22px 30px 6px;'>
    <table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='border-collapse:collapse;'>
      ${linha('Empresas apuradas', r.total)}
      ${linha('Diagnósticos calculados', r.calculados, '#059669')}
      ${linha('Meses incompletos', r.incompletos, r.incompletos ? '#D97706' : '#64748B')}
      ${linha('Erros', r.erros, r.erros ? '#DC2626' : '#64748B')}
      ${linha('Cobranças enviadas agora', (r.a_cobrar || []).length)}
      ${linha('Versão da régua', esc(r.regua_versao))}
    </table>
  </td></tr>
  <tr><td style='padding:16px 30px 26px;'>
    <div style='font-size:12px;color:#64748B;text-transform:uppercase;letter-spacing:0.06em;font-weight:700;margin-bottom:8px;'>Empresa a empresa</div>
    <table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='border-collapse:collapse;'>${detalhe}</table>
  </td></tr>
  <tr><td style='background:#F8FAFC;border-top:1px solid #E2E8F0;padding:18px 30px;font-size:11.5px;color:#64748B;line-height:1.6;'>
    Empresa que aparece incompleta três meses seguidos parou de usar o sistema — e isso costuma
    aparecer bem antes do pedido de cancelamento.
  </td></tr>`;

itens.push({
  json: {
    tipo: 'interno',
    tenant_id: null,
    para: 'contato@businesstriage.com.br',
    assunto: `${prefixo}Apuração de ${r.mes_por_extenso}: ${r.calculados} calculados, ${r.incompletos} incompletos`,
    html: MOLDURA(600, mioloInterno),
    competencia: r.competencia,
    // Vai junto para o nó final marcar como cobrados sem precisar
    // reabrir a resposta da API.
    cobrados: (r.a_cobrar || []).map((c) => c.tenant_id),
  },
});

return itens;
