/**
 * A limpeza do markdown antes de ele virar constante no prompt.
 *
 * Mora em módulo próprio, e não dentro do script gerador, porque o TESTE
 * precisa aplicar exatamente a mesma transformação para comparar o `.md`
 * com o `.ts` gerado. Uma segunda cópia da limpeza no teste compararia
 * coisas diferentes e passaria sempre — que é o pior tipo de teste: o
 * que dá segurança sem verificar nada.
 */

/**
 * Tira o front matter YAML (que serve ao PDF, não ao prompt) e escapa o
 * que quebraria o template literal gerado.
 *
 * A ordem importa: a contrabarra é escapada PRIMEIRO. Invertendo, as
 * contrabarras introduzidas pelos escapes seguintes seriam escapadas de
 * novo, e o manual chegaria ao modelo cheio de `\\` visível.
 */
export function prepararManual(markdown: string): string {
  return markdown
    .replace(/^---\n[\s\S]*?\n---\n+/, '')
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${')
    .trim();
}
