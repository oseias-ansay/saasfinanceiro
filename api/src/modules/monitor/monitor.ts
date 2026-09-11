/**
 * O vigia: quem devia ter rodado e não rodou.
 *
 * =====================================================================
 * O PROBLEMA QUE ISTO RESOLVE
 * =====================================================================
 * Todo defeito caro desta plataforma nos últimos meses teve a mesma
 * forma: alguma coisa deixou de acontecer, e nada avisou.
 *
 *   - o relatório das 8h parou de sair, e o alarme que deveria avisar
 *     usava a mesma credencial do Gmail que tinha quebrado;
 *   - o formulário do site passou a falhar só para quem entrava com
 *     `www`, e o log do servidor mostrava 200;
 *   - o fluxo do WhatsApp abortava no primeiro nó e os dois seguintes
 *     nunca rodavam;
 *   - a suíte de testes rodava 7 de 91 e dizia "pass".
 *
 * Nenhum deles gerou erro. Sistema que só sabe reclamar do que aconteceu
 * é cego para o que deixou de acontecer — e é justamente aí que mora o
 * prejuízo, porque o cliente percebe antes de você.
 *
 * =====================================================================
 * A INVERSÃO
 * =====================================================================
 * Em vez de esperar um erro, o vigia parte de uma lista do que DEVERIA
 * ter acontecido e cobra cada item. Silêncio deixa de ser ausência de
 * notícia e passa a ser a notícia.
 *
 * A lista mora aqui, em código, e não numa tabela. Processo agendado
 * nasce e morre junto com o código que o implementa; numa tabela, a
 * lista envelheceria em silêncio — o mesmo defeito, um andar acima.
 */

import { diasAntes, ehFimDeSemana, emSaoPaulo, instanteEmSaoPaulo } from './relogio.js';

/**
 * Quando um processo deveria ter terminado.
 *
 * `toleranciaMin` é a folga depois do horário previsto. Serve para a
 * demora normal — renderizar PDF, esperar a IA — não para esconder
 * atraso. Generosa demais, o vigia vira enfeite.
 */
export type Expectativa =
  | { tipo: 'diario'; hora: number; toleranciaMin: number }
  | { tipo: 'diasUteis'; hora: number; toleranciaMin: number }
  | { tipo: 'mensal'; dia: number; hora: number; toleranciaMin: number }
  | { tipo: 'intervalo'; minutos: number; toleranciaMin: number };

export interface Processo {
  /** Chave gravada em `execucoes.processo`. Nunca mude sem migrar. */
  chave: string;
  /** Como você chama isso ao falar com alguém. */
  nome: string;
  expectativa: Expectativa;
  /**
   * O que acontece se este processo ficar parado. Vai no texto do
   * alarme, porque "job X atrasado" às 6h da manhã não diz a ninguém o
   * que fazer — e alarme que não orienta é alarme que se ignora.
   */
  consequencia: string;
}

/**
 * O catálogo.
 *
 * Feriado nacional NÃO é tratado. É deliberado: um processo que não roda
 * no feriado gera um alarme falso por ano, e alarme falso raro é barato.
 * Uma tabela de feriados que envelhece sem ninguém notar — e que faria o
 * vigia calar no dia errado — é cara. Prefiro o incômodo ao silêncio.
 */
export const PROCESSOS: readonly Processo[] = [
  {
    chave: 'diagnosticos.envio',
    nome: 'Envio dos diagnósticos das 8h',
    expectativa: { tipo: 'diasUteis', hora: 8, toleranciaMin: 45 },
    consequencia: 'Prospects que preencheram o formulário não recebem o relatório prometido.',
  },
  {
    chave: 'recorrentes.gerar',
    nome: 'Geração dos lançamentos recorrentes',
    expectativa: { tipo: 'diario', hora: 3, toleranciaMin: 60 },
    consequencia: 'O caixa dos clientes fica sem as contas fixas do dia — o saldo projetado mente.',
  },
  {
    chave: 'alertas.diarios',
    nome: 'Alertas diários aos gestores',
    expectativa: { tipo: 'diasUteis', hora: 8, toleranciaMin: 60 },
    consequencia: 'Nenhum cliente é avisado de conta vencendo.',
  },
  {
    chave: 'mensal.apurar',
    nome: 'Fechamento mensal',
    expectativa: { tipo: 'mensal', dia: 5, hora: 8, toleranciaMin: 240 },
    consequencia: 'A curva do score não avança e a cobrança do mês não sai.',
  },
  {
    chave: 'meta.fila',
    nome: 'Envio de eventos para a Meta',
    expectativa: { tipo: 'intervalo', minutos: 15, toleranciaMin: 30 },
    consequencia: 'A campanha otimiza às cegas: a Meta deixa de saber quais leads viraram negócio.',
  },
  {
    chave: 'mensagens.purgar',
    nome: 'Expurgo das conversas vencidas',
    expectativa: { tipo: 'diario', hora: 4, toleranciaMin: 120 },
    consequencia: 'Conversas passam do prazo de retenção prometido no contrato.',
  },
];

/**
 * O instante mais recente em que este processo já deveria ter terminado.
 *
 * Devolve nulo quando ainda não houve nenhum — processo mensal no dia 2,
 * por exemplo. Nulo significa "não há o que cobrar ainda", e é diferente
 * de "está em dia".
 */
export function ultimoPrazo(exp: Expectativa, agora: Date): Date | null {
  if (exp.tipo === 'intervalo') {
    return new Date(agora.getTime() - (exp.minutos + exp.toleranciaMin) * 60_000);
  }

  const p = emSaoPaulo(agora);
  const limite = (dia: { ano: number; mes: number; dia: number }) =>
    new Date(
      instanteEmSaoPaulo(dia.ano, dia.mes, dia.dia, exp.hora).getTime() +
        exp.toleranciaMin * 60_000,
    );

  if (exp.tipo === 'diario') {
    const hoje = limite(p);
    if (hoje <= agora) return hoje;
    const ontem = diasAntes(p, 1);
    return limite(ontem);
  }

  if (exp.tipo === 'diasUteis') {
    // Anda para trás até achar o último dia útil cujo prazo já venceu.
    // Na segunda às 7h, o último prazo é o de sexta — e cobrar o de
    // sábado faria o vigia gritar todo fim de semana.
    let d = p;
    for (let i = 0; i < 10; i++) {
      if (!ehFimDeSemana(d)) {
        const prazo = limite(d);
        if (prazo <= agora) return prazo;
      }
      d = diasAntes(d, 1);
    }
    return null;
  }

  // Mensal.
  const desteMes = limite({ ano: p.ano, mes: p.mes, dia: exp.dia });
  if (desteMes <= agora) return desteMes;

  const mesAnterior = p.mes === 1 ? 12 : p.mes - 1;
  const anoAnterior = p.mes === 1 ? p.ano - 1 : p.ano;
  return limite({ ano: anoAnterior, mes: mesAnterior, dia: exp.dia });
}

export interface Situacao {
  processo: Processo;
  ultimoSucesso: Date | null;
  prazo: Date | null;
  atrasado: boolean;
  /** Há quanto tempo era para ter rodado. Nulo quando está em dia. */
  atrasoMin: number | null;
}

/**
 * Compara o catálogo com o que de fato rodou.
 *
 * Um processo que NUNCA rodou e já tem prazo vencido conta como
 * atrasado. É o caso mais importante e o mais fácil de deixar escapar:
 * um agendamento que nunca chegou a funcionar não gera erro nenhum, e
 * sem esta regra ficaria invisível para sempre.
 */
export function avaliar(
  agora: Date,
  ultimosSucessos: Record<string, Date | null>,
  processos: readonly Processo[] = PROCESSOS,
): Situacao[] {
  return processos.map((processo) => {
    const prazo = ultimoPrazo(processo.expectativa, agora);
    const ultimoSucesso = ultimosSucessos[processo.chave] ?? null;

    const atrasado = prazo !== null && (ultimoSucesso === null || ultimoSucesso < prazo);

    return {
      processo,
      ultimoSucesso,
      prazo,
      atrasado,
      atrasoMin: atrasado && prazo ? Math.round((agora.getTime() - prazo.getTime()) / 60_000) : null,
    };
  });
}

/** O texto do alarme. Curto: vai para o WhatsApp, lido no celular. */
export function textoDoAlarme(atrasados: Situacao[], agora: Date): string {
  const quando = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(agora);

  const linhas = atrasados.map((s) => {
    const h = Math.floor((s.atrasoMin ?? 0) / 60);
    const m = (s.atrasoMin ?? 0) % 60;
    const atraso = h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m}min`;
    return `• *${s.processo.nome}* — parado há ${atraso}\n  ${s.processo.consequencia}`;
  });

  return (
    `⚠️ *Business Triage — processo parado*\n${quando}\n\n` +
    linhas.join('\n\n') +
    '\n\nVeja o detalhe em: vw_monitor_processos'
  );
}

/**
 * O pulso diário.
 *
 * Existe porque um vigia morto e um sistema saudável produzem o mesmo
 * silêncio. Recebendo esta mensagem todo dia, a ausência dela vira o
 * sinal — e quem nota é você, que não depende de credencial nenhuma para
 * funcionar.
 */
export function textoDoPulso(situacoes: Situacao[], agora: Date): string {
  const dia = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
  }).format(agora);

  const emDia = situacoes.filter((s) => !s.atrasado).length;
  return (
    `✅ *Business Triage* — ${dia}\n` +
    `${emDia} de ${situacoes.length} processos em dia.\n\n` +
    '_Se esta mensagem parar de chegar, alguma coisa quebrou._'
  );
}
