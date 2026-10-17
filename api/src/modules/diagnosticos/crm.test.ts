/**
 * Testes da cópia do lead para o CRM.
 *
 * Este arquivo existe porque a integração passou nove dias rodando em
 * produção sem estar no repositório — e portanto sem teste nenhum. O que
 * se fixa aqui é o que quebraria em silêncio: a forma do corpo, que é
 * contrato com o outro sistema, e a garantia de nunca lançar.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { corpoParaCrm, type LeadParaCrm } from './crm.js';

const lead: LeadParaCrm = {
  tipo: 'financeiro',
  protocolo: 'BT-2026-0001',
  score: 62,
  nivel: 'Atenção',
  identificacao: { cnpj: '12345678000190', empresa: 'Auto Posto Esperança' },
  blocos: { caixa: { saldo: 1000 }, vendas: { ticket: 80 } },
  ip: '203.0.113.9',
};

describe('o corpo que o CRM recebe', () => {
  const corpo = corpoParaCrm(lead);

  /**
   * CONTRATO. Mexer num destes nomes quebra a recepção do outro lado sem
   * erro visível daqui: a resposta seguiria 200 se o CRM for tolerante,
   * ou viraria um aviso no log que ninguém lê.
   */
  it('mantém os nomes de campo que o CRM espera', () => {
    assert.equal(corpo.protocolo, 'BT-2026-0001');
    assert.deepEqual(corpo.meta, {
      formulario: 'diagnostico-financeiro',
      origem: 'site',
    });
    assert.deepEqual(corpo.resultado, { score_total: 62, nivel: 'Atenção' });
    assert.deepEqual(corpo.identificacao, lead.identificacao);
  });

  it('o formulário no meta acompanha o tipo', () => {
    const c = corpoParaCrm({ ...lead, tipo: 'comercial' });
    assert.deepEqual(c.meta, { formulario: 'diagnostico-comercial', origem: 'site' });
  });

  /**
   * Os blocos vão na RAIZ, não aninhados. É assim que o CRM lê — e é a
   * parte mais fácil de "arrumar" por engano, porque aninhar pareceria
   * mais limpo.
   */
  it('espalha os blocos na raiz, sem aninhar', () => {
    assert.deepEqual(corpo.caixa, { saldo: 1000 });
    assert.deepEqual(corpo.vendas, { ticket: 80 });
    assert.equal('blocos' in corpo, false);
  });

  /**
   * Um bloco chamado `protocolo` ou `meta` sobrescreveria o campo de
   * cima, porque o spread vem depois. Não é hipótese: os blocos são os
   * campos do formulário, e formulário muda.
   *
   * O teste registra o comportamento atual em vez de esconder. Se um dia
   * aparecer colisão de verdade, é aqui que se decide o que ganha.
   */
  it('bloco com nome reservado sobrescreve, e isso está sabido', () => {
    const c = corpoParaCrm({ ...lead, blocos: { protocolo: 'INVADIU' } });
    assert.equal(c.protocolo, 'INVADIU');
  });

  it('não vaza o ip para dentro do corpo', () => {
    assert.equal('ip' in corpo, false, 'o ip vai no cabeçalho, não no corpo');
  });

  it('aguenta identificação e blocos vazios', () => {
    const c = corpoParaCrm({ ...lead, identificacao: {}, blocos: {} });
    assert.deepEqual(c.identificacao, {});
    assert.equal(c.protocolo, 'BT-2026-0001');
  });
});
