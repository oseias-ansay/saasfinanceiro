# Tirar o n8n do caminho do WhatsApp

A Evolution passa a falar direto com a API. Um salto em vez de três, tudo
versionado e testado, e a volta atrás é mudar uma URL.

**Tempo:** vinte minutos. **Risco:** baixo — o fluxo 07 do n8n continua
intacto o tempo todo, e voltar para ele é o passo 7.

---

## Passo 0 — Enviar o código

```powershell
cd C:\Projetos\saasfinanceiro
git add -A
git commit -m "Evolution fala direto com a API: normalizador com testes, registro de eventos e rota propria"
git push
```

> Se o `git add` parecer não fazer nada e o `push` disser "Everything
> up-to-date", olhe se existe `.git\index.lock`. Já custou dois dias.

---

## Passo 1 — Rodar o SQL

No editor do Supabase, cole **`supabase/sql/33-para-colar.sql`** inteiro.

Confira:

```sql
select to_regclass('public.eventos_whatsapp')            as tabela,
       to_regproc('public.fn_registrar_evento_whatsapp') as grava,
       to_regproc('public.fn_purgar_eventos_whatsapp')   as purga;
```

Os três têm de vir preenchidos. Nulo em qualquer um: o arquivo não rodou
inteiro — role até o fim do resultado procurando o erro.

---

## Passo 2 — As variáveis novas

No servidor:

```bash
cd /opt/finance-src/api
grep AUTHENTICATION_API_KEY /opt/evolution/.env   # ou onde estiver o .env da Evolution
```

Acrescente ao `.env` da API:

```bash
cat >> /opt/finance-src/api/.env <<'EOF'
EVOLUTION_URL=http://evolution:8080
EVOLUTION_APIKEY=A_APIKEY_DA_EVOLUTION
EOF
```

`EVOLUTION_WEBHOOK_TOKEN` fica de fora de propósito: sem ele, a API usa o
`N8N_WEBHOOK_SECRET`, que já existe e já está no lugar. Um segredo a menos
para errar hoje.

---

## Passo 3 — Subir a API

```bash
cd /opt/finance-src && git pull
cd api && docker compose up -d --build finance-api
docker compose logs --tail 20 finance-api
```

---

## Passo 4 — A API alcança a Evolution?

Este é o único ponto de rede novo. Se os dois contêineres não estiverem na
mesma rede do Docker, a resposta automática falha — e falha em silêncio,
que é o modo que já custou caro aqui.

```bash
docker exec finance-api wget -qO- --timeout=5 http://evolution:8080/ && echo " ← alcança"
```

**`bad address 'evolution:8080'`** significa que os dois contêineres não
dividem rede nenhuma. Foi o caso aqui: a Evolution vive em
`evolution_evolution-net` e em `n8n-businestriage_n8n-net` (era por essa
segunda que o n8n a alcançava), e a API em `traefik-proxy` e
`supabase_default`.

A correção já está no `api/docker-compose.yml` — a rede da Evolution
entrou como terceira rede da API. Basta subir de novo:

```bash
cd /opt/finance-src && git pull
cd api && docker compose up -d finance-api
docker exec finance-api wget -qO- --timeout=5 http://evolution:8080/ && echo " ← alcança"
```

> **Não resolva isso com `docker network connect` à mão.** Funciona até o
> próximo `--build`, que recria o contêiner e perde a ligação. E a falha
> resultante é silenciosa: o cliente de envio nunca lança, então o lead
> continua sendo gravado e só a resposta some — ninguém percebe até
> alguém reclamar.

Se o nome da rede não bater com o do arquivo, confira o real e ajuste:

```bash
docker inspect evolution --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'
```

**Não siga com isso em aberto.**

---

## Passo 5 — Testar a rota antes de mexer na Evolution

Ainda com o n8n ativo. Isto não muda nada em produção: é o mesmo payload
que a Evolution manda, entregue à mão.

```bash
SEG=$(grep '^N8N_WEBHOOK_SECRET=' /opt/finance-src/api/.env | cut -d= -f2- | tr -d '"'"'"'\r')

docker exec finance-api wget -qO- \
  --header="Content-Type: application/json" \
  --header="x-evolution-token: $SEG" \
  --post-data='{"instance":"wa_ultimo","date_time":"2026-09-04T13:00:00.000Z","data":{"key":{"remoteJid":"554196968720@s.whatsapp.net","id":"DIRETO-A1","fromMe":false},"message":{"conversation":"oi (ref: anuncio)"},"messageType":"conversation","pushName":"Teste Direto"}}' \
  http://localhost:3333/api/v1/webhooks/evolution/inbound
```

Esperado, mais ou menos assim:

```json
{"data":{"ok":true,"motivo":"ok","lead_id":"…","lead_criado":false,"mensagem_id":"…","respondido":true,"resposta_id":"…"}}
```

E no Supabase:

```sql
select veredito, motivo, resultado, erro
from public.vw_eventos_whatsapp
order by recebido_em desc limit 5;
```

**`veredito` diz onde parou.** É a tela que substitui a lista de execuções
do n8n, e ela compara o que a API decidiu com o que de fato conseguiu
fazer — que é onde toda falha silenciosa desta integração mora.

Troque o `id` a cada execução: o índice único de `lead_mensagens` descarta
repetido sem avisar.

---

## Passo 6 — Apontar a Evolution para a API

Só agora. Na configuração de webhook da instância `wa_ultimo`:

| Campo | Valor |
|---|---|
| URL | `http://finance-api:3333/api/v1/webhooks/evolution/inbound` |
| Eventos | `MESSAGES_UPSERT` |
| Cabeçalho | `x-evolution-token` = o mesmo hex de 64 caracteres |

Pela API da Evolution, se preferir:

```bash
APIKEY=$(grep '^AUTHENTICATION_API_KEY=' /opt/evolution/.env | cut -d= -f2- | tr -d '"'"'"'\r')
SEG=$(grep '^N8N_WEBHOOK_SECRET=' /opt/finance-src/api/.env | cut -d= -f2- | tr -d '"'"'"'\r')

# O wget de dentro do contêiner é BusyBox: não tem --method, e --post-data
# já obriga o POST.
docker exec evolution sh -c "wget -qO- \
  --header='Content-Type: application/json' \
  --header='apikey: $APIKEY' \
  --post-data='{\"webhook\":{\"enabled\":true,\"url\":\"http://finance-api:3333/api/v1/webhooks/evolution/inbound\",\"headers\":{\"x-evolution-token\":\"$SEG\"},\"byEvents\":false,\"events\":[\"MESSAGES_UPSERT\"]}}' \
  http://localhost:8080/webhook/set/wa_ultimo"
```

Confira o que ficou gravado:

```bash
docker exec evolution sh -c "wget -qO- --header='apikey: $APIKEY' http://localhost:8080/webhook/find/wa_ultimo"
```

> A v2.3.7 aceita `headers` — o `webhook/find` mostra o campo, e era a
> única dúvida que restava. Se numa instalação futura ele for ignorado, a
> API responde 401 e nada é gravado: não improvise tirando a guarda, que
> a rota é alcançável pelo domínio público e sem ela qualquer um cria
> lead falso e envenena a otimização da campanha.

Em seguida, **desative o fluxo 07 no n8n** — com os dois ligados, cada
mensagem entraria duas vezes. A deduplicação por `wa_id` e por telefone
segura, mas contar com ela para uma coisa evitável é pedir para descobrir
o buraco dela num dia ruim.

---

## Passo 7 — O teste de verdade, e a volta atrás

Do seu celular, para o número da Business Triage:

| Mande | Esperado |
|---|---|
| `oi (ref: anuncio)` | Resposta do anúncio, card novo no funil, duas mensagens no histórico (a sua e a resposta) |
| a mesma coisa de novo | Sem resposta automática, **nenhum card novo**, mas a mensagem entra no histórico |
| `bom dia, tudo bem?` | Sem resposta, e a mensagem entra na conversa do card |

```sql
select veredito, count(*)
from public.vw_eventos_whatsapp
where recebido_em > now() - interval '1 hour'
group by veredito;
```

**Voltar atrás**, se algo não fechar: aponte o webhook da Evolution de
volta para o endereço que estava lá antes:

```
https://n8n.businesstriage.com.br/webhook/whatsapp-inbound
```

e reative o fluxo 07. Nada foi apagado.

> Repare no ponto em vez de hífen: `n8n.businesstriage`, não
> `n8n-businesstriage`. Os dois domínios existem, e apontam para
> instalações diferentes do n8n.

---

## O que muda no dia a dia

**Some:** a lista de execuções do n8n para o WhatsApp.

**Entra:** `vw_eventos_whatsapp`, que é consultável, cruza com o resto do
banco e diz o veredito em vez de exigir abrir evento por evento.

**Continua no n8n:** os fluxos 09 e 10, que rodam por relógio e não têm
lógica — é o que ele faz bem.

**Passa a ser possível:** mudar a resposta automática num commit, com
teste, em vez de num campo de texto sem histórico.

---

## Uma coisa que ficou melhor sem ter sido pedida

O n8n guardava só o que o cliente escrevia. Agora a resposta automática
também entra no histórico, porque quem grava e quem responde são o mesmo
processo.

Metade do diálogo não resolve divergência sobre o que foi combinado — e
resolver divergência é justamente para o que esse histórico existe.
