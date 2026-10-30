// Recebe um stream RTP/UDP (multicast ou unicast) por alguns segundos e devolve a análise do TS.
'use strict';
const dgram = require('dgram');
const crypto = require('crypto');
const os = require('os');
const { TsAnalyzer } = require('./analyzer');

const isMulticast = ip => /^(22[4-9]|23\d)\./.test(ip || '');
const isIPv4 = ip => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(ip || '') && ip.split('.').every(n => +n <= 255);

// Placas de rede IPv4 da máquina (para escolher por onde entra o multicast)
function interfaces() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces()))
    for (const a of list || []) if (a.family === 'IPv4' || a.family === 4) out.push({ name, address: a.address, internal: a.internal });
  return out;
}

// "239.1.1.1:5000" ou "udp://@239.1.1.1:5000" ou "rtp://239.1.1.1:5000"
function parseAddress(txt) {
  const m = String(txt || '').trim().match(/^(?:(?:rtp|udp):\/\/)?@?(\d{1,3}(?:\.\d{1,3}){3})?:(\d{1,5})$/i);
  if (!m) return null;
  return { address: m[1] || '', port: +m[2] };
}

/**
 * capture({ address, port, iface, source, seconds })
 *   address  grupo multicast (239.x.x.x) ou vazio/IP local para unicast
 *   iface    IP da placa de rede por onde o multicast chega (opcional)
 *   source   IP de origem para multicast com origem específica (SSM, opcional)
 */
function capture({ address = '', port, iface = '', source = '', seconds = 10, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    port = Number(port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return reject(friendly('Porta inválida (1 a 65535).'));
    if (address && !isIPv4(address)) return reject(friendly('Endereço IP inválido.'));
    if (iface && !isIPv4(iface)) return reject(friendly('IP da placa de rede inválido.'));
    if (source && !isIPv4(source)) return reject(friendly('IP de origem inválido.'));
    seconds = Math.min(60, Math.max(2, Number(seconds) || 10));
    const mc = isMulticast(address);
    const an = new TsAnalyzer();
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    let done = false, timer = null, tick = null, first = null, ignored = 0, otherIp = null;
    // placa automática com várias placas (cabo + Wi-Fi na mesma rede): o mesmo pacote pode chegar duas vezes
    let multi = false, dups = 0;
    const seen = new Set(), order = [];
    const isDup = msg => {
      const h = crypto.createHash('sha1').update(msg).digest('base64');
      if (seen.has(h)) return true;
      seen.add(h); order.push(h);
      if (order.length > 4000) seen.delete(order.shift());
      return false;
    };
    const finish = err => {
      if (done) return; done = true;
      clearTimeout(timer); clearInterval(tick);
      try { sock.close(); } catch { /* já fechado */ }
      if (err) return reject(err);
      if (!an.datagrams && ignored) return reject(friendly(`Chegaram pacotes na porta ${port}, mas de outro IP (${otherIp}), não do equipamento ${source}. Confira o IP do equipamento no cadastro.`, 'outro_ip'));
      if (!an.datagrams) return reject(friendly(`Nenhum pacote chegou em ${address || 'qualquer endereço'}:${port} em ${seconds} s. ` +
        (mc ? 'Confira o endereço e a porta, se a placa de rede está na rede do multicast (escolha a placa certa) e se o firewall libera UDP.' : 'Confira se o equipamento está enviando para este servidor e se o firewall libera a porta UDP.'), 'sem_pacotes'));
      if (!an.packets) return reject(friendly('Chegaram pacotes, mas não são MPEG-TS (nem por RTP nem por UDP).', 'nao_ts'));
      const r = an.result();
      if (dups) r.duplicates = dups; // cópias descartadas (chegaram por mais de uma placa)
      resolve(r);
    };
    sock.on('error', e => finish(friendly(e.code === 'EADDRINUSE' ? `A porta ${port} está em uso por outro programa.` :
      e.code === 'EACCES' ? `Sem permissão para usar a porta ${port}. Use uma porta acima de 1024.` :
      e.code === 'EADDRNOTAVAIL' ? 'Esse IP de placa de rede não existe nesta máquina.' : `Erro de rede: ${e.message}`)));
    sock.on('message', (msg, rinfo) => {
      // unicast com IP do equipamento: ignora o que vier de outra origem
      if (!mc && source && rinfo.address !== source) { ignored++; otherIp = rinfo.address; return; }
      if (multi && isDup(msg)) { dups++; return; }
      if (first == null) first = Date.now(); an.push(msg);
    });
    // no Linux, ligar no endereço do grupo filtra outros grupos na mesma porta
    const bindAddr = mc && process.platform !== 'win32' ? address : (!mc && address ? address : undefined);
    sock.bind({ port, address: bindAddr, exclusive: false }, () => {
      try {
        if (mc) {
          if (source && mc) sock.addSourceSpecificMembership(source, address, iface || undefined);
          else if (iface) sock.addMembership(address, iface);
          else {
            // placa automática: assina o grupo em todas as placas, para receber por onde o stream vier
            let n = 0;
            // inclui a loopback: um stream gerado na própria máquina pode sair por ela (rota de multicast na lo)
            for (const i of interfaces()) { try { sock.addMembership(address, i.address); n++; } catch { /* placa sem multicast */ } }
            if (!n) sock.addMembership(address);
            multi = n > 1;
          }
        }
        try { sock.setRecvBufferSize(8 * 1024 * 1024); } catch { /* limite do sistema */ }
      } catch (e) {
        return finish(friendly(e.code === 'EADDRNOTAVAIL' || e.code === 'EINVAL' || e.code === 'ENODEV'
          ? 'Não consegui entrar no grupo multicast por essa placa de rede. Escolha a placa ligada à rede do stream.'
          : `Não consegui entrar no grupo multicast: ${e.message}`));
      }
      // conta o tempo a partir do primeiro pacote; se nada chegar, desiste no tempo pedido
      const startedAt = Date.now();
      tick = setInterval(() => {
        const t = first ? Date.now() - first : 0;
        if (onProgress) onProgress({ elapsed: t / 1000, datagrams: an.datagrams });
        if (first && t >= seconds * 1000) finish();
        else if (!first && Date.now() - startedAt >= seconds * 1000) finish();
      }, 100);
      timer = setTimeout(() => finish(), (seconds * 2 + 5) * 1000);
    });
  });
}

function friendly(msg, code) { return Object.assign(new Error(msg), { friendly: true, code }); }

module.exports = { capture, interfaces, parseAddress, isMulticast, isIPv4 };
