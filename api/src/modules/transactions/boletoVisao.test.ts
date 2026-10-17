/**
 * Testes da extração da resposta do modelo.
 *
 * O que se testa aqui é a nossa resistência ao que o modelo pode
 * devolver — e ele devolve coisa fora do contrato de vez em quando.
 * A chamada de rede não é testada; o que importa dela é o `max_tokens`
 * baixo e a temperatura zero, que são configuração, não lógica.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { blocoDoArquivo, extrairLinha, FotoIlegivel, INSTRUCAO } from './boletoVisao.js';

const L47 = '34191234546789012345767890123457316000000124780';
const L48 = `8${'1'.repeat(47)}`;

describe('a extração da linha', () => {
  it('aceita a resposta no formato pedido', () => {
    assert.equal(extrairLinha(L47), L47);
    assert.equal(extrairLinha(`  ${L47}\n`), L47);
  });

  it('aceita 48 dígitos, que é arrecadação', () => {
    assert.equal(extrairLinha(L48), L48);
  });

  /** O modelo às vezes devolve como está impresso, em grupos. */
  it('junta os grupos separados por ponto e espaço', () => {
    const impressa = `${L47.slice(0, 5)}.${L47.slice(5, 10)} ${L47.slice(10, 20)} ${L47.slice(20)}`;
    assert.equal(extrairLinha(impressa), L47);
  });

  it('tolera uma frase em volta', () => {
    assert.equal(extrairLinha(`A linha digitável é:\n${L47}`), L47);
  });

  it('entende o NENHUM', () => {
    assert.equal(extrairLinha('NENHUM'), null);
    assert.equal(extrairLinha('nenhum'), null);
    assert.equal(extrairLinha('NENHUM — a foto está desfocada'), null);
  });

  it('resposta vazia vira nulo', () => {
    assert.equal(extrairLinha(''), null);
    assert.equal(extrairLinha('   \n '), null);
  });

  /**
   * A decisão que mais importa deste arquivo.
   *
   * Sequência com dígito sobrando não é cortada para caber. Escolher
   * quais 47 dos 52 manter seria um palpite nosso transformado em valor
   * a pagar — e o palpite sairia sem aviso, com DV conferindo por acaso
   * de vez em quando.
   *
   * Nulo manda a pessoa digitar. É um atrito honesto.
   */
  it('não corta sequência longa demais', () => {
    assert.equal(extrairLinha(`${L47}99999`), null);
    assert.equal(extrairLinha('1'.repeat(60)), null);
  });

  it('sequência curta demais vira nulo', () => {
    assert.equal(extrairLinha('123456'), null);
    assert.equal(extrairLinha('1'.repeat(44)), null, '44 é código de barras, não linha');
  });

  /**
   * Duas candidatas é ambiguidade de verdade: pode ser a linha e algum
   * outro número da página. Chutar a primeira acerta na média e erra o
   * boleto específico que estiver fora da média.
   */
  it('duas candidatas viram nulo em vez de chute', () => {
    assert.equal(extrairLinha(`${L47}\n${L47}`), null);
  });
});

describe('o bloco de conteúdo por tipo de arquivo', () => {
  /**
   * O erro que este teste existe para pegar: PDF mandado como `image`.
   *
   * A API recusa, e o sintoma chega ao cliente como "não consegui ler
   * este boleto" — indistinguível de uma foto ruim. Como boleto por
   * e-mail é quase sempre PDF, seria a maioria dos casos falhando com a
   * mensagem errada.
   */
  it('PDF vira document, não image', () => {
    const b = blocoDoArquivo('application/pdf', 'QUJD');
    assert.equal(b.type, 'document');
    assert.equal(b.source.media_type, 'application/pdf');
  });

  it('foto vira image', () => {
    for (const m of ['image/jpeg', 'image/png', 'image/webp']) {
      assert.equal(blocoDoArquivo(m, 'QUJD').type, 'image', m);
    }
  });

  it('o base64 passa intacto', () => {
    assert.equal(blocoDoArquivo('image/png', 'QUJD').source.data, 'QUJD');
  });

  /**
   * HEIC é o padrão do iPhone e o cliente não sabe que está mandando
   * HEIC — ele só tirou uma foto. O bucket aceita (o arquivo fica
   * guardado), a leitura recusa com mensagem, e a saída é digitar a
   * linha. Recusar no bucket perderia o arquivo junto com a tentativa.
   */
  it('recusa HEIC e qualquer outro tipo, com mensagem útil', () => {
    for (const m of ['image/heic', 'text/plain', 'application/zip', '']) {
      assert.throws(() => blocoDoArquivo(m, 'QUJD'), FotoIlegivel, m);
    }
    try {
      blocoDoArquivo('image/heic', 'QUJD');
    } catch (e) {
      assert.match((e as Error).message, /JPEG, PNG, WEBP ou PDF/);
    }
  });
});

describe('a instrução', () => {
  /**
   * Teste de contrato, não de texto. Se alguém reescrever a instrução e
   * tirar a proibição de ler valor e data, o modelo volta a interpretar
   * o boleto — e aí o erro dele deixa de ser detectável, que é a
   * premissa inteira deste módulo.
   */
  it('proíbe o modelo de ler valor e data', () => {
    assert.match(INSTRUCAO, /não leia o valor nem a data/i);
  });

  it('manda responder só com dígitos', () => {
    assert.match(INSTRUCAO, /APENAS com os dígitos/);
  });

  it('define a saída para foto ilegível', () => {
    assert.match(INSTRUCAO, /NENHUM/);
  });
});
