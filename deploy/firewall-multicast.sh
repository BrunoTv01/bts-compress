#!/usr/bin/env bash
# Libera no firewall a entrada de streams UDP multicast (239.x.x.x), usados pela aba Coleta RTP.
# Chamado pelo install.sh e pelo update.sh. Pode rodar de novo sem problema.
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow in proto udp to 224.0.0.0/4 comment 'BTS Compress - coleta RTP multicast' >/dev/null 2>&1 \
    && echo "✔ Firewall (ufw): entrada de UDP multicast liberada para a coleta RTP"
fi
if command -v firewall-cmd >/dev/null && firewall-cmd --state >/dev/null 2>&1; then
  firewall-cmd -q --permanent --add-rich-rule='rule family="ipv4" destination address="224.0.0.0/4" protocol value="udp" accept' 2>/dev/null
  firewall-cmd -q --permanent --add-protocol=igmp 2>/dev/null
  firewall-cmd -q --reload && echo "✔ Firewall (firewalld): entrada de UDP multicast liberada para a coleta RTP"
fi
exit 0
