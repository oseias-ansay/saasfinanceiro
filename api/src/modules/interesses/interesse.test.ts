import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { corpoInteresseSchema, textoDoAviso } from './interesse.js';

describe('corpo do pedido de interesse', () => {
  /**
   * A varredura que vale por todas as outras.
   *
   * Mesmo desenho do teste do catálogo do assistente e do webhook de
   * boleto: percorre as chaves aceitas procurando qualquer coisa que
   * cheire a identificação de empresa. Se alguém acrescentar
   * `tenant_id` ao schema "para facilitar", isto falha.
   */
  it('não aceita campo nenhum que identifique a empresa', () => {
    const chaves = Object.keys(corpoInteresseSchema.shape);

    for (const chave of chaves) {
      assert.ok(
        !/tenant|empresa|cliente|company|conta_id/i.test(chave),
        `o schema aceita "${chave}", e a empresa deve vir do JWT`,
      );
    }
  });

  it('ignora o tenant_id se alguém mandar mesmo assim', () => {
    const r = corpoInteresseSchema.parse({
      assunto: 'treinamento',
      tenant_id: '00000000-0000-0000-0000-000000000000',
    } as never);

    assert.deepEqual(Object.keys(r), ['assunto']);
  });

  it('aceita pedido sem mensagem e sem telefone', () => {
    const r = corpoInteresseSchema.parse({ assunto: 'treinamento' });
    assert.equal(r.assunto, 'treinamento');
    assert.equal(r.mensagem, undefined);
  });

  it('recusa assunto vazio ou gigante', () => {
    assert.throws(() => corpoInteresseSchema.parse({ assunto: '' }));
    assert.throws(() => corpoInteresseSchema.parse({ assunto: 'x'.repeat(61) }));
  });

  it('recusa mensagem acima do limite do banco', () => {
    // O `check` da coluna é 2000. Schema mais frouxo que o banco faria
    // a rota devolver 500 em vez de 400.
    assert.throws(() => corpoInteresseSchema.parse({ assunto: 'crm', mensagem: 'x'.repeat(2001) }));
  });

  it('apara espaços, para não gravar " treinamento "', () => {
    const r = corpoInteresseSchema.parse({ assunto: '  treinamento  ', mensagem: '  oi  ' });
    assert.equal(r.assunto, 'treinamento');
    assert.equal(r.mensagem, 'oi');
  });
});

describe('texto do aviso', () => {
  it('diz quem pediu e sobre o quê', () => {
    const t = textoDoAviso('Auto Posto Esperança', 'treinamento');
    assert.match(t, /Auto Posto Esperança/);
    assert.match(t, /Treinamento/);
  });

  it('inclui o que a pessoa escreveu', () => {
    const t = textoDoAviso('Padaria Três Irmãos', 'crm', 'Quero saber o preço para 3 vendedores');
    assert.match(t, /3 vendedores/);
  });

  /** Empresa sem nome não pode produzir "null quer falar sobre". */
  it('aguenta empresa sem nome', () => {
    for (const vazio of [null, '', '   ']) {
      const t = textoDoAviso(vazio, 'treinamento');
      assert.match(t, /Uma empresa/);
      assert.ok(!t.includes('null'), 'vazou "null" no texto');
    }
  });

  /** Assunto novo não precisa de deploy para aparecer legível. */
  it('mostra assunto desconhecido como veio, entre aspas', () => {
    const t = textoDoAviso('Studio Vita', 'plano-avancado');
    assert.match(t, /"plano-avancado"/);
  });
});
