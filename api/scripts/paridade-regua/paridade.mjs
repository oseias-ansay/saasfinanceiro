import { original } from './regua-legado.js';
import { calcularRegua } from '../../dist/modules/regua/regua.js';

// Gerador determinístico: a mesma semente sempre produz o mesmo conjunto,
// então uma divergência encontrada aqui é reproduzível.
let semente = 20260826;
const rnd = () => (semente = (semente * 1103515245 + 12345) % 2147483648) / 2147483648;
const num = (max) => Math.round(rnd() * max * 100) / 100;
const escolha = (arr) => arr[Math.floor(rnd() * arr.length)];

const caso = () => ({
  dre: {
    faturamento_bruto: escolha([0, num(500000), num(50000), num(5000000)]),
    impostos_sobre_vendas: num(60000),
    custos_variaveis: num(300000),
    despesas_fixas: escolha([0, num(120000)]),
    pro_labore_socios: num(30000),
    lucro_liquido_informado: escolha([-num(50000), num(200000)]),
  },
  caixa: {
    saldo_caixa_reservas: escolha([0, num(400000)]),
    pmr_dias: Math.round(rnd() * 120),
    pmp_dias: Math.round(rnd() * 120),
    pme_dias: Math.round(rnd() * 90),
    inadimplencia_pct: num(15),
  },
  endividamento: {
    passivo_curto_prazo: escolha([0, num(300000)]),
    passivo_longo_prazo: escolha([0, num(800000)]),
    parcela_dividas_mensal: escolha([0, num(60000)]),
    custo_divida_pct_am: num(5),
    uso_antecipacao_recebiveis: escolha(['nunca', 'raramente', 'mensalmente', 'constantemente', undefined, 'lixo']),
  },
  qualitativo: {
    mistura_contas_pf_pj: escolha(['nao', 'as_vezes', 'sim', undefined, '']),
    percentual_maior_cliente: num(100),
  },
});

let divergentes = 0;
const TOTAL = 20000;

for (let i = 0; i < TOTAL; i++) {
  const entrada = caso();
  const a = original(structuredClone(entrada));
  const b = calcularRegua(structuredClone(entrada));

  const ja = JSON.stringify({ s: a.score, i: a.indicadores, al: a.alertas, t: a.tabela_alertas,
                              c: a.indicadores_criticos, at: a.indicadores_atencao });
  const jb = JSON.stringify({ s: b.score, i: b.indicadores, al: b.alertas, t: b.tabela_alertas,
                              c: b.indicadores_criticos, at: b.indicadores_atencao });

  if (ja !== jb) {
    divergentes++;
    if (divergentes <= 2) {
      console.log('DIVERGÊNCIA em', JSON.stringify(entrada));
      console.log('  original:', ja.slice(0, 400));
      console.log('  portada :', jb.slice(0, 400));
    }
  }
}

console.log(`\n${TOTAL} casos comparados — ${divergentes} divergências`);
process.exit(divergentes ? 1 : 0);
