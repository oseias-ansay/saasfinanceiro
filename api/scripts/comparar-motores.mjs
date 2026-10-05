#!/usr/bin/env node
/**
 * Roda o MESMO diagnóstico pelos três motores e grava os relatórios lado
 * a lado, com custo e tempo.
 *
 * =====================================================================
 * POR QUE UM SCRIPT, E NÃO UM TESTE
 * =====================================================================
 * Isto não verifica se algo está certo — verifica se o texto presta. Essa
 * é uma decisão humana, e uma suíte que a automatizasse estaria medindo
 * outra coisa.
 *
 * O que o script faz é tirar da comparação tudo o que é opinião sobre
 * infraestrutura: mesmo prompt, mesma régua, mesmo esquema, mesmo
 * diagnóstico real. O que sobra para julgar é só a redação.
 *
 * =====================================================================
 * RODA NO SERVIDOR, NÃO NO SEU PC
 * =====================================================================
 * Precisa das chaves e da rede que alcança os provedores. No container:
 *
 *   docker exec finance-api node scripts/comparar-motores.mjs <protocolo>
 *
 * Sem protocolo, usa o diagnóstico financeiro mais recente que tenha
 * entrada gravada.
 *
 * =====================================================================
 * NÃO ENVIA NADA, NÃO GRAVA NADA
 * =====================================================================
 * Lê um diagnóstico existente, gera três análises e escreve três arquivos
 * em /tmp. Não toca no banco, não manda e-mail, não gera PDF. Rodar duas
 * vezes não produz efeito nenhum além de gastar duas vezes.
 */

import { writeFileSync } from 'node:fs';

const { supabaseAdmin } = await import('../dist/lib/supabase.js');
const { calcularRegua } = await import('../dist/modules/regua/regua.js');
const { montarPromptFinanceiro, montarPromptComercial, esquemaAnaliseFinanceira, esquemaAnaliseComercial, extrairJson } =
  await import('../dist/modules/diagnosticos/analise.js');
const { redigirFinanceiro, redigirComercial } = await import('../dist/modules/diagnosticos/redator.js');
const { gerarAnalise } = await import('../dist/lib/claude.js');
const { gerarAnaliseOpenAI } = await import('../dist/lib/provedor-openai.js');

const protocolo = process.argv[2] ?? null;

const q = supabaseAdmin
  .from('diagnosticos')
  .select('protocolo, tipo, razao_social, cnpj, email, telefone, setor, entrada, score_total')
  .not('entrada', 'eq', '{}')
  .order('created_at', { ascending: false })
  .limit(1);

const { data, error } = protocolo ? await q.eq('protocolo', protocolo) : await q;

if (error) {
  console.error('Erro ao buscar diagnóstico:', error.message);
  process.exit(1);
}

const d = data?.[0];
if (!d) {
  console.error('Nenhum diagnóstico com entrada gravada encontrado.');
  process.exit(1);
}

console.log(`Diagnóstico ${d.protocolo} · ${d.tipo} · ${d.razao_social ?? 'sem razão social'}`);
console.log('');

const lead = {
  razao_social: d.razao_social,
  cnpj: d.cnpj,
  email: d.email,
  telefone: d.telefone,
  setor: d.setor,
};

const comercial = d.tipo === 'comercial';
const regua = calcularRegua(d.entrada);
const prompt = comercial
  ? montarPromptComercial(lead, d.entrada, regua)
  : montarPromptFinanceiro(lead, d.entrada, regua);
const esquema = comercial ? esquemaAnaliseComercial : esquemaAnaliseFinanceira;

/** Roda um motor, medindo. Falha de um não impede os outros. */
async function rodar(nome, fn) {
  const t0 = Date.now();
  try {
    const r = await fn();
    const ms = Date.now() - t0;
    console.log(`${nome.padEnd(10)} OK   ${String(ms).padStart(6)} ms   ${JSON.stringify(r.consumo ?? {})}`);
    return { nome, ms, ...r };
  } catch (e) {
    console.log(`${nome.padEnd(10)} FALHA ${String(Date.now() - t0).padStart(5)} ms   ${e.message}`);
    return { nome, ms: Date.now() - t0, erro: e.message };
  }
}

const resultados = [];

resultados.push(
  await rodar('redator', async () => ({
    analise: comercial ? redigirComercial(regua) : redigirFinanceiro(regua),
    consumo: { entrada: 0, saida: 0 },
  })),
);

resultados.push(await rodar('deepseek', () => gerarAnaliseOpenAI(prompt, esquema, extrairJson)));
resultados.push(await rodar('anthropic', () => gerarAnalise(prompt, esquema, extrairJson)));

/* ------------------------------------------------------------------ */

console.log('');

for (const r of resultados) {
  const caminho = `/tmp/motor-${r.nome}.md`;

  if (r.erro) {
    writeFileSync(caminho, `# ${r.nome}\n\nFALHOU: ${r.erro}\n`);
    console.log(`${caminho}  (falha)`);
    continue;
  }

  const a = r.analise;
  const gargalos = a.gargalosIdentificados ?? a.gargalosCriticos ?? [];

  const texto = [
    `# Motor: ${r.nome}`,
    '',
    `Diagnóstico ${d.protocolo} · ${d.tipo} · score ${d.score_total ?? '—'}`,
    `Tempo: ${r.ms} ms · Consumo: ${JSON.stringify(r.consumo ?? {})}`,
    '',
    '## Resumo executivo',
    '',
    a.resumoExecutivo ?? '(vazio)',
    '',
    '## Avaliações',
    '',
    ...Object.entries(a.avaliacoes ?? {}).map(([k, v]) => `**${k}**\n\n${v}\n`),
    '## Gargalos',
    '',
    ...gargalos.map((g) => `- ${g}`),
    '',
    '## Plano de ação',
    '',
    ...(a.planoDeAcao ?? []).map(
      (p) => `- [${p.prioridade}] ${p.pilar}: ${p.acaoRecomendada}`,
    ),
    '',
    `## Relatório detalhado (${(a.relatorioDetalhadoHtml ?? '').length} caracteres de HTML)`,
    '',
    '```html',
    (a.relatorioDetalhadoHtml ?? '').slice(0, 4000),
    '```',
  ].join('\n');

  writeFileSync(caminho, texto);
  console.log(caminho);
}

console.log('');
console.log('Leia os três e compare o RESUMO EXECUTIVO e os GARGALOS — é onde');
console.log('a diferença entre os motores aparece. O plano de ação costuma');
console.log('convergir, porque a régua já decidiu as prioridades.');
