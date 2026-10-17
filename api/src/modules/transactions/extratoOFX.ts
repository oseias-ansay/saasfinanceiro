/**
 * Leitor de OFX.
 *
 * =====================================================================
 * POR QUE OFX É O FORMATO QUE VALE A PENA
 * =====================================================================
 * Ele traz `FITID`: um identificador do próprio banco para cada
 * lançamento. É o que faz reimportar o extrato ser seguro sem nenhuma
 * heurística nossa — e reimportar é o caso normal, não o excepcional.
 *
 * E é um formato só para todos os bancos. CSV cada banco inventa o seu;
 * PDF depende de leitura por modelo. OFX é o único caminho em que um
 * leitor serve todo mundo.
 *
 * =====================================================================
 * SÃO DUAS SINTAXES COM O MESMO NOME
 * =====================================================================
 * OFX 1.x é SGML: tag não fecha. `<TRNAMT>-123.45` e pronto, o valor
 * termina na próxima tag. OFX 2.x é XML de verdade, com fechamento.
 *
 * Um parser de XML quebra no 1.x, que é justamente o que os bancos
 * brasileiros mais exportam. Então a leitura aqui é por extração de
 * campo: pega o conteúdo entre a tag e o que vier primeiro — o
 * fechamento dela ou a próxima tag. Serve nos dois.
 *
 * Não é um parser de OFX completo e não pretende ser: ele lê os seis
 * campos que a conciliação usa e ignora o resto do arquivo.
 */

import {
  dataExtrato,
  ExtratoInvalido,
  valorBancario,
  type ExtratoLido,
  type LinhaExtrato,
} from './extrato.js';

/**
 * Pega o valor de uma tag, tolerando fechada e não fechada.
 *
 * `[^<]*` é o que resolve o SGML: o conteúdo vai até o próximo `<`, que
 * pode ser o fechamento da tag ou a tag seguinte.
 */
function campo(bloco: string, tag: string): string | null {
  const m = bloco.match(new RegExp(`<${tag}>([^<]*)`, 'i'));
  if (!m) return null;
  const v = m[1]!.trim();
  return v === '' ? null : v;
}

/** Todos os blocos de transação do arquivo. */
function blocosDeTransacao(texto: string): string[] {
  const achados: string[] = [];
  const padrao = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;

  for (const m of texto.matchAll(padrao)) {
    achados.push(m[1]!);
  }

  /**
   * Alguns arquivos 1.x não fecham nem o `<STMTTRN>`. Aí a divisão é
   * pela própria abertura da tag seguinte.
   *
   * Não é teoria: aparece em exportação de banco que gera o OFX por
   * concatenação de texto, que é a maioria.
   */
  if (achados.length === 0 && /<STMTTRN>/i.test(texto)) {
    const partes = texto.split(/<STMTTRN>/i).slice(1);
    for (const p of partes) {
      achados.push(p.split(/<\/?(?:BANKTRANLIST|LEDGERBAL|STMTRS)>/i)[0]!);
    }
  }

  return achados;
}

/**
 * Lê o OFX e devolve as linhas normalizadas.
 *
 * O sinal vem do `TRNAMT`, não do `TRNTYPE`. A razão é que o valor é o
 * campo que o banco preenche certo sempre — ele é usado para somar o
 * saldo —, enquanto `TRNTYPE` varia de banco para banco e alguns mandam
 * `DEBIT` com valor positivo. Quando os dois discordam, o valor manda e
 * fica um aviso: discordância é sinal de arquivo estranho, e a pessoa
 * precisa saber antes de importar.
 */
export function lerOFX(conteudo: string): ExtratoLido {
  const texto = String(conteudo ?? '');

  if (texto.trim() === '') {
    throw new ExtratoInvalido('O arquivo está vazio.');
  }
  if (!/<OFX>|<STMTTRN>|OFXHEADER/i.test(texto)) {
    throw new ExtratoInvalido(
      'Este arquivo não parece ser um OFX. Baixe no banco a opção ' +
        '"extrato para gerenciador financeiro" ou "OFX".',
    );
  }

  const avisos: string[] = [];

  const banco = campo(texto, 'BANKID');
  const conta = campo(texto, 'ACCTID');

  /**
   * `LEDGERBAL` é o saldo final da conta na data `DTASOF`. OFX quase
   * nunca traz o saldo ANTERIOR — então o portão de saldo, aqui, só
   * fecha se a plataforma souber de onde partiu (o saldo da conta
   * cadastrada, ou o saldo final da última importação).
   *
   * Por isso `saldo_anterior` sai nulo: quem chama resolve. Inventar um
   * valor aqui faria o portão aprovar qualquer arquivo.
   */
  const saldoFinal = valorBancario(campo(texto, 'BALAMT'));

  const blocos = blocosDeTransacao(texto);

  if (blocos.length === 0) {
    throw new ExtratoInvalido(
      'Não encontrei nenhum lançamento neste OFX. Confira se o período ' +
        'baixado tem movimentação.',
    );
  }

  const linhas: LinhaExtrato[] = [];
  let semData = 0;
  let semValor = 0;
  let sinalDivergente = 0;

  for (const bloco of blocos) {
    const data = dataExtrato(campo(bloco, 'DTPOSTED') ?? '');
    const valor = valorBancario(campo(bloco, 'TRNAMT'));

    if (data === null) {
      semData++;
      continue;
    }
    if (valor === null) {
      semValor++;
      continue;
    }

    const tipo = (campo(bloco, 'TRNTYPE') ?? '').toUpperCase();
    if (valor !== 0) {
      const esperaNegativo = tipo === 'DEBIT' || tipo === 'PAYMENT' || tipo === 'FEE';
      if (esperaNegativo && valor > 0) sinalDivergente++;
      if (tipo === 'CREDIT' && valor < 0) sinalDivergente++;
    }

    // `MEMO` é o histórico; `NAME` é a contraparte. Juntos são o que a
    // pessoa reconhece — e alguns bancos preenchem só um dos dois.
    const memo = campo(bloco, 'MEMO');
    const nome = campo(bloco, 'NAME');
    const historico = [nome, memo]
      .filter((x) => x && x.trim() !== '')
      .join(' · ')
      .slice(0, 300);

    linhas.push({
      data,
      valor,
      historico: historico || 'Sem histórico',
      fitid: campo(bloco, 'FITID'),
    });
  }

  if (semData > 0) {
    avisos.push(`${semData} lançamento(s) sem data legível foram ignorados.`);
  }
  if (semValor > 0) {
    avisos.push(`${semValor} lançamento(s) sem valor legível foram ignorados.`);
  }
  if (sinalDivergente > 0) {
    avisos.push(
      `${sinalDivergente} lançamento(s) têm o tipo e o sinal do valor em ` +
        'desacordo. Usei o sinal do valor; confira esses na lista.',
    );
  }

  /**
   * Arquivo sem FITID é legal mas perde a trava barata de reimportação.
   * A identidade cai no hash, que funciona — e o aviso existe porque o
   * hash é mais frágil a banco que muda o texto do histórico entre uma
   * exportação e outra.
   */
  const comFitid = linhas.filter((l) => l.fitid).length;
  if (comFitid === 0) {
    avisos.push(
      'Este OFX não traz identificador por lançamento (FITID). A trava ' +
        'contra importar duas vezes passa a depender de data, valor e histórico.',
    );
  } else if (comFitid < linhas.length) {
    avisos.push(`${linhas.length - comFitid} lançamento(s) vieram sem FITID.`);
  }

  if (linhas.length === 0) {
    throw new ExtratoInvalido(
      'Nenhum lançamento deste arquivo pôde ser lido. Confira se o OFX ' +
        'não está truncado.',
    );
  }

  // Ordem cronológica, porque o arquivo não garante e a tela mostra
  // como extrato.
  linhas.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));

  return {
    formato: 'ofx',
    banco,
    conta,
    saldo_anterior: null,
    saldo_final: saldoFinal,
    linhas,
    avisos,
  };
}
