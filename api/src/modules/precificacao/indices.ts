/**
 * Os três índices: margem, lucratividade e rentabilidade.
 *
 * Porta da planilha "Os Três Índices — Aula 4.8".
 *
 * =====================================================================
 * O MESMO NUMERADOR, TRÊS DENOMINADORES
 * =====================================================================
 * Os três medem uma sobra. O que muda é contra o que ela é comparada:
 *
 *   • **Margem de contribuição** ÷ a venda — quanto sobra de cada venda
 *     para pagar o fixo.
 *   • **Lucratividade** ÷ o faturamento — quanto de tudo que entrou
 *     virou lucro.
 *   • **Rentabilidade** ÷ o CAPITAL — quanto o dinheiro investido nesta
 *     empresa rende.
 *
 * Confundir os três é o erro mais comum, e o mais caro: uma empresa com
 * margem excelente pode ter rentabilidade péssima, porque o capital
 * preso no estoque e no carnê é grande demais para o lucro que ela gera.
 *
 * =====================================================================
 * A RENTABILIDADE PRECISA DESCONTAR O DONO
 * =====================================================================
 * O lucro contábil ainda contém o trabalho do dono, que não foi pago a
 * preço de mercado. O **lucro econômico** — lucro menos pró-labore —
 * é o que sobra depois de remunerar o trabalho, e é ele que vai para o
 * numerador da rentabilidade. Sem isso, o dono compara o rendimento da
 * própria empresa com o de um investimento no qual ele não trabalha.
 *
 * =====================================================================
 * O QUE ESTA CONTA NÃO É
 * =====================================================================
 * Rentabilidade NÃO é quanto a empresa vale. Valuation é outra conta,
 * com outras premissas, e usar a rentabilidade como preço de venda é um
 * erro que custa caro dos dois lados da mesa.
 */

export interface EntradaIndices {
  faturamentoMensal: number;
  /** Margem de contribuição do mês, em reais. */
  margemContribuicao: number;
  /** Resultado líquido do mês. */
  lucroMensal: number;
  /** Pró-labore do mês. Sai do lucro para chegar ao lucro econômico. */
  proLabore: number;

  estoque: number;
  clientesAReceber: number;
  /** Imóvel, veículo e equipamento pelo valor já depreciado. */
  imobilizado: number;
  saldoCaixa: number;

  fornecedoresAPagar: number;
  /** O principal que ainda falta amortizar. */
  saldoDevedor: number;

  /** Tudo que vence nos próximos 12 meses. Denominador da liquidez. */
  aPagarNoAno?: number | null;
}

export interface ResultadoIndices {
  /** Giro + bens + caixa. */
  ativoOperacional: number;
  capitalDeTerceiros: number;
  /** O dinheiro do dono dentro da empresa. */
  capitalInvestido: number;
  /** Quanto do capital está preso no ciclo, em %. */
  presoNoCicloPct: number | null;

  margemContribuicaoPct: number | null;
  lucratividadePct: number | null;
  /** Lucro menos pró-labore. */
  lucroEconomico: number;
  rentabilidadeMesPct: number | null;
  /** Composta, não multiplicada por 12. */
  rentabilidadeAnoPct: number | null;

  liquidezCorrente: number | null;
  endividamentoPct: number | null;

  alertas: string[];
  erro: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function calcularIndices(e: EntradaIndices): ResultadoIndices {
  const faturamento = num(e.faturamentoMensal);
  const mc = num(e.margemContribuicao);
  const lucro = num(e.lucroMensal);
  const proLabore = num(e.proLabore);

  const estoque = num(e.estoque);
  const aReceber = num(e.clientesAReceber);
  const imobilizado = num(e.imobilizado);
  const caixa = num(e.saldoCaixa);

  const fornecedores = num(e.fornecedoresAPagar);
  const saldoDevedor = num(e.saldoDevedor);

  const vazio = (erro: string): ResultadoIndices => ({
    ativoOperacional: 0,
    capitalDeTerceiros: 0,
    capitalInvestido: 0,
    presoNoCicloPct: null,
    margemContribuicaoPct: null,
    lucratividadePct: null,
    lucroEconomico: 0,
    rentabilidadeMesPct: null,
    rentabilidadeAnoPct: null,
    liquidezCorrente: null,
    endividamentoPct: null,
    alertas: [],
    erro,
  });

  if ([estoque, aReceber, imobilizado, fornecedores, saldoDevedor].some((v) => v < 0)) {
    return vazio('Estoque, recebíveis, bens e dívidas não podem ser negativos.');
  }

  const alertas: string[] = [];

  /* --------------------------------------- O capital investido */
  const ativoOperacional = r2(estoque + aReceber + imobilizado + caixa);
  const capitalDeTerceiros = r2(fornecedores + saldoDevedor);
  const capitalInvestido = r2(ativoOperacional - capitalDeTerceiros);

  const presoNoCicloPct =
    capitalInvestido > 0
      ? r2(((estoque + aReceber - fornecedores) / capitalInvestido) * 100)
      : null;

  /* ------------------------------------------- Os três índices */
  const margemContribuicaoPct = faturamento > 0 ? r2((mc / faturamento) * 100) : null;
  const lucratividadePct = faturamento > 0 ? r2((lucro / faturamento) * 100) : null;

  const lucroEconomico = r2(lucro - proLabore);

  // Capital negativo acontece de verdade: empresa que opera inteira com
  // dinheiro de fornecedor e banco. Dividir por ele daria uma
  // rentabilidade negativa gigante num negócio que pode estar lucrando —
  // um número absurdo que ninguém saberia interpretar.
  const rentabilidadeMesPct =
    capitalInvestido > 0 ? r2((lucroEconomico / capitalInvestido) * 100) : null;

  // Composta, não × 12. Um por cento ao mês não é doze por cento ao ano;
  // é 12,68%. E a comparação com qualquer aplicação exige a mesma base.
  const rentabilidadeAnoPct =
    rentabilidadeMesPct === null
      ? null
      : r2((Math.pow(1 + rentabilidadeMesPct / 100, 12) - 1) * 100);

  /* ------------------------------------------ Índices de apoio */
  const aPagarNoAno =
    e.aPagarNoAno === null || e.aPagarNoAno === undefined ? null : num(e.aPagarNoAno);

  const liquidezCorrente =
    aPagarNoAno !== null && aPagarNoAno > 0
      ? r2((estoque + aReceber + caixa) / aPagarNoAno)
      : null;

  const endividamentoPct =
    ativoOperacional > 0 ? r2((capitalDeTerceiros / ativoOperacional) * 100) : null;

  /* ------------------------------------------------- Leituras */
  if (capitalInvestido <= 0 && ativoOperacional > 0) {
    alertas.push(
      `O capital de terceiros (${brl(capitalDeTerceiros)}) é maior que tudo que a empresa tem dentro dela (${brl(ativoOperacional)}). A operação está inteira financiada por fornecedor e banco — e por isso a rentabilidade não pode ser calculada: não há capital próprio para render.`,
    );
  }

  if (
    margemContribuicaoPct !== null &&
    rentabilidadeAnoPct !== null &&
    margemContribuicaoPct > 25 &&
    rentabilidadeAnoPct < 12
  ) {
    // A leitura que a aula existe para produzir.
    alertas.push(
      `A margem é boa (${margemContribuicaoPct}%) e a rentabilidade não é (${rentabilidadeAnoPct}% ao ano). Não é problema de preço: é capital demais preso para o lucro que a operação gera. ${
        presoNoCicloPct !== null
          ? `Hoje ${presoNoCicloPct}% do seu capital está parado em estoque e a receber.`
          : ''
      }`,
    );
  }

  if (lucro > 0 && lucroEconomico <= 0) {
    alertas.push(
      `A empresa deu ${brl(lucro)} de lucro, mas o pró-labore é ${brl(proLabore)}. Depois de remunerar o seu trabalho, sobra ${brl(lucroEconomico)} — ou seja, o negócio está pagando o seu salário e nada além disso. O capital investido não está rendendo.`,
    );
  }

  if (rentabilidadeAnoPct !== null && rentabilidadeAnoPct > 0) {
    alertas.push(
      `O dinheiro investido nesta empresa rende ${rentabilidadeAnoPct}% ao ano, depois de pagar o seu trabalho. É com esse número — e não com o lucro — que faz sentido comparar qualquer outra aplicação.`,
    );
  }

  if (liquidezCorrente !== null && liquidezCorrente < 1) {
    alertas.push(
      `Para cada R$ 1 a pagar no ano há R$ ${liquidezCorrente} disponível. Abaixo de 1 o caixa não fecha sem crédito novo ou prazo novo.`,
    );
  } else if (liquidezCorrente !== null && liquidezCorrente >= 1) {
    alertas.push(
      `Para cada R$ 1 a pagar no ano há R$ ${liquidezCorrente} disponível — folga, mas com uma ressalva: boa parte disso é estoque, e estoque não paga boleto até virar venda.`,
    );
  }

  if (endividamentoPct !== null && endividamentoPct > 60) {
    alertas.push(
      `${endividamentoPct}% do que está dentro da empresa é de terceiros. Quem decide se essa dívida cabe não é este percentual: é o serviço dela — a parcela mensal contra a geração de caixa.`,
    );
  }

  return {
    ativoOperacional,
    capitalDeTerceiros,
    capitalInvestido,
    presoNoCicloPct,
    margemContribuicaoPct,
    lucratividadePct,
    lucroEconomico,
    rentabilidadeMesPct,
    rentabilidadeAnoPct,
    liquidezCorrente,
    endividamentoPct,
    alertas,
    erro: null,
  };
}
