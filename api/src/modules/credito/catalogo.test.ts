/**
 * Testes do catálogo de documentos de crédito.
 *
 * O caso que mais importa é o do imóvel. Quem não dá garantia real não
 * pode ver "68% concluído" para sempre depois de entregar tudo o que lhe
 * cabia — ou conclui que o sistema está errado, ou que ainda deve algo.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  acharDocumento,
  calcularProgresso,
  documentosDoGrupo,
  DOCUMENTOS,
  GRUPOS,
} from './catalogo.js';

describe('a integridade do catálogo', () => {
  it('não há chave repetida', () => {
    const chaves = DOCUMENTOS.map((d) => d.chave);
    assert.equal(new Set(chaves).size, chaves.length);
  });

  /**
   * A chave vira nome de pasta no Storage e coluna no banco. Espaço,
   * acento ou maiúscula quebrariam o caminho do arquivo em algum ponto
   * entre o navegador, o Supabase e o Google Drive.
   */
  it('toda chave é minúscula, sem acento e sem espaço', () => {
    for (const d of DOCUMENTOS) {
      assert.match(d.chave, /^[a-z0-9_]+$/, `chave inválida: ${d.chave}`);
    }
  });

  it('todo documento pertence a um grupo declarado', () => {
    const grupos = new Set(GRUPOS.map((g) => g.grupo));
    for (const d of DOCUMENTOS) {
      assert.ok(grupos.has(d.grupo), `grupo desconhecido em ${d.chave}`);
    }
  });

  it('todo grupo tem ao menos um documento', () => {
    for (const g of GRUPOS) {
      assert.ok(documentosDoGrupo(g.grupo).length > 0, `grupo vazio: ${g.grupo}`);
    }
  });

  it('todo documento tem descrição — a lista não pode ter jargão solto', () => {
    for (const d of DOCUMENTOS) {
      assert.ok(d.descricao.length > 20, `descrição curta demais: ${d.chave}`);
    }
  });

  it('acha pela chave, e devolve nulo para o que não existe', () => {
    assert.equal(acharDocumento('cartao_cnpj')?.grupo, 'empresa');
    assert.equal(acharDocumento('inventado'), null);
  });
});

describe('o progresso', () => {
  const obrigatoriosSemImovel = DOCUMENTOS.filter(
    (d) => d.obrigatorio && d.grupo !== 'imovel',
  ).map((d) => d.chave);

  it('sem nada entregue, começa em zero', () => {
    const p = calcularProgresso([], false);
    assert.equal(p.pct, 0);
    assert.equal(p.completo, false);
    assert.ok(p.faltando.length > 0);
  });

  it('sem imóvel, entregar os obrigatórios da empresa e dos sócios fecha 100%', () => {
    const p = calcularProgresso(obrigatoriosSemImovel, false);
    assert.equal(p.pct, 100);
    assert.equal(p.completo, true);
    assert.deepEqual(p.faltando, []);
  });

  /** O ponto do teste anterior, pelo avesso: com imóvel, não fecha. */
  it('com imóvel, os mesmos documentos não bastam', () => {
    const p = calcularProgresso(obrigatoriosSemImovel, true);
    assert.ok(p.pct < 100);
    assert.equal(p.completo, false);
    assert.ok(p.faltando.every((d) => d.grupo === 'imovel'));
  });

  /**
   * O grupo do imóvel é opcional COMO GRUPO — nem toda operação tem
   * garantia real. Sem imóvel, nenhum documento dele pode aparecer como
   * pendência, nem obrigatório nem opcional.
   */
  it('sem imóvel, nenhum documento do grupo aparece como faltando', () => {
    const p = calcularProgresso([], false);
    assert.equal(p.faltando.some((d) => d.grupo === 'imovel'), false);
  });

  it('documento opcional não atrapalha o 100%', () => {
    const p = calcularProgresso([...obrigatoriosSemImovel], false);
    assert.equal(p.completo, true);
    // E os opcionais também não somam além de 100.
    const q = calcularProgresso([...obrigatoriosSemImovel, 'certidoes_negativas'], false);
    assert.equal(q.pct, 100);
  });

  it('chave desconhecida é ignorada em vez de inflar o progresso', () => {
    const p = calcularProgresso(['nao_existe', 'outro_qualquer'], false);
    assert.equal(p.pct, 0);
  });

  it('o que falta vem na ordem do catálogo, para cobrar na sequência certa', () => {
    const p = calcularProgresso(['contrato_social'], false);
    const ordemNoCatalogo = DOCUMENTOS.filter((d) => p.faltando.includes(d));
    assert.deepEqual(p.faltando, ordemNoCatalogo);
  });

  it('entrega parcial devolve percentual entre zero e cem', () => {
    const metade = obrigatoriosSemImovel.slice(0, Math.floor(obrigatoriosSemImovel.length / 2));
    const p = calcularProgresso(metade, false);
    assert.ok(p.pct > 0 && p.pct < 100);
    assert.equal(p.obrigatoriosEntregues, metade.length);
  });
});
