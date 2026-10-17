/**
 * Boleto que chega por e-mail.
 *
 * =====================================================================
 * QUEM CHAMA É MÁQUINA, E QUEM DECIDE A EMPRESA É O TOKEN
 * =====================================================================
 * O fluxo do n8n lê a caixa por IMAP, extrai os anexos e posta aqui com
 * o segredo compartilhado. Não há sessão de usuário — então também não
 * há RLS para servir de segunda barreira, e o `tenant_id` sai
 * exclusivamente do token no endereço de destino.
 *
 * Isso faz desta rota o lugar mais perigoso da captura de boleto. Um
 * erro aqui não dá exceção: entrega a conta a pagar de uma empresa na
 * fila de outra, com valor, fornecedor e vencimento visíveis.
 *
 * A defesa é ser conservador: token ausente, token desconhecido ou dois
 * tokens no mesmo e-mail não gravam NADA. A rota responde 200 em todos
 * esses casos, de propósito — ver a nota sobre reentrega mais abaixo.
 *
 * =====================================================================
 * POR QUE RESPONDER 200 PARA E-MAIL QUE NÃO SERVE
 * =====================================================================
 * Se a rota devolvesse erro, o n8n marcaria o e-mail como não
 * processado e tentaria de novo, para sempre, num e-mail que nunca vai
 * dar em nada — spam na caixa, token revogado, propaganda do banco.
 *
 * 200 com `gravados: 0` e o motivo faz o fluxo seguir e deixa o registro
 * no log. Erro de verdade (banco fora, modelo fora) continua sendo 5xx,
 * porque ali reentregar é exatamente o certo.
 *
 * =====================================================================
 * O QUE ESTA ROTA NÃO FAZ: CRIAR LANÇAMENTO
 * =====================================================================
 * Grava como `pendente`, origem `email`, e para. Um boleto que entra por
 * e-mail e vira conta a pagar sozinho seria um canal aberto para a
 * fraude mais comum do Brasil — boleto com dígito verificador correto,
 * valor plausível e beneficiário trocado.
 *
 * O código estar perfeito não diz nada sobre para quem o dinheiro vai.
 * Só uma pessoa olhando o fornecedor resolve isso, e é por isso que a
 * tela mostra a origem e o remetente em destaque.
 */

import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middlewares/validate.js';
import { requireWebhookSecret } from '../webhooks/secret.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { logger } from '../../lib/logger.js';
import { BoletoInvalido, lerBoleto } from './boleto.js';
import { transcreverBoleto } from './boletoVisao.js';
import {
  corpoEmailSchema,
  destinoDoEmail,
  limparRemetente,
  triarAnexos,
} from './boletoEmail.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tabela = { from: (t: string) => any };
/**
 * `supabaseAdmin` é inevitável aqui: não existe JWT de usuário num
 * webhook de máquina. O `tenant_id` gravado vem do token resolvido
 * acima, nunca do corpo da requisição — é o que substitui o RLS.
 */
const admin = (): Tabela => supabaseAdmin as unknown as Tabela;
/* eslint-enable @typescript-eslint/no-explicit-any */

export const boletoWebhookRouter = Router();
boletoWebhookRouter.use(requireWebhookSecret);

/** Resposta sem gravar nada, para o n8n não reentregar. */
function ignorado(motivo: string, detalhe?: Record<string, unknown>) {
  return { gravados: 0, ignorado: motivo, ...(detalhe ?? {}) };
}

boletoWebhookRouter.post('/', validate(corpoEmailSchema), async (req, res, next) => {
  const c = req.body as z.infer<typeof corpoEmailSchema>;

  try {
    /* ---------------------------------------------------------------- */
    /* 1. De qual empresa é                                             */
    /* ---------------------------------------------------------------- */
    const destino = destinoDoEmail(c.para, c.cc);

    if (!destino.token) {
      // Não loga o cabeçalho inteiro: num e-mail mal endereçado ele pode
      // trazer endereço de outras empresas.
      logger.info({ motivo: destino.motivo }, 'e-mail de boleto sem destino único');
      return res.json(ignorado(destino.motivo!));
    }

    const { data: entrada, error: erroEntrada } = await admin()
      .from('boleto_entrada_email')
      .select('tenant_id')
      .eq('token', destino.token)
      .eq('ativo', true)
      .maybeSingle();

    // Erro de banco é 5xx: aqui reentregar é o certo.
    if (erroEntrada) throw erroEntrada;

    if (!entrada) {
      logger.warn({}, 'e-mail de boleto com token desconhecido ou revogado');
      return res.json(ignorado('token_desconhecido'));
    }

    const tenant = entrada.tenant_id as string;

    /* ---------------------------------------------------------------- */
    /* 2. Quais anexos vale tentar                                      */
    /* ---------------------------------------------------------------- */
    const { candidatos, descartados } = triarAnexos(c.anexos);

    if (candidatos.length === 0) {
      logger.info(
        { tenant, descartados: descartados.map((d) => d.porque) },
        'e-mail de boleto sem anexo legível',
      );
      return res.json(ignorado('sem_anexo_legivel', { descartados }));
    }

    /* ---------------------------------------------------------------- */
    /* 3. Ler e gravar                                                  */
    /* ---------------------------------------------------------------- */
    const remetente = limparRemetente(c.de);
    const gravados: Array<{ id: string; valor: number | null; vencimento: string | null }> = [];
    const falhas: Array<{ nome: string; porque: string }> = [];

    for (const anexo of candidatos) {
      try {
        const digitos = await transcreverBoleto(anexo.base64, anexo.mime);

        if (!digitos) {
          falhas.push({ nome: anexo.nome, porque: 'não achei linha digitável' });
          continue;
        }

        const lido = lerBoleto(digitos);

        const { data: criado, error } = await admin()
          .from('boletos_capturados')
          .insert({
            tenant_id: tenant,
            arquivo: null,
            linha_digitavel: lido.linha,
            codigo_barras: lido.codigo_barras,
            tipo: lido.tipo,
            valor: lido.valor,
            vencimento: lido.vencimento,
            banco: lido.banco,
            avisos: lido.avisos,
            origem: 'email',
            remetente,
            assunto: c.assunto || null,
            criado_por: null,
          })
          .select('id, valor, vencimento')
          .single();

        if (error) {
          /**
           * `23505` é a trava de duplicado do SQL 62, e aqui ela é
           * esperada, não um defeito: e-mail reentregue, ou o cliente
           * encaminhando o mesmo boleto duas vezes.
           *
           * É o que torna esta rota segura de chamar de novo — o que
           * importa, porque um fluxo de IMAP relê a caixa.
           */
          if (error.code === '23505') {
            falhas.push({ nome: anexo.nome, porque: 'boleto já capturado' });
            continue;
          }
          throw error;
        }

        gravados.push(criado as { id: string; valor: number | null; vencimento: string | null });
      } catch (e) {
        // Anexo que não é boleto é o caso comum: o e-mail do banco vem
        // com contrato, informativo, aviso de privacidade. Falhar um não
        // pode derrubar os outros.
        if (e instanceof BoletoInvalido) {
          falhas.push({ nome: anexo.nome, porque: e.message });
          continue;
        }
        throw e;
      }
    }

    logger.info(
      { tenant, gravados: gravados.length, falhas: falhas.length },
      'e-mail de boleto processado',
    );

    res.json({ gravados: gravados.length, boletos: gravados, falhas, descartados });
  } catch (e) {
    next(e);
  }
});
