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
import { calcularCiclo } from './ciclo.js';
import { calcularProLabore } from './prolabore.js';
import { calcularProvisao } from './provisao.js';
import { calcularComercial } from './comercial.js';
import { calcularOrcamento } from './orcamento.js';
import { calcularIndices } from './indices.js';
import { calcularPlanoCiclo } from './planociclo.js';
import { calcularHoraProdutiva } from './horaprodutiva.js';
import { calcularCentros } from './centros.js';
import { calcularFluxo } from './fluxo.js';
import { lerPlanilha, type Mapeamento } from './planilha.js';

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
  imposto_fixo: z.coerce.number().min(0).default(0),
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

/* -------------------------------------------------------------------- */
/* Importação por planilha                                               */
/* -------------------------------------------------------------------- */
//
// Dois passos, de propósito. O primeiro lê e devolve a conferência sem
// tocar no banco; o segundo grava o que o usuário confirmou. Importação
// que grava direto do arquivo é a que apaga o mix inteiro por causa de
// uma coluna trocada, e o usuário só descobre quando a margem muda.

const mapeamentoSchema = z
  .object({
    nome: z.string().optional(),
    preco: z.string().optional(),
    custo: z.string().optional(),
    participacao: z.string().optional(),
    faturamento: z.string().optional(),
    quantidade: z.string().optional(),
  })
  .optional();

/** Passo 1: lê o arquivo já convertido em linhas e devolve a conferência. */
equilibrioRouter.post(
  '/produtos/planilha',
  ESCREVE,
  validate(
    z.object({
      linhas: z.array(z.record(z.unknown())).min(1).max(2000),
      mapeamento: mapeamentoSchema,
    }),
  ),
  async (req, res, next) => {
    try {
      const { linhas, mapeamento } = req.body as {
        linhas: Record<string, unknown>[];
        mapeamento?: Mapeamento;
      };
      res.json(lerPlanilha(linhas, mapeamento));
    } catch (e) {
      next(e);
    }
  },
);

/**
 * Passo 2: grava, mesclando pelo nome.
 *
 * Só as quatro colunas que a planilha traz entram no upsert. Imposto,
 * comissão e frete ficam de fora para serem PRESERVADOS: o PostgREST
 * atualiza apenas as colunas presentes no corpo, então o que foi
 * ajustado à mão sobrevive a uma reimportação de preços. Produto que
 * não está na planilha também não é tocado.
 */
equilibrioRouter.post(
  '/produtos/importar',
  ESCREVE,
  validate(
    z.object({
      produtos: z
        .array(
          z.object({
            nome: z.string().trim().min(1).max(120),
            preco: z.coerce.number().positive(),
            custo_direto: z.coerce.number().min(0).default(0),
            participacao_pct: z.coerce.number().min(0).max(100).default(0),
          }),
        )
        .min(1)
        .max(2000),
    }),
  ),
  async (req, res, next) => {
    try {
      const tenant = req.tenantId!;
      const { produtos } = req.body as {
        produtos: { nome: string; preco: number; custo_direto: number; participacao_pct: number }[];
      };

      // Quem já existe, para poder dizer quantos foram criados e quantos
      // atualizados. Sem isto a tela só conseguiria dizer "pronto".
      const { data: atuais, error: e1 } = await req.supabase
        .from('mix_produtos')
        .select('nome')
        .eq('tenant_id', tenant);
      if (e1) throw fromPostgrest(e1);

      const existentes = new Set(
        ((atuais ?? []) as { nome: string }[]).map((p) => p.nome.trim().toLowerCase()),
      );
      const atualizados = produtos.filter((p) =>
        existentes.has(p.nome.trim().toLowerCase()),
      ).length;

      const { error } = await req.supabase
        .from('mix_produtos')
        .upsert(
          produtos.map((p) => ({ ...p, tenant_id: tenant })) as never,
          { onConflict: 'tenant_id,nome' },
        );
      if (error) throw fromPostgrest(error);

      res.json({
        gravados: produtos.length,
        atualizados,
        criados: produtos.length - atualizados,
      });
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
    const linha = { ...corpo, tenant_id: req.tenantId! };

    // Categoria e item avulso gravam de formas diferentes, e misturar as
    // duas foi o defeito de 16/09.
    //
    // Categoria: `upsert` por (tenant_id, category_id) — reabrir a tela e
    // mudar a mesma linha atualiza em vez de criar outra.
    //
    // Avulso: `category_id` é nulo, e em Postgres dois nulos não
    // conflitam. Um upsert aqui inseriria uma cópia a cada clique, e o
    // total passaria a somar o mesmo pró-labore várias vezes. Por isso
    // item avulso só entra por `insert`; alterar o dele é PATCH por id.
    const consulta = corpo.category_id
      ? req.supabase.from('mix_custos_fixos').upsert(linha as never, {
          onConflict: 'tenant_id,category_id',
          ignoreDuplicates: false,
        })
      : req.supabase.from('mix_custos_fixos').insert(linha as never);

    const { data, error } = await consulta.select('*').single();

    if (error) throw fromPostgrest(error);
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

/** Altera um item já gravado — valor ou inclusão. */
equilibrioRouter.patch(
  '/custos-fixos/:id',
  ESCREVE,
  validate(
    z.object({
      valor_mensal: z.coerce.number().min(0).nullish(),
      incluir: z.boolean().optional(),
      descricao: z.string().trim().min(1).max(120).optional(),
    }),
  ),
  async (req, res, next) => {
    try {
      const { data, error } = await req.supabase
        .from('mix_custos_fixos')
        .update(req.body as never)
        .eq('id', req.params.id!)
        .eq('tenant_id', req.tenantId!)
        .select('*')
        .maybeSingle();

      if (error) throw fromPostgrest(error);
      if (!data) return next(notFound('Custo fixo não encontrado'));
      res.json({ data });
    } catch (e) {
      next(e);
    }
  },
);

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
      impostoFixo: Number(p.imposto_fixo ?? 0),
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
        impostoFixo: z.coerce.number().default(0),
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

    const [revisoes, medidos, prazos, contas, kpis, dre, estoque] = await Promise.all([
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
        // `receita_bruta` entrou junto com a régua de venda diária, em
        // 24/09/2026. Mesma coluna e mesma média de meses que a tela de
        // Ciclo usa — as duas precisam partir do mesmo número.
        .select('competencia, custos_variaveis, receita_bruta')
        .eq('tenant_id', tenant)
        .lt('competencia', `${new Date().toISOString().slice(0, 7)}-01`)
        .order('competencia', { ascending: false })
        .limit(3),
      estoqueInformado(req.supabase, tenant),
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
    const receitaMedia = mesesDre.length
      ? mesesDre.reduce((s, m) => s + Number(m.receita_bruta ?? 0), 0) / mesesDre.length
      : 0;

    const entrada = {
      receitaMensal: Number(req.query.receita ?? Math.round(receitaMedia * 100) / 100) || 0,
      despesasFixasMensais: total,
      custosVariaveisMensais: Math.round(variaveis * 100) / 100,
      pmrDias: Number(req.query.pmr ?? media('pmr_dias')) || 0,
      pmpDias: Number(req.query.pmp ?? media('pmp_dias')) || 0,
      pmeDias,
      contasAReceber: aberto('a_receber'),
      contasAPagar: aberto('a_pagar'),
      estoque: Number(req.query.estoque ?? estoque.valor ?? 0) || 0,
      caixaDisponivel: Number((kpis.data as any)?.saldo_hoje ?? 0),
    };

    res.json({
      custos_fixos: itens,
      total_custos_fixos: total,
      // O medido vai junto do usado: quando o usuário sobrescreve um
      // prazo pela query, a tela precisa poder dizer "o seu histórico
      // mostra outro número".
      medido: {
        estoque: estoque.valor,
        estoque_competencia: estoque.competencia,
        pmr_dias: media('pmr_dias'),
        pmp_dias: media('pmp_dias'),
        meses_prazos: linhasPrazo.length,
        custos_variaveis_mensais: entrada.custosVariaveisMensais,
        receita_mensal: Math.round(receitaMedia * 100) / 100,
        meses_dre: mesesDre.length,
      },
      entrada,
      resultado: calcularGiro(entrada),
    });
  } catch (e) {
    next(e);
  }
});

/* ==================================================================== */
/* O estoque informado no fechamento                                     */
/* ==================================================================== */

/**
 * Busca o estoque mais recente que alguém informou, com a competência.
 *
 * Duas telas precisam do mesmo número — o ciclo e o capital de giro — e
 * até 21/09/2026 as duas pediam para digitar e esqueciam no recarregar.
 * Agora leem do fechamento mensal.
 *
 * A competência volta junto de propósito. Mostrar "estoque: R$ 144.000"
 * sem dizer de quando ele é convida a tratar um número de três meses
 * atrás como se fosse de hoje — e no ciclo, um estoque velho não erra
 * para qualquer lado: quase sempre erra para menos, que é a direção que
 * faz a empresa parecer saudável.
 */
async function estoqueInformado(
  supabase: any,
  tenant: string,
): Promise<{ valor: number | null; competencia: string | null }> {
  const { data, error } = await supabase
    .from('vw_fechamento_ultimo')
    .select('competencia, estoque_valor')
    .eq('tenant_id', tenant)
    .maybeSingle();

  if (error) throw fromPostgrest(error);
  if (!data || data.estoque_valor === null || data.estoque_valor === undefined) {
    return { valor: null, competencia: null };
  }
  return { valor: Number(data.estoque_valor), competencia: data.competencia };
}

/* ==================================================================== */
/* Ciclo operacional e financeiro                                        */
/* ==================================================================== */

/**
 * A calculadora da Aula 4.1, com três dos quatro valores já medidos.
 *
 * Receita vem do DRE, a receber e a pagar vêm de `vw_contas_resumo`. Só
 * o estoque é digitado: a plataforma não controla estoque, e assumir
 * zero calado subestimaria o ciclo — que é justamente o erro perigoso
 * desta conta, porque faz a empresa parecer saudável quando não é.
 *
 * A receita é a MÉDIA de até três meses fechados, não o último mês.
 *
 * A receita aqui é a régua que converte reais em dias: todos os três
 * prazos saem dela. Um mês fraco encurtaria os três de uma vez e o
 * ciclo apareceria menor justamente quando piorou. É a mesma média que
 * o ponto de equilíbrio e o capital de giro já usam — três telas
 * divergindo sobre "quanto esta empresa fatura por mês" seria pior do
 * que qualquer erro de arredondamento.
 *
 * Os quatro aceitam sobrescrita por query: a tela precisa simular "e se
 * eu cortar 10 dias de estoque?" sem gravar nada.
 */
equilibrioRouter.get('/ciclo', async (req, res, next) => {
  try {
    const tenant = req.tenantId!;

    const db = req.supabase as unknown as { from: (t: string) => any };

    const [dre, contas, estoque, historico] = await Promise.all([
      req.supabase
        .from('vw_dre_monthly')
        .select('competencia, receita_bruta')
        .eq('tenant_id', tenant)
        .lt('competencia', `${new Date().toISOString().slice(0, 7)}-01`)
        .order('competencia', { ascending: false })
        .limit(3),
      req.supabase
        .from('vw_contas_resumo')
        .select('natureza, total_aberto')
        .eq('tenant_id', tenant),
      estoqueInformado(req.supabase, tenant),
      // O histórico da própria empresa — entrou em 24/09/2026 para dar
      // um parâmetro que não dependa de setor. Seis meses: o suficiente
      // para ver tendência, pouco o bastante para caber na tela.
      db
        .from('vw_ciclo_mensal')
        .select('competencia, ciclo_financeiro, estoque_informado, dinheiro_preso')
        .eq('tenant_id', tenant)
        .lt('competencia', `${new Date().toISOString().slice(0, 7)}-01`)
        .order('competencia', { ascending: false })
        .limit(6),
    ]);

    for (const r of [dre, contas]) {
      if (r.error) throw fromPostgrest(r.error);
    }

    const meses: any[] = (dre.data ?? []) as any[];
    const linhas: any[] = (contas.data ?? []) as any[];
    const aberto = (nat: string) =>
      Number(linhas.find((c) => c.natureza === nat)?.total_aberto ?? 0);

    const medido = {
      receita_mensal: meses.length
        ? Math.round(
            (meses.reduce((s, m) => s + Number(m.receita_bruta ?? 0), 0) / meses.length) * 100,
          ) / 100
        : 0,
      meses_receita: meses.length,
      a_receber: aberto('a_receber'),
      a_pagar: aberto('a_pagar'),
      estoque: estoque.valor,
      estoque_competencia: estoque.competencia,
      /**
       * Ciclo dos meses fechados, do mais recente para trás.
       *
       * Falha aqui não derruba a tela: a view é nova e pode não existir
       * num banco que ainda não aplicou o SQL 54. Sem histórico a tela
       * mostra o que sempre mostrou, em vez de exibir erro numa
       * ferramenta que funcionava.
       */
      historico: historico.error
        ? []
        : ((historico.data ?? []) as any[])
            .map((h) => ({
              competencia: String(h.competencia).slice(0, 7),
              ciclo: Number(h.ciclo_financeiro),
              dinheiro_preso: Number(h.dinheiro_preso),
              estoque_informado: Boolean(h.estoque_informado),
            }))
            .reverse(),
    };

    const q = (nome: string, padrao: number) => {
      const v = req.query[nome];
      return v === undefined ? padrao : Number(v) || 0;
    };

    const entrada = {
      receitaMensal: q('receita', medido.receita_mensal),
      estoque: q('estoque', medido.estoque ?? 0),
      aReceber: q('receber', medido.a_receber),
      aPagar: q('pagar', medido.a_pagar),
    };

    res.json({ medido, entrada, resultado: calcularCiclo(entrada) });
  } catch (e) {
    next(e);
  }
});

/* ==================================================================== */
/* Pró-labore                                                            */
/* ==================================================================== */

const prolaboreSchema = z.object({
  salario_mercado: z.coerce.number().min(0).nullish(),
  moradia: z.coerce.number().min(0).nullish(),
  alimentacao: z.coerce.number().min(0).nullish(),
  transporte: z.coerce.number().min(0).nullish(),
  saude_educacao: z.coerce.number().min(0).nullish(),
  outros_essenciais: z.coerce.number().min(0).nullish(),
  percentual_resultado: z.coerce.number().min(1).max(100).optional(),
  retirada_informada: z.coerce.number().min(0).nullish(),
});

/**
 * Os três métodos da aula 1.4, com o terceiro já medido.
 *
 * O método 3 sai de `vw_prolabore_mensal`, que separa o pró-labore
 * (dentro do resultado) da retirada (abaixo dele). Sem essa separação a
 * conta erraria nos dois sentidos ao mesmo tempo: o resultado apareceria
 * menor do que é e a retirada, menor também.
 *
 * A margem de contribuição vem do mix de produtos quando existe. É ela
 * que converte "falta resultado" em "falta vender" — e é a única ligação
 * desta tela com o Módulo 3.
 */
equilibrioRouter.get('/prolabore', async (req, res, next) => {
  try {
    const tenant = req.tenantId!;
    const hoje = `${new Date().toISOString().slice(0, 7)}-01`;

    // `prolabore_config` e `vw_prolabore_mensal` nasceram no SQL 44 e
    // ainda não estão no `database.types.ts` gerado. O apelido concentra
    // a falta de tipo nestas duas rotas, em vez de espalhar `as never`
    // pelas consultas — que silenciaria o compilador sem verificar nada.
    const db = req.supabase as unknown as { from: (t: string) => any };

    const [cfg, serie, painel] = await Promise.all([
      db
        .from('prolabore_config')
        .select('*')
        .eq('tenant_id', tenant)
        .maybeSingle(),
      db
        .from('vw_prolabore_mensal')
        .select('competencia, resultado_antes_retirada, retirada_total, pro_labore')
        .eq('tenant_id', tenant)
        .lt('competencia', hoje)
        .order('competencia', { ascending: false })
        .limit(3),
      req.supabase
        .from('mix_produtos')
        .select('preco, custo_direto, imposto_fixo, imposto_pct, variaveis_pct, participacao_pct')
        .eq('tenant_id', tenant),
    ]);

    for (const r of [cfg, serie, painel]) {
      if (r.error) throw fromPostgrest(r.error);
    }

    const c: any = cfg.data ?? {};
    const meses: any[] = (serie.data ?? []) as any[];

    // A retirada do mês mais recente, não a média: a pergunta da aula é
    // "quanto você retira HOJE por mês", e uma média de três meses
    // esconderia um aumento recente — que é justamente o que costuma
    // estar por trás do problema.
    const retiradaMedida = meses.length ? Number(meses[0].retirada_total ?? 0) : null;

    // Índice ponderado do mix. Reaproveita o mesmo cálculo do ponto de
    // equilíbrio para as duas telas não discordarem sobre a margem.
    const produtos = ((painel.data ?? []) as any[]).map((p) => ({
      nome: '',
      preco: Number(p.preco ?? 0),
      custoDireto: Number(p.custo_direto ?? 0),
      impostoFixo: Number(p.imposto_fixo ?? 0),
      impostoPct: Number(p.imposto_pct ?? 0),
      variaveisPct: Number(p.variaveis_pct ?? 0),
      participacaoPct: Number(p.participacao_pct ?? 0),
    })) as ProdutoEntrada[];

    const mix = produtos.length
      ? calcularEquilibrio({ produtos, custosFixosMensais: 0, faturamentoAtual: 0 })
      : null;
    const margemMedida = mix?.indiceMargemContribuicao ?? null;

    const q = (nome: string): number | null => {
      const v = req.query[nome];
      return v === undefined ? null : Number(v) || 0;
    };

    const entrada = {
      salarioMercado: q('salario') ?? c.salario_mercado ?? null,
      moradia: q('moradia') ?? c.moradia ?? null,
      alimentacao: q('alimentacao') ?? c.alimentacao ?? null,
      transporte: q('transporte') ?? c.transporte ?? null,
      saudeEducacao: q('saude') ?? c.saude_educacao ?? null,
      outrosEssenciais: q('outros') ?? c.outros_essenciais ?? null,
      resultados: meses.map((m) => Number(m.resultado_antes_retirada ?? 0)),
      percentualResultado: q('percentual') ?? c.percentual_resultado ?? 60,
      retiradaAtual: q('retirada') ?? c.retirada_informada ?? retiradaMedida,
      margemContribuicaoPct: q('margem') ?? margemMedida,
    };

    res.json({
      config: cfg.data ?? null,
      medido: {
        meses: meses.map((m) => ({
          competencia: m.competencia,
          resultado_antes_retirada: Number(m.resultado_antes_retirada ?? 0),
          pro_labore: Number(m.pro_labore ?? 0),
        })),
        retirada_total: retiradaMedida,
        margem_contribuicao_pct: margemMedida,
      },
      entrada,
      resultado: calcularProLabore(entrada),
    });
  } catch (e) {
    next(e);
  }
});

/** Grava o piso da vida e os parâmetros. Upsert: uma linha por empresa. */
equilibrioRouter.put('/prolabore', ESCREVE, validate(prolaboreSchema), async (req, res, next) => {
  try {
    const db = req.supabase as unknown as { from: (t: string) => any };

    const { data, error } = await db
      .from('prolabore_config')
      .upsert(
        { ...(req.body as object), tenant_id: req.tenantId! },
        { onConflict: 'tenant_id' },
      )
      .select('*')
      .single();

    if (error) throw fromPostgrest(error);
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

/* ==================================================================== */
/* Provisão: imposto, 13º/férias e reserva de emergência                 */
/* ==================================================================== */

/**
 * A calculadora da aula 4.5, com os cinco campos medidos.
 *
 * Nenhum precisa ser digitado, e é essa a diferença entre a planilha e a
 * plataforma: a receita e a alíquota saem do DRE, a folha sai das
 * categorias marcadas com `papel = 'folha'` (SQL 44), o desembolso fixo
 * sai dos custos fixos revisados mais a parcela de dívidas do
 * fechamento, e o saldo em caixa sai das contas bancárias.
 *
 * ---------------------------------------------------------------------
 * A ALÍQUOTA MEDIDA É APROXIMAÇÃO, E A TELA DIZ ISSO
 * ---------------------------------------------------------------------
 * Ela sai de `deducoes / receita_bruta`. No plano de contas padrão,
 * `deducao` guarda impostos sobre venda E devoluções — então a alíquota
 * medida sobe quando houve devolução no mês, e a provisão de imposto
 * sairia maior que a devida.
 *
 * Errar para mais numa provisão é o lado seguro: sobra dinheiro
 * separado. Mesmo assim o campo é editável, e a própria aula manda
 * perguntar a alíquota EFETIVA ao contador em vez de deduzi-la.
 *
 * ---------------------------------------------------------------------
 * A DEPRECIAÇÃO NÃO DEVERIA ESTAR NO DESEMBOLSO
 * ---------------------------------------------------------------------
 * Depreciação é despesa, não saída de caixa, e a aula é explícita ao
 * pedir "fixo SEM depreciação". A plataforma não sabe qual categoria é
 * depreciação — mas o painel de custos fixos já tem a caixinha
 * "incluir" por item, e desmarcar ali resolve, aqui e nas outras duas
 * ferramentas que usam o mesmo total.
 */
equilibrioRouter.get('/provisao', async (req, res, next) => {
  try {
    const tenant = req.tenantId!;
    const hoje = `${new Date().toISOString().slice(0, 7)}-01`;
    const db = req.supabase as unknown as { from: (t: string) => any };

    const [revisoes, medidos, dre, folhaSerie, kpis, fech] = await Promise.all([
      req.supabase.from('mix_custos_fixos').select('*').eq('tenant_id', tenant),
      req.supabase.rpc('fn_custos_fixos_medidos', { p_tenant: tenant }),
      req.supabase
        .from('vw_dre_monthly')
        .select('competencia, receita_bruta, deducoes')
        .eq('tenant_id', tenant)
        .lt('competencia', hoje)
        .order('competencia', { ascending: false })
        .limit(3),
      db
        .from('vw_prolabore_mensal')
        .select('competencia, folha')
        .eq('tenant_id', tenant)
        .lt('competencia', hoje)
        .order('competencia', { ascending: false })
        .limit(3),
      req.supabase
        .from('vw_dashboard_kpis')
        .select('saldo_hoje')
        .eq('tenant_id', tenant)
        .maybeSingle(),
      db
        .from('fechamentos_mensais')
        .select('competencia, parcela_dividas_mensal')
        .eq('tenant_id', tenant)
        .not('parcela_dividas_mensal', 'is', null)
        .order('competencia', { ascending: false })
        .limit(1),
    ]);

    for (const r of [revisoes, dre, folhaSerie, kpis, fech]) {
      if (r.error) throw fromPostgrest(r.error);
    }

    const { total: totalFixos } = montarCustosFixos(
      (medidos.data ?? []) as any[],
      (revisoes.data ?? []) as any[],
    );

    const mesesDre: any[] = (dre.data ?? []) as any[];
    const media = (campo: string) =>
      mesesDre.length
        ? mesesDre.reduce((s, m) => s + Number(m?.[campo] ?? 0), 0) / mesesDre.length
        : 0;

    const receitaMedia = Math.round(media('receita_bruta') * 100) / 100;
    const deducoesMedia = media('deducoes');
    const aliquotaMedida =
      receitaMedia > 0 ? Math.round((deducoesMedia / receitaMedia) * 10000) / 100 : 0;

    const mesesFolha: any[] = (folhaSerie.data ?? []) as any[];
    const folhaMedida = mesesFolha.length
      ? Math.round(
          (mesesFolha.reduce((s, m) => s + Number(m.folha ?? 0), 0) / mesesFolha.length) * 100,
        ) / 100
      : 0;

    const parcela = Number((fech.data as any[])?.[0]?.parcela_dividas_mensal ?? 0);
    const desembolsoMedido = Math.round((totalFixos + parcela) * 100) / 100;
    const caixa = Number((kpis.data as any)?.saldo_hoje ?? 0);

    const q = (nome: string, padrao: number) => {
      const v = req.query[nome];
      return v === undefined ? padrao : Number(v) || 0;
    };

    const entrada = {
      receitaMensal: q('receita', receitaMedia),
      aliquotaPct: q('aliquota', aliquotaMedida),
      folhaMensal: q('folha', folhaMedida),
      desembolsoFixoMensal: q('desembolso', desembolsoMedido),
      saldoCaixa: q('caixa', caixa),
    };

    res.json({
      medido: {
        receita_mensal: receitaMedia,
        meses_dre: mesesDre.length,
        aliquota_pct: aliquotaMedida,
        folha_mensal: folhaMedida,
        // Zero aqui quase sempre significa categoria sem `papel`, não
        // empresa sem funcionário. A tela precisa saber distinguir.
        folha_tem_categoria_marcada: mesesFolha.some((m) => Number(m.folha ?? 0) > 0),
        custos_fixos: totalFixos,
        parcela_dividas: parcela,
        desembolso_fixo: desembolsoMedido,
        saldo_caixa: caixa,
      },
      entrada,
      resultado: calcularProvisao(entrada),
    });
  } catch (e) {
    next(e);
  }
});

/* ==================================================================== */
/* Indicadores comerciais                                                */
/* ==================================================================== */

const comercialSchema = z.object({
  compras_por_ano: z.coerce.number().min(0).max(999).nullish(),
  anos_relacionamento: z.coerce.number().min(0).max(99).nullish(),
});

/**
 * Ticket, conversão e CAC — a aula 4.7 com tudo medido menos a recompra.
 *
 * As contagens (vendas, atendimentos, clientes novos) vêm do fechamento
 * mensal. Elas NÃO herdam do mês anterior, por decisão do SQL 43: uma
 * conversão copiada de agosto para setembro nunca mudaria, e é a
 * variação que esta tela existe para mostrar.
 *
 * Por isso a busca é pelo fechamento mais recente que tenha ao menos uma
 * das três — e a competência viaja junto, para a tela poder dizer de
 * quando são os números em vez de deixar parecerem de hoje.
 */
equilibrioRouter.get('/comercial', async (req, res, next) => {
  try {
    const tenant = req.tenantId!;
    const hoje = `${new Date().toISOString().slice(0, 7)}-01`;
    const db = req.supabase as unknown as { from: (t: string) => any };

    const [cfg, fech, dre, verba, mixProdutos] = await Promise.all([
      db.from('comercial_config').select('*').eq('tenant_id', tenant).maybeSingle(),
      db
        .from('vw_fechamento_ultimo')
        .select('competencia, atendimentos, vendas_numero, clientes_novos')
        .eq('tenant_id', tenant)
        .maybeSingle(),
      req.supabase
        .from('vw_dre_monthly')
        .select('competencia, receita_bruta')
        .eq('tenant_id', tenant)
        .lt('competencia', hoje)
        .order('competencia', { ascending: false })
        .limit(3),
      db.from('vw_verba_midia_ultima').select('*').eq('tenant_id', tenant).maybeSingle(),
      req.supabase
        .from('mix_produtos')
        .select('preco, custo_direto, imposto_fixo, imposto_pct, variaveis_pct, participacao_pct')
        .eq('tenant_id', tenant),
    ]);

    for (const r of [cfg, fech, dre, verba, mixProdutos]) {
      if (r.error) throw fromPostgrest(r.error);
    }

    const c: any = cfg.data ?? {};
    const f: any = fech.data ?? {};
    const v: any = verba.data ?? {};

    const mesesDre: any[] = (dre.data ?? []) as any[];
    const receitaMedia = mesesDre.length
      ? Math.round(
          (mesesDre.reduce((s, m) => s + Number(m.receita_bruta ?? 0), 0) / mesesDre.length) * 100,
        ) / 100
      : 0;

    const produtos = ((mixProdutos.data ?? []) as any[]).map((p) => ({
      nome: '',
      preco: Number(p.preco ?? 0),
      custoDireto: Number(p.custo_direto ?? 0),
      impostoFixo: Number(p.imposto_fixo ?? 0),
      impostoPct: Number(p.imposto_pct ?? 0),
      variaveisPct: Number(p.variaveis_pct ?? 0),
      participacaoPct: Number(p.participacao_pct ?? 0),
    })) as ProdutoEntrada[];

    const mix = produtos.length
      ? calcularEquilibrio({ produtos, custosFixosMensais: 0, faturamentoAtual: 0 })
      : null;
    const margemMedida = mix?.indiceMargemContribuicao ?? 0;

    const q = (nome: string, padrao: number) => {
      const x = req.query[nome];
      return x === undefined ? padrao : Number(x) || 0;
    };

    const entrada = {
      faturamentoMensal: q('faturamento', receitaMedia),
      vendas: q('vendas', Number(f.vendas_numero ?? 0)),
      atendimentos: q('atendimentos', Number(f.atendimentos ?? 0)),
      verbaMarketing: q('verba', Number(v.verba_total ?? 0)),
      clientesNovos: q('novos', Number(f.clientes_novos ?? 0)),
      margemContribuicaoPct: q('margem', margemMedida),
      comprasPorAno: q('compras', Number(c.compras_por_ano ?? 0)),
      anosRelacionamento: q('anos', Number(c.anos_relacionamento ?? 0)),
    };

    res.json({
      config: cfg.data ?? null,
      medido: {
        faturamento_mensal: receitaMedia,
        meses_dre: mesesDre.length,
        competencia_contagens: f.competencia ?? null,
        vendas: f.vendas_numero ?? null,
        atendimentos: f.atendimentos ?? null,
        clientes_novos: f.clientes_novos ?? null,
        verba_marketing: v.verba_total ?? null,
        competencia_verba: v.competencia ?? null,
        margem_contribuicao_pct: mix ? margemMedida : null,
      },
      entrada,
      resultado: calcularComercial(entrada),
    });
  } catch (e) {
    next(e);
  }
});

/** Grava as duas estimativas de recompra. */
equilibrioRouter.put('/comercial', ESCREVE, validate(comercialSchema), async (req, res, next) => {
  try {
    const db = req.supabase as unknown as { from: (t: string) => any };

    const { data, error } = await db
      .from('comercial_config')
      .upsert({ ...(req.body as object), tenant_id: req.tenantId! }, { onConflict: 'tenant_id' })
      .select('*')
      .single();

    if (error) throw fromPostgrest(error);
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

/* ==================================================================== */
/* Orçamento anual                                                       */
/* ==================================================================== */

const cenarioSchema = z.object({
  cenario: z.enum(['pessimista', 'realista', 'otimista']),
  atendimentos: z.coerce.number().int().min(0).nullish(),
  conversao_pct: z.coerce.number().min(0).max(100).nullish(),
  ticket: z.coerce.number().min(0).nullish(),
  margem_pct: z.coerce.number().min(0).max(100).nullish(),
});

const tetoSchema = z.object({
  category_id: z.string().uuid(),
  /** Nulo apaga o teto daquele grupo. */
  teto_pct: z.coerce.number().min(0).max(100).nullable(),
});

/**
 * Os três cenários da aula 4.6, com o realista já preenchido.
 *
 * O realista nasce do que a empresa faz HOJE — atendimentos, conversão
 * e ticket dos indicadores comerciais, margem do mix. É a diferença
 * entre abrir a tela e encarar nove campos vazios e abrir a tela e
 * ajustar dois números.
 *
 * O custo fixo é o mesmo nos três, e é o total dos custos fixos
 * revisados. Não somo a parcela de dívidas aqui, diferente da provisão:
 * a amortização do principal não é despesa e não entra num orçamento de
 * resultado — só o juro entra, e ele já está na categoria Financeira.
 */
equilibrioRouter.get('/orcamento', async (req, res, next) => {
  try {
    const tenant = req.tenantId!;
    const hoje = `${new Date().toISOString().slice(0, 7)}-01`;
    const db = req.supabase as unknown as { from: (t: string) => any };

    const [cenarios, tetos, despesas, revisoes, medidos, fech, dre, mixProdutos] =
      await Promise.all([
        db.from('orcamento_cenarios').select('*').eq('tenant_id', tenant),
        db.from('orcamento_tetos').select('*').eq('tenant_id', tenant),
        db.from('vw_despesas_por_categoria').select('*').eq('tenant_id', tenant),
        req.supabase.from('mix_custos_fixos').select('*').eq('tenant_id', tenant),
        req.supabase.rpc('fn_custos_fixos_medidos', { p_tenant: tenant }),
        db
          .from('vw_fechamento_ultimo')
          .select('competencia, atendimentos, vendas_numero')
          .eq('tenant_id', tenant)
          .maybeSingle(),
        req.supabase
          .from('vw_dre_monthly')
          .select('competencia, receita_bruta')
          .eq('tenant_id', tenant)
          .lt('competencia', hoje)
          .order('competencia', { ascending: false })
          .limit(3),
        req.supabase
          .from('mix_produtos')
          .select('preco, custo_direto, imposto_fixo, imposto_pct, variaveis_pct, participacao_pct')
          .eq('tenant_id', tenant),
      ]);

    for (const r of [cenarios, tetos, despesas, revisoes, fech, dre, mixProdutos]) {
      if (r.error) throw fromPostgrest(r.error);
    }

    const { total: custoFixo } = montarCustosFixos(
      (medidos.data ?? []) as any[],
      (revisoes.data ?? []) as any[],
    );

    /* ---------------------------------------- O realista de hoje */
    const mesesDre: any[] = (dre.data ?? []) as any[];
    const receitaMedia = mesesDre.length
      ? mesesDre.reduce((s, m) => s + Number(m.receita_bruta ?? 0), 0) / mesesDre.length
      : 0;

    const f: any = fech.data ?? {};
    const atendimentosHoje = Number(f.atendimentos ?? 0);
    const vendasHoje = Number(f.vendas_numero ?? 0);

    const conversaoHoje =
      atendimentosHoje > 0 && vendasHoje > 0
        ? Math.round((vendasHoje / atendimentosHoje) * 10000) / 100
        : 0;
    const ticketHoje = vendasHoje > 0 ? Math.round((receitaMedia / vendasHoje) * 100) / 100 : 0;

    const produtos = ((mixProdutos.data ?? []) as any[]).map((p) => ({
      nome: '',
      preco: Number(p.preco ?? 0),
      custoDireto: Number(p.custo_direto ?? 0),
      impostoFixo: Number(p.imposto_fixo ?? 0),
      impostoPct: Number(p.imposto_pct ?? 0),
      variaveisPct: Number(p.variaveis_pct ?? 0),
      participacaoPct: Number(p.participacao_pct ?? 0),
    })) as ProdutoEntrada[];

    const mix = produtos.length
      ? calcularEquilibrio({ produtos, custosFixosMensais: 0, faturamentoAtual: 0 })
      : null;
    const margemMedida = mix?.indiceMargemContribuicao ?? 0;

    const salvos = new Map<string, any>(
      ((cenarios.data ?? []) as any[]).map((c) => [c.cenario, c]),
    );

    // Só o realista herda o desempenho de hoje. Pessimista e otimista
    // nascem vazios de propósito: são escolha de gestão, e preenchê-los
    // com uma variação automática daria a impressão de que a plataforma
    // sabe algo sobre o ano que vem que ela não sabe.
    const doCenario = (nome: string) => {
      const s = salvos.get(nome) ?? {};
      const ehRealista = nome === 'realista';
      return {
        atendimentos: Number(s.atendimentos ?? (ehRealista ? atendimentosHoje : 0)),
        conversaoPct: Number(s.conversao_pct ?? (ehRealista ? conversaoHoje : 0)),
        ticket: Number(s.ticket ?? (ehRealista ? ticketHoje : 0)),
        margemPct: Number(s.margem_pct ?? margemMedida),
      };
    };

    /* ------------------------------------------------- Os tetos */
    const pctPorCategoria = new Map<string, number>(
      ((tetos.data ?? []) as any[]).map((t) => [t.category_id, Number(t.teto_pct)]),
    );

    const listaTetos = ((despesas.data ?? []) as any[])
      .map((d) => ({
        categoriaId: d.category_id as string,
        nome: d.categoria as string,
        gastoAtual: Number(d.media_mensal ?? 0),
        tetoPct: pctPorCategoria.has(d.category_id)
          ? pctPorCategoria.get(d.category_id)!
          : null,
      }))
      .sort((a, b) => b.gastoAtual - a.gastoAtual);

    const entrada = {
      pessimista: doCenario('pessimista'),
      realista: doCenario('realista'),
      otimista: doCenario('otimista'),
      custoFixoMensal: Number(req.query.fixo ?? custoFixo) || 0,
      tetos: listaTetos,
    };

    res.json({
      cenarios_salvos: cenarios.data ?? [],
      medido: {
        atendimentos: f.atendimentos ?? null,
        vendas: f.vendas_numero ?? null,
        competencia_contagens: f.competencia ?? null,
        conversao_pct: conversaoHoje,
        ticket: ticketHoje,
        margem_contribuicao_pct: mix ? margemMedida : null,
        custo_fixo_mensal: custoFixo,
        receita_media: Math.round(receitaMedia * 100) / 100,
        meses_dre: mesesDre.length,
      },
      entrada,
      resultado: calcularOrcamento(entrada),
    });
  } catch (e) {
    next(e);
  }
});

/** Grava um cenário. Upsert por (tenant, cenário) — sempre três linhas. */
equilibrioRouter.put('/orcamento/cenario', ESCREVE, validate(cenarioSchema), async (req, res, next) => {
  try {
    const db = req.supabase as unknown as { from: (t: string) => any };

    const { data, error } = await db
      .from('orcamento_cenarios')
      .upsert({ ...(req.body as object), tenant_id: req.tenantId! }, { onConflict: 'tenant_id,cenario' })
      .select('*')
      .single();

    if (error) throw fromPostgrest(error);
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

/**
 * Define ou remove o teto de um grupo.
 *
 * `teto_pct` nulo apaga a linha em vez de gravar zero. Zero seria um
 * teto de zero reais — "não pode gastar nada" — e não "sem limite
 * definido". A diferença aparece na tela como folga negativa de todo o
 * gasto do grupo, o que pareceria erro do sistema.
 */
equilibrioRouter.put('/orcamento/teto', ESCREVE, validate(tetoSchema), async (req, res, next) => {
  try {
    const db = req.supabase as unknown as { from: (t: string) => any };
    const corpo = req.body as z.infer<typeof tetoSchema>;

    if (corpo.teto_pct === null) {
      const { error } = await db
        .from('orcamento_tetos')
        .delete()
        .eq('tenant_id', req.tenantId!)
        .eq('category_id', corpo.category_id);

      if (error) throw fromPostgrest(error);
      return res.status(204).end();
    }

    const { data, error } = await db
      .from('orcamento_tetos')
      .upsert(
        { tenant_id: req.tenantId!, category_id: corpo.category_id, teto_pct: corpo.teto_pct },
        { onConflict: 'tenant_id,category_id' },
      )
      .select('*')
      .single();

    if (error) throw fromPostgrest(error);
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

/* ==================================================================== */
/* Os três índices                                                       */
/* ==================================================================== */

/**
 * Margem, lucratividade e rentabilidade — a aula 4.8, sem digitar nada.
 *
 * Esta é a única ferramenta que não pede número nenhum: as dez entradas
 * da planilha já existem na plataforma depois do SQL 43 e do 44. É o
 * pagamento do investimento feito no Fechamento do mês.
 *
 * ---------------------------------------------------------------------
 * O DENOMINADOR DA LIQUIDEZ
 * ---------------------------------------------------------------------
 * A planilha pede "a pagar no ano" como campo solto. Aqui ele é
 * fornecedores em aberto mais o passivo de curto prazo do fechamento —
 * por definição, o que vence nos próximos doze meses. O passivo de
 * longo prazo fica de fora: ele entra no endividamento, não na liquidez.
 */
equilibrioRouter.get('/indices', async (req, res, next) => {
  try {
    const tenant = req.tenantId!;
    const hoje = `${new Date().toISOString().slice(0, 7)}-01`;
    const db = req.supabase as unknown as { from: (t: string) => any };

    const [dre, prolabore, fechOperacional, fechPassivo, contas, kpis] = await Promise.all([
      req.supabase
        .from('vw_dre_monthly')
        .select('competencia, receita_bruta, margem_contribuicao, resultado_liquido')
        .eq('tenant_id', tenant)
        .lt('competencia', hoje)
        .order('competencia', { ascending: false })
        .limit(1),
      db
        .from('vw_prolabore_mensal')
        .select('competencia, pro_labore')
        .eq('tenant_id', tenant)
        .lt('competencia', hoje)
        .order('competencia', { ascending: false })
        .limit(1),
      db
        .from('vw_fechamento_ultimo')
        .select('competencia, estoque_valor, imobilizado_liquido')
        .eq('tenant_id', tenant)
        .maybeSingle(),
      db
        .from('fechamentos_mensais')
        .select('competencia, passivo_curto_prazo, passivo_longo_prazo')
        .eq('tenant_id', tenant)
        .not('passivo_curto_prazo', 'is', null)
        .order('competencia', { ascending: false })
        .limit(1),
      req.supabase
        .from('vw_contas_resumo')
        .select('natureza, total_aberto')
        .eq('tenant_id', tenant),
      req.supabase
        .from('vw_dashboard_kpis')
        .select('saldo_hoje')
        .eq('tenant_id', tenant)
        .maybeSingle(),
    ]);

    for (const r of [dre, prolabore, fechOperacional, fechPassivo, contas, kpis]) {
      if (r.error) throw fromPostgrest(r.error);
    }

    const mes: any = (dre.data as any[])?.[0] ?? {};
    const pl: any = (prolabore.data as any[])?.[0] ?? {};
    const op: any = fechOperacional.data ?? {};
    const pas: any = (fechPassivo.data as any[])?.[0] ?? {};

    const linhas: any[] = (contas.data ?? []) as any[];
    const aberto = (nat: string) =>
      Number(linhas.find((c) => c.natureza === nat)?.total_aberto ?? 0);

    const fornecedores = aberto('a_pagar');
    const passivoCurto = Number(pas.passivo_curto_prazo ?? 0);
    const passivoLongo = Number(pas.passivo_longo_prazo ?? 0);

    const q = (nome: string, padrao: number) => {
      const v = req.query[nome];
      return v === undefined ? padrao : Number(v) || 0;
    };

    const entrada = {
      faturamentoMensal: q('faturamento', Number(mes.receita_bruta ?? 0)),
      margemContribuicao: q('margem', Number(mes.margem_contribuicao ?? 0)),
      lucroMensal: q('lucro', Number(mes.resultado_liquido ?? 0)),
      proLabore: q('prolabore', Number(pl.pro_labore ?? 0)),

      estoque: q('estoque', Number(op.estoque_valor ?? 0)),
      clientesAReceber: q('receber', aberto('a_receber')),
      imobilizado: q('imobilizado', Number(op.imobilizado_liquido ?? 0)),
      saldoCaixa: q('caixa', Number((kpis.data as any)?.saldo_hoje ?? 0)),

      fornecedoresAPagar: q('pagar', fornecedores),
      // O saldo devedor é o principal que falta amortizar: curto mais
      // longo prazo. O fechamento guarda os dois separados porque a
      // liquidez só olha o curto.
      saldoDevedor: q('divida', passivoCurto + passivoLongo),
      aPagarNoAno: q('anual', fornecedores + passivoCurto),
    };

    res.json({
      medido: {
        competencia_dre: mes.competencia ?? null,
        competencia_fechamento: op.competencia ?? null,
        competencia_passivo: pas.competencia ?? null,
        tem_estoque_informado: op.estoque_valor !== null && op.estoque_valor !== undefined,
        tem_imobilizado_informado:
          op.imobilizado_liquido !== null && op.imobilizado_liquido !== undefined,
        tem_passivo_informado: pas.passivo_curto_prazo !== null && pas.passivo_curto_prazo !== undefined,
        passivo_curto_prazo: passivoCurto,
        passivo_longo_prazo: passivoLongo,
      },
      entrada,
      resultado: calcularIndices(entrada),
    });
  } catch (e) {
    next(e);
  }
});

/* ==================================================================== */
/* Plano de redução de ciclo                                             */
/* ==================================================================== */

const alavancaSchema = z.object({
  titulo: z.string().trim().min(3).max(200),
  detalhe: z.string().trim().max(2000).nullish(),
  ganho_dias: z.coerce.number().min(0).max(999),
  responsavel_nome: z.string().trim().min(2).max(120),
  prazo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD'),
});

/**
 * Garante que existe um plano ativo e devolve o id.
 *
 * O índice `planos_acao_um_ativo_idx` permite UM plano ativo por
 * empresa. Isso é bom — impede a lista de pendências de se dividir em
 * vários lugares — e significa que a alavanca entra no plano que já
 * existe, seja ele do PDCA ou não.
 *
 * Quando não há nenhum, a ferramenta cria: é melhor que recusar a
 * primeira alavanca com "crie um plano antes", que manda o cliente
 * procurar uma tela que ele não sabe onde fica.
 */
async function planoAtivo(db: any, tenant: string): Promise<string> {
  const { data, error } = await db
    .from('planos_acao')
    .select('id')
    .eq('tenant_id', tenant)
    .eq('status', 'ativo')
    .maybeSingle();

  if (error) throw fromPostgrest(error);
  if (data?.id) return data.id as string;

  const { data: novo, error: erroNovo } = await db
    .from('planos_acao')
    .insert({ tenant_id: tenant, titulo: 'Plano de ação', status: 'ativo' })
    .select('id')
    .single();

  if (erroNovo) throw fromPostgrest(erroNovo);
  return novo.id as string;
}

/**
 * O plano da aula 4.3, com o ciclo de hoje já medido.
 *
 * Reaproveita `calcularCiclo` para o ponto de partida em vez de recebê-lo
 * por parâmetro: se as duas telas calculassem o ciclo de formas
 * diferentes, o plano prometeria reduzir um número que a outra
 * ferramenta não mostra.
 */
equilibrioRouter.get('/plano-ciclo', async (req, res, next) => {
  try {
    const tenant = req.tenantId!;
    const hoje = `${new Date().toISOString().slice(0, 7)}-01`;
    const db = req.supabase as unknown as { from: (t: string) => any };

    const [dre, contas, estoque, acoes, fech] = await Promise.all([
      req.supabase
        .from('vw_dre_monthly')
        .select('competencia, receita_bruta')
        .eq('tenant_id', tenant)
        .lt('competencia', hoje)
        .order('competencia', { ascending: false })
        .limit(3),
      req.supabase
        .from('vw_contas_resumo')
        .select('natureza, total_aberto')
        .eq('tenant_id', tenant),
      estoqueInformado(req.supabase, tenant),
      db
        .from('acoes')
        .select('id, titulo, detalhe, ganho_dias, responsavel_nome, prazo, status, ordem')
        .eq('tenant_id', tenant)
        .not('ganho_dias', 'is', null)
        .order('ordem')
        .order('created_at'),
      db
        .from('fechamentos_mensais')
        .select('competencia, custo_divida_pct_am')
        .eq('tenant_id', tenant)
        .not('custo_divida_pct_am', 'is', null)
        .order('competencia', { ascending: false })
        .limit(1),
    ]);

    for (const r of [dre, contas, acoes, fech]) {
      if (r.error) throw fromPostgrest(r.error);
    }

    const meses: any[] = (dre.data ?? []) as any[];
    const receitaMedia = meses.length
      ? meses.reduce((s, m) => s + Number(m.receita_bruta ?? 0), 0) / meses.length
      : 0;

    const linhas: any[] = (contas.data ?? []) as any[];
    const aberto = (nat: string) =>
      Number(linhas.find((c) => c.natureza === nat)?.total_aberto ?? 0);

    // Mesmo cálculo da calculadora de ciclo. Duas implementações do
    // mesmo número divergiriam na primeira mudança de régua.
    const ciclo = calcularCiclo({
      receitaMensal: receitaMedia,
      estoque: estoque.valor ?? 0,
      aReceber: aberto('a_receber'),
      aPagar: aberto('a_pagar'),
    });

    const taxaSalva = Number((fech.data as any[])?.[0]?.custo_divida_pct_am ?? 0);

    const entrada = {
      cicloHojeDias: Number(req.query.ciclo ?? ciclo.cicloFinanceiro) || 0,
      vendaDiaria: Number(req.query.venda ?? ciclo.vendaDiaria) || 0,
      taxaCapitalGiroMesPct: Number(req.query.taxa ?? taxaSalva) || null,
      alavancas: ((acoes.data ?? []) as any[]).map((a) => ({
        id: a.id as string,
        titulo: a.titulo as string,
        detalhe: (a.detalhe ?? null) as string | null,
        ganhoDias: Number(a.ganho_dias ?? 0),
        responsavel: a.responsavel_nome as string,
        prazo: a.prazo as string,
        status: a.status as 'aberta' | 'concluida' | 'cancelada',
      })),
    };

    res.json({
      medido: {
        ciclo_hoje: ciclo.cicloFinanceiro,
        venda_diaria: ciclo.vendaDiaria,
        estoque_informado: estoque.valor !== null,
        ciclo_erro: ciclo.erro,
        taxa_capital_giro_pct: taxaSalva || null,
      },
      entrada,
      resultado: calcularPlanoCiclo(entrada),
    });
  } catch (e) {
    next(e);
  }
});

/** Cria uma alavanca no plano ativo. */
equilibrioRouter.post('/plano-ciclo', ESCREVE, validate(alavancaSchema), async (req, res, next) => {
  try {
    const db = req.supabase as unknown as { from: (t: string) => any };
    const plano = await planoAtivo(db, req.tenantId!);

    const { data, error } = await db
      .from('acoes')
      .insert({
        ...(req.body as object),
        plano_id: plano,
        tenant_id: req.tenantId!,
        pilar: 'Ciclo financeiro',
      })
      .select('*')
      .single();

    if (error) throw fromPostgrest(error);
    res.status(201).json({ data });
  } catch (e) {
    next(e);
  }
});

equilibrioRouter.patch(
  '/plano-ciclo/:id',
  ESCREVE,
  validate(
    alavancaSchema.partial().extend({
      status: z.enum(['aberta', 'concluida', 'cancelada']).optional(),
    }),
  ),
  async (req, res, next) => {
    try {
      const db = req.supabase as unknown as { from: (t: string) => any };
      const corpo = { ...(req.body as Record<string, unknown>) };

      // Concluir carimba a data; reabrir limpa. Sem isso, uma alavanca
      // reaberta guardaria a data da conclusão anterior e o histórico do
      // plano passaria a mentir.
      if (corpo.status === 'concluida') {
        corpo.concluida_em = new Date().toISOString();
        corpo.concluida_por = req.user!.id;
      } else if (corpo.status === 'aberta') {
        corpo.concluida_em = null;
        corpo.concluida_por = null;
      }

      const { data, error } = await db
        .from('acoes')
        .update(corpo)
        .eq('id', req.params.id!)
        .eq('tenant_id', req.tenantId!)
        .not('ganho_dias', 'is', null)
        .select('*')
        .maybeSingle();

      if (error) throw fromPostgrest(error);
      if (!data) return next(notFound('Alavanca não encontrada'));
      res.json({ data });
    } catch (e) {
      next(e);
    }
  },
);

equilibrioRouter.delete('/plano-ciclo/:id', ESCREVE, async (req, res, next) => {
  try {
    const db = req.supabase as unknown as { from: (t: string) => any };

    // O filtro por `ganho_dias` impede esta rota de apagar uma ação
    // comum do PDCA se alguém mandar um id de outra tela.
    const { error } = await db
      .from('acoes')
      .delete()
      .eq('id', req.params.id!)
      .eq('tenant_id', req.tenantId!)
      .not('ganho_dias', 'is', null);

    if (error) throw fromPostgrest(error);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

/* ==================================================================== */
/* Hora produtiva                                                        */
/* ==================================================================== */

const horaSchema = z.object({
  /**
   * Folha informada à mão. Nulo devolve o comando à medição.
   *
   * `nullish` e não `optional`: a tela precisa conseguir APAGAR o valor
   * para voltar ao medido, e um campo ausente seria lido como "não mexi".
   */
  folha_mensal: z.coerce.number().min(0).max(99_999_999).nullish(),
  pessoas: z.coerce.number().int().min(1).max(9999).nullish(),
  horas_contratadas: z.coerce.number().min(1).max(744).optional(),
  horas_ferias: z.coerce.number().min(0).optional(),
  horas_feriados: z.coerce.number().min(0).optional(),
  horas_faltas: z.coerce.number().min(0).optional(),
  ocupacao_pct: z.coerce.number().min(1).max(100).optional(),
  servico_nome: z.string().trim().min(2).max(120).nullish(),
  servico_horas: z.coerce.number().min(0).nullish(),
  servico_por_mes: z.coerce.number().min(0).nullish(),
});

/**
 * O custo real de uma hora da equipe — aula 3.4.
 *
 * A folha vem das categorias com `papel = 'folha'` (SQL 44), média dos
 * três últimos meses fechados. Média e não o último mês porque
 * dezembro, com o 13º, dobraria a folha e faria a hora parecer o dobro
 * do que é justamente no mês em que mais se orça para o ano seguinte.
 */
equilibrioRouter.get('/hora-produtiva', async (req, res, next) => {
  try {
    const tenant = req.tenantId!;
    const hoje = `${new Date().toISOString().slice(0, 7)}-01`;
    const db = req.supabase as unknown as { from: (t: string) => any };

    const [cfg, folhaSerie] = await Promise.all([
      db.from('hora_produtiva_config').select('*').eq('tenant_id', tenant).maybeSingle(),
      db
        .from('vw_prolabore_mensal')
        .select('competencia, folha')
        .eq('tenant_id', tenant)
        .lt('competencia', hoje)
        .order('competencia', { ascending: false })
        .limit(3),
    ]);

    for (const r of [cfg, folhaSerie]) {
      if (r.error) throw fromPostgrest(r.error);
    }

    const c: any = cfg.data ?? {};
    const meses: any[] = (folhaSerie.data ?? []) as any[];

    const folhaMedida = meses.length
      ? Math.round(
          (meses.reduce((s, m) => s + Number(m.folha ?? 0), 0) / meses.length) * 100,
        ) / 100
      : 0;

    const q = (nome: string, padrao: number) => {
      const v = req.query[nome];
      return v === undefined ? padrao : Number(v) || 0;
    };

    // A informada vence a medida; nula devolve o comando à medição.
    const folhaInformada =
      c.folha_mensal === null || c.folha_mensal === undefined ? null : Number(c.folha_mensal);
    const folhaEfetiva = folhaInformada ?? folhaMedida;

    const entrada = {
      folhaMensal: q('folha', folhaEfetiva),
      pessoas: q('pessoas', Number(c.pessoas ?? 0)),
      horasContratadas: q('horas', Number(c.horas_contratadas ?? 220)),
      horasFerias: q('ferias', Number(c.horas_ferias ?? 0)),
      horasFeriados: q('feriados', Number(c.horas_feriados ?? 0)),
      horasFaltas: q('faltas', Number(c.horas_faltas ?? 0)),
      ocupacaoPct: q('ocupacao', Number(c.ocupacao_pct ?? 70)),
      servicoNome: (c.servico_nome ?? null) as string | null,
      servicoHoras: c.servico_horas === null || c.servico_horas === undefined
        ? null
        : Number(c.servico_horas),
      servicoPorMes: c.servico_por_mes === null || c.servico_por_mes === undefined
        ? null
        : Number(c.servico_por_mes),
    };

    res.json({
      config: cfg.data ?? null,
      medido: {
        folha_mensal: folhaMedida,
        meses_folha: meses.length,
        // Zero com meses medidos quase sempre significa categoria sem
        // `papel = 'folha'`, não empresa sem funcionário.
        folha_tem_categoria_marcada: meses.some((m) => Number(m.folha ?? 0) > 0),
        // Qual dos dois números a conta usou. A tela precisa dizer isso:
        // um valor sem procedência é a forma mais rápida de perder a
        // confiança no resultado inteiro.
        folha_origem: folhaInformada === null ? 'medida' : 'informada',
        folha_efetiva: folhaEfetiva,
      },
      entrada,
      resultado: calcularHoraProdutiva(entrada),
    });
  } catch (e) {
    next(e);
  }
});

/** Grava os parâmetros da equipe. Upsert: uma linha por empresa. */
equilibrioRouter.put('/hora-produtiva', ESCREVE, validate(horaSchema), async (req, res, next) => {
  try {
    const db = req.supabase as unknown as { from: (t: string) => any };

    const { data, error } = await db
      .from('hora_produtiva_config')
      .upsert({ ...(req.body as object), tenant_id: req.tenantId! }, { onConflict: 'tenant_id' })
      .select('*')
      .single();

    if (error) throw fromPostgrest(error);
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

/* ==================================================================== */
/* Centros de resultado                                                  */
/* ==================================================================== */

const rateioSchema = z.object({
  cost_center_id: z.string().uuid(),
  /** Nulo apaga o critério daquela frente. */
  rateio_pct: z.coerce.number().min(0).max(100).nullable(),
});

/**
 * As frentes do negócio, medidas — aula 1.8.
 *
 * Um mês por vez, escolhido pela query `?competencia=AAAA-MM`. O padrão
 * é o último mês fechado: olhar o mês corrente daria frentes pela
 * metade, e a comparação entre elas é exatamente o que esta tela faz.
 */
equilibrioRouter.get('/centros', async (req, res, next) => {
  try {
    const tenant = req.tenantId!;
    const db = req.supabase as unknown as { from: (t: string) => any };

    // Último mês fechado, salvo escolha explícita.
    const pedida = String(req.query.competencia ?? '');
    const m = pedida.match(/^(\d{4})-(\d{2})/);
    let competencia: string;
    if (m) {
      competencia = `${m[1]}-${m[2]}-01`;
    } else {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - 1);
      competencia = `${d.toISOString().slice(0, 7)}-01`;
    }

    const [linhas, centros, meses] = await Promise.all([
      db
        .from('vw_centros_resultado')
        .select('*')
        .eq('tenant_id', tenant)
        .eq('competencia', competencia),
      req.supabase
        .from('cost_centers')
        .select('id, name, is_active, rateio_pct')
        .eq('tenant_id', tenant)
        .eq('is_active', true)
        .order('name'),
      db
        .from('vw_centros_resultado')
        .select('competencia')
        .eq('tenant_id', tenant)
        .order('competencia', { ascending: false })
        .limit(24),
    ]);

    for (const r of [linhas, centros, meses]) {
      if (r.error) throw fromPostgrest(r.error);
    }

    const apurado: any[] = (linhas.data ?? []) as any[];
    const lista: any[] = (centros.data ?? []) as any[];

    const porCentro = new Map<string, any>(
      apurado.filter((l) => l.cost_center_id).map((l) => [l.cost_center_id, l]),
    );

    // A linha sem centro de custo é o bolo comum. Só a despesa fixa dela
    // entra no rateio: receita e custo variável sem frente não ajudam a
    // decidir nada, e distribuí-los pela participação seria circular —
    // a participação sai justamente da receita.
    const semCentro = apurado.find((l) => !l.cost_center_id) ?? {};
    const custoComum = Number(semCentro.despesas_fixas ?? 0);

    const frentes = lista.map((c) => {
      const l = porCentro.get(c.id) ?? {};
      return {
        id: c.id as string,
        nome: c.name as string,
        receita: Number(l.receita ?? 0),
        deducoes: Number(l.deducoes ?? 0),
        custosVariaveis: Number(l.custos_variaveis ?? 0),
        fixosDiretos: Number(l.despesas_fixas ?? 0),
        rateioPct:
          c.rateio_pct === null || c.rateio_pct === undefined ? null : Number(c.rateio_pct),
      };
    });

    const entrada = { frentes, custoComum: Number(req.query.comum ?? custoComum) || 0 };

    res.json({
      competencia,
      meses_disponiveis: Array.from(
        new Set(((meses.data ?? []) as any[]).map((x) => x.competencia)),
      ),
      medido: {
        custo_comum: custoComum,
        // Receita sem frente é um sintoma, não um número para usar: ela
        // não entra em conta nenhuma, mas o cliente precisa saber que
        // existe.
        receita_sem_centro: Number(semCentro.receita ?? 0),
        variaveis_sem_centro: Number(semCentro.custos_variaveis ?? 0),
        centros_cadastrados: lista.length,
      },
      entrada,
      resultado: calcularCentros(entrada),
    });
  } catch (e) {
    next(e);
  }
});

/** Define ou apaga o percentual de rateio de uma frente. */
equilibrioRouter.put('/centros/rateio', ESCREVE, validate(rateioSchema), async (req, res, next) => {
  try {
    const corpo = req.body as z.infer<typeof rateioSchema>;

    const { data, error } = await req.supabase
      .from('cost_centers')
      .update({ rateio_pct: corpo.rateio_pct } as never)
      .eq('id', corpo.cost_center_id)
      .eq('tenant_id', req.tenantId!)
      .select('*')
      .maybeSingle();

    if (error) throw fromPostgrest(error);
    if (!data) return next(notFound('Centro de custo não encontrado'));
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

/* ==================================================================== */
/* Fluxo de caixa projetado — 12 semanas                                 */
/* ==================================================================== */

const ajusteSchema = z.object({
  semana_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD'),
  entradas: z.coerce.number().min(0).nullable(),
  saidas: z.coerce.number().min(0).nullable(),
  observacao: z.string().trim().max(300).nullish(),
});

/** Segunda-feira da semana de uma data, em AAAA-MM-DD. */
function segundaDa(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // getUTCDay: 0 = domingo. Queremos segunda como início.
  const dia = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - dia);
  return x.toISOString().slice(0, 10);
}

function somaSemanas(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n * 7);
  return d.toISOString().slice(0, 10);
}

/**
 * A janela de 12 semanas da aula 2.4.
 *
 * Semanas, não meses — o mês esconde a quebra: pode fechar positivo e
 * ter passado quinze dias no vermelho, com fornecedor esperando e
 * cheque especial usado.
 *
 * Cada semana recebe o que JÁ ESTÁ lançado com vencimento; quando não
 * há nada lançado, entra a média das últimas 13 semanas liquidadas. Os
 * dois nunca são somados sem serem declarados — a resposta diz a origem
 * de cada número, e a tela mostra isso.
 */
equilibrioRouter.get('/fluxo', async (req, res, next) => {
  try {
    const tenant = req.tenantId!;
    const db = req.supabase as unknown as { from: (t: string) => any };

    const primeira = segundaDa(new Date());
    const limite = somaSemanas(primeira, 12);

    const [titulos, media, ajustes, kpis] = await Promise.all([
      db
        .from('vw_fluxo_semanal')
        .select('*')
        .eq('tenant_id', tenant)
        .gte('semana_inicio', primeira)
        .lt('semana_inicio', limite),
      db.from('vw_fluxo_media_semanal').select('*').eq('tenant_id', tenant).maybeSingle(),
      db
        .from('fluxo_ajustes')
        .select('*')
        .eq('tenant_id', tenant)
        .gte('semana_inicio', primeira)
        .lt('semana_inicio', limite),
      req.supabase
        .from('vw_dashboard_kpis')
        .select('saldo_hoje')
        .eq('tenant_id', tenant)
        .maybeSingle(),
    ]);

    for (const r of [titulos, media, ajustes, kpis]) {
      if (r.error) throw fromPostgrest(r.error);
    }

    const porSemana = new Map<string, any>(
      ((titulos.data ?? []) as any[]).map((t) => [String(t.semana_inicio).slice(0, 10), t]),
    );
    const ajustePorSemana = new Map<string, any>(
      ((ajustes.data ?? []) as any[]).map((a) => [String(a.semana_inicio).slice(0, 10), a]),
    );

    const m: any = media.data ?? {};

    const semanas = Array.from({ length: 12 }, (_, i) => {
      const inicio = somaSemanas(primeira, i);
      const t = porSemana.get(inicio) ?? {};
      const a = ajustePorSemana.get(inicio) ?? {};

      return {
        numero: i + 1,
        inicio,
        entradasLancadas: Number(t.entradas ?? 0),
        saidasLancadas: Number(t.saidas ?? 0),
        entradasAjustadas: a.entradas === null || a.entradas === undefined
          ? null
          : Number(a.entradas),
        saidasAjustadas: a.saidas === null || a.saidas === undefined ? null : Number(a.saidas),
        observacao: (a.observacao ?? null) as string | null,
      };
    });

    const entrada = {
      saldoInicial: Number(req.query.saldo ?? (kpis.data as any)?.saldo_hoje ?? 0),
      semanas,
      entradaSemanalMedia: Number(req.query.mediaEntrada ?? m.entrada_media ?? 0),
      saidaSemanalMedia: Number(req.query.mediaSaida ?? m.saida_media ?? 0),
      semanasDeHistorico: Number(m.semanas ?? 0),
    };

    const primeiraLinha = porSemana.get(primeira) ?? {};

    res.json({
      medido: {
        saldo_hoje: Number((kpis.data as any)?.saldo_hoje ?? 0),
        entrada_media: Number(m.entrada_media ?? 0),
        saida_media: Number(m.saida_media ?? 0),
        semanas_historico: Number(m.semanas ?? 0),
        // O vencido está todo dentro da primeira semana. A tela precisa
        // dizer isso, porque um saldo de semana 1 inflado por títulos
        // atrasados não é o caixa da semana que vem.
        entradas_vencidas: Number(primeiraLinha.entradas_vencidas ?? 0),
        saidas_vencidas: Number(primeiraLinha.saidas_vencidas ?? 0),
      },
      entrada,
      resultado: calcularFluxo(entrada),
    });
  } catch (e) {
    next(e);
  }
});

/**
 * Grava — ou apaga — o ajuste de uma semana.
 *
 * Tudo nulo apaga a linha em vez de gravar três nulos. Uma linha vazia
 * ocuparia espaço e, pior, faria a semana parecer "já mexida" numa
 * futura tela de histórico.
 */
equilibrioRouter.put('/fluxo/ajuste', ESCREVE, validate(ajusteSchema), async (req, res, next) => {
  try {
    const db = req.supabase as unknown as { from: (t: string) => any };
    const corpo = req.body as z.infer<typeof ajusteSchema>;

    const semAjuste =
      corpo.entradas === null && corpo.saidas === null && !corpo.observacao?.trim();

    if (semAjuste) {
      const { error } = await db
        .from('fluxo_ajustes')
        .delete()
        .eq('tenant_id', req.tenantId!)
        .eq('semana_inicio', corpo.semana_inicio);

      if (error) throw fromPostgrest(error);
      return res.status(204).end();
    }

    const { data, error } = await db
      .from('fluxo_ajustes')
      .upsert(
        {
          tenant_id: req.tenantId!,
          semana_inicio: corpo.semana_inicio,
          entradas: corpo.entradas,
          saidas: corpo.saidas,
          observacao: corpo.observacao?.trim() || null,
        },
        { onConflict: 'tenant_id,semana_inicio' },
      )
      .select('*')
      .single();

    if (error) throw fromPostgrest(error);
    res.json({ data });
  } catch (e) {
    next(e);
  }
});
