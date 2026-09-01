# Onde paramos — 31/08/2026

Retome por aqui. O guia completo é `IMPLANTACAO-CRM-META.md`; este arquivo
diz só o que já está feito e qual é o próximo movimento.

## Pronto e verificado

- **Banco.** Arquivos `30`, `31` e `32` rodaram. As colunas novas de
  `leads` existem, `whatsapp_instancias` e `lead_mensagens` existem, e
  `fn_tenant_tem_recurso(business_triage, 'crm')` devolve `true`.
- **Instância cadastrada** e CRM liberado como piloto.
- **API no ar.** Confirmado pelo teste da rota: `POST .../whatsapp/contato`
  responde 401, ou seja, existe e recusou por falta de segredo.
- **Site publicado**, com a política de privacidade revisada.

## O próximo passo: terminar o fluxo 07 no n8n

**Não importe o arquivo por cima.** O fluxo em produção divergiu do
repositório: no n8n, o nó *Evolution — Enviar Resposta* usa a apikey
escrita direto no cabeçalho; no repositório ele usa credencial. Importar
trocaria isso e poderia quebrar o envio das respostas.

Faltam três coisas, nesta ordem:

### 1. Colar os quatro nós novos

Estão em `n8n/nos-novos-fluxo-07.json`. Copie o conteúdo do arquivo e dê
`Ctrl+V` com o canvas do fluxo 07 aberto — o n8n cria os quatro já
ligados entre si.

### 2. Trocar o código do nó "Ler Mensagem e Escolher Resposta"

O conteúdo novo está em `n8n/manual/07-no-ler-mensagem.js`. Substitua
todo o código do nó por ele. É o que passa a produzir `registrar`,
`guardar`, `contexto`, `de_mim`, `wa_id` e `tipo_midia` — sem isso os
nós novos recebem `undefined` e não fazem nada.

### 3. Ligar e configurar

- Arraste **duas** conexões da saída de *Ler Mensagem e Escolher
  Resposta*: uma para **Registrar no CRM?**, outra para **Guardar
  Conversa?**. O mesmo ponto de saída aceita várias.
- Troque `COLE_AQUI_O_SEGREDO` nos dois nós de HTTP, com o
  `N8N_WEBHOOK_SECRET` do `.env` da API.
- Salve e ative.

### Antes de testar: confirme o nome da instância

Errar aqui não gera erro nenhum — simplesmente não grava.

```bash
docker logs evolution --tail 200 2>&1 | grep -o '"instance":"[^"]*"' | sort -u
```

```sql
select instancia, rotulo, ativa from public.whatsapp_instancias;
```

Se divergirem:

```sql
update public.whatsapp_instancias
   set instancia = 'O_NOME_REAL' where instancia = 'wa_ultimo';
```

### O teste

Do seu celular pessoal, para o número da Business Triage:

| Mande | Esperado |
|---|---|
| `oi (ref: anuncio)` | Resposta automática do anúncio + card novo no funil |
| a mesma coisa de novo | Sem resposta, e **nenhum card novo** |
| `bom dia, tudo bem?` | Sem resposta, mas a mensagem aparece na conversa do card |

O segundo é o que importa: conversa de WhatsApp tem dez mensagens, e dez
cards por pessoa dividiriam o CAC pelo número errado.

Depois abra o card e veja se a conversa aparece acima das anotações.

Se não gravar, olhe a execução no n8n — os nós de HTTP mostram a resposta
da API, que diz o motivo: `instancia_desconhecida`, `sem_crm`, ou lead
não encontrado.

## Depois disso

- **Passo 6** — ativar o fluxo 10 (expurgo). Dispare uma vez à mão; deve
  responder `{"apagadas": 0}`.
- **Passo 7** — configurar a Meta em modo de teste.
- **Passo 8** — apagar `META_TEST_EVENT_CODE` e reiniciar. Esquecer essa
  linha preenchida faz a campanha rodar sem sinal nenhum, sem aviso.
- **Passo 9** — pôr `(ref: anuncio)` na mensagem pré-preenchida do
  anúncio. **É o único item que não dá para corrigir depois:** clique que
  chegou sem o código não volta.

## Duas credenciais para trocar

Ambas apareceram em texto claro em conversa e continuam válidas:

1. **Apikey da Evolution** (`DpznNypd1968@...`). Dá controle total sobre o
   WhatsApp conectado — mandar mensagem para qualquer número em seu nome.
2. **`N8N_WEBHOOK_SECRET`.** `openssl rand -hex 32`, atualizar o `.env`,
   reiniciar a API e trocar em todos os nós. Com os fluxos 09 e 10, são
   mais dois lugares.

Não é urgente ao ponto de parar a implantação, mas é a primeira coisa
depois que a campanha estiver de pé.

**Restrição a preservar:** não mova esses cabeçalhos para credenciais de
Header Auth do n8n. Elas são globais entre workflows e mascaradas, o que
já fez "chave errada" ficar indistinguível de "chave vazia" e quebrou oito
nós de diagnóstico de uma vez. Mantenha `Authentication: None` com o
cabeçalho visível em `Send Headers`.

## Pendências antigas, ainda abertas

- **O formulário do site não cria lead no CRM.** A UTM já é capturada e
  viaja no envio em `atribuicao`, mas o n8n ainda não faz nada com ela.
- **Tela de canais e CAC.** A view e a rota existem; falta a tela. É o que
  permitiria acompanhar a campanha sem abrir o banco.
- **O ensaio da jornada** (`ENSAIO.md`), nunca percorrido.
