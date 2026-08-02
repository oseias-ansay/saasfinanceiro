# Diagnósticos — PDF, fila de envio e janela de revisão

A porta de entrada de clientes da Business Triage. O formulário do site
posta no n8n, que calcula os indicadores, pede os textos à IA e monta o
relatório.

O que mudou: **o relatório não sai mais na hora**.

## Por quê

Não é para parecer trabalhoso. É para existir uma janela em que um humano
pode ver o relatório antes do prospect.

Antes, o texto ia do modelo direto para quem preencheu o formulário, sem
ninguém no meio. Uma frase ruim da IA chegava como primeiro contato com a
consultoria. Agora o relatório fica guardado e sai no próximo dia útil às
8h — e entre uma coisa e outra você recebe o e-mail interno com um link
para segurar o envio.

O lead não fica no vácuo: recebe **na hora** uma confirmação com o
protocolo e a data em que o relatório chega.

O relatório também deixou de ser um e-mail HTML. Agora é um **PDF A4 com a
identidade visual da Business Triage**, arquivado no Google Drive e
anexado a um e-mail curto. Cliente de e-mail quebra layout, e um relatório
de consultoria dentro do corpo da mensagem parece newsletter.

```
formulário → cálculo → IA → grava no banco → renderiza o PDF → Drive
                                   ├─→ confirmação ao lead      (imediato)
                                   └─→ notificação interna       (imediato,
                                        com link do PDF e botão "Segurar")

     cron 8h, dias úteis → e-mail curto ao lead + PDF anexo
```

## Decisões que valem registrar

**8h, não de madrugada.** Um e-mail carimbado 03h14 grita "robô" tanto
quanto a entrega instantânea, e ainda chega no fundo da caixa de entrada.

**Próximo dia útil.** Formulário preenchido na sexta à noite sai na
segunda. Relatório chegando no sábado de manhã não é lido.

**Segurar, não aprovar.** O botão do e-mail interno suspende o envio. Não
fazer nada é a ação padrão e o relatório sai sozinho. Aprovação
obrigatória seria uma trava que derruba o atendimento no primeiro dia em
que você não olhar o celular — e o lead já foi avisado de que receberia.

**O HTML é gravado pronto.** A IA roda uma única vez, no envio do
formulário. O cron das 8h só entrega o que já existe: sem custo de token
novo, e sem o risco de o segundo texto sair diferente do que você revisou.

**Prospect não é tenant.** A tabela fica fora do modelo multiempresa.
Nenhum cliente logado no SaaS enxerga a base de leads — só o staff.

**O PDF é renderizado uma vez.** Fica no Storage e é reaproveitado. O
arquivo que você abre no Drive é byte a byte o que o cliente recebe às 8h.
Renderizar de novo no envio abriria espaço para o documento mudar entre a
revisão e a entrega — que é justamente o que a janela de revisão existe
para impedir.

**O e-mail é curto de propósito.** Ele existe para a pessoa abrir o anexo:
o score, três marcadores do que há dentro, e o convite para conversar. O
texto é montado pela API, não pelo n8n, para a mensagem e o documento não
contarem histórias diferentes.

**Chromium, e um render por vez.** Cada instância chega a 300MB de pico.
Num VPS que já carrega Postgres, Supabase e dois n8n, requisições
simultâneas derrubariam o servidor por causa de um relatório. A API
serializa as renderizações — com alguns diagnósticos por dia, não custa
nada e elimina a classe de problema.

## Instalação

### 1. Banco

Rode `supabase/sql/11_diagnosticos.sql` no SQL Editor. Depois confira as
duas contas de janela:

```sql
select public.fn_proxima_janela_envio('2026-08-07 22:00-03'::timestamptz);
-- esperado: 2026-08-10 08:00:00-03   (sexta à noite → segunda)

select public.fn_proxima_janela_envio('2026-08-04 09:00-03'::timestamptz);
-- esperado: 2026-08-05 08:00:00-03   (terça → quarta)
```

### 2. API

Novas variáveis no `.env` da API:

```
API_PUBLIC_URL=https://api-financeiro.businesstriage.com.br
CHROMIUM_PATH=/usr/bin/chromium-browser
```

A primeira monta o link "Segurar" e tem que ser o endereço público — o
link é aberto no celular, e `finance-api:3333` só existe dentro do Docker.

A imagem passou a instalar o Chromium e as fontes Noto. Sem as fontes o
PDF sai com quadrados no lugar dos acentos, e "Razão Social" vira
"Raz□o Social" na capa. A dependência nova é `puppeteer-core`, sem
navegador embutido: o Chromium que o `puppeteer` completo baixa é
compilado contra glibc e não roda no Alpine.

```bash
cd api && npm install && npm run build
docker compose up -d --build
```

O build fica alguns minutos mais lento e a imagem cresce cerca de 400MB.

Endpoints novos:

| Método | Rota | Uso |
|---|---|---|
| `POST` | `/api/v1/webhooks/n8n/diagnosticos` | Grava e enfileira |
| `GET` | `/api/v1/webhooks/n8n/diagnosticos/fila` | Fila liberada (cron 8h) |
| `GET` | `/api/v1/webhooks/n8n/diagnosticos/:protocolo/pdf` | Relatório em PDF |
| `POST` | `/api/v1/webhooks/n8n/diagnosticos/:protocolo/status` | enviado / falhou |
| `GET` | `/diagnosticos/segurar/:token` | **Público** — link do e-mail interno |

Teste o PDF antes de mexer no n8n, direto do servidor:

```bash
curl -s -H "x-n8n-secret: $SEGREDO" \
  http://localhost:3333/api/v1/webhooks/n8n/diagnosticos/PROTOCOLO/pdf \
  -o /tmp/teste.pdf && file /tmp/teste.pdf
```

Esperado: `PDF document, version 1.4`. Se vier `ASCII text`, o corpo é uma
mensagem de erro — abra o arquivo e leia.

A rota pública fica fora de `/api` de propósito: devolve uma página HTML
para um humano, não JSON para o front. A proteção é o token de 122 bits,
que serve a um diagnóstico só e para de funcionar depois do envio.

### 3. Fluxo do formulário (o que você já tem)

Abra o workflow **Diagnóstico Financeiro** e:

1. Copie o conteúdo de `n8n/patch-diagnostico-fila.json` e cole na tela
   (Ctrl+V). O n8n adiciona os quatro nós novos e já os liga.
2. Confira a cadeia:
   `Consolidar Diagnóstico → API — Enfileirar Diagnóstico → API — Baixar
   PDF → Drive — Arquivar Relatório → Montar Avisos → (Gmail Confirmação
   ao Lead + Gmail Notificação Interna)`.
3. **Apague o nó `Gmail — Relatório ao Cliente`.** Ele foi para o fluxo de
   envio. Deixá-lo aqui manda o relatório na hora e na manhã seguinte.
4. Credenciais: `Finance API - x-n8n-secret` nos dois nós de API, e a
   conta do Google no nó do Drive.
5. No nó `Drive — Arquivar Relatório`, escolha a pasta de destino.
6. **Uma linha em `Consolidar Diagnóstico`** — no objeto do `return`,
   acrescente:

   ```js
   relatorio_detalhado_html: ia.relatorioDetalhadoHtml || '',
   ```

   Sem isso o PDF sai sem a análise longa da IA. Aquele texto hoje só
   existe dentro do HTML do e-mail, e o PDF precisa dele solto.

Essa linha é a **única** alteração num nó existente, e não toca em nenhum
número. `Calcular Indicadores e Score` e `Gerar Análise (IA)` ficam
intactos — a régua do score continua exatamente como está.

### 4. Fluxo de envio

Importe `n8n/workflow-05-envio-diagnosticos.json`.

1. Credenciais nos cinco nós (Header Auth e Gmail).
2. **Settings → Timezone: `America/Sao_Paulo`.** Sem isso o cron dispara
   às 8h UTC, que são 5h da manhã aqui.
3. Rode manualmente uma vez, com um diagnóstico de teste na fila.
4. Ative.

### 5. Ajuste o texto do formulário

O site diz "você receberá o relatório em 24 horas". Agora isso é verdade —
antes era contradito pela entrega instantânea. Se quiser ser mais preciso:
"no próximo dia útil, pela manhã".

## Operação

Ver a fila:

```sql
select protocolo, razao_social, score_total, status, liberar_em, tentativas,
       pdf_path is not null as tem_pdf
from public.diagnosticos
order by created_at desc limit 20;
```

Forçar a regeração de um PDF (depois de mexer no template, por exemplo):

```sql
update public.diagnosticos set pdf_path = null where protocolo = 'XXXX-YYYY';
```

A próxima chamada ao endpoint renderiza de novo. Como o arquivo antigo já
está no Drive, substitua-o por lá também — senão você fica com duas
versões e nenhuma indicação de qual foi enviada.

Liberar algo que você segurou:

```sql
update public.diagnosticos
   set status = 'pendente', liberar_em = now()
 where protocolo = 'XXXXXXXX-YYYY';
```

Reenviar um que falhou:

```sql
update public.diagnosticos
   set status = 'pendente', tentativas = 0, erro = null
 where protocolo = 'XXXXXXXX-YYYY';
```

## Pendências assumidas

1. **O webhook do formulário continua aberto.** Cada POST custa uma
   chamada à API da Anthropic, e não há captcha nem rate limit. Um script
   consegue queimar orçamento numa madrugada. Resolver antes de divulgar o
   formulário para valer.
2. **Os tipos do banco não foram regerados.** `diagnosticos.routes.ts` usa
   um cliente destipado, isolado num bloco comentado no topo do arquivo.
   Ao regerar o `database.types.ts`, apague o bloco e volte a usar
   `supabaseAdmin` direto.
3. **O e-mail sai de uma conta Gmail**, não de `@businesstriage.com.br`.
   Para a porta de entrada, isso pesa na credibilidade. Depende do SMTP
   próprio funcionar.
6. **O template do PDF não foi visto num PDF de verdade.** Escrevi o CSS
   de impressão sem conseguir renderizar aqui — o ambiente Linux desta
   sessão não subiu. Gere o primeiro relatório e ajuste margens, quebras
   de página e tamanhos: é normal que a primeira volta precise de retoque.
7. **A capa usa a marca em texto**, não o logotipo. Se você tiver o
   arquivo, embuta em base64 no template (`template.ts`, função `capa`) —
   imagem por URL não é boa ideia num renderizador offline.
4. **Duas "margens de contribuição" com o mesmo nome** no fluxo
   financeiro: o score usa `(fat - cv) / fat` e a tabela de alertas usa
   `(fat - imp - cv) / fat`. Ambas chegam ao prompt com o mesmo rótulo e o
   modelo pode citar uma no resumo e outra na avaliação do pilar. Não
   mexi na régua nesta etapa — é decisão sua qual das duas fica.
5. **O diagnóstico comercial não foi alterado.** O mesmo patch serve, com
   `tipo: 'comercial'` no nó de enfileiramento e as referências trocadas
   de `Calcular Indicadores e Score` para `Calcular Score Comercial`.
