/**
 * Testes do catálogo de ferramentas.
 *
 * O teste que importa mais não é de formatação: é o que prova que
 * NENHUMA ferramenta aceita empresa como parâmetro. Se um dia alguém
 * acrescentar um campo `tenant_id` "só para facilitar um caso", esse
 * teste quebra — e é a única barreira automática entre o assistente e o
 * dado do concorrente.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  brl,
  dataBR,
  existe,
  FERRAMENTAS,
  MAX_DIAS,
  MAX_LINHAS,
  NOMES,
  resumirContas,
  resumirDiagnostico,
  resumirDRE,
  resumirSaldos,
  resumirTitulos,
  validarParametros,
  type NomeFerramenta,
  type Titulo,
} from './ferramentas.js';
import { DEFINICOES } from './definicoes.js';
import { INSTRUCAO_ASSISTENTE } from './instrucao.js';

const titulo = (p: Partial<Titulo> = {}): Titulo => ({
  descricao: 'Fornecedor de combustível',
  pessoa: 'Distribuidora X',
  valor: 1200,
  vencimento: '2026-10-10',
  vencido: false,
  ...p,
});

describe('o contrato das ferramentas', () => {
  /**
   * A regra que não se negocia. Não é questão de o modelo ser obediente:
   * é que o campo não deve existir. Com ele, bastaria o modelo ser
   * convencido — por um texto na observação de um lançamento, por
   * exemplo — a chamar a ferramenta com outro uuid.
   */
  it('nenhuma ferramenta aceita empresa como parâmetro', () => {
    const proibidos = /tenant|empresa|cliente_id|company|org/i;

    for (const nome of NOMES) {
      const forma = FERRAMENTAS[nome].parametros;
      const campos = Object.keys((forma as unknown as { shape: object }).shape ?? {});

      for (const campo of campos) {
        assert.ok(
          !proibidos.test(campo),
          `${nome} tem o parâmetro proibido "${campo}" — a empresa vem do JWT, nunca do modelo`,
        );
      }
    }
  });

  /**
   * A descrição é o contrato que o modelo lê. Indicador que a ferramenta
   * devolve e a descrição não nomeia é indicador invisível — ele recusa a
   * responder sobre um número que tem em mãos. Aconteceu em 02/10/2026
   * com a margem de contribuição.
   */
  it('a descrição nomeia os indicadores que a ferramenta devolve', () => {
    assert.match(FERRAMENTAS.resultado_do_mes.descricao, /margem de contribuição/i);
    assert.match(FERRAMENTAS.resultado_do_mes.descricao, /receita líquida/i);
    assert.match(FERRAMENTAS.ultimo_diagnostico.descricao, /ciclo financeiro|prazos médios/i);
  });

  it('toda ferramenta tem descrição útil para o modelo decidir', () => {
    for (const nome of NOMES) {
      const d = FERRAMENTAS[nome].descricao;
      assert.ok(d.length > 60, `${nome} tem descrição curta demais`);
      // A descrição precisa dizer QUANDO usar, não só o que faz.
      assert.match(d, /\buse\b/i, `${nome} não diz quando deve ser usada`);
    }
  });

  it('reconhece ferramenta existente e recusa inventada', () => {
    assert.ok(existe('contas_a_pagar'));
    assert.ok(!existe('apagar_tudo'));
    assert.ok(!existe('contas_a_pagar_de_outra_empresa'));
  });
});

describe('as definições que vão ao modelo', () => {
  it('toda ferramenta do catálogo tem definição, e nenhuma sobra', () => {
    assert.deepEqual(
      DEFINICOES.map((d) => d.name).sort(),
      [...NOMES].sort(),
    );
  });

  /**
   * A lista vai no prompt antes do bloco cacheado. Se variasse entre
   * empresas — escondendo ferramenta de quem não tem certo recurso — o
   * prefixo mudaria a cada conversa e o cache nunca acertaria. O custo
   * subiria cerca de dez vezes, sem nenhum sintoma visível.
   */
  it('o schema não tem campo de empresa', () => {
    for (const d of DEFINICOES) {
      const props = Object.keys(
        (d.input_schema as { properties?: object }).properties ?? {},
      );
      for (const p of props) {
        assert.ok(!/tenant|empresa|cliente_id/i.test(p), `${d.name}.${p} é proibido`);
      }
    }
  });

  it('a descrição que vai ao modelo é a do catálogo', () => {
    for (const d of DEFINICOES) {
      assert.equal(d.description, FERRAMENTAS[d.name as NomeFerramenta].descricao);
    }
  });

  /** Nenhum parâmetro é obrigatório: o modelo deve conseguir chamar a
   *  ferramenta sem adivinhar número, e o padrão do Zod resolve. */
  it('nenhum parâmetro é obrigatório', () => {
    for (const d of DEFINICOES) {
      assert.deepEqual((d.input_schema as { required?: string[] }).required, []);
    }
  });
});

describe('a validação de parâmetros', () => {
  it('aceita o padrão quando o modelo não manda nada', () => {
    const r = validarParametros('contas_a_pagar', undefined);
    assert.ok(r.ok && r.valor.dias === 30);
  });

  it('respeita a janela máxima', () => {
    assert.ok(validarParametros('contas_a_pagar', { dias: MAX_DIAS }).ok);
    assert.ok(!validarParametros('contas_a_pagar', { dias: MAX_DIAS + 1 }).ok);
    assert.ok(!validarParametros('contas_a_pagar', { dias: 0 }).ok);
  });

  /**
   * Devolve erro em texto em vez de lançar: parâmetro errado não pode
   * derrubar a conversa. O erro volta ao modelo como resultado, e ele
   * corrige na rodada seguinte.
   */
  it('devolve erro legível em vez de lançar', () => {
    const r = validarParametros('contas_a_pagar', { dias: 'muitos' });
    assert.ok(!r.ok);
    assert.match((r as { erro: string }).erro, /dias/);
  });

  it('descarta campo que o modelo inventou', () => {
    const r = validarParametros('contas_a_pagar', {
      dias: 10,
      tenant_id: '00000000-0000-0000-0000-000000000001',
    });
    assert.ok(r.ok);
    assert.deepEqual(Object.keys(r.valor), ['dias']);
  });
});

describe('o texto dos títulos', () => {
  it('soma e conta', () => {
    const t = resumirTitulos([titulo({ valor: 1000 }), titulo({ valor: 500 })], 'a_pagar', 10);
    assert.match(t, /R\$\s?1\.500,00/);
    assert.match(t, /2 títulos/);
    assert.match(t, /próximos 10 dias/);
  });

  /**
   * Vencido é a informação que muda o que a pessoa faz hoje. Enterrá-lo
   * no meio de uma lista cronológica seria tecnicamente correto e
   * praticamente inútil.
   */
  it('destaca o que está vencido, separado do total', () => {
    const t = resumirTitulos(
      [titulo({ valor: 300, vencido: true }), titulo({ valor: 700 })],
      'a_pagar',
      30,
    );
    assert.match(t, /1 está vencido, somando R\$\s?300,00/);
    assert.match(t, /\(VENCIDO\)/);
  });

  it('diz que não há nada em vez de devolver lista vazia', () => {
    assert.match(resumirTitulos([], 'a_receber', 7), /Nada a receber nos próximos 7 dias/);
  });

  it('corta a lista longa e declara quantos ficaram de fora', () => {
    const muitos = Array.from({ length: MAX_LINHAS + 7 }, () => titulo());
    const t = resumirTitulos(muitos, 'a_pagar', 90);
    assert.match(t, new RegExp(`mais ${7} títulos não listados`));
  });

  it('usa o verbo certo para cada natureza', () => {
    assert.match(resumirTitulos([titulo()], 'a_pagar', 5), /a pagar/);
    assert.match(resumirTitulos([titulo()], 'a_receber', 5), /a receber/);
  });
});

describe('os outros resumos', () => {
  it('contas: mostra aberto, vencido e as janelas', () => {
    const t = resumirContas([
      {
        natureza: 'a_pagar',
        total_aberto: 10000,
        titulos_abertos: 8,
        total_vencido: 2000,
        titulos_vencidos: 2,
        vence_hoje: 500,
        vence_7d: 3000,
        vence_30d: 7000,
      },
    ]);
    assert.match(t, /A PAGAR: R\$\s?10\.000,00/);
    assert.match(t, /Vencido: R\$\s?2\.000,00/);
    assert.match(t, /em 7 dias: R\$\s?3\.000,00/);
  });

  it('contas: omite a linha de vencido quando não há', () => {
    const t = resumirContas([
      {
        natureza: 'a_receber',
        total_aberto: 500,
        titulos_abertos: 1,
        total_vencido: 0,
        titulos_vencidos: 0,
        vence_hoje: 0,
        vence_7d: 500,
        vence_30d: 500,
      },
    ]);
    assert.doesNotMatch(t, /Vencido/);
  });

  it('saldo: soma as contas e lista uma a uma', () => {
    const t = resumirSaldos([
      { nome: 'Caixa', saldo: 1000 },
      { nome: 'Banco', saldo: 4000 },
    ]);
    assert.match(t, /Saldo total: R\$\s?5\.000,00/);
    assert.match(t, /- Banco: R\$\s?4\.000,00/);
  });

  /**
   * Caso real, 02/10/2026: perguntaram a margem de contribuição, a
   * ferramenta devolveu receita e custos sem a MC, e o modelo subtraiu um
   * do outro. Deu número errado com toda a aparência de certo.
   *
   * A regra que nasceu daí: indicador que a ferramenta não devolve é
   * indicador que o modelo vai derivar. Não adianta proibir na instrução
   * — se os ingredientes estão na mesa, ele cozinha.
   */
  it('DRE: traz a margem de contribuição pronta, em valor e percentual', () => {
    const t = resumirDRE([
      {
        mes: '2026-09',
        receita: 100000,
        custos: 60000,
        margem_contribuicao: 40000,
        margem_contribuicao_pct: 40,
        despesas: 20000,
        resultado: 20000,
      },
    ]);
    assert.match(t, /Margem de contribuição: R\$\s?40\.000,00/);
    assert.match(t, /40,00% da receita líquida|40.00% da receita líquida/);
  });

  it('DRE: não divide por zero no mês sem receita', () => {
    const t = resumirDRE([
      {
        mes: '2026-08',
        receita: 0,
        custos: 0,
        margem_contribuicao: 0,
        margem_contribuicao_pct: null,
        despesas: 1000,
        resultado: -1000,
      },
    ]);
    assert.match(t, /Receita líquida: R\$\s?0,00/);
    assert.doesNotMatch(t, /NaN|Infinity/);
  });

  it('diagnóstico: separa crítico de atenção', () => {
    const t = resumirDiagnostico({
      competencia: '2026-09',
      score: 75,
      nivel: 'Boa',
      alertas: [
        { indicador: 'Cobertura de caixa', status: 'vermelho', valor: 2.91 },
        { indicador: 'Margem de contribuição', status: 'amarelo', valor: 23.19 },
        { indicador: 'Endividamento', status: 'verde', valor: 1.05 },
      ],
    });
    assert.match(t, /75 pontos de 100 \(Boa\)/);
    assert.match(t, /Em situação crítica:[\s\S]*Cobertura de caixa/);
    assert.match(t, /Em atenção:[\s\S]*Margem de contribuição/);
    // Verde não é alerta e não entra na resposta.
    assert.doesNotMatch(t, /Endividamento/);
  });

  it('diagnóstico: diz que não há, em vez de devolver vazio', () => {
    assert.match(resumirDiagnostico(null), /ainda não tem diagnóstico/);
  });
});

describe('a formatação', () => {
  it('moeda em real, com separador brasileiro', () => {
    assert.match(brl(1234.5), /R\$\s?1\.234,50/);
  });

  it('moeda não quebra com valor inválido', () => {
    assert.match(brl(NaN), /R\$\s?0,00/);
  });

  it('data no formato que o cliente lê', () => {
    assert.equal(dataBR('2026-10-15'), '15/10/2026');
    assert.equal(dataBR('2026-10-15T12:00:00Z'), '15/10/2026');
    assert.equal(dataBR(null), '—');
  });
});

/**
 * A instrução é a única barreira contra o modo de falha mais caro deste
 * assistente: explicar um conceito e, no meio da explicação, inventar o
 * número da empresa. A explicação fica boa, o valor parece plausível, e o
 * cliente leva ao contador um número que ninguém calculou.
 */
describe('a instrução do assistente', () => {
  it('amarra número da empresa a ferramenta', () => {
    assert.match(INSTRUCAO_ASSISTENTE, /vêm das ferramentas/i);
    assert.match(INSTRUCAO_ASSISTENTE, /nunca estime/i);
  });

  /**
   * Caso real de 02/10/2026. A instrução anterior já proibia estimar, e
   * mesmo assim o modelo derivou a MC de receita menos custos — porque
   * derivar não parece estimar. Precisou de uma regra própria.
   */
  it('proíbe derivar indicador que a ferramenta não devolveu', () => {
    assert.match(INSTRUCAO_ASSISTENTE, /não derive indicador/i);
    assert.match(INSTRUCAO_ASSISTENTE, /mesmo que a fórmula seja óbvia/i);
  });

  it('separa conceito de número', () => {
    assert.match(INSTRUCAO_ASSISTENTE, /explicar conceitos é diferente/i);
    assert.match(INSTRUCAO_ASSISTENTE, /nunca deduza o valor/i);
  });

  it('manda não corrigir o vocabulário', () => {
    assert.match(INSTRUCAO_ASSISTENTE, /nunca corrija o vocabul[áa]rio/i);
  });

  /**
   * A recusa de 02/10/2026 veio acompanhada de uma tela inventada —
   * "DRE Gerencial, detalhado por produto ou categoria". Instrução de
   * navegação errada faz a pessoa procurar o que não existe, e custa mais
   * confiança que admitir não saber o caminho.
   */
  it('proíbe inventar tela ou caminho', () => {
    assert.match(INSTRUCAO_ASSISTENTE, /não invente telas/i);
    assert.match(INSTRUCAO_ASSISTENTE, /confira a descrição das ferramentas/i);
  });

  /**
   * Caso real de 02/10/2026: pediram o impacto de baixar R$ 0,10 no preço
   * da gasolina, faltava saber os litros vendidos, e ele recusou em vez de
   * perguntar. Recusar sem pedir o dado é o defeito, não a cautela.
   */
  it('autoriza simulação e manda pedir o dado que falta', () => {
    assert.match(INSTRUCAO_ASSISTENTE, /simulações e projeções: você faz, sim/i);
    assert.match(INSTRUCAO_ASSISTENTE, /nunca recuse por falta de dado sem antes pedir/i);
    assert.match(INSTRUCAO_ASSISTENTE, /mostre a conta/i);
  });

  /**
   * As duas seções sobre fazer conta precisam apontar uma para a outra.
   * Lida isolada, cada uma vira uma regra absoluta errada: ou ele recusa
   * toda conta, ou recalcula a margem oficial e diverge da tela.
   */
  it('a proibição de derivar aponta para a permissão de simular', () => {
    assert.match(INSTRUCAO_ASSISTENTE, /para cenário hipotético, veja a seção de simulações/i);
  });

  it('simulação não vira recomendação', () => {
    assert.match(INSTRUCAO_ASSISTENTE, /não transforme simulação em recomendação/i);
    assert.match(INSTRUCAO_ASSISTENTE, /não inventa sazonalidade/i);
  });

  it('deixa claro que não escreve nada', () => {
    assert.match(INSTRUCAO_ASSISTENTE, /não lança, não paga/i);
  });

  /**
   * O isolamento entre empresas é das ferramentas, que não têm campo de
   * empresa, e do RLS. Uma frase aqui daria sensação de proteção onde não
   * há nenhuma.
   */
  it('não finge isolar empresas por instrução', () => {
    assert.doesNotMatch(
      INSTRUCAO_ASSISTENTE,
      /apenas sobre a empresa|não revele dados de outr|somente desta empresa/i,
    );
  });
});
