/**
 * Cria o plano de ação automático depois da apuração mensal.
 *
 * =====================================================================
 * A FONTE É O REDATOR, NÃO A IA
 * =====================================================================
 * `redigirFinanceiro` produz gargalos e plano de ação a partir dos
 * alertas da régua, no mesmo formato da análise, em milissegundos e de
 * graça. Para uma rotina que roda todo mês para toda a base, essa é a
 * diferença entre viável e caro — e o conteúdo é o mesmo, porque a régua
 * (que é código puro, com testes) é quem decide os alertas de qualquer
 * jeito. O modelo só redigia o texto.
 *
 * Como efeito colateral, o plano automático não consome o teto diário de
 * IA e não pode ser recusado por ele. Uma coisa a menos para quebrar às
 * 8h da manhã.
 *
 * =====================================================================
 * NUNCA TOCA EM PLANO DE CONSULTOR
 * =====================================================================
 * A regra mais importante deste arquivo. A empresa que subiu para o
 * Intermediário tem um plano prescrito em reunião, com compromissos
 * acordados — e uma rotina mensal que o encerrasse para pôr outro no
 * lugar apagaria exatamente o que foi vendido.
 *
 * Então: se existe plano ativo com `origem = 'consultor'`, esta rotina
 * não faz nada e registra o motivo. É também o que faz o upgrade
 * funcionar sem migração: basta o consultor criar o plano dele.
 *
 * =====================================================================
 * UM PLANO POR COMPETÊNCIA, SUBSTITUINDO O ANTERIOR
 * =====================================================================
 * O ciclo PDCA é mensal aqui. O plano do mês passado é encerrado — não
 * apagado — e o novo entra. O histórico preserva a comparação entre o
 * que foi prescrito e o que foi feito, que é a única forma de o cliente
 * ver que o acompanhamento serve para alguma coisa.
 *
 * Reapurar a mesma competência não cria plano duplicado: a checagem é
 * por `diagnostico_mensal_id`.
 */

import { supabaseAdmin } from '../../lib/supabase.js';
import { logger } from '../../lib/logger.js';
import { temRecurso } from '../../middlewares/recurso.js';
import { redigirFinanceiro } from '../diagnosticos/redator.js';
import type { ResultadoRegua } from '../regua/regua.js';
import { gerarAcoes, gerarContexto, tituloDoPlano } from './automatico.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tabela = { from: (t: string) => any };
const db = (): Tabela => supabaseAdmin as unknown as Tabela;
/* eslint-enable @typescript-eslint/no-explicit-any */

export type ResultadoGeracao =
  | { criado: true; plano_id: string; acoes: number }
  | { criado: false; motivo: string };

/**
 * Gera o plano do mês para uma empresa.
 *
 * Nunca lança: é chamada de dentro da apuração mensal, e derrubar o
 * fechamento de toda a base porque um plano não pôde ser criado seria a
 * troca errada. Falha vira log e `{ criado: false }`.
 */
export async function gerarPlanoAutomatico(entrada: {
  tenantId: string;
  competencia: string;
  /** A competência do diagnóstico que originou o plano, em `aaaa-mm-01`. */
  competenciaDiagnostico: string;
  regua: ResultadoRegua;
  hoje?: Date;
}): Promise<ResultadoGeracao> {
  const { tenantId, competencia, competenciaDiagnostico, regua } = entrada;

  try {
    // O recurso é a chave comercial: quem não tem PDCA no plano não
    // recebe plano automático. O Básico tem; o Gratuito, não.
    if (!(await temRecurso(tenantId, 'pdca_financeiro'))) {
      return { criado: false, motivo: 'empresa sem o recurso de plano de ação' };
    }

    const { data: ativo, error: e1 } = await db()
      .from('planos_acao')
      .select('id, origem, diagnostico_competencia')
      .eq('tenant_id', tenantId)
      .eq('status', 'ativo')
      .maybeSingle();

    if (e1) throw new Error(e1.message);

    // A regra que protege o upgrade.
    if (ativo && ativo.origem === 'consultor') {
      return { criado: false, motivo: 'empresa tem plano conduzido por consultor' };
    }

    // Reapuração do mesmo mês não gera plano de novo. Sem isto, cada
    // reprocessamento criaria um plano e descartaria o anterior — levando
    // junto as ações que o cliente já tinha marcado.
    if (ativo && ativo.diagnostico_competencia === competenciaDiagnostico) {
      return { criado: false, motivo: 'plano desta competência já existe' };
    }

    const analise = redigirFinanceiro(regua);
    const hoje = entrada.hoje ?? new Date();
    const acoes = gerarAcoes(
      {
        resumoExecutivo: analise.resumoExecutivo,
        planoDeAcao: analise.planoDeAcao,
        gargalos: analise.gargalosIdentificados,
      },
      hoje,
    );

    // Régua sem alerta nenhum é empresa saudável no mês. Criar um plano
    // vazio só para existir encheria o painel de um card que não pede
    // nada — e ensinaria a ignorá-lo.
    if (acoes.length === 0) {
      return { criado: false, motivo: 'nenhum alerta na competência' };
    }

    // O anterior sai antes do novo entrar: existe índice único de um
    // plano ativo por empresa e tipo.
    if (ativo) {
      const { error } = await db()
        .from('planos_acao')
        .update({ status: 'encerrado' } as never)
        .eq('id', ativo.id);
      if (error) throw new Error(error.message);
    }

    const { data: plano, error: e2 } = await db()
      .from('planos_acao')
      .insert({
        tenant_id: tenantId,
        titulo: tituloDoPlano(competencia),
        ciclo: competencia,
        tipo: 'financeiro',
        origem: 'automatico',
        status: 'ativo',
        diagnostico_competencia: competenciaDiagnostico,
        contexto: gerarContexto(
          {
            resumoExecutivo: analise.resumoExecutivo,
            planoDeAcao: analise.planoDeAcao,
            gargalos: analise.gargalosIdentificados,
          },
          competencia,
        ),
      } as never)
      .select('id')
      .single();

    if (e2) throw new Error(e2.message);

    const { error: e3 } = await db()
      .from('acoes')
      .insert(
        acoes.map((a) => ({ ...a, plano_id: plano.id, tenant_id: tenantId })) as never,
      );

    if (e3) {
      // Plano sem ação é pior que plano nenhum: o card aparece e não
      // pede nada. Desfaz, e o mês que vem tenta de novo.
      await db().from('planos_acao').delete().eq('id', plano.id);
      throw new Error(e3.message);
    }

    logger.info(
      { tenant: tenantId, competencia, acoes: acoes.length },
      'Plano de ação automático criado',
    );

    return { criado: true, plano_id: String(plano.id), acoes: acoes.length };
  } catch (e) {
    logger.error(
      { tenant: tenantId, competencia, erro: e instanceof Error ? e.message : String(e) },
      'Falha ao gerar plano automático',
    );
    return { criado: false, motivo: 'erro ao gerar — ver log' };
  }
}
