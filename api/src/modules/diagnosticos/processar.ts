/**
 * O diagnóstico de ponta a ponta, na API.
 *
 * =====================================================================
 * O QUE ISTO SUBSTITUI
 * =====================================================================
 * Dois fluxos do n8n, cada um uma corrente linear de oito a doze nós sem
 * tratamento de erro. No comercial, se `2. API — Baixar PDF do Cliente`
 * falhasse, morriam o envio, a marcação, o arquivamento e o aviso
 * interno — o prospect não recebia nada e ninguém ficava sabendo.
 *
 * =====================================================================
 * AS DUAS POLÍTICAS DE ENVIO SÃO EXPLÍCITAS
 * =====================================================================
 * Comercial sai na hora; financeiro espera a janela das 8h, com o link
 * de segurar no aviso interno. Até 11/09/2026 essa diferença existia
 * como efeito colateral da topologia dos nós — ninguém a tinha
 * decidido, ela só acontecia.
 *
 * Agora é um campo. Regra de negócio que só existe como consequência do
 * desenho é regra que ninguém encontra quando precisa mudá-la.
 *
 * =====================================================================
 * A ORDEM: CALCULAR, GRAVAR, DEPOIS ENTREGAR
 * =====================================================================
 * Nada é enviado antes de estar gravado. Se o envio falhar, existe um
 * registro com PDF pronto para reenviar; se a gravação falhasse depois
 * do envio, ficaria um cliente com relatório na mão e nenhum rastro
 * disso do nosso lado — que foi o risco real do fluxo antigo, onde o
 * e-mail saía ANTES de `4. API — Marcar Enviado`.
 */

import type { ResultadoRegua } from '../regua/regua.js';
import type { ResultadoComercial } from '../regua/regua-comercial.js';
import type { AnaliseComercial, AnaliseFinanceira } from './analise.js';

export type TipoDiagnostico = 'financeiro' | 'comercial';

/**
 * Quem escreve o relatório.
 *
 * `ia` chama o modelo: texto que cruza indicadores, lê o campo livre do
 * cliente e adapta ao setor. Custa cerca de R$ 0,87 e leva de dois a
 * cinco minutos.
 *
 * `codigo` monta o texto a partir dos alertas da régua, em
 * milissegundos e de graça. O esqueleto é compartilhado, mas toda frase
 * carrega um número do cliente — ver `redator.ts`.
 *
 * A régua, o score e os indicadores são idênticos nos dois casos: eles
 * nunca dependeram de IA. O que muda é só a redação.
 */
export type MotorAnalise = 'ia' | 'codigo';

/** Quando o relatório sai. Ver o cabeçalho. */
export const POLITICA_ENVIO: Record<TipoDiagnostico, 'imediato' | 'janela'> = {
  comercial: 'imediato',
  financeiro: 'janela',
};

export interface DadosLead {
  razao_social?: string | null;
  cnpj?: string | null;
  email: string;
  telefone?: string | null;
  setor?: string | null;
  mes_referencia?: string | null;
  num_funcionarios?: number | string | null;
}

export interface RegistroGravado {
  protocolo: string;
  assunto_cliente: string;
  html_cliente: string;
  liberar_em: string | null;
  hold_token: string;
}

export interface Dependencias {
  /** Calcula a régua do tipo pedido. */
  calcular: (
    tipo: TipoDiagnostico,
    entrada: Record<string, unknown>,
  ) => ResultadoRegua | ResultadoComercial;

  /** Chama o modelo e devolve a análise já validada. */
  analisar: (
    tipo: TipoDiagnostico,
    prompt: string,
  ) => Promise<AnaliseFinanceira | AnaliseComercial>;

  /**
   * Escreve a análise sem modelo, a partir da régua já calculada.
   *
   * Recebe o resultado da régua, e não a entrada do formulário, porque é
   * exatamente isso que ele usa: alertas, pilares e score. Passar a
   * entrada crua obrigaria a recalcular — e duas contas para o mesmo
   * número é como elas divergem.
   */
  redigir: (
    tipo: TipoDiagnostico,
    regua: ResultadoRegua | ResultadoComercial,
  ) => AnaliseFinanceira | AnaliseComercial;

  /** Monta o prompt a partir da régua. Separado para poder ser conferido. */
  montarPrompt: (
    tipo: TipoDiagnostico,
    lead: DadosLead,
    entrada: Record<string, unknown>,
    regua: ResultadoRegua | ResultadoComercial,
  ) => string;

  /** Grava o diagnóstico e devolve o que a API precisa para entregar. */
  gravar: (dados: Record<string, unknown>) => Promise<RegistroGravado>;

  /** Renderiza (ou recupera) o PDF do protocolo. */
  pdf: (protocolo: string, interno: boolean) => Promise<{ nome: string; conteudo: Buffer }>;

  enviarEmail: (m: {
    para: string;
    assunto: string;
    html: string;
    anexos?: Array<{ filename: string; content: Buffer }>;
    copiaOculta?: string;
  }) => Promise<{ ok: boolean; erro: string | null }>;

  marcarEnviado: (protocolo: string) => Promise<void>;

  /**
   * Destinatário, assunto e corpo do aviso que chega para você.
   *
   * O destinatário vem daqui, e não de uma constante deste arquivo, para
   * que o módulo continue sem saber o que é `.env` — é o que torna a
   * ordem dos passos testável sem configuração nenhuma.
   */
  avisoInterno: (ctx: {
    tipo: TipoDiagnostico;
    lead: DadosLead;
    registro: RegistroGravado;
    regua: ResultadoRegua | ResultadoComercial;
    politica: 'imediato' | 'janela';
    falhas: string[];
  }) => { para: string; assunto: string; html: string };

  /** Confirmação ao lead, usada só quando o relatório fica para depois. */
  confirmacaoAoLead: (ctx: {
    lead: DadosLead;
    registro: RegistroGravado;
  }) => { assunto: string; html: string };

  aviso?: (dados: Record<string, unknown>, msg: string) => void;
}

export interface ResultadoDiagnostico {
  ok: boolean;
  protocolo: string | null;
  score: number | null;
  nivel: string | null;
  politica: 'imediato' | 'janela';
  relatorio_enviado: boolean;
  confirmacao_enviada: boolean;
  aviso_interno_enviado: boolean;
  falhas: string[];
}

const scoreDe = (r: ResultadoRegua | ResultadoComercial) => r.score.scoreTotal;
const nivelDe = (r: ResultadoRegua | ResultadoComercial) =>
  'nivelSaude' in r.score ? r.score.nivelSaude : r.score.nivelMaturidade;

export async function processarDiagnostico(
  tipo: TipoDiagnostico,
  lead: DadosLead,
  entrada: Record<string, unknown>,
  dep: Dependencias,
  /**
   * O protocolo, quando já foi gerado antes.
   *
   * A rota pública responde ao formulário assim que a régua fecha, muito
   * antes de a análise ficar pronta — e o número que ela devolve tem de
   * ser o mesmo que vai para o banco. Gerar aqui dentro faria o cliente
   * ver na tela um protocolo que não existe em lugar nenhum.
   */
  protocolo?: string,
  /**
   * Quem escreve o relatório. O padrão continua sendo a IA para não
   * mudar o comportamento de quem já está em produção — a troca é
   * explícita, por chamada.
   */
  motor: MotorAnalise = 'ia',
): Promise<ResultadoDiagnostico> {
  const avisar = dep.aviso ?? (() => {});
  const politica = POLITICA_ENVIO[tipo];

  const r: ResultadoDiagnostico = {
    ok: false,
    protocolo: null,
    score: null,
    nivel: null,
    politica,
    relatorio_enviado: false,
    confirmacao_enviada: false,
    aviso_interno_enviado: false,
    falhas: [],
  };

  const anota = (passo: string, e: unknown) => {
    const texto = e instanceof Error ? e.message : String(e);
    r.falhas.push(`${passo}: ${texto}`);
    avisar({ passo, erro: texto, tipo }, 'Falha no diagnóstico');
  };

  // ---- 1. A régua ----------------------------------------------------
  //
  // Sem try: se o cálculo falhar não há diagnóstico nenhum a entregar, e
  // seguir adiante produziria um relatório sobre nada. Lança para quem
  // chamou responder ao formulário com um erro honesto.
  const regua = dep.calcular(tipo, entrada);
  r.score = scoreDe(regua);
  r.nivel = nivelDe(regua);

  // ---- 2. A análise --------------------------------------------------
  //
  // Também sem try, e pelo mesmo motivo: o relatório é a análise. Um PDF
  // com score e sem texto não é um produto pela metade, é um produto
  // errado.
  //
  // No motor `codigo` não há chamada de rede, nem custo, nem chance de
  // falhar por formato — a única forma de erro aqui é defeito nosso, e
  // ele aparece nos testes antes de aparecer no cliente.
  const analise =
    motor === 'codigo'
      ? dep.redigir(tipo, regua)
      : await dep.analisar(tipo, dep.montarPrompt(tipo, lead, entrada, regua));

  // ---- 3. Gravar -----------------------------------------------------
  //
  // A partir daqui tudo é entrega, e entrega falha sem levar o resto
  // junto. O diagnóstico existe no banco; o pior caso vira reenvio.
  const registro = await dep.gravar({
    ...(protocolo ? { protocolo } : {}),
    tipo,
    razao_social: lead.razao_social,
    cnpj: lead.cnpj,
    email: lead.email,
    telefone: lead.telefone,
    setor: lead.setor,
    mes_referencia: lead.mes_referencia,
    score_total: r.score,
    nivel: r.nivel,
    entrada,
    indicadores: 'indicadores' in regua ? regua.indicadores : {},
    alertas: 'alertas' in regua ? regua.alertas : [],
    analise,
  });

  r.protocolo = registro.protocolo;

  // ---- 4. O relatório, quando a política é imediata -------------------
  if (politica === 'imediato') {
    try {
      const arquivo = await dep.pdf(registro.protocolo, false);
      const envio = await dep.enviarEmail({
        para: lead.email,
        assunto: registro.assunto_cliente,
        html: registro.html_cliente,
        anexos: [{ filename: arquivo.nome, content: arquivo.conteudo }],
      });

      r.relatorio_enviado = envio.ok;
      if (!envio.ok) {
        r.falhas.push(`relatório: ${envio.erro}`);
      } else {
        // Só marca depois de o e-mail ter saído de verdade. No fluxo
        // antigo a marcação vinha depois do envio também — mas se ela
        // falhasse, o relatório já tinha ido e o registro continuava
        // `pendente`, e a fila das 8h mandava DE NOVO.
        //
        // Aqui a marcação que falha vira falha registrada, não envio
        // duplicado: o alarme avisa e alguém marca à mão.
        try {
          await dep.marcarEnviado(registro.protocolo);
        } catch (e) {
          anota('marcar enviado (RISCO DE ENVIO DUPLICADO)', e);
        }
      }
    } catch (e) {
      anota('relatório', e);
    }
  } else {
    // ---- 5. Confirmação, quando o relatório fica para a janela --------
    try {
      const msg = dep.confirmacaoAoLead({ lead, registro });
      const envio = await dep.enviarEmail({ para: lead.email, assunto: msg.assunto, html: msg.html });
      r.confirmacao_enviada = envio.ok;
      if (!envio.ok) r.falhas.push(`confirmação: ${envio.erro}`);
    } catch (e) {
      anota('confirmação', e);
    }
  }

  // ---- 6. O aviso interno, sempre e por último ------------------------
  //
  // Por último de propósito: é o passo que menos importa para o cliente
  // e o que mais importa para você. Ficando no fim, ele relata o que
  // aconteceu nos anteriores — inclusive as falhas.
  try {
    const msg = dep.avisoInterno({ tipo, lead, registro, regua, politica, falhas: r.falhas });
    const envio = await dep.enviarEmail({ para: msg.para, assunto: msg.assunto, html: msg.html });
    r.aviso_interno_enviado = envio.ok;
    if (!envio.ok) r.falhas.push(`aviso interno: ${envio.erro}`);
  } catch (e) {
    anota('aviso interno', e);
  }

  r.ok = r.falhas.length === 0;
  return r;
}
