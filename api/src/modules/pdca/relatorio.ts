/**
 * Leitura do relatório de PDCA em markdown.
 *
 * =====================================================================
 * POR QUE O MARKDOWN, E NÃO O PDF
 * =====================================================================
 * O relatório nasce como `relatorio.md` e só depois é renderizado em PDF.
 * A estrutura existe antes da fotografia: a tabela 5W2H tem colunas
 * nomeadas que caem uma-para-uma nos campos de `acoes`.
 *
 * Importar o PDF seria analisar a própria saída depois de jogar a
 * estrutura fora. E não é hipótese: o relatório do Auto Posto Esperança,
 * medido em 02/10/2026, tem zero fontes e nenhuma camada de texto —
 * `pdftotext` extrai 18 bytes de 18 páginas. O único caminho seria OCR,
 * que erra `8` por `3` exatamente onde isso vira compromisso errado.
 *
 * =====================================================================
 * A REGRA QUE GOVERNA O ARQUIVO: NUNCA INVENTAR
 * =====================================================================
 * É a mesma do `planilha.ts`, e aqui ela pesa mais. Lá um preço em
 * branco virava margem de 100%; aqui um prazo adivinhado vira um
 * compromisso que ninguém assumiu, com nome de dono ao lado.
 *
 * Então: dado ausente ou ambíguo sai como `null` e entra em `faltando`.
 * A tela destaca e o consultor preenche. Nada é salvo sem ele confirmar.
 *
 * O caso que mais aparece é a coluna "Quando?": o gabarito da skill
 * admite prazo literal do anexo, `[definido neste plano]`, ou período
 * ("Onda 1", "Out/2026"). Só data completa e sem ambiguidade vira
 * `prazo`. Mês sem dia NÃO é chutado para o dia 1 nem para o último:
 * a diferença entre 01/10 e 31/10 é um mês de cobrança.
 */

/* ==================================================================== */
/* Tabelas de markdown                                                   */
/* ==================================================================== */

export interface TabelaMarkdown {
  cabecalho: string[];
  linhas: string[][];
}

/** Tira negrito, código, link e emoji de marcação do texto de uma célula. */
export function limparCelula(bruto: string): string {
  return bruto
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\*([^*]*)\*/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[🔴🟡🟢⚠️①②③④⑤]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const separadora = (l: string) => /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(l) && l.includes('-');

function celulas(linha: string): string[] {
  let l = linha.trim();
  if (l.startsWith('|')) l = l.slice(1);
  if (l.endsWith('|')) l = l.slice(0, -1);
  return l.split('|').map(limparCelula);
}

/**
 * Todas as tabelas do documento.
 *
 * Varre linha a linha em vez de usar uma expressão regular sobre o texto
 * inteiro: tabela markdown é formato de linhas, e a regex que tenta
 * capturar o bloco todo quebra no primeiro `|` dentro de uma célula.
 */
export function extrairTabelas(markdown: string): TabelaMarkdown[] {
  const linhas = markdown.split(/\r?\n/);
  const tabelas: TabelaMarkdown[] = [];

  for (let i = 0; i < linhas.length - 1; i++) {
    const atual = linhas[i] ?? '';
    const proxima = linhas[i + 1] ?? '';

    if (!atual.includes('|') || !separadora(proxima)) continue;

    const cabecalho = celulas(atual);
    const corpo: string[][] = [];
    let j = i + 2;

    while (j < linhas.length) {
      const l = linhas[j] ?? '';
      if (!l.includes('|') || l.trim() === '') break;
      const c = celulas(l);
      // Linha inteiramente vazia é separador visual, não dado.
      if (c.some((x) => x !== '')) corpo.push(c);
      j++;
    }

    tabelas.push({ cabecalho, linhas: corpo });
    i = j - 1;
  }

  return tabelas;
}

/* ==================================================================== */
/* A tabela 5W2H                                                         */
/* ==================================================================== */

const semAcento = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Apelidos de cada coluna que interessa.
 *
 * O gabarito diz que colunas podem ser acrescentadas, e que suprimir
 * exige justificar — ou seja, a ordem e a quantidade variam de relatório
 * para relatório. Reconhecer por NOME, e não por posição, é o que faz a
 * leitura sobreviver a isso.
 *
 * A lista inclui as variações que um relatório escrito à mão produz. É
 * barato acrescentar apelido; é caro descobrir que a coluna não foi
 * encontrada depois de o consultor já ter revisado a prévia errada.
 */
const APELIDOS: Record<string, string[]> = {
  id: ['id', 'cod', 'codigo', 'n', 'num', 'numero'],
  titulo: ['oque', 'oquefazer', 'acao', 'atividade', 'what'],
  pilar: ['area', 'pilar', 'frente', 'dimensao'],
  nivel: ['nivel', 'prioridade', 'level'],
  detalhe: ['porque', 'porquejustificativaeorigem', 'justificativa', 'motivo', 'why'],
  responsavel: ['quem', 'responsavel', 'dono', 'who'],
  prazo: ['quando', 'prazo', 'data', 'when'],
  como: ['como', 'metodo', 'how'],
  custo: ['quantocusta', 'custo', 'orcamento', 'investimento', 'howmuch'],
};

export type ColunasAcao = Partial<Record<keyof typeof APELIDOS, number>>;

/** Onde está cada coluna. Ausente é ausente — não há palpite por posição. */
export function detectarColunas(cabecalho: string[]): ColunasAcao {
  const achado: ColunasAcao = {};

  cabecalho.forEach((titulo, i) => {
    const limpo = semAcento(titulo);
    if (!limpo) return;

    for (const [campo, apelidos] of Object.entries(APELIDOS)) {
      if (achado[campo as keyof ColunasAcao] !== undefined) continue;
      // Igualdade antes de prefixo: "como" é prefixo de nada, mas
      // "custo" casaria dentro de "quantocusta" e vice-versa. A ordem
      // evita que a primeira coluna parecida roube a segunda.
      if (apelidos.includes(limpo)) {
        achado[campo as keyof ColunasAcao] = i;
        return;
      }
    }

    for (const [campo, apelidos] of Object.entries(APELIDOS)) {
      if (achado[campo as keyof ColunasAcao] !== undefined) continue;
      if (apelidos.some((a) => limpo.startsWith(a) || a.startsWith(limpo))) {
        achado[campo as keyof ColunasAcao] = i;
        return;
      }
    }
  });

  return achado;
}

/**
 * A data, só quando não há dúvida.
 *
 * Aceita `dd/mm/aaaa`, `dd-mm-aaaa` e `aaaa-mm-dd`. Recusa tudo o mais —
 * mês sem dia, "30 dias", "Onda 2", `[definido neste plano]` — e recusar
 * aqui significa campo em branco destacado na tela, não data inventada.
 *
 * Ano de dois dígitos também é recusado: `01/10/26` pode ser 2026 em
 * quase todo contexto, mas "quase" não serve para um prazo.
 */
export function lerData(bruto: string, dataInicio?: string): string | null {
  const t = bruto.trim();
  if (!t) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (iso) return validar(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const br = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(t);
  if (br) return validar(Number(br[3]), Number(br[2]), Number(br[1]));

  return lerRelativa(t, dataInicio);
}

/**
 * A notação `D+N` do relatório, e só ela.
 *
 * =====================================================================
 * ISTO NÃO É EXCEÇÃO À REGRA DE NUNCA INVENTAR
 * =====================================================================
 * `D+15` não é vago: é aritmética que o relatório pretende, e a única
 * incógnita é qual é o D0. A regra continua valendo — o que mudou é que a
 * incógnita passou a ser preenchida por uma pessoa, uma vez, de forma
 * visível na tela, em vez de adivinhada por linha.
 *
 * Sem `dataInicio`, nada é calculado. E o texto original fica na tela ao
 * lado da data, para a conferência não depender de confiança.
 *
 * O que continua recusado: "esta semana", "imediato", "Onda 2",
 * "Out/2026". São períodos, não contagens — e traduzir período em dia é
 * escolher por alguém.
 *
 * A célula pode trazer as duas coisas: a A4 do Auto Posto diz
 * "Esta semana (literal [DF]); fechamento até D+30". Aí vale o `D+N`, que
 * é a parte com número, e o texto inteiro aparece na revisão.
 */
function lerRelativa(texto: string, dataInicio?: string): string | null {
  if (!dataInicio) return null;

  const base = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dataInicio.trim());
  if (!base) return null;

  const t = texto.toLowerCase();
  let dias: number | null = null;

  // "Hoje" é o D0 do plano. Vem literal do diagnóstico e não tem outra
  // leitura possível.
  if (/^hoje\b/.test(t) || /^d\s*\+?\s*0\b/.test(t)) dias = 0;

  const relativa = /\bd\s*\+\s*(\d{1,3})\b/.exec(t);
  if (relativa) dias = Number(relativa[1]);

  if (dias === null || !Number.isFinite(dias) || dias > 365) return null;

  const d = new Date(
    Date.UTC(Number(base[1]), Number(base[2]) - 1, Number(base[3])) + dias * 86_400_000,
  );
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

function validar(ano: number, mes: number, dia: number): string | null {
  if (ano < 2000 || ano > 2100 || mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  // Pega 31/02: o Date rola para março, e o dia deixa de bater.
  if (d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

export interface AcaoExtraida {
  /** O `A1` do relatório. Só para a tela mostrar a origem da linha. */
  codigo: string | null;
  titulo: string;
  detalhe: string | null;
  pilar: string | null;
  responsavel_nome: string | null;
  /** ISO, ou nulo quando o relatório não deu data completa. */
  prazo: string | null;
  /** O texto cru de "Quando?", para a tela mostrar o que estava escrito. */
  prazo_original: string | null;
  /** Campos que o consultor precisa completar antes de salvar. */
  faltando: Array<'responsavel_nome' | 'prazo'>;
}

/** Junta "Por quê?", "Como?" e "Quanto custa?" num detalhe só. */
function montarDetalhe(l: string[], c: ColunasAcao): string | null {
  const partes: string[] = [];
  const pegar = (i?: number) => (i === undefined ? '' : (l[i] ?? '').trim());

  const porque = pegar(c.detalhe);
  const como = pegar(c.como);
  const custo = pegar(c.custo);

  if (porque) partes.push(porque);
  if (como) partes.push(`Como: ${como}`);
  // "Custo zero" e "[A ORÇAR]" são informação — o gabarito manda explicar
  // por que um item está em aberto, e essa explicação é do consultor.
  if (custo) partes.push(`Custo: ${custo}`);

  return partes.length > 0 ? partes.join('\n\n') : null;
}

export interface ResultadoLeitura {
  acoes: AcaoExtraida[];
  /** Sumário executivo, para o campo de contexto do plano. */
  contexto: string | null;
  /** O que o leitor não conseguiu, em português, para a tela mostrar. */
  avisos: string[];
}

/**
 * Acha a tabela 5W2H entre todas as do documento.
 *
 * Critério: a que tem título E (responsável OU prazo). O relatório tem
 * muitas tabelas — GUT, KPIs, gatilhos, POPs, RACI —, e várias têm
 * "Área" ou "Responsável". Só a de ações tem o par "o quê" + "quem/
 * quando".
 *
 * Entre empatadas, a de mais linhas. A de POPs também casa com o
 * critério, e é sempre menor que a de ações.
 */
export function acharTabelaDeAcoes(tabelas: TabelaMarkdown[]): TabelaMarkdown | null {
  const candidatas = tabelas
    .map((t) => ({ t, c: detectarColunas(t.cabecalho) }))
    .filter(
      ({ c, t }) =>
        c.titulo !== undefined &&
        (c.responsavel !== undefined || c.prazo !== undefined) &&
        t.linhas.length > 0,
    );

  if (candidatas.length === 0) return null;
  candidatas.sort((a, b) => b.t.linhas.length - a.t.linhas.length);
  return candidatas[0]!.t;
}

/**
 * O sumário executivo, para o campo de contexto.
 *
 * Pega da primeira seção de nível 2 que fale de sumário/quadro clínico
 * até a próxima seção de nível 2. É a prosa que explica POR QUE o plano
 * é esse — a tese, a classificação, o que não é o problema.
 *
 * Corta em 8000 caracteres, que é o limite da coluna (SQL 57). Corta na
 * quebra de parágrafo mais próxima, não no meio da frase: texto cortado
 * no meio de um número é pior que texto mais curto.
 */
/**
 * Tira a marcação HTML do gerador de PDF, preservando o texto.
 *
 * O relatório mistura markdown com blocos HTML — os cartões de KPI são
 * `<div class="kpi">`, e o rodapé é um `<p class="small">`. Essa marcação
 * é instrução de layout: no contexto do chat ela ocupa tokens em toda
 * pergunta e não significa nada para o modelo.
 *
 * Remove as TAGS, não o conteúdo. Dentro de um cartão de KPI está
 * "Faturamento mensal" e "R$ 1,67 mi" — número real da empresa, que o
 * chat precisa. Jogar o bloco inteiro fora levaria o número junto.
 */
function limparHtml(texto: string): string {
  return texto
    .split('\n')
    .map((l) => (/<[a-z/][^>]*>/i.test(l) ? l.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : l))
    .filter((l, i, todas) => l !== '' || todas[i - 1] !== '')
    .join('\n');
}

export function extrairContexto(markdown: string, limite = 8000): string | null {
  const linhas = markdown.split(/\r?\n/);
  const inicio = linhas.findIndex((l) =>
    /^##\s/.test(l) && /sum[áa]rio|quadro\s+cl[íi]nico|execut/i.test(l),
  );
  if (inicio === -1) return null;

  const resto = linhas.slice(inicio + 1);
  const fim = resto.findIndex((l) => /^##\s/.test(l) && !/^###/.test(l));
  const bloco = limparHtml((fim === -1 ? resto : resto.slice(0, fim)).join('\n')).trim();

  if (!bloco) return null;
  if (bloco.length <= limite) return bloco;

  const corte = bloco.lastIndexOf('\n\n', limite);
  return (corte > limite * 0.5 ? bloco.slice(0, corte) : bloco.slice(0, limite)).trim();
}

/**
 * A leitura completa. Pura: markdown entra, dados saem.
 *
 * `dataInicio` (ISO) é o D0 do plano, escolhido pelo consultor na tela.
 * Sem ele, as ações com prazo em `D+N` saem em branco — o que é o
 * comportamento certo, não uma falha.
 */
export function lerRelatorio(markdown: string, dataInicio?: string): ResultadoLeitura {
  const avisos: string[] = [];

  if (!markdown || markdown.trim().length === 0) {
    return { acoes: [], contexto: null, avisos: ['O texto está vazio.'] };
  }

  const tabela = acharTabelaDeAcoes(extrairTabelas(markdown));

  if (!tabela) {
    avisos.push(
      'Não encontrei a tabela de ações (5W2H). Ela precisa ter as colunas ' +
        '"O quê?" e pelo menos "Quem?" ou "Quando?".',
    );
    return { acoes: [], contexto: extrairContexto(markdown), avisos };
  }

  const c = detectarColunas(tabela.cabecalho);
  if (c.responsavel === undefined) avisos.push('O relatório não tem coluna "Quem?".');
  if (c.prazo === undefined) avisos.push('O relatório não tem coluna "Quando?".');

  const acoes: AcaoExtraida[] = [];
  const pegar = (l: string[], i?: number) => {
    const v = i === undefined ? '' : (l[i] ?? '').trim();
    return v === '' || v === '-' || v === '—' ? null : v;
  };

  for (const l of tabela.linhas) {
    const titulo = pegar(l, c.titulo);
    // Linha sem "o quê" não é ação. Acontece em linha de subtotal e em
    // separador de onda dentro da tabela.
    if (!titulo) continue;

    const prazoOriginal = pegar(l, c.prazo);
    const prazo = prazoOriginal ? lerData(prazoOriginal, dataInicio) : null;
    const responsavel = pegar(l, c.responsavel);

    const faltando: AcaoExtraida['faltando'] = [];
    if (!responsavel || responsavel.length < 2) faltando.push('responsavel_nome');
    if (!prazo) faltando.push('prazo');

    acoes.push({
      codigo: pegar(l, c.id),
      // O banco limita o título a 200. Cortar aqui, e não deixar o insert
      // falhar depois da revisão inteira, com erro de constraint.
      titulo: titulo.slice(0, 200),
      detalhe: montarDetalhe(l, c),
      pilar: pegar(l, c.pilar),
      responsavel_nome: responsavel && responsavel.length >= 2 ? responsavel : null,
      prazo,
      prazo_original: prazoOriginal,
      faltando,
    });
  }

  if (acoes.length === 0) {
    avisos.push('Achei a tabela, mas nenhuma linha tinha o campo "O quê?" preenchido.');
  }

  const semPrazo = acoes.filter((a) => a.faltando.includes('prazo')).length;
  if (semPrazo > 0) {
    avisos.push(
      `${semPrazo} ${semPrazo === 1 ? 'ação está' : 'ações estão'} sem data completa — ` +
        'o relatório trazia período ou texto. Preencha o prazo antes de salvar.',
    );
  }

  return { acoes, contexto: extrairContexto(markdown), avisos };
}
