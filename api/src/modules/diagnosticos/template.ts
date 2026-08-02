//
// Templates do diagnóstico: o PDF A4 e o e-mail curto que o acompanha.
//
// A separação é proposital. O e-mail existe para fazer a pessoa abrir o
// anexo — três parágrafos e o número principal. O relatório inteiro mora
// no PDF, onde há margem, paginação e tipografia de verdade.
//
// Tudo aqui é apresentação: nenhum número é calculado neste arquivo. As
// contas vêm prontas do n8n, que as fez em código auditável.

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface DiagnosticoRegistro {
  protocolo: string;
  tipo: 'financeiro' | 'comercial';
  razao_social?: string | null;
  cnpj?: string | null;
  setor?: string | null;
  mes_referencia?: string | null;
  score_total?: number | null;
  nivel?: string | null;
  entrada?: Record<string, any>;
  indicadores?: Record<string, any>;
  alertas?: any[];
  analise?: Record<string, any>;
  created_at?: string;
}

// ---------------------------------------------------------------------
// Identidade visual
// ---------------------------------------------------------------------
const MARINHO = '#0B1E3B';
const GRAFITE = '#334155';
const CINZA = '#64748B';
const BORDA = '#E2E8F0';
const FUNDO = '#F8FAFC';

/** Mesma escala usada pelo n8n para classificar o score. */
function corDoScore(score: number): string {
  if (score >= 85) return '#10B981';
  if (score >= 70) return '#84CC16';
  if (score >= 41) return '#F59E0B';
  return '#EF4444';
}

/** [chave no JSON da IA, rótulo impresso, pontuação máxima] */
type Pilar = readonly [string, string, number];

const PILARES_FINANCEIRO: readonly Pilar[] = [
  ['lucratividade', 'Lucratividade e Eficiência', 35],
  ['liquidez', 'Liquidez e Capital de Giro', 30],
  ['endividamento', 'Endividamento e Risco', 20],
  ['governanca', 'Governança e Mercado', 15],
];

const PILARES_COMERCIAL: readonly Pilar[] = [
  ['processoEFunil', 'Estrutura, Processo e Funil', 30],
  ['geracaoDemanda', 'Atração e Geração de Demanda', 30],
  ['gestaoEEquipe', 'Equipe, Metas e Gestão', 20],
  ['posVendaETicket', 'Ticket Médio e Pós-Venda', 20],
];

// Função em vez de índice num Record: com `noUncheckedIndexedAccess`,
// qualquer acesso por chave devolve `| undefined`, e o fallback teria
// que ser repetido em todo uso. Aqui o retorno é sempre uma lista.
function pilaresDe(tipo: DiagnosticoRegistro['tipo']): readonly Pilar[] {
  return tipo === 'comercial' ? PILARES_COMERCIAL : PILARES_FINANCEIRO;
}

// ---------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------
export function esc(t: unknown): string {
  return String(t ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const dataLonga = (iso?: string) =>
  new Date(iso ?? Date.now()).toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

function valorDoAlerta(a: any): string {
  if (a?.valor === null || a?.valor === undefined) return 'n/d';
  if (a.unidade === 'R$') {
    return (
      'R$ ' +
      Number(a.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    );
  }
  const numero = String(a.valor).replace('.', ',');
  return a.unidade ? `${numero} ${a.unidade}` : numero;
}

interface Faixa {
  rotulo: string;
  cor: string;
  fundo: string;
}

/** Também o fallback: status desconhecido cai aqui em vez de quebrar. */
const SEM_DADOS: Faixa = { rotulo: 'Sem dados', cor: CINZA, fundo: FUNDO };

const SEMAFORO: Record<string, Faixa> = {
  verde: { rotulo: 'Saudável', cor: '#047857', fundo: '#ECFDF5' },
  amarelo: { rotulo: 'Atenção', cor: '#B45309', fundo: '#FFFBEB' },
  vermelho: { rotulo: 'Crítico', cor: '#B91C1C', fundo: '#FEF2F2' },
  sem_dados: SEM_DADOS,
};

const COR_PRIORIDADE: Record<string, string> = {
  Alta: '#B91C1C',
  Média: '#B45309',
  Media: '#B45309',
  Baixa: '#047857',
};

// ---------------------------------------------------------------------
// Blocos do PDF
// ---------------------------------------------------------------------
function capa(d: DiagnosticoRegistro, score: number, cor: string): string {
  const titulo =
    d.tipo === 'comercial' ? 'Diagnóstico Comercial' : 'Diagnóstico Financeiro';

  return `
<section class="capa">
  <div class="capa-topo">
    <div class="marca">Business Triage</div>
    <div class="marca-sub">Consultoria em gestão para pequenas e médias empresas</div>
  </div>

  <div class="capa-centro">
    <div class="capa-etiqueta">Relatório de</div>
    <h1 class="capa-titulo">${titulo}</h1>

    <div class="capa-empresa">${esc(d.razao_social || 'Empresa')}</div>
    <div class="capa-meta">
      ${d.cnpj ? `CNPJ ${esc(d.cnpj)}` : ''}
      ${d.setor ? ` &middot; ${esc(d.setor)}` : ''}
      ${d.mes_referencia ? ` &middot; referência ${esc(d.mes_referencia)}` : ''}
    </div>

    <div class="score-caixa" style="border-color:${cor};">
      <div class="score-rotulo">Score ${d.tipo === 'comercial' ? 'comercial' : 'financeiro'}</div>
      <div class="score-numero" style="color:${cor};">${score}<span class="score-de">/100</span></div>
      <div class="score-nivel" style="background:${cor};">${esc(d.nivel || '')}</div>
    </div>
  </div>

  <div class="capa-rodape">
    Protocolo ${esc(d.protocolo)} &middot; emitido em ${dataLonga(d.created_at)}<br>
    Documento confidencial, elaborado exclusivamente para a empresa acima identificada.
  </div>
</section>`;
}

function barrasPilares(d: DiagnosticoRegistro, cor: string): string {
  const pilares = d.analise?.pilares ?? {};
  const linhas = pilaresDe(d.tipo)
    .map(([chave, rotulo, max]) => {
      const p = Number(pilares[chave]?.pontos ?? 0);
      const largura = Math.max(0, Math.min(100, Math.round((p / max) * 100)));
      return `
      <tr>
        <td class="barra-rotulo">${rotulo}</td>
        <td><div class="barra-trilho"><div class="barra-preenchida" style="width:${largura}%;background:${cor};"></div></div></td>
        <td class="barra-valor">${p}<span class="barra-max">/${max}</span></td>
      </tr>`;
    })
    .join('');

  return `<table class="barras">${linhas}</table>`;
}

function avaliacoesPilares(d: DiagnosticoRegistro): string {
  const pilares = d.analise?.pilares ?? {};
  const blocos = pilaresDe(d.tipo)
    .map(([chave, rotulo, max]) => {
      const p = pilares[chave] ?? {};
      if (!p.avaliacao) return '';
      return `
      <div class="pilar evitar-quebra">
        <h3>${rotulo} <span class="pilar-pontos">${p.pontos ?? 0}/${max}</span></h3>
        <p>${esc(p.avaliacao)}</p>
      </div>`;
    })
    .join('');

  return blocos ? `<h2>Análise por pilar</h2>${blocos}` : '';
}

function tabelaSemaforo(d: DiagnosticoRegistro): string {
  const alertas = Array.isArray(d.alertas) ? d.alertas : [];
  if (!alertas.length) return '';

  const linhas = alertas
    .map((a) => {
      const s: Faixa = SEMAFORO[String(a?.status ?? '')] ?? SEM_DADOS;
      return `
      <tr>
        <td class="ind-nome">${esc(a?.indicador)}<div class="ind-formula">${esc(a?.formula)}</div></td>
        <td class="ind-valor">${valorDoAlerta(a)}</td>
        <td class="ind-status"><span style="color:${s.cor};background:${s.fundo};">${s.rotulo}</span></td>
      </tr>`;
    })
    .join('');

  return `
<h2>Indicadores calculados</h2>
<p class="nota">Cada linha traz a fórmula usada. Os valores saem diretamente do que sua empresa informou —
nenhum número foi estimado.</p>
<table class="indicadores">
  <thead><tr><th>Indicador</th><th class="dir">Valor</th><th class="dir">Situação</th></tr></thead>
  <tbody>${linhas}</tbody>
</table>`;
}

function listaGargalos(d: DiagnosticoRegistro): string {
  const itens: string[] = d.analise?.gargalos ?? d.analise?.gargalosIdentificados ?? [];
  if (!Array.isArray(itens) || !itens.length) return '';
  return `
<h2>Gargalos identificados</h2>
<ol class="gargalos">${itens.map((g) => `<li>${esc(g)}</li>`).join('')}</ol>`;
}

function tabelaPlano(d: DiagnosticoRegistro): string {
  const acoes: any[] = d.analise?.planoDeAcao ?? [];
  if (!Array.isArray(acoes) || !acoes.length) return '';

  const linhas = acoes
    .map(
      (a) => `
      <tr>
        <td class="prio" style="color:${COR_PRIORIDADE[a?.prioridade] ?? GRAFITE};">${esc(a?.prioridade)}</td>
        <td class="pilar-col">${esc(a?.pilar)}</td>
        <td>${esc(a?.acaoRecomendada)}</td>
      </tr>`,
    )
    .join('');

  return `
<h2 class="quebrar-antes">Plano de ação</h2>
<p class="nota">Ordenado por impacto. Comece pelo topo.</p>
<table class="plano">
  <thead><tr><th>Prioridade</th><th>Pilar</th><th>Ação recomendada</th></tr></thead>
  <tbody>${linhas}</tbody>
</table>`;
}

// ---------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------
export function montarHtmlImpressao(d: DiagnosticoRegistro): string {
  const score = Number(d.score_total ?? 0);
  const cor = corDoScore(score);
  const resumo = d.analise?.resumoExecutivo ?? '';
  const detalhado = d.analise?.relatorioDetalhadoHtml ?? '';

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>Diagnóstico ${esc(d.protocolo)}</title>
<style>
  @page { size: A4; }

  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Noto Sans", "DejaVu Sans", Arial, Helvetica, sans-serif;
    color: ${GRAFITE};
    font-size: 10.5pt;
    line-height: 1.62;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .conteudo { padding: 0 18mm; }

  /* ---------- Capa ---------- */
  .capa {
    height: 267mm;                 /* A4 menos as margens do Puppeteer */
    page-break-after: always;
    display: flex; flex-direction: column; justify-content: space-between;
    padding: 4mm 18mm 6mm;
  }
  .marca { font-size: 15pt; font-weight: 800; color: ${MARINHO}; letter-spacing: -0.02em; }
  .marca-sub { font-size: 8.5pt; color: ${CINZA}; margin-top: 2mm; }
  .capa-centro { padding-bottom: 24mm; }
  .capa-etiqueta { font-size: 9pt; color: ${CINZA}; text-transform: uppercase; letter-spacing: 0.14em; font-weight: 700; }
  .capa-titulo { font-size: 30pt; font-weight: 800; color: ${MARINHO}; margin: 2mm 0 10mm; letter-spacing: -0.03em; }
  .capa-empresa { font-size: 16pt; font-weight: 700; color: ${MARINHO}; }
  .capa-meta { font-size: 10pt; color: ${CINZA}; margin-top: 1.5mm; }
  .score-caixa {
    margin-top: 14mm; padding: 8mm; border: 2px solid; border-radius: 4mm;
    display: inline-block; min-width: 68mm; text-align: center;
  }
  .score-rotulo { font-size: 8.5pt; color: ${CINZA}; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 700; }
  .score-numero { font-size: 44pt; font-weight: 800; line-height: 1.05; margin-top: 1mm; }
  .score-de { font-size: 17pt; color: #94A3B8; }
  .score-nivel {
    display: inline-block; color: #fff; font-size: 10pt; font-weight: 800;
    padding: 2mm 7mm; border-radius: 20mm; margin-top: 3mm;
  }
  .capa-rodape { font-size: 8pt; color: ${CINZA}; border-top: 1px solid ${BORDA}; padding-top: 4mm; }

  /* ---------- Texto ---------- */
  h2 {
    font-size: 14pt; font-weight: 800; color: ${MARINHO};
    margin: 9mm 0 3mm; padding-bottom: 2mm; border-bottom: 2px solid ${BORDA};
  }
  h3 { font-size: 11pt; font-weight: 700; color: ${MARINHO}; margin: 5mm 0 1.5mm; }
  p { margin: 0 0 3mm; }
  .nota { font-size: 9pt; color: ${CINZA}; margin-bottom: 4mm; }
  .destaque {
    background: ${FUNDO}; border-left: 3px solid ${MARINHO};
    padding: 5mm 6mm; border-radius: 0 2mm 2mm 0; margin-bottom: 6mm;
  }
  .quebrar-antes { page-break-before: always; }
  .evitar-quebra { page-break-inside: avoid; }

  /* ---------- Pilares ---------- */
  .barras { width: 100%; border-collapse: collapse; margin: 3mm 0 6mm; }
  .barra-rotulo { font-size: 10pt; color: ${GRAFITE}; width: 46%; padding: 2mm 0; }
  .barras td { padding: 2mm 0; }
  .barra-trilho { background: ${BORDA}; border-radius: 2mm; height: 3mm; width: 100%; }
  .barra-preenchida { height: 3mm; border-radius: 2mm; }
  .barra-valor { text-align: right; font-weight: 700; color: ${MARINHO}; padding-left: 4mm; white-space: nowrap; }
  .barra-max { color: #94A3B8; font-weight: 600; }
  .pilar { margin-bottom: 4mm; }
  .pilar-pontos { font-size: 9.5pt; font-weight: 600; color: ${CINZA}; }

  /* ---------- Tabelas ---------- */
  table.indicadores, table.plano { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  table.indicadores th, table.plano th {
    background: ${MARINHO}; color: #fff; text-align: left;
    padding: 2.5mm 3mm; font-weight: 700; font-size: 9pt;
  }
  table.indicadores td, table.plano td {
    border-bottom: 1px solid ${BORDA}; padding: 2.5mm 3mm; vertical-align: top;
  }
  .dir { text-align: right; }
  .ind-nome { color: ${MARINHO}; font-weight: 600; }
  .ind-formula { font-size: 8pt; color: ${CINZA}; font-weight: 400; margin-top: 0.6mm; }
  .ind-valor { text-align: right; font-weight: 700; color: ${MARINHO}; white-space: nowrap; }
  .ind-status { text-align: right; white-space: nowrap; }
  .ind-status span { display: inline-block; padding: 1mm 3mm; border-radius: 10mm; font-size: 8.5pt; font-weight: 700; }
  .prio { font-weight: 800; white-space: nowrap; }
  .pilar-col { color: ${CINZA}; }
  .gargalos { margin: 0 0 4mm; padding-left: 6mm; }
  .gargalos li { margin-bottom: 2mm; }

  /* Fragmento vindo da IA: neutraliza estilos de e-mail para o padrão do PDF. */
  .detalhado h2 { font-size: 14pt !important; margin: 9mm 0 3mm !important; }
  .detalhado h3 { font-size: 11pt !important; }
  .detalhado table { width: 100% !important; border-collapse: collapse !important; font-size: 9.5pt !important; }
  .detalhado td { padding: 2.5mm 3mm !important; }

  .encerramento {
    margin-top: 10mm; padding-top: 4mm; border-top: 1px solid ${BORDA};
    font-size: 8.5pt; color: ${CINZA};
  }
</style></head>
<body>

${capa(d, score, cor)}

<div class="conteudo">

  <h2 style="margin-top:0;">Resumo executivo</h2>
  <div class="destaque"><p style="margin:0;">${esc(resumo)}</p></div>

  <h2>Pontuação por pilar</h2>
  ${barrasPilares(d, cor)}
  ${avaliacoesPilares(d)}

  ${tabelaSemaforo(d)}
  ${listaGargalos(d)}
  ${tabelaPlano(d)}

  ${detalhado ? `<div class="detalhado quebrar-antes">${detalhado}</div>` : ''}

  <div class="encerramento">
    Este diagnóstico é uma leitura gerencial baseada exclusivamente nos dados informados pela empresa
    e não substitui a análise do contador ou consultor responsável. As recomendações consideram o
    cenário retratado no mês de referência.<br><br>
    Protocolo ${esc(d.protocolo)} &middot; Business Triage &middot; businesstriage.com.br
  </div>

</div>
</body></html>`;
}

// ---------------------------------------------------------------------
// E-mail que leva o PDF
// ---------------------------------------------------------------------
export function montarEmailCurto(d: DiagnosticoRegistro): { assunto: string; html: string } {
  const score = Number(d.score_total ?? 0);
  const cor = corDoScore(score);
  const empresa = d.razao_social || 'sua empresa';
  const tipo = d.tipo === 'comercial' ? 'comercial' : 'financeiro';

  const assunto = `Diagnóstico ${tipo} — ${empresa} (score ${score}/100)`;

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:Inter,Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0"
       style="max-width:560px;width:100%;background:#FFFFFF;border-radius:14px;overflow:hidden;">
  <tr><td style="background:${MARINHO};padding:24px 30px;">
    <div style="font-size:19px;font-weight:800;color:#FFFFFF;letter-spacing:-0.02em;">Business Triage</div>
    <div style="font-size:13px;color:#94A3B8;margin-top:4px;">Seu diagnóstico está pronto</div>
  </td></tr>

  <tr><td style="padding:26px 30px 4px;">
    <p style="margin:0 0 14px;color:${GRAFITE};font-size:15px;line-height:1.7;">
      O diagnóstico ${tipo} de <strong>${esc(empresa)}</strong> está no PDF anexo a este e-mail.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="border:1px solid ${BORDA};border-radius:12px;margin:4px 0 18px;">
      <tr><td style="padding:16px 20px;">
        <div style="font-size:11px;color:${CINZA};text-transform:uppercase;letter-spacing:0.06em;font-weight:700;">
          Score ${tipo}
        </div>
        <div style="font-size:34px;font-weight:800;color:${cor};line-height:1.15;margin-top:2px;">
          ${score}<span style="font-size:17px;color:#94A3B8;font-weight:700;">/100</span>
          <span style="display:inline-block;background:${cor};color:#FFFFFF;font-size:12px;font-weight:800;
                       padding:5px 14px;border-radius:999px;vertical-align:middle;margin-left:8px;">
            ${esc(d.nivel || '')}
          </span>
        </div>
      </td></tr>
    </table>

    <p style="margin:0 0 12px;color:${GRAFITE};font-size:15px;line-height:1.7;">No relatório você encontra:</p>
    <ul style="margin:0 0 16px;padding-left:20px;color:${GRAFITE};font-size:14.5px;line-height:1.75;">
      <li>a pontuação detalhada em quatro pilares, com a explicação de cada nota;</li>
      <li>os indicadores calculados a partir dos seus números, com a fórmula de cada um;</li>
      <li>os gargalos encontrados e um plano de ação priorizado.</li>
    </ul>

    <p style="margin:0 0 14px;color:${GRAFITE};font-size:15px;line-height:1.7;">
      Vale reservar quinze minutos com calma. Se quiser conversar sobre qualquer ponto,
      é só responder a este e-mail.
    </p>
  </td></tr>

  <tr><td style="background:${FUNDO};border-top:1px solid ${BORDA};padding:18px 30px;
                 font-size:11.5px;color:${CINZA};line-height:1.6;">
    Protocolo ${esc(d.protocolo)}<br>
    Leitura gerencial baseada nos dados informados pela empresa. Não substitui a análise do contador
    ou consultor responsável.
  </td></tr>
</table>
</td></tr></table></body></html>`;

  return { assunto, html };
}

// ---------------------------------------------------------------------
// Nome do arquivo
//
// Data primeiro para a pasta do Drive ordenar cronologicamente sozinha,
// e o score no fim para bater o olho na lista e ver onde há urgência.
// ---------------------------------------------------------------------
export function nomeArquivoPdf(d: DiagnosticoRegistro): string {
  const dia = new Date(d.created_at ?? Date.now())
    .toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    .split('/')
    .reverse()
    .join('-');

  // NFD separa "ã" em "a" + acento; o filtro seguinte descarta o acento
  // junto com o resto do que não é letra, número ou espaço. Dispensa a
  // classe de caracteres combinantes, que é invisível no código-fonte e
  // não sobrevive a um editor que normalize o arquivo.
  const empresa =
    String(d.razao_social || 'Empresa')
      .normalize('NFD')
      .replace(/[^A-Za-z0-9 ]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 48) || 'Empresa';

  const tipo = d.tipo === 'comercial' ? 'Comercial' : 'Financeiro';
  return `${dia} - ${empresa} - ${tipo} - ${d.score_total ?? 0}.pdf`;
}
