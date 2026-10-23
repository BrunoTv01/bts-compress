#!/usr/bin/env bash
# Atualiza o BTS Compress instalado em /opt/bts-compress com os arquivos desta pasta.
# Faz backup do banco antes. A configuração (/etc/bts-compress.env) e os dados são mantidos.
#
# Uso: baixe a versão nova (git pull ou novo .tar.gz) e, de dentro da pasta:
#   sudo ./deploy/update.sh
set -euo pipefail
APP=bts-compress; APP_USER=bts; APP_DIR=/opt/$APP

[ "$(id -u)" -eq 0 ] || { echo "Rode como root: sudo $0"; exit 1; }
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
[ -d "$APP_DIR" ] || { echo "Não está instalado. Use: sudo ./deploy/install.sh"; exit 1; }

echo "→ Backup do banco antes de atualizar"
"$SRC_DIR/deploy/backup.sh"

if [ "$SRC_DIR" != "$APP_DIR" ]; then
  echo "→ Copiando arquivos novos"
  rsync -a --delete --exclude node_modules --exclude .git "$SRC_DIR"/ "$APP_DIR"/
fi
echo "→ Dependências"
( cd "$APP_DIR" && npm install --omit=dev --no-audit --no-fund --loglevel=error )
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
install -m 644 "$APP_DIR/deploy/$APP.service" /etc/systemd/system/$APP.service
systemctl daemon-reload
systemctl restart "$APP"

PORT="$(sed -n 's/^PORT=//p' /etc/$APP.env)"
for _ in $(seq 1 30); do curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break; sleep 1; done
if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
  echo "✔ Atualizado e funcionando. As alterações no banco são aplicadas sozinhas na inicialização."
else
  echo "✖ O sistema não respondeu após atualizar. Veja: journalctl -u $APP -n 50"; exit 1
fi
