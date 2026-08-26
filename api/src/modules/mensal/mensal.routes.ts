/**
 * O ciclo mensal do assinante.
 *
 * Uma vez por mês o n8n chama `POST /apurar`. Para cada empresa da fila,
 * esta rotina faz três coisas na ordem certa:
 *
 *   1. pergunta ao banco se dá para confiar no mês (`fn_completude_mensal`)
 *   2. só então monta a entrada e chama a régua
 *   3. grava o score — ou grava a pendência com o que faltou
 *
 * A ordem é o desenho. Calcular primeiro e decidir depois se publica
 * parece equivalente, mas não é: alguém acabaria lendo o score do objeto
 * intermediário e usando "só para ter uma ideia". Score calculado sobre
 * dado incompleto não deve chegar a existir.
 *
 * ---------------------------------------------------------------------
 * POR QUE A API, E NÃO UMA FUNÇÃO NO BANCO
 * ---------------------------------------------------------------------
 * Porque a régua vive aqui, em TypeScript, com testes. Reimplementá-la em
 * PL/pgSQL para rodar tudo no banco criaria a segunda implementação que o
 * módulo inteiro existe para evitar.
 *
 * O banco faz o que o banco faz bem: agregar lançamentos e responder se o
 * mês está completo. A régua faz o que só ela pode fazer: transformar
 * números em pontos.
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { supabaseAdmin } from '../../lib/supabase.js';
import { fromPostgrest, badRequest } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { calcularRegua, VERSAO_REGUA, type EntradaRegua } from '../regua/regua.js';
import { requireWebhookSecret } from '../webhooks/secret.js';

export const mensalRouter = Router();

mensalRouter.use(
  rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false }),
  requireWebhookSecret,
);

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabaseAdmin as unknown as {
  from: (t: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

interface Completude {
  pontos: number;
  maximo: number;
  percentual: number;
  suficiente: boolean;
  faltas: string[];
}

/** Primeiro dia do mês anterior ao corrente, em ISO. */
function competenciaPadrao(): string {
  const hoje = new Date();
  const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 1, 1));
  return d.toISOString().slice(0, 10);
}

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** "julho de 2026" — para o e-mail, não para log. */
function mesPorExtenso(iso: string): string {
  const [ano, mes] = iso.split('-');
  return `${MESES[Number(mes) - 1]} de ${ano}`;
}

/**
 * A frase da cobrança.
 *
 * "Você não preencheu" irrita e não diz o que fazer. "Faltam as despesas
 * de julho para fechar seu diagnóstico" é acionável — a pessoa sabe o que
 * abrir e o que digitar.
 *
 * Uma falta vira frase direta; várias viram lista. Escrever "faltam: as
 * receitas do mês" para um item só soa a formulário, não a mensagem.
 */
function frasePendencia(faltas: string[], competencia: string): string {
  const mes = mesPorExtenso(competencia);
  if (faltas.length === 0) return `Faltam dados de ${mes}.`;
  if (faltas.length === 1) return `Para fechar o diagnóstico de ${mes}, faltam ${faltas[0]}.`;
  const ultima = faltas[faltas.length - 1];
  const resto = faltas.slice(0, -1).join(', ');
  return `Para fechar o diagnóstico de ${mes}, faltam ${resto} e ${ultima}.`;
}

const apurarSchema = z.object({
  /** Primeiro dia do mês. Ausente = mês anterior ao corrente. */
  competencia: z.string().date().optional(),
  /** Uma empresa só, para conferência manual. */
  tenant_id: z.string().uuid().optional(),
});

interface Resultado {
  tenant_id: string;
  nome: string;
  email: string | null;
  status: 'calculado' | 'incompleto' | 'erro';
  score_total?: number;
  nivel?: string;
  completude_pct?: number;
  faltas?: string[];
  mensagem?: string;
  ja_cobrado?: boolean;
  erro?: string;
}

/**
 * Apura a competência para todas as empresas da fila.
 *
 * Devolve a lista pronta para o n8n decidir o que enviar. A API não manda
 * e-mail: o SMTP e os modelos vivem no n8n desde o começo, e trazer isso
 * para cá duplicaria a configuração sem ganho nenhum.
 */
mensalRouter.post('/apurar', async (req, res, next) => {
  try {
    const body = apurarSchema.parse(req.body ?? {});
    const competencia = body.competencia ?? competenciaPadrao();

    if (!competencia.endsWith('-01')) {
      throw badRequest('A competência precisa ser o primeiro dia do mês (AAAA-MM-01)');
    }

    const { data: fila, error: errFila } = await db.rpc('fn_fila_apuracao', {
      p_competencia: competencia,
    });
    if (errFila) throw fromPostgrest(errFila);

    const alvos = (fila ?? []).filter(
      (t: { tenant_id: string }) => !body.tenant_id || t.tenant_id === body.tenant_id,
    );

    const resultados: Resultado[] = [];

    // Sequencial de propósito. São dezenas de empresas, não milhares, e
    // cada volta faz três consultas; em paralelo isso vira uma rajada no
    // banco para economizar segundos que ninguém está esperando.
    for (const alvo of alvos as { tenant_id: string; nome: string; email_owner: string | null }[]) {
      try {
        const { data: comp, error: errComp } = await db.rpc('fn_completude_mensal', {
          p_tenant_id: alvo.tenant_id,
          p_competencia: competencia,
        });
        if (errComp) throw fromPostgrest(errComp);

        const completude = comp as Completude;

        if (!completude?.suficiente) {
          // Se já existe uma pendência cobrada, preserva a data: reapurar
          // não pode fazer o cliente ser cobrado de novo pelo mesmo mês.
          const { data: anterior } = await db
            .from('diagnosticos_mensais')
            .select('cobrado_em')
            .eq('tenant_id', alvo.tenant_id)
            .eq('competencia', competencia)
            .maybeSingle();

          const { error } = await db.from('diagnosticos_mensais').upsert(
            {
              tenant_id: alvo.tenant_id,
              competencia,
              status: 'incompleto',
              completude,
              cobrado_em: anterior?.cobrado_em ?? null,
              calculado_em: new Date().toISOString(),
            },
            { onConflict: 'tenant_id,competencia' },
          );
          if (error) throw fromPostgrest(error);

          resultados.push({
            tenant_id: alvo.tenant_id,
            nome: alvo.nome,
            email: alvo.email_owner,
            status: 'incompleto',
            completude_pct: completude?.percentual ?? 0,
            faltas: completude?.faltas ?? [],
            mensagem: frasePendencia(completude?.faltas ?? [], competencia),
            ja_cobrado: !!anterior?.cobrado_em,
          });
          continue;
        }

        const { data: entrada, error: errEnt } = await db.rpc('fn_entrada_regua', {
          p_tenant_id: alvo.tenant_id,
          p_competencia: competencia,
        });
        if (errEnt) throw fromPostgrest(errEnt);
        if (!entrada) throw new Error('Entrada da régua veio vazia');

        const r = calcularRegua(entrada as EntradaRegua);

        const { error } = await db.from('diagnosticos_mensais').upsert(
          {
            tenant_id: alvo.tenant_id,
            competencia,
            status: 'calculado',
            score_total: r.score.scoreTotal,
            nivel: r.score.nivelSaude,
            regua_versao: VERSAO_REGUA,
            entrada,
            indicadores: r.indicadores,
            alertas: r.alertas,
            completude,
            calculado_em: new Date().toISOString(),
          },
          { onConflict: 'tenant_id,competencia' },
        );
        if (error) throw fromPostgrest(error);

        resultados.push({
          tenant_id: alvo.tenant_id,
          nome: alvo.nome,
          email: alvo.email_owner,
          status: 'calculado',
          score_total: r.score.scoreTotal,
          nivel: r.score.nivelSaude,
          completude_pct: 100,
        });
      } catch (e) {
        // Uma empresa com problema não pode derrubar a apuração das
        // outras. O erro entra no resultado para aparecer no e-mail
        // interno — silenciar aqui significaria descobrir meses depois.
        const msg = e instanceof Error ? e.message : 'Falha desconhecida';
        logger.error({ tenant_id: alvo.tenant_id, competencia, err: msg }, 'apuração mensal falhou');
        resultados.push({
          tenant_id: alvo.tenant_id,
          nome: alvo.nome,
          email: alvo.email_owner,
          status: 'erro',
          erro: msg,
        });
      }
    }

    res.json({
      data: {
        competencia,
        mes_por_extenso: mesPorExtenso(competencia),
        regua_versao: VERSAO_REGUA,
        total: resultados.length,
        calculados: resultados.filter((r) => r.status === 'calculado').length,
        incompletos: resultados.filter((r) => r.status === 'incompleto').length,
        erros: resultados.filter((r) => r.status === 'erro').length,
        // Quem cobrar: incompletos que ainda não receberam aviso deste mês.
        a_cobrar: resultados.filter((r) => r.status === 'incompleto' && !r.ja_cobrado),
        resultados,
      },
    });
  } catch (e) {
    next(e);
  }
});

const cobrarSchema = z.object({
  competencia: z.string().date(),
  tenant_ids: z.array(z.string().uuid()).min(1),
});

/**
 * Marca as pendências como cobradas.
 *
 * Chamado pelo n8n DEPOIS de o e-mail sair, nunca antes. Se a marcação
 * viesse primeiro e o envio falhasse, o cliente ficaria para sempre sem
 * ser avisado — e o sistema acharia que avisou.
 */
mensalRouter.post('/cobrado', async (req, res, next) => {
  try {
    const { competencia, tenant_ids } = cobrarSchema.parse(req.body ?? {});

    const { data, error } = await db
      .from('diagnosticos_mensais')
      .update({ cobrado_em: new Date().toISOString() })
      .eq('competencia', competencia)
      .eq('status', 'incompleto')
      .in('tenant_id', tenant_ids)
      .select('tenant_id');

    if (error) throw fromPostgrest(error);
    res.json({ data: { marcados: (data ?? []).length } });
  } catch (e) {
    next(e);
  }
});
