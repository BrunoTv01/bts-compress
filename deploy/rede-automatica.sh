#!/usr/bin/env bash
# Deixa a máquina pronta para receber multicast só ligando o cabo de rede.
# Chamado pelo install.sh, update.sh e pela montagem da imagem do Raspberry. Pode rodar de novo.
#
#   - IGMP versão 2: todo switch entende (o padrão do Linux, versão 3, é ignorado por muitos switches de vídeo)
#   - rp_filter frouxo: não descarta multicast vindo de outra sub-rede
#   - cabo sem DHCP: pega um IP automático (169.254.x.x), suficiente para assinar o multicast
#   - cabo pode ficar sem IP sem derrubar a conexão
set -u
CONF=/etc/sysctl.d/90-bts-coleta.conf
cat > "$CONF" <<'EOF'
# BTS Compress (coleta de multicast): IGMP versão 2 e filtro de origem frouxo
net.ipv4.conf.all.force_igmp_version = 2
net.ipv4.conf.default.force_igmp_version = 2
net.ipv4.conf.all.rp_filter = 2
net.ipv4.conf.default.rp_filter = 2
EOF
rm -f /etc/sysctl.d/90-bts-igmp2.conf   # arquivo antigo do diagnóstico, já incluído aqui
# aplica agora (fora de chroot); placas já existentes também
if [ -d /proc/sys/net/ipv4/conf ] && [ -w /proc/sys/net/ipv4/conf/all/force_igmp_version ]; then
  sysctl -q -p "$CONF" >/dev/null 2>&1 || true
  for d in /proc/sys/net/ipv4/conf/*/; do
    n="$(basename "$d")"; [ "$n" = lo ] && continue
    echo 2 > "$d/force_igmp_version" 2>/dev/null || true
    echo 2 > "$d/rp_filter" 2>/dev/null || true
  done
fi

# cabo de rede: IP automático de reserva (link-local) quando a rede não tem DHCP
if command -v nmcli >/dev/null && nmcli -t general status >/dev/null 2>&1; then
  while IFS=: read -r name type; do
    [ "$type" = "802-3-ethernet" ] || continue
    nmcli connection modify "$name" ipv4.may-fail yes >/dev/null 2>&1 || true
    [ "$(nmcli -g ipv4.method connection show "$name" 2>/dev/null)" = auto ] && \
      nmcli connection modify "$name" ipv4.link-local fallback >/dev/null 2>&1 || true
  done < <(nmcli -t -f NAME,TYPE connection show 2>/dev/null)
  # se ainda não existe conexão de cabo salva, cria uma que vale para qualquer placa de cabo
  if ! nmcli -t -f TYPE connection show 2>/dev/null | grep -q '^802-3-ethernet$'; then
    nmcli connection add type ethernet ifname '*' con-name "Cabo (coleta)" ipv4.method auto ipv4.may-fail yes ipv6.method auto >/dev/null 2>&1 \
      && nmcli connection modify "Cabo (coleta)" ipv4.link-local fallback >/dev/null 2>&1 || true
  fi
elif [ -d /etc/NetworkManager ]; then
  # sem NetworkManager rodando (montagem da imagem): grava o perfil direto
  mkdir -p /etc/NetworkManager/system-connections
  F=/etc/NetworkManager/system-connections/cabo-coleta.nmconnection
  cat > "$F" <<'EOF'
[connection]
id=Cabo (coleta)
type=ethernet
autoconnect=true
autoconnect-priority=10

[ethernet]

[ipv4]
method=auto
may-fail=true
link-local=4

[ipv6]
method=auto
EOF
  chmod 600 "$F"
fi
exit 0
