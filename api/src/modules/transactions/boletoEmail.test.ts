/**
 * Testes da entrada por e-mail.
 *
 * O bloco que mais importa é o do destinatário: é ele que decide em qual
 * empresa o boleto cai. Um defeito ali não dá erro — entrega a conta a
 * pagar de uma empresa para outra, com valor, fornecedor e vencimento.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  corpoEmailSchema,
  destinoDoEmail,
  limparRemetente,
  tokensDoDestinatario,
  triarAnexos,
} from './boletoEmail.js';

const T1 = 'a7f3x9k2m4p1';
const T2 = 'b8g4y0l3n5q2';

/** base64 de N bytes, para exercitar os limites de tamanho. */
function base64De(bytes: number): string {
  return Buffer.alloc(bytes, 7).toString('base64');
}

const MEIO_MEGA = base64De(512 * 1024);

describe('o token do destinatário', () => {
  it('acha no endereço simples', () => {
    assert.deepEqual(
      tokensDoDestinatario(`boletos+${T1}@businesstriage.com.br`),
      [T1],
    );
  });

  it('acha quando vem com nome exibido', () => {
    assert.deepEqual(
      tokensDoDestinatario(`"Financeiro" <boletos+${T1}@businesstriage.com.br>`),
      [T1],
    );
  });

  /**
   * A parte local de um endereço é sensível a caixa pela RFC, e nenhum
   * provedor trata assim. Recusar um token em caixa alta seria um boleto
   * perdido sem nenhuma explicação para o cliente.
   */
  it('não se importa com maiúsculas', () => {
    assert.deepEqual(
      tokensDoDestinatario(`BOLETOS+${T1.toUpperCase()}@BUSINESSTRIAGE.COM.BR`),
      [T1],
    );
  });

  it('o mesmo token no Para e no Cc conta uma vez', () => {
    const cab = `boletos+${T1}@dominio.com, outro@x.com, boletos+${T1}@dominio.com`;
    assert.deepEqual(tokensDoDestinatario(cab), [T1]);
  });

  it('acha os dois quando são dois mesmo', () => {
    const cab = `boletos+${T1}@d.com, boletos+${T2}@d.com`;
    assert.deepEqual(tokensDoDestinatario(cab).sort(), [T1, T2].sort());
  });

  it('ignora endereço que não é da caixa de boletos', () => {
    assert.deepEqual(tokensDoDestinatario('contato+abc12345@dominio.com'), []);
    assert.deepEqual(tokensDoDestinatario('boletos@businesstriage.com.br'), []);
  });

  it('token curto ou com caractere estranho não vale', () => {
    assert.deepEqual(tokensDoDestinatario('boletos+abc@d.com'), []);
    assert.deepEqual(tokensDoDestinatario('boletos+abc-123-xyz@d.com'), []);
  });

  it('entrada vazia ou lixo devolve lista vazia', () => {
    for (const v of ['', '   ', null, undefined, 42]) {
      assert.deepEqual(tokensDoDestinatario(v as unknown as string), []);
    }
  });
});

describe('o destino do e-mail', () => {
  it('um token é o caso bom', () => {
    assert.deepEqual(destinoDoEmail(`boletos+${T1}@d.com`), {
      token: T1,
      motivo: null,
    });
  });

  it('olha o Cc também', () => {
    assert.equal(destinoDoEmail('alguem@x.com', `boletos+${T1}@d.com`).token, T1);
  });

  it('sem token não há destino', () => {
    assert.deepEqual(destinoDoEmail('qualquer@coisa.com'), {
      token: null,
      motivo: 'sem_token',
    });
  });

  /**
   * A DECISÃO MAIS IMPORTANTE DESTE ARQUIVO.
   *
   * Dois tokens é um e-mail endereçado a duas empresas. Gravar nas duas
   * inventa uma intenção que ninguém declarou; gravar na primeira é pior
   * ainda, porque a ordem dos destinatários num cabeçalho não significa
   * nada — depende do cliente de e-mail de quem enviou.
   *
   * Recusar devolve um boleto que o cliente reenvia. Acertar por sorte
   * entrega dado de uma empresa para outra.
   */
  it('dois tokens recusa, não escolhe', () => {
    const d = destinoDoEmail(`boletos+${T1}@d.com, boletos+${T2}@d.com`);
    assert.equal(d.token, null);
    assert.equal(d.motivo, 'varios_tokens');
  });
});

describe('a triagem dos anexos', () => {
  const boleto = { nome: 'boleto.pdf', mime: 'application/pdf', base64: MEIO_MEGA };

  it('passa um PDF de tamanho de boleto', () => {
    const t = triarAnexos([boleto]);
    assert.equal(t.candidatos.length, 1);
    assert.equal(t.descartados.length, 0);
  });

  /**
   * E-mail de banco vem com logo, ícone de assinatura e às vezes um
   * `.ics`. Cada anexo mandado ao modelo custa dinheiro — e um PNG de
   * 3 KB nunca é um boleto, é um logotipo.
   */
  it('descarta logo pequeno e tipo que não serve', () => {
    const t = triarAnexos([
      boleto,
      { nome: 'logo.png', mime: 'image/png', base64: base64De(3 * 1024) },
      { nome: 'convite.ics', mime: 'text/calendar', base64: MEIO_MEGA },
      { nome: 'planilha.xlsx', mime: 'application/vnd.ms-excel', base64: MEIO_MEGA },
    ]);

    assert.equal(t.candidatos.length, 1);
    assert.equal(t.candidatos[0]!.nome, 'boleto.pdf');
    assert.equal(t.descartados.length, 3);
    assert.match(t.descartados[0]!.porque, /pequeno/);
  });

  it('descarta arquivo grande demais para ser boleto', () => {
    const t = triarAnexos([
      { nome: 'catalogo.pdf', mime: 'application/pdf', base64: base64De(11 * 1024 * 1024) },
    ]);
    assert.equal(t.candidatos.length, 0);
    assert.match(t.descartados[0]!.porque, /10 MB/);
  });

  /**
   * PDF antes de imagem. Quando o e-mail traz o boleto em PDF e também
   * uma imagem, o PDF é o que tem a linha em texto — tentar a imagem
   * primeiro gastaria uma chamada para provavelmente falhar.
   */
  it('põe o PDF na frente da imagem', () => {
    const t = triarAnexos([
      { nome: 'print.jpg', mime: 'image/jpeg', base64: MEIO_MEGA },
      boleto,
    ]);
    assert.deepEqual(
      t.candidatos.map((c) => c.nome),
      ['boleto.pdf', 'print.jpg'],
    );
  });

  it('aguenta lista vazia e anexo malformado', () => {
    assert.deepEqual(triarAnexos([]).candidatos, []);
    assert.deepEqual(triarAnexos(undefined as unknown as []).candidatos, []);

    const t = triarAnexos([
      { nome: '', mime: 'application/pdf', base64: '' },
      null as unknown as { nome: string; mime: string; base64: string },
    ]);
    assert.equal(t.candidatos.length, 0);
    assert.equal(t.descartados.length, 2);
    assert.equal(t.descartados[0]!.nome, 'sem nome');
  });
});

describe('o corpo que o webhook aceita', () => {
  /**
   * A BARREIRA AUTOMÁTICA ENTRE EMPRESAS, NESTE CAMINHO.
   *
   * Mesma ideia do teste que varre o catálogo do assistente: nenhum
   * campo de empresa no corpo. A empresa sai do token no destinatário,
   * resolvido contra a tabela.
   *
   * Um `tenant_id` aqui seria conveniente e seria uma porta — o segredo
   * do webhook é UM, compartilhado por todos os fluxos do n8n. Quem o
   * tivesse escolheria a empresa de destino. Com o desenho atual,
   * precisaria também do token daquela empresa específica.
   *
   * Este teste não depende de ninguém se comportar: ele falha na hora em
   * que o campo aparecer.
   */
  it('não tem campo de empresa', () => {
    const campos = Object.keys(corpoEmailSchema.shape);
    const proibido = /tenant|empresa|cliente|company|org/i;

    for (const campo of campos) {
      assert.ok(
        !proibido.test(campo),
        `o corpo do webhook não pode ter "${campo}": a empresa vem do token`,
      );
    }
  });

  it('exige o destinatário, que é de onde sai a empresa', () => {
    assert.ok(!corpoEmailSchema.safeParse({ de: 'x@y.com' }).success);
    assert.ok(corpoEmailSchema.safeParse({ para: 'boletos+abc12345@d.com' }).success);
  });

  /** Lista de anexos tem teto: e-mail com 500 anexos é ataque, não boleto. */
  it('limita a quantidade de anexos', () => {
    const muitos = Array.from({ length: 21 }, () => ({
      mime: 'application/pdf',
      base64: 'QUJD',
    }));
    assert.ok(!corpoEmailSchema.safeParse({ para: 'a@b.com', anexos: muitos }).success);
  });
});

describe('o remetente', () => {
  it('fica só o endereço quando vem com nome', () => {
    assert.equal(
      limparRemetente('"Banco X - Cobrança" <cobranca@bancox.com.br>'),
      'cobranca@bancox.com.br',
    );
  });

  it('endereço puro passa igual', () => {
    assert.equal(limparRemetente('fornecedor@empresa.com'), 'fornecedor@empresa.com');
  });

  /**
   * Nunca devolve vazio: a coluna `remetente` é obrigatória quando a
   * origem é e-mail, e a tela precisa escrever alguma coisa no lugar de
   * "chegou por e-mail de ___".
   */
  it('vazio vira texto explícito, não string vazia', () => {
    for (const v of ['', '   ', null, undefined, 0]) {
      assert.equal(limparRemetente(v), 'remetente não informado');
    }
  });

  it('corta no limite da coluna', () => {
    const longo = `${'a'.repeat(400)}@d.com`;
    assert.equal(limparRemetente(longo).length, 320);
  });
});
