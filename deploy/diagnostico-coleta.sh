#!/usr/bin/env bash
# Descobre por que um stream multicast não chega na Coleta RTP.
#
#   sudo bash /opt/bts-compress/deploy/diagnostico-coleta.sh 225.2.1.25:5002
#
# Verifica placas de rede, rotas, firewall, filtro de origem (rp_filter), tenta receber o grupo
# por cada placa e olha (com tcpdump) se os pacotes chegam na máquina e em qual porta.
set -uo pipefail
APP_DIR=/opt/bts-compress
ok()   { printf '\033[32m✔\033[0m %s\n' "$*"; }
info() { printf '\033[36m→\033[0m %s\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*"; }
bad()  { printf '\033[31m✖ %s\033[0m\n' "$*"; }
titulo() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "Rode como root: sudo bash $0 GRUPO:PORTA"; exit 1; }
ALVO="${1:-}"
[[ "$ALVO" =~ ^([0-9]{1,3}(\.[0-9]{1,3}){3}):([0-9]{1,5})$ ]] || { echo "Uso: sudo bash $0 225.2.1.25:5002"; exit 1; }
GRUPO="${ALVO%:*}"; PORTA="${ALVO##*:}"
cd "$APP_DIR" 2>/dev/null || cd "$(dirname "$0")/.."
CONCL=()

titulo "Máquina"
VER="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' package.json 2>/dev/null)"
echo "BTS Compress $VER · $(. /etc/os-release; echo "$PRETTY_NAME")"
if command -v systemd-detect-virt >/dev/null; then echo "Virtualização: $(systemd-detect-virt 2>/dev/null || echo nenhuma)"; fi

titulo "Placas de rede"
if command -v ip >/dev/null; then
  ip -4 -o addr show | awk '{print "  " $2 "  " $4}'
  echo "Rota usada para o grupo $GRUPO:"; ip -4 route get "$GRUPO" 2>/dev/null | head -1 | sed 's/^/  /'
  echo "Rota padrão:"; ip -4 route show default | sed 's/^/  /'
  if ip -4 route get "$GRUPO" 2>/dev/null | head -1 | grep -q " dev lo "; then
    warn "A rota do multicast vai para a placa lo (loopback), não para a placa de rede."
    DEV="$(ip -4 route show default | awk '{for(i=1;i<=NF;i++) if($i=="dev"){print $(i+1); exit}}')"
    CONCL+=("A rota de multicast está na lo: o que é enviado desta máquina não sai pela placa de rede. Para corrigir: sudo ip route replace 224.0.0.0/4 dev ${DEV:-enp0s3}  (e veja de onde vem a rota: ip route show table all | grep -E '224|lo')")
  fi
fi
mapfile -t PLACAS < <(node -e 'for (const [n, l] of Object.entries(require("os").networkInterfaces())) for (const a of l) if ((a.family === "IPv4" || a.family === 4) && !a.internal) console.log(n + " " + a.address)')
command -v ip >/dev/null || for p in "${PLACAS[@]}"; do echo "  $p"; done
[ ${#PLACAS[@]} -gt 1 ] && warn "Há ${#PLACAS[@]} placas de rede: o stream pode estar chegando por uma que não é a padrão."

titulo "Firewall"
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
  if ufw status 2>/dev/null | grep -q "224.0.0.0/4"; then ok "ufw ligado e com a regra de multicast"
  else
    warn "ufw ligado SEM a regra de multicast: criando agora"
    bash "$APP_DIR/deploy/firewall-multicast.sh" && CONCL+=("O firewall bloqueava o multicast e foi liberado agora. Tente coletar de novo.")
  fi
else ok "ufw desligado (não bloqueia)"; fi

titulo "Filtro de origem (rp_filter)"
for f in /proc/sys/net/ipv4/conf/{all,default}/rp_filter; do echo "  $(basename "$(dirname "$f")"): $(cat "$f")"; done
RP_ALL="$(cat /proc/sys/net/ipv4/conf/all/rp_filter 2>/dev/null || echo 0)"
[ "$RP_ALL" = 1 ] && warn "rp_filter=1 (estrito): pode descartar multicast vindo de outra sub-rede."

titulo "Recebendo $GRUPO:$PORTA por cada placa (5 s cada)"
ACHOU=""
for linha in "auto -" "${PLACAS[@]}"; do
  nome="${linha% *}"; ipp="${linha#* }"; [ "$nome" = auto ] && ipp=""
  rotulo=$([ -z "$ipp" ] && echo "automática" || echo "$nome ($ipp)")
  r="$(node tools/analisar-rtp.js "$GRUPO:$PORTA" --segundos 5 ${ipp:+--placa "$ipp"} 2>&1 | head -4 | tr '\n' ' ')"
  if [[ "$r" == *"Taxa total"* ]]; then ok "Placa $rotulo: RECEBEU · ${r:0:150}"; ACHOU="${ACHOU:-$rotulo}"
  else bad "Placa $rotulo: nada"; fi
done

# tcpdump: os pacotes chegam na máquina? Em qual porta? Que outros grupos multicast passam aqui?
if ! command -v tcpdump >/dev/null && command -v apt-get >/dev/null; then
  info "Instalando tcpdump para olhar os pacotes"; DEBIAN_FRONTEND=noninteractive apt-get install -y -qq tcpdump </dev/null >/dev/null 2>&1
fi
if command -v tcpdump >/dev/null; then
  titulo "Pacotes para $GRUPO chegando na máquina (8 s, com o grupo assinado)"
  node tools/analisar-rtp.js "$GRUPO:$PORTA" --segundos 9 >/dev/null 2>&1 &
  JOIN=$!
  sleep 0.5
  PK="$(timeout 8 tcpdump -ni any -c 20 "udp and dst host $GRUPO" 2>/dev/null)"
  wait $JOIN 2>/dev/null
  if [ -n "$PK" ]; then
    echo "$PK" | head -5 | sed 's/^/  /'
    PORTAS="$(echo "$PK" | grep -o "$GRUPO\.[0-9]*" | sed "s/$GRUPO\.//" | sort -u | tr '\n' ' ')"
    ok "Chegam pacotes para $GRUPO (porta(s): $PORTAS)"
    [[ " $PORTAS " != *" $PORTA "* ]] && CONCL+=("O grupo $GRUPO chega, mas na porta $PORTAS e não na $PORTA. Corrija a porta no cadastro.")
  else
    bad "Nenhum pacote para $GRUPO chegou na máquina"
  fi
  titulo "Outros grupos multicast passando por aqui (6 s)"
  OUT="$(timeout 6 tcpdump -ni any -c 2000 "udp and dst net 224.0.0.0/4" 2>/dev/null | grep -oE '> (2(2[4-9]|3[0-9])\.[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)' | sed 's/> //' | sort | uniq -c | sort -rn | head -15)"
  if [ -n "$OUT" ]; then echo "$OUT" | awk '{n=split($2,a,"."); printf "  %s:%s  (%s pacotes)\n", a[1]"."a[2]"."a[3]"."a[4], a[5], $1}'
    NSTREAM="$(echo "$OUT" | awk '$1>50' | wc -l)"
    [ -z "$ACHOU" ] && [ "$NSTREAM" -gt 0 ] && CONCL+=("Chegam outros streams multicast, mas não $GRUPO:$PORTA. Confira o grupo e a porta no equipamento (ou se esse grupo vai para esta rede).")
  else
    bad "Nenhum multicast chegando nesta máquina"
    [ -z "$ACHOU" ] && CONCL+=("Nenhum multicast chega nesta máquina. Se for VM: placa em modo Bridge, ligada ao cabo de rede (não ao Wi-Fi) e com 'Modo promíscuo: permitir tudo'. Confira também se este computador está na mesma rede/VLAN dos equipamentos e se o switch entrega o multicast (IGMP).")
  fi
else
  warn "tcpdump não disponível: não deu para olhar os pacotes."
fi

titulo "Conclusão"
if [ -n "$ACHOU" ]; then
  ok "O stream chega pela placa $ACHOU."
  [ "$ACHOU" != automática ] && echo "   No cadastro do stream, em Placa de rede, escolha essa placa."
  [ "$ACHOU" = automática ] && echo "   Se a coleta na tela ainda falhar, atualize o sistema e recarregue a página (Ctrl+F5)."
fi
for c in "${CONCL[@]}"; do warn "$c"; done
[ -z "$ACHOU" ] && [ ${#CONCL[@]} -eq 0 ] && warn "O stream não chegou. Mande este resultado para análise."
echo
