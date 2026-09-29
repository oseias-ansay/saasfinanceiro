/**
 * Dossiê de crédito — recebimento dos documentos para análise.
 *
 * =====================================================================
 * O UPLOAD NÃO PASSA POR AQUI
 * =====================================================================
 * O arquivo vai do navegador direto para o Supabase Storage, com o RLS
 * do próprio usuário. A API entra depois, para REGISTRAR o que subiu.
 *
 * Fazer o arquivo passar pela API custaria memória do container em cada
 * envio, um limite de corpo que brigaria com PDF de extrato, e um ponto
 * de falha a mais entre o cliente e o documento salvo. O Storage já sabe
 * receber arquivo grande; a API sabe decidir regra.
 *
 * O preço dessa escolha é que existe um instante entre o arquivo estar
 * no bucket e o registro existir. Se o navegador cair no meio, sobra um
 * órfão no Storage — invisível na tela, porque a tela lista a TABELA.
 * É lixo, não inconsistência, e a rota de remoção limpa os dois lados.
 *
 * =====================================================================
 * O DRIVE É AVISADO, NÃO ESPERADO
 * =====================================================================
 * Registrado o documento, a API dispara um aviso ao n8n e responde. Não
 * espera o Google. Se o n8n estiver fora, ou nem configurado, o registro
 * fica com `drive_file_id` nulo e a fila de reenvio resolve depois.
 *
 * O cliente nunca vê um erro do Google. Para ele, o envio terminou —
 * porque terminou mesmo: o documento está guardado.
 */

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireTenant, requireRole } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { fromPostgrest, notFound } from '../../lib/errors.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../config/env.js';
import { enviarTexto } from '../../lib/evolution.js';
import {
  acharDocumento,
  calcularProgresso,
  DOCUMENTOS,
  GRUPOS,
} from './catalogo.js';

export const creditoRouter = Router();
creditoRouter.use(requireAuth, requireTenant);

const ESCREVE = requireRole('owner', 'admin', 'member');

const BUCKET = 'credito';

/**
 * As tabelas do dossiê ainda não estão no `database.types.ts` gerado.
 *
 * Mesmo remendo das outras tabelas novas do projeto, isolado em duas
 * funções para não espalhar `as unknown as` pelo arquivo. Ao regerar os
 * tipos, some daqui e o resto do código não muda.
 */
type Tabela = { from: (t: string) => any };
const doUsuario = (req: { supabase: unknown }): Tabela => req.supabase as unknown as Tabela;
const comoAdmin = (): Tabela => supabaseAdmin as unknown as Tabela;

/* ==================================================================== */
/* Situação do dossiê                                                    */
/* ==================================================================== */

creditoRouter.get('/', async (req, res, next) => {
  try {
    const tenant = req.tenantId!;
    const db = doUsuario(req);

    const [dossie, docs] = await Promise.all([
      db.from('credito_dossies').select('*').eq('tenant_id', tenant).maybeSingle(),
      db
        .from('credito_documentos')
        .select('id, item, grupo, nome_arquivo, tamanho_bytes, enviado_em, drive_file_id')
        .eq('tenant_id', tenant)
        .order('enviado_em', { ascending: false }),
    ]);

    for (const r of [dossie, docs]) {
      if (r.error) throw fromPostgrest(r.error);
    }

    const arquivos = (docs.data ?? []) as any[];
    const temImovel = Boolean(dossie.data?.tem_imovel);

    const progresso = calcularProgresso(
      arquivos.map((a) => String(a.item)),
      temImovel,
    );

    res.json({
      dossie: dossie.data ?? null,
      tem_imovel: temImovel,
      grupos: GRUPOS,
      // O catálogo vai junto para a tela não ter uma segunda cópia da
      // lista. Duas listas divergem no primeiro documento novo.
      catalogo: DOCUMENTOS,
      documentos: arquivos,
      progresso,
    });
  } catch (e) {
    next(e);
  }
});

/** Liga ou desliga o grupo do imóvel. */
creditoRouter.patch(
  '/',
  ESCREVE,
  validate(
    z.object({
      tem_imovel: z.boolean().optional(),
      observacao: z.string().trim().max(1000).nullish(),
    }),
  ),
  async (req, res, next) => {
    try {
      const { data, error } = await doUsuario(req)
        .from('credito_dossies')
        .upsert(
          { ...(req.body as object), tenant_id: req.tenantId! } as never,
          { onConflict: 'tenant_id' },
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
/* Registro do documento, depois do upload                               */
/* ==================================================================== */

const registroSchema = z.object({
  item: z.string().regex(/^[a-z0-9_]+$/),
  nome_arquivo: z.string().trim().min(1).max(300),
  storage_path: z.string().trim().min(3).max(500),
  tamanho_bytes: z.coerce.number().int().min(0).optional(),
  content_type: z.string().trim().max(150).optional(),
});

creditoRouter.post('/documentos', ESCREVE, validate(registroSchema), async (req, res, next) => {
  try {
    const tenant = req.tenantId!;
    const corpo = req.body as z.infer<typeof registroSchema>;

    const doc = acharDocumento(corpo.item);
    if (!doc) return next(notFound('Documento não existe no catálogo'));

    // O caminho TEM de começar pelo tenant de quem está chamando.
    //
    // O RLS do Storage já barra a escrita fora da própria pasta, mas sem
    // esta linha alguém poderia registrar na sua tabela um caminho
    // apontando para o dossiê de outra empresa — e a tela, que confia na
    // tabela, geraria URL assinada para um arquivo alheio.
    if (!corpo.storage_path.startsWith(`${tenant}/`)) {
      return next(notFound('Caminho do arquivo fora da pasta desta empresa'));
    }

    // Garante o dossiê antes do documento: é ele que carrega o
    // `tem_imovel` e a pasta do Drive.
    const { error: eDossie } = await doUsuario(req)
      .from('credito_dossies')
      .upsert({ tenant_id: tenant } as never, { onConflict: 'tenant_id', ignoreDuplicates: true });
    if (eDossie) throw fromPostgrest(eDossie);

    const { data, error } = await doUsuario(req)
      .from('credito_documentos')
      .insert({
        tenant_id: tenant,
        item: doc.chave,
        grupo: doc.grupo,
        nome_arquivo: corpo.nome_arquivo,
        storage_path: corpo.storage_path,
        tamanho_bytes: corpo.tamanho_bytes ?? null,
        content_type: corpo.content_type ?? null,
        enviado_por: req.user?.id ?? null,
      } as never)
      .select('*')
      .single();

    if (error) throw fromPostgrest(error);

    // Daqui para baixo nada pode derrubar a resposta: o documento já
    // está recebido, e é isso que o cliente precisa saber.
    void avisarN8n(tenant, data as any).catch((e) =>
      logger.warn({ err: e, tenant }, 'Falha ao avisar o n8n sobre documento de crédito'),
    );
    void avisarConsultor(tenant, doc.titulo).catch((e) =>
      logger.warn({ err: e, tenant }, 'Falha ao avisar o consultor'),
    );

    res.status(201).json({ data });
  } catch (e) {
    next(e);
  }
});

creditoRouter.delete('/documentos/:id', ESCREVE, async (req, res, next) => {
  try {
    const tenant = req.tenantId!;

    const { data: doc, error: e1 } = await doUsuario(req)
      .from('credito_documentos')
      .select('id, storage_path')
      .eq('tenant_id', tenant)
      .eq('id', req.params.id!)
      .maybeSingle();

    if (e1) throw fromPostgrest(e1);
    if (!doc) return next(notFound('Documento não encontrado'));

    // O arquivo sai primeiro. Na ordem inversa, uma falha ao apagar o
    // registro deixaria o cliente vendo um item que não existe mais —
    // pior que um órfão invisível no bucket.
    const { error: e2 } = await req.supabase.storage
      .from(BUCKET)
      .remove([(doc as any).storage_path]);
    if (e2) logger.warn({ err: e2, tenant }, 'Arquivo de crédito não removido do Storage');

    const { error: e3 } = await doUsuario(req)
      .from('credito_documentos')
      .delete()
      .eq('tenant_id', tenant)
      .eq('id', req.params.id!);
    if (e3) throw fromPostgrest(e3);

    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

/** Link temporário para abrir o que já foi enviado. */
creditoRouter.get('/documentos/:id/link', async (req, res, next) => {
  try {
    const { data: doc, error } = await doUsuario(req)
      .from('credito_documentos')
      .select('storage_path, nome_arquivo')
      .eq('tenant_id', req.tenantId!)
      .eq('id', req.params.id!)
      .maybeSingle();

    if (error) throw fromPostgrest(error);
    if (!doc) return next(notFound('Documento não encontrado'));

    const { data, error: e2 } = await req.supabase.storage
      .from(BUCKET)
      .createSignedUrl((doc as any).storage_path, 300);

    if (e2) throw fromPostgrest(e2 as never);
    res.json({ url: data?.signedUrl ?? null, nome: (doc as any).nome_arquivo });
  } catch (e) {
    next(e);
  }
});

/* ==================================================================== */
/* Aviso ao n8n                                                          */
/* ==================================================================== */

/**
 * Manda ao n8n o que ele precisa para pôr o arquivo no Drive.
 *
 * A URL assinada dura uma hora — tempo de sobra para o fluxo rodar, e
 * curto o bastante para não virar link permanente de um extrato bancário
 * circulando em histórico de execução.
 *
 * Usa `supabaseAdmin` porque roda fora do ciclo da requisição: o token
 * do usuário pode expirar antes do n8n baixar.
 */
async function avisarN8n(tenant: string, doc: Record<string, unknown>): Promise<void> {
  if (!env.N8N_CREDITO_URL) return;

  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(String(doc.storage_path), 3600);

  if (error || !data?.signedUrl) {
    logger.warn({ tenant, error }, 'Não consegui assinar a URL do documento de crédito');
    return;
  }

  const { data: empresa } = await supabaseAdmin
    .from('tenants')
    .select('name, tax_id')
    .eq('id', tenant)
    .maybeSingle();

  const { data: dossie } = await comoAdmin()
    .from('credito_dossies')
    .select('drive_folder_id')
    .eq('tenant_id', tenant)
    .maybeSingle();

  const resp = await fetch(env.N8N_CREDITO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-n8n-secret': env.N8N_WEBHOOK_SECRET },
    body: JSON.stringify({
      documento_id: doc.id,
      tenant_id: tenant,
      empresa: (empresa as any)?.name ?? 'Empresa',
      cnpj: (empresa as any)?.tax_id ?? null,
      // Nulo na primeira vez: é o sinal para o n8n criar a pasta e
      // devolver o id pelo callback.
      drive_folder_id: (dossie as any)?.drive_folder_id ?? null,
      item: doc.item,
      grupo: doc.grupo,
      nome_arquivo: doc.nome_arquivo,
      url: data.signedUrl,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!resp.ok) {
    await comoAdmin()
      .from('credito_documentos')
      .update({
        sync_tentativas: Number(doc.sync_tentativas ?? 0) + 1,
        sync_erro: `n8n respondeu ${resp.status}`,
      } as never)
      .eq('id', String(doc.id));
  }
}

/** Aviso ao consultor, represado para não virar enxurrada. */
async function avisarConsultor(tenant: string, tituloDoc: string): Promise<void> {
  const destino = env.CREDITO_WHATSAPP || env.MONITOR_WHATSAPP;

  const { data: dossie } = await comoAdmin()
    .from('credito_dossies')
    .select('avisado_em')
    .eq('tenant_id', tenant)
    .maybeSingle();

  const ultimo = (dossie as any)?.avisado_em
    ? new Date((dossie as any).avisado_em).getTime()
    : 0;
  const minutos = (Date.now() - ultimo) / 60_000;
  if (minutos < env.CREDITO_AVISO_INTERVALO_MIN) return;

  const { data: empresa } = await supabaseAdmin
    .from('tenants')
    .select('name')
    .eq('id', tenant)
    .maybeSingle();

  const nome = (empresa as any)?.name ?? 'Uma empresa';
  const texto =
    `📄 *Documentos para análise de crédito*\n${nome} enviou documentos — ` +
    `o mais recente: ${tituloDoc}.\n\nVeja o que já chegou e o que falta no painel.`;

  if (!destino || !env.MONITOR_INSTANCIA) {
    logger.info({ tenant, texto }, 'Aviso de crédito sem destino configurado');
  } else {
    await enviarTexto(env.MONITOR_INSTANCIA, destino, texto);
  }

  await comoAdmin()
    .from('credito_dossies')
    .update({ avisado_em: new Date().toISOString() } as never)
    .eq('tenant_id', tenant);
}
