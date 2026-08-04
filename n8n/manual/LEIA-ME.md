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

## Conferência antes de ativar

- [ ] O nó `Gmail — Relatório ao Cliente` foi apagado deste fluxo
- [ ] `Consolidar Diagnóstico` tem a linha `relatorio_detalhado_html`
- [ ] Os nomes dos cinco nós estão idênticos aos títulos acima
- [ ] A cadeia está ligada na ordem do topo deste arquivo
- [ ] `Montar Avisos` alimenta **os dois** nós de Gmail
