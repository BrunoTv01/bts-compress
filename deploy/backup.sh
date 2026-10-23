#!/usr/bin/env bash
# Backup do banco do BTS Compress em /var/backups/bts-compress (mantém os 30 mais recentes).
#
# Fazer backup:     sudo /opt/bts-compress/deploy/backup.sh
# Restaurar:        sudo /opt/bts-compress/deploy/backup.sh --restaurar /var/backups/bts-compress/ARQUIVO.sql.gz
# Backup diário:    sudo /opt/bts-compress/deploy/backup.sh --agendar   (todo dia às 02:30)
set -euo pipefail
APP=bts-compress
DEST=/var/backups/$APP
ENV_FILE=/etc/$APP.env
KEEP=30

[ "$(id -u)" -eq 0 ] || { echo "Rode como root: sudo $0 $*"; exit 1; }
[ -f "$ENV_FILE" ] || { echo "Não achei $ENV_FILE. O sistema está instalado?"; exit 1; }
DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' "$ENV_FILE")"
mkdir -p "$DEST"; chmod 700 "$DEST"

case "${1:-}" in
  --agendar)
    echo "30 2 * * * root $(readlink -f "$0") >/dev/null 2>&1" > /etc/cron.d/$APP-backup
    chmod 644 /etc/cron.d/$APP-backup
    echo "✔ Backup diário agendado às 02:30 em $DEST"; exit 0;;
  --restaurar)
    ARQ="${2:-}"; [ -f "$ARQ" ] || { echo "Arquivo não encontrado: $ARQ"; exit 1; }
    echo "→ Parando o sistema"; systemctl stop $APP
    echo "→ Restaurando $ARQ"
    gunzip -c "$ARQ" | psql -q -v ON_ERROR_STOP=1 "$DATABASE_URL"
    systemctl start $APP
    echo "✔ Restaurado"; exit 0;;
esac

ARQ="$DEST/bts-$(date +%Y%m%d-%H%M%S).sql.gz"
pg_dump --clean --if-exists --no-owner "$DATABASE_URL" | gzip > "$ARQ"
chmod 600 "$ARQ"
ls -1t "$DEST"/bts-*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
echo "✔ Backup salvo em $ARQ"
