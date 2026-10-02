/**
 * Testes da geração automática do plano.
 *
 * Esta regra vai rodar sozinha todo mês, sem ninguém olhando — que é
 * exatamente quando um defeito silencioso sobrevive mais tempo. Daí a
 * cobertura ser mais pesada do que o tamanho do módulo sugere.
 *
 * Os dois casos que mais importam: o teto de cinco ações, que é regra de
 * método e não de técnica, e o aviso de que o plano não passou por
 * reunião — omiti-lo faria o cliente atribuir a um consultor uma
 * prescrição que nenhum consultor viu.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  gerarAcoes,
  gerarContexto,
  MAX_ACOES_AUTOMATICAS,
  PRAZO_POR_PRIORIDADE,
  RESPONSAVEL_A_DEFINIR,
  lerAnaliseGuardada,
  tituloDoPlano,
  type AcaoDaAnalise,
  type AnaliseParaPlano,
} from './automatico.js';

const HOJE = new Date('2026-10-02T12:00:00Z');

const acao = (p: Partial<AcaoDaAnalise> = {}): AcaoDaAnalise => ({
  prioridade: 'Média',
  pilar: 'Liquidez',
  acaoRecomendada: 'Abrir conta separada para a reserva de caixa.',
  ...p,
});

const analise = (p: Partial<AnaliseParaPlano> = {}): AnaliseParaPlano => ({
  resumoExecutivo: 'A empresa lucra, mas o lucro não vira reserva.',
  planoDeAcao: [acao()],
  ...p,
});

describe('a geração das ações', () => {
  it('deriva o prazo da prioridade', () => {
    const a = gerarAcoes(
      analise({
        planoDeAcao: [
          acao({ prioridade: 'Alta' }),
          acao({ prioridade: 'Média' }),
          acao({ prioridade: 'Baixa' }),
        ],
      }),
      HOJE,
    );
    assert.equal(a[0]?.prazo, '2026-10-17'); // +15
    assert.equal(a[1]?.prazo, '2026-11-16'); // +45
    assert.equal(a[2]?.prazo, '2026-12-31'); // +90
  });

  it('ordena por prioridade, independente da ordem que veio', () => {
    const a = gerarAcoes(
      analise({
        planoDeAcao: [
          acao({ prioridade: 'Baixa', acaoRecomendada: 'Terceira coisa a fazer aqui.' }),
          acao({ prioridade: 'Alta', acaoRecomendada: 'Primeira coisa a fazer aqui.' }),
          acao({ prioridade: 'Média', acaoRecomendada: 'Segunda coisa a fazer aqui.' }),
        ],
      }),
      HOJE,
    );
    assert.match(a[0]!.titulo, /Primeira/);
    assert.match(a[2]!.titulo, /Terceira/);
    assert.deepEqual(a.map((x) => x.ordem), [0, 1, 2]);
  });

  /**
   * Acima de cinco abertas a lista deixa de ser acompanhada e passa a ser
   * ignorada. Num plano com consultor, alguém diz na reunião "deixa essas
   * para o próximo ciclo". Aqui não há reunião — o corte precisa estar no
   * código.
   */
  it('corta no teto de cinco, mantendo as de maior prioridade', () => {
    const a = gerarAcoes(
      analise({
        planoDeAcao: [
          ...Array.from({ length: 6 }, () => acao({ prioridade: 'Baixa' })),
          ...Array.from({ length: 2 }, () => acao({ prioridade: 'Alta' })),
        ],
      }),
      HOJE,
    );
    assert.equal(a.length, MAX_ACOES_AUTOMATICAS);
    assert.equal(a[0]?.prazo, '2026-10-17');
    assert.equal(a[1]?.prazo, '2026-10-17');
  });

  /**
   * Inventar um nome seria pior que o vazio: criaria a impressão de que
   * alguém assumiu a ação. "A definir" é o que o cliente conserta
   * primeiro — e consertar é o primeiro ato de adoção do plano.
   */
  it('não inventa responsável', () => {
    const a = gerarAcoes(analise(), HOJE);
    assert.equal(a[0]?.responsavel_nome, RESPONSAVEL_A_DEFINIR);
  });

  it('o título cabe no limite do banco e o texto inteiro vai para o detalhe', () => {
    const longo = `${'Renegociar o prazo de pagamento com os fornecedores '.repeat(8)}fim.`;
    const a = gerarAcoes(analise({ planoDeAcao: [acao({ acaoRecomendada: longo })] }), HOJE);

    assert.ok(a[0]!.titulo.length <= 200);
    assert.match(a[0]!.titulo, /…$/);
    assert.ok((a[0]!.detalhe ?? '').includes('fim.'), 'o detalhe guarda o texto completo');
  });

  it('texto curto não ganha detalhe nem reticências', () => {
    const a = gerarAcoes(analise(), HOJE);
    assert.equal(a[0]?.detalhe, null);
    assert.doesNotMatch(a[0]!.titulo, /…/);
  });

  it('pilar vazio vira nulo em vez de string em branco', () => {
    const a = gerarAcoes(analise({ planoDeAcao: [acao({ pilar: '   ' })] }), HOJE);
    assert.equal(a[0]?.pilar, null);
  });

  it('plano vazio dá lista vazia, sem lançar', () => {
    assert.deepEqual(gerarAcoes(analise({ planoDeAcao: [] }), HOJE), []);
  });

  it('prioridade desconhecida cai no prazo de Média', () => {
    const a = gerarAcoes(
      // Vem de fora validado pelo Zod, mas a análise pode mudar de schema
      // antes deste módulo — e cair no prazo mais curto seria pior.
      analise({ planoDeAcao: [acao({ prioridade: 'Urgentíssima' as never })] }),
      HOJE,
    );
    assert.equal(a[0]?.prazo, '2026-11-16');
  });

  it('a escada de prazos cabe no ciclo de 90 dias', () => {
    for (const d of Object.values(PRAZO_POR_PRIORIDADE)) assert.ok(d <= 90);
  });
});

describe('o contexto para o chat', () => {
  /**
   * A diferença entre o Básico e o Intermediário é justamente a reunião.
   * Um plano automático que não se declara automático vende a reunião sem
   * entregá-la.
   */
  it('declara que foi gerado sem reunião', () => {
    const c = gerarContexto(analise(), '2026-09');
    assert.match(c, /gerado automaticamente/i);
    assert.match(c, /não passou por uma reunião/i);
    assert.match(c, /2026-09/);
  });

  it('avisa que os prazos são sugestões', () => {
    assert.match(gerarContexto(analise(), '2026-09'), /sugest(ões|ão)/i);
  });

  it('traz o resumo e os gargalos', () => {
    const c = gerarContexto(
      analise({ gargalos: ['Caixa cobre 2,91 dias', 'Margem de 23,19%'] }),
      '2026-09',
    );
    assert.match(c, /o lucro não vira reserva/);
    assert.match(c, /- Caixa cobre 2,91 dias/);
    assert.match(c, /- Margem de 23,19%/);
  });

  it('omite a seção de gargalos quando não há', () => {
    assert.doesNotMatch(gerarContexto(analise({ gargalos: [] }), '2026-09'), /Gargalos/);
    assert.doesNotMatch(gerarContexto(analise({ gargalos: ['  '] }), '2026-09'), /Gargalos/);
  });

  /** O limite é o da coluna (SQL 57). Cortar no meio de um número é pior
   *  que cortar antes, então o corte procura a quebra de parágrafo. */
  it('respeita o limite de caracteres', () => {
    const c = gerarContexto(
      analise({ resumoExecutivo: 'x'.repeat(9000) }),
      '2026-09',
      8000,
    );
    assert.ok(c.length <= 8000);
  });
});

describe('o título do plano', () => {
  it('usa o mês por extenso', () => {
    assert.equal(tituloDoPlano('2026-09'), 'Plano de ação — Setembro/2026');
    assert.equal(tituloDoPlano('2026-01'), 'Plano de ação — Janeiro/2026');
  });

  it('não quebra com competência fora do formato', () => {
    assert.match(tituloDoPlano('2026-99'), /Plano de ação/);
  });
});

/**
 * `diagnosticos.analise` é um jsonb sem garantia de formato: foi gravado
 * por versões anteriores do schema, pode ter vindo do financeiro ou do
 * comercial, e um registro de meses atrás pode não ter o campo que o
 * código de hoje espera.
 *
 * Esta leitura roda no marco zero — o instante em que o prospect vira
 * cliente. É o pior momento possível para quebrar, e o mais provável de
 * encontrar um registro antigo.
 */
describe('a leitura da análise guardada', () => {
  const bom = {
    resumoExecutivo: 'A empresa lucra, mas o lucro não vira reserva.',
    gargalosIdentificados: ['Caixa cobre 2,91 dias'],
    planoDeAcao: [
      { prioridade: 'Alta', pilar: 'Liquidez', acaoRecomendada: 'Abrir conta de reserva.' },
    ],
  };

  it('lê o formato esperado', () => {
    const r = lerAnaliseGuardada(bom);
    assert.equal(r?.planoDeAcao.length, 1);
    assert.equal(r?.planoDeAcao[0]?.prioridade, 'Alta');
    assert.deepEqual(r?.gargalos, ['Caixa cobre 2,91 dias']);
  });

  /** O schema comercial chama de `gargalosCriticos`. Sem este fallback, o
   *  plano comercial entraria sem gargalo nenhum no contexto do chat. */
  it('aceita gargalosCriticos do schema comercial', () => {
    const r = lerAnaliseGuardada({ ...bom, gargalosIdentificados: undefined, gargalosCriticos: ['Funil sem etapa'] });
    assert.deepEqual(r?.gargalos, ['Funil sem etapa']);
  });

  it('devolve nulo quando não há plano aproveitável', () => {
    for (const v of [null, undefined, 'texto', 42, {}, { planoDeAcao: [] }, { planoDeAcao: 'x' }]) {
      assert.equal(lerAnaliseGuardada(v), null, `deveria recusar: ${JSON.stringify(v)}`);
    }
  });

  it('descarta item sem texto de ação em vez de deixar título vazio', () => {
    const r = lerAnaliseGuardada({
      planoDeAcao: [
        { prioridade: 'Alta', pilar: 'x', acaoRecomendada: '  ' },
        { prioridade: 'Alta', pilar: 'x', acaoRecomendada: 'ab' },
        null,
        { prioridade: 'Alta', pilar: 'x', acaoRecomendada: 'Uma ação de verdade.' },
      ],
    });
    assert.equal(r?.planoDeAcao.length, 1);
  });

  it('prioridade desconhecida vira Média, não quebra', () => {
    const r = lerAnaliseGuardada({
      planoDeAcao: [{ prioridade: 'Urgente', pilar: 'x', acaoRecomendada: 'Fazer alguma coisa.' }],
    });
    assert.equal(r?.planoDeAcao[0]?.prioridade, 'Média');
  });

  it('resumo e gargalos ausentes não impedem a leitura', () => {
    const r = lerAnaliseGuardada({ planoDeAcao: bom.planoDeAcao });
    assert.equal(r?.resumoExecutivo, '');
    assert.deepEqual(r?.gargalos, []);
  });
});
