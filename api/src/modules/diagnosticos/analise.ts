/**
 * A parte do diagnóstico que o modelo escreve.
 *
 * =====================================================================
 * O QUE É DA IA E O QUE NÃO É
 * =====================================================================
 * O score, os indicadores e a classificação são calculados por código
 * auditável — `regua.ts` e `regua-comercial.ts`, ambos com paridade
 * contra a produção anterior. Duas empresas com as mesmas respostas têm
 * de receber o mesmo número, hoje e daqui a um ano.
 *
 * O modelo INTERPRETA esses números e escreve. Não recalcula, não
 * contradiz, não inventa. Os prompts dizem isso em maiúsculas, e este
 * arquivo garante o resto: o que entra é montado aqui, e o que sai é
 * validado antes de virar PDF.
 *
 * =====================================================================
 * A PROMESSA DE PRIVACIDADE É CUMPRIDA AQUI, NÃO NO PROMPT
 * =====================================================================
 * A página de privacidade declara que razão social, CNPJ, e-mail e
 * telefone não são enviados ao modelo. Os prompts pedem isso ao modelo —
 * mas pedir não é garantir: quem monta a mensagem é o código, e um campo
 * a mais numa interpolação quebraria a promessa sem que ninguém
 * percebesse.
 *
 * Por isso `montarPrompt*` recebe apenas setor e mês de referência da
 * identificação, e `conferirPrivacidade` varre o texto final atrás de
 * CNPJ, e-mail e telefone antes de qualquer chamada. Há teste para as
 * duas coisas.
 */

import { z } from 'zod';
import type { ResultadoRegua } from '../regua/regua.js';
import type { ResultadoComercial } from '../regua/regua-comercial.js';

/* ==================================================================== */
/* O que o modelo precisa devolver                                       */
/* ==================================================================== */

/**
 * Validação estrita, e não tolerante, de propósito.
 *
 * O diagnóstico comercial vai ao prospect **sem revisão humana**. Um
 * campo faltando ou com o nome trocado vira um PDF torto na caixa de
 * entrada de alguém que nunca ouviu falar da empresa — e a primeira
 * impressão não tem segunda chance. Melhor falhar alto, alarmar, e
 * mandar o relatório com dez minutos de atraso.
 */
const acao = z.object({
  prioridade: z.enum(['Alta', 'Média', 'Baixa']),
  pilar: z.string().min(1).max(120),
  acaoRecomendada: z.string().min(10).max(2000),
});

const comum = {
  resumoExecutivo: z.string().min(40).max(4000),
  planoDeAcao: z.array(acao).min(1).max(12),
  relatorioDetalhadoHtml: z.string().min(200),
};

export const esquemaAnaliseFinanceira = z.object({
  ...comum,
  avaliacoes: z.object({
    lucratividade: z.string().min(20),
    liquidez: z.string().min(20),
    endividamento: z.string().min(20),
    governanca: z.string().min(20),
  }),
  gargalosIdentificados: z.array(z.string().min(10)).min(1).max(8),
});

export const esquemaAnaliseComercial = z.object({
  ...comum,
  avaliacoes: z.object({
    processoEFunil: z.string().min(20),
    geracaoDemanda: z.string().min(20),
    gestaoEEquipe: z.string().min(20),
    posVendaETicket: z.string().min(20),
  }),
  gargalosCriticos: z.array(z.string().min(10)).min(1).max(8),
});

export type AnaliseFinanceira = z.infer<typeof esquemaAnaliseFinanceira>;
export type AnaliseComercial = z.infer<typeof esquemaAnaliseComercial>;

/**
 * O modelo às vezes embrulha o JSON em ```json apesar da instrução.
 *
 * Tratar isso aqui em vez de insistir no prompt: é barato, determinístico
 * e não gasta uma segunda chamada paga para corrigir algo que uma linha
 * de código resolve.
 */
export function extrairJson(bruto: string): unknown {
  const limpo = bruto
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    return JSON.parse(limpo);
  } catch {
    // Última tentativa: o primeiro objeto completo do texto. Cobre o caso
    // em que o modelo escreveu uma frase antes do JSON.
    const i = limpo.indexOf('{');
    const j = limpo.lastIndexOf('}');
    if (i >= 0 && j > i) return JSON.parse(limpo.slice(i, j + 1));
    throw new Error('A resposta do modelo não contém JSON.');
  }
}

/* ==================================================================== */
/* A guarda de privacidade                                               */
/* ==================================================================== */

const PADROES: Array<[string, RegExp]> = [
  ['CNPJ', /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/],
  ['CPF', /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/],
  ['e-mail', /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/],
  ['telefone', /\b(?:\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/],
];

/**
 * Devolve o que foi encontrado de identificável no texto. Lista vazia é
 * o resultado esperado.
 *
 * A varredura é por padrão, não por campo: é o que pega o caso em que o
 * dado entra por onde ninguém esperava — o cliente escrevendo o próprio
 * CNPJ no campo de observações, por exemplo. Esse caso é real e o prompt
 * sozinho não o impediria, porque a instrução fala do que o modelo deve
 * ignorar, não do que ele recebe.
 */
export function conferirPrivacidade(texto: string): string[] {
  return PADROES.filter(([, re]) => re.test(texto)).map(([nome]) => nome);
}

/**
 * Apaga dado identificável de um campo de TEXTO LIVRE.
 *
 * Só do texto livre, nunca do prompt inteiro. O padrão de telefone tem
 * dez dígitos, e um faturamento de R$ 1.234.567.890 casaria com ele —
 * mascarar o prompt todo corromperia os números que o diagnóstico existe
 * para analisar. O único campo onde o cliente escreve livremente é
 * "observações", e é lá que o CNPJ aparece.
 *
 * Apagar, e não recusar: o cliente que escreveu o próprio cartão no
 * campo de observações não pode perder o diagnóstico por causa disso.
 */
export function limparTextoLivre(texto: string | null | undefined): string {
  if (!texto) return '';
  let saida = texto;
  for (const [nome, re] of PADROES) {
    saida = saida.replace(new RegExp(re.source, 'g'), `[${nome} removido]`);
  }
  return saida;
}

/* ==================================================================== */
/* Montagem dos prompts                                                  */
/* ==================================================================== */

/**
 * Só o que o modelo pode ver da identificação.
 *
 * O tipo é a primeira barreira: não existe campo para razão social nem
 * para CNPJ, então nem por engano alguém interpola um.
 */
export interface IdentificacaoPublica {
  setor?: string | null;
  mes_referencia?: string | null;
  num_funcionarios?: number | string | null;
  regime_tributario?: string | null;
}

const v = (x: unknown, padrao = 'não informado') =>
  x === null || x === undefined || x === '' ? padrao : String(x);

export function montarPromptComercial(
  id: IdentificacaoPublica,
  r: ResultadoComercial,
): string {
  const c = r.contexto;
  return `Você é um consultor e estrategista de vendas especialista em PMEs brasileiras, atuando pela Business Triage. Escreva sempre em português do Brasil, em linguagem prática que um dono de pequena empresa entenda.

A pontuação JÁ FOI CALCULADA por código auditável. Sua função é EXCLUSIVAMENTE interpretar e escrever. Não recalcule pontos, não altere o score, não contradiga a classificação.

# EMPRESA (sem dados identificáveis — ver regra de privacidade abaixo)
Setor: ${v(id.setor)}
Mês de referência: ${v(id.mes_referencia)}

# SCORE COMERCIAL JÁ CALCULADO
${JSON.stringify(r.score, null, 2)}

# PONTUAÇÃO CRITÉRIO A CRITÉRIO
${r.tabela_criterios}

# ONDE ESTÃO OS MAIORES GANHOS (ordenado por pontos perdidos)
${r.ranking_oportunidades}

Critérios zerados: ${r.criterios_zerados.join(', ') || 'nenhum'}

# CONTEXTO NÃO PONTUADO
Ciclo médio de vendas: ${c.ciclo_vendas_rotulo}
Canais de leads marcados: ${c.canais_leads.join(', ') || 'nenhum'}
Classificação da origem: ${c.origem_leads_rotulo}
Ticket médio: R$ ${c.ticket_medio}
CAC médio: ${c.cac_medio === null ? 'não calculado pela empresa' : `R$ ${c.cac_medio}`}
Relação ticket/CAC: ${c.relacao_ticket_cac === null ? 'indisponível' : `${c.relacao_ticket_cac}x`}
Leitura da relação ticket/CAC: ${c.alerta_cac || 'indisponível — a empresa não calcula CAC'}
Observações do cliente: ${limparTextoLivre(c.observacoes)}

# REGRAS INEGOCIÁVEIS
1. Use apenas as informações acima. Não invente números, metas ou benchmarks setoriais específicos.
2. Priorize sempre pelo ranking de pontos perdidos: o plano de ação deve atacar primeiro o que mais custa pontos e é mais rápido de destravar.
3. No campo planoDeAcao, nada de conselho genérico: diga qual etapa, qual ferramenta e em que prazo. ATENÇÃO: esse campo NÃO é entregue ao cliente — é o material de trabalho do consultor.
4. Cada avaliação de pilar deve explicar POR QUE a pontuação ficou naquele patamar, citando as respostas que a determinaram.
5. Se a relação ticket/CAC estiver abaixo de 1, isso é o gargalo número um, acima de qualquer outro.
6. Se a empresa não calcula CAC, trate isso como cegueira de gestão: sem CAC não há como decidir quanto investir em aquisição.
7. Você não recebe razão social, CNPJ, e-mail nem telefone da empresa — é uma decisão de privacidade declarada publicamente. Refira-se sempre a "a empresa" e jamais invente ou deduza um nome.
8. O relatorioDetalhadoHtml é lido pelo cliente ANTES de qualquer conversa de consultoria. Nele, aponte o QUE está errado e QUANTO custa — sem ensinar COMO executar: nada de passo a passo, cronograma, ordem de implantação ou indicação de ferramenta específica. O "como" é tratado na reunião com o consultor. Toda a prescrição vai no planoDeAcao, que não é enviado ao cliente.

# SAÍDA
Retorne EXCLUSIVAMENTE um objeto JSON válido, sem texto antes ou depois e sem blocos de código markdown, exatamente nesta estrutura:

{
  "resumoExecutivo": "3 a 5 frases sobre a maturidade comercial, citando o score e o gargalo mais grave.",
  "avaliacoes": {
    "processoEFunil": "2 a 4 frases sobre CRM, etapas do funil e métricas de conversão.",
    "geracaoDemanda": "2 a 4 frases sobre previsibilidade, dependência de canais e CAC.",
    "gestaoEEquipe": "2 a 4 frases sobre metas, composição da equipe e modelo de remuneração.",
    "posVendaETicket": "2 a 4 frases sobre aproveitamento da base, cross-sell, up-sell e retenção."
  },
  "gargalosCriticos": ["Descrição objetiva do gargalo, citando os pontos perdidos que o comprovam."],
  "planoDeAcao": [
    { "prioridade": "Alta", "pilar": "Estrutura, Processo e Funil", "acaoRecomendada": "Ação concreta, com responsável sugerido e prazo." }
  ],
  "relatorioDetalhadoHtml": "Fragmento HTML com a análise completa."
}

Regras dos campos:
- gargalosCriticos: de 2 a 5 itens, ordenados por gravidade.
- planoDeAcao: de 5 a 8 itens, ordenados por impacto, prioridade entre Alta, Média e Baixa. Cada ação deve citar quantos pontos do score ela recupera.
- relatorioDetalhadoHtml: fragmento HTML (sem html/head/body, sem markdown) contendo, nesta ordem: Estrutura e Previsibilidade da Receita; Geração de Demanda; Equipe e Gestão; Aproveitamento da Base de Clientes; Diagnóstico (pontos fortes, fragilidades e o que acontece se nada mudar em 6 meses); e as 5 respostas finais (a operação comercial é previsível? a empresa depende de sorte para vender? a equipe está estruturada para escalar? a base atual está sendo aproveitada? quais as 3 frentes prioritárias — nomeando-as, sem descrever a execução?).
  Use apenas h2, h3, p, ul, li, strong, table, tr, th, td, hr com estilos inline:
  h2 style='font-size:18px;font-weight:800;color:#0B1E3B;margin:26px 0 10px;'
  h3 style='font-size:15px;font-weight:700;color:#0B1E3B;margin:18px 0 8px;'
  p style='margin:0 0 12px;color:#334155;'
  table style='width:100%;border-collapse:collapse;margin:12px 0;font-size:13px;' com th style='background:#0B1E3B;color:#fff;text-align:left;padding:8px 10px;' e td style='border-bottom:1px solid #E2E8F0;padding:8px 10px;color:#334155;'
- Escape corretamente as aspas dentro das strings JSON.`;
}

export interface EntradaFinanceiraCrua {
  dre?: Record<string, unknown>;
  caixa?: Record<string, unknown>;
  endividamento?: Record<string, unknown>;
  qualitativo?: Record<string, unknown>;
}

export function montarPromptFinanceiro(
  id: IdentificacaoPublica,
  entrada: EntradaFinanceiraCrua,
  r: ResultadoRegua,
): string {
  const dre = entrada.dre ?? {};
  const caixa = entrada.caixa ?? {};
  const end = entrada.endividamento ?? {};
  const qual = entrada.qualitativo ?? {};

  return `Você é um analista e consultor financeiro especialista em PMEs brasileiras, atuando pela Business Triage. Escreva sempre em português do Brasil, em linguagem que um empresário sem formação contábil entenda.

A pontuação e todos os indicadores JÁ FORAM CALCULADOS por código auditável. Sua função é EXCLUSIVAMENTE interpretar e escrever. Não recalcule nada, não altere nenhum número, não contradiga a pontuação.

# EMPRESA (sem dados identificáveis — ver regra de privacidade abaixo)
Setor: ${v(id.setor)}
Regime tributário: ${v(qual.regime_tributario ?? id.regime_tributario)}
Mês de referência: ${v(id.mes_referencia)}
Funcionários: ${v(id.num_funcionarios)}

# DADOS INFORMADOS (R$)
Faturamento bruto: ${v(dre.faturamento_bruto, '0')}
Impostos sobre vendas: ${v(dre.impostos_sobre_vendas, '0')}
Custos variáveis: ${v(dre.custos_variaveis, '0')}
Despesas fixas: ${v(dre.despesas_fixas, '0')}
Pró-labore: ${v(dre.pro_labore_socios, '0')}
Lucro líquido: ${v(dre.lucro_liquido_informado, '0')}
Saldo de caixa: ${v(caixa.saldo_caixa_reservas, '0')}
PMR/PMP/PME: ${v(caixa.pmr_dias, '0')}/${v(caixa.pmp_dias, '0')}/${v(caixa.pme_dias, '0')} dias
Inadimplência: ${v(caixa.inadimplencia_pct, '0')}%
Passivo curto/longo prazo: ${v(end.passivo_curto_prazo, '0')} / ${v(end.passivo_longo_prazo, '0')}
Parcela mensal de dívidas: ${v(end.parcela_dividas_mensal, '0')}
Custo da dívida: ${v(end.custo_divida_pct_am, '0')}% ao mês
Observações do cliente: ${limparTextoLivre(qual.observacoes as string | null)}

# SCORE FINANCEIRO JÁ CALCULADO
${JSON.stringify(r.score, null, 2)}

# INDICADORES JÁ CALCULADOS
${JSON.stringify(r.indicadores, null, 2)}

# SEMÁFORO
${r.tabela_alertas}

Indicadores críticos: ${r.indicadores_criticos.join(', ') || 'nenhum'}
Indicadores em atenção: ${r.indicadores_atencao.join(', ') || 'nenhum'}

# LIMITAÇÃO CONHECIDA
O formulário não coleta balanço patrimonial, então não existem dados para: ${r.nao_calculaveis.join(', ')}. Cite essa limitação uma única vez, brevemente, e jamais estime esses valores.

# REGRAS INEGOCIÁVEIS
1. Nunca invente valores. Use apenas os números acima.
2. Se a Divergência da DRE estiver em ATENÇÃO ou CRÍTICO, o resumo executivo deve abrir alertando que os lançamentos precisam ser revisados antes de qualquer decisão.
3. Formate reais no padrão brasileiro (R$ 12.345,67) e percentuais com vírgula.
4. Nada de conselho genérico. Em vez de "reduza custos", diga qual custo, quanto e em que prazo.
5. As avaliações de pilar devem explicar POR QUE a pontuação ficou naquele patamar, citando o valor que a determinou.
6. Você não recebe razão social, CNPJ, e-mail nem telefone da empresa — é uma decisão de privacidade declarada publicamente. Refira-se sempre a "a empresa" e jamais invente ou deduza um nome.

# SAÍDA
Retorne EXCLUSIVAMENTE um objeto JSON válido, sem texto antes ou depois e sem blocos de código markdown, exatamente nesta estrutura:

{
  "resumoExecutivo": "3 a 5 frases sobre o estado geral da empresa, citando o score e o problema mais grave.",
  "avaliacoes": {
    "lucratividade": "2 a 4 frases sobre margem líquida e margem de contribuição.",
    "liquidez": "2 a 4 frases sobre reserva operacional em meses e ciclo financeiro.",
    "endividamento": "2 a 4 frases sobre comprometimento da receita e uso de crédito emergencial.",
    "governanca": "2 a 4 frases sobre separação PF/PJ e concentração de clientes."
  },
  "gargalosIdentificados": ["Descrição objetiva do problema, com o número que o comprova."],
  "planoDeAcao": [
    { "prioridade": "Alta", "pilar": "Liquidez", "acaoRecomendada": "Ação concreta, com meta numérica e prazo." }
  ],
  "relatorioDetalhadoHtml": "Fragmento HTML com a análise completa."
}

Regras dos campos:
- gargalosIdentificados: de 2 a 5 itens, ordenados por gravidade.
- planoDeAcao: de 5 a 8 itens, ordenados por impacto, prioridade entre Alta, Média e Baixa.
- relatorioDetalhadoHtml: fragmento HTML (sem html/head/body, sem markdown) contendo, nesta ordem: Rentabilidade e Ponto de Equilíbrio; Caixa e Ciclo Financeiro; Endividamento; Riscos Qualitativos; Diagnóstico (pontos fortes, fragilidades, riscos e o que acontece se nada mudar em 6 meses); Limitações; e as 7 respostas finais (a empresa é saudável? há risco de falta de caixa? o endividamento está adequado? o lucro é suficiente? precisa de mais capital de giro? quais as 3 maiores prioridades? o que decidir imediatamente?).
  Use apenas h2, h3, p, ul, li, strong, table, tr, th, td, hr com estilos inline:
  h2 style='font-size:18px;font-weight:800;color:#0B1E3B;margin:26px 0 10px;'
  h3 style='font-size:15px;font-weight:700;color:#0B1E3B;margin:18px 0 8px;'
  p style='margin:0 0 12px;color:#334155;'
  table style='width:100%;border-collapse:collapse;margin:12px 0;font-size:13px;' com th style='background:#0B1E3B;color:#fff;text-align:left;padding:8px 10px;' e td style='border-bottom:1px solid #E2E8F0;padding:8px 10px;color:#334155;'
- Escape corretamente as aspas dentro das strings JSON.`;
}
