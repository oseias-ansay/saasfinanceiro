/**
 * O chat sobre o plano de ação.
 *
 * =====================================================================
 * A EMPRESA VEM DO JWT. SEMPRE.
 * =====================================================================
 * `req.tenantId` é resolvido pelo `requireTenant` a partir do token e das
 * associações do usuário. O corpo da requisição não tem — e não pode
 * ganhar — campo de empresa.
 *
 * Isso não é zelo abstrato. O contexto que vai ao modelo é o plano de
 * ação de uma empresa real, com dono, prazo e número. Um `tenant_id`
 * aceito do cliente transformaria o chat na rota mais fácil de ler o
 * plano do concorrente: bastaria trocar um uuid no DevTools.
 *
 * Por cima disso, a leitura do plano usa `req.supabase` — o client com o
 * JWT do usuário — para que o RLS valha como segunda barreira. Se um dia
 * o `requireTenant` tiver um defeito, o banco ainda recusa.
 *
 * `supabaseAdmin` aparece aqui em um único lugar, e é para GRAVAR a
 * conversa: o SQL 56 não dá insert a `authenticated` de propósito, senão
 * o front poderia fabricar uma mensagem de "assistente" que voltaria
 * como contexto na pergunta seguinte.
 *
 * =====================================================================
 * SÓ LEITURA
 * =====================================================================
 * Nenhuma rota aqui escreve em `planos_acao` ou `acoes`. Marcar ação
 * concluída continua sendo na tela do plano, pelo botão da própria ação —
 * onde o cliente vê exatamente o que está marcando. Ver a nota do SQL 56.
 *
 * =====================================================================
 * DOIS TETOS, EM SÉRIE
 * =====================================================================
 * O global (`IA_LIMITE_DIARIO`), que protege a fatura contra defeito
 * nosso, e o por empresa (`PDCA_CHAT_LIMITE_24H`), que impede uma
 * conversa de comer o orçamento do dia e fazer o próximo prospect ser
 * recusado.
 *
 * A ordem importa: o teto por empresa é checado ANTES do global. Ele é
 * uma consulta local e barata, e recusar por ele não consome reserva do
 * disjuntor — que é um contador, não uma medição.
 */

import { Router, type Request } from 'express';
import { z } from 'zod';
import { requireAuth, requireTenant } from '../../middlewares/auth.js';
import { temRecurso } from '../../middlewares/recurso.js';
import { validate } from '../../middlewares/validate.js';
import { AppError, fromPostgrest } from '../../lib/errors.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../config/env.js';
import { conversar, ErroClaude } from '../../lib/claude.js';
import {
  OrcamentoEstourado,
  registrarConsumo,
  reservarChamada,
} from '../diagnosticos/orcamento.js';
import { montarContexto, type AcaoDoContexto } from './contexto.js';
import { lerRelatorio } from './relatorio.js';
import {
  corpoPerguntaSchema,
  INSTRUCAO,
  montarMensagens,
  PerguntaInvalida,
  validarPergunta,
  type CorpoPergunta,
  type MensagemGuardada,
} from './conversa.js';

export const pdcaRouter = Router();
pdcaRouter.use(requireAuth, requireTenant);

/**
 * As tabelas da conversa ainda não estão no `database.types.ts` gerado.
 * Mesmo remendo do resto do projeto, concentrado em duas funções.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
type Tabela = { from: (t: string) => any; rpc?: any };
const doUsuario = (req: { supabase: unknown }): Tabela => req.supabase as unknown as Tabela;
const comoAdmin = (): Tabela => supabaseAdmin as unknown as Tabela;
const rpcAdmin = () =>
  supabaseAdmin as unknown as { rpc: (fn: string, args: Record<string, unknown>) => Promise<any> };
/* eslint-enable @typescript-eslint/no-explicit-any */

const CAMPOS_ACAO =
  'titulo, detalhe, pilar, causa_raiz, responsavel_nome, prazo, status, concluida_em, ordem, ganho_dias';

/**
 * Qual plano o chat abre.
 *
 * Uma empresa no Intermediário tem dois planos ativos ao mesmo tempo —
 * financeiro e comercial —, e misturar os dois num contexto só produziria
 * respostas que cruzam ciclos que o consultor conduz separados, com
 * reuniões e causas-raiz próprias.
 *
 * Então: um chat por plano. Sem `tipo` na query, abre o financeiro, que é
 * o que todo assinante tem; cai no comercial quando é o único.
 */
async function acharPlano(req: Request, tipo?: string) {
  const tenant = req.tenantId!;

  const { data, error } = await doUsuario(req)
    .from('planos_acao')
    .select('id, titulo, ciclo, tipo, observacao, contexto, created_at')
    .eq('tenant_id', tenant)
    .eq('status', 'ativo');

  if (error) throw fromPostgrest(error);

  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const planos = (data ?? []) as any[];
  if (planos.length === 0) return null;

  // O portão de recurso é por plano, não pelo router inteiro: quem está
  // no Básico tem o PDCA financeiro e não deve ver o comercial, mesmo se
  // um plano comercial existir no banco por um ciclo antigo.
  const permitidos: string[] = [];
  if (await temRecurso(tenant, 'pdca_financeiro')) permitidos.push('financeiro');
  if (await temRecurso(tenant, 'pdca_comercial')) permitidos.push('comercial');

  const visiveis = planos.filter((p) => permitidos.includes(String(p.tipo ?? 'financeiro')));
  if (visiveis.length === 0) {
    throw new AppError(
      403,
      'O plano desta empresa não inclui o acompanhamento com plano de ação. ' +
        'Fale com seu consultor para liberar.',
      'recurso_indisponivel',
    );
  }

  if (tipo) {
    const escolhido = visiveis.find((p) => String(p.tipo ?? 'financeiro') === tipo);
    if (!escolhido) {
      throw new AppError(404, 'Esta empresa não tem plano de ação ativo desse tipo.', 'sem_plano');
    }
    return escolhido;
  }

  return visiveis.find((p) => String(p.tipo ?? 'financeiro') === 'financeiro') ?? visiveis[0];
}

/** Quantas perguntas ainda cabem nas próximas 24 horas. */
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

/* ==================================================================== */
/* Importação do relatório                                               */
/* ==================================================================== */
//
// Duas rotas, e a separação entre elas é a regra: a PRÉVIA não grava
// nada, a IMPORTAÇÃO grava só o que o consultor devolveu depois de
// revisar. Mesmo desenho da importação de produtos por planilha.
//
// Uma rota só, que lesse e gravasse na mesma chamada, pareceria mais
// simples e seria o defeito: prazo extraído errado entraria como
// compromisso sem ninguém ter olhado. Extração propõe; pessoa decide.
//
// Quem pode é decidido pelo RLS, não aqui: a policy `acoes_insert` do
// SQL 17 exige `is_platform_staff()`, e o insert abaixo usa o client do
// usuário. Repetir a regra na API criaria dois lugares para ela divergir.

const previaSchema = z.object({
  // Limite generoso: um relatório de PDCA completo em markdown dá uns
  // 60 mil caracteres. O corte existe só para um arquivo trocado por
  // engano não virar processamento inútil.
  markdown: z.string().min(1, 'Cole o conteúdo do relatório.').max(400_000),
  // O D0 do plano, para resolver os prazos escritos como `D+15`. Vem da
  // tela, escolhido por uma pessoa — nunca do relógio do servidor, que
  // faria a mesma importação dar datas diferentes conforme a hora.
  data_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

pdcaRouter.post('/plano/previa', validate(previaSchema), async (req, res, next) => {
  try {
    const { markdown, data_inicio } = req.body as z.infer<typeof previaSchema>;
    res.json({ data: lerRelatorio(markdown, data_inicio) });
  } catch (e) {
    next(e);
  }
});

/**
 * O que o consultor confirmou na tela.
 *
 * Recebe as ações já revisadas, não o markdown: entre a prévia e aqui ele
 * corrigiu prazo, completou responsável e tirou o que não quis. Reenviar
 * o markdown e extrair de novo descartaria essas correções.
 */
const importarSchema = z.object({
  plano_id: z.string().uuid(),
  contexto: z.string().max(8000).nullish(),
  acoes: z
    .array(
      z.object({
        titulo: z.string().trim().min(3).max(200),
        detalhe: z.string().trim().max(4000).nullish(),
        pilar: z.string().trim().max(120).nullish(),
        // Obrigatórios no banco, e por isso obrigatórios aqui: a tela
        // bloqueia o salvar enquanto faltarem, e esta validação é o que
        // garante que o bloqueio não possa ser contornado.
        responsavel_nome: z.string().trim().min(2).max(160),
        prazo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Prazo em formato inválido.'),
      }),
    )
    .min(1, 'Nenhuma ação para importar.')
    .max(60),
});

pdcaRouter.post('/plano/importar', validate(importarSchema), async (req, res, next) => {
  try {
    // Sem `req.tenantId` aqui, de propósito: a empresa vem do plano, logo
    // abaixo. Ver a nota sobre o seletor do topo.
    const corpo = req.body as z.infer<typeof importarSchema>;
    const db = doUsuario(req);

    /* ----------------------------------------------------------------
     * A empresa sai do PLANO, não do seletor do topo
     * ----------------------------------------------------------------
     * A primeira versão exigia `plano.tenant_id === req.tenantId`, e isso
     * quebrou em uso: o consultor abre o editor de uma empresa da carteira
     * pela URL, enquanto o seletor do cabeçalho continua na empresa dele.
     * O plano era do Auto Posto, o tenant ativo era outro, e a rota
     * respondia "plano não encontrado" sobre um plano que estava na tela.
     *
     * Tirar o filtro NÃO afrouxa a segurança, e vale explicar por quê:
     *
     *   · a leitura usa `req.supabase`, com o JWT do usuário — o RLS de
     *     `planos_acao` só devolve plano de empresa onde ele é membro ou
     *     onde ele é staff da plataforma;
     *   · o `tenant_id` dos inserts passa a vir do PLANO, lido do banco,
     *     nunca do corpo da requisição;
     *   · o insert em `acoes` tem policy própria exigindo
     *     `is_platform_staff()`. Quem não é staff não cria ação nenhuma,
     *     em empresa nenhuma.
     *
     * Ou seja: o cliente só enxerga o plano dele, e mesmo assim não
     * consegue importar. Quem importa é o consultor, na empresa que ele
     * já tem direito de ver.
     */
    const { data: plano, error: e1 } = await db
      .from('planos_acao')
      .select('id, tenant_id')
      .eq('id', corpo.plano_id)
      .maybeSingle();

    if (e1) throw fromPostgrest(e1);
    if (!plano) {
      throw new AppError(
        404,
        'Plano não encontrado, ou você não tem acesso a esta empresa.',
        'sem_plano',
      );
    }

    const empresaDoPlano = String(plano.tenant_id);

    // A ordem segue a da tela, que segue a do relatório — os níveis da
    // Matriz GUT vêm ordenados, e perder isso embaralharia a prioridade.
    const { data: criadas, error: e2 } = await db
      .from('acoes')
      .insert(
        corpo.acoes.map((a, i) => ({
          plano_id: corpo.plano_id,
          tenant_id: empresaDoPlano,
          titulo: a.titulo,
          detalhe: a.detalhe ?? null,
          pilar: a.pilar ?? null,
          responsavel_nome: a.responsavel_nome,
          prazo: a.prazo,
          ordem: i,
        })) as never,
      )
      .select('id');

    if (e2) throw fromPostgrest(e2);

    // O contexto é opcional e vai no mesmo passo: o consultor acabou de
    // revisar o sumário na tela, e pedir um segundo salvar para ele seria
    // convidar a esquecer.
    if (corpo.contexto !== undefined) {
      const { error } = await db
        .from('planos_acao')
        .update({ contexto: corpo.contexto?.trim() || null } as never)
        .eq('id', corpo.plano_id);
      if (error) throw fromPostgrest(error);
    }

    logger.info(
      { tenant: empresaDoPlano, acoes: criadas?.length ?? 0 },
      'Plano importado do relatório',
    );
    res.json({ data: { criadas: criadas?.length ?? 0 } });
  } catch (e) {
    next(e);
  }
});

/* ==================================================================== */
/* A conversa e o histórico                                              */
/* ==================================================================== */

const tipoQuery = z.object({
  tipo: z.enum(['financeiro', 'comercial']).optional(),
});

pdcaRouter.get('/chat', async (req, res, next) => {
  try {
    const tenant = req.tenantId!;
    const q = tipoQuery.safeParse(req.query);
    const plano = await acharPlano(req, q.success ? q.data.tipo : undefined);

    // Sem plano ativo não é erro: é o estado de quem assinou e ainda não
    // teve a primeira reunião. A tela mostra a explicação, não uma falha.
    if (!plano) {
      return res.json({ data: { plano: null, mensagens: [], teto: await consultarTeto(tenant) } });
    }

    const { data: conversa, error: e1 } = await doUsuario(req)
      .from('pdca_conversas')
      .select('id')
      .eq('tenant_id', tenant)
      .eq('plano_id', plano.id)
      .maybeSingle();

    if (e1) throw fromPostgrest(e1);

    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    let mensagens: any[] = [];

    if (conversa?.id) {
      const { data, error } = await doUsuario(req)
        .from('pdca_mensagens')
        .select('id, papel, texto, em')
        .eq('conversa_id', conversa.id)
        .order('em', { ascending: true })
        // Cem mensagens é mais do que qualquer conversa real sobre um
        // plano de dez ações. O corte existe para a tela não passar a
        // carregar devagar num caso que ninguém previu.
        .limit(100);

      if (error) throw fromPostgrest(error);
      mensagens = data ?? [];
    }

    res.json({
      data: {
        plano: {
          id: plano.id,
          titulo: plano.titulo,
          ciclo: plano.ciclo,
          tipo: plano.tipo ?? 'financeiro',
        },
        mensagens,
        teto: await consultarTeto(tenant),
      },
    });
  } catch (e) {
    next(e);
  }
});

/* ==================================================================== */
/* Uma pergunta                                                          */
/* ==================================================================== */

// O schema mora em `conversa.ts`, módulo puro, para ser testável sem
// subir a aplicação. O que ele garante é uma ausência: nenhum campo de
// empresa, nenhum plano por id, nenhum texto livre que vá ao modelo.
pdcaRouter.post('/chat/mensagem', validate(corpoPerguntaSchema), async (req, res, next) => {
  const tenant = req.tenantId!;

  try {
    const corpo = req.body as CorpoPergunta;
    const pergunta = validarPergunta(corpo.pergunta);

    const plano = await acharPlano(req, corpo.tipo);
    if (!plano) {
      throw new AppError(
        409,
        'Esta empresa ainda não tem um plano de ação ativo. Fale com seu consultor.',
        'sem_plano',
      );
    }

    // Teto da empresa primeiro: é barato e recusar por ele não gasta
    // reserva do disjuntor global, que é contador e não medição.
    const teto = await consultarTeto(tenant);
    if (!teto.permitido) {
      throw new AppError(
        429,
        `Você já fez ${teto.usadas} perguntas nas últimas 24 horas, que é o limite. ` +
          'Volte mais tarde, ou leve as dúvidas para a reunião com o consultor.',
        'teto_chat',
        teto,
      );
    }

    /* ---------------------------------------------------------------- */
    /* O contexto                                                        */
    /* ---------------------------------------------------------------- */

    const [empresaResp, acoesResp, conversaResp] = await Promise.all([
      doUsuario(req).from('tenants').select('name').eq('id', tenant).maybeSingle(),
      doUsuario(req)
        .from('acoes')
        .select(CAMPOS_ACAO)
        .eq('plano_id', plano.id)
        // Redundante com o `plano_id` — o plano já é de um tenant só — e
        // mantido de propósito: se algum dia um plano for movido entre
        // empresas por engano, esta linha impede que as ações dele vazem.
        .eq('tenant_id', tenant),
      doUsuario(req)
        .from('pdca_conversas')
        .select('id')
        .eq('tenant_id', tenant)
        .eq('plano_id', plano.id)
        .maybeSingle(),
    ]);

    for (const r of [empresaResp, acoesResp, conversaResp]) {
      if (r.error) throw fromPostgrest(r.error);
    }

    const { data: movimento } = await doUsuario(req)
      .from('acao_eventos')
      .select('em')
      .eq('tenant_id', tenant)
      .order('em', { ascending: false })
      .limit(1)
      .maybeSingle();

    const contexto = montarContexto({
      empresa: String(empresaResp.data?.name ?? 'sua empresa'),
      plano: {
        titulo: String(plano.titulo),
        ciclo: plano.ciclo,
        tipo: plano.tipo ?? 'financeiro',
        observacao: plano.observacao,
        contexto: plano.contexto,
        created_at: String(plano.created_at),
      },
      acoes: (acoesResp.data ?? []) as AcaoDoContexto[],
      ultimoMovimento: movimento?.em ?? null,
      hoje: new Date(),
    });

    /* ---------------------------------------------------------------- */
    /* A conversa existente                                              */
    /* ---------------------------------------------------------------- */

    let conversaId: string | undefined = conversaResp.data?.id;

    if (!conversaId) {
      const { data, error } = await comoAdmin()
        .from('pdca_conversas')
        .insert({ tenant_id: tenant, plano_id: plano.id } as never)
        .select('id')
        .single();
      if (error) throw fromPostgrest(error);
      conversaId = String(data.id);
    }

    const { data: historico, error: e2 } = await doUsuario(req)
      .from('pdca_mensagens')
      .select('papel, texto')
      .eq('conversa_id', conversaId)
      .order('em', { ascending: true })
      .limit(60);

    if (e2) throw fromPostgrest(e2);

    /* ---------------------------------------------------------------- */
    /* A chamada                                                         */
    /* ---------------------------------------------------------------- */

    await reservarChamada();

    const { texto, consumo } = await conversar({
      instrucao: INSTRUCAO,
      contexto,
      mensagens: montarMensagens((historico ?? []) as MensagemGuardada[], pergunta),
      modelo: env.PDCA_CHAT_MODEL,
      maxTokens: env.PDCA_CHAT_MAX_TOKENS,
    });

    await registrarConsumo(consumo.entrada, consumo.saida);

    /* ---------------------------------------------------------------- */
    /* O registro                                                        */
    /* ---------------------------------------------------------------- */
    //
    // As duas mensagens são gravadas DEPOIS da resposta, no mesmo
    // insert. Gravar a pergunta antes pareceria mais natural — "registra
    // o que o cliente mandou e depois processa" —, mas deixaria uma
    // pergunta órfã no histórico sempre que o modelo falhasse. E
    // pergunta órfã é justamente o par quebrado que `janelaDeHistorico`
    // tem de sanear depois.
    //
    // O preço é perder o registro da pergunta que falhou. Aceitável: a
    // falha fica no log, com causa, que é onde ela serve.

    const { error: e3 } = await comoAdmin()
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
        },
      ] as never);

    // Falha ao gravar não derruba a resposta: o cliente já tem o que
    // pediu, e tirar isso dele por causa do nosso histórico seria a
    // troca errada. Fica no log, alto.
    if (e3) {
      logger.error({ erro: e3.message, tenant }, 'Não consegui gravar a conversa do PDCA');
    }

    res.json({
      data: {
        resposta: texto,
        teto: { usadas: teto.usadas + 1, limite: teto.limite, permitido: teto.usadas + 1 < teto.limite },
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
      // O cliente não precisa saber se foi rede, formato ou chave. A
      // causa fica no log; na tela, o que serve é saber que a culpa não é
      // da pergunta dele.
      logger.error({ etapa: e.etapa, detalhe: e.detalhe, tenant }, 'Chat do PDCA falhou');
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
