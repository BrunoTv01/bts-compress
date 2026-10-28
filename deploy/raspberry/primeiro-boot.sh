#!/usr/bin/env bash
# Primeiro boot do cartão do Raspberry: cria o banco PostgreSQL, a configuração e liga o BTS Compress.
# Roda uma vez só (o serviço para de rodar quando /etc/bts-compress.env existe).
exec >>/var/log/bts-primeiro-boot.log 2>&1
echo "=== $(date) primeiro boot ==="
for _ in $(seq 1 30); do systemctl is-active --quiet postgresql && break; systemctl start postgresql; sleep 2; done
bash /opt/bts-compress-src/deploy/install.sh </dev/null && echo "=== pronto ===" || echo "=== falhou: veja acima ==="
