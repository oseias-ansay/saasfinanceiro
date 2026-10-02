/**
 * O assistente do Controle Financeiro.
 *
 * =====================================================================
 * A EMPRESA VEM DO JWT, E NÃO CHEGA AO MODELO
 * =====================================================================
 * `req.tenantId` é resolvido pelo `requireTenant`. Ele é passado ao
 * executor das ferramentas como primeiro argumento — nunca entra em
 * parâmetro de ferramenta, porque esse campo não existe no catálogo.
 *
 * Então não há como o modelo pedir dado de outra empresa: não por ele ser
 * obediente, mas por não haver onde escrever o uuid.
 *
 * =====================================================================
 * POR QUE O CONTEXTO É PEQUENO AGORA
 * =====================================================================
 * No chat do plano, o plano inteiro ia no bloco de sistema. Aqui não: o
 * contexto traz só o que é fixo e barato — nome da empresa, data de hoje,
 * e o que ela tem contratado. Todo o resto é ferramenta.
 *
 * É o que torna o assistente viável para toda a base: o prefixo cacheado
 * é quase igual entre clientes, e o que varia é consultado sob demanda.
 */

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireTenant } from '../../middlewares/auth.js';
import { requireRecurso } from '../../middlewares/recurso.js';
import { validate } from '../../middlewares/validate.js';
import { AppError, fromPostgrest } from '../../lib/errors.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../config/env.js';
import { conversarComFerramentas, ErroClaude } from '../../lib/claude.js';
import {
  OrcamentoEstourado,
  registrarConsumo,
  reservarChamada,
} from '../diagnosticos/orcamento.js';
import {
  janelaDeHistorico,
  PerguntaInvalida,
  validarPergunta,
  type MensagemGuardada,
} from '../pdca/conversa.js';
import { DEFINICOES } from './definicoes.js';
import { executar, type Db } from './executor.js';
import { existe, validarParametros } from './ferramentas.js';
import { INSTRUCAO_ASSISTENTE } from './instrucao.js';

export const assistenteRouter = Router();

// O assistente é do Controle Financeiro, então o portão é `financeiro` —
// que todo plano pago tem. Com o fim do plano gratuito, isso significa
// toda a base, inclusive no período de teste. É deliberado: ele é a porta
// de entrada do produto.
assistenteRouter.use(requireAuth, requireTenant, requireRecurso('financeiro'));

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tabela = { from: (t: string) => any };
const doUsuario = (req: { supabase: unknown }): Db => req.supabase as unknown as Db;
const comoAdmin = (): Tabela => supabaseAdmin as unknown as Tabela;
const rpcAdmin = () =>
  supabaseAdmin as unknown as { rpc: (fn: string, args: Record<string, unknown>) => Promise<any> };
/* eslint-enable @typescript-eslint/no-explicit-any */

async function consultarTeto(tenantId: string) {
  const { data, error } = await rpcAdmin().rpc('fn_pdca_cabe', {
    p_tenant_id: tenantId,
    p_limite: env.PDCA_CHAT_LIMITE_24H,
  });
  if (error) throw fromPostgrest(error);

  const r = (data ?? {}) as { usadas?: number; limite?: number; permitido?: boolean };
  return {
    usadas: r.usadas ?? 0,
    limite: r.limite ?? env.PDCA_CHAT_LIMITE_24H,
    permitido: r.permitido !== false,
  };
}

/** A conversa geral da empresa: `plano_id` nulo (ver SQL 59). */
async function acharConversa(req: Parameters<typeof doUsuario>[0], tenantId: string) {
  const { data, error } = await (req.supabase as unknown as Tabela)
    .from('pdca_conversas')
    .select('id')
    .eq('tenant_id', tenantId)
    .is('plano_id', null)
    .maybeSingle();

  if (error) throw fromPostgrest(error);
  return data?.id ? String(data.id) : null;
}

/* ==================================================================== */
/* Histórico                                                             */
/* ==================================================================== */

assistenteRouter.get('/', async (req, res, next) => {
  try {
    const tenant = req.tenantId!;
    const conversaId = await acharConversa(req, tenant);

    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    let mensagens: any[] = [];

    if (conversaId) {
      const { data, error } = await (req.supabase as unknown as Tabela)
        .from('pdca_mensagens')
        .select('id, papel, texto, em, ferramentas')
        .eq('conversa_id', conversaId)
        .order('em', { ascending: true })
        .limit(100);

      if (error) throw fromPostgrest(error);
      mensagens = data ?? [];
    }

    res.json({ data: { mensagens, teto: await consultarTeto(tenant) } });
  } catch (e) {
    next(e);
  }
});

/* ==================================================================== */
/* Uma pergunta                                                          */
/* ==================================================================== */

const perguntaSchema = z.object({ pergunta: z.string() });

assistenteRouter.post('/mensagem', validate(perguntaSchema), async (req, res, next) => {
  const tenant = req.tenantId!;

  try {
    const pergunta = validarPergunta((req.body as { pergunta: unknown }).pergunta);

    const teto = await consultarTeto(tenant);
    if (!teto.permitido) {
      throw new AppError(
        429,
        `Você já fez ${teto.usadas} perguntas nas últimas 24 horas, que é o limite por enquanto. ` +
          'Volte mais tarde.',
        'teto_chat',
        teto,
      );
    }

    const db = doUsuario(req);

    const { data: empresa } = await (req.supabase as unknown as Tabela)
      .from('tenants')
      .select('name')
      .eq('id', tenant)
      .maybeSingle();

    /* ----------------------------------------------------------------
     * O contexto fixo
     * ----------------------------------------------------------------
     * Pequeno de propósito. Tudo que varia com o tempo é ferramenta; o
     * que fica aqui é o que não muda entre perguntas, para o cache valer.
     *
     * A DATA entra, e a HORA não: hora muda a cada pergunta e invalidaria
     * o cache em toda chamada, encarecendo cerca de dez vezes sem nenhum
     * sintoma visível.
     */
    const contexto = [
      `Empresa: ${empresa?.name ?? 'esta empresa'}.`,
      `Hoje é ${new Date().toISOString().slice(0, 10).split('-').reverse().join('/')}.`,
      '',
      'Você tem ferramentas para consultar os dados reais desta empresa. Use-as',
      'sempre que a pergunta envolver qualquer número dela.',
    ].join('\n');

    let conversaId = await acharConversa(req, tenant);

    if (!conversaId) {
      const { data, error } = await comoAdmin()
        .from('pdca_conversas')
        .insert({ tenant_id: tenant, plano_id: null } as never)
        .select('id')
        .single();
      if (error) throw fromPostgrest(error);
      conversaId = String(data.id);
    }

    const { data: historico, error: e1 } = await (req.supabase as unknown as Tabela)
      .from('pdca_mensagens')
      .select('papel, texto')
      .eq('conversa_id', conversaId)
      .order('em', { ascending: true })
      .limit(60);

    if (e1) throw fromPostgrest(e1);

    await reservarChamada();

    /* ----------------------------------------------------------------
     * O laço
     * ----------------------------------------------------------------
     * O `executar` abaixo é a fronteira: ele recebe o que o modelo pediu
     * e devolve texto. Nunca lança — erro vira texto de volta, para o
     * modelo poder dizer ao cliente que o dado não veio, em vez de a
     * conversa morrer.
     *
     * O `tenant` é capturado do escopo, não do pedido. É a linha que
     * garante o isolamento, e é por isso que ela é tão curta.
     */
    const { texto, consumo, usou, rodadas } = await conversarComFerramentas({
      instrucao: INSTRUCAO_ASSISTENTE,
      contexto,
      mensagens: [
        ...janelaDeHistorico((historico ?? []) as MensagemGuardada[]),
        { role: 'user', content: pergunta },
      ],
      ferramentas: DEFINICOES,
      executar: async (p) => {
        if (!existe(p.nome)) {
          return `A ferramenta "${p.nome}" não existe. Use apenas as oferecidas.`;
        }

        const v = validarParametros(p.nome, p.parametros);
        if (!v.ok) return v.erro;

        const r = await executar(db, tenant, p.nome, v.valor);
        return r.texto;
      },
      modelo: env.PDCA_CHAT_MODEL,
      maxTokens: env.PDCA_CHAT_MAX_TOKENS,
    });

    await registrarConsumo(consumo.entrada, consumo.saida);

    // As duas mensagens gravadas depois da resposta, no mesmo insert.
    // Gravar a pergunta antes deixaria uma pergunta órfã sempre que o
    // modelo falhasse — e par quebrado é o que `janelaDeHistorico` tem de
    // sanear depois.
    const { error: e2 } = await comoAdmin()
      .from('pdca_mensagens')
      .insert([
        { conversa_id: conversaId, tenant_id: tenant, papel: 'cliente', texto: pergunta },
        {
          conversa_id: conversaId,
          tenant_id: tenant,
          papel: 'assistente',
          texto,
          tokens_entrada: consumo.entrada,
          tokens_saida: consumo.saida,
          tokens_cache: consumo.cacheLido,
          ferramentas: usou.length > 0 ? usou : null,
        },
      ] as never);

    if (e2) {
      logger.error({ erro: e2.message, tenant }, 'Não consegui gravar a conversa do assistente');
    }

    res.json({
      data: {
        resposta: texto,
        ferramentas: usou,
        rodadas,
        teto: {
          usadas: teto.usadas + 1,
          limite: teto.limite,
          permitido: teto.usadas + 1 < teto.limite,
        },
      },
    });
  } catch (e) {
    if (e instanceof PerguntaInvalida) {
      return next(new AppError(400, e.message, 'pergunta_invalida'));
    }

    if (e instanceof OrcamentoEstourado) {
      return next(
        new AppError(
          503,
          'O assistente está indisponível no momento. Tente de novo mais tarde.',
          'ia_indisponivel',
        ),
      );
    }

    if (e instanceof ErroClaude) {
      logger.error({ etapa: e.etapa, detalhe: e.detalhe, tenant }, 'Assistente falhou');
      return next(
        new AppError(
          502,
          'Não consegui responder agora. Tente de novo em alguns instantes.',
          'ia_falhou',
        ),
      );
    }

    next(e);
  }
});
