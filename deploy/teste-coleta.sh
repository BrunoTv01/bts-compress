#!/usr/bin/env bash
# Teste da Coleta RTP sem equipamento: gera dois streams SIMULADOS dentro desta máquina
# (mux DVB e BTS ISDB-T, com os serviços e PIDs da planilha), mede pelo terminal e
# cadastra os dois na aba Coleta RTP para você testar pelo navegador.
#
#   sudo bash /opt/bts-compress/deploy/teste-coleta.sh            liga o teste por 15 minutos
#   sudo bash /opt/bts-compress/deploy/teste-coleta.sh --minutos 30
#   sudo bash /opt/bts-compress/deploy/teste-coleta.sh --parar    desliga os streams de teste
#   sudo bash /opt/bts-compress/deploy/teste-coleta.sh --remover  desliga e apaga os streams de teste do cadastro
#
# Os streams usam TTL 0: não saem desta máquina e não atrapalham a rede.
set -euo pipefail
APP_DIR=/opt/bts-compress; ENV_FILE=/etc/bts-compress.env
DVB=239.255.10.1; DVB_PORT=5500; ISDB=239.255.10.2; ISDB_PORT=5502
ok()   { printf '\033[32m✔\033[0m %s\n' "$*"; }
info() { printf '\033[36m→\033[0m %s\n' "$*"; }
fail() { printf '\033[31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Rode como root: sudo bash $0"
[ -f "$APP_DIR/tools/stream-teste.js" ] || fail "Versão antiga do sistema. Atualize antes: curl -fsSL https://raw.githubusercontent.com/BrunoTv01/bts-compress/main/instalar.sh | sudo bash"
MIN=15; ACAO=ligar
while [ $# -gt 0 ]; do case "$1" in
  --minutos) MIN="$2"; shift;; --parar) ACAO=parar;; --remover) ACAO=remover;;
  *) fail "Opção desconhecida: $1";; esac; shift; done

DBURL="$(sed -n 's/^DATABASE_URL=//p' "$ENV_FILE" 2>/dev/null || true)"
sql() { [ -n "$DBURL" ] && psql -qtA "$DBURL" -c "$1" 2>/dev/null; }

pkill -f "tools/stream-teste.js" 2>/dev/null && ok "Streams de teste anteriores desligados" || true
if [ "$ACAO" = parar ]; then exit 0; fi
if [ "$ACAO" = remover ]; then
  sql "DELETE FROM stream_sources WHERE name LIKE 'TESTE · %'" >/dev/null && ok "Streams de teste apagados do cadastro"
  exit 0
fi

# backup antes, para poder desfazer se alguém gravar os valores de teste
BK=""
if [ -x "$APP_DIR/deploy/backup.sh" ] && "$APP_DIR/deploy/backup.sh" >/dev/null 2>&1; then
  BK="$(ls -1t /var/backups/bts-compress/bts-*.sql.gz 2>/dev/null | head -1)"
  ok "Backup do banco feito antes do teste: $BK"
fi

# placa de rede principal (o multicast volta para a própria máquina por ela)
IP="$( (ip -4 route get 1.1.1.1 2>/dev/null || true) | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -1)"
[ -n "$IP" ] || IP="$( (hostname -I 2>/dev/null || true) | awk '{print $1}')"
[ -n "$IP" ] || IP=127.0.0.1
bash "$APP_DIR/deploy/firewall-multicast.sh" >/dev/null 2>&1 || true

info "Ligando os streams simulados por $MIN minutos (placa $IP, sem sair da máquina)"
cd "$APP_DIR"
setsid nohup node tools/stream-teste.js dvb  "$DVB:$DVB_PORT"   --placa "$IP" --ttl 0 --minutos "$MIN" >/var/log/bts-teste-dvb.log  2>&1 < /dev/null &
setsid nohup node tools/stream-teste.js isdb "$ISDB:$ISDB_PORT" --placa "$IP" --ttl 0 --minutos "$MIN" >/var/log/bts-teste-isdb.log 2>&1 < /dev/null &
sleep 2

FALHOU=0
for alvo in "$DVB:$DVB_PORT" "$ISDB:$ISDB_PORT"; do
  echo; info "Medindo $alvo pelo terminal (5 segundos)"
  node tools/analisar-rtp.js "$alvo" --segundos 5 --placa "$IP" || FALHOU=1
done
echo
[ $FALHOU -eq 0 ] || fail "A medição pelo terminal falhou (veja acima). Rode de novo; se repetir, mande a mensagem."
ok "Leitura dos streams funcionando nesta máquina"

# cadastra (ou atualiza) os dois streams de teste na aba Coleta RTP
if [ -n "$DBURL" ]; then
  for linha in "TESTE · Mux DVB (simulado)|dvb|$DVB|$DVB_PORT|[\"pids\",\"pids_total\",\"mux\"]" \
               "TESTE · BTS ISDB-T (simulado)|isdb|$ISDB|$ISDB_PORT|[\"pids\",\"isdb_layers\",\"isdb_pids\"]"; do
    IFS='|' read -r nome tipo end porta abas <<< "$linha"
    existe="$(sql "SELECT id FROM stream_sources WHERE name='$nome'" || true)"
    if [ -n "$existe" ]; then sql "UPDATE stream_sources SET iface='$IP', address='$end', port=$porta WHERE id=$existe" >/dev/null
    else sql "INSERT INTO stream_sources (name,kind,address,port,iface,seconds,targets,notes) VALUES ('$nome','$tipo','$end',$porta,'$IP',5,'$abas','Stream simulado pelo deploy/teste-coleta.sh. Não grave os valores: são de teste.')" >/dev/null; fi
  done
  ok "Streams de teste cadastrados na aba Coleta RTP"
fi

PORTA="$(sed -n 's/^PORT=//p' "$ENV_FILE" 2>/dev/null || true)"
echo
echo "   Agora no navegador: http://localhost:${PORTA:-3000}  →  aba Coleta RTP"
echo "   Clique em Coletar em \"TESTE · Mux DVB (simulado)\" e \"TESTE · BTS ISDB-T (simulado)\"."
echo "   Confira os serviços, os PIDs e a lista de mudanças."
echo
printf '\033[33m   ! São dados de TESTE: NÃO clique em Gravar (eles trocariam os valores reais).\033[0m\n'
[ -n "$BK" ] && echo "     Se gravar sem querer, volte o banco: sudo $APP_DIR/deploy/backup.sh --restaurar $BK"
echo
echo "   Os streams desligam sozinhos em $MIN minutos. Para desligar antes:"
echo "     sudo bash $APP_DIR/deploy/teste-coleta.sh --parar"
echo "   Para tirar os streams de teste do cadastro:"
echo "     sudo bash $APP_DIR/deploy/teste-coleta.sh --remover"
