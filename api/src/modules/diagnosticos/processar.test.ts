/**
 * Testes da orquestração do diagnóstico.
 *
 * Verificam a ORDEM e o ISOLAMENTO — as duas propriedades que os fluxos
 * do n8n não tinham.
 *
 * A propriedade central: **nada é entregue antes de estar gravado, e
 * falha na entrega não apaga o que já foi calculado.** No fluxo antigo,
 * uma falha ao baixar o PDF matava o envio, a marcação, o arquivamento e
 * o aviso interno de uma vez — o prospect não recebia nada e ninguém
 * ficava sabendo.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  POLITICA_ENVIO,
  processarDiagnostico,
  type Dependencias,
  type DadosLead,
} from './processar.js';
import { calcularReguaComercial } from '../regua/regua-comercial.js';
import { calcularRegua } from '../regua/regua.js';

const LEAD: DadosLead = {
  razao_social: 'Padaria Exemplo',
  cnpj: '12.345.678/0001-99',
  email: 'dono@padaria.com.br',
  setor: 'Comércio',
  mes_referencia: '08/2026',
};

const ANALISE = {
  resumoExecutivo: 'A'.repeat(50),
  avaliacoes: {
    processoEFunil: 'B'.repeat(30),
    geracaoDemanda: 'C'.repeat(30),
    gestaoEEquipe: 'D'.repeat(30),
    posVendaETicket: 'E'.repeat(30),
  },
  gargalosCriticos: ['Gargalo com descrição'],
  planoDeAcao: [{ prioridade: 'Alta' as const, pilar: 'Funil', acaoRecomendada: 'Ação concreta' }],
  relatorioDetalhadoHtml: '<h2>x</h2>'.padEnd(250, 'z'),
};

function deps(over: Partial<Dependencias> = {}) {
  const ordem: string[] = [];
  const emails: Array<Record<string, unknown>> = [];

  const base: Dependencias = {
    calcular: (tipo, entrada) => {
      ordem.push('calcular');
      return tipo === 'comercial' ? calcularReguaComercial(entrada) : calcularRegua(entrada);
    },
    montarPrompt: () => {
      ordem.push('prompt');
      return 'prompt';
    },
    analisar: async () => {
      ordem.push('analisar');
      return ANALISE;
    },
    gravar: async () => {
      ordem.push('gravar');
      return {
        protocolo: '12345678-CABC',
        assunto_cliente: 'Seu diagnóstico',
        html_cliente: '<p>oi</p>',
        liberar_em: '2026-09-14T11:00:00.000Z',
        hold_token: 'tok',
      };
    },
    pdf: async (_p, interno) => {
      ordem.push(interno ? 'pdf-interno' : 'pdf');
      return { nome: 'rel.pdf', conteudo: Buffer.from('%PDF') };
    },
    enviarEmail: async (m) => {
      ordem.push(`email:${m.para || 'interno'}`);
      emails.push(m as unknown as Record<string, unknown>);
      return { ok: true, erro: null };
    },
    marcarEnviado: async () => {
      ordem.push('marcar');
    },
    avisoInterno: () => ({ para: 'contato@bt.com.br', assunto: 'interno', html: '<p>i</p>' }),
    confirmacaoAoLead: () => ({ assunto: 'recebemos', html: '<p>c</p>' }),
    ...over,
  };

  return { dep: base, ordem, emails };
}

describe('as duas políticas são explícitas', () => {
  it('comercial sai na hora, financeiro espera a janela', () => {
    assert.equal(POLITICA_ENVIO.comercial, 'imediato');
    assert.equal(POLITICA_ENVIO.financeiro, 'janela');
  });
});

describe('comercial — envio imediato', () => {
  it('calcula, analisa, GRAVA e só então entrega', async () => {
    const { dep, ordem } = deps();
    const r = await processarDiagnostico('comercial', LEAD, { uso_crm: 'SIM' }, dep);

    assert.equal(r.ok, true);
    assert.equal(r.politica, 'imediato');
    assert.equal(r.relatorio_enviado, true);
    assert.equal(r.score, 10);

    // `gravar` antes de qualquer `email` não é detalhe: invertido,
    // existiria cliente com relatório na mão e nenhum rastro nosso.
    assert.ok(ordem.indexOf('gravar') < ordem.indexOf('email:dono@padaria.com.br'));
    assert.deepEqual(ordem, [
      'calcular',
      'prompt',
      'analisar',
      'gravar',
      'pdf',
      'email:dono@padaria.com.br',
      'marcar',
      'email:contato@bt.com.br',
    ]);
  });

  it('anexa o PDF ao e-mail do cliente', async () => {
    const { dep, emails } = deps();
    await processarDiagnostico('comercial', LEAD, {}, dep);
    const aoCliente = emails.find((e) => e.para === LEAD.email);
    assert.equal((aoCliente?.anexos as unknown[])?.length, 1);
  });

  it('não manda confirmação — o relatório já foi', async () => {
    const { dep } = deps();
    const r = await processarDiagnostico('comercial', LEAD, {}, dep);
    assert.equal(r.confirmacao_enviada, false);
  });
});

describe('financeiro — janela das 8h', () => {
  it('manda confirmação e NÃO manda o relatório', async () => {
    const { dep, ordem } = deps();
    const r = await processarDiagnostico('financeiro', LEAD, { dre: { faturamento_bruto: 100000 } }, dep);

    assert.equal(r.politica, 'janela');
    assert.equal(r.relatorio_enviado, false);
    assert.equal(r.confirmacao_enviada, true);
    assert.ok(!ordem.includes('pdf'), 'não deve renderizar PDF agora');
    assert.ok(!ordem.includes('marcar'), 'não pode marcar como enviado');
  });
});

describe('isolamento de falhas — o defeito do n8n', () => {
  it('o PDF falhar NÃO impede o aviso interno', async () => {
    const { dep, ordem } = deps({
      pdf: async () => {
        throw new Error('chromium fora do ar');
      },
    });

    const r = await processarDiagnostico('comercial', LEAD, {}, dep);

    // No fluxo antigo isto matava tudo que vinha depois.
    assert.equal(r.relatorio_enviado, false);
    assert.equal(r.aviso_interno_enviado, true);
    assert.equal(r.protocolo, '12345678-CABC');
    assert.ok(r.falhas[0]?.includes('chromium'));
    assert.ok(ordem.includes('email:contato@bt.com.br'));
  });

  it('o e-mail ao cliente falhar NÃO marca como enviado', async () => {
    // Marcar sem ter enviado é pior que não marcar: o relatório some da
    // fila e ninguém nunca o recebe.
    const { dep, ordem } = deps({
      enviarEmail: async (m) => {
        ordem.push(`email:${m.para || 'interno'}`);
        if (m.para === LEAD.email) return { ok: false, erro: 'caixa cheia' };
        return { ok: true, erro: null };
      },
    });

    const r = await processarDiagnostico('comercial', LEAD, {}, dep);
    assert.equal(r.relatorio_enviado, false);
    assert.ok(!ordem.includes('marcar'));
    assert.ok(r.falhas.some((f) => f.includes('caixa cheia')));
  });

  it('a marcação falhar é registrada como RISCO DE ENVIO DUPLICADO', async () => {
    // O cliente já recebeu, o registro continua pendente, e a fila das 8h
    // mandaria de novo. É exatamente o que acontecia no n8n, calado.
    const { dep } = deps({
      marcarEnviado: async () => {
        throw new Error('banco fora');
      },
    });

    const r = await processarDiagnostico('comercial', LEAD, {}, dep);
    assert.equal(r.relatorio_enviado, true);
    assert.ok(r.falhas.some((f) => f.includes('ENVIO DUPLICADO')));
    assert.equal(r.ok, false);
  });

  it('o aviso interno falhar não derruba o resultado do cliente', async () => {
    const { dep } = deps({
      avisoInterno: () => {
        throw new Error('template quebrado');
      },
    });

    const r = await processarDiagnostico('comercial', LEAD, {}, dep);
    assert.equal(r.relatorio_enviado, true);
    assert.equal(r.aviso_interno_enviado, false);
  });
});

describe('o que NÃO pode ser engolido', () => {
  it('falha na régua interrompe — não há diagnóstico a entregar', async () => {
    const { dep } = deps({
      calcular: () => {
        throw new Error('entrada impossível');
      },
    });
    await assert.rejects(() => processarDiagnostico('comercial', LEAD, {}, dep), /entrada impossível/);
  });

  it('falha na análise interrompe — relatório sem texto é produto errado', async () => {
    const { dep, ordem } = deps({
      analisar: async () => {
        throw new Error('Claude recusou');
      },
    });
    await assert.rejects(() => processarDiagnostico('comercial', LEAD, {}, dep), /Claude recusou/);

    // E nada foi gravado nem enviado: sem análise não existe diagnóstico.
    assert.ok(!ordem.includes('gravar'));
    assert.ok(!ordem.some((o) => o.startsWith('email')));
  });
});

describe('o aviso interno recebe o que deu errado', () => {
  it('as falhas dos passos anteriores chegam ao aviso', async () => {
    let recebidas: string[] = [];
    const { dep } = deps({
      pdf: async () => {
        throw new Error('chromium fora do ar');
      },
      avisoInterno: (ctx) => {
        recebidas = ctx.falhas;
        return { para: 'contato@bt.com.br', assunto: 'x', html: 'y' };
      },
    });

    await processarDiagnostico('comercial', LEAD, {}, dep);
    assert.ok(recebidas.some((f) => f.includes('chromium')));
  });
});
