#!/usr/bin/env bash
# Cria UMA ISO que instala sozinha o Ubuntu Server 24.04 + BTS Compress.
# Roda em qualquer Linux (ou WSL no Windows) com internet. Não precisa de root.
#
#   ./deploy/iso/criar-iso.sh                         baixa o Ubuntu 24.04 e gera bts-compress-ubuntu.iso
#   ./deploy/iso/criar-iso.sh ubuntu-24.04-live-server-amd64.iso    usa uma ISO do Ubuntu que você já tem
#
# Na máquina virtual: dê boot por essa ISO. Ela instala tudo sem perguntas e desliga/reinicia sozinha.
# ATENÇÃO: apaga o disco da máquina virtual onde for instalada.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="${OUT:-$PWD/bts-compress-ubuntu.iso}"
REL="https://releases.ubuntu.com/24.04"

ok()   { printf '\033[32m✔\033[0m %s\n' "$*"; }
info() { printf '\033[36m→\033[0m %s\n' "$*"; }
fail() { printf '\033[31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

if ! command -v xorriso >/dev/null; then
  info "Instalando xorriso"
  if command -v apt-get >/dev/null; then sudo apt-get install -y -qq xorriso >/dev/null
  elif command -v dnf >/dev/null; then sudo dnf install -y -q xorriso >/dev/null
  else fail "Instale o xorriso e rode de novo."; fi
fi

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

# ---------- ISO do Ubuntu ----------
SRC="${1:-}"
if [ -z "$SRC" ]; then
  info "Procurando a versão mais nova do Ubuntu Server 24.04"
  curl -fsSL "$REL/SHA256SUMS" -o "$WORK/SHA256SUMS" || fail "Não consegui acessar $REL"
  NAME="$(grep -o 'ubuntu-24\.04[0-9.]*-live-server-amd64\.iso' "$WORK/SHA256SUMS" | sort -V | tail -1)"
  [ -n "$NAME" ] || fail "Não achei a ISO do servidor na lista do Ubuntu."
  SRC="$PWD/$NAME"
  if [ ! -f "$SRC" ]; then
    info "Baixando $NAME (cerca de 3 GB)"
    curl -fL --progress-bar "$REL/$NAME" -o "$SRC.part" && mv "$SRC.part" "$SRC"
  fi
  info "Conferindo o arquivo baixado"
  (cd "$(dirname "$SRC")" && grep " \*\?$NAME\$" "$WORK/SHA256SUMS" | sha256sum -c --quiet -) || fail "A ISO baixada está corrompida. Apague $SRC e rode de novo."
fi
[ -f "$SRC" ] || fail "ISO não encontrada: $SRC"
ok "Ubuntu: $(basename "$SRC")"

# ---------- arquivos da instalação automática ----------
mkdir -p "$WORK/nocloud"
cp "$HERE/user-data" "$HERE/meta-data" "$WORK/nocloud/"
tar czf "$WORK/nocloud/bts-compress.tar.gz" -C "$(dirname "$ROOT")" --exclude=.git --exclude=node_modules --exclude=.env --exclude='*.iso' "$(basename "$ROOT")"
# o pacote precisa se chamar bts-compress/ por dentro
if ! tar tzf "$WORK/nocloud/bts-compress.tar.gz" | head -1 | grep -q '^bts-compress/'; then
  mkdir -p "$WORK/pkg" && cp -r "$ROOT" "$WORK/pkg/bts-compress" && rm -rf "$WORK/pkg/bts-compress/.git"
  tar czf "$WORK/nocloud/bts-compress.tar.gz" -C "$WORK/pkg" --exclude=node_modules --exclude=.env --exclude='*.iso' bts-compress
fi
ok "Pacote do BTS Compress incluído"

# ---------- menu de boot: instalação automática sem perguntas ----------
xorriso -osirrox on -indev "$SRC" -extract /boot/grub/grub.cfg "$WORK/grub.cfg" >/dev/null 2>&1 \
  || fail "Essa ISO não parece ser o Ubuntu Server 24.04 (sem /boot/grub/grub.cfg)."
chmod u+w "$WORK/grub.cfg"
# no GRUB o ";" separa comandos, por isso o parâmetro vai entre aspas
ARG="autoinstall 'ds=nocloud;s=/cdrom/nocloud/'"
sed -i -E \
  -e 's/^set timeout=.*/set timeout=3/' \
  -e '0,/menuentry "[^"]*"/s//menuentry "Instalar BTS Compress (apaga o disco)"/' \
  -e "0,/(linux\s+\/casper\/vmlinuz)(.*)(---)/s##\1\2${ARG} \3#" \
  "$WORK/grub.cfg"
grep -q 'autoinstall' "$WORK/grub.cfg" || fail "Não consegui ajustar o menu de boot."

# ---------- monta a ISO final ----------
info "Gerando $OUT"
xorriso -indev "$SRC" -outdev "$OUT" \
  -map "$WORK/nocloud" /nocloud \
  -map "$WORK/grub.cfg" /boot/grub/grub.cfg \
  -boot_image any replay >/dev/null 2>&1 || fail "O xorriso não conseguiu gerar a ISO."
ok "ISO pronta: $OUT ($(du -h "$OUT" | cut -f1))"
cat <<TXT

  Na máquina virtual (VirtualBox, VMware, Hyper-V, Proxmox):
    • 2 CPUs, 2 GB de RAM ou mais, disco de 20 GB ou mais, rede com acesso à internet
    • dê boot por $(basename "$OUT")
    • a instalação é automática (uns 10 a 20 min) e reinicia sozinha
    • no primeiro boot o BTS Compress é instalado (mais uns 5 min)

  Depois, a tela da VM mostra o endereço.  Sistema: admin / admin   ·   Linux: suporte / admin
TXT
