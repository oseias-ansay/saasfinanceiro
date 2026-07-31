# Etapa 3 — Workflows n8n

Decisões desta etapa: **in-app + e-mail**, **só o gestor**, **acesso via API**.
Nenhum workflow fala com o Postgres direto e o n8n **não** recebe a
`service_role key` — se o n8n for comprometido, o atacante fica limitado aos
três endpoints de webhook, não ao banco inteiro.

---

## Objetivo de cada fluxo

| Workflow | Quando roda | O que faz |
|---|---|---|
| **01 — Gerar Recorrentes** | Todo dia, 03:00 | Materializa as próximas parcelas de aluguel, salários, assinaturas |
| **02 — Alerta Diário** | Dias úteis, 08:00 | E-mail ao gestor + notificação in-app com vencimentos, atrasos e alerta de caixa negativo |

---

## Pré-requisitos

### 1. Rodar o SQL complementar

```
supabase/sql/06_notifications.sql
```

Cria a tabela `notifications`, a RPC `fn_notify()` e a `fn_digest_all()` — que
devolve, numa única consulta, o resumo de **todas** as empresas com os
destinatários já resolvidos. Sem ele, o workflow 02 não funciona.

### 2. Recompilar a API

A Etapa 3 adicionou dois endpoints em `api/src/modules/webhooks/n8n.routes.ts`:

| Método | Rota | Uso |
|---|---|---|
| `GET` | `/api/v1/webhooks/n8n/digest` | Resumo de todas as empresas (workflow 02) |
| `POST` | `/api/v1/webhooks/n8n/notifications` | Grava notificação in-app |

```bash
cd api && npm run build && docker compose up -d --build
```

### 3. Colocar o n8n na mesma rede Docker

Os workflows chamam `http://finance-api:3333`, o hostname interno do container.
Se o seu n8n roda em outra rede ou em outro host, troque a URL nos dois nós
HTTP Request para o endereço público com HTTPS.

```yaml
# no docker-compose do n8n
networks:
  - supabase
```

### 4. Criar as credenciais no n8n

**a) Header Auth — "Finance API - x-n8n-secret"**

`Credentials → New → Header Auth`

- Name: `x-n8n-secret`
- Value: o mesmo valor de `N8N_WEBHOOK_SECRET` do `.env` da API

Usar credencial em vez de `{{$env.VAR}}` é deliberado: o segredo fica
criptografado no banco do n8n e não aparece no JSON exportado nem nos logs de
execução.

**b) SMTP — "SMTP Financeiro"**

`Credentials → New → SMTP` com host, porta, usuário e senha do seu provedor.

> Use um domínio com SPF e DKIM configurados. Enviando de um VPS sem isso, o
> e-mail vai direto para spam — e um alerta de caixa negativo que ninguém lê
> não serve para nada.

### 5. Importar

`Workflows → Import from File` para cada JSON. Depois, em **cada** nó HTTP
Request e no nó de e-mail, reabra o seletor de credencial e escolha a
credencial correta — o campo `SUBSTITUA_PELO_ID_DA_CREDENCIAL` do JSON não
resolve sozinho.

Ajuste também o `fromEmail` no nó "Enviar e-mail ao gestor".

---

## Workflow 01 — Gerar Recorrentes

```
Schedule (03:00) → HTTP POST /generate-recurring → Code (resumo) → IF gerou? → Log
```

A RPC `fn_generate_recurring()` materializa as ocorrências até o horizonte de
cada template (padrão 60 dias). O índice único `(recurring_template_id,
due_date)` garante idempotência: se o workflow rodar duas vezes, ou se você
disparar manualmente, o resultado é `0 transactions_created` — não duplica.

Rodar às 03:00 é proposital: fora do horário comercial, sem concorrência com o
uso do sistema.

**Retry configurado**: 3 tentativas com 5s de intervalo. Se a API estiver
reiniciando no momento do cron, o fluxo se recupera sozinho.

---

## Workflow 02 — Alerta Diário

```
Schedule (08:00, seg-sex) → HTTP GET /digest → Split Out → Code (filtra + monta HTML)
  → Send Email → HTTP POST /notifications
```

**Uma requisição só** para buscar todas as empresas, em vez de N chamadas. Com
50 clientes isso é a diferença entre 1 e 50 requisições por manhã.

**A regra mais importante está no nó Code:** empresa sem nada a reportar **não
recebe e-mail**. Alerta diário sem novidade vira ruído, o gestor para de abrir,
e quando o caixa realmente furar a mensagem passa batido. O e-mail só sai se
houver vencimento hoje, atraso ou previsão de caixa negativo.

O e-mail destaca em vermelho a **data em que o caixa fica negativo** — é a
informação mais acionável do produto inteiro, porque ainda dá tempo de agir.

A notificação in-app é gravada **depois** do envio, para o sino refletir o que
de fato saiu. A RPC faz upsert por (empresa, tipo, dia): reexecutar o workflow
atualiza a notificação existente em vez de empilhar duplicatas.

Ambos os nós finais usam `onError: continueRegularOutput` — se o SMTP falhar
para uma empresa, as demais continuam recebendo.

---

## Testar antes de ativar

1. Abra o workflow 02 e clique em **Execute Workflow** (manual).
2. Confira o retorno do nó "API: digest": deve trazer uma linha por empresa
   ativa, com `recipients` preenchido. **Se vier vazio**, o usuário dono da
   empresa não tem e-mail em `public.profiles` — o trigger
   `on_auth_user_created` só popula quem se cadastrou *depois* do 02_rls.sql.
   Corrija com:

   ```sql
   insert into public.profiles (id, email)
   select id, email from auth.users
   on conflict (id) do update set email = excluded.email;
   ```

3. Verifique o e-mail recebido e depois:

   ```sql
   select tenant_id, kind, title, severity, ref_date
   from public.notifications order by created_at desc limit 5;
   ```

4. Só então ative os dois workflows (toggle **Active**).

---

## Dica de ouro: workflow de erro

Crie um terceiro workflow só com um nó **Error Trigger** e um envio de e-mail
para você. Depois, em cada workflow: `Settings → Error Workflow → selecione-o`.

Sem isso, se o cron das 03:00 falhar por três semanas, você só descobre quando
um cliente reclamar que o aluguel não apareceu no sistema. Automação financeira
que falha em silêncio é pior do que automação nenhuma — o gestor confia num
número que não existe.

---

## Pendências assumidas

1. **Sem régua de cobrança ao cliente final.** Decisão consciente para o MVP:
   mensagem automática errada para o cliente do seu cliente queima a relação e
   a culpa recai sobre o seu sistema. Entra na v2, com opt-in por cliente.
2. **Sem WhatsApp.** A Evolution API self-hosted traz risco de ban do número.
   Quando entrar, é só um nó a mais depois do "Filtrar e montar e-mail".
3. **Fuso fixo em America/Sao_Paulo** nos dois workflows. Se atender empresas
   em outro fuso, o `current_date` do banco (UTC) e o cron do n8n vão divergir
   perto da meia-noite.
4. **JSONs não importados por mim.** Escrevi conforme o schema do n8n 1.x, mas
   não pude validar num n8n real nesta sessão. Se a importação reclamar de
   algum nó, me mande o erro e a versão do seu n8n.
