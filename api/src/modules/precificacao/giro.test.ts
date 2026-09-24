/**
 * Testes da necessidade de capital de giro.
 *
 * O caso que mais importa é o do ciclo negativo. É contraintuitivo — a
 * conta devolve NCG negativa, e negativo aqui significa que a operação
 * se financia sozinha, a melhor posição possível. Quem lê a fórmula sem
 * conhecer o conceito tende a "corrigir" isso para zero, e o teste
 * existe para impedir.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calcularGiro, type EntradaGiro } from './giro.js';
import { calcularCiclo } from './ciclo.js';

/** Comércio comum: recebe em 45, paga em 20, gira estoque em 30. */
const base: EntradaGiro = {
  // Receita de 150.000 dá venda diária de 5.000, contra desembolso de
  // 4.000. Os dois números são diferentes DE PROPÓSITO: se fossem
  // iguais, os testes abaixo passariam mesmo com a régua trocada.
  receitaMensal: 150_000,
  despesasFixasMensais: 60_000,
  custosVariaveisMensais: 60_000,
  pmrDias: 45,
  pmpDias: 20,
  pmeDias: 30,
};

describe('o ciclo e o desembolso', () => {
  it('ciclo é estoque mais recebimento menos pagamento', () => {
    const r = calcularGiro(base);
    assert.equal(r.cicloFinanceiroDias, 55); // 30 + 45 − 20
  });

  it('desembolso diário é o custo mensal dividido por 30', () => {
    const r = calcularGiro(base);
    assert.equal(r.desembolsoDiario, 4_000); // 120.000 / 30
  });

  it('venda diária é a receita dividida por 30', () => {
    const r = calcularGiro(base);
    assert.equal(r.vendaDiaria, 5_000); // 150.000 / 30
  });

  it('sem receita, não há como converter dias em reais', () => {
    const r = calcularGiro({ ...base, receitaMensal: 0 });
    assert.equal(r.erro !== null, true);
    assert.match(r.erro!, /receita do último mês fechado/);
  });

  it('sem custo informado, não calcula', () => {
    const r = calcularGiro({ ...base, despesasFixasMensais: 0, custosVariaveisMensais: 0 });
    assert.equal(r.erro !== null, true);
    assert.match(r.erro!, /custos fixos e variáveis/);
  });

  it('prazo negativo é recusado', () => {
    const r = calcularGiro({ ...base, pmrDias: -10 });
    assert.match(r.erro ?? '', /não podem ser negativos/);
  });
});

describe('NCG estrutural', () => {
  it('é o ciclo vezes a VENDA diária, não o desembolso', () => {
    const r = calcularGiro(base);
    assert.equal(r.ncgEstrutural, 275_000); // 55 × 5.000
    // A régua antiga daria 220.000. O teste falha se alguém voltar a ela.
    assert.notEqual(r.ncgEstrutural, 55 * r.desembolsoDiario);
  });

  it('cada dia de ciclo vale uma venda diária', () => {
    const r = calcularGiro(base);
    assert.equal(r.valorDeUmDiaDeCiclo, r.vendaDiaria);
    assert.equal(r.valorDeUmDiaDeCiclo, 5_000);

    // A conferência que dá sentido ao número: cortar 5 dias do PMR tem
    // de reduzir a NCG em exatamente 5 × valorDeUmDiaDeCiclo.
    const cortado = calcularGiro({ ...base, pmrDias: 40 });
    assert.equal(r.ncgEstrutural - cortado.ncgEstrutural, 5 * r.valorDeUmDiaDeCiclo);
  });

  /**
   * O acordo entre as duas telas, que é o motivo da mudança de
   * 24/09/2026. `ciclo.ts` define valorDeUmDia como receita ÷ 30; aqui
   * tem de ser o mesmo número, senão o cliente vê duas respostas para a
   * mesma pergunta e para de confiar nas duas.
   */
  it('o valor de um dia é o mesmo da tela de Ciclo Financeiro', () => {
    const r = calcularGiro(base);
    const c = calcularCiclo({
      receitaMensal: base.receitaMensal,
      estoque: 60_000,
      aReceber: 250_000,
      aPagar: 90_000,
    });
    assert.equal(r.valorDeUmDiaDeCiclo, c.valorDeUmDia);
  });

  it('sem estoque, a conta continua válida — é o caso de serviço', () => {
    const r = calcularGiro({ ...base, pmeDias: 0 });
    assert.equal(r.cicloFinanceiroDias, 25);
    assert.equal(r.ncgEstrutural, 125_000); // 25 × 5.000
  });

  /**
   * Ciclo negativo: recebe à vista e paga o fornecedor em 30 dias. É o
   * modelo de supermercado, e a NCG negativa significa que o fornecedor
   * financia a operação. Não é erro, é a melhor posição possível.
   */
  it('ciclo negativo devolve NCG negativa, e isso é bom', () => {
    const r = calcularGiro({ ...base, pmrDias: 0, pmeDias: 0, pmpDias: 30 });
    assert.equal(r.cicloFinanceiroDias, -30);
    assert.equal(r.ncgEstrutural, -150_000); // −30 × 5.000
    assert.equal(r.alertas.some((a) => /se financia sozinha/.test(a)), true);
  });
});

describe('NCG realizada', () => {
  const comDados = { ...base, contasAReceber: 250_000, contasAPagar: 90_000, estoque: 60_000 };

  it('é a receber mais estoque menos a pagar', () => {
    const r = calcularGiro(comDados);
    assert.equal(r.ncgRealizada, 220_000);
  });

  it('sem nenhum dado em aberto, não inventa zero', () => {
    // Nulo é "não sei"; zero seria "não há necessidade". A diferença
    // decide se a tela mostra um número ou um traço.
    const r = calcularGiro(base);
    assert.equal(r.ncgRealizada, null);
    assert.equal(r.descolamento, null);
  });

  it('acima da estrutural em mais de 30% vira alerta de pico', () => {
    const r = calcularGiro({ ...comDados, contasAReceber: 400_000 });
    assert.ok(r.descolamento! > 0);
    assert.equal(r.alertas.some((a) => /costuma ser pico/.test(a)), true);
  });

  it('abaixo da estrutural avisa que o alívio não é o normal', () => {
    const r = calcularGiro({ ...comDados, contasAReceber: 80_000 });
    assert.ok(r.descolamento! < 0);
    assert.equal(r.alertas.some((a) => /alívio não é o normal/.test(a)), true);
  });

  it('descolamento pequeno não gera ruído', () => {
    // 275.000 estrutural contra 230.000 realizada: 16,4% de desvio.
    const r = calcularGiro({ ...comDados, contasAReceber: 260_000 });
    assert.equal(r.alertas.some((a) => /pico|alívio/.test(a)), false);
  });
});

describe('folga de caixa', () => {
  it('caixa acima da NCG é folga positiva', () => {
    const r = calcularGiro({ ...base, caixaDisponivel: 300_000 });
    assert.equal(r.folga, 25_000); // 300.000 − 275.000
    // A cobertura segue o DESEMBOLSO, não a venda: ela responde quantos
    // dias o caixa aguenta pagando as contas, e não quantos dias de
    // ciclo ele cobre. 300.000 ÷ 4.000 = 75.
    assert.equal(r.coberturaDias, 75);
  });

  it('caixa abaixo da NCG diz quanto falta, e quem está financiando', () => {
    const r = calcularGiro({ ...base, caixaDisponivel: 150_000 });
    assert.equal(r.folga, -125_000); // 150.000 − 275.000
    assert.equal(r.alertas.some((a) => /está sendo financiada por alguém/.test(a)), true);
  });

  it('cobertura curta vira alerta próprio', () => {
    const r = calcularGiro({ ...base, caixaDisponivel: 40_000 });
    assert.equal(r.coberturaDias, 10);
    assert.equal(r.alertas.some((a) => /cobre 10 dias/.test(a)), true);
  });

  it('sem caixa informado, não há folga a calcular', () => {
    const r = calcularGiro(base);
    assert.equal(r.folga, null);
    assert.equal(r.coberturaDias, null);
  });

  it('caixa zero é informação, não ausência', () => {
    const r = calcularGiro({ ...base, caixaDisponivel: 0 });
    assert.equal(r.folga, -275_000);
    assert.equal(r.coberturaDias, 0);
  });

  /**
   * O defeito de 16/09: com NCG negativa, `caixa − (−50)` dava folga de
   * 50 num caixa zerado, e a tela mostrava "R$ 50 de folga" ao lado de
   * "cobre 0 dias de operação". Necessidade negativa quer dizer que a
   * operação não precisa de capital — não que ela devolva capital.
   */
  it('NCG negativa não vira folga inventada', () => {
    const r = calcularGiro({
      ...base,
      pmrDias: 0,
      pmeDias: 0,
      pmpDias: 30,
      caixaDisponivel: 0,
    });

    assert.ok(r.ncgEstrutural < 0);
    assert.equal(r.folga, 0, 'Caixa zerado não tem folga, ainda que a NCG seja negativa');
    assert.equal(r.coberturaDias, 0);
  });

  it('com NCG negativa, a folga é o próprio caixa', () => {
    const r = calcularGiro({
      ...base,
      pmrDias: 0,
      pmeDias: 0,
      pmpDias: 30,
      caixaDisponivel: 90_000,
    });
    assert.equal(r.folga, 90_000);
  });
});
