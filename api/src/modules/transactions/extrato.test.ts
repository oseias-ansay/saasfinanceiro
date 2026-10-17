/**
 * Testes do núcleo do extrato.
 *
 * Três blocos carregam o peso: os números (onde eu já errei antes), o
 * portão de saldo (a única verificação de integridade que um extrato
 * oferece) e a conciliação (onde um erro dá baixa na conta errada).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  comIdentidade,
  conciliar,
  conferirFechamento,
  dataExtrato,
  identidadeLinha,
  valorBancario,
  type LancamentoAberto,
  type LinhaExtrato,
} from './extrato.js';

const linha = (
  data: string,
  valor: number,
  historico = 'MOV',
  fitid: string | null = null,
): LinhaExtrato => ({ data, valor, historico, fitid });

describe('o valor que o banco escreveu', () => {
  it('lê as duas convenções de decimal', () => {
    assert.equal(valorBancario('1234.56'), 1234.56);
    assert.equal(valorBancario('1234,56'), 1234.56);
    assert.equal(valorBancario('1.234,56'), 1234.56);
    assert.equal(valorBancario('1,234.56'), 1234.56);
  });

  /**
   * REGRESSÃO do erro do `indicadores.ts`: eu tratei o ponto como
   * separador de milhar e `-0.32` virou `-32`.
   *
   * Num extrato o estrago é pior que num indicador: o saldo é o primeiro
   * número que o empresário confere, e errado por fator de cem ele
   * desconfia da tela inteira.
   */
  it('não confunde decimal com milhar', () => {
    assert.equal(valorBancario('-0.32'), -0.32);
    assert.equal(valorBancario('0,32'), 0.32);
    assert.equal(valorBancario('12.50'), 12.5);
  });

  /** Três casas depois do separador, sem outro separador, é milhar. */
  it('entende 1.234 como mil duzentos e trinta e quatro', () => {
    assert.equal(valorBancario('1.234'), 1234);
    assert.equal(valorBancario('1234'), 1234);
    assert.equal(valorBancario('12.345,67'), 12345.67);
  });

  it('aceita os sinais que extrato usa', () => {
    assert.equal(valorBancario('-100,00'), -100);
    assert.equal(valorBancario('100,00-'), -100, 'sinal depois, estilo mainframe');
    assert.equal(valorBancario('(100,00)'), -100, 'parênteses, estilo contábil');
    assert.equal(valorBancario('+100,00'), 100);
  });

  it('tira moeda e espaço, inclusive o insecável do PDF', () => {
    assert.equal(valorBancario('R$ 1.247,80'), 1247.8);
    assert.equal(valorBancario('R$ 1.247,80'), 1247.8);
  });

  it('devolve nulo em vez de zero para lixo', () => {
    for (const v of ['', '   ', 'abc', '-', 'R$', null, undefined, {}, NaN]) {
      assert.equal(valorBancario(v as unknown), null, `deveria recusar ${String(v)}`);
    }
  });

  /**
   * Zero não vira nulo: tarifa estornada, lançamento de R$ 0,00 para
   * ajuste — existem. Nulo aqui esconderia linha do extrato e o saldo
   * deixaria de fechar.
   */
  it('zero é valor, não ausência', () => {
    assert.equal(valorBancario('0,00'), 0);
  });
});

describe('a data do extrato', () => {
  it('lê o formato do OFX, com e sem hora', () => {
    assert.equal(dataExtrato('20261015'), '2026-10-15');
    assert.equal(dataExtrato('20261015120000[-3:BRT]'), '2026-10-15');
  });

  it('lê o formato brasileiro', () => {
    assert.equal(dataExtrato('15/10/2026'), '2026-10-15');
    assert.equal(dataExtrato('5/1/2026'), '2026-01-05');
    assert.equal(dataExtrato('15/10/26'), '2026-10-15');
  });

  /**
   * Extrato mensal em PDF às vezes traz só dia e mês. O ano vem de fora
   * — e NÃO do relógio: extrato de dezembro importado em janeiro cairia
   * em dezembro do ano novo, e o lançamento apareceria doze meses fora
   * de lugar.
   */
  it('sem ano exige o ano de referência', () => {
    assert.equal(dataExtrato('15/10'), null);
    assert.equal(dataExtrato('15/10', 2026), '2026-10-15');
  });

  it('recusa data que não existe', () => {
    assert.equal(dataExtrato('31/02/2026'), null);
    assert.equal(dataExtrato('20260231'), null);
    assert.equal(dataExtrato(''), null);
    assert.equal(dataExtrato('qualquer coisa'), null);
  });
});

describe('a identidade da linha', () => {
  it('usa o FITID quando o banco manda', () => {
    const a = identidadeLinha(linha('2026-10-15', -50, 'TARIFA', 'ABC123'), '1234', 0);
    assert.match(a, /^fitid:1234:ABC123$/);
  });

  it('sem FITID, deriva do conteúdo', () => {
    const a = identidadeLinha(linha('2026-10-15', -50, 'TARIFA'), '1234', 0);
    const b = identidadeLinha(linha('2026-10-15', -50, 'tarifa  '), '1234', 0);
    assert.equal(a, b, 'espaço e caixa não deveriam mudar a identidade');
  });

  it('linha de contas diferentes não colide', () => {
    const a = identidadeLinha(linha('2026-10-15', -50), '1111', 0);
    const b = identidadeLinha(linha('2026-10-15', -50), '2222', 0);
    assert.notEqual(a, b);
  });

  /**
   * A DECISÃO QUE MAIS IMPORTA DESTE BLOCO.
   *
   * Duas tarifas de R$ 2,90 no mesmo dia, mesmo histórico, são DOIS
   * fatos. Sem a posição no hash, a segunda seria vista como reimportação
   * da primeira e descartada — e aí o saldo não fecharia, por um motivo
   * que ninguém ia achar.
   */
  it('duas linhas idênticas no mesmo dia são dois fatos', () => {
    const duas = comIdentidade(
      [linha('2026-10-15', -2.9, 'TARIFA'), linha('2026-10-15', -2.9, 'TARIFA')],
      '1234',
    );
    assert.notEqual(duas[0]!.identidade, duas[1]!.identidade);
  });

  it('reimportar o mesmo arquivo dá as mesmas identidades', () => {
    const arquivo = [
      linha('2026-10-15', -2.9, 'TARIFA'),
      linha('2026-10-15', -2.9, 'TARIFA'),
      linha('2026-10-16', 1000, 'DEPOSITO'),
    ];
    const a = comIdentidade(arquivo, '1234').map((l) => l.identidade);
    const b = comIdentidade(arquivo, '1234').map((l) => l.identidade);
    assert.deepEqual(a, b);
  });
});

describe('o portão de saldo', () => {
  const movimentos = [
    linha('2026-10-01', 5000, 'DEPOSITO'),
    linha('2026-10-05', -1200.5, 'PAGTO'),
    linha('2026-10-10', -2.9, 'TARIFA'),
  ];
  // soma = 3796,60

  it('fecha quando a soma bate com a variação de saldo', () => {
    const f = conferirFechamento(movimentos, 1000, 4796.6);
    assert.equal(f.fecha, true);
    assert.equal(f.soma, 3796.6);
    assert.equal(f.aviso, null);
  });

  it('tolera um centavo de arredondamento', () => {
    assert.equal(conferirFechamento(movimentos, 1000, 4796.61).fecha, true);
  });

  /**
   * O caso que justifica a função: uma linha não lida.
   *
   * Em PDF isso é o erro provável — o modelo pula uma linha da tabela, e
   * o extrato importa "quase certo". Sem este portão, o mês fecha com um
   * saldo plausível e errado, e ninguém desconfia de número plausível.
   */
  it('não fecha quando falta uma linha', () => {
    const faltando = movimentos.slice(0, 2);
    const f = conferirFechamento(faltando, 1000, 4796.6);

    assert.equal(f.fecha, false);
    assert.equal(f.diferenca, 2.9);
    assert.match(f.aviso!, /não bate/i);
    assert.match(f.aviso!, /2\.90/);
  });

  it('não fecha quando um valor saiu com a vírgula errada', () => {
    const errado = [
      linha('2026-10-01', 5000, 'DEPOSITO'),
      linha('2026-10-05', -120.05, 'PAGTO'), // era -1200,50
      linha('2026-10-10', -2.9, 'TARIFA'),
    ];
    assert.equal(conferirFechamento(errado, 1000, 4796.6).fecha, false);
  });

  /**
   * Sem saldo declarado não há como conferir — e isso é dito, não
   * escondido. `fecha: false` com aviso, nunca `true` por otimismo:
   * quem lê o retorno não pode confundir "não deu para conferir" com
   * "conferiu e está certo".
   */
  it('sem saldo declarado avisa, e não finge que fechou', () => {
    const f = conferirFechamento(movimentos, null, null);
    assert.equal(f.fecha, false);
    assert.equal(f.esperado, null);
    assert.match(f.aviso!, /não dá para conferir/i);
  });

  it('extrato vazio com saldo igual fecha', () => {
    const f = conferirFechamento([], 1000, 1000);
    assert.equal(f.fecha, true);
    assert.equal(f.soma, 0);
  });
});

describe('a conciliação', () => {
  const aberto = (
    id: string,
    tipo: 'receita' | 'despesa',
    valor: number,
    due_date: string,
    descricao = id,
  ): LancamentoAberto => ({ id, tipo, valor, due_date, descricao });

  it('casa despesa pelo valor, com a data desempatando', () => {
    const linhas = comIdentidade([linha('2026-10-11', -3000, 'PAGTO ELETRON')], '1');
    const c = conciliar(linhas, [aberto('aluguel', 'despesa', 3000, '2026-10-10')]);

    assert.equal(c.pares.length, 1);
    assert.equal(c.pares[0]!.lancamento.id, 'aluguel');
    assert.equal(c.pares[0]!.distancia_dias, 1);
    assert.equal(c.pares[0]!.confianca, 'alta');
    assert.equal(c.sem_par.length, 0);
    assert.equal(c.nao_explicados.length, 0);
  });

  it('entrada casa com receita, não com despesa', () => {
    const linhas = comIdentidade([linha('2026-10-11', 3000, 'CREDITO')], '1');
    const c = conciliar(linhas, [
      aberto('despesa-igual', 'despesa', 3000, '2026-10-10'),
      aberto('receita-certa', 'receita', 3000, '2026-10-10'),
    ]);

    assert.equal(c.pares.length, 1);
    assert.equal(c.pares[0]!.lancamento.id, 'receita-certa');
  });

  /**
   * O histórico do banco NÃO entra no casamento, e é de propósito:
   * "PAGTO ELETRON COBRANCA 0001" não parece com "Fornecedor de
   * bebidas". Casar por texto erraria quase sempre e daria a impressão
   * de ser inteligente.
   */
  it('não exige que o histórico pareça com a descrição', () => {
    const linhas = comIdentidade([linha('2026-10-10', -500, 'DEB AUTOM 9988')], '1');
    const c = conciliar(linhas, [
      aberto('energia', 'despesa', 500, '2026-10-10', 'Energia elétrica'),
    ]);
    assert.equal(c.pares.length, 1);
  });

  it('marca confiança média quando a data está longe', () => {
    const linhas = comIdentidade([linha('2026-10-28', -500, 'PAGTO')], '1');
    const c = conciliar(linhas, [aberto('x', 'despesa', 500, '2026-10-10')]);

    assert.equal(c.pares[0]!.distancia_dias, 18);
    assert.equal(c.pares[0]!.confianca, 'media');
  });

  it('fora da janela não casa', () => {
    const linhas = comIdentidade([linha('2026-12-20', -500, 'PAGTO')], '1');
    const c = conciliar(linhas, [aberto('x', 'despesa', 500, '2026-10-10')]);

    assert.equal(c.pares.length, 0);
    assert.equal(c.sem_par.length, 1);
    assert.equal(c.nao_explicados.length, 1);
  });

  /**
   * UM LANÇAMENTO LIQUIDA UMA VEZ SÓ.
   *
   * Sem isso, duas tarifas iguais no extrato dariam baixa duas vezes na
   * mesma obrigação — e o relatório mostraria uma conta paga e a outra
   * em aberto para sempre, sem explicação visível.
   */
  it('não dá baixa duas vezes no mesmo lançamento', () => {
    const linhas = comIdentidade(
      [linha('2026-10-10', -100, 'TARIFA'), linha('2026-10-10', -100, 'TARIFA')],
      '1',
    );
    const c = conciliar(linhas, [aberto('so-uma', 'despesa', 100, '2026-10-10')]);

    assert.equal(c.pares.length, 1);
    assert.equal(c.sem_par.length, 1, 'a segunda tarifa fica para conferência');
  });

  it('entre dois candidatos iguais, vence o mais próximo da data', () => {
    const linhas = comIdentidade([linha('2026-10-20', -100, 'PAGTO')], '1');
    const c = conciliar(linhas, [
      aberto('longe', 'despesa', 100, '2026-10-01'),
      aberto('perto', 'despesa', 100, '2026-10-19'),
    ]);

    assert.equal(c.pares[0]!.lancamento.id, 'perto');
  });

  it('valor diferente por um centavo não casa', () => {
    const linhas = comIdentidade([linha('2026-10-10', -100.01, 'PAGTO')], '1');
    const c = conciliar(linhas, [aberto('x', 'despesa', 100, '2026-10-10')]);
    assert.equal(c.pares.length, 0);
  });

  /**
   * Lançamento em aberto que o extrato não explicou é informação, não
   * sobra: é uma conta que a plataforma acha paga e o banco não
   * confirma. A tela precisa mostrar isso.
   */
  it('devolve os lançamentos que o extrato não explicou', () => {
    const linhas = comIdentidade([linha('2026-10-10', -100, 'PAGTO')], '1');
    const c = conciliar(linhas, [
      aberto('casou', 'despesa', 100, '2026-10-10'),
      aberto('sobrou', 'despesa', 777, '2026-10-12'),
    ]);

    assert.equal(c.nao_explicados.length, 1);
    assert.equal(c.nao_explicados[0]!.id, 'sobrou');
  });

  it('aguenta extrato vazio e lista de abertos vazia', () => {
    assert.deepEqual(conciliar([], []), {
      pares: [],
      sem_par: [],
      nao_explicados: [],
    });
  });
});
