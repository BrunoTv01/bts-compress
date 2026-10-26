#!/usr/bin/env bash
# Copia todos os dados de outro PostgreSQL (por exemplo, o do Render) para o banco local do BTS Compress.
# Leva serviços, PIDs, bitrates, equipamentos, usuários e senhas, e o histórico.
#
# Uso (no servidor Linux, com o BTS Compress já instalado):
#   sudo /opt/bts-compress/deploy/importar-banco.sh "postgresql://usuario:senha@host.render.com/bts"
#
# No Render, o endereço fica em: bts-compress-db → Connect → External Database URL.
set -euo pipefail
APP=bts-compress
ENV_FILE=/etc/$APP.env
DEST=/var/backups/$APP

ok()   { printf '\033[32m✔\033[0m %s\n' "$*"; }
info() { printf '\033[36m→\033[0m %s\n' "$*"; }
fail() { printf '\033[31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Rode como root: sudo $0 \"ENDERECO_DO_BANCO\""
ORIGEM="${1:-}"
[ -n "$ORIGEM" ] || fail "Informe o endereço do banco de origem. Ex.: sudo $0 \"postgresql://usuario:senha@host/bts\""
[ -f "$ENV_FILE" ] || fail "BTS Compress não está instalado aqui. Rode antes: sudo ./deploy/install.sh"
LOCAL="$(sed -n 's/^DATABASE_URL=//p' "$ENV_FILE")"
[ -n "$LOCAL" ] || fail "Não achei DATABASE_URL em $ENV_FILE."
command -v pg_dump >/dev/null || fail "pg_dump não encontrado. Instale: sudo apt install postgresql-client"

# bancos fora da máquina (como o do Render) exigem conexão criptografada
case "$ORIGEM" in
  *localhost*|*127.0.0.1*|*sslmode=*) ;;
  *\?*) ORIGEM="$ORIGEM&sslmode=require";;
  *)    ORIGEM="$ORIGEM?sslmode=require";;
esac

info "Conectando ao banco de origem"
SRV_NUM="$(psql "$ORIGEM" -tAX -c 'show server_version_num' 2>/tmp/bts-import.err)" \
  || fail "Não consegui conectar na origem: $(head -1 /tmp/bts-import.err). Confira o endereço (External Database URL)."
psql "$ORIGEM" -tAX -c "SELECT 1 FROM information_schema.tables WHERE table_name='services'" | grep -q 1 \
  || fail "A origem não tem as tabelas do BTS Compress. Confira se é o banco certo."
SRV_MAJOR=$((SRV_NUM / 10000))
DUMP_MAJOR="$(pg_dump --version | grep -oE '[0-9]+' | head -1)"
if [ "$DUMP_MAJOR" -lt "$SRV_MAJOR" ]; then
  fail "O banco de origem é PostgreSQL $SRV_MAJOR e o pg_dump daqui é $DUMP_MAJOR. Instale o cliente $SRV_MAJOR:
   sudo apt install -y postgresql-common && sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
   sudo apt install -y postgresql-client-$SRV_MAJOR
   e rode este comando de novo."
fi
N_SVC="$(psql "$ORIGEM" -tAX -c 'SELECT count(*) FROM services')"
N_USR="$(psql "$ORIGEM" -tAX -c 'SELECT count(*) FROM users' 2>/dev/null || echo 0)"
ok "Origem: PostgreSQL $SRV_MAJOR · $N_SVC serviços · $N_USR usuários"

mkdir -p "$DEST"; chmod 700 "$DEST"
STAMP="$(date +%Y%m%d-%H%M%S)"
info "Backup do banco local antes de substituir"
pg_dump --clean --if-exists --no-owner "$LOCAL" | gzip > "$DEST/antes-importar-$STAMP.sql.gz"
ok "Backup local em $DEST/antes-importar-$STAMP.sql.gz"

info "Baixando os dados da origem"
ARQ="$DEST/importado-$STAMP.sql.gz"
pg_dump --clean --if-exists --no-owner --no-privileges "$ORIGEM" | gzip > "$ARQ"
chmod 600 "$DEST"/*.sql.gz
ok "Cópia salva em $ARQ"

info "Parando o sistema e gravando no banco local"
systemctl stop $APP
if ! gunzip -c "$ARQ" | grep -vE '^(SET transaction_timeout|\\restrict|\\unrestrict)' | psql -q -v ON_ERROR_STOP=1 "$LOCAL" >/tmp/bts-import.err 2>&1; then
  info "Erro ao gravar. Voltando o banco local como estava"
  gunzip -c "$DEST/antes-importar-$STAMP.sql.gz" | psql -q "$LOCAL" >/dev/null 2>&1 || true
  systemctl start $APP
  fail "Importação desfeita: $(grep -m1 -i error /tmp/bts-import.err)"
fi
systemctl start $APP

PORT="$(sed -n 's/^PORT=//p' "$ENV_FILE")"
for _ in $(seq 1 30); do curl -fsS "http://127.0.0.1:${PORT:-3000}/api/health" >/dev/null 2>&1 && break; sleep 1; done
L_SVC="$(psql "$LOCAL" -tAX -c 'SELECT count(*) FROM services')"
L_USR="$(psql "$LOCAL" -tAX -c 'SELECT count(*) FROM users')"
ok "Importado: $L_SVC serviços · $L_USR usuários agora no banco local"
echo "   Os usuários e senhas são os mesmos da origem."
echo "   Se algo ficou errado, volte com:"
echo "   sudo /opt/$APP/deploy/backup.sh --restaurar $DEST/antes-importar-$STAMP.sql.gz"
