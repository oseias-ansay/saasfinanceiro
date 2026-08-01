# Backup e restauração

O sistema roda num único VPS. Sem cópia, qualquer perda é definitiva — e a
perda mais provável não é o servidor pegar fogo, é um comando mal escopado.
Já aconteceu nesta implantação: um `delete ... where tax_id in (...)` apagou
uma empresa junto com a massa de teste, e o `on delete cascade` levou os
vínculos.

## Instalação (VPS)

```bash
sudo mkdir -p /opt/scripts /var/backups/supabase
sudo cp /opt/finance-src/scripts/backup-supabase.sh /opt/scripts/
sudo chmod +x /opt/scripts/backup-supabase.sh
sudo /opt/scripts/backup-supabase.sh
```

A execução manual deve terminar com "Concluído" e criar um arquivo em
`/var/backups/supabase/diario/`.

### Agendar

```bash
sudo crontab -e
```

```
30 3 * * * /opt/scripts/backup-supabase.sh >> /var/log/backup-supabase.log 2>&1
```

### Criptografar (recomendado antes de mandar para fora)

```bash
echo 'uma-frase-secreta-longa-e-unica' | sudo tee /etc/backup-supabase.pass
sudo chmod 600 /etc/backup-supabase.pass
```

**Guarde essa frase fora do VPS** — gerenciador de senhas, papel no cofre.
Sem ela o backup é irrecuperável. Essa é a proteção e também o risco: um
backup criptografado com a chave perdida junto com o servidor não vale nada.

## Cópia para fora do servidor

O script guarda em `/var/backups/supabase`, **no mesmo disco do banco**. Isso
protege contra erro humano e corrupção lógica, que é a maioria dos casos, mas
não contra perder o servidor.

Duas formas de resolver, em ordem de esforço:

**1. Snapshot da Hostinger.** No hPanel, procure backups automáticos do VPS.
É a proteção mais barata que existe: zero código, cobre o servidor inteiro.
Ative hoje, mesmo que faça o resto depois.

**2. rclone para armazenamento externo.** Backblaze B2 custa centavos por mês
para esse volume.

```bash
curl https://rclone.org/install.sh | sudo bash
rclone config          # configure um remoto chamado 'backup'
```

Depois descomente a linha do `rclone copy` no fim do script.

## Restauração

Um backup nunca testado é uma suposição. Faça este teste uma vez, agora, e
repita a cada poucos meses.

### Testar sem tocar no banco de produção

```bash
# 1. Cria um banco temporário
docker exec -i supabase-db psql -U postgres -c "create database teste_restore;"

# 2. Restaura o dump nele
gunzip -c /var/backups/supabase/diario/supabase-AAAA-MM-DD_HHMM.sql.gz \
  | docker exec -i supabase-db psql -U postgres -d teste_restore

# Se estiver criptografado:
# gpg --batch --passphrase-file /etc/backup-supabase.pass -d ARQUIVO.gpg \
#   | gunzip -c | docker exec -i supabase-db psql -U postgres -d teste_restore

# 3. Confere que os dados vieram
docker exec -i supabase-db psql -U postgres -d teste_restore \
  -c "select count(*) from public.transactions;"

# 4. Remove o banco de teste
docker exec -i supabase-db psql -U postgres -c "drop database teste_restore;"
```

### Restauração real (perda de dados)

⚠️ Sobrescreve o banco em produção. Pare a API antes, para não gravar durante
a restauração.

```bash
cd /opt/finance-src/api && docker compose stop finance-api

gunzip -c /var/backups/supabase/diario/ARQUIVO.sql.gz \
  | docker exec -i supabase-db psql -U postgres -d postgres

docker compose start finance-api
docker restart supabase-rest      # limpa o cache de schema do PostgREST
```

## O que o backup cobre — e o que não cobre

**Cobre três bancos**, cada um em sua pasta sob `/var/backups`:

| Container | Conteúdo |
|---|---|
| `supabase-db` | Empresas, usuários, lançamentos, categorias, RLS, funções e views |
| `n8n-postgres-1` | Workflows e credenciais da instância pessoal |
| `n8n-businestriage-postgres-1` | Workflows e credenciais da Business Triage |

O usuário e a base de cada um são detectados em execução, lendo as variáveis
do próprio container — não dependem de estarem escritos no script.

**Não cobre — e isso importa:**

**As chaves de criptografia.** O n8n cifra as credenciais com a
`N8N_ENCRYPTION_KEY`, que fica em `/home/node/.n8n/config` dentro do container
e é gerada automaticamente na primeira execução. Restaurar o banco devolve os
workflows, mas todas as credenciais vêm ilegíveis. Guarde as duas chaves num
gerenciador de senhas, identificando de qual instância é cada uma:

```bash
docker exec n8n-n8n-1 cat /home/node/.n8n/config
docker exec n8n-businestriage-n8n-1 cat /home/node/.n8n/config
```

**Os `.env`** do Supabase e da API. Sem `JWT_SECRET`, restaurar o banco não
devolve o sistema: os tokens não validam e ninguém entra.

**Cobre também os arquivos do Storage** (comprovantes), num pacote separado em
`/var/backups/storage`. Eles ficam em volume próprio do Supabase, fora do
Postgres — o dump do banco guarda apenas a referência ao arquivo. Sem essa
parte, restaurar devolveria uma lista de comprovantes cujos arquivos não
existem mais.

O caminho do volume é descoberto a partir do próprio container, porque muda
conforme a instalação use bind mount ou volume nomeado.

### Restaurar os comprovantes

```bash
# Descobre onde o storage está montado
STORAGE=$(docker inspect supabase-storage \
  --format '{{range .Mounts}}{{if eq .Destination "/var/lib/storage"}}{{.Source}}{{end}}{{end}}')

# Restaura por cima (o tar recria a estrutura de pastas)
tar -xzf /var/backups/storage/diario/storage-AAAA-MM-DD_HHMM.tar.gz \
  -C "$(dirname "$STORAGE")"

docker restart supabase-storage
```

## Verificação periódica

```bash
ls -lh /var/backups/*/diario/
tail -30 /var/log/backup-supabase.log
```

Se o log parar de crescer, o cron parou. Backup que falha em silêncio dá a
mesma falsa segurança que backup nenhum, com o agravante de você acreditar
que está protegido.
