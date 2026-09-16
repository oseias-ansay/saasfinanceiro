/**
 * O relatório escrito por código, sem modelo de linguagem.
 *
 * =====================================================================
 * POR QUE ISTO EXISTE
 * =====================================================================
 * A régua sempre foi código — score, indicadores, alertas e pilares saem
 * de `regua.ts` sem tocar em IA nenhuma. O modelo só redigia cinco
 * campos de texto, e cobrava R$ 0,87 por relatório para fazer isso, com
 * dois a cinco minutos de espera e a possibilidade de devolver algo que
 * não passa na validação.
 *
 * Para o diagnóstico gratuito e o de evento, onde o volume é alto e o
 * lead não foi qualificado, isso não se paga. Aqui o texto sai em
 * milissegundos, de graça, e sempre igual — o que também significa
 * testável.
 *
 * =====================================================================
 * A REGRA QUE SEPARA TEMPLATE DE CARTA-MODELO
 * =====================================================================
 * **Toda frase carrega um número do cliente.**
 *
 * "Sua margem está baixa" é carta-modelo, e dez clientes percebem. "Sua
 * margem líquida de 6,2% está abaixo dos 10% que sustentam reinvestimento"
 * é sobre aquela empresa, mesmo com o esqueleto compartilhado.
 *
 * Não é estilo: é a única coisa que faz um relatório determinístico não
 * parecer formulário. Quem for mexer nos textos abaixo, mantenha.
 *
 * =====================================================================
 * O QUE NÃO DÁ PARA FAZER AQUI
 * =====================================================================
 * Ler o campo `observacoes`, onde o cliente escreve com as próprias
 * palavras. Código não interpreta texto livre. Ele é citado no relatório
 * sem análise — ver `redigirComercial`.
 */

import type { ResultadoRegua, Alerta } from '../regua/regua.js';
import type { ResultadoComercial, CriterioComercial } from '../regua/regua-comercial.js';
import type { AnaliseComercial, AnaliseFinanceira } from './analise.js';

/* ==================================================================== */
/* Formatação dos números que entram nas frases                          */
/* ==================================================================== */

const n2 = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** O valor de um alerta, já com unidade, pronto para entrar na frase. */
export function valorFormatado(a: Alerta): string {
  if (a.valor === null) return 'sem dados';
  switch (a.unidade) {
    case '%':
      return `${n2(a.valor)}%`;
    case 'dias':
      return `${n2(a.valor)} dias`;
    case 'meses':
      return `${n2(a.valor)} ${a.valor === 1 ? 'mês' : 'meses'}`;
    case 'x':
      return `${n2(a.valor)}x`;
    case 'R$':
      return a.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    default:
      return n2(a.valor);
  }
}

/* ==================================================================== */
/* Os textos — diagnóstico financeiro                                    */
/* ==================================================================== */

/**
 * `v` é o valor já formatado com unidade — "6,2%", "85 dias".
 * `n` é o número cru, para quando o texto precisa mudar de sentido
 * conforme o sinal. A maioria dos blocos ignora o segundo.
 */
type Frase = (v: string, n: number) => string;

interface TextoIndicador {
  pilar: string;
  vermelho: { gargalo: Frase; acao: Frase };
  amarelo?: { gargalo: Frase; acao: Frase };
}

/**
 * Um bloco por indicador da régua.
 *
 * As chaves batem exatamente com `Alerta.indicador` em `regua.ts`. Se
 * alguém renomear um indicador lá sem mexer aqui, o teste
 * "todo indicador tem texto" quebra — que é o ponto dele.
 */
export const TEXTOS_FINANCEIRO: Record<string, TextoIndicador> = {
  'Margem de Contribuição (líquida de impostos)': {
    pilar: 'Lucratividade',
    vermelho: {
      gargalo: (v) =>
        `Margem de contribuição de ${v}: o que sobra de cada venda depois de impostos e custos variáveis não cobre a estrutura com folga.`,
      acao: (v) =>
        `Revisar preço e custo dos três produtos de maior volume. Com margem de contribuição em ${v}, cada ponto percentual ganho aqui vale mais que qualquer corte de despesa fixa.`,
    },
    amarelo: {
      gargalo: (v) => `Margem de contribuição de ${v}, abaixo do patamar confortável de 40%.`,
      acao: (v) =>
        `Mapear os itens de menor margem e testar reajuste. Sair de ${v} para 40% muda a conta do ponto de equilíbrio.`,
    },
  },

  'Margem Líquida': {
    pilar: 'Lucratividade',
    vermelho: {
      gargalo: (v) =>
        `Margem líquida de ${v}. Na prática, de cada R$ 100 vendidos sobram menos de R$ 4 — e é desse valor que sai qualquer investimento.`,
      acao: (v) =>
        `Definir meta de margem líquida e acompanhar mês a mês. Partindo de ${v}, o caminho mais curto costuma ser preço, não volume.`,
    },
    amarelo: {
      gargalo: (v) => `Margem líquida de ${v}, ainda distante dos 10% que sustentam crescimento.`,
      acao: (v) =>
        `Comparar a margem de ${v} com a de dois concorrentes diretos antes de decidir entre subir preço ou cortar custo.`,
    },
  },

  'Margem de Segurança': {
    pilar: 'Lucratividade',
    vermelho: {
      // Negativo e positivo-baixo são situações diferentes, e chamar as
      // duas de "perto do ponto de equilíbrio" seria falso na primeira:
      // quem está em −76% não está perto, está abaixo, e já fechou o mês
      // no vermelho.
      gargalo: (v, n) =>
        n < 0
          ? `Margem de segurança de ${v}: o faturamento está ABAIXO do ponto de equilíbrio. Nas condições atuais, o mês fecha no prejuízo independentemente de esforço comercial.`
          : `Margem de segurança de ${v}: o faturamento está perto do ponto de equilíbrio, e uma queda pequena nas vendas leva o mês ao prejuízo.`,
      acao: (v, n) =>
        n < 0
          ? `Calcular quanto falta para chegar ao ponto de equilíbrio e tratar esse número como meta mínima. Com ${v}, aumentar faturamento e cortar despesa fixa precisam acontecer ao mesmo tempo.`
          : `Calcular o ponto de equilíbrio e afixá-lo como meta mínima do mês. Com ${v} de folga, saber o número é mais urgente que aumentá-lo.`,
    },
    amarelo: {
      gargalo: (v) => `Margem de segurança de ${v} — folga estreita para um mês fraco.`,
      acao: () =>
        'Acompanhar semanalmente o quanto falta para o ponto de equilíbrio, em vez de descobrir no fechamento.',
    },
  },

  'Peso das Despesas Fixas': {
    pilar: 'Lucratividade',
    vermelho: {
      gargalo: (v) =>
        `Despesas fixas consomem ${v} do faturamento. Acima de 40%, a estrutura passa a mandar no resultado.`,
      acao: (v) =>
        `Listar as cinco maiores despesas fixas e questionar cada uma. Reduzir de ${v} para 25% do faturamento é o ganho mais duradouro disponível.`,
    },
    amarelo: {
      gargalo: (v) => `Despesas fixas em ${v} do faturamento, acima do confortável.`,
      acao: (v) => `Congelar novas despesas fixas até o peso cair de ${v} para 25%.`,
    },
  },

  'Ciclo Financeiro': {
    pilar: 'Liquidez',
    vermelho: {
      gargalo: (v) =>
        `Ciclo financeiro de ${v}: é o tempo em que a empresa paga o fornecedor e ainda não recebeu do cliente. Esse intervalo é financiado com capital próprio ou com juros.`,
      acao: (v) =>
        `Negociar prazo com os três maiores fornecedores e reduzir o prazo de recebimento. Cada dia cortado dos ${v} devolve caixa sem vender nada a mais.`,
    },
    amarelo: {
      gargalo: (v) => `Ciclo financeiro de ${v}, acima do ideal de 30 dias.`,
      acao: () => 'Antecipar cobrança e revisar condições de parcelamento oferecidas ao cliente.',
    },
  },

  'Reserva Operacional': {
    pilar: 'Liquidez',
    vermelho: {
      gargalo: (v) =>
        `Reserva operacional de ${v}. É quanto tempo a empresa se mantém de portas abertas sem faturar nada.`,
      acao: (v) =>
        `Definir meta de reserva de 3 meses e separar um percentual fixo do faturamento todo mês. Partir de ${v} é o ponto mais frágil de qualquer plano.`,
    },
    amarelo: {
      gargalo: (v) => `Reserva operacional de ${v} — abaixo dos 3 meses recomendados.`,
      acao: () => 'Separar mensalmente um percentual do faturamento em conta apartada até chegar a 3 meses.',
    },
  },

  'Cobertura de Caixa': {
    pilar: 'Liquidez',
    vermelho: {
      gargalo: (v) =>
        `Cobertura de caixa de ${v}: o saldo disponível cobre menos de um mês de desembolso.`,
      acao: (v) =>
        `Montar o fluxo de caixa semanal das próximas 8 semanas. Com ${v} de cobertura, visibilidade vale mais que qualquer outra medida.`,
    },
    amarelo: {
      gargalo: (v) => `Cobertura de caixa de ${v}, abaixo dos 60 dias confortáveis.`,
      acao: () => 'Manter o fluxo de caixa projetado sempre com 90 dias à frente.',
    },
  },

  'Folga de Capital de Giro': {
    pilar: 'Liquidez',
    vermelho: {
      gargalo: (v) =>
        `Folga de capital de giro negativa em ${v}: a necessidade de giro é maior que o caixa disponível, e a diferença está sendo coberta por dívida.`,
      acao: () =>
        'Atacar o ciclo financeiro antes de buscar crédito. Capital de giro tomado no banco resolve o sintoma e aumenta o custo.',
    },
  },

  Inadimplência: {
    pilar: 'Liquidez',
    vermelho: {
      gargalo: (v) =>
        `Inadimplência de ${v}. Acima de 5%, a venda registrada não vira caixa e a margem some no meio do caminho.`,
      acao: (v) =>
        `Implantar régua de cobrança com contato em D+1, D+7 e D+15. Sair de ${v} para 2% recupera receita já conquistada.`,
    },
    amarelo: {
      gargalo: (v) => `Inadimplência de ${v}, acima dos 2% aceitáveis.`,
      acao: () => 'Padronizar a cobrança dos primeiros 15 dias, que é onde a recuperação é mais alta.',
    },
  },

  'Comprometimento da Receita com Dívidas': {
    pilar: 'Endividamento',
    vermelho: {
      gargalo: (v) =>
        `${v} do faturamento vai para parcelas de dívida antes de qualquer despesa operacional.`,
      acao: (v) =>
        `Levantar todos os contratos com taxa e prazo, e buscar alongamento ou portabilidade. Com ${v} comprometidos, renegociar tem efeito imediato no caixa.`,
    },
    amarelo: {
      gargalo: (v) => `${v} do faturamento comprometidos com dívida — acima dos 10% seguros.`,
      acao: () => 'Evitar novas linhas de crédito até o comprometimento cair abaixo de 10%.',
    },
  },

  'Endividamento sobre Faturamento Anual': {
    pilar: 'Endividamento',
    vermelho: {
      gargalo: (v) =>
        `Endividamento equivalente a ${v} do faturamento de um ano. Acima de 60%, a capacidade de pagamento fica em xeque.`,
      acao: () =>
        'Montar um plano de amortização com prazo definido, priorizando as linhas de maior custo.',
    },
    amarelo: {
      gargalo: (v) => `Endividamento em ${v} do faturamento anual.`,
      acao: () => 'Amortizar antecipadamente a dívida mais cara sempre que houver sobra de caixa.',
    },
  },

  'Composição do Endividamento (curto prazo)': {
    pilar: 'Endividamento',
    vermelho: {
      gargalo: (v) =>
        `${v} da dívida vence em menos de um ano. Concentração no curto prazo é o que transforma endividamento em problema de caixa.`,
      acao: (v) =>
        `Buscar alongamento de prazo com os credores. Com ${v} no curto prazo, ganhar tempo vale mais que reduzir taxa.`,
    },
    amarelo: {
      gargalo: (v) => `${v} da dívida concentrada no curto prazo.`,
      acao: () => 'Ao contratar crédito novo, priorizar prazo longo mesmo com taxa um pouco maior.',
    },
  },

  'Cobertura de Juros': {
    pilar: 'Endividamento',
    vermelho: {
      gargalo: (v) =>
        `Cobertura de juros de ${v}: o lucro mal cobre o custo da dívida, e qualquer mês pior vira inadimplência própria.`,
      acao: () =>
        'Renegociar taxa é prioridade máxima. Sem isso, o resultado operacional é consumido pelo banco.',
    },
    amarelo: {
      gargalo: (v) => `Cobertura de juros de ${v}, abaixo das 3x confortáveis.`,
      acao: () => 'Comparar as taxas atuais com as praticadas hoje no mercado e buscar portabilidade.',
    },
  },

  'Concentração de Clientes': {
    pilar: 'Governança',
    vermelho: {
      gargalo: (v) =>
        `O maior cliente representa ${v} da receita. Perdê-lo não é um risco comercial, é um risco de continuidade.`,
      acao: (v) =>
        `Definir meta de prospecção para reduzir a concentração de ${v} para menos de 20%, com prazo e responsável.`,
    },
    amarelo: {
      gargalo: (v) => `O maior cliente responde por ${v} da receita.`,
      acao: () => 'Acompanhar a concentração mensalmente e tratar qualquer alta como sinal de alerta.',
    },
  },

  'Divergência da DRE': {
    pilar: 'Governança',
    vermelho: {
      gargalo: (v) =>
        `Divergência de ${v} entre o lucro informado e o calculado a partir das próprias contas. Enquanto os números não fecham, nenhuma decisão tomada sobre eles é confiável.`,
      acao: () =>
        'Conferir a classificação das despesas e separar o que é custo variável do que é despesa fixa. É a correção que destrava todos os outros indicadores.',
    },
    amarelo: {
      gargalo: (v) => `Divergência de ${v} entre o lucro informado e o calculado.`,
      acao: () => 'Revisar o fechamento do mês para eliminar a diferença antes do próximo diagnóstico.',
    },
  },
};

/* ==================================================================== */
/* Os textos — diagnóstico comercial                                     */
/* ==================================================================== */

/**
 * A régua comercial já entrega `oportunidades`: os critérios ordenados
 * pelos pontos perdidos. Aqui só se dá voz a eles.
 */
export const TEXTOS_COMERCIAL: Record<string, { gargalo: string; acao: string }> = {
  'Uso de CRM': {
    gargalo:
      'A operação comercial não registra o histórico de cada negociação em um lugar só. Sem isso, o que o vendedor sabe sai da empresa junto com ele.',
    acao: 'Implantar um CRM simples e tornar obrigatório o registro de toda oportunidade. Comece pelo básico: contato, etapa e próxima ação.',
  },
  'Etapas do funil definidas': {
    gargalo:
      'Não há etapas definidas entre o primeiro contato e o fechamento. Sem elas, não se sabe onde o cliente para — só que não comprou.',
    acao: 'Desenhar de quatro a seis etapas do funil com critério objetivo de passagem entre cada uma.',
  },
  'Métricas do funil': {
    gargalo:
      'O funil não é medido. Taxa de conversão por etapa é o que separa "vender mais" de saber onde atacar.',
    acao: 'Medir semanalmente quantos entram e quantos passam em cada etapa. A etapa de maior perda é onde está o dinheiro.',
  },
  'Previsibilidade de leads': {
    gargalo:
      'A entrada de leads é irregular. Mês bom e mês ruim viram sorte, e a equipe oscila junto.',
    acao: 'Estabelecer uma fonte recorrente de geração de demanda, com verba e meta mensal de leads.',
  },
  'Origem dos leads': {
    gargalo:
      'A origem dos leads é concentrada demais. Depender de um canal só é depender de algo que você não controla.',
    acao: 'Abrir um segundo canal de aquisição e acompanhar separadamente o volume e a conversão de cada um.',
  },
  'Monitoramento do CAC': {
    gargalo:
      'O custo de aquisição de cliente não é acompanhado. Sem ele, não há como saber se crescer está dando lucro ou prejuízo.',
    acao: 'Calcular o CAC mensalmente — investimento total em marketing e vendas dividido pelos clientes conquistados — e compará-lo ao ticket médio.',
  },
  'Acompanhamento de metas': {
    gargalo:
      'As metas não são acompanhadas com frequência suficiente. Meta conferida só no fim do mês não é meta, é diagnóstico tardio.',
    acao: 'Instituir acompanhamento semanal de meta por vendedor, com número visível para o time.',
  },
  'Estrutura da equipe': {
    gargalo:
      'A estrutura da equipe comercial não está definida em papéis claros. Todo mundo fazendo tudo é o que trava o crescimento depois do primeiro vendedor.',
    acao: 'Separar prospecção de fechamento, ainda que nas mesmas pessoas, com tempo dedicado a cada função.',
  },
  'Modelo de remuneração': {
    gargalo:
      'O modelo de remuneração não liga o ganho do vendedor ao resultado da empresa.',
    acao: 'Revisar a composição entre fixo e variável, com o variável atrelado a margem e não só a faturamento.',
  },
  'Cross-sell e up-sell': {
    gargalo:
      'Não há estratégia ativa de aumento de ticket. Vender mais para quem já comprou é sempre mais barato que conquistar cliente novo.',
    acao: 'Definir uma oferta complementar padrão e treiná-la como parte do processo de venda, não como iniciativa individual.',
  },
  'Pós-venda e retenção': {
    gargalo:
      'O pós-venda é reativo. Cliente que some sem reclamar é receita perdida sem nenhum aviso.',
    acao: 'Criar uma rotina de contato pós-venda com prazo definido, e medir a taxa de recompra.',
  },
};

/* ==================================================================== */
/* Montagem                                                              */
/* ==================================================================== */

const NIVEL_RESUMO: Array<{ min: number; texto: (s: string, n: string) => string }> = [
  {
    min: 85,
    texto: (s, n) =>
      `Com score ${s}, a empresa está classificada como ${n}. Os fundamentos estão em ordem e o foco passa a ser proteger o que funciona e escalar com método.`,
  },
  {
    min: 70,
    texto: (s, n) =>
      `Com score ${s}, a empresa está classificada como ${n}. A base é sólida, mas há pontos específicos que, corrigidos, destravam o próximo patamar.`,
  },
  {
    min: 41,
    texto: (s, n) =>
      `Com score ${s}, a empresa está classificada como ${n}. Os números mostram uma operação que funciona no dia a dia e ainda não é previsível — o que aparece abaixo é a diferença entre as duas coisas.`,
  },
  {
    min: 0,
    texto: (s, n) =>
      `Com score ${s}, a empresa está classificada como ${n}. Há pontos que exigem atenção imediata, e a ordem em que forem tratados importa mais que a velocidade.`,
  },
];

const resumoDoNivel = (score: number, nivel: string) =>
  (NIVEL_RESUMO.find((f) => score >= f.min) ?? NIVEL_RESUMO[NIVEL_RESUMO.length - 1]!).texto(
    String(score),
    nivel,
  );

/** Faixa de aproveitamento de um pilar, para escolher o tom da avaliação. */
function faixaDoPilar(pontos: number, max: number): 'forte' | 'atencao' | 'critico' {
  const pct = max > 0 ? (pontos / max) * 100 : 0;
  if (pct >= 70) return 'forte';
  if (pct >= 40) return 'atencao';
  return 'critico';
}

/**
 * @param ehPior  Só UM pilar recebe "é onde está a maior perda".
 *
 * Sem esse controle, uma empresa com os quatro pilares no vermelho
 * recebia a mesma frase quatro vezes, cada uma afirmando ser a maior
 * perda. O relatório se contradizia em quatro parágrafos seguidos — e
 * texto que se contradiz é a forma mais rápida de perder a confiança de
 * quem lê.
 */
function textoDoPilar(
  nome: string,
  pontos: number,
  max: number,
  criticos: string[],
  ehPior: boolean,
): string {
  const faixa = faixaDoPilar(pontos, max);
  const nota = `${pontos} de ${max} pontos`;

  const lista = criticos.length
    ? ` O que puxa para baixo: ${criticos.slice(0, 3).join('; ')}.`
    : '';

  if (faixa === 'forte') {
    return `${nome}: ${nota}. É um dos pontos resolvidos do diagnóstico e não demanda ação imediata — serve de referência para os demais.`;
  }

  if (faixa === 'atencao') {
    return `${nome}: ${nota}. Funciona, mas com pontos que limitam o resultado.${lista}`;
  }

  return ehPior
    ? `${nome}: ${nota}. É aqui que está a maior perda do diagnóstico, e é por onde o plano de ação começa.${lista}`
    : `${nome}: ${nota}. Exige correção, e o aproveitamento baixo compromete o score total.${lista}`;
}

/** Qual pilar tem o pior aproveitamento. Empate: o primeiro da lista. */
function piorPilar(pilares: Array<{ chave: string; pontos: number; max: number }>): string {
  return pilares.reduce((pior, p) =>
    (p.max > 0 ? p.pontos / p.max : 1) < (pior.max > 0 ? pior.pontos / pior.max : 1) ? p : pior,
  ).chave;
}

/* ==================================================================== */
/* Financeiro                                                            */
/* ==================================================================== */

export function redigirFinanceiro(r: ResultadoRegua): AnaliseFinanceira {
  const comTexto = (a: Alerta) => TEXTOS_FINANCEIRO[a.indicador];

  // Vermelhos antes dos amarelos: a ordem da lista é a ordem de ataque.
  const vermelhos = r.alertas.filter((a) => a.status === 'vermelho' && comTexto(a));
  const amarelos = r.alertas.filter((a) => a.status === 'amarelo' && comTexto(a)?.amarelo);

  const frase = (a: Alerta, tipo: 'gargalo' | 'acao') => {
    const t = TEXTOS_FINANCEIRO[a.indicador]!;
    const bloco = a.status === 'vermelho' ? t.vermelho : t.amarelo!;
    return bloco[tipo](valorFormatado(a), a.valor ?? 0);
  };

  const gargalos = [...vermelhos, ...amarelos].slice(0, 8).map((a) => frase(a, 'gargalo'));

  const planoDeAcao = [...vermelhos, ...amarelos].slice(0, 12).map((a) => ({
    prioridade: (a.status === 'vermelho' ? 'Alta' : 'Média') as 'Alta' | 'Média' | 'Baixa',
    pilar: TEXTOS_FINANCEIRO[a.indicador]!.pilar,
    acaoRecomendada: frase(a, 'acao'),
  }));

  // Quando nada está vermelho nem amarelo, ainda é preciso entregar ao
  // menos um item: o schema exige, e um relatório sem próximo passo não
  // é diagnóstico, é elogio.
  if (!gargalos.length) {
    gargalos.push(
      `Nenhum indicador em zona crítica. Com score ${r.score.scoreTotal}, o risco deixa de ser operacional e passa a ser de acomodação.`,
    );
  }
  if (!planoDeAcao.length) {
    planoDeAcao.push({
      prioridade: 'Média',
      pilar: 'Governança',
      acaoRecomendada:
        'Manter o acompanhamento mensal dos indicadores e repetir este diagnóstico em 90 dias para medir a evolução, não o nível.',
    });
  }

  const criticosDo = (pilar: string) =>
    vermelhos
      .filter((a) => TEXTOS_FINANCEIRO[a.indicador]!.pilar === pilar)
      .map((a) => `${a.indicador} em ${valorFormatado(a)}`);

  const p = r.score.pilares;
  const pior = piorPilar([
    { chave: 'lucratividade', pontos: p.lucratividade.pontos, max: p.lucratividade.max },
    { chave: 'liquidez', pontos: p.liquidez.pontos, max: p.liquidez.max },
    { chave: 'endividamento', pontos: p.endividamento.pontos, max: p.endividamento.max },
    { chave: 'governanca', pontos: p.governanca.pontos, max: p.governanca.max },
  ]);

  const avaliacoes = {
    lucratividade: textoDoPilar('Lucratividade e eficiência', p.lucratividade.pontos, p.lucratividade.max, criticosDo('Lucratividade'), pior === 'lucratividade'),
    liquidez: textoDoPilar('Liquidez e capital de giro', p.liquidez.pontos, p.liquidez.max, criticosDo('Liquidez'), pior === 'liquidez'),
    endividamento: textoDoPilar('Endividamento e risco', p.endividamento.pontos, p.endividamento.max, criticosDo('Endividamento'), pior === 'endividamento'),
    governanca: textoDoPilar('Governança e organização', p.governanca.pontos, p.governanca.max, criticosDo('Governança'), pior === 'governanca'),
  };

  const piores = vermelhos.slice(0, 2).map((a) => `${a.indicador} em ${valorFormatado(a)}`);

  const resumoExecutivo =
    resumoDoNivel(r.score.scoreTotal, r.score.nivelSaude) +
    (piores.length
      ? ` Os dois pontos de maior impacto hoje são ${piores.join(' e ')}. O plano de ação começa por eles porque destravam os demais.`
      : ' Nenhum indicador está em zona crítica, e o plano abaixo trata de consolidação.');

  return {
    resumoExecutivo,
    avaliacoes,
    gargalosIdentificados: gargalos,
    planoDeAcao,
    relatorioDetalhadoHtml: montarRelatorio({
      resumoExecutivo,
      avaliacoes: Object.values(avaliacoes),
      gargalos,
      tabela: r.tabela_alertas,
    }),
  };
}

/* ==================================================================== */
/* Comercial                                                             */
/* ==================================================================== */

export function redigirComercial(r: ResultadoComercial): AnaliseComercial {
  const comTexto = (c: CriterioComercial) => TEXTOS_COMERCIAL[c.criterio];

  // `oportunidades` já vem ordenado por pontos perdidos — a régua fez o
  // trabalho de priorização, e refazê-lo aqui só criaria divergência.
  const perdas = r.oportunidades.filter(comTexto);

  const gargalos = perdas.slice(0, 8).map((c) => TEXTOS_COMERCIAL[c.criterio]!.gargalo);

  const planoDeAcao = perdas.slice(0, 12).map((c) => ({
    // A prioridade sai do tamanho da perda, não de opinião: quem custa
    // mais pontos entra primeiro.
    prioridade: (c.perdido >= 8 ? 'Alta' : c.perdido >= 4 ? 'Média' : 'Baixa') as
      | 'Alta'
      | 'Média'
      | 'Baixa',
    pilar: c.pilar,
    acaoRecomendada: TEXTOS_COMERCIAL[c.criterio]!.acao,
  }));

  if (!gargalos.length) {
    gargalos.push(
      `Nenhum critério com perda relevante. Com score ${r.score.scoreTotal}, o próximo ganho vem de escala, não de correção.`,
    );
  }
  if (!planoDeAcao.length) {
    planoDeAcao.push({
      prioridade: 'Média',
      pilar: 'Estrutura, Processo e Funil',
      acaoRecomendada:
        'Manter a medição do funil e repetir o diagnóstico em 90 dias para acompanhar a evolução.',
    });
  }

  const criticosDo = (pilar: string) =>
    perdas.filter((c) => c.pilar === pilar).map((c) => `${c.criterio} (−${c.perdido} pontos)`);

  const p = r.score.pilares;
  const pior = piorPilar([
    { chave: 'processoEFunil', pontos: p.processoEFunil.pontos, max: p.processoEFunil.max },
    { chave: 'geracaoDemanda', pontos: p.geracaoDemanda.pontos, max: p.geracaoDemanda.max },
    { chave: 'gestaoEEquipe', pontos: p.gestaoEEquipe.pontos, max: p.gestaoEEquipe.max },
    { chave: 'posVendaETicket', pontos: p.posVendaETicket.pontos, max: p.posVendaETicket.max },
  ]);

  const avaliacoes = {
    processoEFunil: textoDoPilar('Estrutura, processo e funil', p.processoEFunil.pontos, p.processoEFunil.max, criticosDo('Estrutura, Processo e Funil'), pior === 'processoEFunil'),
    geracaoDemanda: textoDoPilar('Atração e geração de demanda', p.geracaoDemanda.pontos, p.geracaoDemanda.max, criticosDo('Atração e Geração de Demanda'), pior === 'geracaoDemanda'),
    gestaoEEquipe: textoDoPilar('Equipe, metas e gestão', p.gestaoEEquipe.pontos, p.gestaoEEquipe.max, criticosDo('Equipe, Metas e Gestão'), pior === 'gestaoEEquipe'),
    posVendaETicket: textoDoPilar('Ticket médio e pós-venda', p.posVendaETicket.pontos, p.posVendaETicket.max, criticosDo('Ticket Médio e Pós-Venda'), pior === 'posVendaETicket'),
  };

  const piores = perdas.slice(0, 2).map((c) => c.criterio.toLowerCase());

  let resumoExecutivo =
    resumoDoNivel(r.score.scoreTotal, r.score.nivelMaturidade) +
    (piores.length
      ? ` As duas maiores perdas estão em ${piores.join(' e ')}, e é por elas que o plano começa.`
      : '');

  if (r.contexto.alerta_cac) {
    resumoExecutivo += ` ${r.contexto.alerta_cac}`;
  }

  return {
    resumoExecutivo,
    avaliacoes,
    gargalosCriticos: gargalos,
    planoDeAcao,
    relatorioDetalhadoHtml: montarRelatorio({
      resumoExecutivo,
      avaliacoes: Object.values(avaliacoes),
      gargalos,
      tabela: r.tabela_criterios,
      // O texto livre do cliente é CITADO, nunca interpretado: código não
      // lê prosa, e fingir que leu produziria análise sobre nada.
      observacoes: r.contexto.observacoes,
    }),
  };
}

/* ==================================================================== */
/* O corpo do relatório                                                  */
/* ==================================================================== */

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function montarRelatorio(d: {
  resumoExecutivo: string;
  avaliacoes: string[];
  gargalos: string[];
  tabela: string;
  observacoes?: string | null;
}): string {
  const p = (t: string) => `<p style="margin:0 0 12px;">${esc(t)}</p>`;

  return [
    '<div style="font-family:Arial,sans-serif;color:#334155;line-height:1.6;">',
    '<h2 style="color:#0B1E3B;margin:0 0 12px;">Leitura geral</h2>',
    p(d.resumoExecutivo),
    '<h2 style="color:#0B1E3B;margin:24px 0 12px;">Análise por pilar</h2>',
    ...d.avaliacoes.map(p),
    '<h2 style="color:#0B1E3B;margin:24px 0 12px;">Onde está a maior perda</h2>',
    `<ul style="margin:0 0 12px;padding-left:20px;">${d.gargalos.map((g) => `<li style="margin-bottom:8px;">${esc(g)}</li>`).join('')}</ul>`,
    d.tabela ? `<h2 style="color:#0B1E3B;margin:24px 0 12px;">Indicadores</h2>${d.tabela}` : '',
    d.observacoes
      ? `<h2 style="color:#0B1E3B;margin:24px 0 12px;">O que você nos contou</h2>${p(d.observacoes)}<p style="margin:0;color:#64748B;font-size:13px;">Este ponto será tratado na conversa com o consultor.</p>`
      : '',
    '</div>',
  ]
    .filter(Boolean)
    .join('\n');
}
