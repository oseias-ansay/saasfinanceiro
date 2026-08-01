#!/usr/bin/env bash
#
# Backup diário dos bancos Postgres do servidor.
#
# O nome do arquivo é histórico: começou cobrindo só o Supabase e passou a
# incluir os bancos do n8n, onde vivem os workflows e as credenciais. Mantido
# assim para não quebrar o agendamento já existente no cron.
#
# Instalação:
#   sudo cp backup-supabase.sh /opt/scripts/
#   sudo chmod +x /opt/scripts/backup-supabase.sh
#   sudo /opt/scripts/backup-supabase.sh
#
# Agendamento:
#   30 3 * * * /opt/scripts/backup-supabase.sh >> /var/log/backup-supabase.log 2>&1
#
# Criptografia (opcional):
#   echo 'frase-secreta-longa' | sudo tee /etc/backup-supabase.pass
#   sudo chmod 600 /etc/backup-supabase.pass
#
# ⚠️ O backup do banco do n8n NÃO devolve as credenciais sozinho: elas são
# cifradas com a N8N_ENCRYPTION_KEY, que fica em /home/node/.n8n/config dentro
# do container. Guarde essa chave num gerenciador de senhas — sem ela, os
# workflows voltam mas todas as credenciais vêm ilegíveis.

set -uo pipefail

# Containers de banco a incluir. Usuário e base são detectados em execução,
# lendo as variáveis do próprio container — evita errar nomes por suposição.
CONTAINERS=(
  supabase-db
  n8n-postgres-1
  n8n-businestriage-postgres-1
)

DEST="${BACKUP_DIR:-/var/backups}"
PASS_FILE="/etc/backup-supabase.pass"
MANTER_DIARIOS=7
MANTER_SEMANAIS=8

log() { echo "[$(date '+%F %T')] $*"; }

FALHAS=0
SUCESSOS=0

for CONTAINER in "${CONTAINERS[@]}"; do
  echo
  log "--- $CONTAINER"

  if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
    log "container não encontrado, pulando"
    continue
  fi

  # Lê usuário e base do ambiente do container; cai no padrão se não houver.
  DB_USER=$(docker exec "$CONTAINER" printenv POSTGRES_USER 2>/dev/null || echo postgres)
  DB_NAME=$(docker exec "$CONTAINER" printenv POSTGRES_DB   2>/dev/null || echo "$DB_USER")
  [ -z "$DB_USER" ] && DB_USER=postgres
  [ -z "$DB_NAME" ] && DB_NAME="$DB_USER"

  PASTA="$DEST/$CONTAINER"
  mkdir -p "$PASTA/diario" "$PASTA/semanal"

  DATA=$(date +%F_%H%M)
  BASE="$PASTA/diario/$CONTAINER-$DATA.sql.gz"
  TMP="$BASE.parcial"

  log "dump de $DB_NAME (usuário $DB_USER)"

  if ! docker exec -i "$CONTAINER" pg_dump \
        -U "$DB_USER" -d "$DB_NAME" \
        --no-owner --clean --if-exists 2>/tmp/pgdump.err \
        | gzip -9 > "$TMP"; then
    log "ERRO no pg_dump:"; sed 's/^/    /' /tmp/pgdump.err | head -5
    rm -f "$TMP"; FALHAS=$((FALHAS+1)); continue
  fi

  # Dump truncado passa despercebido até a hora de restaurar — o pior momento
  # possível para descobrir. Verificar custa segundos.
  if ! gzip -t "$TMP" 2>/dev/null; then
    log "ERRO: arquivo corrompido, descartado"
    rm -f "$TMP"; FALHAS=$((FALHAS+1)); continue
  fi

  TAMANHO=$(stat -c%s "$TMP")
  if [ "$TAMANHO" -lt 5120 ]; then
    log "ERRO: dump suspeito (${TAMANHO}B), descartado"
    rm -f "$TMP"; FALHAS=$((FALHAS+1)); continue
  fi

  if [ -f "$PASS_FILE" ]; then
    if gpg --batch --yes --symmetric --cipher-algo AES256 \
           --passphrase-file "$PASS_FILE" -o "$TMP.gpg" "$TMP" 2>/dev/null; then
      rm -f "$TMP"; mv "$TMP.gpg" "$BASE.gpg"; FINAL="$BASE.gpg"
    else
      log "ERRO ao cifrar"; rm -f "$TMP"; FALHAS=$((FALHAS+1)); continue
    fi
  else
    mv "$TMP" "$BASE"; FINAL="$BASE"
  fi

  log "gerado: $(basename "$FINAL") ($(du -h "$FINAL" | cut -f1))"
  SUCESSOS=$((SUCESSOS+1))

  # Cópia semanal aos domingos: nem todo problema é notado em sete dias.
  [ "$(date +%u)" -eq 7 ] && cp "$FINAL" "$PASTA/semanal/"

  find "$PASTA/diario"  -type f -name "$CONTAINER-*" -mtime +$MANTER_DIARIOS -delete
  find "$PASTA/semanal" -type f -name "$CONTAINER-*" -mtime +$((MANTER_SEMANAIS * 7)) -delete
done

echo
[ -f "$PASS_FILE" ] || log "AVISO: sem $PASS_FILE — backups NÃO estão criptografados."
log "Resumo: $SUCESSOS backup(s) gerado(s), $FALHAS falha(s)"

# ---------------------------------------------------------------------
# CÓPIA PARA FORA DO SERVIDOR
# ---------------------------------------------------------------------
# Backup no mesmo disco do banco não protege contra o servidor sumir.
# Descomente uma das opções depois de configurar:
#
#   rclone copy "$DEST" remoto:business-triage-backups/ --include "*.gz*"
#   rsync -az "$DEST/" usuario@outro-host:/backups/

[ "$FALHAS" -gt 0 ] && exit 1
log "Concluído"
exit 0
