/**
 * Testes da leitura da planilha de produtos.
 *
 * O caso que mais importa é o do branco. Preencher com zero em silêncio
 * é o defeito caro: custo zero vira margem de 100%, o número fica bonito
 * e ninguém desconfia. Branco tem de voltar como branco.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectarColunas, lerPlanilha, numeroBR, type LinhaBruta } from './planilha.js';

describe('o número como o brasileiro digita', () => {
  it('lê o formato com milhar e decimal', () => {
    assert.equal(numeroBR('1.234,56'), 1234.56);
    assert.equal(numeroBR('R$ 1.234,56'), 1234.56);
    assert.equal(numeroBR('12,5%'), 12.5);
  });

  it('número puro passa direto', () => {
    assert.equal(numeroBR(1234.56), 1234.56);
    assert.equal(numeroBR(0), 0);
  });

  /**
   * Sem vírgula, o ponto é decimal. Um CSV gerado em inglês traz 10.50,
   * e tratar o ponto como milhar viraria 1050 — cem vezes o preço.
   */
  it('sem vírgula, o ponto é decimal', () => {
    assert.equal(numeroBR('10.50'), 10.5);
  });

  it('branco é branco, e não zero', () => {
    assert.equal(numeroBR(''), null);
    assert.equal(numeroBR('   '), null);
    assert.equal(numeroBR(null), null);
    assert.equal(numeroBR(undefined), null);
    assert.equal(numeroBR('-'), null);
    assert.equal(numeroBR('abc'), null);
  });
});

describe('o reconhecimento das colunas', () => {
  it('acha os nomes mais comuns', () => {
    const m = detectarColunas(['Produto', 'Preço de Venda', 'Custo Direto', 'Participação']);
    assert.equal(m.nome, 'Produto');
    assert.equal(m.preco, 'Preço de Venda');
    assert.equal(m.custo, 'Custo Direto');
    assert.equal(m.participacao, 'Participação');
  });

  /**
   * "Preço de custo" tem as duas palavras. Se `preco` fosse testado
   * antes de `custo`, a coluna de custo viraria a de preço e o produto
   * apareceria com margem zero.
   */
  it('"preço de custo" é custo, não preço', () => {
    const m = detectarColunas(['Item', 'Preço de Custo', 'Preço de Venda']);
    assert.equal(m.custo, 'Preço de Custo');
    assert.equal(m.preco, 'Preço de Venda');
  });

  it('uma coluna não serve a dois campos', () => {
    const m = detectarColunas(['Descrição', 'Valor']);
    const usados = Object.values(m);
    assert.equal(new Set(usados).size, usados.length);
  });

  it('cabeçalho que não reconhece fica de fora', () => {
    const m = detectarColunas(['Produto', 'Fornecedor', 'NCM']);
    assert.equal(m.nome, 'Produto');
    assert.equal(m.preco, undefined);
  });
});

/* ==================================================================== */

const arquivo: LinhaBruta[] = [
  { Produto: 'Café expresso', 'Preço de Venda': '8,00', 'Custo Direto': '2,40', Participação: '50' },
  { Produto: 'Cappuccino', 'Preço de Venda': '12,00', 'Custo Direto': '4,20', Participação: '30' },
  { Produto: 'Pão de queijo', 'Preço de Venda': '6,00', 'Custo Direto': '2,00', Participação: '20' },
];

describe('a leitura de um arquivo completo', () => {
  it('traz os três produtos com os valores convertidos', () => {
    const r = lerPlanilha(arquivo);
    assert.equal(r.erro, null);
    assert.equal(r.produtos.length, 3);
    assert.equal(r.produtos[0]!.nome, 'Café expresso');
    assert.equal(r.produtos[0]!.preco, 8);
    assert.equal(r.produtos[0]!.custoDireto, 2.4);
    assert.equal(r.produtos[0]!.participacaoPct, 50);
    assert.equal(r.produtos[0]!.participacaoOrigem, 'planilha');
  });

  it('nenhum produto fica marcado como incompleto', () => {
    const r = lerPlanilha(arquivo);
    assert.ok(r.produtos.every((p) => p.faltando.length === 0));
  });

  it('a linha aponta para o arquivo, contando o cabeçalho', () => {
    const r = lerPlanilha(arquivo);
    assert.equal(r.produtos[0]!.linha, 2);
    assert.equal(r.produtos[2]!.linha, 4);
  });
});

describe('o que vem em branco', () => {
  it('preço em branco é marcado e não vira zero', () => {
    const r = lerPlanilha([{ Produto: 'Café', 'Preço de Venda': '', 'Custo Direto': '2,40' }]);
    assert.equal(r.produtos[0]!.preco, null);
    assert.ok(r.produtos[0]!.faltando.includes('preco'));
  });

  it('custo em branco é marcado e não vira zero', () => {
    const r = lerPlanilha([{ Produto: 'Café', 'Preço de Venda': '8', 'Custo Direto': '' }]);
    assert.equal(r.produtos[0]!.custoDireto, null);
    assert.ok(r.produtos[0]!.faltando.includes('custo'));
  });

  it('preço zero ou negativo conta como em branco', () => {
    // A tabela exige preco > 0. Aceitar zero aqui só adiaria o erro
    // para a gravação, com uma mensagem do Postgres no lugar da nossa.
    const r = lerPlanilha([{ Produto: 'Brinde', 'Preço de Venda': '0' }]);
    assert.equal(r.produtos[0]!.preco, null);
    assert.ok(r.produtos[0]!.faltando.includes('preco'));
  });

  it('avisa quantos produtos estão sem preço', () => {
    const r = lerPlanilha([
      { Produto: 'A', 'Preço de Venda': '' },
      { Produto: 'B', 'Preço de Venda': '' },
    ]);
    assert.ok(r.alertas.some((a) => /2 produtos estão sem preço/.test(a)));
  });

  it('linha sem nome é descartada, com aviso', () => {
    const r = lerPlanilha([
      { Produto: 'Café', 'Preço de Venda': '8' },
      { Produto: '   ', 'Preço de Venda': '9' },
    ]);
    assert.equal(r.produtos.length, 1);
    assert.ok(r.alertas.some((a) => /Uma linha foi ignorada/.test(a)));
  });

  it('arquivo só com linhas sem nome é erro, não resultado vazio', () => {
    const r = lerPlanilha([{ Produto: '', 'Preço de Venda': '8' }]);
    assert.match(r.erro ?? '', /Nenhuma linha/);
  });

  it('sem coluna de nome, não há o que importar', () => {
    const r = lerPlanilha([{ Valor: '10', Quantidade: '3' }]);
    assert.match(r.erro ?? '', /nome do produto/);
  });
});

describe('a participação', () => {
  it('sai do faturamento quando a planilha não traz o percentual', () => {
    const r = lerPlanilha([
      { Produto: 'A', Preço: '10', Custo: '4', Faturamento: '6000' },
      { Produto: 'B', Preço: '20', Custo: '8', Faturamento: '4000' },
    ]);
    assert.equal(r.produtos[0]!.participacaoPct, 60);
    assert.equal(r.produtos[1]!.participacaoPct, 40);
    assert.equal(r.produtos[0]!.participacaoOrigem, 'faturamento');
  });

  it('derivada do faturamento, fecha 100% por construção', () => {
    const r = lerPlanilha([
      { Produto: 'A', Preço: '10', Faturamento: '3333' },
      { Produto: 'B', Preço: '20', Faturamento: '3333' },
      { Produto: 'C', Preço: '30', Faturamento: '3334' },
    ]);
    const soma = r.produtos.reduce((s, p) => s + (p.participacaoPct ?? 0), 0);
    assert.ok(Math.abs(soma - 100) < 0.05);
  });

  it('sai de quantidade × preço quando não há faturamento', () => {
    const r = lerPlanilha([
      { Produto: 'A', Preço: '10', Quantidade: '100' }, // 1.000
      { Produto: 'B', Preço: '30', Quantidade: '100' }, // 3.000
    ]);
    assert.equal(r.produtos[0]!.participacaoPct, 25);
    assert.equal(r.produtos[1]!.participacaoPct, 75);
    assert.equal(r.produtos[0]!.participacaoOrigem, 'quantidade');
  });

  it('o percentual da planilha vence o faturamento', () => {
    const r = lerPlanilha([
      { Produto: 'A', Preço: '10', Participação: '70', Faturamento: '1000' },
      { Produto: 'B', Preço: '20', Participação: '30', Faturamento: '9000' },
    ]);
    assert.equal(r.produtos[0]!.participacaoPct, 70);
    assert.equal(r.produtos[0]!.participacaoOrigem, 'planilha');
  });

  /** O Excel guarda 35% como 0,35. Sem isto, o mix inteiro viraria 1%. */
  it('percentual em fração é convertido', () => {
    const r = lerPlanilha([
      { Produto: 'A', Preço: '10', Participação: '0,6' },
      { Produto: 'B', Preço: '20', Participação: '0,4' },
    ]);
    assert.equal(r.produtos[0]!.participacaoPct, 60);
    assert.ok(r.alertas.some((a) => /fração/.test(a)));
  });

  it('não confunde percentual pequeno de verdade com fração', () => {
    // Somam 100, então estão em pontos percentuais — mesmo com valores
    // baixos em algumas linhas.
    const r = lerPlanilha([
      { Produto: 'A', Preço: '10', Participação: '99' },
      { Produto: 'B', Preço: '20', Participação: '1' },
    ]);
    assert.equal(r.produtos[1]!.participacaoPct, 1);
  });

  it('avisa quando o percentual informado não fecha 100', () => {
    const r = lerPlanilha([
      { Produto: 'A', Preço: '10', Participação: '40' },
      { Produto: 'B', Preço: '20', Participação: '40' },
    ]);
    assert.ok(r.alertas.some((a) => /somam 80%/.test(a)));
  });

  it('sem percentual e sem faturamento, fica em branco para preencher', () => {
    const r = lerPlanilha([{ Produto: 'A', Preço: '10', Custo: '4' }]);
    assert.equal(r.produtos[0]!.participacaoPct, null);
    assert.ok(r.produtos[0]!.faltando.includes('participacao'));
  });
});

describe('nome repetido no arquivo', () => {
  /**
   * `mix_produtos` tem unique (tenant_id, nome). Duas linhas com o mesmo
   * nome fariam a gravação inteira falhar, e o usuário veria um erro do
   * Postgres sem entender qual linha causou.
   */
  it('fica a última, com aviso', () => {
    const r = lerPlanilha([
      { Produto: 'Café', Preço: '8' },
      { Produto: 'Café', Preço: '9' },
    ]);
    assert.equal(r.produtos.length, 1);
    assert.equal(r.produtos[0]!.preco, 9);
    assert.ok(r.alertas.some((a) => /repetia/.test(a)));
  });

  it('a comparação ignora acento e caixa', () => {
    const r = lerPlanilha([
      { Produto: 'Café', Preço: '8' },
      { Produto: 'CAFE', Preço: '9' },
    ]);
    assert.equal(r.produtos.length, 1);
  });
});

describe('o mapeamento informado pela tela', () => {
  it('vence a detecção automática', () => {
    const linhas = [{ A: 'Café', B: '8', C: '2' }];
    const r = lerPlanilha(linhas, { nome: 'A', preco: 'B', custo: 'C' });
    assert.equal(r.produtos[0]!.nome, 'Café');
    assert.equal(r.produtos[0]!.preco, 8);
    assert.equal(r.produtos[0]!.custoDireto, 2);
  });

  it('devolve as colunas do arquivo para a tela montar os seletores', () => {
    const r = lerPlanilha([{ A: 'Café', B: '8' }], { nome: 'A' });
    assert.deepEqual(r.colunasDisponiveis, ['A', 'B']);
  });
});

describe('bordas', () => {
  it('arquivo vazio é erro claro', () => {
    const r = lerPlanilha([]);
    assert.match(r.erro ?? '', /nenhuma linha/i);
  });

  it('nome longo demais é cortado, não recusado', () => {
    const r = lerPlanilha([{ Produto: 'x'.repeat(200), Preço: '8' }]);
    assert.equal(r.produtos[0]!.nome.length, 120);
  });
});
