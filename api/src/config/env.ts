import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3333),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

  N8N_WEBHOOK_SECRET: z.string().min(32, 'Use pelo menos 32 caracteres'),

  // Endereço público desta API. Usado para montar o link "Segurar" que vai
  // no e-mail interno de diagnóstico — o link precisa abrir no celular,
  // então não serve o hostname interno do Docker.
  API_PUBLIC_URL: z
    .string()
    .url()
    .default('https://api-financeiro.businesstriage.com.br')
    .transform((v) => v.replace(/\/+$/, '')),

  // Caminho do Chromium usado para gerar os PDFs dos diagnósticos.
  // No Alpine da imagem é /usr/bin/chromium-browser; em desenvolvimento
  // no Windows/macOS, aponte para o Chrome instalado.
  CHROMIUM_PATH: z.string().default('/usr/bin/chromium-browser'),
  // --- Meta Conversions API ---------------------------------------
  //
  // Vazias por padrão: a integração fica desligada até alguém preencher,
  // e desligada é o estado certo enquanto a política de privacidade não
  // disser que dados de contato podem ir para plataformas de anúncio.
  META_DATASET_ID: z.string().default(''),
  META_ACCESS_TOKEN: z.string().default(''),

  // A Meta aposenta versões do Graph API em ciclo de mais ou menos dois
  // anos, e evento enviado para versão aposentada para de ser aceito —
  // silenciosamente, que é o pior jeito. Fica em variável para a
  // atualização ser uma linha no .env, não um deploy.
  META_API_VERSION: z.string().default('v23.0'),

  // Enquanto preenchido, TODO evento vai como teste: aparece na aba
  // Eventos de Teste do Gerenciador e não conta para otimização. Apague
  // para valer de verdade.
  META_TEST_EVENT_CODE: z.string().default(''),

  // --- Evolution API (WhatsApp) -----------------------------------
  //
  // Endereço INTERNO do Docker. A porta pública foi fechada de
  // propósito, e um contêiner chamando o domínio público do próprio host
  // não completa a volta — já custou um dia de diagnóstico.
  EVOLUTION_URL: z
    .string()
    .url()
    .default('http://evolution:8080')
    .transform((v) => v.replace(/\/+$/, '')),

  EVOLUTION_APIKEY: z.string().default(''),

  // Segredo que a Evolution manda no cabeçalho do webhook.
  //
  // Vazio significa "usa o mesmo do n8n" — não significa "sem
  // verificação". A rota é alcançável pelo domínio público, e sem
  // segredo qualquer um criaria lead e mensagem falsos.
  EVOLUTION_WEBHOOK_TOKEN: z.string().default(''),

  // --- SMTP --------------------------------------------------------
  //
  // As MESMAS credenciais que o n8n já usava nos fluxos de entrada. Não
  // é servidor novo nem remetente novo: SPF, DKIM e reputação seguem
  // iguais, e a migração não mexe em entregabilidade.
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),

  EMAIL_REMETENTE: z.string().default('Business Triage <contato@businesstriage.com.br>'),
  EMAIL_INTERNO: z.string().default('contato@businesstriage.com.br'),

  // --- Claude (análise dos diagnósticos) ---------------------------
  //
  // Vazia por padrão: sem a chave, a geração de análise falha alto em vez
  // de produzir relatório pela metade.
  ANTHROPIC_API_KEY: z.string().default(''),

  // O modelo que o n8n usava. Fica em variável porque trocar de modelo é
  // decisão de custo e qualidade, não de deploy.
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-6'),

  // O mesmo teto do n8n. Abaixo disso o relatório detalhado sai cortado —
  // e cortado no meio de um JSON é o defeito mais chato de diagnosticar,
  // porque parece erro de formato.
  ANTHROPIC_MAX_TOKENS: z.coerce.number().int().min(1000).max(64000).default(16000),

  // Análise longa leva tempo. Dois minutos cobre o pior caso observado
  // com folga; abaixo disso o timeout vira falha intermitente sem causa
  // aparente.
  ANTHROPIC_TIMEOUT_MS: z.coerce.number().int().min(5000).max(600000).default(120000),

  // Disjuntor de gasto: quantas análises por dia, no máximo.
  //
  // Não é cota, é proteção contra defeito nosso e contra um dia muito
  // fora da curva. Deve ficar BEM acima do movimento normal — teto
  // apertado transforma um bom dia de campanha em prospect recusado, e
  // isso custa mais que a conta que ele evitaria.
  IA_LIMITE_DIARIO: z.coerce.number().int().min(1).max(100000).default(60),

  // --- Quem escreve o relatório ------------------------------------
  //
  // `ia` chama o Claude: texto que cruza indicadores, lê o campo livre
  // do cliente e adapta ao setor. Custa cerca de R$ 0,87 por relatório e
  // leva de dois a cinco minutos.
  //
  // `codigo` monta o texto a partir dos alertas da régua, em
  // milissegundos e de graça, com toda frase carregando um número do
  // cliente. A régua, o score e os indicadores são idênticos nos dois:
  // eles nunca dependeram de IA.
  //
  // O padrão continua `ia` para não mudar o que já está em produção. Na
  // rota pública, `?motor=codigo` sobrescreve — é assim que o
  // diagnóstico de evento sai sem custo enquanto o do lead qualificado
  // continua com a leitura fina.
  MOTOR_ANALISE: z.enum(['ia', 'codigo']).default('ia'),

  // --- Envio das 8h ------------------------------------------------
  //
  // Liga o relógio que esvazia a fila de diagnósticos financeiros.
  //
  // Desligado por padrão pelo mesmo motivo do vigia: um `npm run dev` na
  // sua máquina mandaria relatório de verdade para prospect de verdade.
  // Em produção precisa estar explicitamente `true` — e o vigia cobra se
  // alguém esquecer, porque `diagnosticos.envio` está no catálogo dele.
  DIAGNOSTICOS_ENVIO_ATIVO: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),

  // Hora local da janela. Muda junto com o texto do e-mail de
  // confirmação, que promete "pela manhã" — não é só um número.
  DIAGNOSTICOS_HORA_ENVIO: z.coerce.number().int().min(0).max(23).default(8),

  // --- Vigia -------------------------------------------------------
  //
  // Para onde vai o alarme quando um processo automático para. Telefone
  // em dígitos, com o 55 na frente.
  //
  // Vazio não desliga a vigilância: o alarme cai no log em nível de
  // erro. É pior que receber, e melhor que a impressão de estar
  // protegido sem estar.
  MONITOR_WHATSAPP: z.string().default(''),
  MONITOR_INSTANCIA: z.string().default('wa_ultimo'),

  // Ligar o relógio interno que roda a verificação.
  //
  // Desligado em desenvolvimento de propósito: cada `npm run dev` na sua
  // máquina mandaria alarme de verdade para o seu celular.
  MONITOR_ATIVO: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),

  // De quanto em quanto tempo o vigia olha. Dez minutos é curto o
  // bastante para você saber no mesmo turno e longo o bastante para não
  // pesar no banco.
  MONITOR_INTERVALO_MIN: z.coerce.number().int().min(1).max(720).default(10),

  // Hora local do pulso diário de "tudo certo".
  MONITOR_HORA_PULSO: z.coerce.number().int().min(0).max(23).default(7),

  // Origens liberadas no CORS.
  //
  // Cada domínio listado vale também na forma com `www`, e vice-versa.
  //
  // Não é conveniência: é a correção de um defeito real. O site responde
  // em `businesstriage.com.br` e em `www.businesstriage.com.br`, e o
  // navegador exige que o cabeçalho de CORS bata com a origem da página
  // caractere por caractere. Com só uma das duas na lista, metade dos
  // visitantes recebe "Failed to fetch" depois de dez minutos de
  // formulário preenchido — e nada aparece no log do servidor, porque a
  // requisição foi processada e quem recusou foi o navegador.
  //
  // As duas formas são o mesmo domínio registrado, do mesmo dono. Quem
  // confia numa confia na outra.
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((v) => {
      const base = v.split(',').map((s) => s.trim()).filter(Boolean);
      const comVariantes = base.flatMap((o) => {
        try {
          const u = new URL(o);

          // `localhost` e endereço de IP não têm forma com `www`. Gerar
          // `www.localhost` não quebra nada, mas suja a lista — e lista
          // suja é lista que ninguém revisa.
          const ehNome = u.hostname.includes('.') && !/^[\d.]+$/.test(u.hostname);
          if (!ehNome) return [o];

          const par = u.hostname.startsWith('www.')
            ? u.hostname.slice(4)
            : `www.${u.hostname}`;
          return [o, `${u.protocol}//${par}${u.port ? `:${u.port}` : ''}`];
        } catch {
          // Origem malformada passa adiante como está: quebrar a subida da
          // API por causa de uma vírgula sobrando seria pior.
          return [o];
        }
      });
      return [...new Set(comVariantes)];
    }),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // Falha rápido e alto: subir sem env correta é pior do que não subir.
  console.error('❌ Variáveis de ambiente inválidas:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
