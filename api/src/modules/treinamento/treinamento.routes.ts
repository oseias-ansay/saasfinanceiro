/**
 * O treinamento por HTTP.
 *
 * =====================================================================
 * ATIVIDADE DE FERRAMENTA NÃO É FORMULÁRIO
 * =====================================================================
 * A Missão 3 pede "cadastre seu carro-chefe com o custo real". A
 * tentação é montar esse formulário dentro da aula. Seria duplicar a
 * tela de Margem de Contribuição e criar duas fontes para o mesmo dado —
 * o erro que esta plataforma passou a semana consertando.
 *
 * Então atividade de `tipo = 'ferramenta'` não coleta nada: ela LEVA
 * para a ferramenta e se marca sozinha quando o dado existe. O aluno
 * cadastra o produto no lugar onde produtos moram, e o visto aparece.
 *
 * É também o que dá sentido ao curso como onboarding: ao terminar o
 * módulo 3, a ferramenta está preenchida porque ele a usou — não porque
 * copiamos o dado de um formulário para outro.
 *
 * As demais atividades — número, texto, múltipla, checklist — guardam a
 * resposta em `curso_respostas`, que é onde elas pertencem.
 */

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireTenant, requireRole } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { fromPostgrest, notFound } from '../../lib/errors.js';

export const treinamentoRouter = Router();
treinamentoRouter.use(requireAuth, requireTenant);

const ESCREVE = requireRole('owner', 'admin', 'member');

/* eslint-disable @typescript-eslint/no-explicit-any */

/* ==================================================================== */
/* Verificação das atividades de ferramenta                              */
/* ==================================================================== */

/**
 * Onde cada destino guarda o dado, e quanto basta para a atividade
 * contar como cumprida.
 *
 * `diagnostico` fica de fora: o diagnóstico mensal tem regra própria de
 * período, e inventar uma contagem aqui produziria visto verde para quem
 * respondeu no ano passado. Ele é marcado à mão, como checklist.
 */
const ONDE: Record<string, { tabela: string; filtro?: Record<string, unknown> }> = {
  categorias: { tabela: 'categories', filtro: { is_active: true } },
  lancamentos: { tabela: 'transactions' },
  produtos: { tabela: 'mix_produtos', filtro: { is_active: true } },
  prazos: { tabela: 'mix_custos_fixos' },
};

async function contar(
  supabase: any,
  tenant: string,
  destino: string,
): Promise<number | null> {
  const onde = ONDE[destino];
  if (!onde) return null;

  let q = supabase.from(onde.tabela).select('id', { count: 'exact', head: true }).eq('tenant_id', tenant);
  for (const [k, v] of Object.entries(onde.filtro ?? {})) q = q.eq(k, v);

  const { count, error } = await q;
  // Falha de contagem devolve nulo — "não sei" — e a tela mostra a
  // atividade como pendente sem afirmar que está incompleta. Marcar
  // como não cumprida por causa de um erro de leitura seria mentir.
  return error ? null : (count ?? 0);
}

/* ==================================================================== */
/* A tela inteira                                                        */
/* ==================================================================== */

treinamentoRouter.get('/', async (req, res, next) => {
  try {
    const tenant = req.tenantId!;

    const [modulos, aulas, atividades, progresso, respostas] = await Promise.all([
      req.supabase.from('curso_modulos').select('*').eq('is_active', true).order('ordem'),
      req.supabase.from('curso_aulas').select('*').eq('is_active', true).order('ordem'),
      req.supabase.from('curso_atividades').select('*').eq('is_active', true).order('ordem'),
      req.supabase.from('curso_progresso').select('*').eq('tenant_id', tenant),
      req.supabase.from('curso_respostas').select('*').eq('tenant_id', tenant),
    ]);

    for (const r of [modulos, aulas, atividades, progresso, respostas]) {
      if (r.error) throw fromPostgrest(r.error);
    }

    const listaAulas: any[] = (aulas.data ?? []) as any[];
    const listaAtiv: any[] = (atividades.data ?? []) as any[];
    const feitas = new Map((progresso.data as any[] ?? []).map((p) => [p.aula_id, p]));
    const respondidas = new Map((respostas.data as any[] ?? []).map((r) => [r.atividade_id, r]));

    // Conta uma vez por destino, não uma por atividade: quatro missões
    // pedem `lancamentos`, e contar quatro vezes a mesma tabela seria
    // desperdício visível no tempo de carregamento.
    const destinos = [...new Set(listaAtiv.filter((a) => a.destino).map((a) => a.destino))];
    const contagens = Object.fromEntries(
      await Promise.all(
        destinos.map(async (d) => [d, await contar(req.supabase, tenant, d as string)]),
      ),
    ) as Record<string, number | null>;

    const montarAtividade = (a: any) => {
      const r = respondidas.get(a.id);
      const minimo = Number(a.config?.minimo ?? 1);
      const contagem = a.destino ? contagens[a.destino] : undefined;

      return {
        ...a,
        resposta: r?.resposta ?? null,
        respondida_em: r?.updated_at ?? null,
        // Para ferramenta: o dado existe? Para o resto: respondeu?
        cumprida:
          a.tipo === 'ferramenta'
            ? contagem === null || contagem === undefined
              ? false
              : contagem >= minimo
            : r !== undefined,
        contagem: contagem ?? null,
        minimo,
      };
    };

    const dados = (modulos.data as any[] ?? []).map((m) => {
      const suasAulas = listaAulas
        .filter((a) => a.modulo_id === m.id)
        .map((a) => {
          const p = feitas.get(a.id);
          return {
            ...a,
            // Aula sem vídeo é aula que você ainda não gravou. A tela
            // mostra como "em produção" em vez de abrir um player vazio.
            disponivel: !!a.youtube_id,
            concluida: p?.concluida ?? false,
            segundos: p?.segundos ?? 0,
            atividades: listaAtiv.filter((x) => x.aula_id === a.id).map(montarAtividade),
          };
        });

      const missao = listaAtiv.filter((x) => x.modulo_id === m.id).map(montarAtividade);
      const comVideo = suasAulas.filter((a) => a.disponivel).length;
      const concluidas = suasAulas.filter((a) => a.concluida).length;

      return {
        ...m,
        aulas: suasAulas,
        missao,
        total_aulas: suasAulas.length,
        aulas_disponiveis: comVideo,
        aulas_concluidas: concluidas,
        // Percentual sobre o que EXISTE, não sobre o catálogo: enquanto
        // você grava, o aluno que assistiu tudo que há vê 100%, e não
        // 30% com a sensação de estar atrasado.
        percentual: comVideo ? Math.round((concluidas / comVideo) * 100) : 0,
        missao_cumprida: missao.length > 0 && missao.every((x: any) => x.cumprida),
      };
    });

    res.json({
      curso: 'financas-mpe',
      modulos: dados,
      // O rodapé da tela: quanto do curso existe e quanto foi feito.
      resumo: {
        aulas: dados.reduce((s, m) => s + m.total_aulas, 0),
        disponiveis: dados.reduce((s, m) => s + m.aulas_disponiveis, 0),
        concluidas: dados.reduce((s, m) => s + m.aulas_concluidas, 0),
        missoes_cumpridas: dados.filter((m) => m.missao_cumprida).length,
      },
    });
  } catch (e) {
    next(e);
  }
});

/* ==================================================================== */
/* Progresso                                                             */
/* ==================================================================== */

const progressoSchema = z.object({
  segundos: z.coerce.number().int().min(0).optional(),
  concluida: z.boolean().optional(),
});

treinamentoRouter.post(
  '/aulas/:id/progresso',
  ESCREVE,
  validate(progressoSchema),
  async (req, res, next) => {
    try {
      const corpo = req.body as z.infer<typeof progressoSchema>;

      const { data, error } = await req.supabase
        .from('curso_progresso')
        .upsert(
          {
            tenant_id: req.tenantId!,
            aula_id: req.params.id!,
            ...corpo,
            ...(corpo.concluida ? { concluida_em: new Date().toISOString() } : {}),
            atualizado_em: new Date().toISOString(),
          } as never,
          { onConflict: 'tenant_id,aula_id,user_id' },
        )
        .select('*')
        .single();

      if (error) throw fromPostgrest(error);
      res.json({ data });
    } catch (e) {
      next(e);
    }
  },
);

/* ==================================================================== */
/* Respostas                                                             */
/* ==================================================================== */

treinamentoRouter.post(
  '/atividades/:id',
  ESCREVE,
  validate(z.object({ resposta: z.unknown() })),
  async (req, res, next) => {
    try {
      const { data, error } = await req.supabase
        .from('curso_respostas')
        .upsert(
          {
            tenant_id: req.tenantId!,
            atividade_id: req.params.id!,
            resposta: (req.body as any).resposta,
            updated_at: new Date().toISOString(),
          } as never,
          { onConflict: 'tenant_id,atividade_id,user_id' },
        )
        .select('*')
        .single();

      if (error) throw fromPostgrest(error);
      res.json({ data });
    } catch (e) {
      next(e);
    }
  },
);

/* ==================================================================== */
/* Cadastro das aulas — staff                                            */
/* ==================================================================== */

/**
 * Onde você põe o vídeo quando ele fica pronto.
 *
 * Aceita a URL inteira e guarda só o ID: colar o endereço da barra do
 * navegador é o gesto natural, e exigir que alguém extraia onze
 * caracteres do meio dele é criar trabalho para produzir erro.
 */
const ID_YOUTUBE = /(?:v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{6,20})/;

treinamentoRouter.patch(
  '/aulas/:id',
  requireRole('owner', 'admin'),
  validate(
    z.object({
      youtube: z.string().trim().max(200).nullish(),
      titulo: z.string().trim().min(2).max(200).optional(),
      descricao: z.string().trim().max(2000).nullish(),
      duracao_min: z.coerce.number().int().min(1).max(600).optional(),
    }),
  ),
  async (req, res, next) => {
    try {
      const corpo = req.body as { youtube?: string | null; [k: string]: unknown };
      const { youtube, ...resto } = corpo;

      const patch: Record<string, unknown> = { ...resto };

      if (youtube !== undefined) {
        patch.youtube_id = youtube
          ? (ID_YOUTUBE.exec(youtube)?.[1] ?? youtube.trim())
          : null;
      }

      const { data, error } = await req.supabase
        .from('curso_aulas')
        .update(patch as never)
        .eq('id', req.params.id!)
        .select('*')
        .maybeSingle();

      if (error) throw fromPostgrest(error);
      if (!data) return next(notFound('Aula não encontrada'));
      res.json({ data });
    } catch (e) {
      next(e);
    }
  },
);
