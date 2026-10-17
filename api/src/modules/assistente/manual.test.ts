/**
 * Testes do manual embutido no prompt.
 *
 * Dois tipos de garantia aqui, e os dois existem por motivos de dinheiro
 * e de confiança:
 *
 * 1. **Sincronia** — o `.md` é a fonte e também vira o PDF do cliente.
 *    Editar o markdown e esquecer de rodar o gerador deixaria o chat
 *    ensinando uma versão e o cliente lendo outra, sem nenhum sintoma.
 *
 * 2. **Constância** — nada de empresa pode entrar neste texto. É o que
 *    permite o prefixo do prompt ser idêntico para todos os clientes e
 *    compartilhar uma única entrada de cache. Mesmo espírito do teste
 *    que varre o catálogo de ferramentas.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MANUAL_FERRAMENTAS, MANUAL_CARACTERES } from './manual.js';
import { prepararManual } from './manual.preparar.js';

/**
 * O teste roda sobre o `dist`, então a raiz do projeto fica quatro
 * níveis acima — não três. Errar isso daria "arquivo não encontrado" e
 * a tentação seria desligar o teste.
 */
const AQUI = dirname(fileURLToPath(import.meta.url));
const MD = join(AQUI, '..', '..', '..', 'src', 'modules', 'assistente', 'manual.md');

describe('o manual embutido', () => {
  /**
   * A GUARDA CONTRA DIVERGÊNCIA.
   *
   * Usa a mesma função de preparo do gerador, de propósito: uma cópia da
   * limpeza aqui compararia coisas diferentes e passaria sempre.
   */
  it('está sincronizado com o manual.md', () => {
    const esperado = prepararManual(readFileSync(MD, 'utf8'));

    assert.equal(
      MANUAL_FERRAMENTAS,
      esperado,
      'manual.ts está desatualizado — rode `node scripts/gerar-manual.mjs`',
    );
  });

  /**
   * Nenhum dado de empresa, e nenhuma marca de interpolação que
   * permitisse enfiar um depois. Se este teste falhar, o cache deixou de
   * ser compartilhado entre clientes — e isso não dá sintoma visível,
   * só fatura.
   */
  it('não tem nada que varie por empresa', () => {
    assert.ok(
      !MANUAL_FERRAMENTAS.includes('${'),
      'o manual não pode ter interpolação: ele precisa ser idêntico para todos',
    );

    for (const proibido of [/tenant_id/i, /\bCNPJ\s*:/i, /nome da empresa:/i]) {
      assert.ok(
        !proibido.test(MANUAL_FERRAMENTAS),
        `o manual não pode conter ${proibido}`,
      );
    }
  });

  /**
   * As quatro ferramentas precisam estar lá. Um gerador que rodasse
   * sobre markdown truncado produziria um manual pela metade, e o
   * assistente responderia com confiança sobre as duas primeiras e
   * inventaria as outras.
   */
  it('cobre as quatro ferramentas', () => {
    for (const secao of [
      'Fluxo de Caixa Projetado',
      'Cálculo de Capital de Giro',
      'Ciclo Operacional e Financeiro',
      'Plano de Redução de Ciclo',
    ]) {
      assert.ok(MANUAL_FERRAMENTAS.includes(secao), `faltou a seção: ${secao}`);
    }
  });

  it('traz o glossário e as perguntas frequentes', () => {
    assert.match(MANUAL_FERRAMENTAS, /# Perguntas frequentes/);
    assert.match(MANUAL_FERRAMENTAS, /# Glossário/);
  });

  /**
   * Teto de tamanho, não exatidão.
   *
   * O manual entra em todo prompt do assistente. Crescer é natural —
   * faltam oito ferramentas —, mas passar de uns 60 mil caracteres é o
   * sinal de que chegou a hora de virar ferramenta `consultar_manual`,
   * em vez de continuar inteiro no prefixo.
   *
   * O teste existe para essa decisão ser tomada de propósito, e não
   * descoberta na fatura.
   */
  it('cabe no prompt sem exagero', () => {
    assert.ok(MANUAL_CARACTERES > 5_000, 'manual suspeito de estar truncado');
    assert.ok(
      MANUAL_CARACTERES < 60_000,
      `manual com ${MANUAL_CARACTERES} caracteres: hora de virar ferramenta de consulta`,
    );
  });
});
