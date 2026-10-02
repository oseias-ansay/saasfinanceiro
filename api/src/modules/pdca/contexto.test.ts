/**
 * Testes da montagem do contexto.
 *
 * O que estes testes protegem não é a formatação do texto — é a
 * fidelidade dele. Um contexto que diz "3 atrasadas" quando são 2 produz
 * uma resposta errada com toda a aparência de certa, e o cliente não tem
 * como desconfiar.
 *
 * Por isso a maioria dos casos aqui é de contagem e de ausência de dado,
 * não de redação.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  descreverSituacao,
  montarContexto,
  ordenar,
  resumir,
  type AcaoDoContexto,
  type DadosDoContexto,
} from './contexto.js';

const HOJE = new Date('2026-10-01T12:00:00Z');

function acao(p: Partial<AcaoDoContexto> = {}): AcaoDoContexto {
  return {
    titulo: 'Separar as contas da empresa das contas pessoais',
    responsavel_nome: 'Maria',
    prazo: '2026-10-15',
    status: 'aberta',
    ...p,
  };
}

function dados(p: Partial<DadosDoContexto> = {}): DadosDoContexto {
  return {
    empresa: 'Padaria do Centro',
    plano: { titulo: '1º ciclo', created_at: '2026-09-01T10:00:00Z' },
    acoes: [acao()],
    hoje: HOJE,
    ...p,
  };
}

describe('a situação de cada ação', () => {
  it('diz o atraso em dias, não só que está atrasada', () => {
    const s = descreverSituacao(acao({ prazo: '2026-09-11' }), HOJE);
    assert.match(s, /ATRASADA há 20 dia/);
  });

  it('distingue vencer hoje de faltar um dia', () => {
    assert.match(descreverSituacao(acao({ prazo: '2026-10-01' }), HOJE), /vence hoje/);
    assert.match(descreverSituacao(acao({ prazo: '2026-10-02' }), HOJE), /faltam 1 dia/);
  });

  /**
   * Concluída com atraso continua sendo conclusão, mas o atraso aparece.
   * É o dado que separa "o plano está andando" de "o plano está andando
   * sempre depois da hora" — e a segunda leitura muda a conversa da
   * reunião.
   */
  it('mostra o atraso de quem concluiu depois do prazo', () => {
    const s = descreverSituacao(
      acao({ status: 'concluida', prazo: '2026-09-20', concluida_em: '2026-09-28T09:00:00Z' }),
      HOJE,
    );
    assert.match(s, /concluída em 28\/09\/2026, 8 dia\(s\) após o prazo/);
  });

  it('diz "dentro do prazo" quando foi no dia ou antes', () => {
    const s = descreverSituacao(
      acao({ status: 'concluida', prazo: '2026-09-20', concluida_em: '2026-09-20T09:00:00Z' }),
      HOJE,
    );
    assert.match(s, /dentro do prazo/);
  });
});

describe('os números do plano', () => {
  it('conta abertas, concluídas e atrasadas', () => {
    const r = resumir(
      dados({
        acoes: [
          acao({ prazo: '2026-09-01' }),
          acao({ prazo: '2026-09-02' }),
          acao({ prazo: '2026-12-01' }),
          acao({ status: 'concluida', prazo: '2026-09-10', concluida_em: '2026-09-09T10:00:00Z' }),
        ],
      }),
    );
    assert.equal(r.total, 4);
    assert.equal(r.abertas, 3);
    assert.equal(r.concluidas, 1);
    assert.equal(r.atrasadas, 2);
  });

  /**
   * O caso que fez a regra existir: tirar as canceladas do denominador
   * faria um plano de dez ações com oito canceladas e duas feitas marcar
   * 100%. O cliente leria "plano cumprido" num plano abandonado.
   */
  it('mantém as canceladas no denominador do percentual', () => {
    const r = resumir(
      dados({
        acoes: [
          acao({ status: 'concluida', concluida_em: '2026-09-10T10:00:00Z' }),
          acao({ status: 'concluida', concluida_em: '2026-09-10T10:00:00Z' }),
          ...Array.from({ length: 8 }, () => acao({ status: 'cancelada' })),
        ],
      }),
    );
    assert.equal(r.conclusaoPct, 20);
  });

  it('não divide por zero em plano sem ação', () => {
    const r = resumir(dados({ acoes: [] }));
    assert.equal(r.conclusaoPct, null);
    assert.equal(r.total, 0);
  });

  it('dias sem movimento é nulo quando nada foi marcado', () => {
    assert.equal(resumir(dados({ ultimoMovimento: null })).diasSemMovimento, null);
    assert.equal(resumir(dados({ ultimoMovimento: '2026-09-21T08:00:00Z' })).diasSemMovimento, 10);
  });

  /**
   * Alavanca concluída já teve efeito, e esse efeito já está no ciclo
   * medido dos lançamentos. Somar as duas contaria o mesmo ganho duas
   * vezes — é a mesma regra anotada no SQL 47.
   */
  it('soma o ganho em dias só das alavancas ainda abertas', () => {
    const r = resumir(
      dados({
        acoes: [
          acao({ ganho_dias: 5 }),
          acao({ ganho_dias: 2.5 }),
          acao({ ganho_dias: 10, status: 'concluida', concluida_em: '2026-09-10T10:00:00Z' }),
          acao(),
        ],
      }),
    );
    assert.equal(r.ganhoDiasEmAberto, 7.5);
  });
});

describe('a ordem das ações', () => {
  /**
   * A resposta vai dizer "a ação 3" e o cliente vai contar na tela. Se as
   * duas ordens divergirem, cada referência vira uma pequena mentira.
   */
  it('abertas primeiro, por prazo, e fechadas depois', () => {
    const o = ordenar([
      acao({ titulo: 'C', status: 'concluida', prazo: '2026-09-01', concluida_em: '2026-09-01T10:00:00Z' }),
      acao({ titulo: 'B', prazo: '2026-11-01' }),
      acao({ titulo: 'A', prazo: '2026-10-05' }),
      acao({ titulo: 'D', status: 'cancelada', prazo: '2026-08-01' }),
    ]);
    assert.deepEqual(o.map((a) => a.titulo), ['A', 'B', 'C', 'D']);
  });

  it('não altera o array recebido', () => {
    const original = [acao({ titulo: 'B', prazo: '2026-11-01' }), acao({ titulo: 'A', prazo: '2026-10-01' })];
    ordenar(original);
    assert.equal(original[0]?.titulo, 'B');
  });
});

describe('o texto do contexto', () => {
  it('traz o nome da empresa, o plano e a data de hoje', () => {
    const t = montarContexto(dados());
    assert.match(t, /Padaria do Centro/);
    assert.match(t, /1º ciclo/);
    assert.match(t, /Hoje é 01\/10\/2026/);
  });

  /**
   * Campo vazio vira "não informado" em vez de desaparecer. Contexto onde
   * a causa-raiz simplesmente não está faz o modelo inferir uma; contexto
   * que diz que não foi informada faz ele dizer que não está no plano.
   */
  it('declara o campo ausente em vez de omitir', () => {
    const t = montarContexto(dados({ acoes: [acao({ causa_raiz: null, pilar: '  ', detalhe: '' })] }));
    assert.match(t, /Causa-raiz: não informada/);
    assert.match(t, /Pilar: não informado/);
    assert.match(t, /Detalhe combinado: não informado/);
  });

  /**
   * O uuid fica fora de propósito: o modelo não precisa dele para
   * responder, e um identificador no contexto convida a resposta a
   * citá-lo — número que o cliente não reconhece em tela nenhuma.
   */
  it('não vaza identificador interno', () => {
    const t = montarContexto(dados());
    assert.doesNotMatch(t, /[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });

  it('numera as ações a partir de 1', () => {
    const t = montarContexto(dados({ acoes: [acao({ titulo: 'Primeira' }), acao({ titulo: 'Segunda', prazo: '2026-11-01' })] }));
    assert.match(t, /### Ação 1: Primeira/);
    assert.match(t, /### Ação 2: Segunda/);
  });

  it('diz com palavras que o plano está sem ações', () => {
    const t = montarContexto(dados({ acoes: [] }));
    assert.match(t, /ainda não tem ações cadastradas/);
  });

  /**
   * O diagnóstico do relatório é o que responde "por que isso é
   * prioridade?". Precisa vir antes das ações: depois delas, o mesmo
   * texto é lido como apêndice.
   */
  it('põe o diagnóstico antes das ações', () => {
    const t = montarContexto(
      dados({
        plano: {
          titulo: '1º ciclo',
          created_at: '2026-09-01T10:00:00Z',
          contexto: 'O ciclo financeiro de 47 dias é o gargalo: o estoque responde por 31 deles.',
        },
      }),
    );
    assert.match(t, /DIAGNÓSTICO QUE ORIGINOU ESTE PLANO/);
    assert.match(t, /ciclo financeiro de 47 dias/);
    assert.ok(
      t.indexOf('DIAGNÓSTICO QUE ORIGINOU') < t.indexOf('## AS AÇÕES'),
      'o diagnóstico tem de vir antes das ações',
    );
  });

  /**
   * Plano sem contexto é o caso normal — todos os que já existem. A seção
   * não pode aparecer vazia, nem com um "não informado": cabeçalho sem
   * conteúdo gasta tokens em toda pergunta e sugere ao modelo que havia
   * um diagnóstico que ele não recebeu.
   */
  it('omite a seção inteira quando não há diagnóstico', () => {
    assert.doesNotMatch(montarContexto(dados()), /DIAGNÓSTICO QUE ORIGINOU/);
    assert.doesNotMatch(
      montarContexto(dados({ plano: { titulo: 'x', created_at: '2026-09-01T10:00:00Z', contexto: '   ' } })),
      /DIAGNÓSTICO QUE ORIGINOU/,
    );
  });

  it('não inventa seção de alavanca quando não há ganho em dias', () => {
    assert.doesNotMatch(montarContexto(dados()), /Alavanca de ciclo/);
    assert.match(montarContexto(dados({ acoes: [acao({ ganho_dias: 4 })] })), /reduz 4 dia/);
  });
});
