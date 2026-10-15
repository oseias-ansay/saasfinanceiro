/**
 * Testes do movimento diário.
 *
 * O que estes testes protegem é a separação entre VENDA e RECEBIMENTO.
 * É a regra que decide se a cobertura de caixa e o prazo médio de
 * recebimento continuam verdadeiros depois que o cliente passa a lançar
 * por aqui.
 *
 * Um formulário que facilita o lançamento e corrompe o indicador troca
 * adoção por confiança — o pior negócio possível nesta plataforma, onde
 * o indicador é o produto.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  gerarLancamentos,
  MovimentoInvalido,
  resumir,
  somarDias,
  validarMovimento,
  type FormaRecebimento,
  type MovimentoDoDia,
} from './movimento.js';

const HOJE = '2026-10-15';

const FORMAS: FormaRecebimento[] = [
  { id: 'f-dinheiro', nome: 'Dinheiro', prazo_dias: 0 },
  { id: 'f-pix', nome: 'Pix', prazo_dias: 0 },
  { id: 'f-debito', nome: 'Cartão de débito', prazo_dias: 1 },
  { id: 'f-credito', nome: 'Cartão de crédito', prazo_dias: 30 },
];

const mov = (p: Partial<MovimentoDoDia> = {}): MovimentoDoDia => ({
  data: HOJE,
  vendas: [{ forma_id: 'f-dinheiro', valor: 1000 }],
  despesas: [],
  ...p,
});

describe('a soma de dias', () => {
  it('atravessa o fim do mês e do ano', () => {
    assert.equal(somarDias('2026-10-15', 30), '2026-11-14');
    assert.equal(somarDias('2026-12-20', 30), '2027-01-19');
    assert.equal(somarDias('2026-10-15', 0), '2026-10-15');
  });

  it('acerta ano bissexto', () => {
    assert.equal(somarDias('2028-02-28', 1), '2028-02-29');
  });
});

describe('a separação entre venda e recebimento', () => {
  /**
   * O caso que justifica o módulo inteiro. Vendeu dez, recebeu três.
   * Se os sete restantes entrassem como caixa de hoje, a cobertura de
   * caixa ficaria inflada e o PMR curto demais — os dois números que
   * sustentam o diagnóstico.
   */
  it('à vista é liquidado hoje; a prazo vira conta a receber', () => {
    const l = gerarLancamentos(
      mov({
        vendas: [
          { forma_id: 'f-dinheiro', valor: 3000 },
          { forma_id: 'f-credito', valor: 7000 },
        ],
      }),
      FORMAS,
      HOJE,
    );

    const dinheiro = l.find((x) => x.description.includes('Dinheiro'))!;
    assert.equal(dinheiro.status, 'liquidado');
    assert.equal(dinheiro.due_date, HOJE);
    assert.equal(dinheiro.paid_amount, 3000);

    const credito = l.find((x) => x.description.includes('crédito'))!;
    assert.equal(credito.status, 'pendente');
    assert.equal(credito.due_date, '2026-11-14');
    assert.equal(credito.paid_date, null);
    assert.equal(credito.paid_amount, null);
  });

  /**
   * A competência é o dia da VENDA nos dois casos. É isso que faz a DRE
   * do mês mostrar o que a empresa vendeu, e não o que recebeu — a
   * diferença entre regime de competência e regime de caixa, que é
   * matéria do curso.
   */
  it('a competência é sempre o dia da venda, mesmo com prazo', () => {
    const l = gerarLancamentos(
      mov({ vendas: [{ forma_id: 'f-credito', valor: 5000 }] }),
      FORMAS,
      HOJE,
    );
    assert.equal(l[0]?.competence_date, HOJE);
    assert.notEqual(l[0]?.due_date, HOJE);
  });

  it('cada forma com valor vira um lançamento próprio', () => {
    const l = gerarLancamentos(
      mov({
        vendas: [
          { forma_id: 'f-dinheiro', valor: 100 },
          { forma_id: 'f-pix', valor: 200 },
          { forma_id: 'f-debito', valor: 300 },
        ],
      }),
      FORMAS,
      HOJE,
    );
    assert.equal(l.length, 3);
    assert.equal(new Set(l.map((x) => x.description)).size, 3);
  });

  /** Zero não é fato financeiro e encheria o extrato de linha vazia. */
  it('forma com zero não gera lançamento', () => {
    const l = gerarLancamentos(
      mov({
        vendas: [
          { forma_id: 'f-dinheiro', valor: 500 },
          { forma_id: 'f-pix', valor: 0 },
        ],
      }),
      FORMAS,
      HOJE,
    );
    assert.equal(l.length, 1);
  });
});

describe('as despesas', () => {
  it('paga entra liquidada; registrada fica pendente', () => {
    const l = gerarLancamentos(
      mov({
        vendas: [],
        despesas: [
          { descricao: 'Combustível', valor: 400, paga: true },
          { descricao: 'Fornecedor X', valor: 600, paga: false },
        ],
      }),
      FORMAS,
      HOJE,
    );

    const paga = l.find((x) => x.description === 'Combustível')!;
    assert.equal(paga.status, 'liquidado');
    assert.equal(paga.paid_amount, 400);

    const aberta = l.find((x) => x.description === 'Fornecedor X')!;
    assert.equal(aberta.status, 'pendente');
    assert.equal(aberta.paid_amount, null);
  });

  it('preserva categoria e fornecedor quando informados', () => {
    const l = gerarLancamentos(
      mov({
        vendas: [],
        despesas: [
          { descricao: 'Energia', valor: 900, paga: true, category_id: 'c1', entity_id: 'e1' },
        ],
      }),
      FORMAS,
      HOJE,
    );
    assert.equal(l[0]?.category_id, 'c1');
    assert.equal(l[0]?.entity_id, 'e1');
  });
});

describe('a validação', () => {
  /**
   * Data futura é o erro mais fácil de cometer e o mais difícil de notar
   * depois: o faturamento do mês fica maior do que foi, e o diagnóstico
   * seguinte elogia um número que não aconteceu.
   */
  it('recusa data no futuro', () => {
    assert.throws(() => validarMovimento(mov({ data: '2026-10-16' }), HOJE), MovimentoInvalido);
    // Hoje vale.
    assert.doesNotThrow(() => validarMovimento(mov(), HOJE));
  });

  it('recusa data em formato errado', () => {
    assert.throws(() => validarMovimento(mov({ data: '15/10/2026' }), HOJE), MovimentoInvalido);
  });

  it('recusa valor negativo', () => {
    assert.throws(
      () => validarMovimento(mov({ vendas: [{ forma_id: 'f-dinheiro', valor: -10 }] }), HOJE),
      MovimentoInvalido,
    );
  });

  it('recusa despesa sem descrição ou sem valor', () => {
    assert.throws(
      () => validarMovimento(mov({ despesas: [{ descricao: '  ', valor: 10, paga: true }] }), HOJE),
      MovimentoInvalido,
    );
    assert.throws(
      () => validarMovimento(mov({ despesas: [{ descricao: 'x', valor: 0, paga: true }] }), HOJE),
      MovimentoInvalido,
    );
  });

  /**
   * Dia zerado é informação — o cliente registrou que não vendeu. Dia em
   * branco é ausência, e a régua trata os dois de formas diferentes.
   */
  it('recusa movimento totalmente vazio, explicando como registrar dia sem venda', () => {
    try {
      validarMovimento(mov({ vendas: [], despesas: [] }), HOJE);
      assert.fail('deveria ter lançado');
    } catch (e) {
      assert.match((e as Error).message, /zero em alguma forma|dia zerado/i);
    }
  });

  it('recusa forma que não é da empresa', () => {
    assert.throws(
      () => gerarLancamentos(mov({ vendas: [{ forma_id: 'de-outra', valor: 10 }] }), FORMAS, HOJE),
      MovimentoInvalido,
    );
  });
});

describe('o resumo da tela', () => {
  /**
   * `vendido` e `recebido_hoje` aparecem separados de propósito: para
   * muita gente é a primeira vez que vê que vendeu dez e recebeu três, e
   * essa distinção é metade do que a consultoria tenta ensinar.
   */
  it('separa o que foi vendido do que entrou em caixa', () => {
    const r = resumir(
      mov({
        vendas: [
          { forma_id: 'f-dinheiro', valor: 3000 },
          { forma_id: 'f-credito', valor: 7000 },
        ],
        despesas: [{ descricao: 'Fornecedor', valor: 1000, paga: true }],
      }),
      FORMAS,
    );

    assert.equal(r.vendido, 10000);
    assert.equal(r.recebido_hoje, 3000);
    assert.equal(r.a_receber, 7000);
    assert.equal(r.prazo_maximo, 30);
    assert.equal(r.caixa_do_dia, 2000);
  });

  it('despesa registrada e não paga não sai do caixa do dia', () => {
    const r = resumir(
      mov({
        vendas: [{ forma_id: 'f-dinheiro', valor: 1000 }],
        despesas: [{ descricao: 'Fornecedor', valor: 400, paga: false }],
      }),
      FORMAS,
    );
    assert.equal(r.despesas, 400);
    assert.equal(r.despesas_pagas, 0);
    assert.equal(r.caixa_do_dia, 1000);
  });

  it('não quebra com formulário vazio', () => {
    const r = resumir({ data: HOJE, vendas: [], despesas: [] }, FORMAS);
    assert.equal(r.vendido, 0);
    assert.equal(r.caixa_do_dia, 0);
  });

  it('arredonda para centavos', () => {
    const r = resumir(
      { data: HOJE, vendas: [{ forma_id: 'f-dinheiro', valor: 0.1 + 0.2 }], despesas: [] },
      FORMAS,
    );
    assert.equal(r.vendido, 0.3);
  });
});
