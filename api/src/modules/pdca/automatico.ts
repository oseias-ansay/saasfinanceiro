/**
 * O diagnóstico vira plano de ação, sem reunião.
 *
 * =====================================================================
 * O QUE ESTE MÓDULO RESOLVE
 * =====================================================================
 * A análise já produz `planoDeAcao`: prioridade, pilar e ação
 * recomendada, até 12 itens. Até aqui isso virava PDF e parava. Vira
 * `acoes`, o cliente ganha quadro, card de pendências e chat — e o
 * Básico passa a entregar acompanhamento sem consultor.
 *
 * =====================================================================
 * O QUE A IA NÃO DÁ, E COMO ISSO É PREENCHIDO
 * =====================================================================
 * Ela diz O QUE fazer e POR QUÊ. Não diz QUEM e QUANDO — e o banco exige
 * os dois, porque a regra do método é que só entra no plano o que tem
 * dono e prazo.
 *
 * O prazo sai da prioridade, por uma tabela fixa. Não é adivinhação
 * disfarçada: é uma convenção declarada, que a tela mostra como
 * *sugestão* e que o cliente pode mudar (ver SQL 58). O que seria
 * adivinhação é apresentar isso como se tivesse sido combinado.
 *
 * O responsável fica "A definir". Inventar um nome seria pior que o
 * vazio: criaria a impressão de que alguém assumiu. "A definir" aparece
 * destacado na tela e é a primeira coisa que o cliente conserta — o que,
 * de quebra, é o primeiro ato de adoção do plano.
 *
 * =====================================================================
 * POR QUE UM MÓDULO PURO
 * =====================================================================
 * A conversão é regra de negócio: a escada de prazos, o limite de ações
 * e o texto do contexto. Regra sem teste apodrece, e esta vai rodar
 * sozinha todo mês, sem ninguém olhando — que é exatamente quando um
 * defeito silencioso sobrevive mais tempo.
 */

export type Prioridade = 'Alta' | 'Média' | 'Baixa';

export interface AcaoDaAnalise {
  prioridade: Prioridade;
  pilar: string;
  acaoRecomendada: string;
}

export interface AnaliseParaPlano {
  resumoExecutivo: string;
  planoDeAcao: AcaoDaAnalise[];
  /** Os gargalos nomeados, que entram no contexto do chat. */
  gargalos?: string[];
}

/**
 * Dias até o prazo, por prioridade.
 *
 * Quinze, quarenta e cinco e noventa. A escada tem três degraus porque a
 * prioridade tem três níveis, e ela cabe dentro do ciclo de 90 dias que
 * o método usa — um prazo "Baixa" além disso cairia no ciclo seguinte,
 * onde o diagnóstico que o originou já não vale.
 */
export const PRAZO_POR_PRIORIDADE: Record<Prioridade, number> = {
  Alta: 15,
  Média: 45,
  Baixa: 90,
};

/** Quando ninguém assumiu a ação ainda. */
export const RESPONSAVEL_A_DEFINIR = 'A definir';

/**
 * Teto de ações no plano automático.
 *
 * Cinco, e não as doze que a análise pode produzir. O limite é de método,
 * não técnico: acima de cinco abertas a lista deixa de ser acompanhada e
 * passa a ser ignorada — é o mesmo aviso que a tela do consultor dá.
 *
 * Num plano automático isso pesa mais, porque não há ninguém na reunião
 * para dizer "deixa essas três para o próximo ciclo". O corte precisa
 * estar no código.
 */
export const MAX_ACOES_AUTOMATICAS = 5;

const PESO: Record<Prioridade, number> = { Alta: 0, Média: 1, Baixa: 2 };

export interface AcaoGerada {
  titulo: string;
  detalhe: string | null;
  pilar: string | null;
  responsavel_nome: string;
  /** ISO. Sugestão derivada da prioridade. */
  prazo: string;
  ordem: number;
}

function somarDias(base: Date, dias: number): string {
  const d = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()) + dias * 86_400_000,
  );
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

/**
 * Corta o texto da ação no limite do banco, sem partir palavra.
 *
 * O título tem 200 caracteres no `acoes`, e `acaoRecomendada` pode ter
 * 2000. O que não cabe vai para o detalhe, inteiro — assim nada se
 * perde e o título continua legível numa linha da lista.
 */
function dividir(texto: string): { titulo: string; detalhe: string | null } {
  const t = texto.trim().replace(/\s+/g, ' ');
  if (t.length <= 200) return { titulo: t, detalhe: null };

  const corte = t.lastIndexOf(' ', 197);
  const titulo = `${t.slice(0, corte > 100 ? corte : 197).trim()}…`;
  return { titulo, detalhe: t };
}

/**
 * As ações do plano, prontas para o insert.
 *
 * Ordenadas por prioridade e cortadas no teto. A ordem importa: ela é o
 * que a tela usa, e o cliente vai executar de cima para baixo.
 */
export function gerarAcoes(analise: AnaliseParaPlano, hoje: Date): AcaoGerada[] {
  const ordenadas = [...(analise.planoDeAcao ?? [])].sort(
    (a, b) => (PESO[a.prioridade] ?? 1) - (PESO[b.prioridade] ?? 1),
  );

  return ordenadas.slice(0, MAX_ACOES_AUTOMATICAS).map((a, i) => {
    const { titulo, detalhe } = dividir(a.acaoRecomendada);
    const dias = PRAZO_POR_PRIORIDADE[a.prioridade] ?? PRAZO_POR_PRIORIDADE.Média;

    return {
      titulo,
      detalhe,
      pilar: a.pilar?.trim() || null,
      responsavel_nome: RESPONSAVEL_A_DEFINIR,
      prazo: somarDias(hoje, dias),
      ordem: i,
    };
  });
}

/**
 * O contexto do plano, para o chat.
 *
 * Monta a partir do resumo executivo e dos gargalos — e diz, em voz
 * clara, que o plano foi gerado a partir dos números e não de uma
 * conversa. Omitir isso faria o cliente atribuir a um consultor uma
 * prescrição que nenhum consultor viu, e essa é a diferença que ele está
 * pagando para ter ou não ter.
 */
export function gerarContexto(
  analise: AnaliseParaPlano,
  competencia: string,
  limite = 8000,
): string {
  const l: string[] = [];

  l.push(
    'Este plano foi gerado automaticamente a partir do diagnóstico financeiro ' +
      `da competência ${competencia}, com base nos lançamentos da própria empresa. ` +
      'Ele não passou por uma reunião de consultoria — os prazos são sugestões ' +
      'derivadas da prioridade de cada ação, e podem ser ajustados.',
  );

  if (analise.resumoExecutivo?.trim()) {
    l.push('');
    l.push('## O que os números mostram');
    l.push('');
    l.push(analise.resumoExecutivo.trim());
  }

  const gargalos = (analise.gargalos ?? []).filter((g) => g?.trim());
  if (gargalos.length > 0) {
    l.push('');
    l.push('## Gargalos identificados');
    l.push('');
    for (const g of gargalos) l.push(`- ${g.trim()}`);
  }

  const texto = l.join('\n');
  if (texto.length <= limite) return texto;

  const corte = texto.lastIndexOf('\n\n', limite);
  return (corte > limite * 0.5 ? texto.slice(0, corte) : texto.slice(0, limite)).trim();
}

/**
 * Lê a análise guardada em `diagnosticos.analise`.
 *
 * É um `jsonb` sem garantia de formato: foi gravado por uma versão
 * anterior do schema, podendo ter vindo do financeiro ou do comercial, e
 * um diagnóstico de meses atrás pode não ter o campo que o código de hoje
 * espera. Ler isso direto, com `as`, é pedir para a rotina quebrar num
 * registro antigo — e ela roda no marco zero, que é o pior momento para
 * falhar.
 *
 * Devolve `null` quando não há plano aproveitável, em vez de um objeto
 * pela metade. Quem chama trata como "não gerou", que é a verdade.
 */
export function lerAnaliseGuardada(bruto: unknown): AnaliseParaPlano | null {
  if (!bruto || typeof bruto !== 'object') return null;

  const a = bruto as Record<string, unknown>;
  const plano = a.planoDeAcao;

  if (!Array.isArray(plano) || plano.length === 0) return null;

  const acoes: AcaoDaAnalise[] = [];
  for (const item of plano) {
    if (!item || typeof item !== 'object') continue;
    const i = item as Record<string, unknown>;
    const texto = typeof i.acaoRecomendada === 'string' ? i.acaoRecomendada.trim() : '';
    // Ação sem texto não é ação. Entrar com título vazio quebraria o
    // check de tamanho mínimo do banco depois de o plano já existir.
    if (texto.length < 3) continue;

    acoes.push({
      prioridade: (i.prioridade === 'Alta' || i.prioridade === 'Baixa'
        ? i.prioridade
        : 'Média') as Prioridade,
      pilar: typeof i.pilar === 'string' ? i.pilar : '',
      acaoRecomendada: texto,
    });
  }

  if (acoes.length === 0) return null;

  // O schema financeiro e o comercial nomeiam os gargalos de formas
  // diferentes. Ler os dois evita um plano comercial entrar sem gargalo
  // nenhum no contexto do chat.
  const gargalos = [a.gargalosIdentificados, a.gargalosCriticos]
    .find(Array.isArray) as unknown[] | undefined;

  return {
    resumoExecutivo: typeof a.resumoExecutivo === 'string' ? a.resumoExecutivo : '',
    planoDeAcao: acoes,
    gargalos: (gargalos ?? []).filter((g): g is string => typeof g === 'string'),
  };
}

/** Título do plano, legível na lista do consultor e no card do cliente. */
export function tituloDoPlano(competencia: string): string {
  const [ano, mes] = competencia.split('-');
  const meses = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
  ];
  const nome = meses[Number(mes) - 1];
  return nome ? `Plano de ação — ${nome}/${ano}` : `Plano de ação — ${competencia}`;
}
