#!/usr/bin/env bash
# Instala o BTS Compress num servidor Linux (Ubuntu, Debian, Rocky, Alma, RHEL, CentOS Stream).
#
# Uso (como root, dentro da pasta do projeto):
#   sudo ./deploy/install.sh                       # instala e sobe na porta 3000 (login admin / senha admin)
#   sudo ./deploy/install.sh --nginx               # também publica na porta 80 via nginx
#   sudo ./deploy/install.sh --port 8080 --senha MinhaSenha
#
# Opções:
#   --porta N | --port N   porta do sistema (padrão 3000)
#   --senha S              outra senha inicial para o admin (padrão: admin; troca exigida no 1º acesso)
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
FIRST=0
RESET_ADMIN=0

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
warn() { printf '\033[33m! %s\033[0m\n' "$*" >&2; }
fail() { printf '\033[31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Rode como root: sudo $0 $*"
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$SRC_DIR/server.js" ] || fail "Não achei server.js em $SRC_DIR. Rode o script de dentro da pasta do projeto."
case "$PORT" in ''|*[!0-9]*) fail "Porta inválida: $PORT";; esac
if [ -n "$SENHA" ]; then
  { [ ${#SENHA} -ge 8 ] && [[ "$SENHA" =~ [A-Za-z] ]] && [[ "$SENHA" =~ [0-9] ]]; } \
    || fail "A senha precisa ter 8 caracteres ou mais, com letras e números."
fi
command -v systemctl >/dev/null || fail "Este servidor não usa systemd. Use a instalação com Docker (veja INSTALL.md)."

# ---------- distribuição ----------
. /etc/os-release
case "${ID} ${ID_LIKE:-}" in
  *debian*|*ubuntu*) FAM=deb;;
  *rhel*|*fedora*|*centos*|*rocky*|*almalinux*) FAM=rpm;;
  *) fail "Distribuição não suportada: $PRETTY_NAME. Use a instalação com Docker.";;
esac
info "Sistema: $PRETTY_NAME"

# Ubuntu recém-instalado atualiza sozinho em segundo plano e trava o apt por alguns minutos.
# Em vez de falhar, espera essa atualização terminar (até 20 min).
APT_OPTS=(-o DPkg::Lock::Timeout=1200 -o Acquire::Retries=3)
wait_apt() {
  [ "$FAM" = deb ] || return 0
  command -v fuser >/dev/null || return 0
  local avisou=0 n=0
  while fuser /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock /var/lib/apt/lists/lock /var/cache/apt/archives/lock >/dev/null 2>&1; do
    [ $avisou = 1 ] || { info "O Ubuntu está instalando atualizações em segundo plano. Aguardando terminar (pode levar alguns minutos)..."; avisou=1; }
    n=$((n+1)); [ $n -lt 240 ] || { warn "A atualização automática não terminou em 20 min. Tentando assim mesmo."; break; }
    sleep 5
  done
  [ $avisou = 0 ] || ok "Atualização automática do Ubuntu terminou"
}
pkg_install() {
  wait_apt
  if [ "$FAM" = deb ]; then
    DEBIAN_FRONTEND=noninteractive apt-get "${APT_OPTS[@]}" install -y -qq "$@" </dev/null >/dev/null \
      || fail "Não consegui instalar: $*. Rode 'sudo apt-get install $*' para ver o erro."
  else dnf install -y -q "$@" </dev/null >/dev/null || fail "Não consegui instalar: $*"; fi
}
# O Ubuntu instalado de ISO deixa o CD como fonte de pacotes (file:/cdrom).
# Sem o CD na máquina o apt dá erro e o instalador do Node.js desiste: desliga essa fonte.
disable_cdrom_sources() {
  local f mudou=0
  # formato antigo (.list): "deb cdrom:[...]" ou "deb [check-date=no] file:///cdrom ..."
  for f in /etc/apt/sources.list /etc/apt/sources.list.d/*.list; do
    [ -f "$f" ] || continue
    if grep -qE '^[[:space:]]*deb(-src)?[[:space:]].*cdrom' "$f"; then
      sed -i -E 's|^([[:space:]]*deb(-src)?[[:space:]].*cdrom.*)$|# \1|' "$f"; mudou=1
    fi
  done
  # formato novo (.sources): bloco com "URIs: file:/cdrom" ou "cdrom:"
  for f in /etc/apt/sources.list.d/*.sources; do
    [ -f "$f" ] && grep -qiE '^URIs:.*cdrom' "$f" || continue
    cp "$f" "$f.bak-bts"
    awk 'BEGIN{RS="";ORS="\n\n"} /(^|\n)URIs:[^\n]*cdrom/ && !/(^|\n)Enabled:/ {$0=$0"\nEnabled: no"} {print}' "$f.bak-bts" > "$f"
    cmp -s "$f" "$f.bak-bts" || mudou=1; rm -f "$f.bak-bts"
  done
  [ $mudou = 0 ] || ok "Fonte de pacotes do CD de instalação desligada"
}
if [ "$FAM" = deb ]; then
  disable_cdrom_sources
  info "Atualizando lista de pacotes"
  wait_apt
  apt-get "${APT_OPTS[@]}" update -qq </dev/null \
    || warn "A atualização da lista de pacotes deu erro (veja acima). Continuando com a lista atual."
fi
pkg_install curl ca-certificates openssl rsync

# ---------- Node.js ----------
node_major() { command -v node >/dev/null && node -p 'process.versions.node.split(".")[0]' || echo 0; }
if [ "$(node_major)" -lt "$NODE_MIN" ]; then
  info "Instalando Node.js 22 (NodeSource)"
  wait_apt
  if [ "$FAM" = deb ]; then curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null || warn "Repositório NodeSource falhou; tentando o Node.js do Ubuntu"
  else curl -fsSL https://rpm.nodesource.com/setup_22.x | bash - >/dev/null; fi
  pkg_install nodejs
fi
[ "$(node_major)" -ge "$NODE_MIN" ] || fail "Não consegui instalar Node.js $NODE_MIN ou mais novo. Rode 'sudo apt-get update' e veja se alguma linha começa com E: (fonte de pacotes com erro)."
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

# ---------- SRT (opcional: coleta de streams SRT) ----------
if ! command -v srt-live-transmit >/dev/null; then
  info "Instalando srt-tools (coleta de streams SRT)"
  wait_apt
  if [ "$FAM" = deb ]; then DEBIAN_FRONTEND=noninteractive apt-get "${APT_OPTS[@]}" install -y -qq srt-tools </dev/null >/dev/null 2>&1
  else dnf install -y -q srt </dev/null >/dev/null 2>&1; fi
  command -v srt-live-transmit >/dev/null && ok "SRT disponível (srt-live-transmit)" \
    || warn "Não consegui instalar o srt-tools: a coleta funciona em UDP/RTP, mas não em SRT."
fi

# ---------- usuário e arquivos ----------
id "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR"
rsync -a --delete --exclude node_modules --exclude .git --exclude .env "$SRC_DIR"/ "$APP_DIR"/
info "Instalando dependências do sistema (npm)"
( cd "$APP_DIR" && npm install --omit=dev --no-audit --no-fund --loglevel=error ) \
  || { [ -d "$APP_DIR/node_modules/express" ] && [ -d "$APP_DIR/node_modules/pg" ] && warn "Sem internet para o npm: usando as dependências que já vieram instaladas"; } \
  || fail "Não consegui instalar as dependências (npm). O servidor tem acesso à internet?"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
ok "Arquivos em $APP_DIR"

# ---------- configuração (.env) ----------
if [ -f "$ENV_FILE" ]; then
  ok "Mantendo configuração existente em $ENV_FILE"
  if [ -n "$SENHA" ]; then
    RESET_ADMIN=1
  fi
else
  FIRST=1
  DB_PASS="$(openssl rand -hex 16)"
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
# Senha inicial do admin. Vazio = "admin". Só vale enquanto não existe nenhum usuário.
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

bash "$APP_DIR/deploy/firewall-multicast.sh" || true

# ---------- verificação ----------
LOCAL_PORT="$(sed -n 's/^PORT=//p' "$ENV_FILE")"
for _ in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$LOCAL_PORT/api/health" >/dev/null 2>&1 && break; sleep 1
done
curl -fsS "http://127.0.0.1:$LOCAL_PORT/api/health" >/dev/null 2>&1 \
  || fail "O sistema não respondeu. Veja o log: journalctl -u $APP -n 50"

if [ "$RESET_ADMIN" -eq 1 ]; then
  bash "$APP_DIR/deploy/reset-senha.sh" admin "$SENHA" || fail "Senha recusada: use 8 caracteres ou mais, com letras e números."
fi

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
URL="http://${IP:-SEU-SERVIDOR}$([ "$NGINX" -eq 1 ] && echo "" || echo ":$PUB_PORT")"
echo
ok "BTS Compress instalado"
echo "   Endereço:          $URL"
if [ "$FIRST" -eq 1 ]; then
  INI="$(sed -n 's/^ADMIN_TOKEN=//p' "$ENV_FILE")"
  echo "   Login:             admin"
  echo "   Senha:             ${INI:-admin}   (o sistema pede uma senha nova no primeiro acesso)"
elif [ "$RESET_ADMIN" -eq 1 ]; then
  echo "   Login:             admin"
  echo "   Senha provisória:  $SENHA   (o sistema pede uma senha nova no próximo acesso)"
fi
echo "   Esqueceu a senha:  sudo $APP_DIR/deploy/reset-senha.sh   (volta para admin / admin)"
echo "   Configuração:      $ENV_FILE"
echo "   Ver log:           journalctl -u $APP -f"
echo "   Reiniciar:         systemctl restart $APP"
echo "   Atualizar:         curl -fsSL https://raw.githubusercontent.com/BrunoTv01/bts-compress/main/instalar.sh | sudo bash"
echo "   Backup do banco:   sudo $APP_DIR/deploy/backup.sh"
