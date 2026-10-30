#!/usr/bin/env bash
# Roda DENTRO da imagem do Raspberry Pi OS (ARM, emulado no GitHub Actions) para montar a
# imagem do cartão já com tudo instalado. O banco e o serviço são criados no primeiro boot.
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive
SRC=/opt/bts-compress-src
APP=/opt/bts-compress

apt-get update
apt-get install -y --no-install-recommends curl ca-certificates openssl rsync postgresql srt-tools ufw tcpdump
# Node.js 22 (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
node -v

# sistema em /opt/bts-compress com as dependências já baixadas (funciona sem internet no 1º boot)
chmod +x "$SRC"/deploy/*.sh "$SRC"/deploy/raspberry/*.sh
mkdir -p "$APP"
rsync -a --delete --exclude .git --exclude .github --exclude node_modules "$SRC"/ "$APP"/
( cd "$APP" && npm install --omit=dev --no-audit --no-fund --loglevel=error )
id bts >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin bts
chown -R bts:bts "$APP"

# rede: IGMP v2, cabo com IP automático de reserva (só ligar o cabo e coletar)
bash "$SRC/deploy/rede-automatica.sh"

# primeiro boot: cria banco, configuração e serviço (deploy/install.sh)
install -m 644 "$SRC/deploy/raspberry/bts-primeiro-boot.service" /etc/systemd/system/bts-primeiro-boot.service
systemctl enable bts-primeiro-boot.service

# usuário do Linux: suporte / admin (troca de senha obrigatória no 1º login), SSH ligado
if ! id suporte >/dev/null 2>&1; then
  useradd -m -s /bin/bash -G sudo,adm,netdev suporte
  echo 'suporte:admin' | chpasswd
  chage -d 0 suporte
fi
systemctl enable ssh || true
systemctl disable userconfig.service 2>/dev/null || true   # sem o assistente de criar usuário
rm -f /etc/ssh/sshd_config.d/rename_user.conf

# nome na rede: bts-compress.local
echo bts-compress > /etc/hostname
sed -i 's/^127\.0\.1\.1.*/127.0.1.1\tbts-compress/' /etc/hosts
grep -q bts-compress /etc/hosts || echo -e "127.0.1.1\tbts-compress" >> /etc/hosts

# endereço do sistema na tela de login (\4 = IP)
printf '\nBTS Compress: http://\\4:3000   (login admin / senha admin)\nLinux: usuario suporte / senha admin\n\n' >> /etc/issue

apt-get clean
