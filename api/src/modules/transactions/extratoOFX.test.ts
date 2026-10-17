/**
 * Testes do leitor de OFX.
 *
 * Os exemplos imitam o que banco brasileiro exporta de verdade,
 * incluindo o OFX 1.x sem fechamento de tag — que é o formato que um
 * parser de XML recusa e que é justamente o mais comum aqui.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ExtratoInvalido } from './extrato.js';
import { lerOFX } from './extratoOFX.js';

/** OFX 1.x: SGML, tag não fecha. É o caso difícil. */
const OFX_1X = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>BRL
<BANKACCTFROM>
<BANKID>341
<ACCTID>12345-6
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20261001
<DTEND>20261015
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20261001120000[-3:BRT]
<TRNAMT>5000.00
<FITID>2026100100001
<MEMO>DEPOSITO DINHEIRO
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261005120000[-3:BRT]
<TRNAMT>-1200.50
<FITID>2026100500002
<NAME>FORNECEDOR XYZ
<MEMO>PAGTO ELETRON COBRANCA
</STMTTRN>
<STMTTRN>
<TRNTYPE>FEE
<DTPOSTED>20261010120000[-3:BRT]
<TRNAMT>-2.90
<FITID>2026101000003
<MEMO>TARIFA PACOTE SERVICOS
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>4796.60
<DTASOF>20261015120000[-3:BRT]
</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

/** OFX 2.x: XML de verdade. */
const OFX_2X = `<?xml version="1.0" encoding="UTF-8"?>
<OFX>
  <BANKMSGSRSV1><STMTTRNRS><STMTRS>
    <BANKACCTFROM><BANKID>001</BANKID><ACCTID>98765</ACCTID></BANKACCTFROM>
    <BANKTRANLIST>
      <STMTTRN>
        <TRNTYPE>DEBIT</TRNTYPE>
        <DTPOSTED>20261012</DTPOSTED>
        <TRNAMT>-350.00</TRNAMT>
        <FITID>XYZ-1</FITID>
        <MEMO>DEB AUTOM ENERGIA</MEMO>
      </STMTTRN>
    </BANKTRANLIST>
    <LEDGERBAL><BALAMT>650.00</BALAMT><DTASOF>20261012</DTASOF></LEDGERBAL>
  </STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

describe('OFX 1.x, com tag sem fechamento', () => {
  const r = lerOFX(OFX_1X);

  it('lê os três lançamentos', () => {
    assert.equal(r.linhas.length, 3);
  });

  it('identifica banco e conta', () => {
    assert.equal(r.banco, '341');
    assert.equal(r.conta, '12345-6');
  });

  it('lê valores com sinal e data sem a hora', () => {
    assert.deepEqual(
      r.linhas.map((l) => [l.data, l.valor]),
      [
        ['2026-10-01', 5000],
        ['2026-10-05', -1200.5],
        ['2026-10-10', -2.9],
      ],
    );
  });

  it('junta NAME e MEMO no histórico', () => {
    assert.match(r.linhas[1]!.historico, /FORNECEDOR XYZ/);
    assert.match(r.linhas[1]!.historico, /PAGTO ELETRON/);
  });

  it('guarda o FITID, que é a trava de reimportação', () => {
    assert.equal(r.linhas[0]!.fitid, '2026100100001');
  });

  it('lê o saldo final do LEDGERBAL', () => {
    assert.equal(r.saldo_final, 4796.6);
  });

  /**
   * OFX quase nunca traz saldo ANTERIOR. Sai nulo de propósito: quem
   * chama resolve de onde partiu (saldo da conta cadastrada, ou o final
   * da última importação).
   *
   * Inventar um valor aqui faria o portão de saldo aprovar qualquer
   * arquivo — o que é pior que não ter portão, porque pareceria conferido.
   */
  it('não inventa saldo anterior', () => {
    assert.equal(r.saldo_anterior, null);
  });

  it('não reclama de nada neste arquivo', () => {
    assert.deepEqual(r.avisos, []);
  });

  /** O portão fecha com este arquivo, partindo de 1000. */
  it('as linhas somam a variação de saldo declarada', () => {
    const soma = r.linhas.reduce((t, l) => t + l.valor, 0);
    assert.equal(Math.round(soma * 100) / 100, 3796.6);
    assert.equal(Math.round((4796.6 - 1000) * 100) / 100, 3796.6);
  });
});

describe('OFX 2.x, XML', () => {
  it('lê igual, sem parser de XML', () => {
    const r = lerOFX(OFX_2X);
    assert.equal(r.linhas.length, 1);
    assert.equal(r.linhas[0]!.valor, -350);
    assert.equal(r.linhas[0]!.data, '2026-10-12');
    assert.equal(r.linhas[0]!.fitid, 'XYZ-1');
    assert.equal(r.conta, '98765');
    assert.equal(r.saldo_final, 650);
  });
});

describe('o que o leitor avisa', () => {
  /**
   * Alguns bancos mandam DEBIT com valor positivo. O valor manda, porque
   * é o campo que o banco usa para somar o próprio saldo — mas a
   * discordância é avisada, porque é sinal de arquivo estranho e a
   * pessoa precisa olhar antes de importar.
   */
  it('acusa tipo e sinal em desacordo', () => {
    const r = lerOFX(OFX_1X.replace('<TRNAMT>-1200.50', '<TRNAMT>1200.50'));
    assert.ok(r.avisos.some((a) => /desacordo/i.test(a)));
    assert.equal(r.linhas[1]!.valor, 1200.5, 'o sinal do valor é o que vale');
  });

  it('avisa quando o arquivo não tem FITID', () => {
    const r = lerOFX(OFX_1X.replace(/<FITID>.*\n/g, ''));
    assert.ok(r.avisos.some((a) => /FITID/.test(a)));
    assert.equal(r.linhas.length, 3, 'sem FITID ainda lê');
  });

  it('ignora e conta lançamento sem data', () => {
    const r = lerOFX(OFX_1X.replace('<DTPOSTED>20261005120000[-3:BRT]', '<DTPOSTED>'));
    assert.equal(r.linhas.length, 2);
    assert.ok(r.avisos.some((a) => /sem data/i.test(a)));
  });

  it('ignora e conta lançamento sem valor', () => {
    const r = lerOFX(OFX_1X.replace('<TRNAMT>-2.90', '<TRNAMT>'));
    assert.equal(r.linhas.length, 2);
    assert.ok(r.avisos.some((a) => /sem valor/i.test(a)));
  });

  it('preenche histórico quando o banco não manda nenhum', () => {
    const r = lerOFX(OFX_2X.replace('<MEMO>DEB AUTOM ENERGIA</MEMO>', ''));
    assert.equal(r.linhas[0]!.historico, 'Sem histórico');
  });
});

describe('arquivo que não serve', () => {
  it('recusa vazio', () => {
    assert.throws(() => lerOFX(''), ExtratoInvalido);
    assert.throws(() => lerOFX('   '), ExtratoInvalido);
  });

  /** Mensagem que diz o que fazer, não só que deu errado. */
  it('recusa CSV mandado por engano, explicando onde baixar', () => {
    try {
      lerOFX('data;valor;historico\n01/10/2026;100,00;DEPOSITO');
      assert.fail('deveria ter lançado');
    } catch (e) {
      assert.match((e as Error).message, /não parece ser um OFX/i);
      assert.match((e as Error).message, /OFX/);
    }
  });

  it('recusa OFX sem nenhum lançamento', () => {
    const vazio = OFX_1X.replace(/<STMTTRN>[\s\S]*<\/STMTTRN>/, '');
    assert.throws(() => lerOFX(vazio), ExtratoInvalido);
  });

  it('ordena por data mesmo se o arquivo vier fora de ordem', () => {
    const invertido = `<OFX><BANKTRANLIST>
<STMTTRN><DTPOSTED>20261020<TRNAMT>-10.00<FITID>b<MEMO>B</STMTTRN>
<STMTTRN><DTPOSTED>20261001<TRNAMT>-20.00<FITID>a<MEMO>A</STMTTRN>
</BANKTRANLIST></OFX>`;
    const r = lerOFX(invertido);
    assert.deepEqual(r.linhas.map((l) => l.data), ['2026-10-01', '2026-10-20']);
  });
});
