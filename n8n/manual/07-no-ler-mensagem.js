// Conteúdo do nó "Ler Mensagem e Escolher Resposta" do fluxo 07.
//
// Cole isto SUBSTITUINDO todo o código atual do nó. Ele passa a produzir
// os campos que os quatro nós novos consomem: registrar, guardar,
// contexto, de_mim, wa_id e tipo_midia.
//
// A empresa NÃO vem daqui — é resolvida pela API a partir da instância.

// ============================================================
// Normaliza o evento da Evolution e decide se responde.
//
// O formato veio dos logs reais da instância, não de documentação:
// { event, instance, data: { key: { remoteJid, remoteJidAlt, fromMe, id },
//   message, messageType, pushName }, sender, date_time }
// ============================================================

const e = $input.first().json;
const body = e.body || e;
const d = body.data || {};
const key = d.key || {};

// O texto pode vir em vários lugares conforme o tipo da mensagem.
// Só tratamos texto: áudio, imagem e documento vão para atendimento humano.
const m = d.message || {};
const texto = (
  m.conversation ||
  (m.extendedTextMessage && m.extendedTextMessage.text) ||
  (m.ephemeralMessage && m.ephemeralMessage.message && m.ephemeralMessage.message.conversation) ||
  ''
).trim();

const fromMe = key.fromMe === true;

// De onde tirar o telefone para responder.
//
// O WhatsApp passou a enviar um LID no lugar do número: "152003288269035@lid".
// É um identificador que esconde o telefone, e a Evolution não consegue mandar
// mensagem para ele — a requisição é aceita e a mensagem simplesmente não chega.
// Quando o LID aparece, o telefone real vem em remoteJidAlt.
//
// Este foi o defeito do primeiro teste: o fluxo repassava o remoteJid cru, o
// envio era aceito e nada chegava no celular. Falha silenciosa é a pior espécie,
// por isso agora existe o campo `temTelefone` e um motivo próprio para ela.
const jid = String(key.remoteJidAlt || key.remoteJid || '');
const numero = jid.split('@')[0];

const ehGrupo = jid.endsWith('@g.us') || String(key.remoteJid || '').endsWith('@g.us');
const temTelefone = jid.endsWith('@s.whatsapp.net') && /^\d{10,15}$/.test(numero);

// Saudação conforme a hora de Brasília.
//
// O horário sai do próprio evento, não do relógio do servidor: se a execução
// atrasar numa fila, a saudação continua coerente com o momento em que a
// pessoa escreveu. O fuso é fixado em America/Sao_Paulo porque o contêiner
// roda em UTC — sem isso, toda mensagem da noite viraria "bom dia".
const quando = new Date(body.date_time || Date.now());
const instante = isNaN(quando.getTime()) ? new Date() : quando;
const hora = Number(
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: 'numeric',
    hour12: false
  }).format(instante)
);
const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';

// O código de origem que os botões do site colocam: "(ref: agendamento)".
const achado = texto.match(/\(\s*ref\s*:\s*([a-z0-9-]+)\s*\)/i);
const ref = achado ? achado[1].toLowerCase() : null;

const RESPOSTAS = {
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
    'Me conta rapidamente o que você precisa, que eu já te direciono. Diagnóstico, crédito e marketing têm caminhos diferentes, e não quero te fazer perder tempo.'
};

// Silêncio quando não há código de origem.
//
// Os botões do site sempre carregam o "(ref: ...)". Mensagem sem código vem
// de quem já tem o número salvo — cliente atual, indicação, conhecido. Essas
// pessoas receberem resposta de robô é pior do que não receberem nada,
// porque quebra uma relação que já existe. O evento fica registrado na
// execução para você ver e responder à mão.
//
// É também o que faz a segunda mensagem da conversa ficar sem resposta
// automática: a saudação é única, e dali em diante quem atende é o consultor.
// Ref começado por "anuncio" usa a resposta do anúncio; qualquer outro
// ref desconhecido cai na geral. Um erro de digitação no texto do
// anúncio não pode custar o lead — e vai haver erro de digitação.
const chave = !ref ? null
            : RESPOSTAS[ref] ? ref
            : ref.startsWith('anuncio') ? 'anuncio'
            : 'geral';

const responder = !fromMe && !ehGrupo && temTelefone && !!chave;

// Registrar no CRM é decisão SEPARADA de responder.
//
// Hoje as duas coincidem, e é tentador reaproveitar a mesma variável.
// Não reaproveita: no dia em que uma resposta automática for desligada
// para algum canal, o lead continuaria tendo de entrar no funil. Uma
// variável só faria a mudança de uma coisa apagar a outra em silêncio.
const registrar = !fromMe && !ehGrupo && temTelefone && !!ref;

// O contexto do anúncio, quando a Evolution entrega algum.
//
// Guardamos o objeto sem interpretar. Não sabemos com certeza o que um
// clique de anúncio traz nesta versão — e a única forma de descobrir é
// olhar o que chegou depois da campanha rodar. Não inclui o texto da
// mensagem de propósito: é conversa de cliente, e não faz falta aqui.
const ctx = (m.extendedTextMessage && m.extendedTextMessage.contextInfo)
         || d.contextInfo
         || null;

const contexto = {
  messageType: d.messageType || null,
  source: body.source || d.source || null,
  externalAdReply: (ctx && ctx.externalAdReply) || null,
  conversionSource: (ctx && ctx.conversionSource) || null,
  entryPointConversionSource: (ctx && ctx.entryPointConversionSource) || null,
  entryPointConversionApp: (ctx && ctx.entryPointConversionApp) || null,
  recebido_em: body.date_time || null
};

// A empresa NÃO vem daqui.
//
// Ela é resolvida pela API a partir do nome da instância, na tabela
// `whatsapp_instancias`. Assim este fluxo atende a rede inteira: ligar
// um cliente novo é uma linha no banco, não uma cópia deste fluxo.
return [{
  json: {
    responder,
    motivo: fromMe ? 'mensagem própria'
          : ehGrupo ? 'mensagem de grupo'
          : !texto ? 'sem texto (áudio, imagem ou documento)'
          : !ref ? 'sem código de origem — atendimento humano'
          : !temTelefone ? 'só LID, sem telefone para responder'
          : 'ok',
    instancia: body.instance || 'wa_ultimo',
    numero,
    jid,
    contato: d.pushName || null,
    origem: ref,
    saudacao,
    texto_recebido: texto.slice(0, 500),
    recebido_em: body.date_time || new Date().toISOString(),
    resposta: responder ? RESPOSTAS[chave] : null,
    registrar,
    contexto,

    // Para o histórico. `tipo_midia` guarda QUE houve um áudio, não o
    // áudio — ver o comentário da coluna no arquivo 32 do SQL.
    de_mim: fromMe,
    wa_id: key.id || null,
    tipo_midia: texto ? null
      : m.audioMessage ? 'audio'
      : m.imageMessage ? 'imagem'
      : m.documentMessage ? 'documento'
      : m.videoMessage ? 'video'
      : m.stickerMessage ? 'figurinha'
      : m.locationMessage ? 'localizacao'
      : m.contactMessage ? 'contato'
      : null,
    midia_nome: (m.documentMessage && m.documentMessage.fileName) || null,

    // Guarda a conversa toda de quem é lead, inclusive o que sai daqui.
    // Só metade do diálogo não resolve divergência sobre o combinado.
    guardar: !ehGrupo && temTelefone
  }
}];
