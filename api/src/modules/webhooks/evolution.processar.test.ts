/**
 * Testes da orquestração.
 *
 * O normalizador decide O QUE fazer; estes testes verificam a ORDEM e o
 * ISOLAMENTO — as duas propriedades que o n8n não tinha e cuja ausência
 * custou dois dias.
 *
 * A propriedade central: **falha de um passo não pode cancelar os
 * outros.** No n8n, o envio da resposta falhava e a execução inteira era
 * abortada, levando junto o registro do lead. Quem escreveu sumia. E o
 * sintoma era um card que não apareceu — sem erro, sem alerta, sem nada.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { processarEvento, type Dependencias } from './evolution.processar.js';

const TENANT = '11111111-1111-4111-8111-111111111111';

function evento(over: Record<string, unknown> = {}, data: Record<string, unknown> = {}) {
  return {
    instance: 'wa_ultimo',
    date_time: '2026-09-04T13:00:00.000Z',
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

/** Dependências de mentira que anotam a ordem das chamadas. */
function deps(over: Partial<Dependencias> = {}) {
  const ordem: string[] = [];
  const gravadas: Array<Record<string, unknown>> = [];
  const eventos: Array<Record<string, unknown>> = [];

  const base: Dependencias = {
    empresaDaInstancia: async () => {
      ordem.push('rota');
      return TENANT;
    },
    temRecursoCrm: async () => {
      ordem.push('recurso');
      return true;
    },
    registrarLead: async () => {
      ordem.push('lead');
      return { lead_id: 'lead-1', criado: true, etapa: 'novo' };
    },
    gravarMensagem: async (a) => {
      ordem.push(a.deMim ? 'mensagem-saida' : 'mensagem-entrada');
      gravadas.push(a as unknown as Record<string, unknown>);
      return `msg-${gravadas.length}`;
    },
    enviarTexto: async () => {
      ordem.push('envio');
      return { ok: true, waId: 'WA-OUT', erro: null };
    },
    registrarEvento: async (a: Record<string, unknown>) => {
      ordem.push('registro');
      eventos.push(a);
    },
    ...over,
  };

  return { dep: base, ordem, gravadas, eventos };
}

describe('o caminho feliz', () => {
  it('grava o lead ANTES da mensagem, e responde por último', async () => {
    const { dep, ordem } = deps();
    const r = await processarEvento(evento(), dep);

    assert.equal(r.ok, true);
    assert.equal(r.lead_id, 'lead-1');
    assert.equal(r.respondido, true);

    // A ordem não é estética. `fn_gravar_mensagem` só grava conversa de
    // quem já está no funil: invertendo lead e mensagem, a mensagem que
    // ABRE toda conversa seria a única a se perder — e é justamente a que
    // traz o código do anúncio.
    assert.deepEqual(ordem, [
      'rota',
      'recurso',
      'lead',
      'mensagem-entrada',
      'envio',
      'mensagem-saida',
      'registro',
    ]);
  });

  it('guarda os dois lados da conversa', async () => {
    const { dep, gravadas } = deps();
    await processarEvento(evento(), dep);

    assert.equal(gravadas.length, 2);
    assert.equal(gravadas[0]?.deMim, false);
    assert.equal(gravadas[1]?.deMim, true);
    assert.equal(gravadas[1]?.waId, 'WA-OUT');
    assert.ok(String(gravadas[1]?.texto).includes('veio pelo anúncio'));
  });
});

describe('isolamento de falhas — o defeito que o n8n tinha', () => {
  it('a resposta falhar NÃO impede o lead nem o histórico', async () => {
    const { dep, ordem } = deps({
      enviarTexto: async () => {
        ordem.push('envio');
        return { ok: false, waId: null, erro: 'Evolution fora do ar' };
      },
    });

    const r = await processarEvento(evento(), dep);

    // Era exatamente isto que se perdia antes.
    assert.equal(r.lead_id, 'lead-1');
    assert.equal(r.mensagem_id, 'msg-1');
    assert.equal(r.respondido, false);
    assert.equal(r.ok, false);
    assert.ok(r.falhas[0]?.includes('Evolution fora do ar'));
  });

  it('o lead falhar NÃO impede o histórico nem a resposta', async () => {
    const { dep } = deps({
      registrarLead: async () => {
        throw new Error('banco indisponível');
      },
    });

    const r = await processarEvento(evento(), dep);

    assert.equal(r.lead_id, null);
    assert.equal(r.mensagem_id, 'msg-1');
    assert.equal(r.respondido, true);
    assert.ok(r.falhas[0]?.includes('banco indisponível'));
  });

  it('o histórico falhar NÃO impede a resposta', async () => {
    const { dep } = deps({
      gravarMensagem: async () => {
        throw new Error('índice violado');
      },
    });

    const r = await processarEvento(evento(), dep);
    assert.equal(r.lead_id, 'lead-1');
    assert.equal(r.respondido, true);
  });

  it('toda falha vira uma linha no registro de eventos', async () => {
    const { dep, eventos } = deps({
      registrarLead: async () => {
        throw new Error('estourou');
      },
    });

    await processarEvento(evento(), dep);

    assert.equal(eventos.length, 1);
    assert.ok(String(eventos[0]?.erro).includes('estourou'));
  });
});

describe('instância não cadastrada', () => {
  it('não grava nada, mas registra o evento — senão fica invisível', async () => {
    const { dep, ordem, eventos } = deps({ empresaDaInstancia: async () => null });
    const r = await processarEvento(evento(), dep);

    assert.equal(r.tenant_id, null);
    assert.equal(r.lead_id, null);
    assert.equal(r.motivo, 'instância não cadastrada');
    assert.deepEqual(ordem, ['registro']);
    assert.equal(eventos[0]?.instancia, 'wa_ultimo');
  });

  it('evento sem instância tem motivo próprio', async () => {
    const e = evento();
    delete (e as Record<string, unknown>).instance;
    const { dep } = deps({ empresaDaInstancia: async () => null });
    const r = await processarEvento(e, dep);
    assert.equal(r.motivo, 'evento sem instância');
  });
});

describe('empresa sem o recurso do CRM', () => {
  it('não grava lead nem mensagem, mas ainda responde', async () => {
    const { dep, ordem } = deps({
      temRecursoCrm: async () => {
        ordem.push('recurso');
        return false;
      },
    });
    const r = await processarEvento(evento(), dep);

    // Acumular lead invisível numa tela que ninguém abre significa
    // despejar tudo de uma vez no dia em que a empresa contratar — com
    // conversas que ela nunca soube que estavam sendo guardadas.
    assert.equal(r.lead_id, null);
    assert.equal(r.mensagem_id, null);
    assert.equal(r.motivo, 'empresa sem o recurso do CRM');

    // A cortesia continua: quem escreveu recebe resposta.
    assert.equal(r.respondido, true);
    assert.deepEqual(ordem, ['rota', 'recurso', 'envio', 'registro']);
  });
});

describe('mensagem que não merece resposta', () => {
  it('sem código de origem: guarda a conversa, não cria lead, não responde', async () => {
    const { dep, ordem } = deps();
    const r = await processarEvento(evento({}, { message: { conversation: 'bom dia' } }), dep);

    assert.equal(r.lead_id, null);
    assert.equal(r.mensagem_id, 'msg-1');
    assert.equal(r.respondido, false);
    assert.deepEqual(ordem, ['rota', 'recurso', 'mensagem-entrada', 'registro']);
  });

  it('mensagem de grupo não faz nada além de registrar o evento', async () => {
    const { dep, ordem } = deps();
    const r = await processarEvento(
      evento({}, { key: { remoteJid: '123@g.us', id: 'M', fromMe: false } }),
      dep,
    );

    assert.equal(r.lead_id, null);
    assert.equal(r.mensagem_id, null);
    assert.equal(r.respondido, false);
    assert.deepEqual(ordem, ['rota', 'recurso', 'registro']);
  });
});

describe('o que vai para a coluna resultado', () => {
  it('leva o que a view usa para dar o veredito, e nada de conversa', async () => {
    const { dep, eventos } = deps();
    await processarEvento(evento({}, { message: { conversation: 'oi (ref: anuncio) meu CPF é 123' } }), dep);

    const res = eventos[0]?.resultado as Record<string, unknown>;
    assert.deepEqual(Object.keys(res).sort(), [
      'lead_criado',
      'lead_id',
      'mensagem_id',
      'respondido',
      'resposta_id',
    ]);
    assert.equal(JSON.stringify(eventos[0]).includes('CPF'), false);
  });
});
