/**
 * A varredura que impede o vazamento.
 *
 * O teste central aqui não confere formato: ele percorre a resposta
 * INTEIRA, em qualquer profundidade, procurando os campos que não podem
 * sair. É o mesmo desenho do teste que varre o catálogo do assistente
 * atrás de `tenant` — a barreira não depende de alguém lembrar dela.
 *
 * Se um dia a `soAEstrutura` passar a copiar o objeto do banco com
 * spread (`...a`), estes testes falham. É exatamente o que deve
 * acontecer: o spread é o jeito mais natural de escrever e o mais fácil
 * de vazar.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { soAEstrutura } from './estrutura.js';

/** Como as linhas chegam do banco — com tudo o que há nelas. */
const MODULOS = [
  { id: 'm1', ordem: 1, titulo: 'Organizar a casa', descricao: 'Separar PF de PJ', is_active: true },
  { id: 'm2', ordem: 2, titulo: 'O caixa', descricao: null, is_active: true },
];

const AULAS = [
  {
    id: 'a2',
    modulo_id: 'm1',
    ordem: 2,
    titulo: 'Plano de contas',
    youtube_id: 'dQw4w9WgXcQ',
    duracao_min: 11,
    anexos: [{ nome: 'Plano de Contas MPE.xls', url: 'https://exemplo/planilha.xls' }],
    is_active: true,
  },
  {
    id: 'a1',
    modulo_id: 'm1',
    ordem: 1,
    titulo: 'Por que separar PF de PJ',
    youtube_id: 'abc123XYZ',
    duracao_min: 8,
    anexos: [],
    is_active: true,
  },
  {
    id: 'a3',
    modulo_id: 'm2',
    ordem: 1,
    titulo: 'Fluxo de caixa de 12 semanas',
    youtube_id: null, // ainda em produção
    duracao_min: null,
    anexos: [],
    is_active: true,
  },
];

/** Percorre tudo e devolve as chaves encontradas, em qualquer nível. */
function todasAsChaves(v: unknown, achadas = new Set<string>()): Set<string> {
  if (Array.isArray(v)) {
    for (const item of v) todasAsChaves(item, achadas);
  } else if (v && typeof v === 'object') {
    for (const [k, valor] of Object.entries(v)) {
      achadas.add(k);
      todasAsChaves(valor, achadas);
    }
  }
  return achadas;
}

/** Percorre tudo e devolve os valores de texto, em qualquer nível. */
function todosOsTextos(v: unknown, achados: string[] = []): string[] {
  if (Array.isArray(v)) {
    for (const item of v) todosOsTextos(item, achados);
  } else if (v && typeof v === 'object') {
    for (const valor of Object.values(v)) todosOsTextos(valor, achados);
  } else if (typeof v === 'string') {
    achados.push(v);
  }
  return achados;
}

describe('estrutura do treinamento', () => {
  /**
   * O teste que justifica o módulo existir.
   *
   * Lista de PROIBIDOS aqui, e lista de PERMITIDOS no código: as duas
   * precisam discordar para o teste ter valor. Se os dois lados usassem
   * a mesma lista, o teste só confirmaria que a constante é igual a ela
   * mesma.
   */
  it('não devolve campo nenhum que entregue o conteúdo', () => {
    const chaves = todasAsChaves(soAEstrutura(MODULOS, AULAS));

    for (const proibida of ['youtube_id', 'anexos', 'video', 'url', 'link', 'arquivo', 'senha']) {
      assert.ok(!chaves.has(proibida), `vazou o campo "${proibida}" na estrutura`);
    }
  });

  /**
   * O ID do vídeo poderia escapar dentro de um texto — num título
   * montado, numa descrição copiada. Procurar o VALOR cobre o caso que
   * procurar a CHAVE não cobre.
   */
  it('não devolve o id do vídeo em lugar nenhum, nem dentro de texto', () => {
    const textos = todosOsTextos(soAEstrutura(MODULOS, AULAS)).join(' | ');

    for (const id of ['dQw4w9WgXcQ', 'abc123XYZ']) {
      assert.ok(!textos.includes(id), `o id "${id}" apareceu na resposta`);
    }
    assert.ok(!textos.includes('exemplo/planilha.xls'), 'a URL do anexo apareceu na resposta');
  });

  it('diz o que existe sem entregar: título, duração e se foi gravada', () => {
    const m1 = soAEstrutura(MODULOS, AULAS).modulos[0];
    assert.ok(m1, 'o primeiro módulo deveria existir');
    const primeira = m1.aulas[0];
    assert.ok(primeira, 'a primeira aula deveria existir');

    assert.equal(m1.titulo, 'Organizar a casa');
    assert.equal(m1.total_aulas, 2);
    assert.equal(m1.aulas_gravadas, 2);
    assert.equal(primeira.titulo, 'Por que separar PF de PJ');
    assert.equal(primeira.duracao_min, 8);
    assert.equal(primeira.gravada, true);
  });

  /**
   * Aula sem vídeo é aula em produção, e a tela precisa saber para não
   * prometer o que não existe. Mostrar um índice completo sem marcar o
   * que falta seria vender o que ainda não foi feito.
   */
  it('marca como não gravada a aula sem vídeo', () => {
    const m2 = soAEstrutura(MODULOS, AULAS).modulos[1];
    assert.ok(m2, 'o segundo módulo deveria existir');
    const unica = m2.aulas[0];
    assert.ok(unica, 'a aula do segundo módulo deveria existir');

    assert.equal(unica.gravada, false);
    assert.equal(m2.aulas_gravadas, 0);
    assert.equal(m2.total_aulas, 1);
  });

  it('ordena as aulas dentro do módulo, mesmo chegando fora de ordem', () => {
    const m1 = soAEstrutura(MODULOS, AULAS).modulos[0];
    assert.ok(m1, 'o primeiro módulo deveria existir');
    assert.deepEqual(
      m1.aulas.map((a) => a.id),
      ['a1', 'a2'],
    );
  });

  it('resume o curso inteiro', () => {
    assert.deepEqual(soAEstrutura(MODULOS, AULAS).resumo, {
      modulos: 2,
      aulas: 3,
      gravadas: 2,
    });
  });

  /** Curso ainda sem nada cadastrado não pode quebrar a tela de oferta. */
  it('aguenta banco vazio', () => {
    const e = soAEstrutura([], []);
    assert.deepEqual(e.modulos, []);
    assert.deepEqual(e.resumo, { modulos: 0, aulas: 0, gravadas: 0 });
  });
});
