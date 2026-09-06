/**
 * Normaliza o evento cru da Evolution e decide o que fazer com ele.
 *
 * ---------------------------------------------------------------------
 * DE ONDE ESTE CÓDIGO VEIO
 * ---------------------------------------------------------------------
 * Era o nó "Ler Mensagem e Escolher Resposta" do fluxo 07 do n8n. Mudou
 * de lugar, não de conteúdo — as regras abaixo são as mesmas, com os
 * mesmos motivos.
 *
 * Mudou de lugar porque o nó era JavaScript rodando num editor sem git,
 * sem tipos e sem testes, no caminho crítico do atendimento. Um defeito
 * ali só aparecia abrindo execuções à mão, uma a uma. Aqui ele aparece
 * antes do deploy.
 *
 * ---------------------------------------------------------------------
 * POR QUE É UMA FUNÇÃO PURA
 * ---------------------------------------------------------------------
 * Não toca banco, não faz rede, não lê relógio do servidor. Recebe o
 * payload e devolve a decisão. É o que torna possível testar as vinte
 * combinações de grupo, LID, mídia e código de origem sem subir nada —
 * e essas combinações são exatamente onde moram as falhas silenciosas
 * que custaram os testes anteriores.
 */

export type TipoMidia =
  | 'audio'
  | 'imagem'
  | 'documento'
  | 'video'
  | 'figurinha'
  | 'localizacao'
  | 'contato';

export interface MensagemNormalizada {
  /** Se cabe resposta automática. */
  responder: boolean;
  /** Por que sim ou por que não. Vai para o log e para a tabela de eventos. */
  motivo: string;

  /** Nome da instância na Evolution. É o que resolve a empresa. */
  instancia: string;
  /** Telefone só com dígitos, pronto para a Evolution. */
  numero: string;
  jid: string;
  contato: string | null;
  /** O código do `(ref: ...)`, quando houver. */
  origem: string | null;
  saudacao: string;
  texto_recebido: string;
  recebido_em: string;
  resposta: string | null;

  /** Se a pessoa deve entrar no funil. */
  registrar: boolean;
  /** Se a mensagem deve ir para o histórico. */
  guardar: boolean;

  contexto: Record<string, unknown>;

  de_mim: boolean;
  wa_id: string | null;
  tipo_midia: TipoMidia | null;
  midia_nome: string | null;
}

type Obj = Record<string, unknown>;

const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/**
 * Saudação conforme a hora de Brasília.
 *
 * A hora sai do próprio evento, não do relógio do servidor: se o
 * processamento atrasar, a saudação continua coerente com o momento em
 * que a pessoa escreveu. O fuso é fixo porque o contêiner roda em UTC —
 * sem isso, toda mensagem da noite viraria "bom dia".
 */
export function saudacaoDe(quando: string | null): string {
  const d = quando ? new Date(quando) : new Date();
  const instante = Number.isNaN(d.getTime()) ? new Date() : d;
  const hora = Number(
    new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: 'numeric',
      hour12: false,
    }).format(instante),
  );
  return hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
}

/** As respostas automáticas, por código de origem. */
export function respostas(saudacao: string): Record<string, string> {
  return {
    agendamento:
      `${saudacao}! Que bom que você quer fazer o diagnóstico da sua empresa.\n\n` +
      'O relatório chega no dia seguinte pela manhã, em PDF, sem custo.\n\n' +
      'Para eu já preparar: qual o nome da sua empresa, e qual o melhor período para conversarmos — manhã ou tarde?',

    credito:
      `${saudacao}! Trabalho com crédito empresarial pela Franq desde 2021 — capital de giro, financiamento de equipamento e antecipação de recebíveis.\n\n` +
      'Antes de indicar qualquer operação, prefiro entender o que está acontecendo no caixa. Às vezes crédito resolve; às vezes adia um problema que fica maior.\n\n' +
      'Me conta em duas linhas: para que você precisa do recurso?',

    mercado:
      `${saudacao}! Sobre inteligência de mercado, trabalhamos com relatório de onde estão seus clientes, análise de concorrentes, sites e páginas de anúncio, e treinamento de campanhas.\n\n` +
      'Para eu responder com algo útil em vez de catálogo: qual é o seu segmento, e o que está tentando resolver — atrair mais gente ou converter melhor quem já chega?',

    anuncio:
      `${saudacao}! Vi que você veio pelo anúncio do diagnóstico.\n\n` +
      'Funciona assim: você responde um formulário com os números do mês passado, leva uns dez minutos, e no dia seguinte de manhã o relatório completo chega no seu e-mail. Em PDF, sem custo.\n\n' +
      'Quer que eu te mande o link do formulário?',

    geral:
      `${saudacao}! Obrigado pelo contato.\n\n` +
      'Me conta rapidamente o que você precisa, que eu já te direciono. Diagnóstico, crédito e marketing têm caminhos diferentes, e não quero te fazer perder tempo.',
  };
}

/**
 * O que fica no registro de eventos, para você ver o que chegou.
 *
 * É uma LISTA DO QUE ENTRA, não uma lista do que sai. A diferença
 * importa: com lista do que sai, um campo novo da Evolution passa a ser
 * guardado sozinho, e um dia isso é o texto de uma conversa.
 *
 * E texto de conversa não pode entrar aqui. O arquivo 32 promete que só
 * se guarda conversa de quem está no funil — fornecedor, conhecido e
 * engano ficam de fora. Guardar o payload cru neste registro anularia
 * essa promessa por uma porta lateral, e por trinta dias.
 *
 * O que se perde é pouco: quando algo dá errado no roteamento, o que
 * responde a pergunta é o formato do evento, não o que a pessoa disse.
 */
export function resumoDoEvento(bruto: unknown): Record<string, unknown> {
  const raiz = obj(bruto);
  const body = obj(raiz.body ?? raiz);
  const d = obj(body.data);
  const key = obj(d.key);
  const m = obj(d.message);
  const ctx = obj(obj(m.extendedTextMessage).contextInfo ?? d.contextInfo);

  return {
    event: str(body.event),
    instance: str(body.instance),
    date_time: str(body.date_time),
    sender: str(body.sender),
    key: {
      remoteJid: str(key.remoteJid),
      remoteJidAlt: str(key.remoteJidAlt),
      id: str(key.id),
      fromMe: key.fromMe === true,
    },
    messageType: str(d.messageType),
    pushName: str(d.pushName),
    // Só os NOMES dos campos da mensagem. Diz se veio texto, áudio ou
    // documento sem trazer nenhum deles.
    camposDaMensagem: Object.keys(m),
    externalAdReply: ctx.externalAdReply ?? null,
    conversionSource: ctx.conversionSource ?? null,
    entryPointConversionSource: ctx.entryPointConversionSource ?? null,
  };
}

export function normalizarEvento(bruto: unknown): MensagemNormalizada {
  // Aceita tanto o payload direto da Evolution quanto o embrulhado em
  // `body` que o n8n produzia. Custa uma linha e mantém o caminho de
  // volta funcionando enquanto a troca não estiver consolidada.
  const raiz = obj(bruto);
  const body = obj(raiz.body ?? raiz);
  const d = obj(body.data);
  const key = obj(d.key);
  const m = obj(d.message);

  // O texto pode vir em vários lugares conforme o tipo da mensagem.
  // Só tratamos texto: áudio, imagem e documento vão para atendimento humano.
  const texto = (
    str(m.conversation) ??
    str(obj(m.extendedTextMessage).text) ??
    str(obj(obj(m.ephemeralMessage).message).conversation) ??
    ''
  ).trim();

  const fromMe = key.fromMe === true;

  // De onde tirar o telefone para responder.
  //
  // O WhatsApp passou a enviar um LID no lugar do número:
  // "152003288269035@lid". É um identificador que esconde o telefone, e a
  // Evolution não consegue mandar mensagem para ele — a requisição é
  // aceita e a mensagem simplesmente não chega.
  //
  // Foi o defeito do primeiro teste: envio aceito, nada no celular.
  // Falha silenciosa é a pior espécie, por isso `temTelefone` existe e
  // tem motivo próprio.
  const jid = String(key.remoteJidAlt ?? key.remoteJid ?? '');
  const numero = jid.split('@')[0] ?? '';

  const ehGrupo = jid.endsWith('@g.us') || String(key.remoteJid ?? '').endsWith('@g.us');
  const temTelefone = jid.endsWith('@s.whatsapp.net') && /^\d{10,15}$/.test(numero);

  const recebidoEm = str(body.date_time);
  const saudacao = saudacaoDe(recebidoEm);

  // O código de origem que os botões do site colocam: "(ref: agendamento)".
  const achado = texto.match(/\(\s*ref\s*:\s*([a-z0-9-]+)\s*\)/i);
  const ref = achado?.[1] ? achado[1].toLowerCase() : null;

  const RESPOSTAS = respostas(saudacao);

  // Silêncio quando não há código de origem.
  //
  // Os botões do site sempre carregam o "(ref: ...)". Mensagem sem código
  // vem de quem já tem o número salvo — cliente atual, indicação,
  // conhecido. Essas pessoas receberem resposta de robô é pior do que não
  // receberem nada, porque quebra uma relação que já existe.
  //
  // É também o que faz a segunda mensagem da conversa ficar sem resposta
  // automática: a saudação é única, e dali em diante quem atende é gente.
  //
  // Ref começado por "anuncio" usa a resposta do anúncio; qualquer outro
  // ref desconhecido cai na geral. Um erro de digitação no texto do
  // anúncio não pode custar o lead — e vai haver erro de digitação.
  const chave = !ref
    ? null
    : RESPOSTAS[ref]
      ? ref
      : ref.startsWith('anuncio')
        ? 'anuncio'
        : 'geral';

  const responder = !fromMe && !ehGrupo && temTelefone && !!chave;

  // Registrar no CRM é decisão SEPARADA de responder.
  //
  // Hoje as duas coincidem, e é tentador reaproveitar a mesma variável.
  // Não reaproveita: no dia em que a resposta automática for desligada
  // para algum canal, o lead continuaria tendo de entrar no funil. Uma
  // variável só faria a mudança de uma coisa apagar a outra em silêncio.
  const registrar = !fromMe && !ehGrupo && temTelefone && !!ref;

  // O contexto do anúncio, quando a Evolution entrega algum.
  //
  // Guardado sem interpretar. Não sabemos com certeza o que um clique de
  // anúncio traz nesta versão, e a única forma de descobrir é olhar o que
  // chegou depois da campanha rodar. Não inclui o texto da mensagem de
  // propósito: é conversa de cliente, e não faz falta aqui.
  const ctx = obj(obj(m.extendedTextMessage).contextInfo ?? d.contextInfo);

  const contexto: Record<string, unknown> = {
    messageType: str(d.messageType),
    source: str(body.source) ?? str(d.source),
    externalAdReply: ctx.externalAdReply ?? null,
    conversionSource: ctx.conversionSource ?? null,
    entryPointConversionSource: ctx.entryPointConversionSource ?? null,
    entryPointConversionApp: ctx.entryPointConversionApp ?? null,
    recebido_em: recebidoEm,
  };

  const tipoMidia: TipoMidia | null = texto
    ? null
    : m.audioMessage
      ? 'audio'
      : m.imageMessage
        ? 'imagem'
        : m.documentMessage
          ? 'documento'
          : m.videoMessage
            ? 'video'
            : m.stickerMessage
              ? 'figurinha'
              : m.locationMessage
                ? 'localizacao'
                : m.contactMessage
                  ? 'contato'
                  : null;

  return {
    responder,
    motivo: fromMe
      ? 'mensagem própria'
      : ehGrupo
        ? 'mensagem de grupo'
        : !texto
          ? 'sem texto (áudio, imagem ou documento)'
          : !ref
            ? 'sem código de origem — atendimento humano'
            : !temTelefone
              ? 'só LID, sem telefone para responder'
              : 'ok',

    // A empresa NÃO vem daqui: é resolvida pela instância, na tabela
    // `whatsapp_instancias`. E não há valor padrão de propósito — um
    // padrão faria evento sem instância cair na empresa errada, que é o
    // pior defeito possível num sistema multiempresa. Sem instância,
    // nada é gravado.
    instancia: str(body.instance) ?? '',

    numero,
    jid,
    contato: str(d.pushName),
    origem: ref,
    saudacao,
    texto_recebido: texto.slice(0, 500),
    recebido_em: recebidoEm ?? new Date().toISOString(),
    resposta: responder && chave ? (RESPOSTAS[chave] ?? null) : null,
    registrar,
    contexto,

    de_mim: fromMe,
    wa_id: str(key.id),

    // `tipo_midia` guarda QUE houve um áudio, não o áudio — ver o
    // comentário da coluna no arquivo 32 do SQL.
    tipo_midia: tipoMidia,
    midia_nome: str(obj(m.documentMessage).fileName),

    // Guarda a conversa toda de quem é lead, inclusive o que sai daqui.
    // Só metade do diálogo não resolve divergência sobre o combinado.
    guardar: !ehGrupo && temTelefone,
  };
}
