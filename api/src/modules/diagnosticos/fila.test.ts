/**
 * Testes da fila das 8h.
 *
 * Dois grupos, e os dois cobrem falhas que já aconteceram de verdade
 * nesta plataforma:
 *
 * 1. **O calendário.** O envio anterior vivia num cron do n8n e o erro
 *    possível era de uma hora, em silêncio. Os casos abaixo insistem no
 *    minuto antes e no minuto depois da janela, na segunda de manhã e na
 *    virada do dia.
 *
 * 2. **O isolamento por item.** O fluxo antigo abortava a execução
 *    inteira quando um nó falhava — um e-mail inválido no meio da fila
 *    custava o relatório de todo mundo que vinha depois. O teste do meio
 *    existe exatamente para travar esse comportamento.
 *
 * Todos os instantes em UTC. São Paulo é UTC-3, então 11:00Z = 08:00 em
 * Brasília.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  devePassar,
  enviarFila,
  textoDaFalhaDaFila,
  type DependenciasFila,
  type ItemDaFila,
} from './fila.js';

const utc = (s: string) => new Date(s);

/* ==================================================================== */
/* O calendário                                                          */
/* ==================================================================== */

describe('devePassar', () => {
  it('não roda antes das 8h', () => {
    // 10:59Z = 07:59 em Brasília, terça.
    assert.equal(devePassar(utc('2026-09-15T10:59:00Z'), null), false);
  });

  it('roda no minuto em que a janela abre', () => {
    assert.equal(devePassar(utc('2026-09-15T11:00:00Z'), null), true);
  });

  it('roda no fim da tarde se ainda não tiver rodado', () => {
    // A janela é "a partir de", não "às 8h em ponto". API que subiu ao
    // meio-dia ainda tem de entregar o relatório do dia.
    assert.equal(devePassar(utc('2026-09-15T20:00:00Z'), null), true);
  });

  it('não roda de novo depois de ter rodado hoje', () => {
    const agora = utc('2026-09-15T14:00:00Z'); // 11h em Brasília
    const rodouAs8 = utc('2026-09-15T11:02:00Z');
    assert.equal(devePassar(agora, rodouAs8), false);
  });

  it('roda de novo no dia seguinte, mesmo com menos de 24h do último', () => {
    // O caso que um "faz 24 horas?" erraria: às 8h05 de quarta, o sucesso
    // das 8h05 de terça tem exatamente 24 horas e mesmo assim é de ontem.
    const agora = utc('2026-09-16T11:05:00Z');
    const ontem = utc('2026-09-15T11:05:00Z');
    assert.equal(devePassar(agora, ontem), true);
  });

  it('não roda no sábado nem no domingo', () => {
    assert.equal(devePassar(utc('2026-09-19T14:00:00Z'), null), false); // sábado
    assert.equal(devePassar(utc('2026-09-20T14:00:00Z'), null), false); // domingo
  });

  it('segunda de manhã recolhe o que ficou para trás na sexta', () => {
    const segunda = utc('2026-09-21T11:00:00Z');
    const ultimoSucesso = utc('2026-09-18T11:00:00Z'); // quinta
    assert.equal(devePassar(segunda, ultimoSucesso, 8), true);
  });

  it('respeita uma hora de janela diferente', () => {
    assert.equal(devePassar(utc('2026-09-15T12:59:00Z'), null, 10), false);
    assert.equal(devePassar(utc('2026-09-15T13:00:00Z'), null, 10), true);
  });

  it('a virada do dia não engana: 02h UTC ainda é ontem em São Paulo', () => {
    // 2026-09-16T02:00Z = 23h de 15/09 em Brasília. Já rodou às 8h de 15.
    const agora = utc('2026-09-16T02:00:00Z');
    const rodouDia15 = utc('2026-09-15T11:00:00Z');
    assert.equal(devePassar(agora, rodouDia15), false);
  });
});

/* ==================================================================== */
/* O envio                                                               */
/* ==================================================================== */

const item = (n: number, email = `lead${n}@exemplo.com`): ItemDaFila => ({
  protocolo: `1234567${n}-X`,
  tipo: 'financeiro',
  razao_social: `Empresa ${n}`,
  email,
  assunto_cliente: 'Seu diagnóstico',
  html_cliente: '<p>oi</p>',
});

interface Espiao {
  dep: DependenciasFila;
  enviados: string[];
  marcados: Array<[string, string]>;
  alarmes: string[];
}

function espiao(
  itens: ItemDaFila[],
  falhar: (protocolo: string) => string | null = () => null,
): Espiao {
  const enviados: string[] = [];
  const marcados: Array<[string, string]> = [];
  const alarmes: string[] = [];

  return {
    enviados,
    marcados,
    alarmes,
    dep: {
      listar: async () => itens,
      pdf: async (protocolo) => {
        const erro = falhar(protocolo);
        if (erro === 'pdf') throw new Error('Chromium não respondeu');
        return { nome: `${protocolo}.pdf`, conteudo: Buffer.from('%PDF') };
      },
      enviarEmail: async (m) => {
        const erro = falhar(m.para);
        if (erro === 'smtp') return { ok: false, erro: 'endereço recusado' };
        enviados.push(m.para);
        return { ok: true, erro: null };
      },
      marcar: async (protocolo, status) => {
        marcados.push([protocolo, status]);
      },
      avisar: async (texto) => {
        alarmes.push(texto);
        return true;
      },
    },
  };
}

describe('enviarFila', () => {
  it('envia todos e marca cada um como enviado', async () => {
    const e = espiao([item(1), item(2), item(3)]);
    const r = await enviarFila(e.dep);

    assert.equal(r.total, 3);
    assert.equal(r.enviados, 3);
    assert.deepEqual(r.falhas, []);
    assert.deepEqual(e.enviados, [
      'lead1@exemplo.com',
      'lead2@exemplo.com',
      'lead3@exemplo.com',
    ]);
    assert.ok(e.marcados.every(([, s]) => s === 'enviado'));
  });

  it('um e-mail recusado no meio NÃO impede os seguintes', async () => {
    // Este é o comportamento que o n8n não tinha. Se algum dia ele voltar
    // a se perder, é aqui que se descobre.
    const e = espiao([item(1), item(2), item(3)], (alvo) =>
      alvo === 'lead2@exemplo.com' ? 'smtp' : null,
    );

    const r = await enviarFila(e.dep);

    assert.equal(r.enviados, 2);
    assert.equal(r.falhas.length, 1);
    assert.equal(r.falhas[0]?.email, 'lead2@exemplo.com');
    assert.deepEqual(e.enviados, ['lead1@exemplo.com', 'lead3@exemplo.com']);
  });

  it('um PDF que estoura também fica isolado', async () => {
    const e = espiao([item(1), item(2)], (alvo) =>
      alvo === '12345672-X' ? 'pdf' : null,
    );

    const r = await enviarFila(e.dep);

    assert.equal(r.enviados, 1);
    assert.equal(r.falhas.length, 1);
    assert.match(r.falhas[0]?.erro ?? '', /Chromium/);
  });

  it('marca como falho quem não saiu, para as tentativas contarem', async () => {
    const e = espiao([item(1)], () => 'smtp');
    await enviarFila(e.dep);
    assert.deepEqual(e.marcados, [['12345671-X', 'falhou']]);
  });

  it('alarma uma vez, com a lista, quando houve falha', async () => {
    const e = espiao([item(1), item(2)], (alvo) =>
      alvo === 'lead1@exemplo.com' ? 'smtp' : null,
    );

    await enviarFila(e.dep);

    assert.equal(e.alarmes.length, 1);
    assert.match(e.alarmes[0] ?? '', /12345671-X/);
    assert.match(e.alarmes[0] ?? '', /lead1@exemplo\.com/);
  });

  it('não alarma quando deu tudo certo', async () => {
    const e = espiao([item(1), item(2)]);
    await enviarFila(e.dep);
    assert.deepEqual(e.alarmes, []);
  });

  it('fila vazia é passada válida, sem alarme', async () => {
    const e = espiao([]);
    const r = await enviarFila(e.dep);

    assert.deepEqual({ total: r.total, enviados: r.enviados }, { total: 0, enviados: 0 });
    assert.deepEqual(e.alarmes, []);
  });

  it('não conseguir ler a fila lança, para a passada contar como falha', async () => {
    const e = espiao([]);
    e.dep.listar = async () => {
      throw new Error('banco indisponível');
    };

    await assert.rejects(() => enviarFila(e.dep), /banco indisponível/);
  });
});

describe('textoDaFalhaDaFila', () => {
  it('traz protocolo e e-mail, que é o que permite agir', () => {
    const t = textoDaFalhaDaFila(
      [{ protocolo: 'ABC-1', email: 'a@b.com', erro: 'recusado' }],
      3,
    );
    assert.match(t, /ABC-1/);
    assert.match(t, /a@b\.com/);
    assert.match(t, /1 de 3/);
  });

  it('corta a lista em cinco para a mensagem continuar legível', () => {
    const muitas = Array.from({ length: 9 }, (_, i) => ({
      protocolo: `P-${i}`,
      email: `x${i}@b.com`,
      erro: 'recusado',
    }));

    const t = textoDaFalhaDaFila(muitas, 9);
    assert.match(t, /e mais 4/);
    assert.equal(t.includes('P-8'), false);
  });
});
