/**
 * O plano de ação virado texto, para o modelo ler.
 *
 * =====================================================================
 * A FONTE É A TABELA, NÃO O PDF
 * =====================================================================
 * O relatório de PDCA que o cliente recebe tem 25 a 30 páginas, e a
 * tentação óbvia é jogar esse PDF no contexto. Está errado por três
 * motivos, e o terceiro é o que decide:
 *
 *   1. O PDF é um RENDER do plano, feito no dia em que foi emitido. A
 *      ação que o cliente concluiu ontem continua "aberta" nele. O chat
 *      responderia sobre o passado com a confiança do presente.
 *   2. Extrair texto de PDF perde a estrutura. "Prazo 15/10" numa célula
 *      de tabela chega como um número solto no meio de uma frase, e o
 *      modelo passa a chutar a qual ação ele pertence.
 *   3. As tabelas `planos_acao` e `acoes` JÁ são o plano. O PDF foi
 *      gerado a partir delas. Ler o derivado em vez da origem é trabalho
 *      a mais para informação pior.
 *
 * =====================================================================
 * O QUE ENTRA, E O QUE FICA DE FORA
 * =====================================================================
 * Entra: o plano, as ações com dono e prazo, a situação de cada uma, o
 * atraso em dias e o ritmo de marcação.
 *
 * Fica de fora o `id` de cada ação. O modelo não precisa dele para
 * responder, e um uuid no contexto só convida a resposta a citá-lo —
 * número que o cliente não reconhece. A ação é referida pelo número de
 * ordem, que é o mesmo que a tela mostra.
 *
 * =====================================================================
 * AUSÊNCIA DE DADO É DITA, NÃO OMITIDA
 * =====================================================================
 * Campo vazio vira a frase "não informado" em vez de desaparecer. A
 * diferença aparece na resposta: contexto onde a causa-raiz simplesmente
 * não está faz o modelo inferir uma; contexto que diz "causa-raiz não
 * informada" faz ele dizer que não está no plano.
 *
 * É a mesma regra das telas — branco não vira zero —, aplicada ao texto.
 */

export type AcaoStatus = 'aberta' | 'concluida' | 'cancelada';

export interface AcaoDoContexto {
  titulo: string;
  detalhe?: string | null;
  pilar?: string | null;
  causa_raiz?: string | null;
  responsavel_nome: string;
  /** ISO `aaaa-mm-dd`, como vem do Postgres. */
  prazo: string;
  status: AcaoStatus;
  concluida_em?: string | null;
  ordem?: number | null;
  /** Alavanca do Plano de Redução de Ciclo (aula 4.3). Nulo em ação comum. */
  ganho_dias?: number | null;
}

export interface PlanoDoContexto {
  titulo: string;
  ciclo?: string | null;
  /** 'financeiro' ou 'comercial'. */
  tipo?: string | null;
  observacao?: string | null;
  /**
   * Diagnóstico e causa-raiz do relatório, colado pelo consultor (SQL 57).
   *
   * É o que responde "por que isso é prioridade?". Sem ele o assistente
   * conhece as ações e não conhece o raciocínio que as ordenou — e essa
   * é a primeira pergunta que o cliente faz.
   */
  contexto?: string | null;
  /** ISO completo. */
  created_at: string;
}

export interface DadosDoContexto {
  empresa: string;
  plano: PlanoDoContexto;
  acoes: AcaoDoContexto[];
  /** Data do último evento de marcação, de qualquer ação. */
  ultimoMovimento?: string | null;
  /** O dia de hoje. Entra por parâmetro para a função ser testável. */
  hoje: Date;
}

/** Dias entre duas datas, pelo calendário — não por 24 horas corridas. */
function diasEntre(de: Date, ate: Date): number {
  const d1 = Date.UTC(de.getUTCFullYear(), de.getUTCMonth(), de.getUTCDate());
  const d2 = Date.UTC(ate.getUTCFullYear(), ate.getUTCMonth(), ate.getUTCDate());
  return Math.round((d2 - d1) / 86_400_000);
}

function dataBR(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split('-');
  return d && m && a ? `${d}/${m}/${a}` : iso;
}

/**
 * A situação da ação em uma frase.
 *
 * O atraso vem em dias, não como a etiqueta "atrasada". O modelo precisa
 * do número para ordenar urgência: três dias e noventa dias pedem
 * conversas diferentes, e a etiqueta trata as duas igual.
 */
export function descreverSituacao(a: AcaoDoContexto, hoje: Date): string {
  if (a.status === 'cancelada') return 'cancelada';

  if (a.status === 'concluida') {
    if (!a.concluida_em) return 'concluída';
    const atraso = diasEntre(new Date(a.prazo), new Date(a.concluida_em));
    if (atraso > 0) return `concluída em ${dataBR(a.concluida_em)}, ${atraso} dia(s) após o prazo`;
    return `concluída em ${dataBR(a.concluida_em)}, dentro do prazo`;
  }

  const restam = diasEntre(hoje, new Date(a.prazo));
  if (restam < 0) return `ABERTA e ATRASADA há ${Math.abs(restam)} dia(s)`;
  if (restam === 0) return 'ABERTA, vence hoje';
  return `aberta, faltam ${restam} dia(s)`;
}

export interface Resumo {
  total: number;
  abertas: number;
  concluidas: number;
  canceladas: number;
  atrasadas: number;
  /** Inteiro de 0 a 100. Nulo quando não há ação para dividir. */
  conclusaoPct: number | null;
  /** Nulo quando nunca houve marcação. */
  diasSemMovimento: number | null;
  /** Soma do ganho das alavancas que ainda estão abertas. */
  ganhoDiasEmAberto: number;
}

/**
 * Os números do plano.
 *
 * Canceladas entram no total. Tirar do denominador inflaria o percentual
 * de conclusão: um plano de dez ações com oito canceladas e duas feitas
 * marcaria 100%, e o cliente leria "plano cumprido".
 */
export function resumir(dados: DadosDoContexto): Resumo {
  const { acoes, hoje } = dados;

  const abertas = acoes.filter((a) => a.status === 'aberta');
  const concluidas = acoes.filter((a) => a.status === 'concluida');
  const canceladas = acoes.filter((a) => a.status === 'cancelada');

  return {
    total: acoes.length,
    abertas: abertas.length,
    concluidas: concluidas.length,
    canceladas: canceladas.length,
    atrasadas: abertas.filter((a) => diasEntre(hoje, new Date(a.prazo)) < 0).length,
    conclusaoPct:
      acoes.length === 0 ? null : Math.round((concluidas.length / acoes.length) * 100),
    diasSemMovimento:
      dados.ultimoMovimento == null
        ? null
        : Math.max(0, diasEntre(new Date(dados.ultimoMovimento), hoje)),
    ganhoDiasEmAberto: Number(
      abertas.reduce((s, a) => s + (a.ganho_dias ?? 0), 0).toFixed(1),
    ),
  };
}

/**
 * Ordem em que as ações aparecem no contexto.
 *
 * A mesma da tela: abertas primeiro, por prazo; depois as fechadas. Tem
 * que ser a mesma, porque a resposta vai dizer "a ação 3" e o cliente
 * vai contar na tela. Duas ordenações diferentes transformariam cada
 * referência numa pequena mentira.
 */
export function ordenar(acoes: AcaoDoContexto[]): AcaoDoContexto[] {
  const peso = (s: AcaoStatus) => (s === 'aberta' ? 0 : s === 'concluida' ? 1 : 2);
  return [...acoes].sort(
    (a, b) =>
      peso(a.status) - peso(b.status) ||
      a.prazo.localeCompare(b.prazo) ||
      (a.ordem ?? 0) - (b.ordem ?? 0),
  );
}

const vazio = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

/** O contexto completo, em texto. É o que vai no bloco de sistema. */
export function montarContexto(dados: DadosDoContexto): string {
  const r = resumir(dados);
  const acoes = ordenar(dados.acoes);
  const l: string[] = [];

  l.push('# PLANO DE AÇÃO DESTA EMPRESA');
  l.push('');
  l.push(`Empresa: ${dados.empresa}`);
  l.push(`Plano: ${dados.plano.titulo}`);
  if (vazio(dados.plano.ciclo)) l.push(`Ciclo: ${dados.plano.ciclo}`);
  if (vazio(dados.plano.tipo)) l.push(`Tipo: ${dados.plano.tipo}`);
  l.push(`Em vigor desde: ${dataBR(dados.plano.created_at)}`);
  l.push(`Hoje é ${dataBR(dados.hoje.toISOString())}.`);
  if (vazio(dados.plano.observacao)) {
    l.push('');
    l.push(`Observação do consultor: ${dados.plano.observacao}`);
  }

  l.push('');
  l.push('## SITUAÇÃO GERAL');
  l.push('');
  l.push(`- Ações no plano: ${r.total}`);
  l.push(`- Abertas: ${r.abertas}`);
  l.push(`- Concluídas: ${r.concluidas}${r.conclusaoPct === null ? '' : ` (${r.conclusaoPct}%)`}`);
  if (r.canceladas > 0) l.push(`- Canceladas: ${r.canceladas}`);
  l.push(`- Abertas e atrasadas: ${r.atrasadas}`);
  l.push(
    r.diasSemMovimento === null
      ? '- Nenhuma ação foi marcada ainda.'
      : `- Última marcação: há ${r.diasSemMovimento} dia(s).`,
  );
  if (r.ganhoDiasEmAberto > 0) {
    l.push(
      `- As alavancas de ciclo ainda abertas somam ${r.ganhoDiasEmAberto} dia(s) ` +
        'de redução do ciclo financeiro, se concluídas.',
    );
  }

  /**
   * O diagnóstico vem ANTES das ações.
   *
   * Ordem deliberada: é a leitura dos números que explica por que a lista
   * é essa e nessa sequência. Depois das ações, o mesmo texto seria lido
   * como apêndice — e o modelo responderia "por que isso é prioridade?"
   * com a ação em si, que é o que o cliente já tinha na tela.
   */
  if (vazio(dados.plano.contexto)) {
    l.push('');
    l.push('## DIAGNÓSTICO QUE ORIGINOU ESTE PLANO');
    l.push('');
    l.push('Escrito pelo consultor que conduziu a análise:');
    l.push('');
    l.push(String(dados.plano.contexto).trim());
  }

  l.push('');
  l.push('## AS AÇÕES');

  if (acoes.length === 0) {
    l.push('');
    l.push('Este plano ainda não tem ações cadastradas.');
    return l.join('\n');
  }

  acoes.forEach((a, i) => {
    l.push('');
    l.push(`### Ação ${i + 1}: ${a.titulo}`);
    l.push(`- Situação: ${descreverSituacao(a, dados.hoje)}`);
    l.push(`- Responsável: ${a.responsavel_nome}`);
    l.push(`- Prazo: ${dataBR(a.prazo)}`);
    l.push(`- Pilar: ${vazio(a.pilar) ?? 'não informado'}`);
    l.push(`- Causa-raiz: ${vazio(a.causa_raiz) ?? 'não informada'}`);
    if (a.ganho_dias != null) {
      l.push(`- Alavanca de ciclo: reduz ${a.ganho_dias} dia(s) do ciclo financeiro.`);
    }
    l.push(`- Detalhe combinado: ${vazio(a.detalhe) ?? 'não informado'}`);
  });

  return l.join('\n');
}
