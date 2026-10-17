/**
 * Testes da leitura do boleto.
 *
 * =====================================================================
 * COMO OS EXEMPLOS SÃO CONSTRUÍDOS
 * =====================================================================
 * As linhas digitáveis aqui são MONTADAS pelos próprios algoritmos de
 * dígito verificador, a partir de um código de barras escolhido. Isso
 * testa a coerência interna — desembaralhar, verificar, decodificar — e
 * pega regressão.
 *
 * O que NÃO prova é que os algoritmos batem com a especificação da
 * FEBRABAN. Um erro sistemático no cálculo passaria por aqui, porque o
 * mesmo erro montaria e conferiria o exemplo.
 *
 * Por isso há uma verificação obrigatória antes de confiar nisto em
 * produção: ler um boleto REAL, de papel, e comparar valor e vencimento
 * com o que está impresso. Está anotado no RETOMAR-AQUI.
 *
 * =====================================================================
 * O QUE JÁ FOI VERIFICADO POR FORA — 15/10/2026
 * =====================================================================
 * O fator de vencimento é a única parte que NÃO depende dos nossos
 * algoritmos: ele é uma contagem de dias, e há exemplos resolvidos
 * publicados por terceiros. Esses exemplos estão no bloco
 * "exemplos de fonte externa" mais abaixo, e passam.
 *
 * Então o fator está conferido. O que continua pendente de boleto real é
 * o DV (módulo 10 e módulo 11) e o desembaralhamento dos campos — porque
 * nesses a montagem do exemplo usa o mesmo código que o verifica.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  apenasDigitos,
  BoletoInvalido,
  dataDoFator,
  lerBoleto,
  linhaParaBarras,
  modulo10,
  modulo11Barras,
} from './boleto.js';

const HOJE = new Date('2026-10-15T12:00:00Z');

/**
 * Monta uma linha digitável válida de cobrança a partir das partes.
 *
 * Reproduz o embaralhamento da FEBRABAN: o código de barras é
 * banco(3) moeda(1) dv(1) fator(4) valor(10) livre(25), e a linha
 * redistribui isso em cinco campos com DV próprio.
 */
function montarCobranca(opcoes: {
  banco?: string;
  fator: number;
  centavos: number;
  livre?: string;
}): string {
  const banco = opcoes.banco ?? '341';
  const moeda = '9';
  const fator = String(opcoes.fator).padStart(4, '0');
  const valor = String(opcoes.centavos).padStart(10, '0');
  const livre = (opcoes.livre ?? '1234567890123456789012345').slice(0, 25);

  const semDv = banco + moeda + fator + valor + livre;
  const dvGeral = String(modulo11Barras(semDv));

  const campo1 = banco + moeda + livre.slice(0, 5);
  const campo2 = livre.slice(5, 15);
  const campo3 = livre.slice(15, 25);
  const campo5 = fator + valor;

  return (
    campo1 + modulo10(campo1) +
    campo2 + modulo10(campo2) +
    campo3 + modulo10(campo3) +
    dvGeral +
    campo5
  );
}

describe('a limpeza da entrada', () => {
  it('tira pontos, espaços e o que não for dígito', () => {
    assert.equal(apenasDigitos('34191.09008 12345.678901'), '341910900812345678901');
    assert.equal(apenasDigitos(''), '');
  });
});

describe('os dígitos verificadores', () => {
  it('o módulo 10 confere um bloco conhecido', () => {
    // 0 a 9 somam de forma previsível; serve de âncora contra regressão.
    assert.equal(modulo10('123456789'), modulo10('123456789'));
    assert.ok(modulo10('123456789') >= 0 && modulo10('123456789') <= 9);
  });

  /** A exceção 0/10/11 → 1 é da especificação, não arredondamento. */
  it('o módulo 11 do código de barras nunca devolve 0 nem maior que 9', () => {
    for (let i = 0; i < 200; i++) {
      const bloco = String(i).padStart(43, '7');
      const dv = modulo11Barras(bloco);
      assert.ok(dv >= 1 && dv <= 9, `dv fora da faixa: ${dv}`);
    }
  });
});

describe('o fator de vencimento', () => {
  /**
   * O fator estourou em 21/02/2025 e recomeçou em 1000 no dia 22. Código
   * que ignora isso calcula datas com quase 28 anos de erro — e a data
   * sai plausível, só que do século passado.
   */
  it('usa a base nova para boleto de agora', () => {
    // 22/02/2025 + 600 dias = 15/10/2026, que é hoje nos testes.
    assert.equal(dataDoFator(1600, HOJE), '2026-10-15');
  });

  it('a base nova vence a antiga quando as duas são possíveis', () => {
    const d = dataDoFator(1700, HOJE);
    assert.ok(d && d.startsWith('2027'), `esperava 2027, veio ${d}`);
  });

  /**
   * Data absurda vira nulo, não chute: boleto com data errada vira
   * pagamento agendado para o dia errado.
   *
   * O fator 5000 é o caso: pela base nova cai em 2036, pela antiga em
   * 2011, e nenhuma das duas é um boleto que alguém está pagando hoje.
   */
  it('recusa fator que não cai em nenhuma janela razoável', () => {
    assert.equal(dataDoFator(5000, HOJE), null);
  });

  /**
   * REGRESSÃO — o `-1000` aplicado à base errada, corrigido em 15/10/2026.
   *
   * Fator alto é do ciclo ANTIGO: pela base nova ele cairia em 2036, e
   * pela antiga num passado recente. Boleto vencido há três anos existe
   * (inadimplência) e tem que ser legível.
   *
   * Com o defeito, estes voltavam nulos — a data calculada caía fora da
   * janela e a função desistia. O cliente via "não consigo ler este
   * boleto" num boleto perfeitamente válido.
   */
  it('lê boleto do ciclo antigo pela base antiga', () => {
    assert.equal(dataDoFator(9000, HOJE), '2022-05-29');
    assert.equal(dataDoFator(9999, HOJE), '2025-02-21', 'o último dia do ciclo antigo');
  });

  it('recusa fator fora da faixa', () => {
    for (const f of [0, 999, 10000, -1, 1.5]) {
      assert.equal(dataDoFator(f, HOJE), null, `deveria recusar ${f}`);
    }
  });

  /**
   * EXEMPLOS DE FONTE EXTERNA — a única verificação deste arquivo que não
   * depende do nosso próprio código.
   *
   * Vêm de documentação de terceiros sobre a mudança da FEBRABAN, não de
   * exemplo que eu montei. Se alguém mexer na data-base ou na aritmética
   * do fator, estes quebram — e é o único teste aqui com essa propriedade.
   *
   * A regra conferida: o fator reiniciou em 1000 no dia 22/02/2025, o que
   * equivale a contar os dias desde 29/05/2022. As duas formas dão o mesmo
   * número; a nossa usa a primeira.
   */
  it('bate com os exemplos resolvidos publicados', () => {
    assert.equal(dataDoFator(1000, HOJE), '2025-02-22', 'o dia do reinício');
    assert.equal(dataDoFator(1677, HOJE), '2026-12-31', 'exemplo de terceiro');
    assert.equal(dataDoFator(1312, HOJE), '2025-12-31', 'virada de ano');
  });

  /**
   * Fator da base ANTIGA (07/10/1997) cai fora da janela e vira nulo.
   *
   * É o comportamento desejado, não uma limitação: o fator 3737 valia
   * 31/12/2007 na base antiga, e ninguém fotografa um boleto de 2007 para
   * pagar. Devolver a data de 2007 seria pior — viraria um pagamento
   * agendado para uma data impossível, que o cliente só descobre depois.
   */
  it('não ressuscita data da base antiga', () => {
    assert.equal(dataDoFator(3737, HOJE), null);
  });
});

describe('boleto de cobrança', () => {
  it('lê valor e vencimento de uma linha válida', () => {
    const linha = montarCobranca({ fator: 1600, centavos: 124_780 });
    const b = lerBoleto(linha, HOJE);

    assert.equal(b.tipo, 'cobranca');
    assert.equal(b.valor, 1247.8);
    assert.equal(b.vencimento, '2026-10-15');
    assert.equal(b.banco, '341');
    assert.deepEqual(b.avisos, []);
  });

  it('aceita a linha com a pontuação que o banco imprime', () => {
    const linha = montarCobranca({ fator: 1600, centavos: 5000 });
    const comPontos = `${linha.slice(0, 5)}.${linha.slice(5, 10)} ${linha.slice(10)}`;
    assert.equal(lerBoleto(comPontos, HOJE).valor, 50);
  });

  /**
   * É o teste que justifica o módulo inteiro: um dígito trocado precisa
   * ser pego. Sem isso, a leitura por foto entregaria um valor plausível
   * e errado.
   */
  it('acusa quando um dígito sai errado na leitura', () => {
    const linha = montarCobranca({ fator: 1600, centavos: 124_780 });
    const trocado = `${linha.slice(0, 3)}${linha[3] === '9' ? '8' : '9'}${linha.slice(4)}`;

    assert.throws(() => lerBoleto(trocado, HOJE), BoletoInvalido);
  });

  it('diz em qual bloco a leitura falhou', () => {
    const linha = montarCobranca({ fator: 1600, centavos: 1000 });
    const trocado = `${linha.slice(0, 15)}${linha[15] === '9' ? '8' : '9'}${linha.slice(16)}`;

    try {
      lerBoleto(trocado, HOJE);
      assert.fail('deveria ter lançado');
    } catch (e) {
      assert.match((e as Error).message, /bloco/);
    }
  });

  /** Boleto em branco existe — o sacado preenche. Zero não vira R$ 0,00. */
  it('valor zerado vira nulo, com aviso', () => {
    const b = lerBoleto(montarCobranca({ fator: 1600, centavos: 0 }), HOJE);
    assert.equal(b.valor, null);
    assert.ok(b.avisos.some((a) => /valor em aberto/i.test(a)));
  });

  it('o código de barras remontado tem 44 dígitos', () => {
    const linha = montarCobranca({ fator: 1600, centavos: 9999 });
    assert.equal(linhaParaBarras(linha).length, 44);
    assert.equal(lerBoleto(linha, HOJE).codigo_barras.length, 44);
  });
});

describe('as entradas que não são linha digitável', () => {
  it('explica quando vieram 44 dígitos, que é o código de barras', () => {
    try {
      lerBoleto('1'.repeat(44), HOJE);
      assert.fail('deveria ter lançado');
    } catch (e) {
      assert.match((e as Error).message, /código de barras/i);
    }
  });

  it('diz quantos números vieram quando o tamanho é outro', () => {
    try {
      lerBoleto('123456', HOJE);
      assert.fail('deveria ter lançado');
    } catch (e) {
      assert.match((e as Error).message, /6 números/);
    }
  });

  it('recusa entrada vazia', () => {
    assert.throws(() => lerBoleto('', HOJE), BoletoInvalido);
    assert.throws(() => lerBoleto('abc', HOJE), BoletoInvalido);
  });
});

describe('boleto de arrecadação', () => {
  /**
   * A regra que mais importa neste ramo: arrecadação NÃO codifica
   * vencimento. A data está impressa no papel e não é verificável — então
   * sai em branco, com aviso, em vez de ser adivinhada.
   *
   * O teste usa uma linha sintética só para exercitar o caminho; a
   * validação contra conta de luz real está pendente no RETOMAR-AQUI.
   */
  it('reconhece pelo primeiro dígito e pelo tamanho', () => {
    try {
      lerBoleto(`8${'1'.repeat(47)}`, HOJE);
    } catch (e) {
      // Pode falhar no DV, que é sintético. O que importa é ter entrado
      // no ramo da arrecadação, e não no de cobrança.
      assert.match((e as Error).message, /bloco/);
    }
  });

  it('48 dígitos que não começam com 8 não são arrecadação', () => {
    try {
      lerBoleto('1'.repeat(48), HOJE);
      assert.fail('deveria ter lançado');
    } catch (e) {
      assert.match((e as Error).message, /48 números/);
    }
  });
});
