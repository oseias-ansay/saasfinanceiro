// Painel de staff da Business Triage.
//
// Escopo deliberado: administra EMPRESAS e USUÁRIOS, não dados financeiros.
// Para ver o financeiro de um cliente, o staff precisa ser adicionado como
// membro (viewer) daquela empresa — o que fica registrado em `memberships`
// e é auditável pelo próprio cliente.

import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { NextFunction, Request, Response } from 'express';
import { requireAuth } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { badRequest, conflict, forbidden, fromPostgrest, notFound } from '../../lib/errors.js';

export const adminRouter = Router();

/**
 * Confirma que o usuário é staff.
 *
 * A leitura usa o client do próprio usuário: a policy de `profiles` permite
 * ler o próprio registro, e `is_staff` só é gravável via SQL/service_role.
 * Assim ninguém se promove pela aplicação.
 */
async function requireStaff(req: Request, _res: Response, next: NextFunction) {
  try {
    const { data, error } = await req.supabase
      .from('profiles')
      .select('is_staff')
      .eq('id', req.user!.id)
      .maybeSingle();

    if (error) throw fromPostgrest(error);
    if (!data?.is_staff) throw forbidden('Área restrita à equipe Business Triage');
    next();
  } catch (e) {
    next(e);
  }
}

adminRouter.use(requireAuth, requireStaff);

/**
 * Atalho para as relações que ainda não estão no `database.types.ts` gerado:
 * `diagnosticos`, `marcos_zero` e `vw_evolucao_score`.
 *
 * Mesmo recurso já usado no módulo de webhooks. Não é preguiça — é escolha
 * de onde gastar: regerar os tipos exige credencial de banco na máquina de
 * quem publica, e o ganho de inferência não paga esse acoplamento agora.
 * Quando os tipos forem regerados, troque `dbSemTipos` por `supabaseAdmin`
 * e o compilador aponta o que estiver errado.
 */
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
const dbSemTipos = supabaseAdmin as unknown as {
  from: (t: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};

function senhaTemporaria(): string {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digitos = '23456789';
  const b = randomBytes(12);
  const letras = Array.from({ length: 4 }, (_, i) => alfabeto[b[i]! % alfabeto.length]).join('');
  const nums = Array.from({ length: 4 }, (_, i) => digitos[b[i + 4]! % digitos.length]).join('');
  return `BT-${letras}-${nums}`;
}

/** Carteira de clientes. Sem valores financeiros — só uso e cadastro. */
adminRouter.get('/tenants', async (req, res, next) => {
  try {
    const { data, error } = await req.supabase
      .from('vw_staff_tenants')
      .select('*')
      .order('name');
    if (error) throw fromPostgrest(error);
    res.json({ data: data ?? [] });
  } catch (e) {
    next(e);
  }
});

const novaEmpresaSchema = z.object({
  name: z.string().trim().min(2).max(120),
  tax_id: z
    .string()
    .transform((v) => v.replace(/\D/g, ''))
    .refine((v) => v === '' || /^[0-9]{11,14}$/.test(v), 'CNPJ/CPF inválido')
    .optional(),
  /** E-mail do responsável, que vira 'owner' da empresa. */
  owner_email: z.string().email().transform((v) => v.trim().toLowerCase()),
  seed_categories: z.boolean().default(true),
});

/**
 * Cria empresa + usuário responsável + plano de contas, numa operação só.
 *
 * Usa service_role porque envolve criar conta no GoTrue e semear dados numa
 * empresa da qual o staff ainda não é membro. É a operação de onboarding do
 * cliente — o momento em que a consultoria fecha contrato.
 */
adminRouter.post('/tenants', validate(novaEmpresaSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof novaEmpresaSchema>;

    // 1. Usuário responsável
    const { data: perfil } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('email', body.owner_email)
      .maybeSingle();

    let ownerId: string | undefined = perfil?.id;
    let senha: string | undefined;

    if (!ownerId) {
      senha = senhaTemporaria();
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email: body.owner_email,
        password: senha,
        email_confirm: true,
        // Marca a senha como provisória. O front barra a navegação enquanto
        // ela existir e leva o usuário para criar a própria — a senha gerada
        // aqui circula por e-mail ou WhatsApp e não deve sobreviver ao
        // primeiro acesso.
        user_metadata: { senha_provisoria: true },
      });
      if (error) throw badRequest(`Não foi possível criar o acesso: ${error.message}`);
      ownerId = data.user.id;
      await supabaseAdmin.from('profiles').upsert({ id: ownerId, email: body.owner_email });
    }

    // 2. Empresa — created_by aponta para o responsável, não para o staff.
    //    O trigger de bootstrap já cria a membership de owner a partir daí.
    const { data: tenant, error: errT } = await supabaseAdmin
      .from('tenants')
      .insert({ name: body.name, tax_id: body.tax_id || null, created_by: ownerId })
      .select()
      .single();
    if (errT) throw fromPostgrest(errT);

    // 3. Garante o vínculo (o trigger já deve ter criado; upsert é rede de segurança)
    await supabaseAdmin
      .from('memberships')
      .upsert(
        { tenant_id: tenant.id, user_id: ownerId, role: 'owner', is_active: true },
        { onConflict: 'tenant_id,user_id' },
      );

    // 4. Conta padrão e plano de contas
    await supabaseAdmin
      .from('bank_accounts')
      .insert({ tenant_id: tenant.id, name: 'Caixa', opening_balance: 0, is_default: true });

    let categorias = 0;
    if (body.seed_categories) {
      const { data: n } = await supabaseAdmin.rpc('fn_seed_default_categories', {
        p_tenant_id: tenant.id,
      });
      categorias = n ?? 0;
    }

    res.status(201).json({
      data: {
        tenant,
        owner_email: body.owner_email,
        categorias_criadas: categorias,
        senha_temporaria: senha ?? null,
        usuario_ja_existia: !senha,
      },
    });
  } catch (e) {
    next(e);
  }
});

const acessoSchema = z.object({
  tenant_id: z.string().uuid(),
  /** 'viewer' é o padrão: acompanhar sem poder alterar nada do cliente. */
  role: z.enum(['viewer', 'admin']).default('viewer'),
});

/**
 * Concede a si mesmo acesso a uma empresa cliente.
 *
 * Não é um atalho: é o registro explícito de que alguém da consultoria passou
 * a ver os dados daquele cliente. Fica em `memberships`, visível para o
 * próprio cliente na tela de Usuários dele.
 */
adminRouter.post('/acesso', validate(acessoSchema), async (req, res, next) => {
  try {
    const { tenant_id, role } = req.body as z.infer<typeof acessoSchema>;

    // Se já existe vínculo, NÃO mexe nele.
    //
    // A versão anterior fazia upsert e sobrescrevia o papel: um staff que já
    // fosse 'owner' da empresa era rebaixado a 'viewer' ao clicar em "Acessar",
    // perdendo o direito de gravar. Conceder acesso jamais pode reduzir acesso.
    const { data: existente, error: errBusca } = await req.supabase
      .from('memberships')
      .select('role, is_active')
      .eq('tenant_id', tenant_id)
      .eq('user_id', req.user!.id)
      .maybeSingle();

    if (errBusca) throw fromPostgrest(errBusca);

    if (existente) {
      // Só reativa se estiver desativado; o papel permanece o que era.
      if (!existente.is_active) {
        const { error } = await req.supabase
          .from('memberships')
          .update({ is_active: true })
          .eq('tenant_id', tenant_id)
          .eq('user_id', req.user!.id);
        if (error) throw fromPostgrest(error);
      }
      return res.json({
        data: { tenant_id, role: existente.role, ja_tinha_acesso: true },
      });
    }

    const { error } = await req.supabase.from('memberships').insert({
      tenant_id,
      user_id: req.user!.id,
      role,
      is_active: true,
      invited_by: req.user!.id,
    });
    if (error) throw fromPostgrest(error);

    res.status(201).json({ data: { tenant_id, role, ja_tinha_acesso: false } });
  } catch (e) {
    next(e);
  }
});

// =====================================================================
// ARQUIVAR E EXCLUIR EMPRESAS
// =====================================================================
// Duas operações com pesos muito diferentes, e a interface precisa
// refletir isso. Arquivar é reversível e não pede confirmação especial.
// Excluir apaga o financeiro inteiro por cascata e exige que o operador
// digite o nome da empresa — não por burocracia, mas porque digitar o
// nome obriga a olhar QUAL empresa está selecionada, que é justamente o
// erro que a confirmação precisa impedir.

/**
 * Extrai o `:id` da rota já como string garantida.
 *
 * O `noUncheckedIndexedAccess` do tsconfig faz `req.params.id` chegar como
 * `string | undefined`, e ele tem razão: nada no tipo de Express prova que
 * a rota casada tem esse parâmetro. Uma função que valida em um lugar só
 * evita espalhar `!` — que silencia o compilador sem verificar nada.
 */
function idDaRota(req: Request): string {
  const id = req.params.id;
  if (!id) throw notFound('Empresa não encontrada');
  return id;
}

/** Inventário do que existe na empresa. Alimenta a tela de confirmação. */
adminRouter.get('/tenants/:id/inventario', async (req, res, next) => {
  try {
    const tenantId = idDaRota(req);

    const { data, error } = await supabaseAdmin.rpc('fn_inventario_empresa', {
      p_tenant_id: tenantId,
    });
    if (error) throw fromPostgrest(error);
    if (!data) throw notFound('Empresa não encontrada');

    const { data: orfaos, error: errO } = await supabaseAdmin.rpc(
      'fn_usuarios_orfaos_apos_exclusao',
      { p_tenant_id: tenantId },
    );
    if (errO) throw fromPostgrest(errO);

    // O front não precisa da lista de caminhos do Storage — é detalhe de
    // implementação da exclusão, e mandar centenas de strings à toa só
    // engorda a resposta.
    const { caminhos_anexos: _ignorado, ...resumo } = data as Record<string, unknown>;

    res.json({ data: { ...resumo, usuarios_que_perdem_acesso: orfaos ?? [] } });
  } catch (e) {
    next(e);
  }
});

const arquivarSchema = z.object({
  arquivada: z.boolean(),
});

/**
 * Arquiva ou reativa uma empresa.
 *
 * O bloqueio de verdade acontece no banco: as funções `is_tenant_member`,
 * `is_tenant_admin` e `can_write_tenant` exigem `tenants.is_active`. Ou
 * seja, arquivar não esconde a empresa da tela — impede o acesso aos
 * dados, inclusive por chamada direta à API.
 */
adminRouter.patch('/tenants/:id/arquivar', validate(arquivarSchema), async (req, res, next) => {
  try {
    const tenantId = idDaRota(req);
    const { arquivada } = req.body as z.infer<typeof arquivarSchema>;

    const { data, error } = await supabaseAdmin
      .from('tenants')
      .update({ is_active: !arquivada })
      .eq('id', tenantId)
      .select('id, name, is_active')
      .maybeSingle();

    if (error) throw fromPostgrest(error);
    if (!data) throw notFound('Empresa não encontrada');

    res.json({ data: { ...data, arquivada: !data.is_active } });
  } catch (e) {
    next(e);
  }
});

const exclusaoSchema = z.object({
  /** Precisa bater exatamente com o nome cadastrado. */
  confirmacao: z.string().trim().min(1),
  motivo: z.string().trim().max(500).optional(),
});

/**
 * Exclui a empresa em definitivo.
 *
 * A ordem das etapas não é arbitrária:
 *
 *  1. Inventário ANTES de qualquer remoção — depois do delete não há de
 *     onde tirar os números, e os caminhos do Storage se perdem.
 *  2. Registro em `exclusoes_empresas`, que vive fora do modelo
 *     multi-tenant e por isso sobrevive à cascata.
 *  3. Arquivos do Storage. Vêm antes do delete no banco porque é a etapa
 *     que pode falhar por rede: falhando aqui, nada foi apagado ainda e
 *     dá para tentar de novo. Se fosse depois, uma falha deixaria os
 *     arquivos órfãos sem nenhum registro apontando para eles.
 *  4. O delete da empresa, que leva tudo por cascata.
 *  5. As contas do GoTrue que ficaram sem nenhuma empresa.
 */
adminRouter.delete('/tenants/:id', validate(exclusaoSchema), async (req, res, next) => {
  try {
    const { confirmacao, motivo } = req.body as z.infer<typeof exclusaoSchema>;
    const tenantId = idDaRota(req);

    // 1. Inventário
    const { data: inv, error: errI } = await supabaseAdmin.rpc('fn_inventario_empresa', {
      p_tenant_id: tenantId,
    });
    if (errI) throw fromPostgrest(errI);
    if (!inv) throw notFound('Empresa não encontrada');

    const inventario = inv as {
      nome: string;
      tax_id: string | null;
      criada_em: string | null;
      qtd_lancamentos: number;
      qtd_usuarios: number;
      qtd_anexos: number;
      caminhos_anexos: string[];
    };

    if (confirmacao !== inventario.nome) {
      throw badRequest(
        'A confirmação não confere com o nome da empresa. Nada foi excluído.',
      );
    }

    const { data: orfaos } = await supabaseAdmin.rpc('fn_usuarios_orfaos_apos_exclusao', {
      p_tenant_id: tenantId,
    });

    // 2. Trilha da exclusão
    const { error: errReg } = await supabaseAdmin.from('exclusoes_empresas').insert({
      tenant_id: tenantId,
      nome: inventario.nome,
      tax_id: inventario.tax_id,
      criada_em: inventario.criada_em,
      excluida_por: req.user!.id,
      excluida_por_email: req.user!.email ?? null,
      motivo: motivo ?? null,
      qtd_lancamentos: inventario.qtd_lancamentos,
      qtd_usuarios: inventario.qtd_usuarios,
      qtd_anexos: inventario.qtd_anexos,
    });
    if (errReg) throw fromPostgrest(errReg);

    // 3. Comprovantes no Storage
    //
    // O Storage é outro sistema: o `delete` em cascata limpa as linhas de
    // `attachments`, mas os arquivos ficariam ocupando disco para sempre.
    const caminhos = Array.isArray(inventario.caminhos_anexos)
      ? inventario.caminhos_anexos
      : [];
    let arquivosRemovidos = 0;
    if (caminhos.length) {
      // Em lotes: a API do Storage tem limite por chamada, e uma empresa
      // com anos de comprovantes pode passar de mil arquivos.
      for (let i = 0; i < caminhos.length; i += 100) {
        const lote = caminhos.slice(i, i + 100);
        const { error } = await supabaseAdmin.storage.from('comprovantes').remove(lote);
        if (error) {
          throw badRequest(
            `Falha ao remover os comprovantes do armazenamento (${error.message}). ` +
              'Nenhum dado foi excluído — tente novamente.',
          );
        }
        arquivosRemovidos += lote.length;
      }
    }

    // 4. A empresa. A cascata cuida do resto.
    const { error: errDel } = await supabaseAdmin.from('tenants').delete().eq('id', tenantId);
    if (errDel) throw fromPostgrest(errDel);

    // 5. Contas que ficaram sem empresa nenhuma.
    //
    // Falha aqui não desfaz nada nem interrompe: a empresa já foi. O que
    // sobra é uma conta órfã, que atrapalha mas não quebra — e o resultado
    // volta na resposta para você saber que precisa limpar à mão.
    const removidos: string[] = [];
    const falhas: string[] = [];
    for (const u of (orfaos ?? []) as Array<{ user_id: string; email: string | null }>) {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(u.user_id);
      if (error) falhas.push(u.email ?? u.user_id);
      else removidos.push(u.email ?? u.user_id);
    }

    res.json({
      data: {
        excluida: inventario.nome,
        lancamentos_apagados: inventario.qtd_lancamentos,
        arquivos_removidos: arquivosRemovidos,
        usuarios_removidos: removidos,
        usuarios_com_falha: falhas,
      },
    });
  } catch (e) {
    next(e);
  }
});

/** Histórico das exclusões — a prova de que os dados foram apagados. */
adminRouter.get('/exclusoes', async (req, res, next) => {
  try {
    const { data, error } = await req.supabase
      .from('exclusoes_empresas')
      .select('*')
      .order('excluida_em', { ascending: false })
      .limit(200);
    if (error) throw fromPostgrest(error);
    res.json({ data: data ?? [] });
  } catch (e) {
    next(e);
  }
});

// =====================================================================
// MARCO ZERO
// =====================================================================
// O retrato da empresa no dia em que ela assinou. Existe para uma frase
// específica funcionar mais tarde: "saiu de 48 e chegou a 86".
//
// Sem isto, o 48 se perde. O diagnóstico de entrada é de quando a empresa
// ainda era prospect, e entre aquele dia e a assinatura pode ter passado
// um mês — durante o qual ela mudou. Comparar o score de hoje com o do
// prospect mede o intervalo errado.

/** Diagnósticos ainda não vinculados a empresa alguma, para escolher o marco. */
adminRouter.get('/diagnosticos/disponiveis', async (req, res, next) => {
  try {
    const email = String(req.query.email ?? '').trim().toLowerCase();
    const cnpj = String(req.query.cnpj ?? '').replace(/\D/g, '');

    let q = dbSemTipos
      .from('diagnosticos')
      .select('id, protocolo, tipo, razao_social, cnpj, email, score_total, nivel, regua_versao, created_at')
      .is('tenant_id', null)
      .not('score_total', 'is', null)
      .order('created_at', { ascending: false })
      .limit(30);

    // Filtra por e-mail ou CNPJ quando informado: a lista completa cresce
    // rápido e achar o diagnóstico certo no meio dela é onde o erro mora.
    if (email) q = q.eq('email', email);
    else if (cnpj) q = q.eq('cnpj', cnpj);

    const { data, error } = await q;
    if (error) throw fromPostgrest(error);
    res.json({ data: data ?? [] });
  } catch (e) {
    next(e);
  }
});

const marcoZeroSchema = z.object({
  /** Protocolo do diagnóstico que serve de retrato inicial. */
  protocolo: z.string().min(3).max(64),
  /** Data da assinatura.默认 hoje; aceita retroagir dentro do mês. */
  assinado_em: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  observacao: z.string().trim().max(500).optional(),
});

/**
 * Registra o marco zero a partir de um diagnóstico existente.
 *
 * Vincula o diagnóstico à empresa e copia dele os números — em vez de
 * receber score e indicadores no corpo da requisição. Se viessem de fora,
 * nada garantiria que o marco zero corresponde a algum diagnóstico real, e
 * o número que sustenta a narrativa toda passaria a ser digitável.
 */
adminRouter.post('/tenants/:id/marco-zero', validate(marcoZeroSchema), async (req, res, next) => {
  try {
    const tenantId = idDaRota(req);
    const { protocolo, assinado_em, observacao } = req.body as z.infer<typeof marcoZeroSchema>;

    const { data: existente } = await dbSemTipos
      .from('marcos_zero')
      .select('tenant_id, score_total, assinado_em')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (existente) {
      throw conflict(
        `Esta empresa já tem marco zero (score ${existente.score_total}, ` +
          `em ${existente.assinado_em}). Refazer descaracteriza a medição — ` +
          'apague o atual antes, se for mesmo o caso.',
      );
    }

    const { data: diag, error: errD } = await dbSemTipos
      .from('diagnosticos')
      .select('id, tipo, score_total, nivel, regua_versao, indicadores, alertas, tenant_id')
      .eq('protocolo', protocolo)
      .maybeSingle();

    if (errD) throw fromPostgrest(errD);
    if (!diag) throw notFound('Diagnóstico não encontrado para este protocolo');
    if (diag.score_total === null) {
      throw badRequest('Este diagnóstico não tem score calculado.');
    }
    if (diag.tenant_id && diag.tenant_id !== tenantId) {
      throw conflict('Este diagnóstico já pertence a outra empresa.');
    }

    // 1. Liga o diagnóstico à empresa — é o que faz a série existir.
    const { error: errLink } = await dbSemTipos
      .from('diagnosticos')
      .update({ tenant_id: tenantId })
      .eq('id', diag.id);
    if (errLink) throw fromPostgrest(errLink);

    // 2. Grava o retrato.
    const { data, error } = await dbSemTipos
      .from('marcos_zero')
      .insert({
        tenant_id: tenantId,
        diagnostico_id: diag.id,
        assinado_em: assinado_em ?? new Date().toISOString().slice(0, 10),
        score_total: diag.score_total,
        nivel: diag.nivel ?? 'não informado',
        tipo: diag.tipo,
        regua_versao: diag.regua_versao,
        indicadores: diag.indicadores,
        alertas: diag.alertas,
        observacao: observacao ?? null,
        registrado_por: req.user!.id,
      })
      .select()
      .single();

    if (error) throw fromPostgrest(error);
    res.status(201).json({ data });
  } catch (e) {
    next(e);
  }
});

/** A curva do score de uma empresa: marco zero e diagnósticos posteriores. */
adminRouter.get('/tenants/:id/evolucao', async (req, res, next) => {
  try {
    const tenantId = idDaRota(req);
    const { data, error } = await dbSemTipos
      .from('vw_evolucao_score')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('tipo')
      .order('em');
    if (error) throw fromPostgrest(error);
    res.json({ data: data ?? [] });
  } catch (e) {
    next(e);
  }
});

// =====================================================================
// PAINEL DE VALIDAÇÃO
// =====================================================================
// Os três indicadores dos 90 dias, num endpoint só. Uma chamada em vez de
// quatro porque a tela mostra tudo junto — e porque cada consulta separada
// seria mais uma chance de a tela renderizar com metade dos números.

adminRouter.get('/validacao', async (_req, res, next) => {
  try {
    const [resumo, funil, coortes, engajamento] = await Promise.all([
      dbSemTipos.rpc('fn_resumo_validacao'),
      dbSemTipos.from('vw_funil_diagnosticos').select('*').order('mes', { ascending: false }),
      dbSemTipos.from('vw_retencao_coortes').select('*').order('coorte', { ascending: false }),
      dbSemTipos
        .from('vw_engajamento_clientes')
        .select('*')
        .eq('is_active', true)
        // Nulos primeiro: "nunca usou" é o caso mais grave e o que some
        // com mais facilidade no fim de uma lista ordenada por número.
        .order('dias_sem_lancar', { ascending: false, nullsFirst: true }),
    ]);

    const falha = [resumo, funil, coortes, engajamento].find((r) => r.error);
    if (falha?.error) throw fromPostgrest(falha.error);

    res.json({
      data: {
        resumo: resumo.data ?? null,
        funil: funil.data ?? [],
        coortes: coortes.data ?? [],
        engajamento: engajamento.data ?? [],
      },
    });
  } catch (e) {
    next(e);
  }
});

// =====================================================================
// CONSULTORIAS (microfranquia)
// =====================================================================
// Tudo aqui é do franqueador — o `requireStaff` no topo do router já
// garante isso. Um consultor autenticado que chamar estes endereços
// recebe 403 antes de qualquer consulta ao banco.
//
// Por que existe endpoint, e não só tela lendo o Supabase direto: vincular
// um consultor pode precisar CRIAR a conta de acesso dele, e criar conta
// no GoTrue exige service_role. Essa chave não pode existir no navegador.

/** Mesma função de `idDaRota`, com a mensagem certa para este recurso. */
function consultoriaDaRota(req: Request): string {
  const id = req.params.id;
  if (!id) throw notFound('Consultoria não encontrada');
  return id;
}

/**
 * Nomes que não podem virar slug.
 *
 * O slug vira subdomínio. Um franqueado chamado "app" ou "admin" criaria
 * um endereço que disputa com a infraestrutura — e o estrago só apareceria
 * no dia em que alguém precisasse daquele host. O banco não sabe disso
 * (para ele slug é só texto no formato certo), então a regra mora aqui.
 */
const SLUGS_RESERVADOS = new Set([
  'www', 'api', 'api-financeiro', 'n8n', 'app', 'admin', 'mail',
  'painel', 'login', 'suporte', 'blog', 'teste',
]);

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use apenas letras minúsculas, números e hífen')
  .min(3)
  .max(40)
  .refine((s) => !SLUGS_RESERVADOS.has(s), 'Este endereço é reservado pela plataforma');

const telefoneSchema = z
  .string()
  .transform((v) => v.replace(/\D/g, ''))
  .refine((v) => v === '' || /^[0-9]{12,13}$/.test(v), 'Informe com DDI e DDD, ex: 5541999999999');

/**
 * A rede inteira, com carteira e situação da página.
 *
 * Três consultas em vez de uma: `vw_consultorias` traz os indicadores de
 * aderência ao método, a tabela traz os campos da página pública, e
 * `consultores` traz quem opera cada uma. Juntar no banco exigiria uma
 * view nova a cada campo que a tela passasse a mostrar.
 */
adminRouter.get('/consultorias', async (_req, res, next) => {
  try {
    const [resumo, cadastro, vinculos] = await Promise.all([
      dbSemTipos.from('vw_consultorias').select('*').order('nome'),
      dbSemTipos
        .from('consultorias')
        .select('id, slug, titulo, apresentacao, foto_url, regiao, whatsapp, linkedin, pagina_publica, observacao'),
      dbSemTipos.from('consultores').select('consultoria_id, user_id, papel, is_active'),
    ]);

    const falha = [resumo, cadastro, vinculos].find((r) => r.error);
    if (falha?.error) throw fromPostgrest(falha.error);

    // O e-mail de quem opera vem de `profiles`, porque `consultores`
    // referencia `auth.users` e o PostgREST não atravessa esse caminho.
    const ids: string[] = [
      ...new Set(
        ((vinculos.data ?? []) as { user_id: string }[]).map((v) => v.user_id),
      ),
    ];
    const { data: perfis } = ids.length
      ? await supabaseAdmin.from('profiles').select('id, email, full_name').in('id', ids)
      : { data: [] as { id: string; email: string | null; full_name: string | null }[] };

    const emailDe = new Map((perfis ?? []).map((p) => [p.id, p]));
    const porConsultoria = new Map<string, unknown[]>();
    for (const v of (vinculos.data ?? []) as {
      consultoria_id: string;
      user_id: string;
      papel: string;
      is_active: boolean;
    }[]) {
      const lista = porConsultoria.get(v.consultoria_id) ?? [];
      lista.push({
        user_id: v.user_id,
        papel: v.papel,
        is_active: v.is_active,
        email: emailDe.get(v.user_id)?.email ?? null,
        nome: emailDe.get(v.user_id)?.full_name ?? null,
      });
      porConsultoria.set(v.consultoria_id, lista);
    }

    const pagina = new Map(
      ((cadastro.data ?? []) as { id: string }[]).map((c) => [c.id, c]),
    );

    res.json({
      data: ((resumo.data ?? []) as { id: string }[]).map((k) => ({
        ...k,
        ...(pagina.get(k.id) ?? {}),
        consultores: porConsultoria.get(k.id) ?? [],
      })),
    });
  } catch (e) {
    next(e);
  }
});

const novaConsultoriaSchema = z.object({
  nome: z.string().trim().min(2).max(120),
  responsavel: z.string().trim().max(120).optional(),
  email_contato: z.string().email().transform((v) => v.trim().toLowerCase()).optional(),
  cnpj: z
    .string()
    .transform((v) => v.replace(/\D/g, ''))
    .refine((v) => v === '' || /^[0-9]{14}$/.test(v), 'CNPJ inválido')
    .optional(),
  certificada_em: z.string().date().optional(),
});

/**
 * Cadastra uma consultoria.
 *
 * Nasce sem slug e sem página. Cadastrar o franqueado e publicar a página
 * dele são momentos diferentes: entre um e outro há foto, texto de
 * apresentação e, quase sempre, a certificação no método.
 */
adminRouter.post('/consultorias', validate(novaConsultoriaSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof novaConsultoriaSchema>;

    const { data, error } = await dbSemTipos
      .from('consultorias')
      .insert({
        nome: body.nome,
        responsavel: body.responsavel || null,
        email_contato: body.email_contato || null,
        cnpj: body.cnpj || null,
        certificada_em: body.certificada_em || null,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') throw conflict('Já existe uma consultoria com este CNPJ');
      throw fromPostgrest(error);
    }

    res.status(201).json({ data });
  } catch (e) {
    next(e);
  }
});

const editarConsultoriaSchema = z.object({
  nome: z.string().trim().min(2).max(120).optional(),
  responsavel: z.string().trim().max(120).nullable().optional(),
  certificada_em: z.string().date().nullable().optional(),
  is_active: z.boolean().optional(),
  slug: slugSchema.optional(),
  titulo: z.string().trim().max(160).nullable().optional(),
  apresentacao: z.string().trim().max(1200).nullable().optional(),
  foto_url: z.string().url().nullable().optional(),
  regiao: z.string().trim().max(120).nullable().optional(),
  whatsapp: telefoneSchema.nullable().optional(),
  linkedin: z.string().url().nullable().optional(),
  pagina_publica: z.boolean().optional(),
});

/**
 * Edita a consultoria e os campos da página pública.
 *
 * Publicar sem slug é recusado aqui e não no banco: a restrição do banco
 * aceita `pagina_publica = true` com slug nulo, e a linha simplesmente não
 * apareceria na view — uma página "publicada" que não existe é pior que um
 * erro, porque ninguém vai procurar o motivo.
 */
adminRouter.patch('/consultorias/:id', validate(editarConsultoriaSchema), async (req, res, next) => {
  try {
    const id = consultoriaDaRota(req);
    const body = req.body as z.infer<typeof editarConsultoriaSchema>;

    const { data: atual, error: errA } = await dbSemTipos
      .from('consultorias')
      .select('slug, pagina_publica')
      .eq('id', id)
      .maybeSingle();
    if (errA) throw fromPostgrest(errA);
    if (!atual) throw notFound('Consultoria não encontrada');

    const slugFinal = body.slug ?? atual.slug;
    const publicando = body.pagina_publica ?? atual.pagina_publica;
    if (publicando && !slugFinal) {
      throw badRequest('Defina o endereço da página antes de publicá-la');
    }

    const { data, error } = await dbSemTipos
      .from('consultorias')
      .update(body)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') throw conflict('Este endereço já pertence a outra consultoria');
      throw fromPostgrest(error);
    }

    res.json({ data });
  } catch (e) {
    next(e);
  }
});

const vincularSchema = z.object({
  email: z.string().email().transform((v) => v.trim().toLowerCase()),
  /** 'titular' é o franqueado; 'consultor' é quem trabalha na equipe dele. */
  papel: z.enum(['titular', 'consultor']).default('consultor'),
});

/**
 * Vincula uma pessoa à consultoria, criando o acesso se ela ainda não tiver.
 *
 * O vínculo é com a CONSULTORIA, não com as empresas: por isso não se cria
 * membership nenhuma aqui. O consultor passa a enxergar a carteira porque
 * `is_consultor_de()` responde verdadeiro, e ele deixa de enxergar no dia
 * em que o vínculo for desativado — sem varrer empresa por empresa.
 */
adminRouter.post('/consultorias/:id/consultores', validate(vincularSchema), async (req, res, next) => {
  try {
    const consultoriaId = consultoriaDaRota(req);
    const { email, papel } = req.body as z.infer<typeof vincularSchema>;

    const { data: consultoria, error: errK } = await dbSemTipos
      .from('consultorias')
      .select('id, nome')
      .eq('id', consultoriaId)
      .maybeSingle();
    if (errK) throw fromPostgrest(errK);
    if (!consultoria) throw notFound('Consultoria não encontrada');

    const { data: perfil } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    let userId: string | undefined = perfil?.id;
    let senha: string | undefined;

    if (!userId) {
      senha = senhaTemporaria();
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: senha,
        email_confirm: true,
        user_metadata: { senha_provisoria: true },
      });
      if (error) throw badRequest(`Não foi possível criar o acesso: ${error.message}`);
      userId = data.user.id;
      await supabaseAdmin.from('profiles').upsert({ id: userId, email });
    }

    // Reativa em vez de duplicar: quem já foi consultor e voltou mantém o
    // mesmo registro, e o histórico de quando entrou continua legível.
    const { error } = await dbSemTipos
      .from('consultores')
      .upsert(
        { consultoria_id: consultoriaId, user_id: userId, papel, is_active: true },
        { onConflict: 'consultoria_id,user_id' },
      );
    if (error) throw fromPostgrest(error);

    res.status(201).json({
      data: {
        consultoria_id: consultoriaId,
        user_id: userId,
        email,
        papel,
        senha_temporaria: senha ?? null,
        usuario_ja_existia: !senha,
      },
    });
  } catch (e) {
    next(e);
  }
});

/**
 * Desativa o vínculo — não apaga.
 *
 * Apagar removeria a resposta para "quem atendia esta carteira em março".
 * Desativar corta o acesso na mesma hora, porque `is_consultor_de()` exige
 * `is_active`, e preserva o registro.
 */
adminRouter.delete('/consultorias/:id/consultores/:userId', async (req, res, next) => {
  try {
    const consultoriaId = consultoriaDaRota(req);
    const userId = req.params.userId;
    if (!userId) throw notFound('Vínculo não encontrado');

    const { data, error } = await dbSemTipos
      .from('consultores')
      .update({ is_active: false })
      .eq('consultoria_id', consultoriaId)
      .eq('user_id', userId)
      .select('consultoria_id, user_id, is_active')
      .maybeSingle();

    if (error) throw fromPostgrest(error);
    if (!data) throw notFound('Vínculo não encontrado');

    res.json({ data });
  } catch (e) {
    next(e);
  }
});

const carteiraSchema = z.object({
  /** Nulo devolve a empresa à carteira da própria Business Triage. */
  consultoria_id: z.string().uuid().nullable(),
});

/** Move uma empresa para a carteira de uma consultoria. */
adminRouter.patch('/tenants/:id/consultoria', validate(carteiraSchema), async (req, res, next) => {
  try {
    const tenantId = idDaRota(req);
    const { consultoria_id } = req.body as z.infer<typeof carteiraSchema>;

    const { data, error } = await dbSemTipos
      .from('tenants')
      .update({ consultoria_id })
      .eq('id', tenantId)
      .select('id, name, consultoria_id')
      .maybeSingle();

    if (error) throw fromPostgrest(error);
    if (!data) throw notFound('Empresa não encontrada');

    res.json({ data });
  } catch (e) {
    next(e);
  }
});
