/**
 * Executa o que o assistente pediu.
 *
 * =====================================================================
 * O TENANT É INJETADO AQUI, E SÓ AQUI
 * =====================================================================
 * Toda função recebe `tenantId` como primeiro argumento, vindo do JWT
 * pela rota. O objeto de parâmetros que o modelo produziu entra depois,
 * já validado pelo catálogo — que não tem campo de empresa.
 *
 * As consultas usam o client do USUÁRIO (`req.supabase`), não o admin.
 * Então há duas barreiras em série: o filtro explícito por `tenant_id` e
 * o RLS por cima. Se um dia o filtro for esquecido numa consulta nova, o
 * banco ainda recusa — e é por isso que vale usar o client do usuário
 * mesmo tendo o tenant em mãos.
 *
 * =====================================================================
 * AS MESMAS VIEWS DAS TELAS
 * =====================================================================
 * `vw_contas_resumo`, `vw_dre_monthly`, `vw_dashboard_kpis`. Não há
 * consulta nova calculando nada por fora.
 *
 * É deliberado: no dia em que o assistente responder um total e a tela
 * mostrar outro, o cliente para de confiar nos dois. Uma fonte, dois
 * apresentadores.
 */

import {
  brl,
  resumirContas,
  resumirDiagnostico,
  resumirDRE,
  resumirSaldos,
  resumirTitulos,
  type Alerta,
  type NomeFerramenta,
} from './ferramentas.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Db = { from: (t: string) => any };
/* eslint-enable @typescript-eslint/no-explicit-any */

/** O que volta para o modelo: texto pronto, sem JSON para ele interpretar. */
export interface ResultadoFerramenta {
  texto: string;
  /** Quantas linhas a consulta devolveu, para o log de uso. */
  linhas: number;
}

const hojeISO = () => new Date().toISOString().slice(0, 10);

const emDias = (dias: number) =>
  new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10);

/**
 * Títulos em aberto até certa data.
 *
 * Traz os VENCIDOS junto, mesmo que a pergunta seja sobre os próximos
 * dias. Quem pergunta "o que tenho para pagar nos próximos 10 dias" quer
 * saber o que precisa sair de caixa — e o que venceu ontem e não foi
 * pago continua tendo que sair. Omitir seria tecnicamente fiel à
 * pergunta e enganoso na prática.
 */
async function titulos(
  db: Db,
  tenantId: string,
  tipo: 'despesa' | 'receita',
  dias: number,
): Promise<ResultadoFerramenta> {
  const { data, error } = await db
    .from('transactions')
    .select('description, amount, due_date, entity_id, entities(name)')
    .eq('tenant_id', tenantId)
    .eq('status', 'pendente')
    .eq('type', tipo)
    .lte('due_date', emDias(dias))
    .order('due_date', { ascending: true })
    .limit(200);

  if (error) throw new Error(error.message);

  const hoje = hojeISO();
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const linhas = ((data ?? []) as any[]).map((t) => ({
    descricao: t.description ?? null,
    pessoa: t.entities?.name ?? null,
    valor: Number(t.amount ?? 0),
    vencimento: String(t.due_date),
    vencido: String(t.due_date) < hoje,
  }));

  return {
    texto: resumirTitulos(linhas, tipo === 'despesa' ? 'a_pagar' : 'a_receber', dias),
    linhas: linhas.length,
  };
}

async function resumoDeContas(db: Db, tenantId: string): Promise<ResultadoFerramenta> {
  const { data, error } = await db
    .from('vw_contas_resumo')
    .select('*')
    .eq('tenant_id', tenantId);

  if (error) throw new Error(error.message);

  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const linhas = ((data ?? []) as any[]).map((c) => ({
    natureza: c.natureza as 'a_pagar' | 'a_receber',
    total_aberto: Number(c.total_aberto ?? 0),
    titulos_abertos: Number(c.titulos_abertos ?? 0),
    total_vencido: Number(c.total_vencido ?? 0),
    titulos_vencidos: Number(c.titulos_vencidos ?? 0),
    vence_hoje: Number(c.vence_hoje ?? 0),
    vence_7d: Number(c.vence_7d ?? 0),
    vence_30d: Number(c.vence_30d ?? 0),
  }));

  return { texto: resumirContas(linhas), linhas: linhas.length };
}

/**
 * Saldo por conta, mais o saldo consolidado da plataforma.
 *
 * `vw_dashboard_kpis.saldo_hoje` é a conta que o painel mostra: saldo
 * inicial das contas ativas mais tudo que foi liquidado até hoje. O
 * total daqui precisa bater com o número grande do painel, senão o
 * cliente vê dois saldos.
 */
async function saldoEmCaixa(db: Db, tenantId: string): Promise<ResultadoFerramenta> {
  const { data, error } = await db
    .from('vw_dashboard_kpis')
    .select('saldo_hoje')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  const { data: contas } = await db
    .from('bank_accounts')
    .select('name')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('name');

  const total = Number(data?.saldo_hoje ?? 0);
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const nomes = ((contas ?? []) as any[]).map((c) => String(c.name));

  if (nomes.length === 0) return { texto: resumirSaldos([]), linhas: 0 };

  // O consolidado vem da view; o saldo POR conta exigiria repetir a
  // lógica de liquidação conta a conta, e dois lugares calculando o mesmo
  // número é exatamente o que este arquivo evita. Então declara o total e
  // nomeia as contas que entram nele.
  return {
    texto:
      `Saldo total hoje: ${brl(total)}.\n\n` +
      `Considera ${nomes.length} ${nomes.length === 1 ? 'conta ativa' : 'contas ativas'}: ` +
      `${nomes.join(', ')}.`,
    linhas: nomes.length,
  };
}

async function resultadoDoMes(
  db: Db,
  tenantId: string,
  meses: number,
): Promise<ResultadoFerramenta> {
  const { data, error } = await db
    .from('vw_dre_monthly')
    // `margem_contribuicao` e o percentual vêm da VIEW. Omiti-los foi o
    // que levou o modelo a calcular a MC por conta própria e errar — ver
    // a nota em `MesDRE`.
    .select(
      'competencia, receita_bruta, deducoes, custos_variaveis, margem_contribuicao, ' +
        'margem_contribuicao_pct, despesas_fixas, resultado_liquido',
    )
    .eq('tenant_id', tenantId)
    .order('competencia', { ascending: false })
    .limit(meses);

  if (error) throw new Error(error.message);

  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const linhas = ((data ?? []) as any[]).map((m) => ({
    mes: String(m.competencia).slice(0, 7),
    receita: Number(m.receita_bruta ?? 0) - Number(m.deducoes ?? 0),
    custos: Number(m.custos_variaveis ?? 0),
    margem_contribuicao: Number(m.margem_contribuicao ?? 0),
    margem_contribuicao_pct:
      m.margem_contribuicao_pct === null || m.margem_contribuicao_pct === undefined
        ? null
        : Number(m.margem_contribuicao_pct),
    despesas: Number(m.despesas_fixas ?? 0),
    resultado: Number(m.resultado_liquido ?? 0),
  }));

  return { texto: resumirDRE(linhas), linhas: linhas.length };
}

async function ultimoDiagnostico(db: Db, tenantId: string): Promise<ResultadoFerramenta> {
  const { data, error } = await db
    .from('diagnosticos_mensais')
    .select('competencia, score_total, nivel, alertas')
    .eq('tenant_id', tenantId)
    .eq('status', 'calculado')
    .order('competencia', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return { texto: resumirDiagnostico(null), linhas: 0 };

  const alertas = (Array.isArray(data.alertas) ? data.alertas : []) as Alerta[];

  return {
    texto: resumirDiagnostico({
      competencia: String(data.competencia).slice(0, 7),
      score: data.score_total ?? null,
      nivel: data.nivel ?? null,
      alertas,
    }),
    linhas: alertas.length,
  };
}

async function acoesDoPlano(db: Db, tenantId: string): Promise<ResultadoFerramenta> {
  const { data, error } = await db
    .from('vw_quadro_acoes')
    .select('titulo, responsavel_nome, prazo, status, atrasada, dias_para_o_prazo, pilar')
    .eq('tenant_id', tenantId)
    .order('status')
    .order('prazo');

  if (error) throw new Error(error.message);

  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const linhas = (data ?? []) as any[];

  if (linhas.length === 0) {
    return { texto: 'O plano de ação desta empresa ainda não tem ações cadastradas.', linhas: 0 };
  }

  const abertas = linhas.filter((a) => a.status === 'aberta');
  const atrasadas = abertas.filter((a) => a.atrasada);

  const l = [
    `${linhas.length} ações no plano · ${abertas.length} abertas · ${atrasadas.length} atrasadas.`,
    '',
  ];

  for (const a of linhas) {
    const situacao =
      a.status === 'concluida'
        ? 'concluída'
        : a.atrasada
          ? `ATRASADA há ${Math.abs(Number(a.dias_para_o_prazo))} dias`
          : `faltam ${a.dias_para_o_prazo} dias`;
    l.push(`- ${a.titulo} · ${a.responsavel_nome} · ${situacao}`);
  }

  return { texto: l.join('\n'), linhas: linhas.length };
}

/**
 * O despachante.
 *
 * Recebe o nome já conferido pelo catálogo e os parâmetros já validados.
 * Erro de banco vira texto de volta ao modelo, não exceção: uma consulta
 * que falhou não deve derrubar a conversa, e o modelo consegue dizer ao
 * cliente que aquele dado não veio.
 */
export async function executar(
  db: Db,
  tenantId: string,
  nome: NomeFerramenta,
  params: Record<string, unknown>,
): Promise<ResultadoFerramenta> {
  try {
    switch (nome) {
      case 'contas_a_pagar':
        return await titulos(db, tenantId, 'despesa', Number(params.dias ?? 30));
      case 'contas_a_receber':
        return await titulos(db, tenantId, 'receita', Number(params.dias ?? 30));
      case 'resumo_de_contas':
        return await resumoDeContas(db, tenantId);
      case 'saldo_em_caixa':
        return await saldoEmCaixa(db, tenantId);
      case 'resultado_do_mes':
        return await resultadoDoMes(db, tenantId, Number(params.meses ?? 3));
      case 'ultimo_diagnostico':
        return await ultimoDiagnostico(db, tenantId);
      case 'acoes_do_plano':
        return await acoesDoPlano(db, tenantId);
    }
  } catch (e) {
    return {
      texto:
        'Não consegui consultar esse dado agora. Diga ao cliente que houve uma falha ' +
        'ao buscar a informação e que ele pode tentar de novo em instantes. Não estime ' +
        'o valor.',
      linhas: 0,
    };
  }
}
