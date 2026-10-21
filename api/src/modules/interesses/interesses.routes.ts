/**
 * Pedido de contato sobre algo que a empresa ainda não contratou.
 *
 * =====================================================================
 * GRAVA PRIMEIRO, AVISA DEPOIS — E A ORDEM É A FUNCIONALIDADE
 * =====================================================================
 * O aviso vai por WhatsApp, pela Evolution. Ela cai: instância fora,
 * número trocado, container reiniciando. Aviso que não chega não deixa
 * rastro nenhum.
 *
 * E o que se perde aqui é um cliente PEDINDO para contratar — a coisa
 * mais cara que esta plataforma pode deixar cair. Mesma razão pela qual
 * o `MOTOR_PUBLICO` é `codigo` no formulário público: quem está do outro
 * lado não volta para tentar de novo.
 *
 * Então: a resposta 201 significa "está gravado", nunca "o consultor foi
 * avisado". O aviso é disparado sem `await` e as falhas dele viram log,
 * não erro de rota. Falhar o pedido porque o WhatsApp caiu seria
 * transformar um problema nosso em obstáculo do cliente.
 *
 * `select ... where avisado_em is null` lista o que caiu no vão. É a
 * consulta que a conferência do SQL 67 manda rodar.
 *
 * =====================================================================
 * O CORPO NÃO TEM CAMPO DE EMPRESA
 * =====================================================================
 * `tenant_id` vem do JWT, pelo `requireTenant`. Mesma regra das
 * ferramentas do assistente e do webhook de boleto: cliente não diz de
 * qual empresa ele é. Há teste varrendo o schema.
 *
 * E não pede nome nem e-mail: quem está aqui está logado, e pedir de
 * novo o que o sistema já sabe faz a plataforma parecer desatenta no
 * exato momento em que ela está pedindo confiança.
 *
 * — criado em 21/10/2026
 */

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireTenant, requireRole } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { fromPostgrest } from '../../lib/errors.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../config/env.js';
import { enviarTexto } from '../../lib/evolution.js';
import { corpoInteresseSchema, textoDoAviso } from './interesse.js';

export const interessesRouter = Router();
interessesRouter.use(requireAuth, requireTenant);

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tabela = { from: (t: string) => any };
const doUsuario = (req: { supabase: unknown }): Tabela => req.supabase as unknown as Tabela;
const comoAdmin = (): Tabela => supabaseAdmin as unknown as Tabela;

/**
 * Registra o pedido.
 *
 * `member` também pode: quem usa a ferramenta no dia a dia é quem sente
 * a falta do que não foi contratado, e exigir o dono para pedir uma
 * conversa mataria o pedido no nascedouro. Quem decide a compra continua
 * sendo o dono — isso é combinado fora daqui.
 */
interessesRouter.post(
  '/',
  requireRole('owner', 'admin', 'member'),
  validate(corpoInteresseSchema),
  async (req, res, next) => {
    try {
      const tenant = req.tenantId!;
      const { assunto, mensagem, telefone } = req.body as z.infer<typeof corpoInteresseSchema>;

      const { data, error } = await doUsuario(req)
        .from('interesses')
        .insert({
          tenant_id: tenant,
          assunto,
          mensagem: mensagem?.trim() || null,
          telefone: telefone?.trim() || null,
        })
        .select('id, created_at')
        .single();

      if (error) throw fromPostgrest(error);

      // Sem `await`: o pedido já está salvo, e o cliente não deve esperar
      // o WhatsApp para ver a confirmação na tela.
      void avisarConsultor(tenant, (data as any).id, assunto, mensagem).catch((e) =>
        logger.warn({ err: e, tenant, assunto }, 'Falha ao avisar o consultor sobre interesse'),
      );

      res.status(201).json({ data });
    } catch (e) {
      next(e);
    }
  },
);

/** O que esta empresa já pediu. A tela usa para não repetir o convite. */
interessesRouter.get('/', async (req, res, next) => {
  try {
    const { data, error } = await doUsuario(req)
      .from('interesses')
      .select('id, assunto, mensagem, created_at, atendido_em')
      .eq('tenant_id', req.tenantId!)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw fromPostgrest(error);
    res.json({ data: data ?? [] });
  } catch (e) {
    next(e);
  }
});

/**
 * Avisa quem atende, e marca que avisou.
 *
 * Mesmo desenho do `avisarConsultor` do dossiê de crédito — inclusive o
 * caso de não haver destino configurado, que vira log em vez de erro.
 * Em ambiente sem Evolution o pedido continua sendo gravado, e é isso
 * que importa.
 *
 * `avisado_em` é escrito com a chave de serviço de propósito: a policy
 * de update exige staff ou consultor, e quem está fazendo o pedido é o
 * cliente. Deixar o cliente marcar o próprio aviso seria abrir a coluna
 * para quem não deveria escrevê-la.
 */
async function avisarConsultor(
  tenant: string,
  interesseId: string,
  assunto: string,
  mensagem?: string,
): Promise<void> {
  const destino = env.MONITOR_WHATSAPP;

  const { data: empresa } = await supabaseAdmin
    .from('tenants')
    .select('name')
    .eq('id', tenant)
    .maybeSingle();

  const texto = textoDoAviso((empresa as any)?.name ?? null, assunto, mensagem);

  if (!destino || !env.MONITOR_INSTANCIA) {
    logger.info({ tenant, assunto, texto }, 'Interesse sem destino de WhatsApp configurado');
    return;
  }

  await enviarTexto(env.MONITOR_INSTANCIA, destino, texto);

  await comoAdmin()
    .from('interesses')
    .update({ avisado_em: new Date().toISOString() })
    .eq('id', interesseId);
}
