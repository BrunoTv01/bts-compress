#!/usr/bin/env bash
# Baixa e instala o BTS Compress com banco de dados PostgreSQL local, num comando só.
#
#   curl -fsSL https://raw.githubusercontent.com/BrunoTv01/bts-compress/main/instalar.sh | sudo bash
#
# Opções podem ser passadas depois de "bash -s --", por exemplo:
#   curl -fsSL .../instalar.sh | sudo bash -s -- --nginx
#
# Se o sistema já estiver instalado, este mesmo comando atualiza para a versão mais nova
# (com backup do banco antes), sem perder dados.
set -euo pipefail

# Tudo fica dentro de main(): o bash lê o script inteiro antes de executar.
# Assim, quando vem por "wget ... | sudo bash", nenhum comando (apt-get, dpkg)
# consegue consumir o resto do instalador pela entrada padrão.
main() {
  REPO="BrunoTv01/bts-compress"
  BRANCH="${BTS_BRANCH:-main}"
  URL="https://github.com/$REPO/archive/refs/heads/$BRANCH.tar.gz"

  ok()   { printf '\033[32m✔\033[0m %s\n' "$*"; }
  info() { printf '\033[36m→\033[0m %s\n' "$*"; }
  fail() { printf '\033[31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

  [ "$(id -u)" -eq 0 ] || fail "Rode como root. Ex.: curl -fsSL https://raw.githubusercontent.com/$REPO/main/instalar.sh | sudo bash"
  # Ubuntu Desktop vem sem curl: tenta instalar; se não der, usa o wget
  if ! command -v curl >/dev/null; then
    if command -v apt-get >/dev/null; then apt-get update -qq </dev/null >/dev/null 2>&1; apt-get install -y -qq curl </dev/null >/dev/null 2>&1 || true
    elif command -v dnf >/dev/null; then dnf install -y -q curl </dev/null >/dev/null 2>&1 || true; fi
  fi
  baixar() { if command -v curl >/dev/null; then curl -fsSL "$1" -o "$2"; else wget -q "$1" -O "$2"; fi; }
  command -v tar  >/dev/null || fail "O comando tar não está instalado."

  TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
  info "Baixando o BTS Compress ($BRANCH)"
  baixar "$URL" "$TMP/bts.tar.gz" || fail "Não consegui baixar de $URL. O servidor tem acesso à internet?"
  tar xzf "$TMP/bts.tar.gz" -C "$TMP"
  SRC="$(find "$TMP" -maxdepth 1 -type d -name 'bts-compress-*' | head -1)"
  [ -f "$SRC/deploy/install.sh" ] || fail "O arquivo baixado não tem o instalador."
  VER="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$SRC/package.json")"
  ok "Versão $VER baixada"

  # guarda uma cópia do código em /opt/bts-compress-src para futuras atualizações e consulta
  rm -rf /opt/bts-compress-src && cp -r "$SRC" /opt/bts-compress-src
  chmod +x /opt/bts-compress-src/deploy/*.sh

  if [ -f /etc/systemd/system/bts-compress.service ] && [ -f /etc/bts-compress.env ] && [ -d /opt/bts-compress ]; then
    info "BTS Compress já instalado: atualizando"
    exec /opt/bts-compress-src/deploy/update.sh </dev/null
  else
    exec /opt/bts-compress-src/deploy/install.sh "$@" </dev/null
  fi
}

main "$@"
