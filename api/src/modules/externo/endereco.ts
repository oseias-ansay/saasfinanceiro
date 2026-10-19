/**
 * O endereço do CRM e do Contábil para uma empresa.
 *
 * =====================================================================
 * POR QUE ISTO É UM MÓDULO PURO COM TESTE
 * =====================================================================
 * A função monta a URL para onde o cliente é mandado — e, no passo
 * seguinte do projeto, ele vai junto com um token de sessão.
 *
 * Um defeito aqui não dá erro: manda a pessoa, autenticada, para um host
 * que não é nosso. É o tipo de falha que só aparece quando já aconteceu.
 *
 * Por isso a montagem é pura, testada, e **recusa em vez de improvisar**
 * sempre que qualquer parte estiver fora do formato.
 *
 * =====================================================================
 * O SLUG VEM DO BANCO, MAS NÃO É CONFIÁVEL
 * =====================================================================
 * O `check` do SQL 64 já impede ponto e barra. A conferência aqui é
 * deliberadamente redundante: o banco pode ser restaurado de um backup
 * anterior à restrição, ou alguém pode gravar com `supabaseAdmin`
 * contornando tudo.
 *
 * Validar duas vezes custa uma linha. Não validar custa um redirecionamento
 * para `evil.com` montado a partir de um slug com barra.
 */

export type SistemaExterno = 'crm' | 'contabil';

export const SISTEMAS: SistemaExterno[] = ['crm', 'contabil'];

export function ehSistema(v: string): v is SistemaExterno {
  return (SISTEMAS as string[]).includes(v);
}

/** O recurso que libera cada sistema. */
export const RECURSO_DO_SISTEMA: Record<SistemaExterno, string> = {
  crm: 'crm_externo',
  contabil: 'contabil',
};

export class EnderecoInvalido extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnderecoInvalido';
  }
}

/**
 * Rótulo de subdomínio, nada além: 2 a 48 caracteres, minúsculas,
 * dígitos e hífen, sem hífen nas pontas. Mesma regra do `check` no
 * SQL 64.
 *
 * Sem ponto, barra, arroba, dois-pontos ou espaço — qualquer um deles
 * permitiria escapar do domínio base.
 *
 * A primeira versão desta expressão tinha o miolo opcional
 * (`([a-z0-9-]{1,46}[a-z0-9])?`), o que aceitava slug de UM caractere e
 * recusava de dois. Parecia certa e estava errada nos dois extremos; o
 * teste de varredura pegou, e o `check` do SQL foi corrigido junto.
 */
const SLUG = /^[a-z0-9][a-z0-9-]{0,46}[a-z0-9]$/;

/**
 * O domínio base também é conferido.
 *
 * Ele vem de variável de ambiente, e `.env` com valor vazio ou com um
 * espaço sobrando é coisa que acontece. Montar `https://posto.` seria um
 * endereço quebrado que só falha no navegador do cliente.
 */
const DOMINIO = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export function montarEndereco(
  sistema: SistemaExterno,
  slug: string | null | undefined,
  dominioBase: string | null | undefined,
  caminho = '/',
): string {
  if (!slug || !SLUG.test(slug)) {
    throw new EnderecoInvalido(
      'Esta empresa ainda não está vinculada ao CRM e ao Contábil. ' +
        'Peça ao administrador para informar o identificador externo dela.',
    );
  }

  const base = (dominioBase ?? '').trim().toLowerCase();
  if (!DOMINIO.test(base)) {
    throw new EnderecoInvalido(
      `O domínio do ${sistema === 'crm' ? 'CRM' : 'Contábil'} não está ` +
        'configurado corretamente no servidor.',
    );
  }

  /**
   * O caminho é concatenado, então ele também precisa ser contido.
   *
   * `//outro.com` é um caminho que o navegador trata como OUTRO HOST —
   * é o clássico de redirecionamento aberto, e passa despercebido porque
   * parece uma barra a mais.
   */
  const rota = caminho.startsWith('/') && !caminho.startsWith('//') ? caminho : '/';

  return `https://${slug}.${base}${rota}`;
}
