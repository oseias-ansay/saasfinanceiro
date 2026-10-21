/**
 * A estrutura do curso, sem o curso.
 *
 * =====================================================================
 * ESTE MÓDULO EXISTE PARA SER TESTÁVEL
 * =====================================================================
 * Ele poderia ser quatro linhas dentro da rota. Mas o que ele faz é uma
 * REGRA DE SEGURANÇA — decidir o que um não assinante pode ver —, e
 * regra de segurança dentro de uma rota é regra que ninguém testa.
 *
 * Aqui ela é uma função pura, e `estrutura.test.ts` varre a saída atrás
 * dos campos proibidos. Mesmo desenho do teste que varre o catálogo do
 * assistente procurando `tenant`: a barreira não depende de alguém
 * lembrar dela seis meses depois.
 *
 * =====================================================================
 * LISTA DE PERMITIDOS, NUNCA LISTA DE PROIBIDOS
 * =====================================================================
 * `montarAula` nomeia os campos que SAEM, em vez de apagar os que não
 * devem sair. A diferença aparece no dia em que alguém acrescentar uma
 * coluna em `curso_aulas` — um link de material, uma senha de PDF:
 *
 *   • com lista de proibidos, a coluna nova vaza por omissão
 *   • com lista de permitidos, ela simplesmente não aparece
 *
 * Vazar por omissão é o modo de falha que não tem sintoma.
 *
 * — criado em 21/10/2026
 */

/** O que a tela de oferta precisa saber de uma aula. */
export interface AulaDaEstrutura {
  id: string;
  ordem: number;
  titulo: string;
  duracao_min: number | null;
  /**
   * Já foi gravada? Vem de `youtube_id` existir — mas o ID NÃO sai.
   *
   * Importa para a tela ser honesta: as aulas estão em produção, e
   * mostrar um índice completo sem dizer o que ainda não existe seria
   * vender o que não está pronto.
   */
  gravada: boolean;
}

export interface ModuloDaEstrutura {
  id: string;
  ordem: number;
  titulo: string;
  descricao: string | null;
  aulas: AulaDaEstrutura[];
  total_aulas: number;
  aulas_gravadas: number;
}

export interface Estrutura {
  curso: string;
  modulos: ModuloDaEstrutura[];
  resumo: { modulos: number; aulas: number; gravadas: number };
}

/* eslint-disable @typescript-eslint/no-explicit-any */

function montarAula(a: any): AulaDaEstrutura {
  return {
    id: String(a.id),
    ordem: Number(a.ordem ?? 0),
    titulo: String(a.titulo ?? ''),
    duracao_min: a.duracao_min == null ? null : Number(a.duracao_min),
    gravada: !!a.youtube_id,
  };
}

export function soAEstrutura(modulos: any[], aulas: any[]): Estrutura {
  const lista: ModuloDaEstrutura[] = modulos.map((m) => {
    const suas = aulas
      .filter((a) => a.modulo_id === m.id)
      .sort((x, y) => Number(x.ordem ?? 0) - Number(y.ordem ?? 0))
      .map(montarAula);

    return {
      id: String(m.id),
      ordem: Number(m.ordem ?? 0),
      titulo: String(m.titulo ?? ''),
      descricao: m.descricao == null ? null : String(m.descricao),
      aulas: suas,
      total_aulas: suas.length,
      aulas_gravadas: suas.filter((a) => a.gravada).length,
    };
  });

  return {
    curso: 'financas-mpe',
    modulos: lista,
    resumo: {
      modulos: lista.length,
      aulas: lista.reduce((s, m) => s + m.total_aulas, 0),
      gravadas: lista.reduce((s, m) => s + m.aulas_gravadas, 0),
    },
  };
}
