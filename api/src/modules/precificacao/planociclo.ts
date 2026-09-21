/**
 * Plano de redução de ciclo.
 *
 * Porta da planilha "Plano de Redução de Ciclo — Aula 4.3".
 *
 * =====================================================================
 * ISTO NÃO É UMA CALCULADORA
 * =====================================================================
 * As outras ferramentas medem. Esta compromete. A regra da aula é
 * explícita: **só entra no plano o que tem responsável e prazo** —
 * alavanca sem dono não é plano, é lista de desejos.
 *
 * Por isso as alavancas viram `acoes` do plano de ação que a plataforma
 * já tem, e não linhas de uma tabela própria. A tabela `acoes` exige
 * responsável e prazo no próprio banco, e as ações aparecem no painel
 * inicial como pendências. Uma tabela separada seria visitada uma vez e
 * esquecida.
 *
 * =====================================================================
 * SÓ ALAVANCA ABERTA PROJETA GANHO
 * =====================================================================
 * Alavanca concluída já produziu efeito, e esse efeito já está dentro do
 * ciclo de hoje — que sai dos lançamentos. Contá-la de novo na projeção
 * prometeria duas vezes a mesma redução, e o plano nunca fecharia com a
 * realidade.
 *
 * =====================================================================
 * O JURO QUE DEIXA DE SER PAGO
 * =====================================================================
 * Liberar R$ 30.000 de capital de giro não é ganhar R$ 30.000: é deixar
 * de tomar R$ 30.000 emprestado. O valor do plano é o JURO evitado —
 * composto sobre doze meses, porque capital de giro se renova mês a mês.
 *
 * É a conta que justifica a ordem da aula: este plano vem ANTES da
 * decisão de tomar crédito, não depois.
 */

export interface Alavanca {
  id: string;
  titulo: string;
  detalhe: string | null;
  ganhoDias: number;
  responsavel: string;
  prazo: string;
  status: 'aberta' | 'concluida' | 'cancelada';
}

export interface AlavancaCalculada extends Alavanca {
  /** Ganho em dias × venda diária. Zero em alavanca não aberta. */
  liberaReais: number;
  /** Entra na projeção? Só as abertas entram. */
  projeta: boolean;
}

export interface EntradaPlanoCiclo {
  /** Ciclo financeiro de hoje, em dias. Vem da aula 4.1. */
  cicloHojeDias: number;
  /** Receita do mês ÷ 30. */
  vendaDiaria: number;
  alavancas: Alavanca[];
  /** Taxa mensal de capital de giro, em %. Para o juro evitado. */
  taxaCapitalGiroMesPct?: number | null;
}

export interface ResultadoPlanoCiclo {
  alavancas: AlavancaCalculada[];

  ganhoTotalDias: number;
  liberaTotal: number;

  cicloDepoisDias: number;
  ncgHoje: number;
  ncgDepois: number;

  /** Juro que deixa de ser pago em doze meses. */
  economiaAnual: number | null;

  concluidasDias: number;
  alertas: string[];
  erro: string | null;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function calcularPlanoCiclo(e: EntradaPlanoCiclo): ResultadoPlanoCiclo {
  const cicloHoje = num(e.cicloHojeDias);
  const vendaDiaria = num(e.vendaDiaria);

  const vazio = (erro: string): ResultadoPlanoCiclo => ({
    alavancas: [],
    ganhoTotalDias: 0,
    liberaTotal: 0,
    cicloDepoisDias: 0,
    ncgHoje: 0,
    ncgDepois: 0,
    economiaAnual: null,
    concluidasDias: 0,
    alertas: [],
    erro,
  });

  if (vendaDiaria <= 0) {
    return vazio(
      'Sem venda diária não é possível converter dias em reais. Ela sai da receita do mês dividida por 30 — lance as vendas ou informe o faturamento na calculadora de ciclo.',
    );
  }

  const alertas: string[] = [];

  const alavancas: AlavancaCalculada[] = (e.alavancas ?? []).map((a) => {
    const dias = num(a.ganhoDias);
    const projeta = a.status === 'aberta';
    return {
      ...a,
      ganhoDias: r1(dias),
      projeta,
      liberaReais: projeta ? r2(dias * vendaDiaria) : 0,
    };
  });

  const abertas = alavancas.filter((a) => a.projeta);
  const ganhoTotalDias = r1(abertas.reduce((s, a) => s + a.ganhoDias, 0));
  const liberaTotal = r2(abertas.reduce((s, a) => s + a.liberaReais, 0));

  const concluidasDias = r1(
    alavancas.filter((a) => a.status === 'concluida').reduce((s, a) => s + a.ganhoDias, 0),
  );

  const cicloDepoisDias = r1(cicloHoje - ganhoTotalDias);
  const ncgHoje = r2(cicloHoje * vendaDiaria);
  const ncgDepois = r2(cicloDepoisDias * vendaDiaria);

  /* ------------------------------------- O juro que não será pago */
  const taxa = num(e.taxaCapitalGiroMesPct);
  const economiaAnual =
    taxa > 0 && liberaTotal > 0
      ? r2(liberaTotal * (Math.pow(1 + taxa / 100, 12) - 1))
      : null;

  /* ------------------------------------------------- As leituras */
  if (!alavancas.length) {
    alertas.push(
      'Nenhuma alavanca no plano ainda. Comece pela mais rápida: girar o estoque parado não depende de terceiro nenhum e costuma render os primeiros dias em trinta dias.',
    );
  } else if (!abertas.length) {
    alertas.push(
      `Todas as alavancas do plano já foram concluídas — ${concluidasDias} dias no total. O efeito delas já está dentro do ciclo de hoje. Vale rodar a calculadora de ciclo de novo e montar a próxima rodada.`,
    );
  }

  if (ganhoTotalDias > 0) {
    alertas.push(
      `O plano tira ${ganhoTotalDias} dias do ciclo e devolve ${brl(liberaTotal)} ao caixa — a mesma operação, com menos dinheiro preso. Sem vender nada a mais e sem tomar crédito.`,
    );
  }

  if (economiaAnual !== null) {
    alertas.push(
      `Esses ${brl(liberaTotal)} deixam de ser emprestados. A ${taxa}% ao mês, é ${brl(economiaAnual)} de juro que você não paga em doze meses — e é por isso que este plano vem ANTES da decisão de tomar crédito.`,
    );
  }

  if (cicloDepoisDias < 0) {
    alertas.push(
      `O plano promete tirar ${ganhoTotalDias} dias de um ciclo de ${cicloHoje}. O resultado seria um ciclo negativo, o que é possível mas raro — vale conferir se os ganhos não estão otimistas demais.`,
    );
  }

  // O teste de realidade da aula: ganhos que somam mais da metade do
  // ciclo atual quase sempre são otimismo, não plano.
  if (cicloHoje > 0 && ganhoTotalDias > cicloHoje * 0.5) {
    alertas.push(
      `As alavancas somam ${ganhoTotalDias} dias, mais da metade do ciclo atual de ${cicloHoje}. Planos assim costumam ser otimismo em forma de tabela — prefira menos alavancas com ganho que você consegue defender.`,
    );
  }

  const semDetalhe = alavancas.filter((a) => a.projeta && !a.detalhe?.trim());
  if (semDetalhe.length) {
    alertas.push(
      `${semDetalhe.length === 1 ? 'Uma alavanca não diz' : `${semDetalhe.length} alavancas não dizem`} o que exatamente vai ser feito. "Encurtar o recebimento" não é ação; "reduzir o carnê de 3x para 2x nas vendas abaixo de R$ 300" é.`,
    );
  }

  return {
    alavancas,
    ganhoTotalDias,
    liberaTotal,
    cicloDepoisDias,
    ncgHoje,
    ncgDepois,
    economiaAnual,
    concluidasDias,
    alertas,
    erro: null,
  };
}
