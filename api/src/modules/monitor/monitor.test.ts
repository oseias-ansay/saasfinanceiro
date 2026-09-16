/**
 * Testes do vigia.
 *
 * Este módulo é o que avisa quando algo parou. Se ele estiver errado, o
 * erro é do tipo mais perigoso da plataforma: um vigia que cala quando
 * devia gritar é pior que vigia nenhum, porque cria confiança falsa.
 *
 * Por isso os casos abaixo insistem nas bordas do calendário — segunda
 * de manhã, virada de mês, o minuto antes e o minuto depois do prazo. É
 * onde uma conta de fuso erra por uma hora e ninguém percebe.
 *
 * Todos os instantes estão em UTC. São Paulo é UTC-3, então 11:00Z = 08:00
 * na hora de Brasília.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  avaliar,
  textoDoAlarme,
  textoDoPulso,
  ultimoPrazo,
  type Processo,
} from './monitor.js';
import { diasAntes, ehFimDeSemana, emSaoPaulo, instanteEmSaoPaulo } from './relogio.js';

const utc = (s: string) => new Date(s);

describe('o relógio de São Paulo', () => {
  it('converte instante em hora local', () => {
    const p = emSaoPaulo(utc('2026-09-11T11:00:00Z'));
    assert.deepEqual(
      { ano: p.ano, mes: p.mes, dia: p.dia, hora: p.hora },
      { ano: 2026, mes: 9, dia: 11, hora: 8 },
    );
    assert.equal(p.diaSemana, 5); // sexta
  });

  it('vira o dia corretamente: 02h UTC ainda é o dia anterior em SP', () => {
    const p = emSaoPaulo(utc('2026-09-11T02:00:00Z'));
    assert.equal(p.dia, 10);
    assert.equal(p.hora, 23);
  });

  it('monta o instante a partir do relógio de parede', () => {
    assert.equal(
      instanteEmSaoPaulo(2026, 9, 11, 8).toISOString(),
      '2026-09-11T11:00:00.000Z',
    );
  });

  it('ida e volta não perde nada, hora a hora do dia', () => {
    for (let h = 0; h < 24; h++) {
      const d = instanteEmSaoPaulo(2026, 9, 11, h);
      assert.equal(emSaoPaulo(d).hora, h, `falhou em ${h}h`);
    }
  });

  it('reconhece fim de semana', () => {
    assert.equal(ehFimDeSemana(emSaoPaulo(utc('2026-09-12T15:00:00Z'))), true); // sábado
    assert.equal(ehFimDeSemana(emSaoPaulo(utc('2026-09-13T15:00:00Z'))), true); // domingo
    assert.equal(ehFimDeSemana(emSaoPaulo(utc('2026-09-14T15:00:00Z'))), false); // segunda
  });

  it('anda para trás atravessando a virada de mês', () => {
    const p = emSaoPaulo(utc('2026-10-01T15:00:00Z'));
    const anterior = diasAntes(p, 1);
    assert.deepEqual(
      { ano: anterior.ano, mes: anterior.mes, dia: anterior.dia },
      { ano: 2026, mes: 9, dia: 30 },
    );
  });
});

describe('prazo de processo diário', () => {
  const exp = { tipo: 'diario', hora: 3, toleranciaMin: 60 } as const;

  it('antes da hora, cobra o dia anterior', () => {
    // 01h de SP: o das 3h de hoje ainda não venceu.
    const r = ultimoPrazo(exp, utc('2026-09-11T04:00:00Z'));
    assert.equal(r?.limite.toISOString(), '2026-09-10T07:00:00.000Z'); // 04h SP do dia 10
  });

  it('depois da hora mais tolerância, cobra o de hoje', () => {
    const r = ultimoPrazo(exp, utc('2026-09-11T12:00:00Z')); // 09h SP
    assert.equal(r?.limite.toISOString(), '2026-09-11T07:00:00.000Z');
  });

  it('o início da janela é a hora marcada, sem a tolerância', () => {
    const r = ultimoPrazo(exp, utc('2026-09-11T12:00:00Z'));
    assert.equal(r?.inicio.toISOString(), '2026-09-11T06:00:00.000Z'); // 03h SP
    // A distância entre os dois é exatamente a tolerância.
    assert.equal((r!.limite.getTime() - r!.inicio.getTime()) / 60_000, 60);
  });

  it('o minuto antes e o minuto depois do prazo caem em dias diferentes', () => {
    const antes = ultimoPrazo(exp, utc('2026-09-11T06:59:00Z'));
    const depois = ultimoPrazo(exp, utc('2026-09-11T07:01:00Z'));
    assert.equal(emSaoPaulo(antes!.limite).dia, 10);
    assert.equal(emSaoPaulo(depois!.limite).dia, 11);
  });
});

describe('prazo de processo de dias úteis — a borda da segunda-feira', () => {
  const exp = { tipo: 'diasUteis', hora: 8, toleranciaMin: 45 } as const;

  it('na segunda de manhã, o último prazo é o de SEXTA', () => {
    // Segunda, 14/09/2026, 07h de SP — antes do prazo de hoje.
    const r = ultimoPrazo(exp, utc('2026-09-14T10:00:00Z'));
    const p = emSaoPaulo(r!.limite);
    assert.equal(p.dia, 11); // sexta
    assert.equal(p.diaSemana, 5);
  });

  it('no domingo, também cobra sexta — e não o sábado', () => {
    const r = ultimoPrazo(exp, utc('2026-09-13T15:00:00Z'));
    assert.equal(emSaoPaulo(r!.limite).dia, 11);
  });

  it('na segunda depois das 8h45, cobra a própria segunda', () => {
    const r = ultimoPrazo(exp, utc('2026-09-14T12:00:00Z'));
    assert.equal(emSaoPaulo(r!.limite).dia, 14);
  });
});

describe('prazo de processo mensal', () => {
  const exp = { tipo: 'mensal', dia: 5, hora: 8, toleranciaMin: 240 } as const;

  it('no dia 2, ainda cobra o mês anterior', () => {
    const r = ultimoPrazo(exp, utc('2026-09-02T15:00:00Z'));
    const p = emSaoPaulo(r!.limite);
    assert.equal(p.mes, 8);
    assert.equal(p.dia, 5);
  });

  it('no dia 6, cobra este mês', () => {
    const r = ultimoPrazo(exp, utc('2026-09-06T15:00:00Z'));
    assert.equal(emSaoPaulo(r!.limite).mes, 9);
  });

  it('em janeiro, o mês anterior é dezembro do ano passado', () => {
    const r = ultimoPrazo(exp, utc('2026-01-02T15:00:00Z'));
    const p = emSaoPaulo(r!.limite);
    assert.equal(p.mes, 12);
    assert.equal(p.ano, 2025);
  });
});

describe('prazo de processo por intervalo', () => {
  it('cobra o intervalo mais a tolerância para trás', () => {
    const agora = utc('2026-09-11T12:00:00Z');
    const r = ultimoPrazo({ tipo: 'intervalo', minutos: 15, toleranciaMin: 30 }, agora);
    assert.equal(r?.inicio.toISOString(), '2026-09-11T11:15:00.000Z');
    // Processo de intervalo está sempre vencido: não há hora marcada a
    // esperar, ele deveria estar rodando o tempo todo.
    assert.equal(r?.limite.toISOString(), agora.toISOString());
  });
});

describe('a avaliação', () => {
  const proc: Processo = {
    chave: 'teste',
    nome: 'Processo de teste',
    expectativa: { tipo: 'diario', hora: 3, toleranciaMin: 60 },
    consequencia: 'Nada, é teste.',
  };
  const agora = utc('2026-09-11T12:00:00Z'); // 09h SP, prazo de hoje já venceu

  it('em dia quando rodou depois do prazo', () => {
    const r = avaliar(agora, { teste: utc('2026-09-11T07:30:00Z') }, [proc]);
    assert.equal(r[0]?.atrasado, false);
    assert.equal(r[0]?.atrasoMin, null);
  });

  /**
   * A regressão de 16/09/2026.
   *
   * O vigia exigia que o sucesso fosse posterior a hora+tolerância, então
   * quem rodava PONTUALMENTE ficava marcado como atrasado — o dia
   * inteiro, todo dia. O envio dos diagnósticos rodou às 8h03, entregou
   * tudo, e mesmo assim disparou alarme às 8h45.
   *
   * Os testes antigos não pegaram porque todos usavam execuções DEPOIS da
   * tolerância. O caso do processo bem-comportado nunca foi escrito.
   */
  it('PONTUAL não é atrasado: rodou às 3h05, tolerância até 4h', () => {
    // 06:05Z = 03h05 em SP. A janela abre às 3h, o limite é 4h.
    const r = avaliar(agora, { teste: utc('2026-09-11T06:05:00Z') }, [proc]);
    assert.equal(r[0]?.atrasado, false);
    assert.equal(r[0]?.atrasoMin, null);
  });

  it('no minuto exato da janela também conta', () => {
    const r = avaliar(agora, { teste: utc('2026-09-11T06:00:00Z') }, [proc]);
    assert.equal(r[0]?.atrasado, false);
  });

  it('um minuto ANTES da janela não conta — é a execução de ontem', () => {
    const r = avaliar(agora, { teste: utc('2026-09-11T05:59:00Z') }, [proc]);
    assert.equal(r[0]?.atrasado, true);
  });

  it('o atraso é contado a partir do limite, não do início da janela', () => {
    // Nunca rodou. Agora são 09h SP; o limite de hoje foi 04h SP.
    const r = avaliar(agora, {}, [proc]);
    assert.equal(r[0]?.atrasoMin, 300); // 5h, e não 6h
  });

  it('atrasado quando a última execução é anterior ao prazo', () => {
    const r = avaliar(agora, { teste: utc('2026-09-10T07:30:00Z') }, [proc]);
    assert.equal(r[0]?.atrasado, true);
    assert.equal(r[0]?.atrasoMin, 300); // 5h desde as 04h SP
  });

  it('NUNCA ter rodado conta como atrasado', () => {
    // O caso mais fácil de deixar escapar: agendamento que jamais
    // funcionou não gera erro nenhum e ficaria invisível para sempre.
    const r = avaliar(agora, {}, [proc]);
    assert.equal(r[0]?.atrasado, true);
    assert.equal(r[0]?.ultimoSucesso, null);
  });

  it('sem prazo vencido, não cobra mesmo sem execução', () => {
    const mensal: Processo = {
      ...proc,
      expectativa: { tipo: 'diasUteis', hora: 8, toleranciaMin: 45 },
    };
    // Instante muito antigo, antes de qualquer dia útil na janela de busca:
    // a função devolve null e nada é cobrado.
    const r = avaliar(agora, { teste: utc('2026-09-11T12:00:00Z') }, [mensal]);
    assert.equal(r[0]?.atrasado, false);
  });
});

describe('os textos', () => {
  const proc: Processo = {
    chave: 'diagnosticos.envio',
    nome: 'Envio dos diagnósticos das 8h',
    expectativa: { tipo: 'diario', hora: 8, toleranciaMin: 45 },
    consequencia: 'Prospects não recebem o relatório prometido.',
  };
  const agora = utc('2026-09-11T15:00:00Z');

  it('o alarme diz o que parou, há quanto tempo e o que isso custa', () => {
    const s = avaliar(agora, {}, [proc]).filter((x) => x.atrasado);
    const t = textoDoAlarme(s, agora);

    assert.ok(t.includes('Envio dos diagnósticos das 8h'));
    assert.ok(t.includes('Prospects não recebem'));
    assert.match(t, /parado há \d+h\d{2}/);
  });

  it('o pulso diz quantos estão em dia e por que ele existe', () => {
    const t = textoDoPulso(avaliar(agora, { 'diagnosticos.envio': agora }, [proc]), agora);
    assert.ok(t.includes('1 de 1'));
    assert.ok(t.includes('parar de chegar'));
  });
});

describe('o catálogo', () => {
  it('não tem chave repetida — duas entradas com a mesma chave fariam uma calar a outra', async () => {
    const { PROCESSOS } = await import('./monitor.js');
    const chaves = PROCESSOS.map((p) => p.chave);
    assert.equal(new Set(chaves).size, chaves.length);
  });

  it('todo processo explica a consequência de parar', async () => {
    const { PROCESSOS } = await import('./monitor.js');
    for (const p of PROCESSOS) {
      assert.ok(p.consequencia.length > 20, `${p.chave} sem consequência útil`);
    }
  });
});
