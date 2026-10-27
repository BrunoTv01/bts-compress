#!/usr/bin/env bash
# Prepara esta máquina (VM) para virar uma cópia (.ova) que pode ser ligada em qualquer rede.
# Rode DENTRO da VM, logo antes de exportar:
#
#   sudo bash /opt/bts-compress/deploy/vm/preparar-copia.sh
#
# O que faz:
#   1. Backup do banco do BTS Compress.
#   2. Rede automática (DHCP) em qualquer placa de rede, mesmo com outro nome ou MAC.
#   3. Apaga a identidade da máquina (machine-id, leases DHCP, chaves SSH): cada cópia
#      ligada pede um IP próprio e não "rouba" o IP da VM original.
#   4. Mostra o endereço do sistema na tela de login, no SSH e no comando "bts-endereco".
#   5. Limpa arquivos temporários e desliga a VM, pronta para exportar.
#
# Opções:
#   -y               não pergunta nada
#   --compactar      preenche o espaço livre com zeros (o .ova fica bem menor; demora alguns minutos)
#   --nao-desligar   não desliga no final
set -euo pipefail

ok()   { printf '\033[32m✔\033[0m %s\n' "$*"; }
info() { printf '\033[36m→\033[0m %s\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*" >&2; }
fail() { printf '\033[31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

SIM=0; COMPACTAR=0; DESLIGAR=1
for a in "$@"; do
  case "$a" in
    -y|--sim) SIM=1;;
    --compactar) COMPACTAR=1;;
    --nao-desligar) DESLIGAR=0;;
    -h|--help) sed -n '2,20p' "$0"; exit 0;;
    *) fail "Opção desconhecida: $a";;
  esac
done
[ "$(id -u)" -eq 0 ] || fail "Rode como root: sudo bash $0"

echo
echo "  Preparar esta VM para virar uma cópia (.ova)"
echo "  Depois disso ela vai DESLIGAR. Na próxima vez que ligar (aqui ou na cópia),"
echo "  ela pega um IP novo da rede sozinha."
echo
if [ $SIM -eq 0 ] && [ -r /dev/tty ]; then
  read -r -p "  Continuar? [s/N] " r </dev/tty
  case "$r" in s|S|sim|SIM) ;; *) echo "  Cancelado."; exit 0;; esac
fi

# ---------- 1. backup ----------
if [ -x /opt/bts-compress/deploy/backup.sh ]; then
  info "Backup do banco do BTS Compress"
  /opt/bts-compress/deploy/backup.sh >/dev/null && ok "Backup salvo em /var/backups/bts-compress" \
    || warn "Backup falhou; continuando"
fi

# ---------- 2. rede automática (DHCP) em qualquer placa ----------
if command -v nmcli >/dev/null && systemctl is-enabled NetworkManager >/dev/null 2>&1; then
  # Perfil sem placa nem MAC fixos: serve para qualquer placa de rede com cabo.
  # O client-id pelo MAC faz cada cópia (MAC novo) receber um IP diferente.
  mkdir -p /etc/NetworkManager/system-connections
  F=/etc/NetworkManager/system-connections/bts-rede-automatica.nmconnection
  cat > "$F" <<EOF
[connection]
id=Rede automática (BTS)
uuid=$(cat /proc/sys/kernel/random/uuid)
type=ethernet
autoconnect=true
autoconnect-priority=100

[ethernet]

[ipv4]
method=auto
dhcp-client-id=mac
dhcp-timeout=2147483647

[ipv6]
method=auto
addr-gen-mode=default
EOF
  chmod 600 "$F"
  # não deixa o NetworkManager desistir de criar conexões automáticas
  rm -f /etc/NetworkManager/conf.d/*no-auto-default* 2>/dev/null || true
  # perfis com IP fixo ou presos a um MAC antigo atrapalham na outra rede: desliga o autoconnect deles
  while IFS=: read -r uuid tipo; do
    [ "$tipo" = "802-3-ethernet" ] || continue
    nome="$(nmcli -g connection.id con show "$uuid" 2>/dev/null || true)"
    [ "$nome" = "Rede automática (BTS)" ] && continue
    metodo="$(nmcli -g ipv4.method con show "$uuid" 2>/dev/null || true)"
    mac="$(nmcli -g 802-3-ethernet.mac-address con show "$uuid" 2>/dev/null || true)"
    if [ "$metodo" = "manual" ] || [ -n "$mac" ]; then
      nmcli con modify "$uuid" connection.autoconnect no >/dev/null 2>&1 && warn "Perfil de rede \"$nome\" (IP fixo ou MAC antigo) não liga mais sozinho"
    fi
  done < <(nmcli -t -f UUID,TYPE con show 2>/dev/null || true)
  nmcli con reload >/dev/null 2>&1 || true
  ok "Rede automática (DHCP) configurada no NetworkManager para qualquer placa"
elif [ -d /etc/netplan ]; then
  # Ubuntu Server (systemd-networkd): qualquer placa com nome e* (eth0, enp0s3, ens18...) pega IP por DHCP
  cat > /etc/netplan/99-bts-rede-automatica.yaml <<'EOF'
# Criado pelo BTS Compress (preparar-copia.sh): DHCP em qualquer placa de rede com cabo.
network:
  version: 2
  renderer: networkd
  ethernets:
    qualquer-placa:
      match:
        name: "e*"
      dhcp4: true
      dhcp6: true
      dhcp-identifier: mac
      optional: true
EOF
  chmod 600 /etc/netplan/99-bts-rede-automatica.yaml
  # o cloud-init grava a rede presa ao MAC antigo; sem isso ele não refaz e a placa nova fica sem IP
  if [ -d /etc/cloud/cloud.cfg.d ]; then
    echo "network: {config: disabled}" > /etc/cloud/cloud.cfg.d/99-bts-rede.cfg
    for y in /etc/netplan/50-cloud-init.yaml; do [ -f "$y" ] && mv "$y" "$y.desligado-bts"; done
  fi
  command -v netplan >/dev/null && netplan generate 2>/dev/null || true
  ok "Rede automática (DHCP) configurada no netplan para qualquer placa"
else
  warn "Não achei NetworkManager nem netplan; a rede fica como está"
fi

# ---------- 3. endereço do sistema na tela ----------
cat > /usr/local/bin/bts-endereco <<'EOF'
#!/bin/sh
# Mostra o endereço do BTS Compress nesta máquina.
PORTA="$(sed -n 's/^PORT=//p' /etc/bts-compress.env 2>/dev/null)"; PORTA="${PORTA:-3000}"
IPS="$(hostname -I 2>/dev/null)"
if [ -z "$IPS" ]; then echo "Sem IP ainda. Verifique o cabo/rede da VM (modo Bridge no VirtualBox)."; exit 1; fi
for ip in $IPS; do case "$ip" in *:*) ;; *) echo "BTS Compress: http://$ip:$PORTA";; esac; done
EOF
chmod 755 /usr/local/bin/bts-endereco

# tela de login do console: o \4 é trocado pelo IP na hora
if ! grep -q "BTS Compress" /etc/issue 2>/dev/null; then
  PORTA_ATUAL="$(sed -n 's/^PORT=//p' /etc/bts-compress.env 2>/dev/null || true)"
  printf '\nBTS Compress: http://\\4:%s   (login admin)\n\n' "${PORTA_ATUAL:-3000}" >> /etc/issue
fi
# entrada pelo SSH
if [ -d /etc/update-motd.d ]; then
  printf '#!/bin/sh\necho\n/usr/local/bin/bts-endereco\necho\n' > /etc/update-motd.d/99-bts-compress
  chmod 755 /etc/update-motd.d/99-bts-compress
fi
# área de trabalho (Ubuntu Desktop): aviso com o endereço ao entrar
if [ -d /etc/xdg/autostart ]; then
  cat > /etc/xdg/autostart/bts-endereco.desktop <<'EOF'
[Desktop Entry]
Type=Application
Name=Endereço do BTS Compress
Exec=sh -c 'sleep 15; command -v notify-send >/dev/null && notify-send -t 0 "BTS Compress" "$(/usr/local/bin/bts-endereco)"'
NoDisplay=true
X-GNOME-Autostart-enabled=true
EOF
fi
ok "Endereço aparece na tela de login, no SSH e no comando: bts-endereco"

# ---------- 4. chaves SSH novas em cada cópia ----------
if [ -d /etc/ssh ] && command -v ssh-keygen >/dev/null; then
  cat > /etc/systemd/system/bts-chaves-ssh.service <<'EOF'
[Unit]
Description=Gera chaves SSH novas (primeiro boot da cópia da VM)
ConditionPathExists=!/etc/ssh/ssh_host_ed25519_key
Before=ssh.service ssh.socket sshd.service

[Service]
Type=oneshot
ExecStart=/usr/bin/ssh-keygen -A

[Install]
WantedBy=multi-user.target
EOF
  systemctl enable bts-chaves-ssh.service >/dev/null 2>&1 || true
  rm -f /etc/ssh/ssh_host_*
  ok "Chaves SSH serão geradas de novo no próximo boot"
fi

# ---------- 5. identidade da máquina ----------
info "Apagando a identidade desta máquina"
# sessões abertas no sistema (cada cópia começa sem ninguém logado)
if [ -f /etc/bts-compress.env ] && command -v psql >/dev/null; then
  URL="$(sed -n 's/^DATABASE_URL=//p' /etc/bts-compress.env)"
  [ -n "$URL" ] && psql -q "$URL" -c "DELETE FROM sessions" >/dev/null 2>&1 || true
fi
rm -f /var/lib/NetworkManager/*.lease /var/lib/NetworkManager/internal-* /var/lib/NetworkManager/timestamps 2>/dev/null || true
rm -rf /var/lib/dhcp/* /var/lib/dhclient/* 2>/dev/null || true
# machine-id vazio = o systemd cria um novo no próximo boot (o DHCP usa esse número)
truncate -s 0 /etc/machine-id
rm -f /var/lib/dbus/machine-id
[ -d /var/lib/dbus ] && ln -s /etc/machine-id /var/lib/dbus/machine-id
ok "Identidade apagada (machine-id, leases DHCP)"

# ---------- 6. limpeza ----------
info "Limpando arquivos temporários"
command -v apt-get >/dev/null && apt-get clean >/dev/null 2>&1 || true
journalctl --rotate >/dev/null 2>&1 || true
journalctl --vacuum-time=1s >/dev/null 2>&1 || true
rm -f /root/.bash_history /home/*/.bash_history 2>/dev/null || true
ok "Limpeza feita"

if [ $COMPACTAR -eq 1 ]; then
  info "Preenchendo o espaço livre com zeros (o .ova fica menor; pode levar alguns minutos)"
  dd if=/dev/zero of=/zero.bts bs=1M status=progress 2>&1 || true
  sync; rm -f /zero.bts; sync
  ok "Espaço livre zerado"
fi

echo
ok "VM pronta para virar cópia"
echo "   Agora, no VirtualBox (no Windows): dois cliques em deploy\\vm\\exportar-vm.bat"
echo "   ou Arquivo → Exportar Appliance → OVF 2.0 → \"Gerar novos endereços MAC\"."
echo
if [ $DESLIGAR -eq 1 ]; then
  echo "   Desligando em 10 segundos (Ctrl+C para cancelar)..."
  sleep 10
  systemctl poweroff
fi
