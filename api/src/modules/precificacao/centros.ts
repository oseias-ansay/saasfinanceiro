/**
 * Centros de resultado: duas ou mais frentes lado a lado.
 *
 * Porta da planilha "Centros de Resultado — Aula 1.8".
 *
 * =====================================================================
 * A REGRA DE DECISÃO DA AULA
 * =====================================================================
 * **Nunca feche uma frente pelo resultado rateado.** Feche — ou corrija
 * — pela CONTRIBUIÇÃO APÓS DIRETOS.
 *
 * A diferença não é sutil. Contribuição após diretos é o que some se a
 * frente fechar amanhã: a margem dela menos os custos que só existem
 * por causa dela. Se for positiva, a frente ajuda a pagar o custo comum,
 * e fechá-la piora a empresa — o aluguel continua vindo, agora dividido
 * por menos gente.
 *
 * O resultado rateado, ao contrário, depende de um critério escolhido. A
 * mesma frente pode aparecer lucrativa por um rateio e deficitária por
 * outro, sem que nada tenha mudado na operação.
 *
 * =====================================================================
 * POR ISSO OS DOIS CRITÉRIOS APARECEM JUNTOS
 * =====================================================================
 * Mostrar um só faria o número parecer verdade. Mostrar os dois, com a
 * diferença entre eles somando exatamente ZERO, deixa claro o que o
 * rateio é: uma escolha de gestão que move resultado de uma frente para
 * a outra, sem criar nem destruir nada.
 *
 * =====================================================================
 * O QUE NÃO TEM CENTRO DE CUSTO É COMUM
 * =====================================================================
 * Diferente da planilha, aqui as frentes são MEDIDAS: cada lançamento
 * com centro de custo pertence àquela frente, e o que não tem centro é
 * custo comum, que entra no rateio.
 *
 * É uma regra simples e tem um efeito pedagógico: quanto mais o cliente
 * classifica, menos sobra no bolo comum e mais honesta fica a leitura.
 * Quando quase tudo é comum, a tela diz isso em vez de fingir precisão.
 */

export interface EntradaFrente {
  id: string;
  nome: string;
  receita: number;
  deducoes: number;
  custosVariaveis: number;
  /** Despesa fixa que só existe por causa desta frente. */
  fixosDiretos: number;
  /** Critério B: percentual do custo comum atribuído a esta frente. */
  rateioPct?: number | null;
}

export interface EntradaCentros {
  frentes: EntradaFrente[];
  /** Despesa fixa que não é de nenhuma frente. */
  custoComum: number;
}

export interface FrenteCalculada {
  id: string;
  nome: string;
  receita: number;
  deducoes: number;
  custosVariaveis: number;
  margemContribuicao: number;
  margemContribuicaoPct: number | null;
  fixosDiretos: number;
  /** A leitura honesta. É por ela que se decide fechar ou corrigir. */
  contribuicaoAposDiretos: number;

  /** Rateio pela participação na receita. */
  rateioReceitaPct: number | null;
  fatiaComumPorReceita: number | null;
  resultadoPorReceita: number | null;

  /** Rateio pelo critério do usuário — área ocupada, por exemplo. */
  rateioInformadoPct: number | null;
  fatiaComumInformada: number | null;
  resultadoPorCriterio: number | null;

  /** Quanto o critério escolhido muda o resultado desta frente. */
  diferencaEntreCriterios: number | null;
}

export interface ResultadoCentros {
  frentes: FrenteCalculada[];

  receitaTotal: number;
  margemTotal: number;
  contribuicaoTotal: number;
  custoComum: number;
  resultadoTotal: number;

  /** Quanto do custo fixo não foi atribuído a nenhuma frente, em %. */
  comumSobreFixoPct: number | null;
  /** Os percentuais informados somam 100? */
  rateioInformadoFecha: boolean | null;

  alertas: string[];
  erro: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function calcularCentros(e: EntradaCentros): ResultadoCentros {
  const custoComum = num(e.custoComum);

  const vazio = (erro: string): ResultadoCentros => ({
    frentes: [],
    receitaTotal: 0,
    margemTotal: 0,
    contribuicaoTotal: 0,
    custoComum: 0,
    resultadoTotal: 0,
    comumSobreFixoPct: null,
    rateioInformadoFecha: null,
    alertas: [],
    erro,
  });

  const entradas = e.frentes ?? [];
  if (entradas.length < 2) {
    return vazio(
      'Esta leitura precisa de pelo menos duas frentes. Cadastre os centros de custo em Cadastros e classifique os lançamentos — o que ficar sem centro entra como custo comum.',
    );
  }

  const receitaTotal = r2(entradas.reduce((s, f) => s + num(f.receita), 0));
  const alertas: string[] = [];

  /* ------------------------------------------ Cada frente, sozinha */
  const parciais = entradas.map((f) => {
    const receita = num(f.receita);
    const deducoes = num(f.deducoes);
    const variaveis = num(f.custosVariaveis);
    const diretos = num(f.fixosDiretos);

    const margemContribuicao = r2(receita - deducoes - variaveis);

    return {
      id: f.id,
      nome: f.nome,
      receita: r2(receita),
      deducoes: r2(deducoes),
      custosVariaveis: r2(variaveis),
      margemContribuicao,
      margemContribuicaoPct: receita > 0 ? r2((margemContribuicao / receita) * 100) : null,
      fixosDiretos: r2(diretos),
      contribuicaoAposDiretos: r2(margemContribuicao - diretos),
      rateioInformadoPct:
        f.rateioPct === null || f.rateioPct === undefined ? null : num(f.rateioPct),
    };
  });

  const somaInformada = parciais.reduce((s, f) => s + (f.rateioInformadoPct ?? 0), 0);
  const temInformado = parciais.some((f) => f.rateioInformadoPct !== null);
  const rateioInformadoFecha = temInformado ? Math.abs(somaInformada - 100) < 0.01 : null;

  /* --------------------------------------------- Os dois critérios */
  const frentes: FrenteCalculada[] = parciais.map((f) => {
    const rateioReceitaPct = receitaTotal > 0 ? r2((f.receita / receitaTotal) * 100) : null;

    const fatiaComumPorReceita =
      rateioReceitaPct === null ? null : r2(custoComum * (rateioReceitaPct / 100));
    const resultadoPorReceita =
      fatiaComumPorReceita === null ? null : r2(f.contribuicaoAposDiretos - fatiaComumPorReceita);

    // O critério informado só vale quando os percentuais fecham 100%.
    // Ratear 80% do comum entre as frentes faria o resultado somado
    // parecer melhor que o da empresa — e ninguém perceberia.
    const usaInformado = rateioInformadoFecha === true && f.rateioInformadoPct !== null;

    const fatiaComumInformada = usaInformado
      ? r2(custoComum * (f.rateioInformadoPct! / 100))
      : null;
    const resultadoPorCriterio =
      fatiaComumInformada === null ? null : r2(f.contribuicaoAposDiretos - fatiaComumInformada);

    return {
      ...f,
      rateioReceitaPct,
      fatiaComumPorReceita,
      resultadoPorReceita,
      fatiaComumInformada,
      resultadoPorCriterio,
      diferencaEntreCriterios:
        resultadoPorCriterio === null || resultadoPorReceita === null
          ? null
          : r2(resultadoPorCriterio - resultadoPorReceita),
    };
  });

  const margemTotal = r2(frentes.reduce((s, f) => s + f.margemContribuicao, 0));
  const contribuicaoTotal = r2(frentes.reduce((s, f) => s + f.contribuicaoAposDiretos, 0));
  const resultadoTotal = r2(contribuicaoTotal - custoComum);

  const fixoTotal = r2(frentes.reduce((s, f) => s + f.fixosDiretos, 0) + custoComum);
  const comumSobreFixoPct = fixoTotal > 0 ? r2((custoComum / fixoTotal) * 100) : null;

  /* ------------------------------------------------- As leituras */

  // A regra de decisão, e o erro que ela evita.
  const deficitarias = frentes.filter((f) => f.contribuicaoAposDiretos < 0);
  const soNoRateio = frentes.filter(
    (f) =>
      f.contribuicaoAposDiretos >= 0 &&
      f.resultadoPorReceita !== null &&
      f.resultadoPorReceita < 0,
  );

  if (deficitarias.length) {
    const nomes = deficitarias.map((f) => f.nome).join(', ');
    alertas.push(
      `${deficitarias.length === 1 ? 'Uma frente tem' : `${deficitarias.length} frentes têm`} contribuição após diretos NEGATIVA: ${nomes}. Essa é a leitura que decide — a frente não paga nem os custos que só existem por causa dela. É candidata a correção ou fechamento.`,
    );
  }

  if (soNoRateio.length) {
    const nomes = soNoRateio.map((f) => f.nome).join(', ');
    alertas.push(
      `${nomes} ${soNoRateio.length === 1 ? 'aparece' : 'aparecem'} no vermelho depois do rateio, mas com contribuição após diretos POSITIVA. Não feche: essa frente ajuda a pagar o custo comum, e sem ela o aluguel continua vindo — agora dividido por menos gente.`,
    );
  }

  if (rateioInformadoFecha === true) {
    const maior = [...frentes].sort(
      (a, b) => Math.abs(b.diferencaEntreCriterios ?? 0) - Math.abs(a.diferencaEntreCriterios ?? 0),
    )[0];

    if (maior?.diferencaEntreCriterios) {
      alertas.push(
        `Trocar o critério de rateio move ${brl(Math.abs(maior.diferencaEntreCriterios))} de resultado ${maior.diferencaEntreCriterios > 0 ? 'para' : 'de'} ${maior.nome}. A soma das diferenças é sempre zero: o rateio não cria nem destrói resultado, só muda de quem ele é.`,
      );
    }
  } else if (rateioInformadoFecha === false) {
    alertas.push(
      `Os percentuais do seu critério somam ${r2(somaInformada)}%, não 100%. Enquanto não fecharem, só o rateio pela receita é calculado — ratear parte do custo comum faria o resultado somado parecer melhor que o da empresa.`,
    );
  }

  // Bolo comum grande demais: a leitura existe, mas vale pouco.
  if (comumSobreFixoPct !== null && comumSobreFixoPct > 70) {
    alertas.push(
      `${comumSobreFixoPct}% do custo fixo está no bolo comum, sem centro de custo. Quanto maior esse bolo, mais o resultado de cada frente depende do critério de rateio em vez da operação — classifique mais lançamentos e a leitura fica mais firme.`,
    );
  }

  // A frente com melhor margem percentual nem sempre é a que mais
  // contribui em reais. Percentual não paga aluguel.
  const porPct = [...frentes]
    .filter((f) => f.margemContribuicaoPct !== null)
    .sort((a, b) => b.margemContribuicaoPct! - a.margemContribuicaoPct!)[0];
  const porReais = [...frentes].sort(
    (a, b) => b.contribuicaoAposDiretos - a.contribuicaoAposDiretos,
  )[0];

  if (porPct && porReais && porPct.id !== porReais.id) {
    alertas.push(
      `${porPct.nome} tem a melhor margem percentual (${porPct.margemContribuicaoPct}%), mas quem mais contribui em reais é ${porReais.nome}, com ${brl(porReais.contribuicaoAposDiretos)}. Percentual não paga aluguel — compare sempre os dois.`,
    );
  }

  return {
    frentes,
    receitaTotal,
    margemTotal,
    contribuicaoTotal,
    custoComum: r2(custoComum),
    resultadoTotal,
    comumSobreFixoPct,
    rateioInformadoFecha,
    alertas,
    erro: null,
  };
}
