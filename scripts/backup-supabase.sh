#!/usr/bin/env bash
#
# Backup diário do Postgres do Supabase self-hosted.
#
# Instalação:
#   sudo mkdir -p /opt/scripts /var/backups/supabase
#   sudo cp backup-supabase.sh /opt/scripts/
#   sudo chmod +x /opt/scripts/backup-supabase.sh
#   sudo /opt/scripts/backup-supabase.sh          # teste manual
#
# Agendamento (03:30, antes do job de recorrências das 03:00 terminar de
# assentar e longe do horário de uso):
#   sudo crontab -e
#   30 3 * * * /opt/scripts/backup-supabase.sh >> /var/log/backup-supabase.log 2>&1
#
# Criptografia (opcional, recomendada se o dump sair do servidor):
#   echo 'sua-frase-secreta-longa' | sudo tee /etc/backup-supabase.pass
#   sudo chmod 600 /etc/backup-supabase.pass
# Havendo esse arquivo, o script cifra com GPG. Guarde a frase FORA do VPS —
# sem ela o backup é irrecuperável, o que é o objetivo e também o risco.

set -euo pipefail

CONTAINER="${PG_CONTAINER:-supabase-db}"
DB_USER="${PG_USER:-postgres}"
DB_NAME="${PG_DB:-postgres}"
DEST="${BACKUP_DIR:-/var/backups/supabase}"
PASS_FILE="/etc/backup-supabase.pass"

MANTER_DIARIOS=7
MANTER_SEMANAIS=8

log() { echo "[$(date '+%F %T')] $*"; }
falhar() { log "ERRO: $*"; exit 1; }

mkdir -p "$DEST/diario" "$DEST/semanal"

docker inspect "$CONTAINER" >/dev/null 2>&1 || falhar "container $CONTAINER não encontrado"

DATA=$(date +%F_%H%M)
BASE="$DEST/diario/supabase-$DATA.sql.gz"
TMP="$BASE.parcial"

log "Iniciando dump de $DB_NAME"

# --clean --if-exists: o dump recria os objetos, permitindo restaurar sobre
# um banco existente. --no-owner evita erro se o dono dos objetos mudar.
if ! docker exec -i "$CONTAINER" pg_dump \
      -U "$DB_USER" -d "$DB_NAME" \
      --no-owner --clean --if-exists 2>/tmp/pgdump.err \
      | gzip -9 > "$TMP"; then
  log "pg_dump falhou:"; cat /tmp/pgdump.err
  rm -f "$TMP"
  exit 1
fi

# Um dump truncado é pior que nenhum: passa despercebido até a hora da
# restauração. Verificar a integridade do gzip custa segundos.
gzip -t "$TMP" || { rm -f "$TMP"; falhar "arquivo corrompido, descartado"; }

TAMANHO=$(stat -c%s "$TMP")
[ "$TAMANHO" -gt 10240 ] || { rm -f "$TMP"; falhar "dump suspeito (${TAMANHO}B)"; }

if [ -f "$PASS_FILE" ]; then
  gpg --batch --yes --symmetric --cipher-algo AES256 \
      --passphrase-file "$PASS_FILE" -o "$TMP.gpg" "$TMP" \
    || falhar "falha ao cifrar"
  rm -f "$TMP"
  mv "$TMP.gpg" "$BASE.gpg"
  FINAL="$BASE.gpg"
else
  mv "$TMP" "$BASE"
  FINAL="$BASE"
  log "AVISO: sem $PASS_FILE — backup NÃO está criptografado."
fi

log "Gerado: $FINAL ($(du -h "$FINAL" | cut -f1))"

# Cópia semanal aos domingos: protege contra o caso em que o problema só é
# notado depois de sete dias, quando os diários já rodaram.
if [ "$(date +%u)" -eq 7 ]; then
  cp "$FINAL" "$DEST/semanal/$(basename "$FINAL")"
  log "Cópia semanal criada"
fi

# Rotação
find "$DEST/diario"  -type f -name 'supabase-*' -mtime +$MANTER_DIARIOS  -delete
find "$DEST/semanal" -type f -name 'supabase-*' -mtime +$((MANTER_SEMANAIS * 7)) -delete

log "Diários: $(ls -1 "$DEST/diario" | wc -l) | Semanais: $(ls -1 "$DEST/semanal" | wc -l)"

# ---------------------------------------------------------------------
# CÓPIA PARA FORA DO SERVIDOR
# ---------------------------------------------------------------------
# Backup que mora no mesmo disco do banco não protege contra o cenário mais
# provável de perda total: o servidor sumir. Descomente uma das opções.
#
# rclone (Backblaze B2, S3, Google Drive):
#   rclone copy "$FINAL" remoto:business-triage-backups/ && log "Enviado ao remoto"
#
# Outro servidor por SSH:
#   scp -q "$FINAL" usuario@outro-host:/backups/ && log "Enviado por scp"

log "Concluído"
