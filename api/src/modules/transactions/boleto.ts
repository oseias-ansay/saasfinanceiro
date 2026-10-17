/**
 * Decodificação da linha digitável do boleto.
 *
 * =====================================================================
 * POR QUE NÃO PERGUNTAR O VALOR A UM MODELO
 * =====================================================================
 * A linha digitável carrega o valor e o vencimento codificados, com
 * dígitos verificadores. Isso muda tudo: se a leitura da imagem errar um
 * dígito, a conferência acusa e nós sabemos que erramos.
 *
 * Um modelo olhando a foto e respondendo "R$ 1.247,80" pode estar
 * confiantemente errado, e nada denuncia. O cliente agenda o pagamento
 * com o valor trocado.
 *
 * Então o papel da leitura de imagem é UM só: extrair a sequência de
 * dígitos. Tudo o que vem depois é aritmética verificável, e mora aqui.
 *
 * =====================================================================
 * DOIS FORMATOS, E ELES SE COMPORTAM DIFERENTE
 * =====================================================================
 * **Cobrança bancária** — 47 dígitos. Tem fator de vencimento e valor no
 * código de barras. Dá para saber quanto é e quando vence sem ler nada
 * escrito.
 *
 * **Arrecadação** (água, luz, tributo, consórcio) — 48 dígitos,
 * começando com 8. Tem o valor, mas **não tem data de vencimento** no
 * código. A data está impressa no papel e não é verificável.
 *
 * Essa diferença não é detalhe: no boleto de concessionária, o
 * vencimento sai em branco e a pessoa preenche. É a mesma regra do resto
 * do projeto — dado que não dá para verificar não é inventado.
 *
 * =====================================================================
 * O FATOR DE VENCIMENTO VIROU EM 2025
 * =====================================================================
 * O fator conta dias desde 07/10/1997 e tem quatro dígitos, então
 * estourou em 21/02/2025, quando chegou a 9999. A partir de 22/02/2025
 * ele recomeça em 1000.
 *
 * Código escrito antes disso calcula datas com quase 28 anos de erro em
 * boleto novo. É a armadilha mais fácil de cair aqui, e a que menos dá
 * sintoma: a data sai plausível, só que do século passado.
 */

/**
 * As duas bases do fator de vencimento, e elas NÃO se contam igual.
 *
 * Base antiga: 07/10/1997 é o fator ZERO. A data é a base mais o fator
 * inteiro — e a prova é que 07/10/1997 + 9999 dias dá 21/02/2025, que é
 * exatamente o dia em que o campo estourou. Qualquer outro deslocamento
 * erraria esse encontro.
 *
 * Base nova: 22/02/2025 é o fator MIL, porque a contagem reiniciou em
 * 1000, não em 0. Equivale a dizer que o fator zero da base nova seria
 * 29/05/2022 — é a forma como a Febraban documentou, e dá o mesmo
 * número.
 *
 * Eu já errei isto: usei `- 1000` nas duas, o que empurrava todo boleto
 * do ciclo antigo para 2,7 anos antes do que é. O erro era invisível,
 * porque a data errada caía fora da janela de sanidade e a função
 * devolvia nulo — o sintoma era "não consigo ler este boleto", nunca uma
 * data errada na tela. Conferido em 15/10/2026 contra exemplos
 * publicados; há teste com eles.
 */
const BASE_ANTIGA = Date.UTC(1997, 9, 7); // fator 0
const BASE_NOVA = Date.UTC(2025, 1, 22); // fator 1000

export type TipoBoleto = 'cobranca' | 'arrecadacao';

export interface BoletoLido {
  tipo: TipoBoleto;
  /** A linha digitável só com dígitos. */
  linha: string;
  /** O código de barras de 44 dígitos, derivado da linha. */
  codigo_barras: string;
  /** Valor em reais. Nulo quando o boleto não traz valor (campo zerado). */
  valor: number | null;
  /** ISO. Nulo em arrecadação, que não codifica vencimento. */
  vencimento: string | null;
  /** Código do banco emissor, nos boletos de cobrança. */
  banco: string | null;
  /** O que não deu para determinar, em português, para a tela mostrar. */
  avisos: string[];
}

export class BoletoInvalido extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BoletoInvalido';
  }
}

/** Tira tudo que não é dígito: espaço, ponto e a barra que o banco imprime. */
export function apenasDigitos(bruto: string): string {
  return String(bruto ?? '').replace(/\D/g, '');
}

/* ==================================================================== */
/* Dígitos verificadores                                                 */
/* ==================================================================== */

/**
 * Módulo 10, usado nos três primeiros campos da linha digitável.
 *
 * Da direita para a esquerda, multiplica alternadamente por 2 e 1
 * começando com 2. Produto maior que 9 vira a soma dos seus dígitos.
 */
export function modulo10(bloco: string): number {
  let soma = 0;
  let peso = 2;

  for (let i = bloco.length - 1; i >= 0; i--) {
    let p = Number(bloco[i]) * peso;
    if (p > 9) p = Math.floor(p / 10) + (p % 10);
    soma += p;
    peso = peso === 2 ? 1 : 2;
  }

  return (10 - (soma % 10)) % 10;
}

/**
 * Módulo 11 do código de barras, com a regra da FEBRABAN.
 *
 * Pesos de 2 a 9 ciclando da direita para a esquerda. Resultado 0, 10 ou
 * 11 vira 1 — essa exceção é da especificação, não arredondamento.
 */
export function modulo11Barras(codigo43: string): number {
  let soma = 0;
  let peso = 2;

  for (let i = codigo43.length - 1; i >= 0; i--) {
    soma += Number(codigo43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }

  const resto = soma % 11;
  const dv = 11 - resto;
  return dv === 0 || dv > 9 ? 1 : dv;
}

/** Módulo 11 da arrecadação, que tem exceção diferente da cobrança. */
export function modulo11Arrecadacao(bloco: string): number {
  let soma = 0;
  let peso = 2;

  for (let i = bloco.length - 1; i >= 0; i--) {
    soma += Number(bloco[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }

  const resto = soma % 11;
  if (resto === 0) return 0;
  if (resto === 1) return 1;
  return 11 - resto;
}

/* ==================================================================== */
/* Fator de vencimento                                                   */
/* ==================================================================== */

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Converte o fator de quatro dígitos em data.
 *
 * O fator estourou em 21/02/2025 e recomeçou. Um fator de 1000 a 9999
 * tem DUAS leituras possíveis: a do ciclo antigo e a do novo.
 *
 * A escolha é pela proximidade com hoje — boleto a pagar vence perto do
 * presente, e a leitura de 1998 para um boleto emitido agora é absurda.
 * Fora de uma janela razoável, devolve nulo em vez de chutar: data errada
 * num boleto vira pagamento agendado para o dia errado.
 */
export function dataDoFator(fator: number, hoje: Date): string | null {
  if (!Number.isInteger(fator) || fator < 1000 || fator > 9999) return null;

  const candidatos = [
    BASE_NOVA + (fator - 1000) * 86_400_000,
    BASE_ANTIGA + fator * 86_400_000,
  ];

  const agora = Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate());

  // Cinco anos para trás e cinco para frente. Boleto vencido há anos
  // existe — inadimplência antiga —, mas década nenhuma.
  const janela = 5 * 365 * 86_400_000;

  const validos = candidatos.filter((c) => Math.abs(c - agora) <= janela);
  if (validos.length === 0) return null;

  validos.sort((a, b) => Math.abs(a - agora) - Math.abs(b - agora));
  return iso(validos[0]!);
}

/* ==================================================================== */
/* Cobrança bancária — 47 dígitos                                        */
/* ==================================================================== */

/**
 * Monta o código de barras a partir da linha digitável.
 *
 * A linha embaralha o código de barras de propósito, para que os dígitos
 * verificadores de cada campo protejam blocos menores. Desembaralhar é
 * mecânico, e o resultado é conferível pelo DV geral.
 */
export function linhaParaBarras(linha47: string): string {
  const campo1 = linha47.slice(0, 9); // banco(3) moeda(1) + livre(5)
  const campo2 = linha47.slice(10, 20);
  const campo3 = linha47.slice(21, 31);
  const dvGeral = linha47.slice(32, 33);
  const campo5 = linha47.slice(33, 47); // fator(4) + valor(10)

  return campo1.slice(0, 4) + dvGeral + campo5 + campo1.slice(4) + campo2 + campo3;
}

function lerCobranca(linha: string, hoje: Date): BoletoLido {
  const avisos: string[] = [];

  // Os três campos têm DV próprio. Conferir os três — e não só o DV geral
  // — é o que permite dizer QUAL parte da leitura saiu errada.
  const campos: Array<[string, string, string]> = [
    [linha.slice(0, 9), linha.slice(9, 10), 'primeiro'],
    [linha.slice(10, 20), linha.slice(20, 21), 'segundo'],
    [linha.slice(21, 31), linha.slice(31, 32), 'terceiro'],
  ];

  for (const [bloco, dv, nome] of campos) {
    if (modulo10(bloco) !== Number(dv)) {
      throw new BoletoInvalido(
        `A linha digitável não confere no ${nome} bloco. Confira os números — ` +
          'provavelmente um dígito saiu errado na leitura.',
      );
    }
  }

  const barras = linhaParaBarras(linha);
  const dvGeral = Number(barras[4]);
  const semDv = barras.slice(0, 4) + barras.slice(5);

  if (modulo11Barras(semDv) !== dvGeral) {
    throw new BoletoInvalido(
      'A linha digitável não confere na verificação geral. Confira os números.',
    );
  }

  const fator = Number(barras.slice(5, 9));
  const centavos = Number(barras.slice(9, 19));

  const vencimento = dataDoFator(fator, hoje);
  if (fator === 0) {
    avisos.push('Este boleto não traz data de vencimento no código. Informe a data.');
  } else if (!vencimento) {
    avisos.push(
      'Não consegui determinar o vencimento a partir do código. Confira a data impressa no boleto.',
    );
  }

  const valor = centavos > 0 ? centavos / 100 : null;
  if (valor === null) {
    avisos.push('Este boleto está com valor em aberto no código. Informe o valor a pagar.');
  }

  return {
    tipo: 'cobranca',
    linha,
    codigo_barras: barras,
    valor,
    vencimento,
    banco: barras.slice(0, 3),
    avisos,
  };
}

/* ==================================================================== */
/* Arrecadação — 48 dígitos                                              */
/* ==================================================================== */

function lerArrecadacao(linha: string): BoletoLido {
  const avisos: string[] = [];

  // O terceiro dígito diz se o valor é efetivo e qual módulo usa o DV.
  // 6 e 7 usam módulo 10; 8 e 9 usam módulo 11.
  const identificador = Number(linha[2]);
  const usaModulo10 = identificador === 6 || identificador === 7;

  for (let i = 0; i < 4; i++) {
    const bloco = linha.slice(i * 12, i * 12 + 11);
    const dv = Number(linha[i * 12 + 11]);
    const calculado = usaModulo10 ? modulo10(bloco) : modulo11Arrecadacao(bloco);

    if (calculado !== dv) {
      throw new BoletoInvalido(
        `A linha digitável não confere no ${i + 1}º bloco. Confira os números — ` +
          'provavelmente um dígito saiu errado na leitura.',
      );
    }
  }

  // Tira os quatro DVs para remontar o código de barras de 44 dígitos.
  const barras =
    linha.slice(0, 11) + linha.slice(12, 23) + linha.slice(24, 35) + linha.slice(36, 47);

  const centavos = Number(barras.slice(4, 15));
  const valor = centavos > 0 ? centavos / 100 : null;

  if (valor === null) {
    avisos.push('Este boleto está com valor em aberto no código. Informe o valor a pagar.');
  }

  // A regra que mais importa neste ramo: arrecadação não codifica
  // vencimento. A data está impressa no papel e não é verificável, então
  // sai em branco em vez de ser adivinhada.
  avisos.push(
    'Boleto de concessionária ou tributo não traz o vencimento no código de barras. ' +
      'Informe a data que está impressa no boleto.',
  );

  return {
    tipo: 'arrecadacao',
    linha,
    codigo_barras: barras,
    valor,
    vencimento: null,
    banco: null,
    avisos,
  };
}

/* ==================================================================== */
/* A porta de entrada                                                    */
/* ==================================================================== */

/**
 * Lê a linha digitável e devolve o que dá para afirmar.
 *
 * Lança quando a sequência não confere: é melhor dizer "não consegui ler"
 * que oferecer um valor que saiu de dígitos errados.
 */
export function lerBoleto(bruto: string, hoje: Date = new Date()): BoletoLido {
  const linha = apenasDigitos(bruto);

  if (linha.length === 0) {
    throw new BoletoInvalido('Nenhum número foi informado.');
  }

  if (linha.length === 48 && linha[0] === '8') return lerArrecadacao(linha);
  if (linha.length === 47) return lerCobranca(linha, hoje);

  if (linha.length === 44) {
    throw new BoletoInvalido(
      'Esses 44 dígitos parecem ser o código de barras, não a linha digitável. ' +
        'Use a sequência impressa no alto do boleto, com 47 ou 48 números.',
    );
  }

  throw new BoletoInvalido(
    `A linha digitável tem ${linha.length} números. O esperado são 47 para boleto ` +
      'bancário ou 48 para conta de consumo e tributo. Confira se algum dígito ficou faltando.',
  );
}
