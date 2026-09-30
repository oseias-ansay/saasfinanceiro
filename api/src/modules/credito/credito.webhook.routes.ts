/**
 * O caminho de volta do n8n.
 *
 * Depois de criar a pasta e subir o arquivo no Google Drive, o fluxo
 * avisa aqui o que aconteceu. Sem este retorno, `drive_file_id` ficaria
 * nulo para sempre e a fila de pendentes cresceria com itens que já
 * estão lá — o pior tipo de alarme, o que mente.
 *
 * Roda com o segredo compartilhado, não com sessão de usuário: quem
 * chama é máquina.
 */

import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middlewares/validate.js';
import { requireWebhookSecret } from '../webhooks/secret.js';
import { fromPostgrest } from '../../lib/errors.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { logger } from '../../lib/logger.js';

/** Ver a nota sobre `database.types.ts` em credito.routes.ts. */
type Tabela = { from: (t: string) => any };
const admin = (): Tabela => supabaseAdmin as unknown as Tabela;

export const creditoWebhookRouter = Router();
creditoWebhookRouter.use(requireWebhookSecret);

const retornoSchema = z.object({
  documento_id: z.string().uuid(),
  /** Nulo quando o fluxo falhou; aí `erro` explica. */
  drive_file_id: z.string().trim().max(200).nullish(),
  /** A pasta da empresa, devolvida na primeira sincronização. */
  drive_folder_id: z.string().trim().max(200).nullish(),
  drive_folder_url: z.string().trim().max(500).nullish(),
  erro: z.string().trim().max(500).nullish(),
});

creditoWebhookRouter.post('/', validate(retornoSchema), async (req, res, next) => {
  try {
    const c = req.body as z.infer<typeof retornoSchema>;

    const { data: doc, error: e1 } = await admin()
      .from('credito_documentos')
      .select('id, tenant_id, sync_tentativas')
      .eq('id', c.documento_id)
      .maybeSingle();

    if (e1) throw fromPostgrest(e1);
    if (!doc) {
      // Não é erro do chamador: o documento pode ter sido removido pelo
      // cliente enquanto o fluxo rodava. Responder 404 faria o n8n
      // reprocessar para sempre algo que não existe mais.
      logger.info({ id: c.documento_id }, 'Retorno do Drive para documento já removido');
      return res.json({ ignorado: true });
    }

    if (c.drive_file_id) {
      const { error } = await admin()
        .from('credito_documentos')
        .update({
          drive_file_id: c.drive_file_id,
          sincronizado_em: new Date().toISOString(),
          sync_erro: null,
        } as never)
        .eq('id', c.documento_id);
      if (error) throw fromPostgrest(error);
    } else {
      const { error } = await admin()
        .from('credito_documentos')
        .update({
          sync_tentativas: Number((doc as any).sync_tentativas ?? 0) + 1,
          sync_erro: c.erro ?? 'Falha sem detalhe informada pelo fluxo',
        } as never)
        .eq('id', c.documento_id);
      if (error) throw fromPostgrest(error);
    }

    // A pasta chega uma vez só, na primeira sincronização da empresa.
    if (c.drive_folder_id) {
      await admin()
        .from('credito_dossies')
        .update({
          drive_folder_id: c.drive_folder_id,
          drive_folder_url: c.drive_folder_url ?? null,
        } as never)
        .eq('tenant_id', (doc as any).tenant_id);
    }

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/**
 * A fila do que não chegou ao Drive.
 *
 * O n8n consulta, reprocessa e devolve pelo POST acima. Fica aqui, e não
 * num relógio interno da API, porque quem sabe falar com o Google é o
 * fluxo — a API só sabe quais arquivos estão pendentes.
 *
 * Devolve cada item no MESMO formato do aviso em tempo real, com URL
 * assinada e tudo. Sem isso o fluxo precisaria de dois caminhos —
 * um para o documento que acabou de chegar e outro para o que ficou
 * atrasado — e o segundo, usado raramente, seria o que apodrece.
 */
creditoWebhookRouter.get('/pendentes', async (_req, res, next) => {
  try {
    const { data, error } = await admin()
      .from('credito_documentos')
      .select('id, tenant_id, item, grupo, nome_arquivo, storage_path, sync_tentativas')
      .is('drive_file_id', null)
      // Três tentativas e para. Insistir para sempre num arquivo que o
      // Drive recusa — tipo não suportado, cota estourada — transforma a
      // fila num laço que esconde os pendentes de verdade.
      .lt('sync_tentativas', 3)
      .order('enviado_em', { ascending: true })
      // Vinte, e não cinquenta: cada um custa uma URL assinada e uma
      // consulta de empresa. A fila é drenada de novo no próximo ciclo.
      .limit(20);

    if (error) throw fromPostgrest(error);

    const itens = [];
    for (const d of ((data ?? []) as any[])) {
      const { data: url } = await supabaseAdmin.storage
        .from('credito')
        .createSignedUrl(String(d.storage_path), 3600);

      // Sem URL o item é inútil para o fluxo. Sai da lista em vez de ir
      // pela metade e voltar como falha — a falha real é do Storage, e
      // aparece no log, não na contagem de tentativas do documento.
      if (!url?.signedUrl) {
        logger.warn({ id: d.id }, 'Não consegui assinar URL de documento pendente');
        continue;
      }

      const { data: empresa } = await admin()
        .from('tenants')
        .select('name, tax_id')
        .eq('id', d.tenant_id)
        .maybeSingle();

      const { data: dossie } = await admin()
        .from('credito_dossies')
        .select('drive_folder_id')
        .eq('tenant_id', d.tenant_id)
        .maybeSingle();

      itens.push({
        documento_id: d.id,
        tenant_id: d.tenant_id,
        empresa: (empresa as any)?.name ?? 'Empresa',
        cnpj: (empresa as any)?.tax_id ?? null,
        drive_folder_id: (dossie as any)?.drive_folder_id ?? null,
        item: d.item,
        grupo: d.grupo,
        nome_arquivo: d.nome_arquivo,
        url: url.signedUrl,
        tentativas: d.sync_tentativas,
      });
    }

    res.json({ data: itens });
  } catch (e) {
    next(e);
  }
});
