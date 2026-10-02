/**
 * O que o assistente pode consultar.
 *
 * =====================================================================
 * FERRAMENTA, E NÃO CONTEXTO MAIOR
 * =====================================================================
 * A tentação, ao pedirem que o chat responda sobre o negócio inteiro, é
 * empilhar o extrato, a DRE e as contas a pagar no bloco de sistema.
 * Quebra por três lados: fica caro em TODA pergunta, fica desatualizado
 * no instante seguinte, e "pagamentos dos próximos 10 dias" não é um
 * resumo — é uma consulta com parâmetro.
 *
 * Então o assistente não recebe os dados. Recebe o direito de perguntar.
 *
 * =====================================================================
 * A EMPRESA NUNCA É PARÂMETRO. ESTA É A REGRA QUE NÃO SE NEGOCIA.
 * =====================================================================
 * Nenhuma ferramenta aqui tem campo de empresa, de tenant ou de cliente.
 * Os parâmetros são só de negócio: período, natureza, limite.
 *
 * O `tenant_id` é injetado pelo servidor a partir do JWT, na execução.
 * Se existisse como parâmetro, bastaria o modelo ser convencido — por um
 * texto numa observação de lançamento, por exemplo — a chamar a
 * ferramenta com outro uuid. Não é questão de o modelo ser obediente: é
 * que não deve existir o campo.
 *
 * =====================================================================
 * O MODELO NÃO FAZ CONTA
 * =====================================================================
 * As ferramentas devolvem valores já calculados pelas mesmas views que
 * as telas usam. Se o assistente somasse por conta própria, um dia daria
 * um total diferente do que a tela mostra — e aí o cliente perde a
 * confiança nos dois.
 *
 * Por isso cada resultado traz também um `resumo` em texto, pronto. O
 * modelo narra; a aritmética é do Postgres.
 *
 * =====================================================================
 * SÓ LEITURA
 * =====================================================================
 * Nenhuma ferramenta escreve. Lançar, pagar, excluir e marcar ação
 * continuam sendo na tela, onde a pessoa vê o que está fazendo. Mesma
 * decisão do chat do plano, pela mesma razão.
 */

import { z } from 'zod';

/* ==================================================================== */
/* Formatação                                                            */
/* ==================================================================== */

export const brl = (v: number): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    Number.isFinite(v) ? v : 0,
  );

export const dataBR = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return d && m && a ? `${d}/${m}/${a}` : String(iso);
};

/* ==================================================================== */
/* O catálogo                                                            */
/* ==================================================================== */

/**
 * Janela máxima de consulta, em dias.
 *
 * Noventa. Não é limite técnico — é o horizonte em que a pergunta ainda
 * é sobre gestão de caixa. "Quanto tenho a pagar nos próximos 3 anos"
 * devolveria uma lista que ninguém lê e um total que não significa nada,
 * porque metade ainda vai mudar.
 */
export const MAX_DIAS = 90;

/** Linhas devolvidas por consulta de lista. */
export const MAX_LINHAS = 40;

const dias = z
  .number()
  .int()
  .min(1)
  .max(MAX_DIAS)
  .describe(`Quantos dias à frente, de 1 a ${MAX_DIAS}.`);

/**
 * As definições que vão para o modelo.
 *
 * A `descricao` é lida pelo modelo para decidir quando chamar. Ela
 * descreve a PERGUNTA que a ferramenta responde, não a tabela que ela
 * consulta — "o que vence nos próximos dias" acerta mais que "consulta
 * transactions com status pendente".
 */
export const FERRAMENTAS = {
  contas_a_pagar: {
    descricao:
      'O que a empresa tem para PAGAR nos próximos dias: fornecedores, contas e ' +
      'despesas com vencimento à frente, com valor, data e para quem. Use quando ' +
      'perguntarem sobre pagamentos, contas a pagar, o que vence, ou quanto sai de caixa.',
    parametros: z.object({ dias: dias.default(30) }),
  },

  contas_a_receber: {
    descricao:
      'O que a empresa tem para RECEBER nos próximos dias, com valor, data e de quem. ' +
      'Use quando perguntarem sobre recebimentos, clientes a receber, ou quanto entra de caixa.',
    parametros: z.object({ dias: dias.default(30) }),
  },

  resumo_de_contas: {
    descricao:
      'Visão geral de contas a pagar e a receber: total em aberto, quanto já está ' +
      'vencido, quanto vence hoje, em 7 e em 30 dias. Use para a pergunta ampla ' +
      '"como estão minhas contas" ou quando quiserem o panorama antes do detalhe.',
    parametros: z.object({}),
  },

  saldo_em_caixa: {
    descricao:
      'Saldo atual das contas bancárias e do caixa da empresa, conta por conta. ' +
      'Use quando perguntarem quanto tem em caixa, saldo, ou disponível hoje.',
    parametros: z.object({}),
  },

  resultado_do_mes: {
    descricao:
      'A DRE gerencial: receitas, custos, despesas e resultado do mês. Use quando ' +
      'perguntarem sobre lucro, resultado, faturamento, despesas do mês ou comparação ' +
      'entre meses.',
    parametros: z.object({
      meses: z
        .number()
        .int()
        .min(1)
        .max(12)
        .default(3)
        .describe('Quantos meses para trás, incluindo o atual. De 1 a 12.'),
    }),
  },

  ultimo_diagnostico: {
    descricao:
      'O diagnóstico financeiro mais recente da empresa: pontuação, nível de saúde e ' +
      'os indicadores que acenderam alerta, com o valor de cada um. Use quando ' +
      'perguntarem como está a saúde financeira, o score, ou o que está ruim.',
    parametros: z.object({}),
  },

  acoes_do_plano: {
    descricao:
      'As ações do plano de ação em vigor, com responsável, prazo e situação. Use ' +
      'quando perguntarem o que precisa ser feito, o que está atrasado, ou por onde começar.',
    parametros: z.object({}),
  },
} as const;

export type NomeFerramenta = keyof typeof FERRAMENTAS;

export const NOMES = Object.keys(FERRAMENTAS) as NomeFerramenta[];

export function existe(nome: string): nome is NomeFerramenta {
  return Object.prototype.hasOwnProperty.call(FERRAMENTAS, nome);
}

/**
 * Valida o que o modelo mandou.
 *
 * Devolve erro em texto em vez de lançar: um parâmetro errado não deve
 * derrubar a conversa. O erro volta ao modelo como resultado da
 * ferramenta, e ele corrige na rodada seguinte — que é o comportamento
 * que a API de ferramentas espera.
 */
export function validarParametros(
  nome: NomeFerramenta,
  bruto: unknown,
): { ok: true; valor: Record<string, unknown> } | { ok: false; erro: string } {
  const r = FERRAMENTAS[nome].parametros.safeParse(bruto ?? {});

  if (r.success) return { ok: true, valor: r.data as Record<string, unknown> };

  const detalhe = r.error.issues
    .map((i) => `${i.path.join('.') || 'parâmetro'}: ${i.message}`)
    .join('; ');

  return { ok: false, erro: `Parâmetros inválidos para ${nome} — ${detalhe}` };
}

/* ==================================================================== */
/* Resultados em texto                                                   */
/* ==================================================================== */

export interface Titulo {
  descricao: string | null;
  pessoa: string | null;
  valor: number;
  vencimento: string;
  vencido: boolean;
}

/**
 * A lista de títulos, já somada e ordenada por vencimento.
 *
 * Vencido primeiro, e dito com todas as letras. É a informação que muda
 * o que a pessoa faz hoje, e enterrá-la no meio de uma lista cronológica
 * seria tecnicamente correto e praticamente inútil.
 */
export function resumirTitulos(
  titulos: Titulo[],
  natureza: 'a_pagar' | 'a_receber',
  dias: number,
): string {
  const verbo = natureza === 'a_pagar' ? 'pagar' : 'receber';

  if (titulos.length === 0) {
    return `Nada a ${verbo} nos próximos ${dias} dias.`;
  }

  const total = titulos.reduce((s, t) => s + t.valor, 0);
  const vencidos = titulos.filter((t) => t.vencido);
  const l: string[] = [];

  l.push(
    `Total a ${verbo} nos próximos ${dias} dias: ${brl(total)} em ` +
      `${titulos.length} ${titulos.length === 1 ? 'título' : 'títulos'}.`,
  );

  if (vencidos.length > 0) {
    const tv = vencidos.reduce((s, t) => s + t.valor, 0);
    l.push(
      `Destes, ${vencidos.length} ${vencidos.length === 1 ? 'está vencido' : 'estão vencidos'}, ` +
        `somando ${brl(tv)}.`,
    );
  }

  l.push('');
  for (const t of titulos.slice(0, MAX_LINHAS)) {
    const quem = t.pessoa ? ` · ${t.pessoa}` : '';
    const marca = t.vencido ? ' (VENCIDO)' : '';
    l.push(`- ${dataBR(t.vencimento)}${marca} · ${brl(t.valor)} · ${t.descricao ?? 'sem descrição'}${quem}`);
  }

  if (titulos.length > MAX_LINHAS) {
    l.push(`… e mais ${titulos.length - MAX_LINHAS} títulos não listados.`);
  }

  return l.join('\n');
}

export interface ResumoContas {
  natureza: 'a_pagar' | 'a_receber';
  total_aberto: number;
  titulos_abertos: number;
  total_vencido: number;
  titulos_vencidos: number;
  vence_hoje: number;
  vence_7d: number;
  vence_30d: number;
}

export function resumirContas(linhas: ResumoContas[]): string {
  if (linhas.length === 0) {
    return 'Não há contas a pagar nem a receber em aberto.';
  }

  const l: string[] = [];
  for (const c of linhas) {
    const nome = c.natureza === 'a_pagar' ? 'A PAGAR' : 'A RECEBER';
    l.push(`${nome}: ${brl(c.total_aberto)} em ${c.titulos_abertos} títulos em aberto.`);
    if (c.total_vencido > 0) {
      l.push(`  Vencido: ${brl(c.total_vencido)} (${c.titulos_vencidos} títulos).`);
    }
    l.push(
      `  Vence hoje: ${brl(c.vence_hoje)} · em 7 dias: ${brl(c.vence_7d)} · ` +
        `em 30 dias: ${brl(c.vence_30d)}.`,
    );
    l.push('');
  }

  return l.join('\n').trim();
}

export interface Conta {
  nome: string;
  saldo: number;
}

export function resumirSaldos(contas: Conta[]): string {
  if (contas.length === 0) return 'Nenhuma conta cadastrada.';

  const total = contas.reduce((s, c) => s + c.saldo, 0);
  const l = [`Saldo total: ${brl(total)}.`, ''];
  for (const c of contas) l.push(`- ${c.nome}: ${brl(c.saldo)}`);
  return l.join('\n');
}

export interface MesDRE {
  mes: string;
  receita: number;
  custos: number;
  despesas: number;
  resultado: number;
}

export function resumirDRE(meses: MesDRE[]): string {
  if (meses.length === 0) return 'Ainda não há lançamentos para montar a DRE.';

  const l: string[] = [];
  for (const m of meses) {
    const margem = m.receita > 0 ? ((m.resultado / m.receita) * 100).toFixed(1) : null;
    l.push(
      `${m.mes}: receita ${brl(m.receita)} · custos ${brl(m.custos)} · ` +
        `despesas ${brl(m.despesas)} · resultado ${brl(m.resultado)}` +
        (margem === null ? '' : ` (${margem}% da receita)`),
    );
  }
  return l.join('\n');
}

export interface Alerta {
  indicador: string;
  status: string;
  valor: number | null;
}

export function resumirDiagnostico(d: {
  competencia: string;
  score: number | null;
  nivel: string | null;
  alertas: Alerta[];
} | null): string {
  if (!d) {
    return 'Esta empresa ainda não tem diagnóstico financeiro apurado.';
  }

  const l = [
    `Diagnóstico de ${d.competencia}: ${d.score ?? '—'} pontos de 100` +
      (d.nivel ? ` (${d.nivel})` : '') + '.',
  ];

  const vermelhos = d.alertas.filter((a) => a.status === 'vermelho');
  const amarelos = d.alertas.filter((a) => a.status === 'amarelo');

  if (vermelhos.length === 0 && amarelos.length === 0) {
    l.push('Nenhum indicador em alerta.');
    return l.join('\n');
  }

  if (vermelhos.length > 0) {
    l.push('');
    l.push('Em situação crítica:');
    for (const a of vermelhos) l.push(`- ${a.indicador}: ${a.valor ?? '—'}`);
  }

  if (amarelos.length > 0) {
    l.push('');
    l.push('Em atenção:');
    for (const a of amarelos) l.push(`- ${a.indicador}: ${a.valor ?? '—'}`);
  }

  return l.join('\n');
}
