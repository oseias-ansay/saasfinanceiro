/**
 * Margem de contribuição e ponto de equilíbrio, por HTTP.
 *
 * Passa pela API em vez de o front falar com o supabase-js porque uma
 * resposta útil exige TRÊS consultas casadas — produtos, custos fixos
 * revisados e o faturamento real — mais um cálculo que precisa de teste.
 * Montar isso no navegador espalharia a regra por três lugares.
 */

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireTenant, requireRole } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { fromPostgrest, notFound } from '../../lib/errors.js';
import { calcularEquilibrio, type ProdutoEntrada } from './equilibrio.js';
import { calcularGiro } from './giro.js';

export const equilibrioRouter = Router();
equilibrioRouter.use(requireAuth, requireTenant);

const ESCREVE = requireRole('owner', 'admin', 'member');

/* ==================================================================== */
/* Produtos do mix                                                       */
/* ==================================================================== */

const produtoSchema = z.object({
  nome: z.string().trim().min(1).max(120),
  preco: z.coerce.number().positive('Preço deve ser maior que zero'),
  custo_direto: z.coerce.number().min(0).default(0),
  imposto_pct: z.coerce.number().min(0).max(99.99).default(0),
  variaveis_pct: z.coerce.number().min(0).max(99.99).default(0),
  participacao_pct: z.coerce.number().min(0).max(100).default(0),
  ordem: z.coerce.number().int().min(0).default(0),
});

equilibrioRouter.post('/produtos', ESCREVE, validate(produtoSchema), async (req, res, next) => {
  try {
    const { data, error } = await req.supabase
      .from('mix_produtos')
      .insert({ ...(req.body as object), tenant_id: req.tenantId! } as never)
      .select('*')
      .single();

    if (error) throw fromPostgrest(error);
    res.status(201).json({ data });
  } catch (e) {
    next(e);
  }
});

equilibrioRouter.patch(
  '/produtos/:id',
  ESCREVE,
  validate(produtoSchema.partial()),
  async (req, res, next) => {
    try {
      const { data, error } = await req.supabase
        .from('mix_produtos')
        .update(req.body as never)
        .eq('id', req.params.id!)
        .eq('tenant_id', req.tenantId!)
        .select('*')
        .maybeSingle();

      if (error) throw fromPostgrest(error);
      if (!data) return next(notFound('Produto não encontrado'));
      res.json({ data });
    } catch (e) {
      next(e);
    }
  },
);

equilibrioRouter.delete('/produtos/:id', ESCREVE, async (req, res, next) => {
  try {
    const { error } = await req.supabase
      .from('mix_produtos')
      .delete()
      .eq('id', req.params.id!)
      .eq('tenant_id', req.tenantId!);

    if (error) throw fromPostgrest(error);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

/* ==================================================================== */
/* Custos fixos                                                          */
/* ==================================================================== */

const custoSchema = z
  .object({
    category_id: z.string().uuid().nullish(),
    descricao: z.string().trim().min(1).max(120).nullish(),
    valor_mensal: z.coerce.number().min(0).nullish(),
    incluir: z.boolean().default(true),
  })
  .refine((v) => !!v.category_id !== !!v.descricao, {
    message: 'Informe a categoria OU a descrição de um item avulso, nunca os dois',
  })
  .refine((v) => !v.descricao || v.valor_mensal !== null, {
    message: 'Item avulso precisa de valor mensal',
  });

/**
 * Grava a revisão de um custo fixo.
 *
 * `upsert` por categoria: reabrir a tela e mudar a mesma linha atualiza em
 * vez de criar outra. Sem isso, cada visita deixaria um rastro de
 * duplicatas e o total passaria a somar o mesmo aluguel várias vezes.
 */
equilibrioRouter.post('/custos-fixos', ESCREVE, validate(custoSchema), async (req, res, next) => {
  try {
    const corpo = req.body as z.infer<typeof custoSchema>;

    const { data, error } = await req.supabase
      .from('mix_custos_fixos')
      .upsert({ ...corpo, tenant_id: req.tenantId! } as never, {
        onConflict: 'tenant_id,category_id',
        ignoreDuplicates: false,
      })
      .select('*')
      .single();

    if (error) throw fromPostgrest(error);
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

equilibrioRouter.delete('/custos-fixos/:id', ESCREVE, async (req, res, next) => {
  try {
    const { error } = await req.supabase
      .from('mix_custos_fixos')
      .delete()
      .eq('id', req.params.id!)
      .eq('tenant_id', req.tenantId!);

    if (error) throw fromPostgrest(error);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

/* ==================================================================== */
/* Custos fixos: medição + revisão                                       */
/* ==================================================================== */

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Junta o que foi medido nos lançamentos com o que o usuário revisou.
 *
 * Compartilhada entre a tela de margem de contribuição e a de capital de
 * giro: as duas fazem a mesma pergunta — "quanto custa manter esta
 * empresa aberta?" — e duas montagens separadas divergiriam na primeira
 * vez que alguém mexesse numa delas.
 *
 * Linha de revisão ausente significa "aceito a medição". É o que faz as
 * duas telas continuarem corretas sozinhas quando os lançamentos mudam.
 */
export function montarCustosFixos(medidos: any[], revisoes: any[]) {
  const porCategoria = new Map(
    revisoes.filter((r) => r.category_id).map((r) => [r.category_id, r]),
  );

  const deCategorias = medidos.map((m) => {
    const rev = porCategoria.get(m.category_id);
    return {
      id: rev?.id ?? null,
      category_id: m.category_id,
      descricao: m.categoria,
      medido: Number(m.media_mensal ?? 0),
      meses: m.meses,
      valor_mensal:
        rev?.valor_mensal !== null && rev?.valor_mensal !== undefined
          ? Number(rev.valor_mensal)
          : Number(m.media_mensal ?? 0),
      incluir: rev?.incluir ?? true,
      origem: 'lancamentos' as const,
    };
  });

  // Itens que o usuário acrescentou e não têm lançamento — pró-labore
  // não registrado é o caso comum.
  const avulsos = revisoes
    .filter((r) => !r.category_id)
    .map((r) => ({
      id: r.id,
      category_id: null,
      descricao: r.descricao,
      medido: null,
      meses: null,
      valor_mensal: Number(r.valor_mensal ?? 0),
      incluir: r.incluir,
      origem: 'manual' as const,
    }));

  const itens = [...deCategorias, ...avulsos];

  return {
    itens,
    total:
      Math.round(itens.filter((c) => c.incluir).reduce((s, c) => s + c.valor_mensal, 0) * 100) /
      100,
  };
}

/* ==================================================================== */
/* A tela inteira numa chamada                                           */
/* ==================================================================== */

equilibrioRouter.get('/', async (req, res, next) => {
  try {
    const tenant = req.tenantId!;

    const [produtos, revisoes, medidos, dre] = await Promise.all([
      req.supabase
        .from('mix_produtos')
        .select('*')
        .eq('tenant_id', tenant)
        .eq('is_active', true)
        .order('ordem'),
      req.supabase.from('mix_custos_fixos').select('*').eq('tenant_id', tenant),
      req.supabase.rpc('fn_custos_fixos_medidos', { p_tenant: tenant }),
      req.supabase
        .from('vw_dre_monthly')
        .select('competencia, receita_bruta')
        .eq('tenant_id', tenant)
        .lt('competencia', `${new Date().toISOString().slice(0, 7)}-01`)
        .order('competencia', { ascending: false })
        .limit(3),
    ]);

    for (const r of [produtos, revisoes, medidos, dre]) {
      if (r.error) throw fromPostgrest(r.error);
    }

    const listaProdutos: any[] = (produtos.data ?? []) as any[];
    const listaRevisoes: any[] = (revisoes.data ?? []) as any[];
    const listaMedidos: any[] = (medidos.data ?? []) as any[];
    const mesesDre: any[] = (dre.data ?? []) as any[];

    const { itens: todos, total: totalFixos } = montarCustosFixos(listaMedidos, listaRevisoes);

    const faturamentoAtual = mesesDre.length
      ? mesesDre.reduce((s, m) => s + Number(m.receita_bruta ?? 0), 0) / mesesDre.length
      : 0;

    const paraCalculo: ProdutoEntrada[] = listaProdutos.map((p) => ({
      id: p.id,
      nome: p.nome,
      preco: Number(p.preco),
      custoDireto: Number(p.custo_direto),
      impostoPct: Number(p.imposto_pct ?? 0),
      variaveisPct: Number(p.variaveis_pct),
      participacaoPct: Number(p.participacao_pct),
    }));

    res.json({
      produtos: listaProdutos,
      custos_fixos: todos,
      total_custos_fixos: Math.round(totalFixos * 100) / 100,
      faturamento_medio: Math.round(faturamentoAtual * 100) / 100,
      meses_faturamento: mesesDre.length,
      resultado: calcularEquilibrio({
        produtos: paraCalculo,
        custosFixosMensais: totalFixos,
        faturamentoAtual: faturamentoAtual || null,
      }),
    });
  } catch (e) {
    next(e);
  }
});

/**
 * Simulação sem gravar nada.
 *
 * Existe porque o usuário precisa poder perguntar "e se eu subir o preço
 * deste item em 10%?" sem alterar o cadastro. Cálculo puro atrás de uma
 * rota — não toca no banco.
 */
const simulacaoSchema = z.object({
  produtos: z
    .array(
      z.object({
        id: z.string().optional(),
        nome: z.string().trim().min(1).max(120),
        preco: z.coerce.number(),
        custoDireto: z.coerce.number().default(0),
        impostoPct: z.coerce.number().default(0),
        variaveisPct: z.coerce.number().default(0),
        participacaoPct: z.coerce.number().default(0),
      }),
    )
    .max(50),
  custosFixosMensais: z.coerce.number().min(0).default(0),
  faturamentoAtual: z.coerce.number().nullish(),
});

equilibrioRouter.post('/simular', validate(simulacaoSchema), async (req, res, next) => {
  try {
    res.json(calcularEquilibrio(req.body as z.infer<typeof simulacaoSchema>));
  } catch (e) {
    next(e);
  }
});

/* ==================================================================== */
/* Capital de giro                                                       */
/* ==================================================================== */

/**
 * A tela de NCG, numa chamada.
 *
 * Compartilha `mix_custos_fixos` com a ferramenta de margem de
 * contribuição de propósito: é a mesma pergunta — "quanto custa manter
 * esta empresa aberta?" — e duas listas separadas divergiriam na
 * primeira vez que alguém reajustasse o aluguel em uma só.
 *
 * PMR e PMP vêm medidos de `vw_prazos_medios`, ponderados por valor
 * sobre lançamentos liquidados. PME é digitado, porque a plataforma não
 * controla estoque — e inventar um número aqui subestimaria a
 * necessidade de caixa, que é o erro perigoso desta conta.
 */
equilibrioRouter.get('/giro', async (req, res, next) => {
  try {
    const tenant = req.tenantId!;
    const pmeDias = Number(req.query.pme ?? 0) || 0;

    const [revisoes, medidos, prazos, contas, kpis, dre] = await Promise.all([
      req.supabase.from('mix_custos_fixos').select('*').eq('tenant_id', tenant),
      req.supabase.rpc('fn_custos_fixos_medidos', { p_tenant: tenant }),
      req.supabase
        .from('vw_prazos_medios')
        .select('competencia, pmr_dias, pmp_dias')
        .eq('tenant_id', tenant)
        .order('competencia', { ascending: false })
        .limit(3),
      req.supabase
        .from('vw_contas_resumo')
        .select('natureza, total_aberto')
        .eq('tenant_id', tenant),
      req.supabase
        .from('vw_dashboard_kpis')
        .select('saldo_hoje')
        .eq('tenant_id', tenant)
        .maybeSingle(),
      req.supabase
        .from('vw_dre_monthly')
        .select('competencia, custos_variaveis')
        .eq('tenant_id', tenant)
        .lt('competencia', `${new Date().toISOString().slice(0, 7)}-01`)
        .order('competencia', { ascending: false })
        .limit(3),
    ]);

    for (const r of [revisoes, medidos, prazos, contas, kpis, dre]) {
      if (r.error) throw fromPostgrest(r.error);
    }

    const { itens, total } = montarCustosFixos(
      (medidos.data ?? []) as any[],
      (revisoes.data ?? []) as any[],
    );

    const linhasPrazo: any[] = (prazos.data ?? []) as any[];
    const media = (campo: string) =>
      linhasPrazo.length
        ? Math.round(
            linhasPrazo.reduce((s, l) => s + Number(l?.[campo] ?? 0), 0) / linhasPrazo.length,
          )
        : 0;

    const linhasConta: any[] = (contas.data ?? []) as any[];
    const aberto = (nat: string) =>
      Number(linhasConta.find((c) => c.natureza === nat)?.total_aberto ?? 0);

    const mesesDre: any[] = (dre.data ?? []) as any[];
    const variaveis = mesesDre.length
      ? mesesDre.reduce((s, m) => s + Number(m.custos_variaveis ?? 0), 0) / mesesDre.length
      : 0;

    const entrada = {
      despesasFixasMensais: total,
      custosVariaveisMensais: Math.round(variaveis * 100) / 100,
      pmrDias: Number(req.query.pmr ?? media('pmr_dias')) || 0,
      pmpDias: Number(req.query.pmp ?? media('pmp_dias')) || 0,
      pmeDias,
      contasAReceber: aberto('a_receber'),
      contasAPagar: aberto('a_pagar'),
      estoque: Number(req.query.estoque ?? 0) || 0,
      caixaDisponivel: Number((kpis.data as any)?.saldo_hoje ?? 0),
    };

    res.json({
      custos_fixos: itens,
      total_custos_fixos: total,
      // O medido vai junto do usado: quando o usuário sobrescreve um
      // prazo pela query, a tela precisa poder dizer "o seu histórico
      // mostra outro número".
      medido: {
        pmr_dias: media('pmr_dias'),
        pmp_dias: media('pmp_dias'),
        meses_prazos: linhasPrazo.length,
        custos_variaveis_mensais: entrada.custosVariaveisMensais,
        meses_dre: mesesDre.length,
      },
      entrada,
      resultado: calcularGiro(entrada),
    });
  } catch (e) {
    next(e);
  }
});
