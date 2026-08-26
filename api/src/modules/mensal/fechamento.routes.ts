/**
 * O fechamento mensal, pelo cliente.
 *
 * Sete campos que os lançamentos não revelam. A tela que consome estas
 * rotas é curta de propósito: quanto mais perto de "confirmar" e mais
 * longe de "preencher", maior a chance de acontecer todo mês.
 *
 * ---------------------------------------------------------------------
 * CONFIRMAR É UM ATO SEPARADO DE SALVAR
 * ---------------------------------------------------------------------
 * `PUT` grava sem confirmar — é o rascunho, e o cliente pode voltar
 * depois. `POST /confirmar` carimba `confirmado_em`, e só então a
 * completude conta esses campos.
 *
 * A separação existe porque o valor herdado do mês anterior já está lá
 * quando a tela abre. Se salvar bastasse, o passivo de janeiro seguiria
 * valendo em dezembro sem ninguém ter olhado, e a curva mostraria uma
 * estabilidade que é só inércia de formulário. Confirmar é a pessoa
 * dizendo "eu olhei e continua valendo".
 */

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireTenant, requireRole } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { fromPostgrest, badRequest, notFound } from '../../lib/errors.js';

export const fechamentoRouter = Router();

fechamentoRouter.use(requireAuth, requireTenant);

const ESCREVE = requireRole('owner', 'admin', 'member');

/** Primeiro dia do mês, a partir de 'AAAA-MM' ou 'AAAA-MM-DD'. */
function competenciaDaQuery(v: unknown): string {
  const s = String(v ?? '');
  const m = s.match(/^(\d{4})-(\d{2})/);
  if (!m) throw badRequest('Informe a competência no formato AAAA-MM');
  return `${m[1]}-${m[2]}-01`;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const semTipos = (req: { supabase: unknown }) =>
  req.supabase as unknown as {
    from: (t: string) => any;
    rpc: (fn: string, args?: Record<string, unknown>) => any;
  };
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Abre o mês: devolve o fechamento (criando o rascunho herdado se não
 * existir), os agregados calculados e o que falta.
 *
 * Tudo numa chamada porque a tela mostra as três coisas juntas, e três
 * requisições seriam três chances de a tela renderizar pela metade.
 */
fechamentoRouter.get('/', async (req, res, next) => {
  try {
    const db = semTipos(req);
    const competencia = competenciaDaQuery(req.query.competencia);

    const { data: fechamento, error: errF } = await db.rpc('fn_abrir_fechamento', {
      p_tenant_id: req.tenantId!,
      p_competencia: competencia,
    });
    if (errF) throw fromPostgrest(errF);

    const [agregados, completude] = await Promise.all([
      db
        .from('vw_agregados_mensais')
        .select('*')
        .eq('tenant_id', req.tenantId!)
        .eq('competencia', competencia)
        .maybeSingle(),
      db.rpc('fn_completude_mensal', {
        p_tenant_id: req.tenantId!,
        p_competencia: competencia,
      }),
    ]);

    const falha = [agregados, completude].find((r) => r.error);
    if (falha?.error) throw fromPostgrest(falha.error);

    res.json({
      data: {
        competencia,
        fechamento: fechamento ?? null,
        // Nulo significa "nenhum lançamento nesta competência" — e a tela
        // precisa distinguir isso de "lançamentos zerados".
        agregados: agregados.data ?? null,
        completude: completude.data ?? null,
      },
    });
  } catch (e) {
    next(e);
  }
});

const salvarSchema = z.object({
  competencia: z.string().regex(/^\d{4}-\d{2}/, 'Use AAAA-MM'),
  passivo_curto_prazo: z.number().min(0).nullable().optional(),
  passivo_longo_prazo: z.number().min(0).nullable().optional(),
  parcela_dividas_mensal: z.number().min(0).nullable().optional(),
  custo_divida_pct_am: z.number().min(0).max(100).nullable().optional(),
  pme_dias: z.number().int().min(0).max(3650).nullable().optional(),
  uso_antecipacao_recebiveis: z
    .enum(['nunca', 'raramente', 'mensalmente', 'constantemente'])
    .nullable()
    .optional(),
  mistura_contas_pf_pj: z.enum(['nao', 'as_vezes', 'sim']).nullable().optional(),
  percentual_maior_cliente: z.number().min(0).max(100).nullable().optional(),
  observacao: z.string().max(1000).nullable().optional(),
});

/** Grava o rascunho. Não confirma. */
fechamentoRouter.put('/', ESCREVE, validate(salvarSchema), async (req, res, next) => {
  try {
    const db = semTipos(req);
    const { competencia: bruta, ...campos } = req.body as z.infer<typeof salvarSchema>;
    const competencia = competenciaDaQuery(bruta);

    await db.rpc('fn_abrir_fechamento', {
      p_tenant_id: req.tenantId!,
      p_competencia: competencia,
    });

    const { data, error } = await db
      .from('fechamentos_mensais')
      .update(campos)
      .eq('tenant_id', req.tenantId!)
      .eq('competencia', competencia)
      .select()
      .maybeSingle();

    if (error) throw fromPostgrest(error);
    if (!data) throw notFound('Fechamento não encontrado');

    res.json({ data });
  } catch (e) {
    next(e);
  }
});

const confirmarSchema = z.object({
  competencia: z.string().regex(/^\d{4}-\d{2}/, 'Use AAAA-MM'),
});

/**
 * Confirma o mês.
 *
 * Recusa se ainda faltar campo do fechamento. Deixar confirmar pela
 * metade daria ao cliente a sensação de ter terminado, e o diagnóstico
 * não sairia mesmo assim — o pior dos dois mundos, porque ele só
 * descobriria semanas depois, quando o relatório não chegasse.
 */
fechamentoRouter.post('/confirmar', ESCREVE, validate(confirmarSchema), async (req, res, next) => {
  try {
    const db = semTipos(req);
    const competencia = competenciaDaQuery(
      (req.body as z.infer<typeof confirmarSchema>).competencia,
    );

    const { data: linha, error: errL } = await db
      .from('fechamentos_mensais')
      .select('*')
      .eq('tenant_id', req.tenantId!)
      .eq('competencia', competencia)
      .maybeSingle();
    if (errL) throw fromPostgrest(errL);
    if (!linha) throw notFound('Fechamento não encontrado');

    const obrigatorios: [string, unknown, string][] = [
      ['passivo_curto_prazo', linha.passivo_curto_prazo, 'o passivo de curto prazo'],
      ['passivo_longo_prazo', linha.passivo_longo_prazo, 'o passivo de longo prazo'],
      ['parcela_dividas_mensal', linha.parcela_dividas_mensal, 'a parcela mensal de dívidas'],
      [
        'uso_antecipacao_recebiveis',
        linha.uso_antecipacao_recebiveis,
        'a pergunta sobre antecipação de recebíveis',
      ],
      [
        'mistura_contas_pf_pj',
        linha.mistura_contas_pf_pj,
        'a pergunta sobre separação entre conta pessoal e da empresa',
      ],
    ];

    const faltando = obrigatorios.filter(([, v]) => v === null || v === undefined);
    if (faltando.length) {
      throw badRequest(
        `Antes de confirmar, preencha ${faltando.map(([, , rotulo]) => rotulo).join(', ')}.`,
      );
    }

    const { data, error } = await db
      .from('fechamentos_mensais')
      .update({
        confirmado_em: new Date().toISOString(),
        confirmado_por: req.user!.id,
      })
      .eq('tenant_id', req.tenantId!)
      .eq('competencia', competencia)
      .select()
      .maybeSingle();

    if (error) throw fromPostgrest(error);

    const { data: completude } = await db.rpc('fn_completude_mensal', {
      p_tenant_id: req.tenantId!,
      p_competencia: competencia,
    });

    res.json({ data: { fechamento: data, completude: completude ?? null } });
  } catch (e) {
    next(e);
  }
});

/**
 * A curva do score e a série mensal.
 *
 * Duas leituras que a tela mostra lado a lado: a evolução (de onde saiu,
 * onde está) e a situação mês a mês (o que fechou, o que ficou pendente).
 */
fechamentoRouter.get('/evolucao', async (req, res, next) => {
  try {
    const db = semTipos(req);

    const [curva, meses] = await Promise.all([
      db
        .from('vw_evolucao_score')
        .select('*')
        .eq('tenant_id', req.tenantId!)
        .eq('tipo', 'financeiro')
        .order('em'),
      db
        .from('diagnosticos_mensais')
        .select('competencia, status, score_total, nivel, completude, cobrado_em')
        .eq('tenant_id', req.tenantId!)
        .order('competencia', { ascending: false })
        .limit(12),
    ]);

    const falha = [curva, meses].find((r) => r.error);
    if (falha?.error) throw fromPostgrest(falha.error);

    res.json({ data: { curva: curva.data ?? [], meses: meses.data ?? [] } });
  } catch (e) {
    next(e);
  }
});
