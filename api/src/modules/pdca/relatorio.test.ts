/**
 * Testes da leitura do relatório.
 *
 * O caso que governa o arquivo é o do prazo. Toda outra falha aqui é
 * visível — coluna não achada, tabela vazia, título em branco. Prazo
 * adivinhado é invisível: uma data plausível ao lado de um nome de dono,
 * que o consultor aprova na revisão sem desconfiar, e que vira uma
 * cobrança numa data que ninguém combinou.
 *
 * Daí a quantidade de testes sobre recusar data em vez de interpretá-la.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  acharTabelaDeAcoes,
  detectarColunas,
  extrairContexto,
  extrairTabelas,
  lerData,
  lerRelatorio,
  limparCelula,
} from './relatorio.js';

/** Tabela no formato exato do gabarito da skill. */
const TABELA_5W2H = `
| ID | O quê? | Área | Nível | Por quê? (justificativa + origem) | Quem? | Quando? | Como? | Quanto custa? |
|---|---|---|---|---|---|---|---|---|
| **A1** | Separar as contas da empresa das pessoais | Financeiro | 1 | Mistura de PF e PJ impede medir o resultado real \`[DF]\` | Sócio-administrador | 15/10/2026 | Abrir conta PJ e migrar os débitos automáticos | Custo zero |
| **A2** | Implantar controle diário de caixa | Financeiro | 1 | Sem registro não há como projetar \`[DF]\` | Maria (financeiro) | 31/10/2026 | Planilha diária, fechamento semanal | Custo zero |
| **A3** | Renegociar prazo com os três maiores fornecedores | Financeiro | 2 | Ciclo financeiro de 47 dias \`[CALC]\` | Sócio-administrador | Onda 2 | Reunião com proposta de 45 dias | \`[A ORÇAR]\` |
`;

const RELATORIO = `# RELATÓRIO DE PLANO DE AÇÃO — BUSINESS TRIAGE + PDCA INTEGRADO

**CNPJ:** 00.000.000/0001-00 · **Setor:** Combustíveis

## Fontes primárias (Fonte Única da Verdade)

| Cód. | Documento | Referência | Score | Protocolo |
|---|---|---|---|---|
| **[DF]** | Diagnóstico Financeiro — Auto Posto | 2026-09 | 54/100 — crítica | ABC-123 |

## 1. Sumário executivo e triagem

### 1.1 Quadro clínico

A empresa não tem problema de margem. Tem problema de giro.

> **O ciclo financeiro de 47 dias é a trava.** O estoque responde por 31 deles.

### 1.2 Classificação

Situação **crítica**: resultado positivo, caixa negativo.

## 2. Seção 2 — 🔴 DO
${TABELA_5W2H}

## 3. Seção 2 — 🟡 CHECK

| KPI | Tipo | Linha de base | Meta | Frequência | Fonte | KPI financeiro que movimenta |
|---|---|---|---|---|---|---|
| Dias de estoque | Resultado | 31 | 20 | Mensal | Controle | Ciclo financeiro |
`;

describe('a limpeza das células', () => {
  it('tira negrito, código e emoji de marcação', () => {
    assert.equal(limparCelula('**A1**'), 'A1');
    assert.equal(limparCelula('`[A ORÇAR]`'), '[A ORÇAR]');
    assert.equal(limparCelula('🔴 Emergencial'), 'Emergencial');
  });

  it('colapsa espaço e apara as pontas', () => {
    assert.equal(limparCelula('  dois   espaços  '), 'dois espaços');
  });
});

describe('a extração de tabelas', () => {
  it('acha todas as tabelas do documento', () => {
    // Fontes primárias, 5W2H e KPIs.
    assert.equal(extrairTabelas(RELATORIO).length, 3);
  });

  it('não confunde texto com tabela', () => {
    assert.deepEqual(extrairTabelas('Uma frase | com barra, mas sem separadora.'), []);
  });

  it('para a tabela na primeira linha em branco', () => {
    const t = extrairTabelas(`| a | b |\n|---|---|\n| 1 | 2 |\n\n| 3 | 4 |`);
    assert.equal(t.length, 1);
    assert.equal(t[0]?.linhas.length, 1);
  });
});

describe('a detecção de colunas', () => {
  it('reconhece os nove cabeçalhos do gabarito', () => {
    const c = detectarColunas([
      'ID', 'O quê?', 'Área', 'Nível', 'Por quê? (justificativa + origem)',
      'Quem?', 'Quando?', 'Como?', 'Quanto custa?',
    ]);
    assert.equal(c.id, 0);
    assert.equal(c.titulo, 1);
    assert.equal(c.pilar, 2);
    assert.equal(c.nivel, 3);
    assert.equal(c.detalhe, 4);
    assert.equal(c.responsavel, 5);
    assert.equal(c.prazo, 6);
    assert.equal(c.como, 7);
    assert.equal(c.custo, 8);
  });

  /**
   * O gabarito diz que colunas podem ser acrescentadas, e que suprimir
   * exige justificar — a ordem varia de relatório para relatório. Por
   * isso o reconhecimento é por nome, nunca por posição.
   */
  it('funciona com as colunas em outra ordem e com extras', () => {
    const c = detectarColunas(['Quando?', 'Observação', 'O quê?', 'Quem?']);
    assert.equal(c.prazo, 0);
    assert.equal(c.titulo, 2);
    assert.equal(c.responsavel, 3);
  });

  it('aceita os sinônimos que um relatório à mão produz', () => {
    const c = detectarColunas(['Ação', 'Responsável', 'Prazo']);
    assert.equal(c.titulo, 0);
    assert.equal(c.responsavel, 1);
    assert.equal(c.prazo, 2);
  });

  /** "custo" está dentro de "quanto custa"; a igualdade exata resolve
   *  antes de o prefixo roubar a coluna errada. */
  it('não troca "Como?" por "Quanto custa?"', () => {
    const c = detectarColunas(['Como?', 'Quanto custa?']);
    assert.equal(c.como, 0);
    assert.equal(c.custo, 1);
  });

  it('coluna ausente fica ausente, sem palpite por posição', () => {
    const c = detectarColunas(['O quê?', 'Observação']);
    assert.equal(c.responsavel, undefined);
    assert.equal(c.prazo, undefined);
  });
});

describe('a leitura de data', () => {
  it('aceita dd/mm/aaaa e aaaa-mm-dd', () => {
    assert.equal(lerData('15/10/2026'), '2026-10-15');
    assert.equal(lerData('2026-10-15'), '2026-10-15');
    assert.equal(lerData('1/3/2026'), '2026-03-01');
  });

  /**
   * O gabarito admite período em "Quando?": "Onda 2", "Out/2026",
   * "[definido neste plano]". Nenhum vira data. Mês sem dia não é
   * chutado para o dia 1 nem para o último — a diferença entre 01/10 e
   * 31/10 é um mês inteiro de cobrança.
   */
  it('recusa tudo que não é data completa', () => {
    for (const v of [
      'Onda 2', 'Out/2026', '10/2026', '30 dias', 'imediato',
      '[definido neste plano]', 'até o fim do mês', '', '   ',
    ]) {
      assert.equal(lerData(v), null, `deveria recusar: ${v}`);
    }
  });

  /** `01/10/26` é 2026 em quase todo contexto — e "quase" não serve
   *  para um prazo com nome de dono ao lado. */
  it('recusa ano de dois dígitos', () => {
    assert.equal(lerData('01/10/26'), null);
  });

  it('recusa data que não existe', () => {
    assert.equal(lerData('31/02/2026'), null);
    assert.equal(lerData('32/01/2026'), null);
    assert.equal(lerData('15/13/2026'), null);
  });
});

describe('achar a tabela de ações', () => {
  /**
   * O relatório tem muitas tabelas, e várias têm "Área" ou
   * "Responsável" — GUT, KPIs, gatilhos, POPs, RACI. Só a de ações tem o
   * par "o quê" com "quem" ou "quando".
   */
  it('escolhe a 5W2H entre as outras tabelas do relatório', () => {
    const t = acharTabelaDeAcoes(extrairTabelas(RELATORIO));
    assert.ok(t);
    assert.equal(t?.linhas.length, 3);
    assert.ok(t?.cabecalho.includes('O quê?'));
  });

  it('devolve nulo quando não há tabela de ações', () => {
    assert.equal(acharTabelaDeAcoes(extrairTabelas('| KPI | Meta |\n|---|---|\n| x | y |')), null);
  });

  /** A tabela de POPs também casa com o critério, e é sempre menor. */
  it('entre candidatas, fica com a de mais linhas', () => {
    const doc = `
| Cód. | POP | Área | Responsável | Prazo |
|---|---|---|---|---|
| POP-F01 | Fechamento de caixa | Financeiro | Maria | 30/10/2026 |

${TABELA_5W2H}`;
    assert.equal(acharTabelaDeAcoes(extrairTabelas(doc))?.linhas.length, 3);
  });
});

describe('a leitura completa', () => {
  it('extrai as três ações com os campos nos lugares certos', () => {
    const r = lerRelatorio(RELATORIO);
    assert.equal(r.acoes.length, 3);

    const a1 = r.acoes[0]!;
    assert.equal(a1.codigo, 'A1');
    assert.equal(a1.titulo, 'Separar as contas da empresa das pessoais');
    assert.equal(a1.pilar, 'Financeiro');
    assert.equal(a1.responsavel_nome, 'Sócio-administrador');
    assert.equal(a1.prazo, '2026-10-15');
    assert.deepEqual(a1.faltando, []);
    assert.match(a1.detalhe ?? '', /Mistura de PF e PJ/);
    assert.match(a1.detalhe ?? '', /Como: Abrir conta PJ/);
    assert.match(a1.detalhe ?? '', /Custo: Custo zero/);
  });

  /**
   * A A3 tem "Onda 2" em Quando?. Ela entra na lista, com o prazo em
   * branco e marcado — e o texto original preservado, para a tela poder
   * mostrar o que o relatório dizia.
   */
  it('a ação sem data completa entra marcada, não descartada', () => {
    const a3 = lerRelatorio(RELATORIO).acoes[2]!;
    assert.equal(a3.prazo, null);
    assert.equal(a3.prazo_original, 'Onda 2');
    assert.deepEqual(a3.faltando, ['prazo']);
  });

  it('avisa quantas ações ficaram sem prazo', () => {
    assert.ok(lerRelatorio(RELATORIO).avisos.some((a) => /1 ação está sem data/.test(a)));
  });

  it('marca o responsável ausente', () => {
    const r = lerRelatorio(`
| O quê? | Quem? | Quando? |
|---|---|---|
| Fazer algo | — | 10/10/2026 |`);
    assert.equal(r.acoes[0]?.responsavel_nome, null);
    assert.deepEqual(r.acoes[0]?.faltando, ['responsavel_nome']);
  });

  it('ignora linha sem o campo "O quê?"', () => {
    const r = lerRelatorio(`
| O quê? | Quem? | Quando? |
|---|---|---|
| Fazer algo | Maria | 10/10/2026 |
| | | Subtotal |`);
    assert.equal(r.acoes.length, 1);
  });

  it('corta o título em 200 caracteres, que é o limite do banco', () => {
    const r = lerRelatorio(`
| O quê? | Quem? | Quando? |
|---|---|---|
| ${'a'.repeat(300)} | Maria | 10/10/2026 |`);
    assert.equal(r.acoes[0]?.titulo.length, 200);
  });

  it('texto vazio devolve aviso em vez de lançar', () => {
    assert.deepEqual(lerRelatorio('').acoes, []);
    assert.equal(lerRelatorio('').avisos.length, 1);
  });

  it('documento sem tabela de ações avisa e não lança', () => {
    const r = lerRelatorio('# Só um título\n\nE um parágrafo.');
    assert.equal(r.acoes.length, 0);
    assert.ok(r.avisos.some((a) => /tabela de ações/.test(a)));
  });
});

describe('o contexto', () => {
  it('pega o sumário executivo e para na seção seguinte', () => {
    const c = extrairContexto(RELATORIO);
    assert.ok(c);
    assert.match(c!, /não tem problema de margem/);
    assert.match(c!, /ciclo financeiro de 47 dias/);
    // A tabela de ações é da seção 2 e não pode entrar no contexto.
    assert.doesNotMatch(c!, /Separar as contas/);
  });

  it('inclui as subseções do sumário', () => {
    assert.match(extrairContexto(RELATORIO)!, /Classificação/);
  });

  it('devolve nulo quando não há sumário', () => {
    assert.equal(extrairContexto('# Título\n\n## Outra coisa\n\nTexto.'), null);
  });

  /** O limite é o da coluna (SQL 57). Cortar no meio de um número é pior
   *  que cortar antes — então o corte procura a quebra de parágrafo. */
  it('corta na quebra de parágrafo quando passa do limite', () => {
    const doc = `## Sumário executivo\n\n${'x'.repeat(400)}\n\n${'y'.repeat(400)}`;
    const c = extrairContexto(doc, 500);
    assert.ok(c!.length <= 500);
    assert.ok(!c!.includes('y'), 'deveria ter cortado antes do segundo parágrafo');
  });
});
