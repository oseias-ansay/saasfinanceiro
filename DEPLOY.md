# Deploy da API no VPS (Hostinger + Traefik)

Ambiente detectado: **Traefik v3.6.6**, rede `traefik-proxy`, certresolver
`letsencrypt`, entrypoints `web` (80) e `websecure` (443). Supabase na rede
`supabase_default`, com o Kong acessível internamente como `supabase-kong:8000`.

Domínio: **`api-financeiro.businesstriage.com.br`** — se escolher outro, troque nas 3
labels do `api/docker-compose.yml` e nos 2 nós HTTP dos workflows n8n.

---

## Passo 1 — DNS (faça primeiro, leva tempo para propagar)

No painel do seu domínio, crie:

No DNS de **businesstriage.com.br**:

| Tipo | Nome | Valor | TTL |
|---|---|---|---|
| A | `api-financeiro` | `187.77.232.125` | 300 |

Confirme antes de continuar:

```bash
dig +short api-financeiro.businesstriage.com.br
```

Precisa retornar o IP do VPS. **Não pule esta verificação**: o Let's Encrypt
valida o domínio por HTTP, e se o DNS não resolver o Traefik falha na emissão
e entra em backoff — você fica minutos sem entender por que o HTTPS não sobe.

---

## Passo 2 — Enviar o código

### Opção A — Git (recomendado)

**2.1 — Criar o repositório**

No GitHub: **New repository** → nome `saasfinanceiro` → **Private** → NÃO marque
"Add a README" (evita conflito no primeiro push).

**2.2 — Primeiro commit (na sua máquina)**

```powershell
cd C:\Projetos\saasfinanceiro
git init
git add .
git status
```

**Pare no `git status` e confira a lista.** Não pode aparecer nenhum `.env`
(só `.env.example`) nem `node_modules`. Chave de `service_role` versionada é
acesso total ao banco, ignorando todo o RLS — e mesmo apagando depois, ela fica
no histórico do Git para sempre.

Estando limpo:

```powershell
git commit -m "MVP: banco, API e workflows n8n"
git branch -M main
git remote add origin git@github.com:SEU_USUARIO/saasfinanceiro.git
git push -u origin main
```

**2.3 — Dar acesso de leitura ao VPS (deploy key)**

O repositório é privado, então o servidor precisa de credencial própria. Use
uma **deploy key** (somente leitura, restrita a este repositório) em vez da sua
chave pessoal — se o VPS for comprometido, o estrago fica contido.

No VPS:

```bash
ssh-keygen -t ed25519 -C "vps-finance-api" -f ~/.ssh/id_finance -N ""
cat ~/.ssh/id_finance.pub
```

Copie a saída e cole em: **repositório → Settings → Deploy keys → Add deploy
key**. Deixe "Allow write access" **desmarcado**.

Ainda no VPS, ensine o Git a usar essa chave:

```bash
cat >> ~/.ssh/config <<'EOF'

Host github-finance
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_finance
  IdentitiesOnly yes
EOF

chmod 600 ~/.ssh/config
ssh -T git@github-finance   # deve dizer "successfully authenticated"
```

**2.4 — Clonar**

```bash
cd /opt
git clone git@github-finance:SEU_USUARIO/saasfinanceiro.git finance-src
cd finance-src/api
```

### Opção B — SCP direto

Na sua máquina:

```powershell
cd C:\Projetos\saasfinanceiro
scp -r api root@187.77.232.125:/opt/finance-api
```

Depois, no VPS: `cd /opt/finance-api`.

---

## Passo 3 — Criar o `.env` no servidor

Pegue as chaves do Supabase:

```bash
grep -E "ANON_KEY|SERVICE_ROLE_KEY" /caminho/do/supabase/docker/.env
```

Gere o segredo dos webhooks:

```bash
openssl rand -hex 32
```

Crie o arquivo (na pasta `api/` do servidor):

```bash
cat > .env <<'EOF'
NODE_ENV=production
PORT=3333
LOG_LEVEL=info

SUPABASE_URL=http://supabase-kong:8000
SUPABASE_ANON_KEY=COLE_AQUI
SUPABASE_SERVICE_ROLE_KEY=COLE_AQUI

N8N_WEBHOOK_SECRET=COLE_O_HEX_GERADO

CORS_ORIGINS=https://financeiro.businesstriage.com.br,http://localhost:5173
EOF

chmod 600 .env
```

O `chmod 600` importa: esse arquivo tem a chave que ignora todo o RLS.

---

## Passo 4 — Subir

```bash
docker compose up -d --build
docker compose logs -f finance-api
```

Espere a linha `API financeira ouvindo na porta 3333 (production)`.

Se o container reiniciar em loop, quase sempre é validação de env: o
`config/env.ts` derruba o processo de propósito quando falta variável, e o log
diz exatamente qual.

---

## Passo 5 — Verificar

```bash
# De dentro do servidor (rede interna)
docker exec finance-api node -e "fetch('http://127.0.0.1:3333/health').then(r=>r.json()).then(console.log)"

# De fora, pelo domínio (aguarde ~1 min pela emissão do certificado)
curl -i https://api-financeiro.businesstriage.com.br/health
```

Esperado: `{"status":"ok","uptime":...}` com certificado válido.

Teste o segredo dos webhooks — sem o header, precisa dar **401**:

```bash
curl -i https://api-financeiro.businesstriage.com.br/api/v1/webhooks/n8n/digest
curl -i -H "x-n8n-secret: SEU_SEGREDO" https://api-financeiro.businesstriage.com.br/api/v1/webhooks/n8n/digest
```

O primeiro **tem** que falhar. Se ele retornar dados, o segredo não está sendo
verificado e qualquer pessoa na internet lê o financeiro de todos os clientes.

---

## Passo 6 — Conectar o n8n

Os workflows já apontam para `https://api-financeiro.businesstriage.com.br`. Falta:

1. Criar a credencial **Header Auth** no n8n: nome `x-n8n-secret`, valor igual
   ao `N8N_WEBHOOK_SECRET` do `.env`.
2. Importar os dois JSONs de `n8n/` e selecionar a credencial em cada nó HTTP.
3. Rodar o SQL `supabase/sql/06_notifications.sql`, se ainda não rodou.

Você tem duas instâncias de n8n no servidor (`n8n-n8n-1` e
`n8n-businestriage-n8n-1`). Escolha uma e mantenha os workflows financeiros só
nela — se as duas rodarem o mesmo cron, o resultado não duplica lançamentos
(o banco impede), mas o gestor recebe dois e-mails toda manhã.

---

## Atualizações futuras

Com Git — o `.env` fica fora do repositório, então ele sobrevive aos `pull`:

```bash
cd /opt/finance-src && git pull
cd api && docker compose up -d --build
```

Com SCP, repita o `scp -r` e rode o `docker compose up -d --build`.

---

## Pendências de segurança do servidor

Fora do escopo da API, mas relevante agora que ela vai para produção:

1. **Login de root por senha.** Configure chave SSH e desabilite
   `PermitRootLogin yes` com senha em `/etc/ssh/sshd_config`.
2. **Studio do Supabase exposto** em `api.oseiasansay.com.br` com Basic Auth.
   Confirme que `DASHBOARD_PASSWORD` não é o valor padrão do repositório.
3. **Backup do Postgres.** Você tem dado financeiro de clientes num único VPS.
   Um `pg_dump` diário para fora do servidor (S3, Backblaze) é o mínimo — e é
   o tipo de coisa que só parece urgente depois que já era.
