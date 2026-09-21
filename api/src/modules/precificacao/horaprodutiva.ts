/**
 * Custo da hora produtiva.
 *
 * Porta da planilha "Planilha de Precificação · Hora Produtiva —
 * Aula 3.4".
 *
 * =====================================================================
 * A HORA CONTRATADA É O NÚMERO ERRADO QUE TODO MUNDO USA
 * =====================================================================
 * Dividir a folha pelas 220 horas do contrato dá um custo por hora
 * bonito e falso. Ele ignora duas coisas:
 *
 *   • **Horas que se paga e não se tem** — férias provisionadas,
 *     feriados, faltas e atestados. Saem da folha, não geram serviço.
 *   • **Ocupação produtiva** — da hora que sobra, só parte é trabalho
 *     que o cliente paga. Deslocamento, orçamento não fechado, retrabalho
 *     e espera consomem o resto. 70% já é uma equipe bem organizada.
 *
 * O resultado é que a hora real custa tipicamente 40% a 80% mais que a
 * contratada. Todo orçamento feito pela hora contratada erra por essa
 * margem — e erra para baixo, que é a direção que faz o serviço parecer
 * lucrativo quando não é.
 *
 * =====================================================================
 * O SERVIÇO QUE SE FAZ DE GRAÇA
 * =====================================================================
 * Visita técnica, orçamento no local, "passar lá para ver" — todo
 * negócio de serviço tem um desses, e nenhum sabe quanto custa. A conta
 * é simples e o número costuma assustar: horas × custo da hora × vezes
 * por mês × 12.
 *
 * A planilha avisa antes: cobrar um serviço que era grátis derruba o
 * volume. Saber o custo não obriga a cobrar — obriga a decidir.
 */

export interface EntradaHoraProdutiva {
  /** Folha total do mês: salários, encargos e benefícios. */
  folhaMensal: number;
  /** Quantas pessoas a folha cobre. */
  pessoas: number;
  /** Horas contratadas por mês. 220 na jornada de 44h semanais. */
  horasContratadas: number;

  /** Horas de férias provisionadas no mês (1/12 do período). */
  horasFerias: number;
  /** Feriados do mês, em horas, na média do ano. */
  horasFeriados: number;
  /** Faltas, atestados e atrasos, em horas. */
  horasFaltas: number;

  /** Quanto da hora disponível é trabalho que o cliente paga, em %. */
  ocupacaoPct: number;

  /** O serviço que se faz de graça. */
  servicoNome?: string | null;
  servicoHoras?: number | null;
  servicoPorMes?: number | null;
}

export interface ResultadoHoraProdutiva {
  custoPorPessoa: number;
  /** O número que quase todo mundo usa — e que está errado. */
  custoHoraContratada: number | null;

  horasPerdidas: number;
  horasDisponiveis: number;
  horasProdutivas: number;

  /** O custo real de uma hora da equipe. */
  custoHoraProdutiva: number | null;
  /** Quanto a hora real custa a mais que a contratada, em %. */
  diferencaPct: number | null;

  custoDoServicoGratis: number | null;
  custoAnualDoServicoGratis: number | null;

  alertas: string[];
  erro: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function calcularHoraProdutiva(e: EntradaHoraProdutiva): ResultadoHoraProdutiva {
  const folha = num(e.folhaMensal);
  const pessoas = num(e.pessoas);
  const contratadas = num(e.horasContratadas);
  const ferias = num(e.horasFerias);
  const feriados = num(e.horasFeriados);
  const faltas = num(e.horasFaltas);
  const ocupacao = num(e.ocupacaoPct);

  const vazio = (erro: string): ResultadoHoraProdutiva => ({
    custoPorPessoa: 0,
    custoHoraContratada: null,
    horasPerdidas: 0,
    horasDisponiveis: 0,
    horasProdutivas: 0,
    custoHoraProdutiva: null,
    diferencaPct: null,
    custoDoServicoGratis: null,
    custoAnualDoServicoGratis: null,
    alertas: [],
    erro,
  });

  if (folha <= 0) {
    return vazio(
      'Informe a folha do mês — salários, encargos e benefícios. Sem ela não há custo de hora nenhum.',
    );
  }
  if (pessoas <= 0) {
    return vazio('Informe quantas pessoas a folha cobre.');
  }
  if (contratadas <= 0) {
    return vazio('Informe as horas contratadas por mês. São 220 na jornada de 44 horas semanais.');
  }
  if (ocupacao <= 0 || ocupacao > 100) {
    return vazio(
      'A ocupação produtiva precisa ficar entre 1 e 100%. É quanto da hora disponível vira trabalho que o cliente paga — 70% já é uma equipe bem organizada.',
    );
  }
  if ([ferias, feriados, faltas].some((v) => v < 0)) {
    return vazio('Férias, feriados e faltas não podem ser negativos.');
  }

  const alertas: string[] = [];

  const custoPorPessoa = r2(folha / pessoas);
  const custoHoraContratada = r2(custoPorPessoa / contratadas);

  const horasPerdidas = r2(ferias + feriados + faltas);
  const horasDisponiveis = r2(contratadas - horasPerdidas);

  if (horasDisponiveis <= 0) {
    return vazio(
      `Férias, feriados e faltas somam ${horasPerdidas} horas, mais que as ${contratadas} contratadas. Confira os três números — provavelmente algum está no mês errado.`,
    );
  }

  const horasProdutivas = r2(horasDisponiveis * (ocupacao / 100));
  const custoHoraProdutiva = horasProdutivas > 0 ? r2(custoPorPessoa / horasProdutivas) : null;

  const diferencaPct =
    custoHoraProdutiva !== null && custoHoraContratada > 0
      ? r2((custoHoraProdutiva / custoHoraContratada - 1) * 100)
      : null;

  if (custoHoraProdutiva !== null && diferencaPct !== null) {
    alertas.push(
      `A hora real custa ${brl(custoHoraProdutiva)}, ${diferencaPct}% a mais que os ${brl(custoHoraContratada)} da hora contratada. Todo orçamento feito pela hora contratada erra por essa margem — e erra para baixo.`,
    );
  }

  // As horas que se paga e não se tem, em proporção. Acima de um quinto
  // costuma significar que as faltas entraram em dobro, ou que o número
  // de feriados foi somado no ano em vez da média do mês.
  if (horasPerdidas / contratadas > 0.2) {
    alertas.push(
      `${horasPerdidas} das ${contratadas} horas contratadas são férias, feriados ou faltas — mais de um quinto. Se o número não estiver errado, vale olhar o absenteísmo antes de qualquer conta de preço.`,
    );
  }

  if (ocupacao > 85) {
    alertas.push(
      `Uma ocupação produtiva de ${ocupacao}% é alta demais para ser real: ela assume quase nenhum deslocamento, orçamento não fechado, retrabalho ou espera. Chutar a ocupação para cima é a forma mais comum de fazer a hora parecer barata.`,
    );
  }

  /* -------------------------------- O serviço que se faz de graça */
  const horasServico = num(e.servicoHoras);
  const porMes = num(e.servicoPorMes);

  let custoDoServicoGratis: number | null = null;
  let custoAnualDoServicoGratis: number | null = null;

  if (custoHoraProdutiva !== null && horasServico > 0 && porMes > 0) {
    custoDoServicoGratis = r2(custoHoraProdutiva * horasServico);
    custoAnualDoServicoGratis = r2(custoDoServicoGratis * porMes * 12);

    alertas.push(
      `${e.servicoNome?.trim() || 'O serviço gratuito'} custa ${brl(custoDoServicoGratis)} cada vez. São ${porMes} por mês, ${brl(custoAnualDoServicoGratis)} por ano — valor que sai do seu bolso sem nota e sem discussão.`,
    );
  }

  return {
    custoPorPessoa,
    custoHoraContratada,
    horasPerdidas,
    horasDisponiveis,
    horasProdutivas,
    custoHoraProdutiva,
    diferencaPct,
    custoDoServicoGratis,
    custoAnualDoServicoGratis,
    alertas,
    erro: null,
  };
}
