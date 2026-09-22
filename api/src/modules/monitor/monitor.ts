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
 * A janela de execução mais recente que já se encerrou.
 *
 * =====================================================================
 * POR QUE SÃO DOIS INSTANTES, E NÃO UM
 * =====================================================================
 * Até 16/09/2026 esta função devolvia um número só — hora mais tolerância
 * — e `avaliar` exigia que o sucesso fosse POSTERIOR a ele. O efeito era o
 * contrário do pretendido: um processo que rodava às 8h03, pontual,
 * ficava marcado como atrasado a partir das 8h45 e assim permanecia o dia
 * inteiro. **O vigia punia a pontualidade.**
 *
 * Foi exatamente o que aconteceu com o envio dos diagnósticos: ele rodou
 * às 8h03, entregou o que tinha para entregar, e mesmo assim gerou
 * alarme. Alarme falso é pior que alarme nenhum, porque ensina quem
 * recebe a ignorar — e aí o verdadeiro passa despercebido junto.
 *
 * Os dois instantes têm papéis distintos:
 *
 * - `inicio`  — a hora marcada. Sucesso a partir daqui CONTA.
 * - `limite`  — início mais a tolerância. A partir daqui o vigia COBRA.
 *
 * A tolerância atrasa a cobrança; ela não desqualifica quem chegou cedo.
 *
 * Devolve nulo quando nenhuma janela se encerrou ainda — processo mensal
 * no dia 2, por exemplo. Nulo significa "não há o que cobrar ainda", e é
 * diferente de "está em dia".
 */
export interface Janela {
  /** A hora marcada. Execução daqui em diante conta como feita. */
  inicio: Date;
  /** Início mais a tolerância. Daqui em diante o vigia cobra. */
  limite: Date;
}

export function ultimoPrazo(exp: Expectativa, agora: Date): Janela | null {
  if (exp.tipo === 'intervalo') {
    // Processo de intervalo não tem hora marcada: a janela é uma faixa
    // móvel que termina agora. `limite` igual a `agora` mantém a regra
    // "sempre vencido", que é a semântica certa para algo que deveria
    // estar rodando o tempo todo.
    return {
      inicio: new Date(agora.getTime() - (exp.minutos + exp.toleranciaMin) * 60_000),
      limite: agora,
    };
  }

  const p = emSaoPaulo(agora);
  const janela = (dia: { ano: number; mes: number; dia: number }): Janela => {
    const inicio = instanteEmSaoPaulo(dia.ano, dia.mes, dia.dia, exp.hora);
    return { inicio, limite: new Date(inicio.getTime() + exp.toleranciaMin * 60_000) };
  };

  if (exp.tipo === 'diario') {
    const hoje = janela(p);
    if (hoje.limite <= agora) return hoje;
    return janela(diasAntes(p, 1));
  }

  if (exp.tipo === 'diasUteis') {
    // Anda para trás até achar o último dia útil cuja janela já fechou.
    // Na segunda às 7h, a última é a de sexta — e cobrar a de sábado
    // faria o vigia gritar todo fim de semana.
    let d = p;
    for (let i = 0; i < 10; i++) {
      if (!ehFimDeSemana(d)) {
        const j = janela(d);
        if (j.limite <= agora) return j;
      }
      d = diasAntes(d, 1);
    }
    return null;
  }

  // Mensal.
  const desteMes = janela({ ano: p.ano, mes: p.mes, dia: exp.dia });
  if (desteMes.limite <= agora) return desteMes;

  const mesAnterior = p.mes === 1 ? 12 : p.mes - 1;
  const anoAnterior = p.mes === 1 ? p.ano - 1 : p.ano;
  return janela({ ano: anoAnterior, mes: mesAnterior, dia: exp.dia });
}

export interface Situacao {
  processo: Processo;
  ultimoSucesso: Date | null;
  /** O instante a partir do qual o vigia cobra (início + tolerância). */
  prazo: Date | null;
  /** A hora marcada. Sucesso a partir daqui conta como em dia. */
  inicioJanela: Date | null;
  atrasado: boolean;
  /**
   * Nunca houve execução bem-sucedida registrada.
   *
   * É um problema DIFERENTE de "parou", e a distinção não é semântica:
   * "parado há 9h" manda procurar o que quebrou; "nunca executou" manda
   * procurar o agendamento que não foi ligado. Até 21/09/2026 os dois
   * casos usavam o mesmo texto, e o alarme mandava caçar uma quebra que
   * não existia.
   */
  nuncaExecutou: boolean;
  /**
   * Há quantos minutos passou do prazo.
   *
   * Nulo quando está em dia OU quando nunca executou — neste segundo
   * caso não existe "há quanto tempo parou", porque nunca andou.
   */
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
    const janela = ultimoPrazo(processo.expectativa, agora);
    const ultimoSucesso = ultimosSucessos[processo.chave] ?? null;

    // A comparação é contra o INÍCIO da janela, não contra o limite. Quem
    // rodou às 8h03 de uma janela que abre às 8h rodou — a tolerância de
    // 45 minutos existe para adiar a cobrança, não para invalidar quem
    // chegou na hora. Ver o comentário em `ultimoPrazo`.
    const atrasado =
      janela !== null && (ultimoSucesso === null || ultimoSucesso < janela.inicio);

    const nuncaExecutou = atrasado && ultimoSucesso === null;

    // Há quanto tempo passou do prazo.
    //
    // Duas correções de 21/09/2026:
    //
    // 1. Processo de INTERVALO tinha `limite = agora` por construção, o
    //    que fazia `agora − limite` dar sempre ZERO. O alarme saía com
    //    "parado há 0min", que é absurdo na cara de quem lê. Para esses,
    //    o atraso se conta desde o último sucesso, descontado o
    //    intervalo previsto — que é o que "atrasado" significa para algo
    //    que deveria rodar o tempo todo.
    //
    // 2. Quem nunca executou não tem atraso: não existe "parado há X"
    //    para o que nunca andou. Fica nulo, e o texto muda.
    let atrasoMin: number | null = null;
    if (atrasado && janela && !nuncaExecutou) {
      const desde =
        processo.expectativa.tipo === 'intervalo'
          ? ultimoSucesso!.getTime() + processo.expectativa.minutos * 60_000
          : janela.limite.getTime();
      atrasoMin = Math.max(0, Math.round((agora.getTime() - desde) / 60_000));
    }

    return {
      processo,
      ultimoSucesso,
      prazo: janela?.limite ?? null,
      inicioJanela: janela?.inicio ?? null,
      atrasado,
      nuncaExecutou,
      atrasoMin,
    };
  });
}

/**
 * Duração em português, na unidade que a pessoa usaria.
 *
 * "385h15" é tecnicamente certo e humanamente inútil: ninguém converte
 * isso de cabeça. Acima de dois dias, a pergunta deixa de ser "quantas
 * horas" e passa a ser "desde quando" — e a resposta em dias é a única
 * que cabe numa notificação lida no celular.
 */
export function duracaoEmTexto(minutos: number): string {
  if (minutos < 60) return `${minutos}min`;

  const horas = Math.floor(minutos / 60);
  if (horas < 48) {
    const m = minutos % 60;
    return m > 0 ? `${horas}h${String(m).padStart(2, '0')}` : `${horas}h`;
  }

  const dias = Math.floor(horas / 24);
  const resto = horas % 24;
  return resto > 0 ? `${dias} dias e ${resto}h` : `${dias} dias`;
}

/** O texto do alarme. Curto: vai para o WhatsApp, lido no celular. */
export function textoDoAlarme(atrasados: Situacao[], agora: Date): string {
  const quando = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(agora);

  const linhas = atrasados.map((s) => {
    const estado = s.nuncaExecutou
      ? 'NUNCA executou'
      : `parado há ${duracaoEmTexto(s.atrasoMin ?? 0)}`;
    return `• *${s.processo.nome}* — ${estado}\n  ${s.processo.consequencia}`;
  });

  // A frase que evita a caçada errada. Sem ela, "nunca executou" e
  // "parado" levam ao mesmo lugar: procurar o que quebrou.
  const nunca = atrasados.filter((s) => s.nuncaExecutou).length;
  const rodape =
    nunca > 0
      ? '\n\n' +
        (nunca === 1
          ? 'O marcado como NUNCA executou não quebrou: ele nunca chegou a rodar.'
          : 'Os marcados como NUNCA executou não quebraram: eles nunca chegaram a rodar.') +
        ' Procure o agendamento desligado, não o defeito.'
      : '';

  return (
    `⚠️ *Business Triage — processo parado*\n${quando}\n\n` +
    linhas.join('\n\n') +
    rodape +
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
