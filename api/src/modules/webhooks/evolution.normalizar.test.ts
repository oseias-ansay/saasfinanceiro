/**
 * Testes do normalizador da Evolution.
 *
 * Existem porque todos os defeitos desta camada são silenciosos. Nenhum
 * deles gera erro: a mensagem é aceita, a execução fica verde, e o lead
 * simplesmente não existe. Foi assim com o LID — envio aceito, nada no
 * celular — e foi assim com os dois dias gastos achando que o problema
 * era o segredo.
 *
 * Cada teste aqui corresponde a uma decisão que, se virar ao contrário,
 * ninguém percebe olhando a tela.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarEvento, resumoDoEvento, saudacaoDe } from './evolution.normalizar.js';

/** Um evento da Evolution, com o mínimo e o que o teste quiser mudar. */
function evento(over: Record<string, unknown> = {}, data: Record<string, unknown> = {}) {
  return {
    instance: 'wa_ultimo',
    date_time: '2026-09-04T13:00:00.000Z', // 10h em Brasília
    data: {
      key: { remoteJid: '554196968720@s.whatsapp.net', id: 'MSG1', fromMe: false },
      message: { conversation: 'oi (ref: anuncio)' },
      messageType: 'conversation',
      pushName: 'Fulano',
      ...data,
    },
    ...over,
  };
}

describe('saudação pelo horário de Brasília', () => {
  it('usa o fuso de São Paulo, não o UTC do contêiner', () => {
    // 23h UTC é 20h em Brasília. Sem o fuso fixo, viraria "Boa noite"
    // por acaso; o teste que importa é o inverso, abaixo.
    assert.equal(saudacaoDe('2026-09-04T23:00:00.000Z'), 'Boa noite');

    // 02h UTC é 23h do dia anterior em Brasília. Um servidor em UTC diria
    // "Bom dia" para quem escreveu quase meia-noite.
    assert.equal(saudacaoDe('2026-09-05T02:00:00.000Z'), 'Boa noite');
  });

  it('cobre as três faixas', () => {
    assert.equal(saudacaoDe('2026-09-04T12:00:00.000Z'), 'Bom dia'); // 09h
    assert.equal(saudacaoDe('2026-09-04T18:00:00.000Z'), 'Boa tarde'); // 15h
    assert.equal(saudacaoDe('2026-09-04T23:30:00.000Z'), 'Boa noite'); // 20h30
  });

  it('não quebra com data inválida', () => {
    assert.ok(['Bom dia', 'Boa tarde', 'Boa noite'].includes(saudacaoDe('não é data')));
  });
});

describe('mensagem normal de anúncio', () => {
  const r = normalizarEvento(evento());

  it('responde, registra e guarda', () => {
    assert.equal(r.responder, true);
    assert.equal(r.registrar, true);
    assert.equal(r.guardar, true);
    assert.equal(r.motivo, 'ok');
  });

  it('extrai telefone, contato e código de origem', () => {
    assert.equal(r.numero, '554196968720');
    assert.equal(r.contato, 'Fulano');
    assert.equal(r.origem, 'anuncio');
    assert.equal(r.wa_id, 'MSG1');
    assert.equal(r.de_mim, false);
  });

  it('monta a resposta do anúncio com a saudação da hora', () => {
    assert.ok(r.resposta?.startsWith('Bom dia! Vi que você veio pelo anúncio'));
  });
});

describe('o LID, que já causou falha silenciosa', () => {
  it('usa remoteJidAlt quando o remoteJid é um LID', () => {
    const r = normalizarEvento(
      evento({}, { key: { remoteJid: '152003288269035@lid', remoteJidAlt: '554196968720@s.whatsapp.net', id: 'M', fromMe: false } }),
    );
    assert.equal(r.numero, '554196968720');
    assert.equal(r.responder, true);
  });

  it('recusa responder quando só há LID', () => {
    const r = normalizarEvento(
      evento({}, { key: { remoteJid: '152003288269035@lid', id: 'M', fromMe: false } }),
    );
    assert.equal(r.responder, false);
    assert.equal(r.registrar, false);
    assert.equal(r.guardar, false);
    assert.equal(r.motivo, 'só LID, sem telefone para responder');
  });
});

describe('o que não deve gerar resposta', () => {
  it('mensagem enviada por nós', () => {
    const r = normalizarEvento(
      evento({}, { key: { remoteJid: '554196968720@s.whatsapp.net', id: 'M', fromMe: true } }),
    );
    assert.equal(r.responder, false);
    assert.equal(r.registrar, false);
    assert.equal(r.motivo, 'mensagem própria');
    // Mas o histórico guarda os dois lados: metade do diálogo não
    // resolve divergência sobre o que foi combinado.
    assert.equal(r.guardar, true);
    assert.equal(r.de_mim, true);
  });

  it('mensagem de grupo não responde, não registra e não guarda', () => {
    const r = normalizarEvento(
      evento({}, { key: { remoteJid: '1203630@g.us', id: 'M', fromMe: false } }),
    );
    assert.equal(r.responder, false);
    assert.equal(r.registrar, false);
    assert.equal(r.guardar, false);
    assert.equal(r.motivo, 'mensagem de grupo');
  });

  it('mensagem sem código de origem: silêncio, mas guarda a conversa', () => {
    const r = normalizarEvento(evento({}, { message: { conversation: 'bom dia, tudo bem?' } }));
    assert.equal(r.responder, false);
    assert.equal(r.registrar, false);
    assert.equal(r.guardar, true);
    assert.equal(r.motivo, 'sem código de origem — atendimento humano');
  });
});

describe('o ref desconhecido não pode custar o lead', () => {
  it('qualquer coisa começada por "anuncio" usa a resposta do anúncio', () => {
    const r = normalizarEvento(evento({}, { message: { conversation: 'oi (ref: anuncio-setembro-b)' } }));
    assert.equal(r.origem, 'anuncio-setembro-b');
    assert.ok(r.resposta?.includes('veio pelo anúncio'));
    assert.equal(r.registrar, true);
  });

  it('ref desconhecido cai na resposta geral, e ainda registra', () => {
    const r = normalizarEvento(evento({}, { message: { conversation: 'oi (ref: digitei-errado)' } }));
    assert.equal(r.origem, 'digitei-errado');
    assert.ok(r.resposta?.includes('Me conta rapidamente o que você precisa'));
    assert.equal(r.registrar, true);
  });

  it('aceita o ref com espaços e maiúsculas', () => {
    const r = normalizarEvento(evento({}, { message: { conversation: 'olá ( REF : Credito )' } }));
    assert.equal(r.origem, 'credito');
    assert.ok(r.resposta?.includes('crédito empresarial'));
  });
});

describe('mídia', () => {
  it('áudio: sem resposta, mas registra a passagem no histórico', () => {
    const r = normalizarEvento(evento({}, { message: { audioMessage: { seconds: 5 } }, messageType: 'audioMessage' }));
    assert.equal(r.responder, false);
    assert.equal(r.tipo_midia, 'audio');
    assert.equal(r.texto_recebido, '');
    assert.equal(r.guardar, true);
    assert.equal(r.motivo, 'sem texto (áudio, imagem ou documento)');
  });

  it('documento guarda o nome do arquivo, não o arquivo', () => {
    const r = normalizarEvento(
      evento({}, { message: { documentMessage: { fileName: 'balanco.pdf', url: 'https://mmg.whatsapp.net/x' } } }),
    );
    assert.equal(r.tipo_midia, 'documento');
    assert.equal(r.midia_nome, 'balanco.pdf');
    // O que não pode acontecer de jeito nenhum: a URL da mídia vazar
    // para dentro do que é gravado.
    assert.equal(JSON.stringify(r).includes('mmg.whatsapp.net'), false);
  });
});

describe('texto em formatos alternativos', () => {
  it('extendedTextMessage', () => {
    const r = normalizarEvento(evento({}, { message: { extendedTextMessage: { text: 'oi (ref: mercado)' } } }));
    assert.equal(r.origem, 'mercado');
    assert.equal(r.responder, true);
  });

  it('mensagem efêmera', () => {
    const r = normalizarEvento(
      evento({}, { message: { ephemeralMessage: { message: { conversation: 'oi (ref: agendamento)' } } } }),
    );
    assert.equal(r.origem, 'agendamento');
  });
});

describe('a instância', () => {
  it('vem do evento', () => {
    assert.equal(normalizarEvento(evento()).instancia, 'wa_ultimo');
  });

  it('fica vazia quando não vem — nunca cai numa empresa por padrão', () => {
    const e = evento();
    delete (e as Record<string, unknown>).instance;
    assert.equal(normalizarEvento(e).instancia, '');
  });
});

describe('robustez com lixo', () => {
  it('não lança com payload vazio, nulo ou de outro formato', () => {
    for (const lixo of [{}, null, undefined, [], 'texto', 42, { data: null }, { data: { key: null } }]) {
      const r = normalizarEvento(lixo);
      assert.equal(r.responder, false);
      assert.equal(r.registrar, false);
      assert.equal(r.guardar, false);
    }
  });

  it('aceita o payload embrulhado em body, como o n8n entregava', () => {
    const r = normalizarEvento({ body: evento() });
    assert.equal(r.numero, '554196968720');
    assert.equal(r.responder, true);
  });
});

describe('o contexto do anúncio', () => {
  it('guarda o externalAdReply sem interpretar', () => {
    const r = normalizarEvento(
      evento(
        {},
        {
          message: {
            extendedTextMessage: {
              text: 'oi (ref: anuncio)',
              contextInfo: { externalAdReply: { ctwaClid: 'ARBc123' }, conversionSource: 'FB_Ads' },
            },
          },
        },
      ),
    );
    assert.deepEqual(r.contexto.externalAdReply, { ctwaClid: 'ARBc123' });
    assert.equal(r.contexto.conversionSource, 'FB_Ads');
  });

  it('não leva o texto da conversa junto', () => {
    const r = normalizarEvento(evento({}, { message: { conversation: 'oi (ref: anuncio) meu CPF é 123' } }));
    assert.equal(JSON.stringify(r.contexto).includes('CPF'), false);
  });
});

describe('o resumo que vai para o registro de eventos', () => {
  it('nunca leva o texto da conversa', () => {
    const r = resumoDoEvento(
      evento({}, { message: { conversation: 'oi, meu CPF é 111.222.333-44 e moro na rua X' } }),
    );
    const s = JSON.stringify(r);
    assert.equal(s.includes('CPF'), false);
    assert.equal(s.includes('111.222.333-44'), false);
    assert.equal(s.includes('rua X'), false);
  });

  it('nunca leva o conteúdo de mídia, só o nome do campo', () => {
    const r = resumoDoEvento(
      evento({}, { message: { imageMessage: { url: 'https://mmg.whatsapp.net/foto', caption: 'meu comprovante' } } }),
    );
    assert.deepEqual(r.camposDaMensagem, ['imageMessage']);
    const s = JSON.stringify(r);
    assert.equal(s.includes('mmg.whatsapp.net'), false);
    assert.equal(s.includes('comprovante'), false);
  });

  it('guarda o que serve para diagnosticar roteamento', () => {
    const r = resumoDoEvento(evento());
    assert.equal(r.instance, 'wa_ultimo');
    assert.equal(r.messageType, 'conversation');
    assert.deepEqual(r.key, {
      remoteJid: '554196968720@s.whatsapp.net',
      remoteJidAlt: null,
      id: 'MSG1',
      fromMe: false,
    });
  });

  it('não lança com lixo', () => {
    for (const lixo of [{}, null, undefined, 'x', 42]) {
      assert.doesNotThrow(() => resumoDoEvento(lixo));
    }
  });
});

describe('o texto guardado tem limite', () => {
  it('corta em 500 caracteres', () => {
    const r = normalizarEvento(evento({}, { message: { conversation: 'a'.repeat(900) } }));
    assert.equal(r.texto_recebido.length, 500);
  });
});
