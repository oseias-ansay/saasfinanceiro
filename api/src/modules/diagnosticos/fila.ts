/**
 * A fila das 8h: quando roda, o que faz, e o que dizer quando tropeça.
 *
 * =====================================================================
 * POR QUE ESTE ARQUIVO NÃO TOCA EM NADA
 * =====================================================================
 * Duas coisas moram aqui, e as duas são as que podem estar erradas.
 *
 * A primeira é a decisão "é hora de enviar?", que é conta de calendário
 * — e conta de calendário erra por uma hora em silêncio.
 *
 * A segunda é a ordem do envio e o isolamento entre os itens, que é
 * exatamente o que o fluxo do n8n fazia errado.
 *
 * Nenhuma das duas precisa de banco, SMTP ou de esperar amanhecer para
 * ser conferida. O mundo real entra por `DependenciasFila`, montada em
 * `fila.service.ts` — mesmo desenho de `processar.ts` e `dependencias.ts`.
 *
 * =====================================================================
 * POR QUE NÃO GUARDAR "JÁ RODEI HOJE" NA MEMÓRIA
 * =====================================================================
 * Porque o contêiner reinicia. Um agendador que lembra na memória que já
 * enviou perde essa lembrança no `docker compose up` e manda tudo de
 * novo — ou, dependendo de onde guardou, nunca mais manda.
 *
 * A pergunta é respondida pelo banco: o último registro de sucesso de
 * `diagnosticos.envio` em `execucoes`. Se ele for posterior à janela de
 * hoje, já rodou. A conta é refeita do zero a cada passada, e reiniciar
 * no meio da manhã não muda o resultado.
 */

import { ehFimDeSemana, emSaoPaulo, instanteEmSaoPaulo } from '../monitor/relogio.js';

/** A chave deste processo no catálogo do vigia. Precisa bater com `PROCESSOS`. */
export const PROCESSO_FILA = 'diagnosticos.envio';

/**
 * É hora de esvaziar a fila?
 *
 * Três condições, e todas por um motivo:
 *
 * - **Dia útil.** `liberar_em` já é sempre um dia útil, então no sábado
 *   não haveria nada a fazer — exceto num caso: a API passou a sexta
 *   inteira fora do ar e os relatórios de sexta ficaram para trás. Mesmo
 *   aí não enviamos no sábado. Relatório que chega no sábado de manhã não
 *   é lido, e essa é a primeira impressão que o prospect tem do produto.
 *   Ele sai na segunda. É escolha de produto, não limitação técnica.
 *
 * - **Passou da hora.** Antes das 8h não há janela aberta.
 *
 * - **Ainda não rodou hoje.** Comparada contra a janela de HOJE, não
 *   contra "as últimas 24 horas": às 8h05 de terça, um sucesso às 8h05 de
 *   segunda tem 24 horas e mesmo assim precisa rodar de novo.
 */
export function devePassar(agora: Date, ultimoSucesso: Date | null, hora = 8): boolean {
  const p = emSaoPaulo(agora);

  if (ehFimDeSemana(p)) return false;
  if (p.hora < hora) return false;

  const janelaDeHoje = instanteEmSaoPaulo(p.ano, p.mes, p.dia, hora);
  return ultimoSucesso === null || ultimoSucesso < janelaDeHoje;
}

export interface FalhaDeEnvio {
  protocolo: string;
  email: string;
  erro: string;
}

/**
 * O texto do alarme quando algum relatório não saiu.
 *
 * Traz protocolo e e-mail porque a ação possível é reenviar à mão, e
 * quem recebe a mensagem no celular precisa saber para quem, não só que
 * "houve uma falha". Alarme que obriga a abrir o banco para descobrir o
 * que fazer é alarme que fica para depois.
 *
 * Limita a cinco linhas: uma falha sistêmica com quarenta pendentes
 * viraria uma mensagem que ninguém lê até o fim, e o número total já diz
 * o tamanho do estrago.
 */
export function textoDaFalhaDaFila(falhas: readonly FalhaDeEnvio[], total: number): string {
  const amostra = falhas.slice(0, 5);
  const resto = falhas.length - amostra.length;

  const linhas = amostra.map((f) => `• ${f.protocolo} (${f.email})\n  ${f.erro}`);
  if (resto > 0) linhas.push(`• …e mais ${resto}`);

  return (
    `⚠️ Envio das 8h: ${falhas.length} de ${total} relatório(s) não saíram.\n\n` +
    `${linhas.join('\n')}\n\n` +
    'Eles continuam na fila e são tentados de novo amanhã. ' +
    'Depois de 3 tentativas saem da fila e ficam com status `falhou`.'
  );
}

/* ==================================================================== */
/* O envio                                                               */
/* ==================================================================== */

export interface ItemDaFila {
  protocolo: string;
  tipo: 'financeiro' | 'comercial';
  razao_social: string | null;
  email: string;
  assunto_cliente: string;
  html_cliente: string;
}

export interface DependenciasFila {
  listar: (limite: number) => Promise<ItemDaFila[]>;
  pdf: (protocolo: string) => Promise<{ nome: string; conteudo: Buffer }>;
  enviarEmail: (m: {
    para: string;
    assunto: string;
    html: string;
    anexos: Array<{ filename: string; content: Buffer }>;
  }) => Promise<{ ok: boolean; erro: string | null }>;
  marcar: (protocolo: string, status: 'enviado' | 'falhou', erro?: string | null) => Promise<void>;
  avisar: (texto: string) => Promise<boolean>;
  log?: (dados: Record<string, unknown>, msg: string) => void;
}

export interface ResultadoDaFila {
  total: number;
  enviados: number;
  falhas: FalhaDeEnvio[];
}

/**
 * Esvazia a fila liberada.
 *
 * =====================================================================
 * FALHA DE UM ITEM NÃO PARA A FILA
 * =====================================================================
 * Era esse o defeito do n8n: um nó que falha aborta a execução inteira.
 * Um e-mail inválido no meio da fila derrubava os dez seguintes, e os
 * dez prospects seguintes nunca souberam.
 *
 * Aqui cada item é independente e o resultado da passada é a soma. Um
 * endereço podre não custa o relatório de mais ninguém.
 *
 * =====================================================================
 * SEQUENCIAL DE PROPÓSITO
 * =====================================================================
 * Paralelizar economizaria segundos e custaria a ordem de chegada — e,
 * com SMTP compartilhado, dispararia o limite de envio do provedor numa
 * fila represada. Vinte relatórios em série levam menos de um minuto.
 */
export async function enviarFila(
  dep: DependenciasFila,
  limite = 50,
): Promise<ResultadoDaFila> {
  const anota = dep.log ?? (() => {});

  // Sem try: se a fila não puder ser lida, não há passada nenhuma a
  // relatar. Lança, `comRegistro` marca falha, e o vigia cobra.
  const itens = await dep.listar(limite);

  const r: ResultadoDaFila = { total: itens.length, enviados: 0, falhas: [] };

  for (const item of itens) {
    try {
      const arquivo = await dep.pdf(item.protocolo);

      const envio = await dep.enviarEmail({
        para: item.email,
        assunto: item.assunto_cliente,
        html: item.html_cliente,
        anexos: [{ filename: arquivo.nome, content: arquivo.conteudo }],
      });

      if (envio.ok) {
        // Só marca depois de o e-mail ter saído. Marcar antes tiraria o
        // item da fila mesmo quando o envio falhasse — que é o defeito
        // clássico de fila: some do painel e nunca chega ao destino.
        await dep.marcar(item.protocolo, 'enviado');
        r.enviados += 1;
        anota({ protocolo: item.protocolo, email: item.email }, 'Relatório enviado');
      } else {
        const erro = envio.erro ?? 'envio recusado sem detalhe';
        await dep.marcar(item.protocolo, 'falhou', erro);
        r.falhas.push({ protocolo: item.protocolo, email: item.email, erro });
      }
    } catch (e) {
      const erro = e instanceof Error ? e.message : String(e);
      r.falhas.push({ protocolo: item.protocolo, email: item.email, erro });

      // A marcação também pode falhar — e se falhar, o item volta amanhã
      // com a mesma tentativa. Preferível a interromper a fila aqui.
      try {
        await dep.marcar(item.protocolo, 'falhou', erro);
      } catch (e2) {
        anota(
          { protocolo: item.protocolo, erro: e2 instanceof Error ? e2.message : String(e2) },
          'Falha ao marcar o diagnóstico como falho',
        );
      }
    }
  }

  if (r.falhas.length > 0) {
    // Pelo WhatsApp, e não por e-mail, pela mesma razão do vigia: o canal
    // do alarme não pode compartilhar o modo de falha do que ele vigia, e
    // o que acabou de falhar aqui foi justamente o e-mail.
    await dep.avisar(textoDaFalhaDaFila(r.falhas, r.total));
  }

  return r;
}
