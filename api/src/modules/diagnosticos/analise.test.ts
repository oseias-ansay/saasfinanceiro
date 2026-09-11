/**
 * Testes da camada que fala com o modelo.
 *
 * Dois grupos, com pesos diferentes.
 *
 * **A privacidade** é uma promessa pública, escrita na página de
 * privacidade do site. Os prompts pedem ao modelo que ignore dados
 * identificáveis, mas pedir não é garantir — quem monta a mensagem é o
 * código. Estes testes são o que transforma a promessa em fato
 * verificável.
 *
 * **A validação da resposta** protege o prospect. O diagnóstico
 * comercial vai embora sem revisão humana: um campo faltando vira um PDF
 * torto na caixa de entrada de alguém que nunca ouviu falar da empresa.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  conferirPrivacidade,
  esquemaAnaliseComercial,
  esquemaAnaliseFinanceira,
  extrairJson,
  limparTextoLivre,
  montarPromptComercial,
  montarPromptFinanceiro,
} from './analise.js';
import { calcularReguaComercial } from '../regua/regua-comercial.js';
import { calcularRegua } from '../regua/regua.js';

/* ==================================================================== */
/* Privacidade                                                           */
/* ==================================================================== */

describe('a guarda de privacidade', () => {
  it('reconhece CNPJ com e sem pontuação', () => {
    assert.deepEqual(conferirPrivacidade('empresa 12.345.678/0001-99'), ['CNPJ']);
    assert.deepEqual(conferirPrivacidade('empresa 12345678000199'), ['CNPJ']);
  });

  it('reconhece CPF, e-mail e telefone', () => {
    assert.deepEqual(conferirPrivacidade('123.456.789-00'), ['CPF']);
    assert.deepEqual(conferirPrivacidade('fale com joao@empresa.com.br'), ['e-mail']);
    assert.deepEqual(conferirPrivacidade('ligue (41) 99999-8888'), ['telefone']);
  });

  it('não acusa falso positivo em texto de negócio', () => {
    const texto = `Faturamento bruto: 250000
Margem líquida: 12,5%
PMR/PMP/PME: 45/30/20 dias
Score: 67 de 100`;
    assert.deepEqual(conferirPrivacidade(texto), []);
  });
});

describe('o prompt comercial não leva dado identificável', () => {
  const regua = calcularReguaComercial({ uso_crm: 'SIM', ticket_medio: 1000, cac_medio: 200 });

  it('limpo no caso normal', () => {
    const p = montarPromptComercial({ setor: 'Comércio', mes_referencia: '08/2026' }, regua);
    assert.deepEqual(conferirPrivacidade(p), []);
    assert.ok(p.includes('Setor: Comércio'));
  });

  it('o CNPJ não entra nem quando alguém o passa junto', () => {
    // O tipo `IdentificacaoPublica` não tem campo de CNPJ, então este é o
    // teste de que a barreira é o tipo e não a boa vontade de quem chama.
    const id = { setor: 'Serviços', mes_referencia: '08/2026', cnpj: '12.345.678/0001-99' };
    const p = montarPromptComercial(id, regua);
    assert.deepEqual(conferirPrivacidade(p), []);
  });

  it('APAGA o CNPJ que o cliente escreveu nas observações', () => {
    // Este é o caso que o prompt sozinho jamais impediria: a instrução
    // fala do que o modelo deve ignorar, não do que ele recebe. Acontece
    // de verdade — gente preenche "observações" com o cartão da empresa.
    const comLixo = calcularReguaComercial({
      observacoes: 'Somos a Padaria X, CNPJ 12.345.678/0001-99, fale no 41999998888',
    });
    const p = montarPromptComercial({ setor: 'Comércio' }, comLixo);

    assert.deepEqual(conferirPrivacidade(p), []);
    assert.ok(p.includes('[CNPJ removido]'));
    assert.ok(p.includes('Somos a Padaria X'), 'o resto da observação continua útil');
  });
});

describe('a limpeza do texto livre', () => {
  it('apaga sem destruir o resto da frase', () => {
    assert.equal(
      limparTextoLivre('me chame em joao@x.com sobre o pedido'),
      'me chame em [e-mail removido] sobre o pedido',
    );
  });

  it('apaga todas as ocorrências, não só a primeira', () => {
    const r = limparTextoLivre('11.111.111/1111-11 e 22.222.222/2222-22');
    assert.equal(r, '[CNPJ removido] e [CNPJ removido]');
  });

  it('texto vazio ou nulo vira string vazia', () => {
    assert.equal(limparTextoLivre(null), '');
    assert.equal(limparTextoLivre(undefined), '');
    assert.equal(limparTextoLivre(''), '');
  });

  it('não mexe em número de negócio', () => {
    // O padrão de telefone tem dez dígitos. Aplicar a limpeza ao prompt
    // inteiro corromperia um faturamento de R$ 1.234.567.890 — por isso
    // ela só vale para o campo de texto livre.
    assert.equal(limparTextoLivre('faturamos 250000 no mes'), 'faturamos 250000 no mes');
  });
});

describe('o prompt financeiro não leva dado identificável', () => {
  const regua = calcularRegua({
    dre: { faturamento_bruto: 250000, despesas_fixas: 80000 },
    caixa: { saldo_caixa_reservas: 120000, pmr_dias: 45 },
  });

  it('limpo com números de negócio', () => {
    const p = montarPromptFinanceiro(
      { setor: 'Indústria', mes_referencia: '08/2026', num_funcionarios: 12 },
      { dre: { faturamento_bruto: 250000 }, qualitativo: { regime_tributario: 'Simples' } },
      regua,
    );
    assert.deepEqual(conferirPrivacidade(p), []);
    assert.ok(p.includes('Regime tributário: Simples'));
    assert.ok(p.includes('Funcionários: 12'));
  });

  it('campo ausente vira "não informado", não "undefined"', () => {
    const p = montarPromptFinanceiro({}, {}, regua);
    assert.ok(!p.includes('undefined'), 'não pode vazar undefined para o modelo');
    assert.ok(p.includes('Setor: não informado'));
  });
});

/* ==================================================================== */
/* Resposta do modelo                                                    */
/* ==================================================================== */

const comercialValida = {
  resumoExecutivo: 'A'.repeat(50),
  avaliacoes: {
    processoEFunil: 'B'.repeat(30),
    geracaoDemanda: 'C'.repeat(30),
    gestaoEEquipe: 'D'.repeat(30),
    posVendaETicket: 'E'.repeat(30),
  },
  gargalosCriticos: ['Gargalo com descrição objetiva'],
  planoDeAcao: [{ prioridade: 'Alta', pilar: 'Funil', acaoRecomendada: 'Ação concreta e datada' }],
  relatorioDetalhadoHtml: '<h2>x</h2>'.padEnd(250, 'z'),
};

describe('extrair o JSON da resposta', () => {
  it('aceita JSON puro', () => {
    assert.deepEqual(extrairJson('{"a":1}'), { a: 1 });
  });

  it('aceita embrulhado em bloco markdown, apesar da instrução', () => {
    assert.deepEqual(extrairJson('```json\n{"a":1}\n```'), { a: 1 });
    assert.deepEqual(extrairJson('```\n{"a":1}\n```'), { a: 1 });
  });

  it('aceita com uma frase antes', () => {
    assert.deepEqual(extrairJson('Claro! Aqui está:\n{"a":1}'), { a: 1 });
  });

  it('falha com mensagem clara quando não há JSON', () => {
    assert.throws(() => extrairJson('não consegui analisar'), /não contém JSON/);
  });
});

describe('a validação é estrita — o comercial vai sem revisão', () => {
  it('aceita a resposta completa', () => {
    assert.doesNotThrow(() => esquemaAnaliseComercial.parse(comercialValida));
  });

  it('recusa avaliação faltando', () => {
    const { geracaoDemanda: _, ...resto } = comercialValida.avaliacoes;
    assert.throws(() => esquemaAnaliseComercial.parse({ ...comercialValida, avaliacoes: resto }));
  });

  it('recusa prioridade fora das três permitidas', () => {
    assert.throws(() =>
      esquemaAnaliseComercial.parse({
        ...comercialValida,
        planoDeAcao: [{ prioridade: 'Urgentíssima', pilar: 'x', acaoRecomendada: 'y'.repeat(20) }],
      }),
    );
  });

  it('recusa plano de ação vazio', () => {
    assert.throws(() => esquemaAnaliseComercial.parse({ ...comercialValida, planoDeAcao: [] }));
  });

  it('recusa relatório curto demais — sinal de resposta truncada', () => {
    // Resposta cortada no meio por limite de tokens é o modo de falha
    // mais provável, e o único que produz um PDF que parece certo.
    assert.throws(() =>
      esquemaAnaliseComercial.parse({ ...comercialValida, relatorioDetalhadoHtml: '<h2>oi</h2>' }),
    );
  });

  it('recusa resumo vazio', () => {
    assert.throws(() => esquemaAnaliseComercial.parse({ ...comercialValida, resumoExecutivo: '' }));
  });

  it('o esquema financeiro cobra os seus próprios pilares', () => {
    assert.throws(() => esquemaAnaliseFinanceira.parse(comercialValida));
  });
});
