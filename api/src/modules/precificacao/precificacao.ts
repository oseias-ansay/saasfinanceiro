/**
 * Preço mínimo de venda e margem de contribuição.
 *
 * =====================================================================
 * A FÓRMULA, E POR QUE ELA É UMA DIVISÃO
 * =====================================================================
 * O erro mais comum em precificação de MPE é somar percentuais sobre o
 * custo:
 *
 *     ERRADO:  preço = custo × (1 + impostos + comissão + margem)
 *
 * Isso dá um número menor que o necessário, porque impostos e comissão
 * incidem sobre o PREÇO, não sobre o custo. Quem calcula assim vende
 * achando que tem 15% de margem e descobre no fim do mês que tinha 8.
 *
 *     CERTO:   preço = custo ÷ (1 − (impostos + comissão + ... + margem))
 *
 * É o markup divisor. O denominador é a fatia do preço que sobra para
 * pagar o custo direto; tudo o mais é percentual do próprio preço.
 *
 * =====================================================================
 * O DENOMINADOR NÃO PODE CHEGAR A ZERO
 * =====================================================================
 * Se a soma dos percentuais atinge 100%, não existe preço que feche a
 * conta — a divisão tende ao infinito. Perto de 100% ela explode: com
 * 95%, um ponto percentual a mais no imposto dobra o preço.
 *
 * Isso não é caso de borda, é o sintoma de um negócio inviável naquela
 * configuração, e o cálculo tem de dizer isso em vez de devolver um
 * número absurdo com cara de resposta.
 *
 * =====================================================================
 * MARGEM DE CONTRIBUIÇÃO NÃO INCLUI DESPESA FIXA
 * =====================================================================
 * A margem de contribuição é o que sobra da venda para PAGAR as despesas
 * fixas. Então ela desconta só o que varia com a venda: custo direto,
 * impostos, comissão. Descontar a despesa fixa rateada aqui seria contar
 * duas vezes, e é confusão frequente até em planilha de consultoria.
 */

export interface EntradaPreco {
  /** Quanto custa produzir ou comprar uma unidade. Em reais. */
  custoDireto: number;

  /** Percentuais sobre o PREÇO de venda. */
  impostosPct: number;
  comissaoPct: number;
  /** Frete, embalagem, taxa de cartão — o que varia com a venda. */
  outrasVariaveisPct: number;
  /** Despesa fixa rateada. Ver `faturamentoReferencia` na saída. */
  despesasFixasPct: number;
  /** O lucro desejado, também como percentual do preço. */
  margemPct: number;

  /**
   * Despesa fixa mensal em reais. Opcional, e só serve ao ponto de
   * equilíbrio — sem ela não há como dizer quantas unidades pagam a
   * estrutura.
   */
  despesasFixasMensais?: number | null;

  /** O preço que o cliente pratica hoje, para comparação. */
  precoPraticado?: number | null;
}

export interface Composicao {
  rotulo: string;
  percentual: number;
  valor: number;
}

export interface ResultadoPreco {
  viavel: boolean;
  precoSugerido: number | null;

  /** Para onde vai cada real do preço sugerido. */
  composicao: Composicao[];

  margemContribuicao: number | null;
  margemContribuicaoPct: number | null;

  pontoEquilibrioUnidades: number | null;
  pontoEquilibrioFaturamento: number | null;

  /**
   * O faturamento mensal que o percentual de despesa fixa pressupõe.
   *
   * Ratear despesa fixa como percentual embute uma premissa de volume
   * que quase ninguém enuncia: 18% de despesa fixa só é verdade se o
   * faturamento for X. Vendendo menos, o rateio estava subestimado e o
   * preço saiu barato demais.
   *
   * Devolver esse número transforma a premissa escondida em algo que o
   * usuário pode conferir contra a própria realidade.
   */
  faturamentoReferencia: number | null;

  /** Comparação com o preço praticado, quando informado. */
  comparacao: {
    precoPraticado: number;
    diferenca: number;
    diferencaPct: number;
    acimaDoMinimo: boolean;
    margemRealPct: number;
  } | null;

  alertas: string[];
  erro: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Trata nulo, texto e NaN como zero. Campo em branco é zero, não erro. */
const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const vazio = (erro: string): ResultadoPreco => ({
  viavel: false,
  precoSugerido: null,
  composicao: [],
  margemContribuicao: null,
  margemContribuicaoPct: null,
  pontoEquilibrioUnidades: null,
  pontoEquilibrioFaturamento: null,
  faturamentoReferencia: null,
  comparacao: null,
  alertas: [],
  erro,
});

export function calcularPreco(entrada: EntradaPreco): ResultadoPreco {
  const custo = num(entrada.custoDireto);

  const impostos = num(entrada.impostosPct);
  const comissao = num(entrada.comissaoPct);
  const outras = num(entrada.outrasVariaveisPct);
  const fixas = num(entrada.despesasFixasPct);
  const margem = num(entrada.margemPct);

  if (custo <= 0) {
    return vazio('Informe o custo direto de uma unidade.');
  }

  const percentuais = [impostos, comissao, outras, fixas, margem];
  if (percentuais.some((p) => p < 0)) {
    return vazio('Percentuais não podem ser negativos.');
  }

  const soma = impostos + comissao + outras + fixas + margem;

  if (soma >= 100) {
    return vazio(
      `Os percentuais somam ${r2(soma)}% do preço. Como não sobra nada para o custo, ` +
        'não existe preço que feche esta conta. Reduza a margem desejada ou o rateio de ' +
        'despesa fixa — ou reveja se o custo direto cabe neste modelo de negócio.',
    );
  }

  const divisor = 1 - soma / 100;
  const preco = r2(custo / divisor);

  const alertas: string[] = [];

  // Acima de 90% cada ponto percentual move o preço de forma
  // desproporcional. Vale avisar antes de o usuário apostar no número.
  if (soma >= 90) {
    alertas.push(
      `Os percentuais somam ${r2(soma)}%. Nessa faixa o preço fica muito sensível: ` +
        'um ponto percentual a mais em imposto ou comissão muda o preço de forma ' +
        'desproporcional.',
    );
  }

  if (margem === 0) {
    alertas.push(
      'Margem desejada em zero: este é o preço de empatar, não de lucrar. ' +
        'Qualquer imprevisto vira prejuízo.',
    );
  }

  const valorDe = (pct: number) => r2((preco * pct) / 100);

  const composicao: Composicao[] = [
    { rotulo: 'Custo direto', percentual: r2((custo / preco) * 100), valor: r2(custo) },
    { rotulo: 'Impostos', percentual: r2(impostos), valor: valorDe(impostos) },
    { rotulo: 'Comissão', percentual: r2(comissao), valor: valorDe(comissao) },
    { rotulo: 'Outras despesas variáveis', percentual: r2(outras), valor: valorDe(outras) },
    { rotulo: 'Despesas fixas (rateio)', percentual: r2(fixas), valor: valorDe(fixas) },
    { rotulo: 'Margem desejada', percentual: r2(margem), valor: valorDe(margem) },
  ].filter((c) => c.valor > 0);

  // MC = preço − tudo que varia com a venda. Despesa fixa NÃO entra:
  // é justamente o que a margem de contribuição existe para pagar.
  const variaveis = custo + valorDe(impostos) + valorDe(comissao) + valorDe(outras);
  const mc = r2(preco - variaveis);
  const mcPct = r2((mc / preco) * 100);

  const fixasMensais = entrada.despesasFixasMensais ? num(entrada.despesasFixasMensais) : 0;

  const pontoEquilibrioUnidades = fixasMensais > 0 && mc > 0 ? Math.ceil(fixasMensais / mc) : null;
  const pontoEquilibrioFaturamento =
    fixasMensais > 0 && mcPct > 0 ? r2(fixasMensais / (mcPct / 100)) : null;

  // O volume que o rateio pressupõe. Ver o comentário no tipo.
  const faturamentoReferencia = fixasMensais > 0 && fixas > 0 ? r2(fixasMensais / (fixas / 100)) : null;

  let comparacao: ResultadoPreco['comparacao'] = null;
  const praticado = entrada.precoPraticado ? num(entrada.precoPraticado) : 0;

  if (praticado > 0) {
    // A margem REAL no preço praticado: o que sobra depois do custo e dos
    // percentuais variáveis, menos o rateio da fixa. É este número que
    // diz se a venda de hoje dá lucro.
    const variaveisPraticado =
      custo + (praticado * (impostos + comissao + outras)) / 100;
    const sobra = praticado - variaveisPraticado - (praticado * fixas) / 100;

    comparacao = {
      precoPraticado: r2(praticado),
      diferenca: r2(praticado - preco),
      diferencaPct: r2(((praticado - preco) / preco) * 100),
      acimaDoMinimo: praticado >= preco,
      margemRealPct: r2((sobra / praticado) * 100),
    };

    if (!comparacao.acimaDoMinimo) {
      alertas.push(
        `O preço praticado está ${r2(Math.abs(comparacao.diferencaPct))}% abaixo do mínimo. ` +
          `Cada unidade vendida a ${praticado.toFixed(2)} deixa de cobrir ` +
          `${Math.abs(comparacao.diferenca).toFixed(2)} da estrutura.`,
      );
    }
  }

  return {
    viavel: true,
    precoSugerido: preco,
    composicao,
    margemContribuicao: mc,
    margemContribuicaoPct: mcPct,
    pontoEquilibrioUnidades,
    pontoEquilibrioFaturamento,
    faturamentoReferencia,
    comparacao,
    alertas,
    erro: null,
  };
}
