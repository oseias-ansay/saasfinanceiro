/**
 * Gera `manual.ts` a partir de `manual.md`.
 *
 *     npm run manual
 *
 * Segue a convenção dos outros scripts daqui: `.mjs`, rodado depois do
 * `tsc`, importando do `dist`.
 *
 * =====================================================================
 * POR QUE EMBUTIR, E NÃO LER O ARQUIVO EM TEMPO DE EXECUÇÃO
 * =====================================================================
 * O estágio de runtime do Dockerfile copia APENAS o `dist`:
 *
 *     COPY --from=build /app/dist ./dist
 *
 * Um `.md` dentro de `src` não é compilado pelo tsc e não chega ao
 * container. Ler o arquivo em execução exigiria mexer no Dockerfile, e o
 * modo de falha seria o pior possível: a API subindo e quebrando no boot
 * por causa de um arquivo de texto ausente.
 *
 * =====================================================================
 * O `.md` CONTINUA SENDO A FONTE
 * =====================================================================
 * É o que se edita, e é dele que sai também o PDF entregue ao cliente. O
 * `.ts` é derivado — e `manual.test.ts` falha se os dois divergirem,
 * porque editar o markdown e esquecer de rodar isto deixaria o chat
 * ensinando uma versão e o cliente lendo outra.
 *
 * A limpeza vem de `manual.preparar.ts`, compartilhada com o teste: duas
 * cópias dela fariam o teste comparar coisas diferentes e passar sempre.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { prepararManual } from '../dist/modules/assistente/manual.preparar.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const PASTA = join(AQUI, '..', 'src', 'modules', 'assistente');

const corpo = prepararManual(readFileSync(join(PASTA, 'manual.md'), 'utf8'));

const saida = `/**
 * O manual das ferramentas, como o assistente o conhece.
 *
 * ARQUIVO GERADO — não edite à mão.
 * Edite \`manual.md\` e rode \`npm run manual\`.
 *
 * =====================================================================
 * ESTE BLOCO É CONSTANTE, E É O QUE FAZ O CACHE VALER
 * =====================================================================
 * Nenhum dado de empresa entra aqui. É o que permite o prefixo do prompt
 * — ferramentas, instrução e manual — ser IDÊNTICO para todos os
 * clientes e compartilhar uma única entrada de cache.
 *
 * Se alguém montar este texto por empresa, o cache deixa de acertar e o
 * custo sobe sem nenhum sintoma visível. Há teste varrendo o conteúdo
 * atrás de marca de interpolação, pelo mesmo motivo que existe o teste
 * do catálogo de ferramentas.
 */

export const MANUAL_FERRAMENTAS = \`${corpo}\`;

/** Tamanho, para quem for mexer no prompt saber o que custa. */
export const MANUAL_CARACTERES = MANUAL_FERRAMENTAS.length;
`;

writeFileSync(join(PASTA, 'manual.ts'), saida, 'utf8');

console.log(
  `manual.ts gerado · ${corpo.length} caracteres · ~${Math.round(corpo.length / 3.6)} tokens`,
);
