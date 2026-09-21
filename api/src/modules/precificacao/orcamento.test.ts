/**
 * Testes do orçamento anual.
 *
 * O primeiro grupo reproduz o exemplo da planilha da Aula 4.6 — a loja
 * das aulas, com pessimista de R$ 162.750, realista de R$ 188.034 e
 * otimista de R$ 209.508.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calcularOrcamento, type EntradaOrcamento } from './orcamento.js';

const MARGEM = 29.41;

/** A loja das aulas. */
const loja: EntradaOrcamento = {
  pessimista: { atendimentos: 1_750, conversaoPct: 62, ticket: 150, margemPct: MARGEM },
  realista: { atendimentos: 1_850, conversaoPct: 66, ticket: 154, margemPct: MARGEM },
  otimista: { atendimentos: 1_950, conversaoPct: 68, ticket: 158, margemPct: MARGEM },
  custoFixoMensal: 40_000,
};

const porNome = (r: ReturnType<typeof calcularOrcamento>, nome: string) =>
  r.cenarios.find((c) => c.nome === nome)!;

describe('o exemplo da planilha', () => {
  it('o pessimista fatura 162.750', () => {
    // 1750 × 0,62 × 150
    assert.equal(porNome(calcularOrcamento(loja), 'pessimista').faturamentoMensal, 162_750);
  });

  it('o realista fatura 188.034', () => {
    // 1850 × 0,66 × 154
    assert.equal(porNome(calcularOrcamento(loja), 'realista').faturamentoMensal, 188_034);
  });

  it('o otimista fatura 209.508', () => {
    // 1950 × 0,68 × 158
    assert.equal(porNome(calcularOrcamento(loja), 'otimista').faturamentoMensal, 209_508);
  });

  it('o faturamento do ano é doze vezes o do mês', () => {
    const r = porNome(calcularOrcamento(loja), 'realista');
    assert.equal(r.faturamentoAnual, 188_034 * 12);
  });
});

/**
 * Custo fixo que cresce com a receita não é custo fixo.
 *
 * Se crescesse, o otimista nunca daria lucro e o pessimista sempre
 * daria — o oposto do que o orçamento serve para mostrar.
 */
describe('o custo fixo é o mesmo nos três', () => {
  it('os três descontam o mesmo valor', () => {
    const r = calcularOrcamento(loja);
    for (const c of r.cenarios) {
      assert.equal(r2(c.margemContribuicao - c.lucroMensal), 40_000);
    }
  });

  it('o lucro cresce mais rápido que o faturamento', () => {
    const r = calcularOrcamento(loja);
    const p = porNome(r, 'pessimista');
    const o = porNome(r, 'otimista');

    const crescimentoFaturamento = o.faturamentoMensal / p.faturamentoMensal - 1;
    const crescimentoLucro = o.lucroMensal / p.lucroMensal - 1;

    // É a alavancagem operacional: o fixo já está pago.
    assert.ok(crescimentoLucro > crescimentoFaturamento);
  });
});

const r2 = (n: number) => Math.round(n * 100) / 100;

describe('a pergunta que o orçamento existe para responder', () => {
  it('com custo baixo, o pessimista dá lucro e a tela comemora', () => {
    const r = calcularOrcamento(loja);
    assert.equal(r.pessimistaDaLucro, true);
    assert.equal(r.alertas.some((a) => /estruturalmente seguro/.test(a)), true);
  });

  it('com custo alto, o pessimista não dá — e diz quanto falta', () => {
    const r = calcularOrcamento({ ...loja, custoFixoMensal: 55_000 });
    assert.equal(r.pessimistaDaLucro, false);
    assert.equal(r.alertas.some((a) => /NÃO dá lucro/.test(a)), true);
    assert.equal(r.alertas.some((a) => /mês ruim que acontece todo ano/.test(a)), true);
  });

  it('o ponto de equilíbrio aparece no alerta do pessimista', () => {
    const r = calcularOrcamento({ ...loja, custoFixoMensal: 55_000 });
    const p = porNome(r, 'pessimista');
    // 55.000 ÷ 29,41% = 187.011,22
    assert.equal(p.pontoEquilibrio, 187_011.22);
    assert.ok(p.pontoEquilibrio! > p.faturamentoMensal);
  });
});

describe('a coerência entre os cenários', () => {
  it('aponta quando pessimista e otimista estão trocados', () => {
    const r = calcularOrcamento({
      ...loja,
      pessimista: { ...loja.otimista },
      otimista: { ...loja.pessimista },
    });
    assert.equal(r.alertas.some((a) => /estão trocados/.test(a)), true);
  });

  it('aponta cenários colados demais', () => {
    const quase: EntradaOrcamento = {
      ...loja,
      pessimista: { atendimentos: 1_840, conversaoPct: 66, ticket: 154, margemPct: MARGEM },
      otimista: { atendimentos: 1_860, conversaoPct: 66, ticket: 154, margemPct: MARGEM },
    };
    assert.equal(
      calcularOrcamento(quase).alertas.some((a) => /não testam nada/.test(a)),
      true,
    );
  });

  it('não reclama de cenários bem afastados', () => {
    assert.equal(
      calcularOrcamento(loja).alertas.some((a) => /não testam nada/.test(a)),
      false,
    );
  });
});

/**
 * Dizer QUAL variável carrega o otimismo é o que transforma o orçamento
 * em plano de ação: atendimento é marketing, conversão é vendas,
 * ticket é mix e preço.
 */
describe('onde mora o otimismo', () => {
  it('aponta o ticket quando é ele que mais cresce', () => {
    const r = calcularOrcamento({
      ...loja,
      pessimista: { atendimentos: 1_800, conversaoPct: 60, ticket: 100, margemPct: MARGEM },
      otimista: { atendimentos: 1_800, conversaoPct: 60, ticket: 200, margemPct: MARGEM },
    });
    assert.equal(r.alertas.some((a) => /concentrado em ticket/.test(a)), true);
  });

  it('aponta a conversão quando é ela', () => {
    const r = calcularOrcamento({
      ...loja,
      pessimista: { atendimentos: 1_800, conversaoPct: 30, ticket: 150, margemPct: MARGEM },
      otimista: { atendimentos: 1_800, conversaoPct: 60, ticket: 150, margemPct: MARGEM },
    });
    assert.equal(r.alertas.some((a) => /concentrado em conversão/.test(a)), true);
  });
});

describe('o teto de despesa', () => {
  const comTetos: EntradaOrcamento = {
    ...loja,
    tetos: [
      { categoriaId: 'a', nome: 'Ocupação', gastoAtual: 9_480, tetoPct: 5 },
      { categoriaId: 'b', nome: 'Pessoal', gastoAtual: 23_560, tetoPct: 15 },
      { categoriaId: 'c', nome: 'Comercial', gastoAtual: 620, tetoPct: null },
    ],
  };

  it('o teto sai da receita do realista, não de cada cenário', () => {
    const r = calcularOrcamento(comTetos);
    const ocupacao = r.tetos.find((t) => t.nome === 'Ocupação')!;
    // 5% de 188.034
    assert.equal(ocupacao.tetoValor, 9_401.7);
  });

  it('a folga é o teto menos o gasto de hoje', () => {
    const r = calcularOrcamento(comTetos);
    const ocupacao = r.tetos.find((t) => t.nome === 'Ocupação')!;
    assert.equal(ocupacao.folga, r2(9_401.7 - 9_480)); // negativa: estourou
    assert.ok(ocupacao.folga! < 0);
  });

  it('grupo sem teto definido não inventa limite', () => {
    const r = calcularOrcamento(comTetos);
    const comercial = r.tetos.find((t) => t.nome === 'Comercial')!;
    assert.equal(comercial.tetoValor, null);
    assert.equal(comercial.folga, null);
  });

  it('o total de gasto soma todos, com teto ou sem', () => {
    const r = calcularOrcamento(comTetos);
    assert.equal(r.totalGastoAtual, 9_480 + 23_560 + 620);
  });

  it('avisa quais grupos estouraram, e quanto custa no ano', () => {
    const r = calcularOrcamento(comTetos);
    assert.equal(r.alertas.some((a) => /Um grupo já passou/.test(a)), true);
    assert.equal(r.alertas.some((a) => /Ocupação/.test(a)), true);
  });

  it('sem teto nenhum definido, a seção fica vazia e nada quebra', () => {
    const r = calcularOrcamento(loja);
    assert.deepEqual(r.tetos, []);
    assert.equal(r.totalTeto, null);
    assert.equal(r.erro, null);
  });
});

describe('bordas', () => {
  it('nenhum cenário preenchido é erro, não três colunas de zero', () => {
    const vazio: EntradaOrcamento = {
      pessimista: { atendimentos: 0, conversaoPct: 0, ticket: 0, margemPct: 0 },
      realista: { atendimentos: 0, conversaoPct: 0, ticket: 0, margemPct: 0 },
      otimista: { atendimentos: 0, conversaoPct: 0, ticket: 0, margemPct: 0 },
      custoFixoMensal: 40_000,
    };
    const r = calcularOrcamento(vazio);
    assert.equal(r.erro !== null, true);
    assert.match(r.erro!, /pelo menos um cenário/);
  });

  it('só o realista preenchido já calcula', () => {
    const r = calcularOrcamento({
      ...loja,
      pessimista: { atendimentos: 0, conversaoPct: 0, ticket: 0, margemPct: MARGEM },
      otimista: { atendimentos: 0, conversaoPct: 0, ticket: 0, margemPct: MARGEM },
    });
    assert.equal(r.erro, null);
    assert.equal(porNome(r, 'realista').faturamentoMensal, 188_034);
    // Sem pessimista preenchido, a pergunta central não tem resposta.
    assert.equal(r.pessimistaDaLucro, null);
  });

  it('conversão acima de 100% é recusada', () => {
    const r = calcularOrcamento({
      ...loja,
      realista: { ...loja.realista, conversaoPct: 120 },
    });
    assert.equal(r.erro !== null, true);
    assert.match(r.erro!, /realista/);
  });

  it('margem zero não dá ponto de equilíbrio, e isso não é zero', () => {
    const r = calcularOrcamento({
      ...loja,
      realista: { ...loja.realista, margemPct: 0 },
    });
    assert.equal(porNome(r, 'realista').pontoEquilibrio, null);
  });

  it('sem custo fixo, todo cenário com venda dá lucro', () => {
    const r = calcularOrcamento({ ...loja, custoFixoMensal: 0 });
    assert.equal(r.pessimistaDaLucro, true);
    for (const c of r.cenarios) assert.equal(c.lucroMensal, c.margemContribuicao);
  });
});
