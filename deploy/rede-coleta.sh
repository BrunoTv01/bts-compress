#!/usr/bin/env bash
# Deixa a placa de cabo só para a coleta de multicast e o Wi-Fi para acessar o sistema e a internet.
#
#   sudo bash /opt/bts-compress/deploy/rede-coleta.sh                      cabo eth0 com IP automático (DHCP)
#   sudo bash /opt/bts-compress/deploy/rede-coleta.sh --ip 10.10.1.50/24   cabo com IP fixo (rede de vídeo sem DHCP)
#   sudo bash /opt/bts-compress/deploy/rede-coleta.sh --placa end0          outra placa de cabo
#   sudo bash /opt/bts-compress/deploy/rede-coleta.sh --desfazer            volta o cabo ao normal
#
# O que faz (NetworkManager, vale depois de reiniciar):
#   - rota de multicast 224.0.0.0/4 pela placa de cabo
#   - o cabo não vira rota padrão (a internet continua pelo Wi-Fi)
#   - o cabo sobe mesmo sem DHCP
set -euo pipefail
ok()   { printf '\033[32m✔\033[0m %s\n' "$*"; }
info() { printf '\033[36m→\033[0m %s\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*"; }
fail() { printf '\033[31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Rode como root: sudo bash $0"
command -v nmcli >/dev/null || fail "Este sistema não usa NetworkManager (nmcli). Configure a rede manualmente."
PLACA=""; IP=""; DESFAZER=0
while [ $# -gt 0 ]; do case "$1" in
  --placa) PLACA="$2"; shift;; --ip) IP="$2"; shift;; --desfazer) DESFAZER=1;;
  *) fail "Opção desconhecida: $1";; esac; shift; done
if [ -n "$IP" ] && ! [[ "$IP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}/[0-9]{1,2}$ ]]; then fail "IP inválido. Use o formato 10.10.1.50/24"; fi

# placa de cabo: a informada ou a primeira ethernet
[ -n "$PLACA" ] || PLACA="$(nmcli -t -f DEVICE,TYPE device | awk -F: '$2=="ethernet"{print $1; exit}')"
[ -n "$PLACA" ] || fail "Não achei placa de rede de cabo."
info "Placa de cabo: $PLACA"

CON="$(nmcli -g GENERAL.CONNECTION device show "$PLACA" 2>/dev/null | head -1)"
if [ -z "$CON" ] || [ "$CON" = "--" ]; then
  CON="$(nmcli -t -f NAME,TYPE,DEVICE connection show | awk -F: -v d="$PLACA" '$2 ~ /ethernet/ && ($3==d || $3=="") {print $1; exit}')"
fi
if [ -z "$CON" ]; then
  CON="Coleta (cabo)"
  nmcli connection add type ethernet ifname "$PLACA" con-name "$CON" >/dev/null
  ok "Conexão \"$CON\" criada"
fi
info "Conexão: $CON"

if [ $DESFAZER -eq 1 ]; then
  nmcli connection modify "$CON" ipv4.never-default no -ipv4.routes "224.0.0.0/4" 2>/dev/null || true
  nmcli connection up "$CON" >/dev/null 2>&1 || true
  ok "Cabo voltou ao normal (pode virar rota padrão de novo)"; exit 0
fi

if [ -n "$IP" ]; then
  nmcli connection modify "$CON" ipv4.method manual ipv4.addresses "$IP" ipv4.gateway ""
  ok "IP fixo no cabo: $IP"
else
  nmcli connection modify "$CON" ipv4.method auto
fi
nmcli connection modify "$CON" ipv4.never-default yes ipv4.may-fail yes ipv6.method ignore connection.autoconnect yes
nmcli connection modify "$CON" -ipv4.routes "224.0.0.0/4" 2>/dev/null || true
nmcli connection modify "$CON" +ipv4.routes "224.0.0.0/4"
nmcli connection up "$CON" >/dev/null 2>&1 || warn "O cabo ainda não subiu (está conectado ao switch?). A configuração fica salva."
sleep 2

echo
ADDR="$(ip -4 -o addr show dev "$PLACA" 2>/dev/null | awk '{print $4}' | head -1)"
[ -n "$ADDR" ] && ok "IP do cabo ($PLACA): $ADDR" || warn "O cabo ($PLACA) está sem IP. Sem IP não dá para assinar o multicast: use --ip com um IP livre da rede de vídeo."
R="$(ip -4 route get 239.1.1.1 2>/dev/null | head -1)"
[[ "$R" == *"dev $PLACA"* ]] && ok "Multicast sai e chega pelo cabo: $R" || warn "Rota de multicast: $R"
D="$(ip -4 route show default | head -1)"
[ -n "$D" ] && ok "Internet / acesso: $D" || warn "Sem rota padrão: confira o Wi-Fi."
WIP="$(ip -4 -o addr show | awk '$2 ~ /^wl/ {print $4}' | head -1)"
echo
echo "   Acesse o sistema pelo Wi-Fi: http://${WIP%/*}:3000"
echo "   No cadastro do stream (Coleta RTP), em Placa de rede, escolha: $PLACA · ${ADDR%/*}"
