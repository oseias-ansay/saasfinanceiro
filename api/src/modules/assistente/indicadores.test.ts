/**
 * Testes dos indicadores econômicos.
 *
 * O que estes testes protegem é a leitura do formato do Banco Central e,
 * principalmente, a presença da DATA DE REFERÊNCIA em toda resposta.
 *
 * O caso que motiva isso é real e foi visto na primeira consulta, em
 * 05/10/2026: o IPCA mais recente publicado era o de AGOSTO. Responder
 * "o IPCA é -0,32%" em outubro, sem dizer o mês, faz o cliente entender
 * que é o número corrente — e ele usa isso num reajuste de contrato.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CODIGOS,
  dataBCB,
  lerRespostaBCB,
  numeroBCB,
  resumirIndicadores,
  SERIES,
  VALIDADE_DIAS,
  type Indicador,
} from './indicadores.js';

const HOJE = new Date('2026-10-05T12:00:00Z');

const ind = (p: Partial<Indicador> = {}): Indicador => ({
  codigo: 'ipca',
  nome: 'IPCA (variação mensal)',
  referencia: '2026-09-01',
  valor: 0.44,
  unidade: '%',
  fonte: 'Banco Central do Brasil (SGS)',
  coletado_em: '2026-10-05T10:00:00Z',
  ...p,
});

describe('a leitura do formato do BCB', () => {
  it('lê número com vírgula decimal e separador de milhar', () => {
    assert.equal(numeroBCB('0,44'), 0.44);
    assert.equal(numeroBCB('5.432,10'), 5432.1);
    assert.equal(numeroBCB('-0.32'), -0.32);
    assert.equal(numeroBCB(15), 15);
  });

  it('recusa o que não é número', () => {
    for (const v of ['', 'n/d', null, undefined, {}, NaN]) {
      assert.equal(numeroBCB(v), null, `deveria recusar: ${JSON.stringify(v)}`);
    }
  });

  it('converte a data brasileira para ISO', () => {
    assert.equal(dataBCB('01/08/2026'), '2026-08-01');
    assert.equal(dataBCB('31/12/2026'), '2026-12-31');
  });

  it('recusa data inválida ou em outro formato', () => {
    for (const v of ['2026-08-01', '1/8/2026', '31/02/2026', '', null]) {
      assert.equal(dataBCB(v), null, `deveria recusar: ${JSON.stringify(v)}`);
    }
  });

  /** Resposta real do SGS, série 433, em 05/10/2026. */
  it('lê a resposta real da série do IPCA', () => {
    const r = lerRespostaBCB([{ data: '01/08/2026', valor: '-0.32' }]);
    assert.deepEqual(r, { referencia: '2026-08-01', valor: -0.32 });
  });

  it('pega o mais recente quando vêm vários', () => {
    const r = lerRespostaBCB([
      { data: '01/07/2026', valor: '0.10' },
      { data: '01/08/2026', valor: '-0.32' },
    ]);
    assert.equal(r?.referencia, '2026-08-01');
  });

  /**
   * Devolve nulo em vez de lançar: a coleta roda sozinha, de seis em seis
   * horas, sem ninguém olhando. Exceção numa rotina dessas vira log que
   * ninguém lê; nulo vira contador de falha, que aparece na tabela.
   */
  it('devolve nulo em formato inesperado, sem lançar', () => {
    for (const v of [null, [], {}, 'texto', [{}], [{ data: 'x', valor: 'y' }]]) {
      assert.equal(lerRespostaBCB(v), null, `deveria recusar: ${JSON.stringify(v)}`);
    }
  });
});

describe('o texto que vai ao modelo', () => {
  /**
   * A regra que governa este arquivo. Em 05/10/2026 o IPCA publicado era
   * o de agosto — dois meses de defasagem.
   */
  it('todo indicador mensal declara o mês de referência', () => {
    const t = resumirIndicadores([ind({ referencia: '2026-08-01', valor: -0.32 })], HOJE);
    assert.match(t, /agosto\/2026/);
    assert.match(t, /-0,32%/);
  });

  it('indicador diário declara a data', () => {
    const t = resumirIndicadores(
      [ind({ codigo: 'selic', nome: 'Selic meta', referencia: '2026-10-03', valor: 11.25, unidade: '% a.a.' })],
      HOJE,
    );
    assert.match(t, /03\/10\/2026/);
    assert.match(t, /11,25/);
  });

  /** A PTAX é publicada com quatro casas. Arredondar para duas mudaria o
   *  número que o cliente confere no contrato dele. */
  it('câmbio sai com quatro casas', () => {
    const t = resumirIndicadores(
      [ind({ codigo: 'dolar', nome: 'Dólar (PTAX venda)', valor: 5.4321, unidade: 'R$', referencia: '2026-10-03' })],
      HOJE,
    );
    assert.match(t, /R\$ 5,4321/);
  });

  /**
   * A validade é por tipo, e a diferença importa: IPCA de 40 dias é o
   * número corrente; dólar de 40 dias é inútil. Um limite único faria o
   * assistente alarmar sobre o IPCA todo mês ou calar sobre câmbio velho.
   */
  it('avisa quando a leitura está velha para aquele tipo', () => {
    const velho = resumirIndicadores(
      [ind({ codigo: 'dolar', nome: 'Dólar', unidade: 'R$', referencia: '2026-09-20' })],
      HOJE,
    );
    assert.match(velho, /pode estar desatualizada/);

    // Mesma distância, indicador mensal: normal, não avisa.
    const normal = resumirIndicadores([ind({ referencia: '2026-09-20' })], HOJE);
    assert.doesNotMatch(normal, /pode estar desatualizada/);
  });

  it('manda informar a referência, e nomeia a fonte', () => {
    const t = resumirIndicadores([ind()], HOJE);
    assert.match(t, /Banco Central do Brasil/);
    assert.match(t, /informe a data de referência/i);
  });

  /** Sem coleta, o assistente diz que não tem — e é mandado a não
   *  estimar, porque a Selic que ele "sabe" é a da época do treino. */
  it('lista vazia manda não estimar', () => {
    const t = resumirIndicadores([], HOJE);
    assert.match(t, /não estime/i);
    assert.doesNotMatch(t, /\d+,\d+%/);
  });
});

describe('o catálogo de séries', () => {
  it('toda série tem validade definida', () => {
    for (const c of CODIGOS) {
      assert.ok(VALIDADE_DIAS[c] > 0, `${c} está sem validade`);
    }
  });

  it('indicador mensal tem validade maior que a de câmbio', () => {
    assert.ok(VALIDADE_DIAS.ipca > VALIDADE_DIAS.dolar);
    assert.ok(SERIES.ipca.mensal);
    assert.ok(!SERIES.dolar.mensal);
  });
});
