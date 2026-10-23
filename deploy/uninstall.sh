#!/usr/bin/env bash
# Remove o BTS Compress do servidor.
#   sudo ./deploy/uninstall.sh                  remove o sistema, mantém banco, configuração e backups
#   sudo ./deploy/uninstall.sh --apagar-banco   também apaga o banco e a configuração (faz backup antes)
set -euo pipefail
APP=bts-compress
[ "$(id -u)" -eq 0 ] || { echo "Rode como root: sudo $0 $*"; exit 1; }
APAGAR=0; [ "${1:-}" = "--apagar-banco" ] && APAGAR=1

# backup antes de qualquer coisa (enquanto o script ainda existe em /opt)
if [ "$APAGAR" -eq 1 ] && [ -f /etc/$APP.env ] && [ -x /opt/$APP/deploy/backup.sh ]; then
  /opt/$APP/deploy/backup.sh
fi

# para o sistema primeiro: o banco não pode ser apagado com conexões abertas
systemctl disable --now $APP >/dev/null 2>&1 || true
pkill -u bts -f "node server.js" 2>/dev/null || true
sleep 1

if [ "$APAGAR" -eq 1 ]; then
  su - postgres -c "dropdb --if-exists --force bts" 2>/dev/null || su - postgres -c "dropdb --if-exists bts"
  su - postgres -c "psql -qc 'DROP ROLE IF EXISTS bts'"
  rm -f /etc/$APP.env
  echo "✔ Banco e configuração apagados (backup em /var/backups/$APP)"
fi

rm -f /etc/systemd/system/$APP.service /etc/cron.d/$APP-backup
systemctl daemon-reload 2>/dev/null || true
rm -f /etc/nginx/sites-enabled/$APP /etc/nginx/sites-available/$APP /etc/nginx/conf.d/$APP.conf
if command -v nginx >/dev/null; then systemctl reload nginx 2>/dev/null || true; fi
rm -rf /opt/$APP
id bts >/dev/null 2>&1 && userdel bts 2>/dev/null || true
echo "✔ BTS Compress removido. Backups mantidos em /var/backups/$APP"
