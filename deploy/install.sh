#!/usr/bin/env bash
# Instala o BTS Compress num servidor Linux (Ubuntu, Debian, Rocky, Alma, RHEL, CentOS Stream).
#
# Uso (como root, dentro da pasta do projeto):
#   sudo ./deploy/install.sh                       # instala e sobe na porta 3000
#   sudo ./deploy/install.sh --nginx               # também publica na porta 80 via nginx
#   sudo ./deploy/install.sh --port 8080 --senha MinhaSenha
#
# Opções:
#   --porta N | --port N   porta do sistema (padrão 3000)
#   --senha S              senha de edição (padrão: gerada e mostrada no final)
#   --nginx                instala nginx como proxy na porta 80
#   --dominio NOME         nome do servidor no nginx (padrão: _ , qualquer nome)
#   --sem-banco            não instala PostgreSQL; use DATABASE_URL já existente (variável de ambiente)
set -euo pipefail

APP=bts-compress
APP_USER=bts
APP_DIR=/opt/$APP
ENV_FILE=/etc/$APP.env
DB_NAME=bts
DB_USER=bts
PORT=3000
SENHA=""
NGINX=0
DOMINIO="_"
SEM_BANCO=0
NODE_MIN=20

while [ $# -gt 0 ]; do
  case "$1" in
    --porta|--port) PORT="$2"; shift 2;;
    --senha)        SENHA="$2"; shift 2;;
    --nginx)        NGINX=1; shift;;
    --dominio)      DOMINIO="$2"; shift 2;;
    --sem-banco)    SEM_BANCO=1; shift;;
    -h|--help)      sed -n '2,18p' "$0"; exit 0;;
    *) echo "Opção desconhecida: $1 (use --help)"; exit 1;;
  esac
done

ok()   { printf '\033[32m✔\033[0m %s\n' "$*"; }
info() { printf '\033[36m→\033[0m %s\n' "$*"; }
fail() { printf '\033[31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Rode como root: sudo $0 $*"
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$SRC_DIR/server.js" ] || fail "Não achei server.js em $SRC_DIR. Rode o script de dentro da pasta do projeto."
case "$PORT" in ''|*[!0-9]*) fail "Porta inválida: $PORT";; esac
command -v systemctl >/dev/null || fail "Este servidor não usa systemd. Use a instalação com Docker (veja INSTALL.md)."

# ---------- distribuição ----------
. /etc/os-release
case "${ID} ${ID_LIKE:-}" in
  *debian*|*ubuntu*) FAM=deb;;
  *rhel*|*fedora*|*centos*|*rocky*|*almalinux*) FAM=rpm;;
  *) fail "Distribuição não suportada: $PRETTY_NAME. Use a instalação com Docker.";;
esac
info "Sistema: $PRETTY_NAME"

pkg_install() {
  if [ "$FAM" = deb ]; then DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@" >/dev/null
  else dnf install -y -q "$@" >/dev/null; fi
}
[ "$FAM" = deb ] && { info "Atualizando lista de pacotes"; apt-get update -qq; }
pkg_install curl ca-certificates openssl rsync

# ---------- Node.js ----------
node_major() { command -v node >/dev/null && node -p 'process.versions.node.split(".")[0]' || echo 0; }
if [ "$(node_major)" -lt "$NODE_MIN" ]; then
  info "Instalando Node.js 22 (NodeSource)"
  if [ "$FAM" = deb ]; then curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  else curl -fsSL https://rpm.nodesource.com/setup_22.x | bash - >/dev/null; fi
  pkg_install nodejs
fi
[ "$(node_major)" -ge "$NODE_MIN" ] || fail "Não consegui instalar Node.js $NODE_MIN ou mais novo."
ok "Node.js $(node -v)"

# ---------- PostgreSQL ----------
if [ "$SEM_BANCO" -eq 0 ]; then
  if ! command -v psql >/dev/null; then
    info "Instalando PostgreSQL"
    if [ "$FAM" = deb ]; then pkg_install postgresql
    else
      pkg_install postgresql-server postgresql
      [ -f /var/lib/pgsql/data/PG_VERSION ] || postgresql-setup --initdb >/dev/null
      # aceita senha (scram/md5) em conexões locais por TCP
      sed -i -E 's/^(host\s+all\s+all\s+(127\.0\.0\.1\/32|::1\/128)\s+)ident/\1scram-sha-256/' /var/lib/pgsql/data/pg_hba.conf
    fi
  fi
  systemctl enable --now postgresql >/dev/null 2>&1 || systemctl enable --now postgresql.service
  ok "PostgreSQL ativo"
else
  command -v pg_dump >/dev/null || { [ "$FAM" = deb ] && pkg_install postgresql-client || pkg_install postgresql; }
fi

# ---------- usuário e arquivos ----------
id "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR"
rsync -a --delete --exclude node_modules --exclude .git "$SRC_DIR"/ "$APP_DIR"/
info "Instalando dependências do sistema (npm)"
( cd "$APP_DIR" && npm install --omit=dev --no-audit --no-fund --loglevel=error )
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
ok "Arquivos em $APP_DIR"

# ---------- configuração (.env) ----------
if [ -f "$ENV_FILE" ]; then
  ok "Mantendo configuração existente em $ENV_FILE"
  if [ -n "$SENHA" ]; then
    sed -i "s#^ADMIN_TOKEN=.*#ADMIN_TOKEN=$SENHA#" "$ENV_FILE"; ok "Senha de edição atualizada"
  fi
else
  DB_PASS="$(openssl rand -hex 16)"
  [ -n "$SENHA" ] || SENHA="$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-12)"
  if [ "$SEM_BANCO" -eq 1 ]; then
    [ -n "${DATABASE_URL:-}" ] || fail "Com --sem-banco, defina DATABASE_URL antes de rodar o script."
    DBURL="$DATABASE_URL"
  else
    DBURL="postgres://$DB_USER:$DB_PASS@127.0.0.1:5432/$DB_NAME"
  fi
  umask 077
  cat > "$ENV_FILE" <<EOF
# Configuração do BTS Compress. Depois de alterar: sudo systemctl restart $APP
PORT=$PORT
HOST=$([ "$NGINX" -eq 1 ] && echo 127.0.0.1 || echo 0.0.0.0)
DATABASE_URL=$DBURL
ADMIN_TOKEN=$SENHA
NODE_ENV=production
EOF
  chown root:"$APP_USER" "$ENV_FILE"; chmod 640 "$ENV_FILE"
  ok "Configuração criada em $ENV_FILE"
fi

# ---------- banco e usuário do banco ----------
if [ "$SEM_BANCO" -eq 0 ]; then
  DB_PASS_NOW="$(sed -n 's#^DATABASE_URL=postgres://[^:]*:\([^@]*\)@.*#\1#p' "$ENV_FILE")"
  su - postgres -c "psql -qtAc \"SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'\"" | grep -q 1 \
    || su - postgres -c "psql -qc \"CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASS_NOW'\""
  su - postgres -c "psql -qtAc \"SELECT 1 FROM pg_database WHERE datname='$DB_NAME'\"" | grep -q 1 \
    || su - postgres -c "createdb -O $DB_USER $DB_NAME"
  systemctl reload postgresql >/dev/null 2>&1 || true
  ok "Banco '$DB_NAME' pronto"
fi

# ---------- serviço systemd ----------
install -m 644 "$APP_DIR/deploy/$APP.service" /etc/systemd/system/$APP.service
systemctl daemon-reload
systemctl enable "$APP" >/dev/null 2>&1
systemctl restart "$APP"
ok "Serviço $APP ativo e configurado para iniciar com o servidor"

# ---------- nginx (opcional) ----------
if [ "$NGINX" -eq 1 ]; then
  pkg_install nginx
  PORT_NOW="$(sed -n 's/^PORT=//p' "$ENV_FILE")"
  if [ -d /etc/nginx/sites-available ]; then CONF=/etc/nginx/sites-available/$APP; else CONF=/etc/nginx/conf.d/$APP.conf; fi
  sed -e "s/__PORT__/$PORT_NOW/" -e "s/__DOMINIO__/$DOMINIO/" "$APP_DIR/deploy/nginx.conf" > "$CONF"
  if [ -d /etc/nginx/sites-enabled ]; then ln -sf "$CONF" /etc/nginx/sites-enabled/$APP; rm -f /etc/nginx/sites-enabled/default; fi
  command -v setsebool >/dev/null && setsebool -P httpd_can_network_connect 1 >/dev/null 2>&1 || true
  nginx -t >/dev/null 2>&1 || fail "Configuração do nginx com erro. Veja: nginx -t"
  systemctl enable --now nginx >/dev/null 2>&1; systemctl reload nginx
  ok "nginx publicando na porta 80"
fi

# ---------- firewall ----------
PUB_PORT=$([ "$NGINX" -eq 1 ] && echo 80 || sed -n 's/^PORT=//p' "$ENV_FILE")
if command -v ufw >/dev/null && ufw status | grep -q active; then ufw allow "$PUB_PORT"/tcp >/dev/null; ok "Firewall (ufw): porta $PUB_PORT liberada"; fi
if command -v firewall-cmd >/dev/null && firewall-cmd --state >/dev/null 2>&1; then
  firewall-cmd -q --permanent --add-port="$PUB_PORT"/tcp && firewall-cmd -q --reload; ok "Firewall (firewalld): porta $PUB_PORT liberada"
fi

# ---------- verificação ----------
LOCAL_PORT="$(sed -n 's/^PORT=//p' "$ENV_FILE")"
for _ in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$LOCAL_PORT/api/health" >/dev/null 2>&1 && break; sleep 1
done
curl -fsS "http://127.0.0.1:$LOCAL_PORT/api/health" >/dev/null 2>&1 \
  || fail "O sistema não respondeu. Veja o log: journalctl -u $APP -n 50"

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
URL="http://${IP:-SEU-SERVIDOR}$([ "$NGINX" -eq 1 ] && echo "" || echo ":$PUB_PORT")"
echo
ok "BTS Compress instalado"
echo "   Endereço:          $URL"
echo "   Senha de edição:   $(sed -n 's/^ADMIN_TOKEN=//p' "$ENV_FILE")"
echo "   Configuração:      $ENV_FILE"
echo "   Ver log:           journalctl -u $APP -f"
echo "   Reiniciar:         systemctl restart $APP"
echo "   Atualizar:         sudo ./deploy/update.sh   (de dentro da pasta nova do projeto)"
echo "   Backup do banco:   sudo $APP_DIR/deploy/backup.sh"
