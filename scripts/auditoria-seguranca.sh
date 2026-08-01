#!/usr/bin/env bash
#
# Auditoria de segurança do VPS — somente leitura, não altera nada.
#
#   sudo bash /opt/finance-src/scripts/auditoria-seguranca.sh
#
# Nenhum segredo é impresso: as verificações comparam hashes e comprimentos,
# nunca os valores. Pode rodar com outra pessoa olhando a tela.

set -uo pipefail

SUPA_ENV="${SUPA_ENV:-/opt/supabase/.env}"
API_ENV="${API_ENV:-/opt/finance-src/api/.env}"

vermelho() { printf '\033[31m%s\033[0m\n' "$1"; }
verde()    { printf '\033[32m%s\033[0m\n' "$1"; }
amarelo()  { printf '\033[33m%s\033[0m\n' "$1"; }

CRITICOS=0
ALERTAS=0

falha()  { vermelho "  [CRÍTICO] $1"; CRITICOS=$((CRITICOS+1)); }
alerta() { amarelo  "  [ATENÇÃO] $1"; ALERTAS=$((ALERTAS+1)); }
ok()     { verde    "  [ok] $1"; }

valor() { grep -E "^$1=" "$2" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | xargs; }

echo
echo "=================================================="
echo " Auditoria de segurança — $(date '+%F %T')"
echo "=================================================="

# ---------------------------------------------------------------------
echo
echo "1. SEGREDOS PADRÃO DO SUPABASE"
echo "   Chaves de exemplo são públicas no GitHub. Se alguma estiver em uso,"
echo "   qualquer pessoa forja tokens e lê o banco inteiro."
if [ -f "$SUPA_ENV" ]; then
  # Valores que vêm no repositório oficial de exemplo
  PADRAO_JWT="your-super-secret-jwt-token-with-at-least-32-characters-long"
  PADRAO_PG="your-super-secret-and-long-postgres-password"
  PADRAO_DASH="this_password_is_insecure_and_should_be_updated"

  [ "$(valor JWT_SECRET "$SUPA_ENV")" = "$PADRAO_JWT" ] \
    && falha "JWT_SECRET é o valor de exemplo — tokens podem ser forjados" \
    || ok "JWT_SECRET personalizado"

  [ "$(valor POSTGRES_PASSWORD "$SUPA_ENV")" = "$PADRAO_PG" ] \
    && falha "POSTGRES_PASSWORD é o valor de exemplo" \
    || ok "POSTGRES_PASSWORD personalizada"

  [ "$(valor DASHBOARD_PASSWORD "$SUPA_ENV")" = "$PADRAO_DASH" ] \
    && falha "DASHBOARD_PASSWORD é o valor de exemplo — Studio aberto" \
    || ok "DASHBOARD_PASSWORD personalizada"

  PERM=$(stat -c '%a' "$SUPA_ENV")
  [ "$PERM" -le 640 ] && ok ".env do Supabase com permissão $PERM" \
    || alerta ".env do Supabase legível demais (permissão $PERM) — use chmod 600"
else
  alerta "não encontrei $SUPA_ENV"
fi

# ---------------------------------------------------------------------
echo
echo "2. .env DA API"
if [ -f "$API_ENV" ]; then
  PERM=$(stat -c '%a' "$API_ENV")
  [ "$PERM" -le 600 ] && ok ".env da API com permissão $PERM" \
    || falha ".env da API com permissão $PERM — contém a service_role, use chmod 600"

  SEG=$(valor N8N_WEBHOOK_SECRET "$API_ENV")
  [ ${#SEG} -ge 32 ] && ok "segredo do n8n com ${#SEG} caracteres" \
    || falha "segredo do n8n curto demais (${#SEG} caracteres)"

  CORS=$(valor CORS_ORIGINS "$API_ENV")
  case "$CORS" in
    *"*"*) falha "CORS liberado para qualquer origem" ;;
    *) ok "CORS restrito" ;;
  esac
else
  alerta "não encontrei $API_ENV"
fi

# ---------------------------------------------------------------------
echo
echo "3. PORTAS EXPOSTAS À INTERNET"
echo "   Banco e painéis nunca devem escutar em 0.0.0.0."
EXPOSTAS=$(ss -tlnp 2>/dev/null | grep -E '0\.0\.0\.0:|\*:' | grep -vE ':(80|443|22)\s' || true)
if [ -n "$EXPOSTAS" ]; then
  echo "$EXPOSTAS" | while read -r linha; do
    PORTA=$(echo "$linha" | grep -oE '0\.0\.0\.0:[0-9]+|\*:[0-9]+' | head -1 | cut -d: -f2)
    case "$PORTA" in
      5432|6543|3306|27017|6379) falha "porta $PORTA (banco de dados) aberta para a internet" ;;
      *) alerta "porta $PORTA exposta — confirme se é intencional" ;;
    esac
  done
else
  ok "somente 22, 80 e 443 expostas"
fi

# ---------------------------------------------------------------------
echo
echo "4. ACESSO SSH"
SSHD=/etc/ssh/sshd_config
if [ -f "$SSHD" ]; then
  EFETIVO=$(sshd -T 2>/dev/null || cat "$SSHD")

  echo "$EFETIVO" | grep -qiE '^permitrootlogin\s+(yes|prohibit-password)' \
    && { echo "$EFETIVO" | grep -qi '^permitrootlogin yes' \
         && falha "login de root por senha habilitado" \
         || ok "root só entra por chave"; } \
    || ok "login de root restrito"

  echo "$EFETIVO" | grep -qi '^passwordauthentication yes' \
    && alerta "autenticação por senha habilitada — prefira só chave SSH" \
    || ok "autenticação por senha desabilitada"
else
  alerta "não encontrei $SSHD"
fi

command -v fail2ban-client >/dev/null 2>&1 \
  && ok "fail2ban instalado" \
  || alerta "fail2ban ausente — sem proteção contra tentativas repetidas de senha"

# ---------------------------------------------------------------------
echo
echo "5. FIREWALL"
if command -v ufw >/dev/null 2>&1; then
  ufw status 2>/dev/null | grep -qi '^Status: active' \
    && ok "ufw ativo" \
    || alerta "ufw instalado mas inativo"
else
  alerta "ufw não instalado — o servidor depende só das regras do provedor"
fi

# ---------------------------------------------------------------------
echo
echo "6. BACKUP"
ULTIMO=$(find /var/backups/supabase -name 'supabase-*' -mtime -2 2>/dev/null | head -1)
[ -n "$ULTIMO" ] && ok "backup recente encontrado" \
  || falha "nenhum backup nas últimas 48h"

crontab -l 2>/dev/null | grep -q backup-supabase \
  && ok "backup agendado no cron" \
  || alerta "backup não está no cron"

# ---------------------------------------------------------------------
echo
echo "=================================================="
[ "$CRITICOS" -gt 0 ] && vermelho " $CRITICOS item(ns) CRÍTICO(s)" || verde " Nenhum item crítico"
[ "$ALERTAS"  -gt 0 ] && amarelo  " $ALERTAS ponto(s) de atenção"
echo "=================================================="
echo
