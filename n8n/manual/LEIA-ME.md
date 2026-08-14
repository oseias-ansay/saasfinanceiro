# Montagem manual dos nós — Diagnóstico Financeiro

Use quando a cola no canvas do n8n (Ctrl+V) não funcionar. Colar **dentro
de campos** funciona normalmente, então os trechos longos estão em
arquivos separados nesta pasta.

Cinco nós, na ordem em que devem ser ligados:

```
Consolidar Diagnóstico
  → API — Enfileirar Diagnóstico
  → API — Baixar PDF
  → Drive — Arquivar Relatório
  → Montar Avisos
  → Gmail — Confirmação ao Lead
  → Gmail — Notificação Interna   (já existe)
```

Renomear cada nó **exatamente** como abaixo importa: o código do
`Montar Avisos` chama os nós pelo nome. Um acento fora do lugar quebra.

---

## 1. API — Enfileirar Diagnóstico

Tipo: **HTTP Request**

| Campo | Valor |
|---|---|
| Method | `POST` |
| URL | `http://finance-api:3333/api/v1/webhooks/n8n/diagnosticos` |
| Authentication | `Generic Credential Type` → `Header Auth` |
| Credential | `Finance API - x-n8n-secret` |
| Send Body | ligado |
| Body Content Type | `JSON` |
| Specify Body | `Using JSON` |
| JSON | conteúdo de `01-corpo-enfileirar.txt` |

No campo JSON, clique no ícone de expressão (**fx**) antes de colar.

Em **Settings** do nó: `Retry On Fail` ligado, `Max Tries` 3,
`Wait Between Tries` 5000.

---

## 2. API — Baixar PDF

Tipo: **HTTP Request**

| Campo | Valor |
|---|---|
| Method | `GET` |
| URL (expressão) | `http://finance-api:3333/api/v1/webhooks/n8n/diagnosticos/{{ $json.protocolo }}/pdf` |
| Authentication | `Generic Credential Type` → `Header Auth` |
| Credential | `Finance API - x-n8n-secret` |

Em **Options**, adicione:

- `Response` → `Response Format`: **File**
- `Response` → `Put Output in Field`: `data`
- `Timeout`: `60000`

O formato **File** é o que importa: sem ele o PDF chega como texto
corrompido e o anexo não abre.

Settings: `Retry On Fail` ligado, 3 tentativas, 8000 ms.

---

## 3. Drive — Arquivar Relatório

Tipo: **Google Drive** · Resource `File` · Operation `Upload`

| Campo | Valor |
|---|---|
| Credential | crie uma nova, do tipo **Google Drive OAuth2 API** |
| Input Data Field Name | `data` |
| File Name (expressão) | `{{ $binary.data.fileName }}` |
| Parent Drive | `My Drive` |
| Parent Folder | a pasta que você criou |

A credencial do Gmail **não serve** aqui. O n8n trata Google Drive como
credencial separada, com escopo próprio.

Settings: `Retry On Fail` ligado, 3 tentativas, 5000 ms.

---

## 4. Montar Avisos

Tipo: **Code** · Mode `Run Once for All Items` · Language `JavaScript`

Cole o conteúdo de `02-montar-avisos.js`.

---

## 5. Gmail — Confirmação ao Lead

Tipo: **Gmail** · Resource `Message` · Operation `Send`

| Campo | Valor |
|---|---|
| To (expressão) | `{{ $json.email_cliente }}` |
| Subject (expressão) | `{{ $json.assunto_confirmacao }}` |
| Message (expressão) | `{{ $json.html_confirmacao }}` |
| Credential | a conta Gmail que já existe |

Em **Settings**, `On Error`: `Continue (using regular output)` — uma falha
no e-mail de confirmação não pode derrubar a execução depois de o
diagnóstico já estar gravado.

---

## 6. Nó já existente

`Gmail — Notificação Interna` continua como está. Só precisa ser religado
para receber de `Montar Avisos`, e não mais de `Consolidar Diagnóstico`.

---

## Autenticação dos nós que chamam a API

**Não use credencial Header Auth nestes nós.** Use `Authentication: None` +
`Send Headers` → `Using Fields Below`, com `x-n8n-secret` no Name e o valor
de `N8N_WEBHOOK_SECRET` no Value.

A razão é operacional, não técnica. O campo de credencial mascara o valor,
então quando algo não bate não há como ver o que está lá — só tentar de novo.
Com o cabeçalho no próprio nó, o valor aparece no JSON exportado do workflow
e o erro se resolve olhando.

Foi o que custou uma tarde inteira: uma credencial `Header Auth account`
servia ao mesmo tempo os oito nós da API (cabeçalho `x-n8n-secret`) e o nó de
envio da Evolution (cabeçalho `apikey`). No n8n as credenciais são globais.
Ao ajustar o cabeçalho para o WhatsApp funcionar, os dois fluxos de
diagnóstico quebraram em silêncio — e só apareceu dias depois, num
diagnóstico real.

Duas lições que valem além deste caso:

- Antes de editar uma credencial, procure quem mais a usa. Uma credencial
  compartilhada entre serviços diferentes é uma bomba-relógio.
- Segredo mascarado impede diagnóstico. Quando o valor é interno e o
  ambiente é de uso próprio, campo visível compensa.

Para recuperar o segredo:

```bash
docker exec finance-api printenv N8N_WEBHOOK_SECRET
```

---

## Conferência antes de ativar

- [ ] O nó `Gmail — Relatório ao Cliente` foi apagado deste fluxo
- [ ] `Consolidar Diagnóstico` tem a linha `relatorio_detalhado_html`
- [ ] Os nomes dos cinco nós estão idênticos aos títulos acima
- [ ] A cadeia está ligada na ordem do topo deste arquivo
- [ ] `Montar Avisos` alimenta **os dois** nós de Gmail
