# Onde paramos — 04/09/2026

**Retome por `TROCA-EVOLUTION-DIRETO.md`.** É o passo a passo da mudança
que fizemos hoje, com o caminho de volta em cada etapa.

## A decisão de hoje: o n8n sai do caminho do WhatsApp

A Evolution passa a falar direto com a API.

O motivo não foi preferência. Foram dois dias de diagnóstico em três
defeitos que só existiam por causa do n8n estar no meio, e nenhum deles
dava erro:

- o n8n **aborta a execução inteira** quando um nó falha, então os três
  ramos desenhados como paralelos não eram independentes: a falha do
  envio da resposta levava junto o registro do lead;
- execução no n8n é **fotografia imutável**, então reabrir uma antiga
  mostrava para sempre o segredo velho — "eu já troquei" e "não colou"
  eram indistinguíveis;
- o nó chamava o **domínio público** da própria API, e um contêiner
  chamando o host de fora não completa a volta. Timeout, sem mensagem.

O teste direto de ontem provou que API, banco, segredo e rede estavam
todos certos. O que sobrava era só o n8n.

### O que ficou pronto

| Arquivo | O que é |
|---|---|
| `api/src/modules/webhooks/evolution.normalizar.ts` | O nó de código do n8n, agora versionado — **29 testes** |
| `api/src/modules/webhooks/evolution.processar.ts` | A ordem dos passos e o isolamento das falhas — **13 testes** |
| `api/src/modules/webhooks/evolution.routes.ts` | A rota `POST /api/v1/webhooks/evolution/inbound` |
| `api/src/modules/webhooks/whatsapp.service.ts` | As regras de banco, uma cópia só, usada pelos dois caminhos |
| `api/src/lib/evolution.ts` | O cliente de envio, que **nunca lança** |
| `supabase/sql/33_eventos_whatsapp.sql` | O registro de eventos, que substitui a lista de execuções |
| `TROCA-EVOLUTION-DIRETO.md` | O passo a passo, com rollback |

**84 testes passando**, build limpo, e a rota verificada de ponta a ponta:
401 sem segredo, 401 com segredo errado, 200 com o certo.

### Duas coisas melhoraram sem ter sido pedidas

**A resposta automática agora entra no histórico.** O n8n guardava só o
que o cliente escrevia. Metade do diálogo não resolve divergência sobre o
que foi combinado — que é para o que esse histórico existe.

**`vw_eventos_whatsapp` tem uma coluna `veredito`** que compara o que a
API decidiu com o que ela conseguiu fazer. É onde toda falha silenciosa
desta integração aparece, e não existia equivalente no n8n.

```sql
select veredito, count(*)
from public.vw_eventos_whatsapp
where recebido_em > now() - interval '1 day'
group by veredito;
```

### O que continua no n8n

Os fluxos **09** (eventos para a Meta) e **10** (expurgo das mensagens).
Rodam por relógio e não têm lógica — é o que o n8n faz bem.

**Antes de ativá-los**, troque a URL pública pela interna nos dois: eles
têm exatamente o mesmo defeito que custou os dois dias.

## Se preferir consertar o n8n em vez de trocar

O fluxo 07 continua intacto e é o caminho de volta. Faltavam duas coisas:

1. `On Error → Continue` no nó *Evolution — Enviar Resposta* (aba
   Settings). Sem isso ele derruba a execução inteira.
2. URL interna nos dois nós de API:
   `http://finance-api:3333/api/v1/webhooks/n8n/whatsapp/contato` e
   `.../mensagem`.

Os arquivos `n8n/workflow-07-whatsapp-inbound.json` e
`n8n/nos-novos-fluxo-07.json` já foram corrigidos no repositório — antes
estavam com a URL pública e sem `onError`, ou seja, quem copiasse deles
reintroduziria o defeito.

## O comando que vale guardar

Divide o problema em dois em dez segundos. Se der `gravada:true`, o que
estiver errado está no n8n ou na Evolution, não na API nem no banco.

```bash
SEG=$(grep '^N8N_WEBHOOK_SECRET=' /opt/finance-src/api/.env | cut -d= -f2- | tr -d '"'"'"'\r')

docker exec finance-api wget -qO- \
  --header="Content-Type: application/json" \
  --header="x-n8n-secret: $SEG" \
  --post-data='{"instancia":"wa_ultimo","telefone":"554196968720","de_mim":false,"texto":"teste direto","wa_id":"DIRETO003","enviada_em":"2026-09-05T12:00:00.000Z"}' \
  http://localhost:3333/api/v1/webhooks/n8n/whatsapp/mensagem
```

**Troque o `wa_id` a cada execução** — o índice único descarta repetido
em silêncio.

## Depois da troca

- **Passo 7** — configurar a Meta em modo de teste.
- **Passo 8** — apagar `META_TEST_EVENT_CODE`. Esquecer essa linha
  preenchida faz a campanha rodar sem sinal nenhum, sem aviso.
- **Passo 9** — pôr `(ref: anuncio)` na mensagem pré-preenchida do
  anúncio. **É o único item que não dá para corrigir depois:** clique que
  chegou sem o código não volta. A campanha começa em dias.

## Duas credenciais para trocar

1. **Apikey da Evolution** (`DpznNypd1968@…`). Apareceu várias vezes em
   conversa. Dá controle total sobre o WhatsApp conectado. Agora ela
   também vai para o `.env` da API — troque antes, não depois.
2. **`N8N_WEBHOOK_SECRET`.** `openssl rand -hex 32`, atualizar o `.env`,
   reiniciar a API. Com a Evolution falando direto, o número de lugares
   onde ele aparece caiu de quatro para um.

**Restrição a preservar:** se voltar para o n8n, não mova esses
cabeçalhos para credenciais de Header Auth. São globais entre workflows e
mascaradas, o que já fez "chave errada" ficar indistinguível de "chave
vazia" e quebrou oito nós de uma vez.

## Pendências antigas

- O formulário do site ainda não cria lead no CRM (a UTM já é capturada e
  viaja em `atribuicao`, mas ninguém a consome).
- Tela de canais e CAC: a view e a rota existem, falta a tela.
- O ensaio da jornada (`ENSAIO.md`), nunca percorrido.
