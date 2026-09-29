# Documentos de crédito → Google Drive

O fluxo `workflow-11-credito-drive.json` copia para o Drive os documentos que
o cliente envia pela plataforma. Ele é a **última** etapa do caminho, e não a
principal.

## O que já funciona sem este fluxo

O arquivo vai do navegador direto ao Supabase Storage, e a API registra o
envio. Para o cliente, o envio terminou ali — porque terminou mesmo: o
documento está guardado, com backup e com RLS.

Este fluxo só faz a **cópia** para o Drive. Se ele estiver desligado, com
credencial vencida ou fora do ar, ninguém perde documento: o registro fica com
`drive_file_id` nulo e entra na fila de reprocessamento.

É por isso que a funcionalidade pôde subir antes de existir conta do Google
conectada.

## Configuração, na ordem

### 1. A pasta raiz no Drive

Crie no Google Drive a pasta que vai guardar os dossiês — algo como
`Business Triage / Documentos de crédito`. Abra a pasta e copie o id da URL:

```
https://drive.google.com/drive/folders/1AbC...XyZ
                                       └── isto é o id
```

> **Conta de serviço não tem cota própria no "Meu Drive".** Se você for
> autenticar por service account em vez de OAuth, a pasta precisa estar num
> Drive compartilhado, ou ser criada por uma conta real e compartilhada com o
> e-mail da conta de serviço. Com OAuth da sua própria conta Google, não há
> essa restrição.

### 2. As variáveis do n8n

No `docker-compose.yml` do n8n, no serviço dele:

```yaml
environment:
  - DRIVE_PASTA_RAIZ=1AbC...XyZ
  - API_URL=https://api.businesstriage.com.br
  - N8N_WEBHOOK_SECRET=<o mesmo do .env da API>
```

Reinicie o container do n8n para que ele enxergue as variáveis.

### 3. Importar e conectar

No n8n: **Workflows → Import from File** → `workflow-11-credito-drive.json`.

Abra os dois nós do Google Drive — *Criar pasta da empresa* e *Subir para o
Drive* — e selecione a credencial. Ela não vem no arquivo, e não deveria vir.

### 4. Fechar o circuito

Ative o fluxo, copie a **URL de produção** do nó Webhook e ponha no `.env` da
API:

```
N8N_CREDITO_URL=https://n8n.seudominio.com.br/webhook/credito-documento
```

Reconstrua a API. A partir daí cada documento enviado dispara a cópia.

## Como a pasta por empresa funciona

Na primeira vez que uma empresa envia algo, `drive_folder_id` chega nulo. O
fluxo cria a pasta com o nome da empresa mais o CNPJ e devolve o id no
callback. A API guarda.

Nas vezes seguintes a API manda o id, e o fluxo pula a criação. Uma pasta por
cliente, para sempre — inclusive entre operações de crédito diferentes.

## Quando algo falha

A API registra a falha no próprio documento (`sync_erro`, `sync_tentativas`) e
a tela do consultor mostra quantos arquivos ainda não subiram.

Para reprocessar, consulte a fila:

```bash
curl -H "x-n8n-secret: $N8N_WEBHOOK_SECRET" \
  https://api.businesstriage.com.br/api/v1/webhooks/n8n/credito/pendentes
```

São no máximo três tentativas por arquivo. O limite existe para um documento
que o Drive recusa de verdade — formato bloqueado, cota estourada — não ficar
em laço escondendo os pendentes legítimos. Passadas as três, é caso de olhar o
`sync_erro` e resolver na mão.

## O que este fluxo não faz

Não apaga do Drive quando o cliente remove um documento na plataforma. É
deliberado: documento de análise de crédito que já circulou não deve sumir sem
alguém decidir isso. A remoção limpa o Storage e o registro; a cópia no Drive
fica, e o consultor apaga se quiser.
