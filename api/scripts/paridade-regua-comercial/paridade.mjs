/**
 * Paridade da régua comercial: a versão do n8n contra a da API.
 *
 * Roda as duas sobre milhares de entradas geradas e compara campo a
 * campo. Uma única divergência reprova.
 *
 * Isto existe porque a falha que ele pega é invisível. Um arredondamento
 * diferente, uma tabela de pontos com um valor trocado, uma ordenação
 * instável — nada disso gera erro. O relatório continua saindo, bonito,
 * com o número errado, para sempre. E o score é a promessa auditável do
 * produto: duas empresas com as mesmas respostas têm de receber o mesmo
 * número, antes e depois da migração.
 *
 *   node scripts/paridade-regua-comercial/paridade.mjs
 */

import { original } from './regua-comercial-legado.js';
import { calcularReguaComercial } from '../../dist/modules/regua/regua-comercial.js';

// Gerador determinístico: a mesma semente sempre produz o mesmo
// conjunto, então uma divergência encontrada aqui é reproduzível.
let semente = 20260911;
const rnd = () => (semente = (semente * 1103515245 + 12345) % 2147483648) / 2147483648;
const escolha = (arr) => arr[Math.floor(rnd() * arr.length)];
const num = (max) => Math.round(rnd() * max * 100) / 100;

// Cada lista inclui as opções válidas MAIS lixo: `undefined`, string
// vazia, valor inexistente e minúscula.
//
// NOMES DE MÉTODO DO PROTÓTIPO ('toString', 'constructor', 'valueOf')
// ficam de fora de propósito, e são verificados à parte no fim do
// arquivo. A original usava `tabela[valor] !== undefined`, que os
// encontra no protótipo e devolve uma FUNÇÃO como pontuação — o score
// virava texto. É a única divergência deliberada entre as duas versões.
const caso = () => ({
  uso_crm: escolha(['SIM', 'PARCIAL', 'NAO', undefined, '', 'sim']),
  processo_funil_definido: escolha(['SIM', 'PARCIAL', 'NAO', undefined]),
  nivel_metricas_funil: escolha(['COMPLETO', 'BASICO', 'NENHUM', undefined]),

  previsibilidade_leads: escolha(['ALTA', 'MEDIA', 'BAIXA', undefined, '']),
  origem_leads: escolha(['PROPRIA', 'MISTA', 'INDICACAO', undefined, 'OUTRO']),
  calcula_cac: escolha(['SIM', 'NAO', undefined, 'TALVEZ']),

  gestao_metas: escolha(['FREQUENTE', 'MENSAL', 'SEM_METAS', undefined]),
  perfil_vendedores: escolha(['DEDICADA', 'HIBRIDA', 'SOCIOS', undefined]),
  modelo_remuneracao: escolha([
    'FIXO_MAIS_COMISSAO',
    'APENAS_COMISSAO',
    'APENAS_FIXO',
    'NAO_SE_APLICA',
    undefined,
  ]),

  estrategia_upsell: escolha(['ATIVA', 'REATIVA', 'INEXISTENTE', undefined]),
  pos_venda_estruturado: escolha(['ATIVO', 'REATIVO', 'INEXISTENTE', undefined]),

  ciclo_vendas: escolha(['MENOS_7', 'DE_8_A_30', 'DE_31_A_90', 'MAIS_90', 'NAO_SEI', undefined, 'XX']),
  canais_leads: escolha([undefined, [], ['instagram'], ['google', 'indicacao']]),

  // O ticket e o CAC são o único lugar com aritmética, então merecem os
  // casos chatos: zero, nulo, texto, e o número que divide feio.
  ticket_medio: escolha([0, null, undefined, num(50000), '1234,56', '890', num(3)]),
  cac_medio: escolha([0, null, undefined, num(5000), '300', num(1), num(100000)]),

  observacoes: escolha([undefined, null, '', 'texto do cliente']),
});

const CAMPOS = [
  'score',
  'criterios',
  'oportunidades',
  'criterios_zerados',
  'tabela_criterios',
  'ranking_oportunidades',
  'contexto',
  'nao_pontuados',
];

let divergentes = 0;
const TOTAL = 20000;

for (let i = 0; i < TOTAL; i++) {
  const entrada = caso();
  const a = original(entrada);
  const b = calcularReguaComercial(entrada);

  for (const campo of CAMPOS) {
    const ja = JSON.stringify(a[campo]);
    const jb = JSON.stringify(b[campo]);
    if (ja !== jb) {
      divergentes++;
      if (divergentes <= 5) {
        console.error(`\n✗ divergência em "${campo}" no caso ${i}`);
        console.error('  entrada:', JSON.stringify(entrada));
        console.error('  n8n :', ja?.slice(0, 300));
        console.error('  api :', jb?.slice(0, 300));
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------
// A divergência deliberada
// ---------------------------------------------------------------------
// Aqui esperamos que as duas versões DISCORDEM, e que a nova esteja
// certa. Se algum dia a original for corrigida, este bloco falha e avisa
// que a exceção deixou de ser necessária.
let excecaoOk = true;
for (const chave of ['toString', 'constructor', 'valueOf', 'hasOwnProperty']) {
  const antigo = original({ uso_crm: chave });
  const novo = calcularReguaComercial({ uso_crm: chave });

  if (novo.score.scoreTotal !== 0) {
    console.error(`✗ a versão nova deveria zerar "${chave}" e devolveu`, novo.score.scoreTotal);
    excecaoOk = false;
  }
  if (typeof antigo.score.scoreTotal === 'number') {
    console.error(`! a versão do n8n não quebra mais com "${chave}" — a exceção pode sair daqui`);
  }
}

if (divergentes === 0 && excecaoOk) {
  console.log(`✓ ${TOTAL} casos, nenhuma divergência.`);
  console.log('  A régua da API produz exatamente os mesmos números que o n8n produzia.');
  console.log('  (exceto por nomes de método do protótipo, corrigidos de propósito)');
  process.exit(0);
}

console.error(`\n✗ ${divergentes} de ${TOTAL} casos divergiram. NÃO migre.`);
process.exit(1);
