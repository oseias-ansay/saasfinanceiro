/**
 * Captura de boleto: ler, conferir, lançar.
 *
 * =====================================================================
 * SÃO DUAS ETAPAS, E A SEPARAÇÃO É DE PROPÓSITO
 * =====================================================================
 * `POST /ler` lê e guarda como `pendente`. `POST /:id/lancar` cria a
 * conta a pagar. Entre as duas há uma pessoa olhando a tela.
 *
 * Juntar as duas numa rota só economizaria um clique e transferiria para
 * o modelo de visão a decisão de quanto a empresa vai pagar. A leitura é
 * boa, não é perfeita, e o erro aqui sai em dinheiro.
 *
 * =====================================================================
 * O ARQUIVO SOBE DIRETO PARA O STORAGE, COMO NO DOSSIÊ DE CRÉDITO
 * =====================================================================
 * O navegador manda a foto para o bucket `boletos` com o RLS do próprio
 * usuário; aqui só chega o CAMINHO. A API baixa a imagem para mandar ao
 * modelo — o que é diferente de recebê-la por upload: são 2 MB de foto
 * de celular, buscados uma vez, e não um limite de corpo de requisição
 * brigando com cada envio.
 *
 * =====================================================================
 * DIGITAR A LINHA É CAMINHO DE PRIMEIRA CLASSE, NÃO SOCORRO
 * =====================================================================
 * `POST /ler` aceita `linha` em vez de `arquivo`. Boleto que chegou por
 * e-mail já vem com a linha selecionável — mandar a pessoa imprimir e
 * fotografar seria absurdo, e a leitura digitada é mais confiável que a
 * da foto, não menos.
 *
 * Os dois caminhos terminam na mesma validação. É o que garante que o
 * digitado não entre por uma porta mais frouxa.
 */

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireTenant, requireRole } from '../../middlewares/auth.js';
import { requireRecurso } from '../../middlewares/recurso.js';
import { validate } from '../../middlewares/validate.js';
import { AppError, fromPostgrest, notFound } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { BoletoInvalido, lerBoleto } from './boleto.js';
import { FotoIlegivel, transcreverBoleto } from './boletoVisao.js';
import { env } from '../../config/env.js';

export const boletoRouter = Router();
boletoRouter.use(requireAuth, requireTenant, requireRecurso('financeiro'));

const ESCREVE = requireRole('owner', 'admin', 'member');

const BUCKET = 'boletos';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Cliente = { from: (t: string) => any; storage: any };
const db = (req: { supabase: unknown }): Cliente => req.supabase as unknown as Cliente;
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * `origem`, `remetente` e `assunto` não são enfeite no select.
 *
 * A tela precisa deles para mostrar que o boleto chegou por e-mail e de
 * quem — sem isso, boleto encaminhado por um estranho fica visualmente
 * igual a um que o próprio dono fotografou. A conferência viraria um
 * clique.
 */
const CAMPOS =
  'id, arquivo, linha_digitavel, codigo_barras, tipo, valor, vencimento, ' +
  'banco, avisos, status, transaction_id, criado_em, lancado_em, ' +
  'origem, remetente, assunto';

/* ==================================================================== */
/* Listar                                                                */
/* ==================================================================== */

boletoRouter.get('/', async (req, res, next) => {
  try {
    const { data, error } = await db(req)
      .from('boletos_capturados')
      .select(CAMPOS)
      .eq('tenant_id', req.tenantId!)
      .neq('status', 'descartado')
      .order('criado_em', { ascending: false })
      .limit(100);

    if (error) throw fromPostgrest(error);
    res.json({ data: data ?? [] });
  } catch (e) {
    next(e);
  }
});

/* ==================================================================== */
/* Ler — por foto ou por linha digitada                                  */
/* ==================================================================== */

const corpoLer = z
  .object({
    /** Caminho no bucket, já enviado pelo navegador. */
    arquivo: z.string().trim().min(3).max(400).optional(),
    /** A linha digitada. Pode vir com a pontuação impressa. */
    linha: z.string().trim().min(10).max(80).optional(),
  })
  .refine((c) => Boolean(c.arquivo) !== Boolean(c.linha), {
    message: 'Mande a foto (arquivo) ou a linha digitada, não os dois.',
  });

boletoRouter.post('/ler', ESCREVE, validate(corpoLer), async (req, res, next) => {
  const tenant = req.tenantId!;
  const { arquivo, linha } = req.body as z.infer<typeof corpoLer>;

  try {
    /**
     * O caminho precisa começar com o tenant.
     *
     * O RLS do Storage já exige isso, mas a conferência aqui transforma
     * um 403 do Postgres numa mensagem que a tela sabe mostrar — e deixa
     * explícito, para quem ler o código, que o caminho vem do cliente e
     * não é confiável.
     */
    if (arquivo && !arquivo.startsWith(`${tenant}/`)) {
      throw new AppError(400, 'Caminho de arquivo fora da empresa.', 'caminho_invalido');
    }

    let digitos: string | null = linha ?? null;

    if (arquivo) {
      const { data: blob, error: erroDownload } = await db(req)
        .storage.from(BUCKET)
        .download(arquivo);

      if (erroDownload || !blob) {
        throw new AppError(
          404,
          'Não encontrei o arquivo enviado. Tente enviar de novo.',
          'arquivo_ausente',
        );
      }

      const mime = blob.type || 'image/jpeg';
      const base64 = Buffer.from(await blob.arrayBuffer()).toString('base64');

      digitos = await transcreverBoleto(base64, mime);

      /**
       * A mensagem muda conforme o tipo, porque a saída do cliente é
       * diferente. Numa foto ruim ele tira outra; num PDF tirar outra
       * foto não existe — a saída é copiar a linha do próprio arquivo,
       * que está ali em texto selecionável.
       */
      if (!digitos) {
        throw new AppError(
          422,
          mime === 'application/pdf'
            ? 'Não encontrei uma linha digitável neste PDF. ' +
                'Copie a linha de números do arquivo e use "Digitar a linha".'
            : 'Não consegui ler a linha digitável nesta foto. ' +
                'Tente uma foto mais próxima da faixa de números, ou digite a linha.',
          'leitura_falhou',
        );
      }
    }

    const lido = lerBoleto(digitos!);

    /**
     * Pagamento duplicado é o erro caro desta tela, e quem garante que
     * não acontece é o índice único do SQL 62 — não esta consulta.
     *
     * A consulta existe para a mensagem: sem ela, o cliente receberia
     * "violação de restrição única" e não saberia que já fotografou este
     * boleto ontem.
     */
    const { data: jaExiste } = await db(req)
      .from('boletos_capturados')
      .select('id, status, vencimento, valor')
      .eq('tenant_id', tenant)
      .eq('linha_digitavel', lido.linha)
      .neq('status', 'descartado')
      .maybeSingle();

    if (jaExiste) {
      throw new AppError(
        409,
        jaExiste.status === 'lancado'
          ? 'Este boleto já foi lançado em contas a pagar.'
          : 'Este boleto já foi capturado e está aguardando conferência.',
        'boleto_repetido',
        { id: jaExiste.id, status: jaExiste.status },
      );
    }

    const { data: criado, error } = await db(req)
      .from('boletos_capturados')
      .insert({
        tenant_id: tenant,
        arquivo: arquivo ?? null,
        linha_digitavel: lido.linha,
        codigo_barras: lido.codigo_barras,
        tipo: lido.tipo,
        valor: lido.valor,
        vencimento: lido.vencimento,
        banco: lido.banco,
        avisos: lido.avisos,
        origem: arquivo ? 'foto' : 'digitado',
        criado_por: req.user?.id ?? null,
      })
      .select(CAMPOS)
      .single();

    if (error) throw fromPostgrest(error);

    logger.info(
      { tenant, tipo: lido.tipo, por: arquivo ? 'foto' : 'digitado' },
      'boleto capturado',
    );

    res.status(201).json({ data: criado });
  } catch (e) {
    if (e instanceof BoletoInvalido) {
      return next(new AppError(422, e.message, 'boleto_invalido'));
    }
    if (e instanceof FotoIlegivel) {
      return next(new AppError(422, e.message, 'foto_ilegivel'));
    }
    next(e);
  }
});

/* ==================================================================== */
/* Lançar em contas a pagar                                              */
/* ==================================================================== */

const corpoLancar = z.object({
  descricao: z.string().trim().min(2).max(200),
  /** Obrigatórios só quando o código não trouxe — a rota confere. */
  valor: z.number().positive().max(99_999_999).optional(),
  vencimento: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  category_id: z.string().uuid().nullish(),
  entity_id: z.string().uuid().nullish(),
});

boletoRouter.post(
  '/:id/lancar',
  ESCREVE,
  validate(corpoLancar),
  async (req, res, next) => {
    const tenant = req.tenantId!;
    const corpo = req.body as z.infer<typeof corpoLancar>;

    try {
      const { data: boleto, error: erroBusca } = await db(req)
        .from('boletos_capturados')
        .select('id, status, valor, vencimento, linha_digitavel, banco')
        .eq('tenant_id', tenant)
        .eq('id', req.params.id)
        .maybeSingle();

      if (erroBusca) throw fromPostgrest(erroBusca);
      if (!boleto) throw notFound('Boleto não encontrado.');

      if (boleto.status === 'lancado') {
        throw new AppError(409, 'Este boleto já foi lançado.', 'ja_lancado');
      }
      if (boleto.status === 'descartado') {
        throw new AppError(409, 'Este boleto foi descartado.', 'descartado');
      }

      /**
       * O valor e a data do CÓDIGO vencem o que a tela mandou.
       *
       * O corpo da requisição só preenche o que o código não trouxe —
       * arrecadação, que não tem vencimento, e boleto em branco, que não
       * tem valor. Deixar a tela sobrescrever um valor verificado por
       * dígito abriria a porta para pagar outro número por acidente de
       * formulário.
       */
      const valor = boleto.valor ?? corpo.valor ?? null;
      const vencimento = boleto.vencimento ?? corpo.vencimento ?? null;

      if (valor === null) {
        throw new AppError(
          400,
          'Este boleto está com valor em aberto. Informe o valor a pagar.',
          'valor_necessario',
        );
      }
      if (vencimento === null) {
        throw new AppError(
          400,
          'Este boleto não traz vencimento no código. Informe a data.',
          'vencimento_necessario',
        );
      }

      const { data: tx, error: erroTx } = await db(req)
        .from('transactions')
        .insert({
          tenant_id: tenant,
          type: 'despesa',
          description: corpo.descricao,
          amount: valor,
          status: 'pendente',
          /**
           * Competência na data de vencimento, não na da captura.
           *
           * A despesa pertence ao mês em que a obrigação vence. Usar o dia
           * da foto jogaria a conta de novembro no resultado de outubro só
           * porque o cliente fotografou antes — e o DRE do mês passa a
           * depender de quando alguém pegou o celular.
           */
          competence_date: vencimento,
          due_date: vencimento,
          category_id: corpo.category_id ?? null,
          entity_id: corpo.entity_id ?? null,
          /** A linha fica no documento: é como se confere no banco. */
          document_number: boleto.linha_digitavel,
          notes: boleto.banco
            ? `Boleto capturado — banco ${boleto.banco}`
            : 'Boleto capturado',
        })
        .select('id, description, amount, due_date, status')
        .single();

      if (erroTx) throw fromPostgrest(erroTx);

      /**
       * Marcar depois de criar.
       *
       * Se esta marcação falhar, o boleto fica `pendente` com o lançamento
       * já criado — e a trava de duplicado impede recapturar, então a
       * pessoa vê o boleto na fila e descarta. Chato.
       *
       * A ordem inversa seria pior: boleto marcado como lançado sem
       * lançamento nenhum é uma conta que ninguém vai pagar, e nada na
       * tela denuncia.
       */
      const { error: erroMarca } = await db(req)
        .from('boletos_capturados')
        .update({
          status: 'lancado',
          transaction_id: tx.id,
          lancado_em: new Date().toISOString(),
        })
        .eq('tenant_id', tenant)
        .eq('id', boleto.id);

      if (erroMarca) {
        logger.error(
          {
            tenant,
            boleto: boleto.id,
            transaction: tx.id,
            erro: erroMarca.message,
          },
          'lançamento criado mas boleto não foi marcado como lançado',
        );
      }

      res.status(201).json({ data: { boleto_id: boleto.id, transaction: tx } });
    } catch (e) {
      next(e);
    }
  },
);

/* ==================================================================== */
/* Descartar                                                             */
/* ==================================================================== */

/**
 * Descartar não apaga: marca.
 *
 * O registro descartado é o que libera a linha na trava de duplicado, e
 * é também o que explica, se alguém perguntar depois, por que o boleto
 * foi fotografado e não pagou. A foto sai do bucket porque aquela não
 * serve mesmo — é lixo, e lixo de documento financeiro não fica.
 */
boletoRouter.delete('/:id', ESCREVE, async (req, res, next) => {
  const tenant = req.tenantId!;

  try {
    const { data: boleto, error } = await db(req)
      .from('boletos_capturados')
      .select('id, arquivo, status')
      .eq('tenant_id', tenant)
      .eq('id', req.params.id)
      .maybeSingle();

    if (error) throw fromPostgrest(error);
    if (!boleto) throw notFound('Boleto não encontrado.');

    if (boleto.status === 'lancado') {
      throw new AppError(
        409,
        'Este boleto já virou conta a pagar. Apague o lançamento no Controle Financeiro.',
        'ja_lancado',
      );
    }

    const { error: erroUpdate } = await db(req)
      .from('boletos_capturados')
      .update({ status: 'descartado' })
      .eq('tenant_id', tenant)
      .eq('id', boleto.id);

    if (erroUpdate) throw fromPostgrest(erroUpdate);

    if (boleto.arquivo) {
      const { error: erroArquivo } = await db(req)
        .storage.from(BUCKET)
        .remove([boleto.arquivo]);

      // Órfão no bucket é lixo invisível, não inconsistência: a tela
      // lista a tabela. Não vale derrubar o descarte por causa dele.
      if (erroArquivo) {
        logger.warn(
          { tenant, arquivo: boleto.arquivo, erro: erroArquivo.message },
          'foto do boleto descartado ficou no bucket',
        );
      }
    }

    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

/* ==================================================================== */
/* O endereço de e-mail da empresa                                       */
/* ==================================================================== */

/**
 * Devolve (criando na primeira vez) o endereço de entrada da empresa.
 *
 * O token é gerado no banco, pela `fn_boleto_entrada`. Gerar aqui seria
 * mais simples e colocaria a geração de um segredo em dois lugares — e
 * o lado da aplicação é o que alguém "simplifica" depois para um valor
 * legível.
 */
boletoRouter.get('/entrada', async (req, res, next) => {
  try {
    const { data, error } = await (req.supabase as any).rpc('fn_boleto_entrada', {
      p_tenant: req.tenantId!,
    });

    if (error) throw fromPostgrest(error);

    res.json({
      data: {
        endereco: `boletos+${data}@${env.BOLETO_EMAIL_DOMINIO}`,
      },
    });
  } catch (e) {
    next(e);
  }
});

/**
 * Troca o endereço. Para quando o atual vazou.
 *
 * Só quem escreve: trocar derruba o endereço que o cliente já deu para
 * os fornecedores dele, e boleto encaminhado para o endereço antigo
 * passa a ser descartado em silêncio.
 */
boletoRouter.post('/entrada/trocar', ESCREVE, async (req, res, next) => {
  try {
    const { data, error } = await (req.supabase as any).rpc('fn_boleto_entrada_trocar', {
      p_tenant: req.tenantId!,
    });

    if (error) throw fromPostgrest(error);

    logger.warn({ tenant: req.tenantId }, 'endereço de entrada de boleto trocado');

    res.json({
      data: { endereco: `boletos+${data}@${env.BOLETO_EMAIL_DOMINIO}` },
    });
  } catch (e) {
    next(e);
  }
});
