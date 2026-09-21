//
// Estes endpoints existem porque exigem MONTAGEM (comparativo entre períodos,
// consolidação de linhas do DRE). Consultas simples de view — como listar o
// fluxo de caixa diário — o React faz direto no supabase-js; o RLS já protege
// e não faz sentido escrever um proxy para isso.

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireTenant } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { fromPostgrest } from '../../lib/errors.js';
import { calcularPreco } from '../precificacao/precificacao.js';

export const reportsRouter = Router();
reportsRouter.use(requireAuth, requireTenant);

const periodSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const contasSchema = z.object({
  natureza: z.enum(['a_receber', 'a_pagar']),
  /**
   * `vencido` primeiro é o padrão de propósito: a tela existe para
   * decidir quem cobrar hoje, e quem está em dia não é decisão nenhuma.
   * `vencimento` serve para a outra pergunta — o que vem pela frente.
   */
  ordenar_por: z.enum(['vencido', 'total', 'vencimento', 'atraso']).default('vencido'),
  limite: z.coerce.number().int().min(1).max(200).default(50),
  /** Esconde quem não tem nada vencido. Útil na tela de cobrança. */
  so_vencidos: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

/** DRE mensal + variação percentual mês a mês + acumulado do período. */
reportsRouter.get('/dre', validate(periodSchema, 'query'), async (req, res, next) => {
  try {
    const { from, to } = req.query as unknown as z.infer<typeof periodSchema>;

    const { data, error } = await req.supabase
      .from('vw_dre_monthly')
      .select('*')
      .eq('tenant_id', req.tenantId!)
      .gte('competencia', from)
      .lte('competencia', to)
      .order('competencia');

    if (error) throw fromPostgrest(error);
    // Anotação explícita: com o stub de tipos, `data` é `any`, e chamar
    // .map()/.filter() em `any` deixaria os parâmetros implicitamente `any`
    // (TS7006 sob noImplicitAny). Some quando os tipos reais forem gerados.
    const rows: any[] = (data ?? []) as any[];

    const delta = (cur: unknown, old: unknown) => {
      const a = Number(cur ?? 0);
      const b = Number(old ?? 0);
      return b === 0 ? null : Number((((a - b) / Math.abs(b)) * 100).toFixed(2));
    };

    const meses = rows.map((r, i) => {
      const prev = i > 0 ? rows[i - 1] : undefined;
      return {
        ...r,
        variacao: prev
          ? {
              receita_bruta: delta(r.receita_bruta, prev.receita_bruta),
              custos_variaveis: delta(r.custos_variaveis, prev.custos_variaveis),
              despesas_fixas: delta(r.despesas_fixas, prev.despesas_fixas),
              resultado_operacional: delta(r.resultado_operacional, prev.resultado_operacional),
            }
          : null,
      };
    });

    const sum = (k: string) => rows.reduce((s: number, r: any) => s + Number(r?.[k] ?? 0), 0);

    res.json({
      periodo: { from, to },
      meses,
      acumulado: {
        receita_bruta: sum('receita_bruta'),
        deducoes: sum('deducoes'),
        custos_variaveis: sum('custos_variaveis'),
        margem_contribuicao: sum('margem_contribuicao'),
        despesas_fixas: sum('despesas_fixas'),
        resultado_operacional: sum('resultado_operacional'),
      },
    });
  } catch (e) {
    next(e);
  }
});

/** Projeção de caixa consolidada em janelas de 30/60/90 dias. */
reportsRouter.get('/cashflow-projection', async (req, res, next) => {
  try {
    const { data, error } = await req.supabase
      .from('vw_cashflow_projection')
      .select('*')
      .eq('tenant_id', req.tenantId!)
      .lte('dias_a_frente', 90)
      .order('data');

    if (error) throw fromPostgrest(error);
    // Anotação explícita: com o stub de tipos, `data` é `any`, e chamar
    // .map()/.filter() em `any` deixaria os parâmetros implicitamente `any`
    // (TS7006 sob noImplicitAny). Some quando os tipos reais forem gerados.
    const rows: any[] = (data ?? []) as any[];

    const janela = (dias: number) => {
      const slice = rows.filter((r) => Number(r.dias_a_frente ?? 0) <= dias);
      const last = slice.at(-1);
      return {
        entradas: slice.reduce((s, r) => s + Number(r.entradas_previstas ?? 0), 0),
        saidas: slice.reduce((s, r) => s + Number(r.saidas_previstas ?? 0), 0),
        saldo_final: Number(last?.saldo_projetado ?? rows[0]?.saldo_atual ?? 0),
        // A data em que o caixa fica negativo pela primeira vez: o alerta
        // mais acionável do produto inteiro.
        primeiro_dia_negativo: slice.find((r) => r.alerta_saldo_negativo)?.data ?? null,
      };
    };

    res.json({
      saldo_atual: Number(rows[0]?.saldo_atual ?? 0),
      dias: rows,
      resumo: { d30: janela(30), d60: janela(60), d90: janela(90) },
    });
  } catch (e) {
    next(e);
  }
});

/**
 * Contas a pagar ou a receber, consolidadas por pessoa.
 *
 * Passa pela API, e não direto pelo supabase-js, porque devolve DUAS
 * consultas casadas: o resumo do cabeçalho e a lista paginada. Se o front
 * somasse a lista para montar o cabeçalho, o total mudaria a cada página
 * — e total que muda ao navegar é o tipo de defeito que faz o usuário
 * parar de confiar em todos os outros números da tela.
 */
reportsRouter.get('/contas', validate(contasSchema, 'query'), async (req, res, next) => {
  try {
    const { natureza, ordenar_por, limite, so_vencidos } = req.query as unknown as {
      natureza: 'a_receber' | 'a_pagar';
      ordenar_por: 'vencido' | 'total' | 'vencimento' | 'atraso';
      limite: number;
      so_vencidos: boolean;
    };

    const coluna = {
      vencido: 'total_vencido',
      total: 'total_aberto',
      vencimento: 'proximo_vencimento',
      atraso: 'dias_atraso_max',
    }[ordenar_por];

    // `vencimento` cresce para o futuro: o mais próximo é o menor. As
    // outras três são "quanto maior, mais urgente".
    const crescente = ordenar_por === 'vencimento';

    let consulta = req.supabase
      .from('vw_contas_por_pessoa')
      .select('*')
      .eq('tenant_id', req.tenantId!)
      .eq('natureza', natureza);

    if (so_vencidos) consulta = consulta.gt('total_vencido', 0);

    const [pessoas, resumo] = await Promise.all([
      consulta
        .order(coluna, { ascending: crescente, nullsFirst: false })
        .limit(limite),
      req.supabase
        .from('vw_contas_resumo')
        .select('*')
        .eq('tenant_id', req.tenantId!)
        .eq('natureza', natureza)
        .maybeSingle(),
    ]);

    if (pessoas.error) throw fromPostgrest(pessoas.error);
    if (resumo.error) throw fromPostgrest(resumo.error);

    // Anotação explícita: com o stub de tipos, `data` é `any`. Some quando
    // os tipos reais do banco forem gerados.
    const linhas: any[] = (pessoas.data ?? []) as any[];
    const cabecalho: any = resumo.data ?? null;

    res.json({
      natureza,
      // Carteira vazia não é erro nem ausência de dados: é uma resposta,
      // e o front precisa poder mostrá-la com zeros em vez de esqueleto
      // de carregamento eterno.
      resumo: cabecalho ?? {
        total_aberto: 0,
        titulos_abertos: 0,
        pessoas: 0,
        total_vencido: 0,
        titulos_vencidos: 0,
        vence_hoje: 0,
        vence_7d: 0,
        vence_30d: 0,
        pct_vencido: null,
        sem_pessoa_informada: 0,
      },
      // `exibidas` e o total de pessoas do resumo permitem ao front dizer
      // "50 de 214" sem uma terceira consulta.
      exibidas: linhas.length,
      pessoas: linhas,
    });
  } catch (e) {
    next(e);
  }
});

/* ==================================================================== */
/* Precificação                                                          */
/* ==================================================================== */

/**
 * Os percentuais REAIS da empresa, tirados dos lançamentos.
 *
 * É o que separa esta tela de uma planilha: o rateio de despesa fixa e a
 * carga de imposto não são chutados, são medidos. Chutados, saem sempre
 * baixos — ninguém lembra do contador, do software e do seguro ao estimar
 * "quanto custa manter a empresa aberta".
 *
 * Usa a média dos últimos meses fechados, e não o mês corrente: um mês
 * pela metade tem despesa fixa cheia e faturamento parcial, o que
 * inflaria o rateio.
 */
reportsRouter.get('/precificacao/base', async (req, res, next) => {
  try {
    const hoje = new Date();
    // Primeiro dia do mês corrente: tudo antes disso é mês fechado.
    const primeiroDoMes = `${hoje.getUTCFullYear()}-${String(hoje.getUTCMonth() + 1).padStart(2, '0')}-01`;

    const { data, error } = await req.supabase
      .from('vw_dre_monthly')
      .select('competencia, receita_bruta, deducoes, custos_variaveis, despesas_fixas')
      .eq('tenant_id', req.tenantId!)
      .lt('competencia', primeiroDoMes)
      .order('competencia', { ascending: false })
      .limit(3);

    if (error) throw fromPostgrest(error);

    const meses: any[] = (data ?? []) as any[];
    const media = (campo: string) =>
      meses.length ? meses.reduce((s, m) => s + Number(m?.[campo] ?? 0), 0) / meses.length : 0;

    const faturamento = media('receita_bruta');
    const fixas = media('despesas_fixas');
    const pct = (v: number) =>
      faturamento > 0 ? Math.round((v / faturamento) * 10000) / 100 : null;

    res.json({
      // Sem meses fechados não há o que medir. O front mostra os campos em
      // branco e o usuário digita — melhor que oferecer zero como se
      // fosse medição.
      tem_dados: meses.length > 0,
      meses_considerados: meses.length,
      competencias: meses.map((m) => m.competencia),

      faturamento_medio: Math.round(faturamento * 100) / 100,
      despesas_fixas_mensais: Math.round(fixas * 100) / 100,

      sugerido: {
        impostos_pct: pct(media('deducoes')),
        outras_variaveis_pct: pct(media('custos_variaveis')),
        despesas_fixas_pct: pct(fixas),
      },
    });
  } catch (e) {
    next(e);
  }
});

const precoSchema = z.object({
  custoDireto: z.coerce.number(),
  /** ICMS-ST, ad rem. Valor por unidade, não percentual. */
  impostoFixo: z.coerce.number().min(0).default(0),
  impostosPct: z.coerce.number().default(0),
  comissaoPct: z.coerce.number().default(0),
  outrasVariaveisPct: z.coerce.number().default(0),
  despesasFixasPct: z.coerce.number().default(0),
  margemPct: z.coerce.number().default(0),
  despesasFixasMensais: z.coerce.number().nullish(),
  precoPraticado: z.coerce.number().nullish(),
});

/**
 * O cálculo mora na API, e não no navegador, por uma razão só: aqui ele
 * tem teste. O front não tem test runner, e fórmula de preço errada é o
 * defeito que ninguém percebe — o número sai plausível e a margem some
 * no fim do mês.
 *
 * Não toca no banco. É função pura atrás de uma rota.
 */
reportsRouter.post('/precificacao', validate(precoSchema), async (req, res, next) => {
  try {
    res.json(calcularPreco(req.body as z.infer<typeof precoSchema>));
  } catch (e) {
    next(e);
  }
});
