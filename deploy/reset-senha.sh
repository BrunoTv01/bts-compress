#!/usr/bin/env bash
# Redefine a senha de um usuário do BTS Compress pelo terminal do servidor.
#   sudo /opt/bts-compress/deploy/reset-senha.sh admin NovaSenha123
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Rode como root: sudo $0 $*"; exit 1; }
[ $# -eq 2 ] || { echo "Uso: sudo $0 USUARIO NOVA_SENHA"; exit 1; }
set -a; . /etc/bts-compress.env; set +a
cd /opt/bts-compress && node tools/reset-password.js "$1" "$2"
