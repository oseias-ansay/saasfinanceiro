/**
 * Testes da normalização e da montagem do evento.
 *
 * Existem porque o erro que estes testes pegam é INVISÍVEL em produção.
 * Um telefone normalizado errado gera um hash válido, a Meta responde
 * 200, o evento é aceito — e não casa com pessoa nenhuma. Não há
 * mensagem de erro, não há alerta, não há nada no log. A campanha
 * otimiza para o vazio até alguém desconfiar semanas depois.
 *
 * Nenhum outro trecho deste projeto tem essa combinação de "fácil de
 * errar" com "impossível de notar".
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { montarPayload, normalizarEmail, normalizarTelefone } from './capi.js';

const sha = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');

const evento = (p: Record<string, unknown> = {}) =>
  montarPayload({
    id: 'linha-1',
    event_id: 'evt-abc',
    event_name: 'Lead',
    event_time: '2026-09-01T12:00:00.000Z',
    telefone: '(41) 99999-8888',
    email: 'Contato@Empresa.com',
    ctwa_clid: null,
    valor: null,
    ...p,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any).data[0] as Record<string, any>;

describe('normalizarTelefone', () => {
  it('mantém o número que já vem com código de país', () => {
    assert.equal(normalizarTelefone('5541999998888'), '5541999998888');
  });

  it('acrescenta o 55 no número local de 11 dígitos', () => {
    assert.equal(normalizarTelefone('41999998888'), '5541999998888');
  });

  it('acrescenta o 55 no número local de 10 dígitos', () => {
    assert.equal(normalizarTelefone('4133334444'), '554133334444');
  });

  it('ignora pontuação', () => {
    assert.equal(normalizarTelefone('+55 (41) 99999-8888'), '5541999998888');
  });

  // O caso que motivou o cuidado. Santa Maria e região usam DDD 55, e
  // tirar o "55" da frente por casamento de prefixo transformaria o
  // número no telefone de outra pessoa — em silêncio, porque o hash
  // resultante é tão válido quanto o certo.
  it('não confunde o DDD 55 com o código do país', () => {
    assert.equal(normalizarTelefone('55999998888'), '5555999998888');
    assert.equal(normalizarTelefone('5555999998888'), '5555999998888');
  });

  // Este teste achou um defeito de verdade: onze dígitos podiam ser um
  // celular brasileiro ou um número dos Estados Unidos, e a primeira
  // versão colava um "55" na frente dos dois. O nono dígito desfaz o
  // empate — celular brasileiro sempre tem 9 logo depois do DDD.
  it('não acrescenta o 55 em número estrangeiro de 11 dígitos', () => {
    assert.equal(normalizarTelefone('+1 415 555 2671'), '14155552671');
  });

  it('recusa entrada vazia ou sem dígito', () => {
    assert.equal(normalizarTelefone(null), null);
    assert.equal(normalizarTelefone('   '), null);
    assert.equal(normalizarTelefone('abc'), null);
  });
});

describe('normalizarEmail', () => {
  it('baixa a caixa e apara as pontas', () => {
    assert.equal(normalizarEmail('  Contato@Empresa.COM.BR '), 'contato@empresa.com.br');
  });

  it('recusa o que não é e-mail', () => {
    assert.equal(normalizarEmail('sem arroba'), null);
    assert.equal(normalizarEmail(null), null);
  });
});

describe('montarPayload', () => {
  it('hasheia o telefone JÁ NORMALIZADO', () => {
    const ud = evento().user_data;
    // O hash tem de bater com o número normalizado, não com o digitado.
    assert.equal(ud.ph[0], sha('5541999998888'));
    assert.notEqual(ud.ph[0], sha('(41) 99999-8888'));
  });

  it('hasheia o e-mail em caixa baixa', () => {
    assert.equal(evento().user_data.em[0], sha('contato@empresa.com'));
  });

  // Erro clássico e caro: em milissegundos o evento cai no ano 56000 e é
  // recusado por uma mensagem que não explica o motivo.
  it('manda o horário em segundos', () => {
    const t = evento().event_time as number;
    assert.equal(t, Date.parse('2026-09-01T12:00:00.000Z') / 1000);
    assert.equal(String(t).length, 10);
  });

  it('declara a origem como mensageria de negócio', () => {
    const e = evento();
    // Sem estes dois campos a Meta ignora o ctwa_clid e a atribuição do
    // anúncio de clique-para-WhatsApp simplesmente não acontece.
    assert.equal(e.action_source, 'business_messaging');
    assert.equal(e.messaging_channel, 'whatsapp');
  });

  it('leva o identificador do clique sem hash', () => {
    assert.equal(evento({ ctwa_clid: 'ABC123' }).user_data.ctwa_clid, 'ABC123');
  });

  it('carrega o event_id, que é o que impede contar duas vezes', () => {
    assert.equal(evento().event_id, 'evt-abc');
  });

  it('só manda valor quando há valor', () => {
    assert.equal(evento().custom_data.value, undefined);
    assert.equal(evento().custom_data.currency, undefined);

    const com = evento({ event_name: 'Purchase', valor: '2500.00' }).custom_data;
    assert.equal(com.value, 2500);
    assert.equal(com.currency, 'BRL');
  });

  it('omite a chave em vez de mandar hash de vazio', () => {
    // Hash de string vazia é um valor válido e constante — mandá-lo faria
    // todos os leads sem e-mail parecerem a MESMA pessoa para a Meta.
    const ud = evento({ email: null }).user_data;
    assert.ok(!('em' in ud));
    assert.ok('ph' in ud);
  });
});

describe('test_event_code', () => {
  const base = {
    id: 'l',
    event_id: 'e',
    event_name: 'Lead' as const,
    event_time: '2026-09-01T12:00:00.000Z',
    telefone: '41999998888',
    email: null,
    ctwa_clid: null,
    valor: null,
  };

  it('não aparece em produção', () => {
    assert.ok(!('test_event_code' in montarPayload(base)));
  });

  it('aparece quando configurado', () => {
    const p = montarPayload(base, 'TEST123') as { test_event_code?: string };
    assert.equal(p.test_event_code, 'TEST123');
  });
});
