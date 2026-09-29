/**
 * Os documentos que um banco pede para analisar crédito de PJ.
 *
 * =====================================================================
 * CATÁLOGO EM CÓDIGO, NÃO EM TABELA
 * =====================================================================
 * Mesma escolha do `PROCESSOS` do vigia. A lista muda por decisão de
 * negócio, não por operação do dia a dia — e catálogo em tabela vira
 * tela de cadastro que alguém precisa manter, com o risco de um item
 * sumir sem ninguém notar. Aqui ele é versionado junto com o código e
 * tem teste.
 *
 * =====================================================================
 * O GRUPO DO IMÓVEL SÓ APARECE SE HOUVER IMÓVEL
 * =====================================================================
 * Garantia real é opcional: boa parte das operações de capital de giro
 * não tem. Mostrar sete documentos de imóvel para quem não vai dar
 * imóvel nenhum faz a lista parecer impossível, e lista impossível é
 * abandonada na primeira tela.
 *
 * =====================================================================
 * OBRIGATÓRIO É O QUE TRAVA A ANÁLISE
 * =====================================================================
 * `obrigatorio: false` não significa dispensável — significa que a
 * análise começa sem ele. A distinção existe para o cliente saber por
 * onde começar quando tem meia hora, e não para ele achar que metade da
 * lista é enfeite.
 *
 * Isso é diferente do grupo do IMÓVEL ser opcional. Lá a condição é do
 * grupo inteiro, não de cada item: boa parte das operações de capital de
 * giro não tem garantia real, e para essas o grupo simplesmente não
 * existe. Quando existe, seus itens valem pelo que cada um diz —
 * matrícula é obrigatória, laudo continua sendo um adiantamento útil.
 * Quem decide isso é `calcularProgresso`, pelo parâmetro `temImovel`.
 */

export type Grupo = 'empresa' | 'socios' | 'imovel';

export interface ItemDocumento {
  /** Estável. É a chave no banco e no nome do arquivo — não renomeie. */
  chave: string;
  grupo: Grupo;
  titulo: string;
  /** O que é, em português de quem não é do ramo. */
  descricao: string;
  obrigatorio: boolean;
  /** Vários arquivos no mesmo item: três balanços, dois sócios. */
  multiplo: boolean;
}

export const GRUPOS: { grupo: Grupo; titulo: string; subtitulo: string }[] = [
  {
    grupo: 'empresa',
    titulo: 'Empresa',
    subtitulo: 'O que mostra o que a empresa é e como ela vem performando.',
  },
  {
    grupo: 'socios',
    titulo: 'Sócios',
    subtitulo: 'De cada sócio com participação relevante. O banco analisa quem assina.',
  },
  {
    grupo: 'imovel',
    titulo: 'Imóvel em garantia',
    subtitulo:
      'Preencha apenas se a operação tiver garantia real. Sem imóvel, pule este grupo inteiro — ele não entra na sua contagem.',
  },
];

export const DOCUMENTOS: ItemDocumento[] = [
  // ------------------------------------------------------------ EMPRESA
  {
    chave: 'contrato_social',
    grupo: 'empresa',
    titulo: 'Contrato social e últimas alterações',
    descricao:
      'O contrato consolidado, ou o original com todas as alterações. É o documento que prova quem pode assinar pela empresa.',
    obrigatorio: true,
    multiplo: true,
  },
  {
    chave: 'cartao_cnpj',
    grupo: 'empresa',
    titulo: 'Cartão CNPJ',
    descricao: 'Emitido no site da Receita Federal, atualizado. Leva menos de um minuto.',
    obrigatorio: true,
    multiplo: false,
  },
  {
    chave: 'balanco_dre',
    grupo: 'empresa',
    titulo: 'Balanço patrimonial e DRE dos três últimos exercícios',
    descricao:
      'Assinados pelo contador. São eles que mostram patrimônio e resultado — o centro da análise. Três anos permitem ver tendência, e não só uma foto.',
    obrigatorio: true,
    multiplo: true,
  },
  {
    chave: 'balancete',
    grupo: 'empresa',
    titulo: 'Balancete do ano corrente',
    descricao: 'O mais recente que o contador tiver fechado. Mostra como está o ano em curso.',
    obrigatorio: true,
    multiplo: false,
  },
  {
    chave: 'faturamento_24m',
    grupo: 'empresa',
    titulo: 'Declaração de faturamento dos últimos 24 meses',
    descricao:
      'Mês a mês, assinada pelo contador. Vinte e quatro meses mostram duas temporadas completas — é assim que o banco separa sazonalidade de queda real.',
    obrigatorio: true,
    multiplo: false,
  },
  {
    chave: 'extratos_bancarios',
    grupo: 'empresa',
    titulo: 'Extratos bancários dos últimos 6 meses',
    descricao:
      'De todas as contas da empresa, em PDF. É onde o banco confere se o que entra bate com o faturamento declarado.',
    obrigatorio: true,
    multiplo: true,
  },
  {
    chave: 'relacao_dividas',
    grupo: 'empresa',
    titulo: 'Relação de dívidas bancárias',
    descricao:
      'Banco, saldo devedor, parcela e prazo de cada operação em aberto. Uma planilha simples resolve.',
    obrigatorio: true,
    multiplo: false,
  },
  {
    chave: 'certidoes_negativas',
    grupo: 'empresa',
    titulo: 'Certidões negativas',
    descricao:
      'Federal, estadual, municipal e FGTS. Todas emitidas pela internet, sem custo.',
    obrigatorio: false,
    multiplo: true,
  },
  {
    chave: 'faturamento_declarado',
    grupo: 'empresa',
    titulo: 'Declaração de faturamento ou Simples Nacional',
    descricao:
      'PGDAS para optantes do Simples, ou ECF para lucro presumido e real. Do último exercício.',
    obrigatorio: false,
    multiplo: true,
  },

  // ------------------------------------------------------------- SÓCIOS
  {
    chave: 'socio_identidade',
    grupo: 'socios',
    titulo: 'RG e CPF, ou CNH',
    descricao: 'De cada sócio. A CNH vale pelos dois, se estiver válida.',
    obrigatorio: true,
    multiplo: true,
  },
  {
    chave: 'socio_residencia',
    grupo: 'socios',
    titulo: 'Comprovante de residência',
    descricao: 'Conta de luz, água ou telefone dos últimos três meses, no nome do sócio.',
    obrigatorio: true,
    multiplo: true,
  },
  {
    chave: 'socio_estado_civil',
    grupo: 'socios',
    titulo: 'Certidão de casamento ou nascimento',
    descricao:
      'Se casado, com o regime de bens. O cônjuge costuma precisar assinar a garantia.',
    obrigatorio: true,
    multiplo: true,
  },
  {
    chave: 'socio_imposto_renda',
    grupo: 'socios',
    titulo: 'Declaração de Imposto de Renda com recibo',
    descricao:
      'A última entregue, completa e com o recibo de entrega. É o que comprova o patrimônio pessoal.',
    obrigatorio: true,
    multiplo: true,
  },
  {
    chave: 'socio_bens',
    grupo: 'socios',
    titulo: 'Relação de bens do avalista',
    descricao:
      'Imóveis e veículos em nome do sócio, com valor estimado. Só se o IR não detalhar.',
    obrigatorio: false,
    multiplo: true,
  },

  // ------------------------------------------------------------- IMÓVEL
  {
    chave: 'imovel_matricula',
    grupo: 'imovel',
    titulo: 'Matrícula atualizada do imóvel',
    descricao:
      'Emitida pelo cartório de registro há no máximo 30 dias, com todas as averbações.',
    obrigatorio: true,
    multiplo: true,
  },
  {
    chave: 'imovel_iptu',
    grupo: 'imovel',
    titulo: 'IPTU do ano corrente',
    descricao: 'O carnê ou a consulta na prefeitura, mostrando o valor venal e a inscrição.',
    obrigatorio: true,
    multiplo: false,
  },
  {
    chave: 'imovel_negativa_debitos',
    grupo: 'imovel',
    titulo: 'Certidão negativa de débitos do imóvel',
    descricao: 'Da prefeitura. Prova que não há IPTU ou taxa em aberto sobre o bem.',
    obrigatorio: false,
    multiplo: false,
  },
  {
    chave: 'imovel_fotos',
    grupo: 'imovel',
    titulo: 'Fotos do imóvel',
    descricao:
      'Fachada, e o interior se for comercial. Ajudam na avaliação antes da visita do perito.',
    obrigatorio: false,
    multiplo: true,
  },
  {
    chave: 'imovel_laudo',
    grupo: 'imovel',
    titulo: 'Laudo de avaliação, se já houver',
    descricao:
      'Se o imóvel foi avaliado nos últimos 12 meses, o laudo adianta a análise. Sem ele, o banco faz a própria.',
    obrigatorio: false,
    multiplo: false,
  },
];

/* ==================================================================== */

export function documentosDoGrupo(grupo: Grupo): ItemDocumento[] {
  return DOCUMENTOS.filter((d) => d.grupo === grupo);
}

export function acharDocumento(chave: string): ItemDocumento | null {
  return DOCUMENTOS.find((d) => d.chave === chave) ?? null;
}

export interface Progresso {
  /** Itens obrigatórios entregues, fora o grupo do imóvel quando não há. */
  obrigatoriosEntregues: number;
  obrigatoriosTotal: number;
  /** Inteiro de 0 a 100. É o que a tela mostra como barra. */
  pct: number;
  completo: boolean;
  /** O que ainda falta, na ordem do catálogo. Para cobrar com precisão. */
  faltando: ItemDocumento[];
}

/**
 * Quanto do dossiê já está de pé.
 *
 * O grupo do imóvel entra na conta apenas quando a operação tem garantia
 * real. Sem isso, um cliente que entregou tudo o que lhe cabia veria
 * "68% concluído" para sempre e concluiria que o sistema está errado —
 * ou pior, que ele ainda deve alguma coisa.
 */
export function calcularProgresso(
  chavesEntregues: string[],
  temImovel: boolean,
): Progresso {
  const entregues = new Set(chavesEntregues);

  const exigidos = DOCUMENTOS.filter(
    (d) => d.obrigatorio && (temImovel || d.grupo !== 'imovel'),
  );

  const faltando = exigidos.filter((d) => !entregues.has(d.chave));
  const entreguesCount = exigidos.length - faltando.length;

  return {
    obrigatoriosEntregues: entreguesCount,
    obrigatoriosTotal: exigidos.length,
    pct: exigidos.length === 0 ? 0 : Math.round((entreguesCount / exigidos.length) * 100),
    completo: faltando.length === 0,
    faltando,
  };
}
