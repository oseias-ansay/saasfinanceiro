/**
 * Ponto de equilíbrio de um mix de produtos.
 *
 * =====================================================================
 * POR QUE MÉDIA PONDERADA, E NÃO A MARGEM DE UM PRODUTO
 * =====================================================================
 * A conta que quase todo material de gestão ensina — despesas fixas
 * divididas pela margem de contribuição — só vale para quem vende UM
 * produto. Num negócio com vários, cada um tem margem diferente, e o que
 * paga a estrutura é a média **ponderada pela participação de cada um no
 * faturamento**.
 *
 * A diferença não é de arredondamento. Um negócio que fatura 80% em um
 * item de 20% de margem e 20% em outro de 60%:
 *
 *     média simples      (20 + 60) / 2            = 40%
 *     média ponderada    0,8×20 + 0,2×60          = 28%
 *
 * Com despesa fixa de R$ 20 mil, a primeira diz que basta faturar
 * R$ 50 mil; a segunda, R$ 71,4 mil. Quem usa a primeira fecha o mês
 * achando que lucrou e descobre o contrário no extrato.
 *
 * =====================================================================
 * O PRODUTO QUE DÁ PREJUÍZO EM CADA VENDA
 * =====================================================================
 * Quando a margem de contribuição unitária é negativa, o item não cobre
 * nem os próprios custos variáveis: cada unidade vendida aumenta o
 * prejuízo, e vender mais piora. É o achado mais valioso que esta conta
 * produz, e o mais contraintuitivo para quem está tentando "vender mais
 * para cobrir o fixo". Por isso vira alerta nomeando o produto.
 */

export interface ProdutoEntrada {
  id?: string;
  nome: string;
  /** Preço de venda praticado. */
  preco: number;
  /** Custo direto por unidade. */
  custoDireto: number;

  /**
   * Alíquota de imposto sobre o preço de venda.
   *
   * Separada de `variaveisPct` desde 16/09/2026, e não por capricho: a
   * alíquota muda de produto para produto — ISS de serviço ao lado de
   * ICMS de mercadoria, anexos diferentes do Simples — enquanto comissão
   * e taxa de cartão costumam ser iguais para tudo. Somadas num campo só,
   * o usuário tinha de fazer essa conta de cabeça a cada item.
   *
   * O efeito no cálculo é NENHUM: imposto e demais variáveis são
   * descontados juntos, como sempre foram. O que muda é a leitura.
   */
  impostoPct?: number;

  /** Comissão, frete, embalagem, taxa de cartão. Sem o imposto. */
  variaveisPct: number;

  /** Peso deste produto no faturamento total. */
  participacaoPct: number;
}

export interface ProdutoCalculado {
  id?: string;
  nome: string;
  preco: number;
  custoVariavelUnitario: number;

  /**
   * Preço menos o custo direto, ANTES de imposto e comissão.
   *
   * Não serve para decidir nada sozinha — é sempre otimista. Está aqui
   * porque a distância entre ela e a líquida é o que o Estado e o
   * vendedor levam de cada venda, e ver esse número costuma ser o que faz
   * o dono da empresa perguntar sobre regime tributário.
   */
  margemContribuicaoBruta: number;
  margemContribuicaoBrutaPct: number;

  /** Quanto de imposto cada unidade carrega, em reais. */
  imposto: number;
  /** Comissão, frete, cartão — em reais por unidade. */
  outrosVariaveis: number;

  /** A que manda: depois do custo direto, do imposto e do resto. */
  margemContribuicao: number;
  margemContribuicaoPct: number;
  /** Participação depois de normalizada para somar 100. */
  participacaoPct: number;
  /** Quanto este produto contribui para o índice ponderado. */
  contribuicaoNoIndice: number;
  /** Quanto dele é preciso vender, no ponto de equilíbrio. */
  equilibrioFaturamento: number | null;
  equilibrioUnidades: number | null;
  /** Cada venda aumenta o prejuízo. */
  destruiValor: boolean;
}

export interface EntradaEquilibrio {
  produtos: ProdutoEntrada[];
  /** Total das despesas fixas mensais, em reais. */
  custosFixosMensais: number;
  /** Faturamento real do mês, para a margem de segurança. */
  faturamentoAtual?: number | null;
}

export interface ResultadoEquilibrio {
  viavel: boolean;
  produtos: ProdutoCalculado[];

  /** A média ponderada. É o número que manda em tudo aqui. */
  indiceMargemContribuicao: number | null;
  margemContribuicaoTotal: number | null;

  pontoEquilibrioFaturamento: number | null;

  /** Quanto o faturamento pode cair antes de dar prejuízo. */
  margemSegurancaPct: number | null;
  margemSegurancaValor: number | null;
  resultadoNoFaturamentoAtual: number | null;

  alertas: string[];
  erro: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function calcularEquilibrio(entrada: EntradaEquilibrio): ResultadoEquilibrio {
  const vazio = (erro: string): ResultadoEquilibrio => ({
    viavel: false,
    produtos: [],
    indiceMargemContribuicao: null,
    margemContribuicaoTotal: null,
    pontoEquilibrioFaturamento: null,
    margemSegurancaPct: null,
    margemSegurancaValor: null,
    resultadoNoFaturamentoAtual: null,
    alertas: [],
    erro,
  });

  const lista = (entrada.produtos ?? []).filter((p) => num(p.preco) > 0);
  if (!lista.length) {
    return vazio('Cadastre ao menos um produto com preço de venda.');
  }

  const fixos = num(entrada.custosFixosMensais);
  const alertas: string[] = [];

  // ---- Participações -------------------------------------------------
  //
  // Normalizar em vez de recusar. Quem cadastra cinco produtos raramente
  // acerta 100% na soma, e travar a tela por causa de 2 pontos seria
  // hostil. Mas normalizar em silêncio esconderia um erro de digitação
  // grande, então o desvio vira alerta quando é relevante.
  const somaParticipacao = lista.reduce((s, p) => s + num(p.participacaoPct), 0);

  if (somaParticipacao <= 0) {
    return vazio(
      'Informe a participação de cada produto no faturamento. A soma deve ficar próxima de 100%.',
    );
  }

  if (Math.abs(somaParticipacao - 100) > 1) {
    alertas.push(
      `As participações somam ${r2(somaParticipacao)}%, não 100%. ` +
        'Os pesos foram ajustados proporcionalmente para o cálculo, mas vale conferir.',
    );
  }

  // ---- Cada produto --------------------------------------------------
  const produtos: ProdutoCalculado[] = lista.map((p) => {
    const preco = num(p.preco);
    const custo = num(p.custoDireto);

    const imposto = r2((preco * num(p.impostoPct)) / 100);
    const outros = r2((preco * num(p.variaveisPct)) / 100);

    // O custo variável total continua sendo a soma de tudo que varia com
    // a venda. A separação entre imposto e o resto é de leitura, não de
    // cálculo — o ponto de equilíbrio é idêntico ao de antes.
    const custoVar = custo + imposto + outros;

    const mcBruta = r2(preco - custo);
    const mc = r2(preco - custoVar);
    const mcPct = r2((mc / preco) * 100);
    const peso = r2((num(p.participacaoPct) / somaParticipacao) * 100);

    return {
      id: p.id,
      nome: p.nome,
      preco: r2(preco),
      custoVariavelUnitario: r2(custoVar),
      margemContribuicaoBruta: mcBruta,
      margemContribuicaoBrutaPct: r2((mcBruta / preco) * 100),
      imposto,
      outrosVariaveis: outros,
      margemContribuicao: mc,
      margemContribuicaoPct: mcPct,
      participacaoPct: peso,
      contribuicaoNoIndice: r2((peso / 100) * mcPct),
      equilibrioFaturamento: null,
      equilibrioUnidades: null,
      destruiValor: mc <= 0,
    };
  });

  for (const p of produtos.filter((x) => x.destruiValor)) {
    alertas.push(
      `"${p.nome}" tem margem de contribuição de ${p.margemContribuicao.toFixed(2)} por unidade: ` +
        'o preço não cobre nem os custos que variam com a venda. Cada unidade vendida aumenta o ' +
        'prejuízo — vender mais piora, não melhora.',
    );
  }

  const indice = r2(produtos.reduce((s, p) => s + p.contribuicaoNoIndice, 0));

  if (indice <= 0) {
    return vazio(
      'A margem de contribuição do mix é zero ou negativa: nenhum volume de vendas paga a ' +
        'estrutura. É preciso rever preços ou custos antes de falar em ponto de equilíbrio.',
    );
  }

  // ---- O ponto de equilíbrio ----------------------------------------
  const peFaturamento = fixos > 0 ? r2(fixos / (indice / 100)) : 0;

  if (fixos <= 0) {
    alertas.push(
      'Sem despesas fixas informadas o ponto de equilíbrio não existe. ' +
        'Relacione os custos fixos para a conta fazer sentido.',
    );
  }

  for (const p of produtos) {
    if (peFaturamento <= 0) continue;
    p.equilibrioFaturamento = r2((peFaturamento * p.participacaoPct) / 100);
    // Arredonda para cima: vender a fração não paga a conta inteira.
    p.equilibrioUnidades = p.preco > 0 ? Math.ceil(p.equilibrioFaturamento / p.preco) : null;
  }

  // ---- Margem de segurança ------------------------------------------
  const atual = entrada.faturamentoAtual ? num(entrada.faturamentoAtual) : 0;

  let margemSegurancaPct: number | null = null;
  let margemSegurancaValor: number | null = null;
  let resultado: number | null = null;

  if (atual > 0) {
    resultado = r2((atual * indice) / 100 - fixos);

    if (peFaturamento > 0) {
      margemSegurancaValor = r2(atual - peFaturamento);
      margemSegurancaPct = r2(((atual - peFaturamento) / atual) * 100);

      if (margemSegurancaPct < 0) {
        alertas.push(
          `O faturamento atual está ${r2(Math.abs(margemSegurancaPct))}% abaixo do ponto de ` +
            `equilíbrio. Neste ritmo o mês fecha com prejuízo de ${Math.abs(resultado).toFixed(2)}.`,
        );
      } else if (margemSegurancaPct < 10) {
        alertas.push(
          `Margem de segurança de apenas ${margemSegurancaPct}%. ` +
            'Uma queda pequena nas vendas já leva o mês ao prejuízo.',
        );
      }
    }
  }

  return {
    viavel: true,
    produtos,
    indiceMargemContribuicao: indice,
    margemContribuicaoTotal: atual > 0 ? r2((atual * indice) / 100) : null,
    pontoEquilibrioFaturamento: peFaturamento > 0 ? peFaturamento : null,
    margemSegurancaPct,
    margemSegurancaValor,
    resultadoNoFaturamentoAtual: resultado,
    alertas,
    erro: null,
  };
}
