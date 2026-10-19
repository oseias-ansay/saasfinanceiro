/**
 * Testes da montagem do endereço externo.
 *
 * Quase todo teste aqui é de RECUSA, e isso é proposital: a função manda
 * o cliente para outro sistema, e no passo seguinte do projeto ele vai
 * junto com um token de sessão. O modo de falha que importa não é
 * quebrar — é montar um endereço válido apontando para o lugar errado.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ehSistema,
  EnderecoInvalido,
  montarEndereco,
  RECURSO_DO_SISTEMA,
} from './endereco.js';

const CRM = 'crm.businesstriage.com.br';

describe('o endereço montado', () => {
  it('monta o subdomínio da empresa', () => {
    assert.equal(
      montarEndereco('crm', 'auto-posto-esperanca', CRM),
      'https://auto-posto-esperanca.crm.businesstriage.com.br/',
    );
  });

  it('aceita um caminho interno', () => {
    assert.equal(
      montarEndereco('contabil', 'posto', 'contabil.businesstriage.com.br', '/empresas'),
      'https://posto.contabil.businesstriage.com.br/empresas',
    );
  });

  it('aceita slug mínimo e com hífen no meio', () => {
    assert.match(montarEndereco('crm', 'ab', CRM), /^https:\/\/ab\./);
    assert.match(montarEndereco('crm', 'a-b-c', CRM), /^https:\/\/a-b-c\./);
  });
});

describe('empresa sem vínculo', () => {
  /**
   * Nulo é o estado NORMAL: a maioria das empresas não tem nenhum dos
   * dois módulos. A mensagem diz o que fazer, não que deu erro.
   */
  it('recusa com mensagem útil quando não há slug', () => {
    for (const v of [null, undefined, '']) {
      assert.throws(
        () => montarEndereco('crm', v as string | null, CRM),
        EnderecoInvalido,
      );
    }

    try {
      montarEndereco('crm', null, CRM);
    } catch (e) {
      assert.match((e as Error).message, /não está vinculada/i);
      assert.match((e as Error).message, /administrador/i);
    }
  });
});

describe('slug que escaparia do domínio', () => {
  /**
   * O NÚCLEO DESTE ARQUIVO.
   *
   * Cada um destes montaria um endereço fora do nosso domínio, e o
   * cliente seria mandado para lá — no passo seguinte, com um token de
   * sessão na URL.
   *
   * O `check` do SQL 64 já impede gravar isso. A conferência aqui é
   * redundante de propósito: banco restaurado de backup antigo, ou
   * escrita por `supabaseAdmin` contornando a restrição.
   */
  it('recusa slug que muda o host', () => {
    const perigosos = [
      'evil.com',           // vira evil.com.crm... mas com ponto no rótulo
      'posto.evil',         // idem
      'posto/../outro',     // barra
      'posto@evil.com',     // arroba: o que vem antes vira credencial
      'posto:8080',         // porta
      'posto evil',         // espaço
      'posto#frag',
      'posto?x=1',
      '-posto',             // hífen no começo não é rótulo válido
      'posto-',
      'POSTO',              // maiúscula: o banco grava minúsculo
      '../posto',
      'a',                  // curto demais para ser rótulo real
    ];

    for (const slug of perigosos) {
      assert.throws(
        () => montarEndereco('crm', slug, CRM),
        EnderecoInvalido,
        `deveria recusar o slug ${JSON.stringify(slug)}`,
      );
    }
  });

  it('nunca produz endereço fora do domínio base', () => {
    // Varredura: o que passar TEM de ficar sob o domínio configurado.
    for (const slug of ['posto', 'auto-posto-esperanca', 'ab', 'x1-y2']) {
      const url = montarEndereco('crm', slug, CRM);
      assert.ok(
        url.startsWith('https://') && url.includes(`.${CRM}/`),
        `${url} saiu do domínio base`,
      );
    }
  });
});

describe('domínio base mal configurado', () => {
  /**
   * `.env` com valor vazio ou espaço sobrando acontece. Montar
   * `https://posto.` daria um endereço quebrado que só falha no
   * navegador do cliente, longe de quem poderia consertar.
   */
  it('recusa domínio vazio, com espaço ou sem ponto', () => {
    for (const d of ['', '   ', 'localhost', 'crm businesstriage', 'http://crm.br']) {
      assert.throws(() => montarEndereco('crm', 'posto', d), EnderecoInvalido);
    }
  });

  it('tolera espaço em volta e maiúscula no domínio', () => {
    assert.equal(
      montarEndereco('crm', 'posto', `  ${CRM.toUpperCase()}  `),
      `https://posto.${CRM}/`,
    );
  });
});

describe('o caminho', () => {
  /**
   * `//outro.com` é tratado pelo navegador como OUTRO HOST. É o
   * redirecionamento aberto clássico, e passa despercebido porque parece
   * só uma barra a mais.
   */
  it('recusa caminho que vira host e cai na raiz', () => {
    assert.equal(
      montarEndereco('crm', 'posto', CRM, '//evil.com'),
      `https://posto.${CRM}/`,
    );
    assert.equal(
      montarEndereco('crm', 'posto', CRM, 'empresas'),
      `https://posto.${CRM}/`,
    );
  });
});

describe('o catálogo de sistemas', () => {
  it('reconhece só os dois', () => {
    assert.ok(ehSistema('crm'));
    assert.ok(ehSistema('contabil'));
    assert.ok(!ehSistema('financeiro'));
    assert.ok(!ehSistema(''));
  });

  /**
   * O CRM externo usa `crm_externo`, e não o `crm` que liberava o Funil
   * interno. Reaproveitar o código faria quem tinha o Funil de cortesia
   * herdar o CRM pago sem ninguém decidir isso.
   */
  it('o CRM externo tem recurso próprio, separado do Funil antigo', () => {
    assert.equal(RECURSO_DO_SISTEMA.crm, 'crm_externo');
    assert.notEqual(RECURSO_DO_SISTEMA.crm, 'crm');
    assert.equal(RECURSO_DO_SISTEMA.contabil, 'contabil');
  });
});
