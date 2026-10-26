#!/usr/bin/env bash
# Redefine a senha de um usuário do BTS Compress pelo terminal do servidor.
#   sudo /opt/bts-compress/deploy/reset-senha.sh                 admin volta para a senha padrão "admin"
#   sudo /opt/bts-compress/deploy/reset-senha.sh maria Prov1234  senha provisória para outro usuário
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Rode como root: sudo $0 $*"; exit 1; }
[ $# -le 2 ] || { echo "Uso: sudo $0 [USUARIO] [NOVA_SENHA]"; exit 1; }
cd /opt/bts-compress && node tools/reset-password.js "$@"
