/**
 * O catálogo traduzido para o formato que a API do modelo espera.
 *
 * =====================================================================
 * POR QUE É UMA CONSTANTE, E NÃO MONTADO POR EMPRESA
 * =====================================================================
 * A lista de ferramentas vai no prompt antes do bloco cacheado. Se ela
 * variasse entre empresas — escondendo uma ferramenta de quem não tem
 * certo recurso, por exemplo — o prefixo mudaria a cada conversa e o
 * cache nunca acertaria. O custo subiria cerca de dez vezes, sem nenhum
 * sintoma visível.
 *
 * Então a lista é fixa. Quem não tem dado numa área simplesmente recebe
 * "não há" quando a ferramenta roda, o que é a resposta certa de
 * qualquer forma.
 *
 * =====================================================================
 * O SCHEMA É ESCRITO À MÃO
 * =====================================================================
 * Dá para derivar JSON Schema do Zod com biblioteca. Não vale aqui: são
 * sete ferramentas com um ou nenhum parâmetro, e escrever à mão deixa a
 * DESCRIÇÃO de cada campo sob controle — e é a descrição que o modelo lê
 * para decidir o que mandar.
 *
 * A validação de verdade continua sendo o Zod do catálogo, no servidor.
 * Este schema orienta o modelo; ele não protege nada.
 */

import { FERRAMENTAS, MAX_DIAS, type NomeFerramenta } from './ferramentas.js';
import type { FerramentaParaModelo } from '../../lib/claude.js';

const SEM_PARAMETRO = { type: 'object', properties: {}, required: [] };

const PARAMETROS: Record<NomeFerramenta, Record<string, unknown>> = {
  contas_a_pagar: {
    type: 'object',
    properties: {
      dias: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_DIAS,
        description: `Horizonte em dias, de 1 a ${MAX_DIAS}. Padrão 30. Para "esta semana" use 7, para "este mês" use 30.`,
      },
    },
    required: [],
  },
  contas_a_receber: {
    type: 'object',
    properties: {
      dias: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_DIAS,
        description: `Horizonte em dias, de 1 a ${MAX_DIAS}. Padrão 30.`,
      },
    },
    required: [],
  },
  resumo_de_contas: SEM_PARAMETRO,
  saldo_em_caixa: SEM_PARAMETRO,
  resultado_do_mes: {
    type: 'object',
    properties: {
      meses: {
        type: 'integer',
        minimum: 1,
        maximum: 12,
        description:
          'Quantos meses para trás, incluindo o atual. Padrão 3. Use 1 para "este mês" e 12 para comparar o ano.',
      },
    },
    required: [],
  },
  ultimo_diagnostico: SEM_PARAMETRO,
  acoes_do_plano: SEM_PARAMETRO,
};

/** A lista pronta, construída uma vez na carga do módulo. */
export const DEFINICOES: FerramentaParaModelo[] = (
  Object.keys(FERRAMENTAS) as NomeFerramenta[]
).map((nome) => ({
  name: nome,
  description: FERRAMENTAS[nome].descricao,
  input_schema: PARAMETROS[nome],
}));
