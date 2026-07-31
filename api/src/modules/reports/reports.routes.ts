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

export const reportsRouter = Router();
reportsRouter.use(requireAuth, requireTenant);

const periodSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
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
