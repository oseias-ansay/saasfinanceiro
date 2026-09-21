/**
 * Testes da hora produtiva.
 *
 * A aula 3.4 não traz um exemplo numérico fechado como as outras, então
 * os testes partem de uma equipe redonda e verificam as relações que a
 * aula afirma — principalmente que a hora real custa bem mais que a
 * contratada, e por quê.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calcularHoraProdutiva, type EntradaHoraProdutiva } from './horaprodutiva.js';

/** Equipe de quatro pessoas, folha de R$ 24.000. */
const equipe: EntradaHoraProdutiva = {
  folhaMensal: 24_000,
  pessoas: 4,
  horasContratadas: 220,
  horasFerias: 18,
  horasFeriados: 10,
  horasFaltas: 8,
  ocupacaoPct: 70,
  servicoNome: 'Visita técnica de orçamento',
  servicoHoras: 2,
  servicoPorMes: 12,
};

describe('a cadeia da conta', () => {
  it('o custo por pessoa é a folha dividida pelas pessoas', () => {
    assert.equal(calcularHoraProdutiva(equipe).custoPorPessoa, 6_000);
  });

  it('a hora contratada é o número fácil — e errado', () => {
    // 6.000 ÷ 220
    assert.equal(calcularHoraProdutiva(equipe).custoHoraContratada, 27.27);
  });

  it('as horas perdidas somam férias, feriados e faltas', () => {
    assert.equal(calcularHoraProdutiva(equipe).horasPerdidas, 36);
  });

  it('as disponíveis descontam as perdidas', () => {
    assert.equal(calcularHoraProdutiva(equipe).horasDisponiveis, 184);
  });

  it('as produtivas aplicam a ocupação sobre as disponíveis', () => {
    // 184 × 70%
    assert.equal(calcularHoraProdutiva(equipe).horasProdutivas, 128.8);
  });

  it('a hora produtiva é o custo da pessoa sobre as horas produtivas', () => {
    // 6.000 ÷ 128,8
    assert.equal(calcularHoraProdutiva(equipe).custoHoraProdutiva, 46.58);
  });
});

/**
 * O ponto da aula, em números: a hora real custa 70% a mais que a
 * contratada nesta equipe. Todo orçamento feito pela contratada erra
 * por essa margem, e erra para baixo.
 */
describe('a hora real custa muito mais que a contratada', () => {
  it('a diferença é declarada em percentual', () => {
    const r = calcularHoraProdutiva(equipe);
    assert.equal(r.diferencaPct, 70.81);
    assert.ok(r.custoHoraProdutiva! > r.custoHoraContratada!);
  });

  it('a tela diz que o erro é para baixo', () => {
    const r = calcularHoraProdutiva(equipe);
    assert.equal(r.alertas.some((a) => /erra para baixo/.test(a)), true);
  });

  it('sem horas perdidas e com 100% de ocupação, as duas se igualam', () => {
    const r = calcularHoraProdutiva({
      ...equipe,
      horasFerias: 0,
      horasFeriados: 0,
      horasFaltas: 0,
      ocupacaoPct: 100,
    });
    assert.equal(r.custoHoraProdutiva, r.custoHoraContratada);
    assert.equal(r.diferencaPct, 0);
  });

  it('ocupação menor encarece a hora, na proporção inversa', () => {
    const cheia = calcularHoraProdutiva({ ...equipe, ocupacaoPct: 80 });
    const vazia = calcularHoraProdutiva({ ...equipe, ocupacaoPct: 40 });
    assert.ok(vazia.custoHoraProdutiva! > cheia.custoHoraProdutiva! * 1.9);
  });
});

describe('o serviço que se faz de graça', () => {
  it('custa a hora produtiva vezes as horas gastas', () => {
    // 46,58 × 2
    assert.equal(calcularHoraProdutiva(equipe).custoDoServicoGratis, 93.16);
  });

  it('no ano, multiplica pelas vezes por mês e por doze', () => {
    // 93,16 × 12 × 12
    assert.equal(calcularHoraProdutiva(equipe).custoAnualDoServicoGratis, 13_415.04);
  });

  it('o alerta usa o nome que o usuário deu', () => {
    const r = calcularHoraProdutiva(equipe);
    assert.equal(r.alertas.some((a) => /Visita técnica de orçamento custa/.test(a)), true);
  });

  it('sem o serviço informado, a seção some e o resto fica', () => {
    const r = calcularHoraProdutiva({ ...equipe, servicoHoras: null, servicoPorMes: null });
    assert.equal(r.custoDoServicoGratis, null);
    assert.equal(r.custoAnualDoServicoGratis, null);
    assert.equal(r.custoHoraProdutiva, 46.58);
  });
});

describe('os testes de sanidade', () => {
  it('avisa quando mais de um quinto das horas se perde', () => {
    const r = calcularHoraProdutiva({ ...equipe, horasFaltas: 40 });
    assert.equal(r.alertas.some((a) => /mais de um quinto/.test(a)), true);
  });

  it('não avisa num absenteísmo normal', () => {
    const r = calcularHoraProdutiva(equipe); // 36 de 220 = 16%
    assert.equal(r.alertas.some((a) => /mais de um quinto/.test(a)), false);
  });

  /**
   * Chutar a ocupação para cima é a forma mais comum de fazer a hora
   * parecer barata — e o orçamento, competitivo no papel.
   */
  it('desconfia de ocupação acima de 85%', () => {
    const r = calcularHoraProdutiva({ ...equipe, ocupacaoPct: 95 });
    assert.equal(r.alertas.some((a) => /alta demais para ser real/.test(a)), true);
  });

  it('aceita 70% sem comentário', () => {
    const r = calcularHoraProdutiva(equipe);
    assert.equal(r.alertas.some((a) => /alta demais para ser real/.test(a)), false);
  });
});

describe('bordas', () => {
  it('sem folha, a conta não existe', () => {
    const r = calcularHoraProdutiva({ ...equipe, folhaMensal: 0 });
    assert.equal(r.erro !== null, true);
    assert.match(r.erro!, /folha do mês/);
  });

  it('sem pessoas, também não', () => {
    assert.equal(calcularHoraProdutiva({ ...equipe, pessoas: 0 }).erro !== null, true);
  });

  it('ocupação zero ou acima de 100 é recusada', () => {
    assert.equal(calcularHoraProdutiva({ ...equipe, ocupacaoPct: 0 }).erro !== null, true);
    assert.equal(calcularHoraProdutiva({ ...equipe, ocupacaoPct: 101 }).erro !== null, true);
  });

  it('horas perdidas maiores que as contratadas viram erro explicado', () => {
    const r = calcularHoraProdutiva({ ...equipe, horasFerias: 300 });
    assert.equal(r.erro !== null, true);
    assert.match(r.erro!, /mês errado/);
  });

  it('uma pessoa só funciona — é o autônomo', () => {
    const r = calcularHoraProdutiva({ ...equipe, pessoas: 1, folhaMensal: 6_000 });
    assert.equal(r.custoPorPessoa, 6_000);
    assert.equal(r.custoHoraProdutiva, 46.58);
  });
});
