/**
 * Leitura da planilha de produtos para a Margem de Contribuição.
 *
 * =====================================================================
 * POR QUE A LÓGICA MORA AQUI, E NÃO NO NAVEGADOR
 * =====================================================================
 * O navegador faz só o que precisa do arquivo: abrir o .xlsx e virar
 * linhas. Reconhecer coluna, entender "R$ 1.234,56" e decidir o que
 * fazer com participação em branco é regra de negócio — e regra de
 * negócio sem teste apodrece. Aqui ela é pura e testada.
 *
 * =====================================================================
 * O QUE O ARQUIVO PRECISA TER, E O QUE ELE PODE NÃO TER
 * =====================================================================
 * Obrigatório: nome e preço. Nome porque é a chave da mesclagem, preço
 * porque `mix_produtos` exige `preco > 0` e uma linha sem ele não pode
 * ser gravada de jeito nenhum.
 *
 * Tudo mais pode faltar. O que falta volta marcado em `faltando`, a tela
 * mostra o campo em branco para o usuário completar, e só então grava.
 * Preencher com zero em silêncio seria pior: custo zero vira margem de
 * 100%, e ninguém desconfia de um número bom.
 *
 * =====================================================================
 * PARTICIPAÇÃO: TRÊS CAMINHOS, NESTA ORDEM
 * =====================================================================
 * 1. A planilha traz o percentual pronto — usa.
 * 2. Traz faturamento por produto — calcula a participação de cada um
 *    sobre o total, e o resultado fecha 100% por construção.
 * 3. Traz quantidade e preço — receita é quantidade × preço, e cai no
 *    caso 2.
 *
 * O caminho 2 é o mais confiável e o menos pedido, porque é o que o ERP
 * exporta. Percentual digitado à mão raramente soma 100.
 */

/** Uma linha do arquivo, já convertida pelo navegador. */
export type LinhaBruta = Record<string, unknown>;

export type Campo =
  | 'nome'
  | 'preco'
  | 'custo'
  | 'participacao'
  | 'faturamento'
  | 'quantidade';

/** Campo da ferramenta → nome da coluna no arquivo. */
export type Mapeamento = Partial<Record<Campo, string>>;

export interface ProdutoImportado {
  /** Linha no arquivo, contando o cabeçalho. Serve para o usuário achar. */
  linha: number;
  nome: string;
  preco: number | null;
  custoDireto: number | null;
  participacaoPct: number | null;
  /** De onde saiu a participação — a tela declara isso. */
  participacaoOrigem: 'planilha' | 'faturamento' | 'quantidade' | null;
  /** O que veio em branco e precisa ser preenchido à mão. */
  faltando: Campo[];
}

export interface ResultadoLeitura {
  produtos: ProdutoImportado[];
  /** O que foi entendido de cada coluna. A tela deixa corrigir. */
  mapeamento: Mapeamento;
  /** Cabeçalhos que o arquivo tem e não foram usados. */
  colunasDisponiveis: string[];
  alertas: string[];
  /** Impede a leitura inteira. Diferente de linha incompleta. */
  erro: string | null;
}

/* ==================================================================== */
/* Texto e número                                                        */
/* ==================================================================== */

/** Sem acento, sem pontuação, minúsculo. Para comparar cabeçalhos. */
function chave(t: unknown): string {
  return String(t ?? '')
    .normalize('NFD')
    .replace(/[^A-Za-z0-9 %]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Número no formato que o brasileiro digita e que o Excel exporta.
 *
 * Aceita 1234.56 (número puro), "1.234,56", "R$ 1.234,56", "12,5%",
 * "  " e null. Devolve null para o que não é número — e null aqui
 * significa "em branco", não zero.
 *
 * A regra do separador: se há vírgula, ela é o decimal e o ponto é
 * milhar. Sem vírgula, o ponto é decimal — é assim que vem de um CSV
 * gerado em inglês, e tratá-lo como milhar transformaria 10.50 em 1050.
 */
export function numeroBR(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;

  const bruto = String(v).trim();
  if (bruto === '') return null;

  let s = bruto.replace(/[R$\s %]/gi, '');
  if (s === '' || s === '-') return null;

  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/* ==================================================================== */
/* Reconhecimento das colunas                                            */
/* ==================================================================== */

/**
 * Sinônimos, do mais específico para o mais genérico.
 *
 * A ordem dentro de cada lista importa pouco; a ordem ENTRE os campos
 * importa muito. "total" sozinho vira faturamento, mas "custo total"
 * tem de cair em custo — por isso custo é testado antes.
 */
const SINONIMOS: [Campo, string[]][] = [
  ['nome', ['produto', 'descricao', 'nome', 'item', 'mercadoria', 'servico']],
  [
    'custo',
    [
      'custo direto', 'preco de custo', 'valor de custo', 'custo unitario',
      'custo medio', 'custo total', 'cmv', 'custo',
    ],
  ],
  [
    'preco',
    [
      'preco de venda', 'valor de venda', 'preco unitario', 'preco unit',
      'valor unitario', 'preco venda', 'pvenda', 'preco', 'venda',
    ],
  ],
  [
    'participacao',
    [
      'participacao', 'participacao no faturamento', 'percentual', 'perc',
      'mix', 'peso', '% do faturamento', '%',
    ],
  ],
  [
    'faturamento',
    ['faturamento', 'receita', 'total vendido', 'valor vendido', 'valor total', 'total'],
  ],
  ['quantidade', ['quantidade', 'qtde', 'qtd', 'unidades', 'volume', 'pecas']],
];

/** Lê os cabeçalhos e chuta o que é cada coluna. A tela deixa corrigir. */
export function detectarColunas(cabecalhos: string[]): Mapeamento {
  const m: Mapeamento = {};
  const usados = new Set<string>();

  for (const [campo, termos] of SINONIMOS) {
    // Igualdade exata primeiro; só depois "contém". Sem isso, uma coluna
    // "preco de custo" seria capturada por "custo" e por "preco", e qual
    // vence dependeria da ordem do arquivo.
    let achado =
      cabecalhos.find((c) => !usados.has(c) && termos.includes(chave(c))) ??
      cabecalhos.find((c) => !usados.has(c) && termos.some((t) => chave(c).includes(t)));

    if (achado) {
      m[campo] = achado;
      usados.add(achado);
    }
  }

  return m;
}

/* ==================================================================== */
/* Leitura                                                               */
/* ==================================================================== */

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Percentual que veio como fração.
 *
 * O Excel guarda 35% como 0,35. Se a coluna inteira somar perto de 1, é
 * fração — e multiplicar por 100 acerta. Se somar perto de 100, já está
 * em pontos percentuais. Entre os dois, não dá para saber, e o arquivo
 * segue como veio com um aviso na tela.
 */
function ehFracao(valores: number[]): boolean {
  if (!valores.length) return false;
  const soma = valores.reduce((s, v) => s + v, 0);
  return soma > 0.9 && soma < 1.1 && valores.every((v) => v <= 1);
}

export function lerPlanilha(
  linhas: LinhaBruta[],
  mapeamentoInformado?: Mapeamento,
): ResultadoLeitura {
  const alertas: string[] = [];

  if (!linhas.length) {
    return {
      produtos: [],
      mapeamento: {},
      colunasDisponiveis: [],
      alertas: [],
      erro: 'A planilha não tem nenhuma linha de dados.',
    };
  }

  const colunasDisponiveis = Object.keys(linhas[0] ?? {});
  const mapeamento = mapeamentoInformado ?? detectarColunas(colunasDisponiveis);

  if (!mapeamento.nome) {
    return {
      produtos: [],
      mapeamento,
      colunasDisponiveis,
      alertas: [],
      erro:
        'Não encontrei a coluna com o nome do produto. Escolha qual coluna usar — ' +
        'sem o nome não há como comparar com o que já está cadastrado.',
    };
  }

  const pegar = (l: LinhaBruta, campo: Campo): unknown =>
    mapeamento[campo] === undefined ? undefined : l[mapeamento[campo]!];

  // ---- Passo 1: uma linha de trabalho por linha do arquivo -----------
  interface Trabalho {
    linha: number;
    nome: string;
    preco: number | null;
    custo: number | null;
    participacao: number | null;
    faturamento: number | null;
    quantidade: number | null;
  }

  let semNome = 0;
  const trabalho: Trabalho[] = [];

  linhas.forEach((l, i) => {
    const nome = String(pegar(l, 'nome') ?? '').trim();
    if (!nome) {
      semNome += 1;
      return;
    }
    trabalho.push({
      linha: i + 2, // +1 pelo cabeçalho, +1 porque planilha conta do 1
      nome: nome.slice(0, 120),
      preco: numeroBR(pegar(l, 'preco')),
      custo: numeroBR(pegar(l, 'custo')),
      participacao: numeroBR(pegar(l, 'participacao')),
      faturamento: numeroBR(pegar(l, 'faturamento')),
      quantidade: numeroBR(pegar(l, 'quantidade')),
    });
  });

  if (semNome > 0) {
    alertas.push(
      semNome === 1
        ? 'Uma linha foi ignorada por estar sem nome de produto.'
        : `${semNome} linhas foram ignoradas por estarem sem nome de produto.`,
    );
  }

  if (!trabalho.length) {
    return {
      produtos: [],
      mapeamento,
      colunasDisponiveis,
      alertas,
      erro: 'Nenhuma linha da planilha tem nome de produto.',
    };
  }

  // ---- Passo 2: nome repetido dentro do arquivo ----------------------
  //
  // `mix_produtos` tem unique (tenant_id, nome): duas linhas com o mesmo
  // nome fariam a gravação falhar inteira. Fica a última, que é a
  // convenção de quem corrige uma linha copiando-a mais abaixo.
  const porNome = new Map<string, Trabalho>();
  let repetidos = 0;
  for (const t of trabalho) {
    if (porNome.has(chave(t.nome))) repetidos += 1;
    porNome.set(chave(t.nome), t);
  }
  if (repetidos > 0) {
    alertas.push(
      `${repetidos} ${repetidos === 1 ? 'linha repetia' : 'linhas repetiam'} um nome de ` +
        'produto. Ficou a última de cada.',
    );
  }
  const itens = [...porNome.values()];

  // ---- Passo 3: participação -----------------------------------------
  const informadas = itens.map((t) => t.participacao).filter((v): v is number => v !== null);
  const temColunaPart = mapeamento.participacao !== undefined && informadas.length > 0;
  const fracao = temColunaPart && ehFracao(informadas);

  // Faturamento direto, ou reconstruído de quantidade × preço.
  const receita = (t: Trabalho): number | null => {
    if (t.faturamento !== null) return t.faturamento;
    if (t.quantidade !== null && t.preco !== null) return t.quantidade * t.preco;
    return null;
  };
  const receitas = itens.map(receita);
  const totalReceita = receitas.reduce<number>((s, v) => s + (v ?? 0), 0);
  const podeDerivar = totalReceita > 0;
  const origemDerivada: 'faturamento' | 'quantidade' =
    mapeamento.faturamento !== undefined ? 'faturamento' : 'quantidade';

  const produtos: ProdutoImportado[] = itens.map((t, i) => {
    const faltando: Campo[] = [];

    if (t.preco === null || t.preco <= 0) faltando.push('preco');
    if (t.custo === null) faltando.push('custo');

    let participacaoPct: number | null = null;
    let participacaoOrigem: ProdutoImportado['participacaoOrigem'] = null;

    if (temColunaPart && t.participacao !== null) {
      participacaoPct = r2(fracao ? t.participacao * 100 : t.participacao);
      participacaoOrigem = 'planilha';
    } else if (podeDerivar && receitas[i] !== null) {
      participacaoPct = r2((receitas[i]! / totalReceita) * 100);
      participacaoOrigem = origemDerivada;
    } else {
      faltando.push('participacao');
    }

    return {
      linha: t.linha,
      nome: t.nome,
      preco: t.preco !== null && t.preco > 0 ? r2(t.preco) : null,
      custoDireto: t.custo === null ? null : r2(t.custo),
      participacaoPct,
      participacaoOrigem,
      faltando,
    };
  });

  // ---- Passo 4: avisos de conjunto -----------------------------------
  if (fracao) {
    alertas.push(
      'A participação veio em fração (0,35 para 35%), como o Excel costuma guardar. ' +
        'Converti para percentual.',
    );
  }

  const somaPart = produtos.reduce((s, p) => s + (p.participacaoPct ?? 0), 0);
  if (participacaoVeioDaPlanilha(produtos) && Math.abs(somaPart - 100) > 1) {
    alertas.push(
      `As participações da planilha somam ${r2(somaPart)}%, e não 100%. O cálculo continua ` +
        'válido, mas a margem média fica proporcional ao que foi informado — ajuste antes de gravar.',
    );
  }

  const semPreco = produtos.filter((p) => p.faltando.includes('preco')).length;
  if (semPreco > 0) {
    alertas.push(
      `${semPreco} ${semPreco === 1 ? 'produto está' : 'produtos estão'} sem preço de venda. ` +
        'Preço é obrigatório — preencha antes de gravar.',
    );
  }

  return { produtos, mapeamento, colunasDisponiveis, alertas, erro: null };
}

function participacaoVeioDaPlanilha(produtos: ProdutoImportado[]): boolean {
  return produtos.some((p) => p.participacaoOrigem === 'planilha');
}
