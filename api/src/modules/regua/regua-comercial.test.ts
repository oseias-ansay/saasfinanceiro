/**
 * Testes da régua comercial.
 *
 * A paridade contra o n8n (`scripts/paridade-regua-comercial`) prova que
 * a tradução não mudou nenhum número. Estes testes fazem outra coisa:
 * documentam POR QUE cada regra existe, para que a próxima mudança seja
 * deliberada em vez de acidental.
 *
 * A paridade morre no dia em que o n8n sair do ar. Estes ficam.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calcularReguaComercial, type EntradaComercial } from './regua-comercial.js';

/** Uma empresa que pontua tudo. */
const PERFEITA: EntradaComercial = {
  uso_crm: 'SIM',
  processo_funil_definido: 'SIM',
  nivel_metricas_funil: 'COMPLETO',
  previsibilidade_leads: 'ALTA',
  origem_leads: 'PROPRIA',
  calcula_cac: 'SIM',
  gestao_metas: 'FREQUENTE',
  perfil_vendedores: 'DEDICADA',
  modelo_remuneracao: 'FIXO_MAIS_COMISSAO',
  estrategia_upsell: 'ATIVA',
  pos_venda_estruturado: 'ATIVO',
};

describe('a escala vai de 0 a 100', () => {
  it('tudo no máximo dá exatamente 100', () => {
    const r = calcularReguaComercial(PERFEITA);
    assert.equal(r.score.scoreTotal, 100);
    assert.equal(r.score.nivelMaturidade, 'Operação Escalável');
  });

  it('os quatro pilares somam 100 de teto', () => {
    const p = calcularReguaComercial(PERFEITA).score.pilares;
    assert.equal(p.processoEFunil.max + p.geracaoDemanda.max + p.gestaoEEquipe.max + p.posVendaETicket.max, 100);
  });

  it('formulário vazio dá zero, sem quebrar', () => {
    const r = calcularReguaComercial({});
    assert.equal(r.score.scoreTotal, 0);
    assert.equal(r.score.nivelMaturidade, 'Comercial Não Estruturado');
    assert.equal(r.criterios_zerados.length, 11);
  });

  it('sem argumento nenhum também não quebra', () => {
    assert.equal(calcularReguaComercial().score.scoreTotal, 0);
  });
});

describe('resposta desconhecida vale zero', () => {
  it('opção que não está na tabela não pontua', () => {
    const r = calcularReguaComercial({ ...PERFEITA, uso_crm: 'TALVEZ' });
    assert.equal(r.score.pilares.processoEFunil.detalhe.crm, 0);
    assert.equal(r.score.scoreTotal, 90);
  });

  it('minúscula não pontua — o formulário manda maiúscula', () => {
    assert.equal(calcularReguaComercial({ uso_crm: 'sim' }).score.scoreTotal, 0);
  });

  it('nome de método do protótipo não vira pontuação', () => {
    // `tabela[valor] !== undefined` encontraria `toString` num objeto
    // comum. Se isto falhar, uma resposta esquisita vira uma função e o
    // score fica sem sentido — sem erro nenhum.
    for (const lixo of ['toString', 'constructor', 'valueOf', '__proto__', 'hasOwnProperty']) {
      assert.equal(calcularReguaComercial({ uso_crm: lixo }).score.scoreTotal, 0, lixo);
    }
  });
});

describe('as faixas de classificação', () => {
  const nivelDe = (pontos: number) => {
    // Monta uma entrada que soma exatamente `pontos` usando só o CRM,
    // o funil, as métricas e a previsibilidade.
    const e: EntradaComercial = {};
    let resto = pontos;
    const gasta = (max: number) => {
      const usa = Math.min(max, resto);
      resto -= usa;
      return usa;
    };
    e.uso_crm = gasta(10) === 10 ? 'SIM' : undefined;
    return { e, resto };
  };
  void nivelDe;

  it('85 ou mais: Operação Escalável', () => {
    assert.equal(calcularReguaComercial(PERFEITA).score.nivelMaturidade, 'Operação Escalável');
  });

  it('entre 66 e 84: Comercial em Estruturação', () => {
    // 100 menos os 10 do CRM e os 6 da previsibilidade = 84.
    const r = calcularReguaComercial({ ...PERFEITA, uso_crm: 'NAO', previsibilidade_leads: 'MEDIA' });
    assert.equal(r.score.scoreTotal, 84);
    assert.equal(r.score.nivelMaturidade, 'Comercial em Estruturação');
  });

  it('entre 41 e 65: Comercial Informal', () => {
    const r = calcularReguaComercial({
      uso_crm: 'PARCIAL',
      processo_funil_definido: 'PARCIAL',
      nivel_metricas_funil: 'BASICO',
      previsibilidade_leads: 'MEDIA',
      origem_leads: 'MISTA',
      gestao_metas: 'MENSAL',
      perfil_vendedores: 'HIBRIDA',
      estrategia_upsell: 'REATIVA',
      pos_venda_estruturado: 'REATIVO',
    });
    assert.equal(r.score.scoreTotal, 44);
    assert.equal(r.score.nivelMaturidade, 'Comercial Informal');
  });

  it('abaixo de 41: Comercial Não Estruturado', () => {
    const r = calcularReguaComercial({ uso_crm: 'SIM', processo_funil_definido: 'SIM' });
    assert.equal(r.score.scoreTotal, 20);
    assert.equal(r.score.nivelMaturidade, 'Comercial Não Estruturado');
  });
});

describe('o ranking de oportunidades', () => {
  it('ordena por pontos perdidos, do maior para o menor', () => {
    const r = calcularReguaComercial({});
    const perdidos = r.oportunidades.map((x) => x.perdido);
    assert.deepEqual([...perdidos].sort((a, b) => b - a), perdidos);
    assert.equal(perdidos[0], 12); // previsibilidade é o critério mais caro
  });

  it('não lista critério com pontuação máxima', () => {
    const r = calcularReguaComercial({ ...PERFEITA, uso_crm: 'NAO' });
    assert.equal(r.oportunidades.length, 1);
    assert.equal(r.oportunidades[0]?.criterio, 'Uso de CRM');
  });

  it('pontuação perfeita diz isso em texto, em vez de lista vazia', () => {
    // O texto vai direto para o prompt. Uma string vazia ali faria o
    // modelo ver um cabeçalho sem conteúdo e preencher por conta.
    const r = calcularReguaComercial(PERFEITA);
    assert.equal(r.oportunidades.length, 0);
    assert.match(r.ranking_oportunidades, /Nenhuma/);
  });
});

describe('a relação ticket/CAC', () => {
  it('CAC não informado devolve nulo, não zero', () => {
    const r = calcularReguaComercial({ ticket_medio: 1000 });
    assert.equal(r.contexto.cac_medio, null);
    assert.equal(r.contexto.relacao_ticket_cac, null);
    assert.equal(r.contexto.alerta_cac, null);
  });

  it('CAC zero também devolve nulo — divisão por zero não vira elogio', () => {
    const r = calcularReguaComercial({ ticket_medio: 1000, cac_medio: 0 });
    assert.equal(r.contexto.relacao_ticket_cac, null);
    assert.equal(r.contexto.alerta_cac, null);
  });

  it('abaixo de 1x é crítico', () => {
    const r = calcularReguaComercial({ ticket_medio: 100, cac_medio: 200 });
    assert.equal(r.contexto.relacao_ticket_cac, 0.5);
    assert.match(r.contexto.alerta_cac ?? '', /^CRÍTICO/);
  });

  it('entre 1x e 3x é atenção', () => {
    const r = calcularReguaComercial({ ticket_medio: 250, cac_medio: 100 });
    assert.equal(r.contexto.relacao_ticket_cac, 2.5);
    assert.match(r.contexto.alerta_cac ?? '', /^ATENÇÃO/);
  });

  it('3x ou mais é saudável', () => {
    const r = calcularReguaComercial({ ticket_medio: 300, cac_medio: 100 });
    assert.equal(r.contexto.relacao_ticket_cac, 3);
    assert.match(r.contexto.alerta_cac ?? '', /^SAUDÁVEL/);
  });

  it('arredonda para duas casas', () => {
    const r = calcularReguaComercial({ ticket_medio: 1000, cac_medio: 300 });
    assert.equal(r.contexto.relacao_ticket_cac, 3.33);
  });
});

describe('armadilha conhecida: número em formato brasileiro', () => {
  it('"1.234,56" é lido como ZERO', () => {
    // `Number('1234,56')` é NaN, e o `|| 0` transforma em zero. O
    // resultado é grave: ticket zero contra qualquer CAC produz a
    // mensagem "cada venda nova nasce no prejuízo" num relatório que vai
    // direto para um prospect, sem revisão.
    //
    // Hoje o site não cai nisso — o formulário converte com `toNumber`
    // antes de enviar. O teste existe para que a proteção seja
    // deliberada e não sorte: qualquer outro produtor de payload
    // (Zapier, formulário novo, integração de parceiro) cairia.
    const r = calcularReguaComercial({ ticket_medio: '1234,56', cac_medio: 300 });
    assert.equal(r.contexto.ticket_medio, 0);
    assert.match(r.contexto.alerta_cac ?? '', /^CRÍTICO/);
  });

  it('número em texto simples funciona', () => {
    assert.equal(calcularReguaComercial({ ticket_medio: '890' }).contexto.ticket_medio, 890);
  });
});

describe('observação em branco vira nulo', () => {
  it('string vazia não chega ao prompt como campo vazio', () => {
    assert.equal(calcularReguaComercial({ observacoes: '' }).contexto.observacoes, null);
    assert.equal(calcularReguaComercial({ observacoes: '  x' }).contexto.observacoes, '  x');
  });
});

describe('a tabela que vai para o prompt', () => {
  it('tem uma linha por critério e mostra a resposta', () => {
    const r = calcularReguaComercial(PERFEITA);
    assert.equal(r.tabela_criterios.split('\n').length, 11);
    assert.ok(r.tabela_criterios.includes('Uso de CRM: 10/10 pts (resposta: SIM)'));
  });

  it('resposta ausente aparece como n/d, não como vazio', () => {
    const r = calcularReguaComercial({});
    assert.ok(r.tabela_criterios.includes('(resposta: n/d)'));
  });
});
