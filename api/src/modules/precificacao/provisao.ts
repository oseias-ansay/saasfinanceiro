/**
 * As três reservas.
 *
 * Porta da planilha "Calculadora de Provisão — Aula 4.5".
 *
 * =====================================================================
 * DUAS SÃO APORTE MENSAL, A TERCEIRA É META DE SALDO
 * =====================================================================
 * Imposto e provisão trabalhista se separam TODO MÊS, e o valor sai da
 * receita daquele mês. A reserva de emergência é diferente: é um SALDO
 * a alcançar — três meses de desembolso fixo — que se constrói com o
 * que sobrar, no ritmo que der.
 *
 * Somar as três num "total a separar por mês" seria o erro óbvio, e
 * daria um número tão alto que ninguém separaria nada. Por isso o total
 * mensal tem duas parcelas, não três, e a emergência aparece como
 * distância até a meta.
 *
 * =====================================================================
 * A CONTA DO 13º E DAS FÉRIAS
 * =====================================================================
 *     folha/12  +  folha × (4/3)/12
 *
 * Um doze avos para o 13º; e para as férias, o salário mais o terço
 * constitucional divididos por doze — ou seja, um nono da folha.
 *
 * Esses valores JÁ ESTÃO na DRE como despesa de pessoal mês a mês. O
 * que falta é estarem no banco. É essa a diferença entre uma empresa
 * que fecha dezembro tranquila e uma que descobre em novembro que o
 * décimo terceiro não tem de onde sair.
 *
 * =====================================================================
 * SOBRE USAR O DINHEIRO DO IMPOSTO
 * =====================================================================
 * O imposto se separa no dia em que o dinheiro ENTRA, não no dia do
 * vencimento. Uma empresa que só separa no dia 18 está financiando a
 * operação com dinheiro que nunca foi dela — e funciona, até o primeiro
 * mês fraco.
 */

export interface EntradaProvisao {
  /** Receita do mês. É sobre ela que incide a alíquota. */
  receitaMensal: number;
  /** Alíquota EFETIVA sobre a venda, em %. */
  aliquotaPct: number;
  /** Salários + encargos + benefícios do mês. */
  folhaMensal: number;
  /** Fixo sem depreciação + pró-labore + juro + amortização. */
  desembolsoFixoMensal: number;
  /** Saldo em caixa hoje. */
  saldoCaixa: number;
}

export type SituacaoReserva =
  | 'sem_dados'
  | 'menos_de_um_mes'
  | 'em_construcao'
  | 'meta_atingida';

export interface ResultadoProvisao {
  /** Separar todo mês, no dia em que o dinheiro entra. */
  reservaImpostos: number;
  /** Separar todo mês. Um doze avos mais um nono da folha. */
  reservaTrabalhista: number;
  /** As duas acima. A emergência NÃO entra aqui — ela é meta de saldo. */
  totalMensal: number;
  /** Quanto isso representa da receita. */
  percentualDaReceita: number | null;

  /** Três meses de desembolso fixo. */
  metaEmergencia: number;
  /** Saldo em caixa ÷ desembolso fixo mensal. */
  reservaAtualEmMeses: number | null;
  /** Quanto falta para a meta. Nunca negativo. */
  faltaParaMeta: number;
  situacao: SituacaoReserva;

  alertas: string[];
  erro: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function calcularProvisao(e: EntradaProvisao): ResultadoProvisao {
  const receita = num(e.receitaMensal);
  const aliquota = num(e.aliquotaPct);
  const folha = num(e.folhaMensal);
  const desembolso = num(e.desembolsoFixoMensal);
  const caixa = num(e.saldoCaixa);

  const vazio = (erro: string): ResultadoProvisao => ({
    reservaImpostos: 0,
    reservaTrabalhista: 0,
    totalMensal: 0,
    percentualDaReceita: null,
    metaEmergencia: 0,
    reservaAtualEmMeses: null,
    faltaParaMeta: 0,
    situacao: 'sem_dados',
    alertas: [],
    erro,
  });

  if (aliquota < 0 || aliquota > 100) {
    return vazio('A alíquota efetiva precisa ficar entre 0 e 100.');
  }
  if ([receita, folha, desembolso].some((v) => v < 0)) {
    return vazio('Receita, folha e desembolso fixo não podem ser negativos.');
  }

  const alertas: string[] = [];

  /* ------------------------------------------- 1. Impostos */
  const reservaImpostos = r2(receita * (aliquota / 100));

  /* -------------------------------- 2. 13º e férias com o terço */
  // 1/12 para o décimo terceiro, 1/9 para as férias com o terço.
  const reservaTrabalhista = r2(folha / 12 + (folha * (4 / 3)) / 12);

  const totalMensal = r2(reservaImpostos + reservaTrabalhista);
  const percentualDaReceita = receita > 0 ? r2((totalMensal / receita) * 100) : null;

  /* ------------------------------------ 3. Emergência: meta de saldo */
  const metaEmergencia = r2(desembolso * 3);

  // Sem desembolso fixo não há régua: "quantos meses o caixa cobre" é
  // uma divisão por zero disfarçada. Devolver zero meses diria "você não
  // tem reserva", quando a verdade é "não dá para saber ainda".
  const mesesExatos = desembolso > 0 ? caixa / desembolso : null;
  const reservaAtualEmMeses = mesesExatos === null ? null : r2(mesesExatos);
  const faltaParaMeta = r2(Math.max(0, metaEmergencia - caixa));

  // A faixa sai do valor EXATO, não do arredondado.
  //
  // Classificar pelo arredondado colocaria 0,9999 mês na faixa "em
  // construção", porque r2 o transforma em 1,00. O caixa cobriria menos
  // de um mês e a tela diria que está tudo encaminhado — justamente na
  // situação em que o alarme precisa tocar.
  const situacao: SituacaoReserva =
    mesesExatos === null
      ? 'sem_dados'
      : mesesExatos < 1
        ? 'menos_de_um_mes'
        : mesesExatos < 3
          ? 'em_construcao'
          : 'meta_atingida';

  if (situacao === 'menos_de_um_mes') {
    alertas.push(
      `O caixa de hoje cobre ${reservaAtualEmMeses} mês de operação. Menos de um mês significa que qualquer atraso de recebimento vira antecipação de recebível ou cheque especial — e os dois custam mais que a reserva renderia.`,
    );
  } else if (situacao === 'em_construcao') {
    alertas.push(
      `O caixa cobre ${reservaAtualEmMeses} meses. Faltam ${brl(faltaParaMeta)} para os três meses de desembolso fixo.`,
    );
  } else if (situacao === 'meta_atingida') {
    alertas.push(
      `A reserva de emergência está completa: o caixa cobre ${reservaAtualEmMeses} meses de operação. A partir daqui, o excedente pode ser investido em vez de ficar parado.`,
    );
  }

  if (reservaImpostos > 0 && caixa < reservaImpostos) {
    // O alerta mais duro da planilha, e o que mais acontece.
    alertas.push(
      `O imposto deste mês é ${brl(reservaImpostos)} e o caixa inteiro é ${brl(caixa)}. O dinheiro do imposto já foi usado na operação — ele nunca foi seu, e a conta chega no vencimento.`,
    );
  }

  if (folha > 0 && receita > 0) {
    const pesoFolha = r2((folha / receita) * 100);
    if (pesoFolha > 30) {
      alertas.push(
        `A folha consome ${pesoFolha}% da receita, e por isso a provisão de 13º e férias é de ${brl(reservaTrabalhista)} por mês. É o tipo de valor que só aparece em dezembro para quem não separa.`,
      );
    }
  }

  return {
    reservaImpostos,
    reservaTrabalhista,
    totalMensal,
    percentualDaReceita,
    metaEmergencia,
    reservaAtualEmMeses,
    faltaParaMeta,
    situacao,
    alertas,
    erro: null,
  };
}
