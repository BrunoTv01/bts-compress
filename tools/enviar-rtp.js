#!/usr/bin/env node
// Envia um arquivo .ts pela rede em RTP (ou UDP), para testar a coleta do BTS Compress
// sem precisar do encoder/mux de verdade.
//
//   node tools/enviar-rtp.js arquivo.ts 239.1.1.1:5000 [--mbps 6] [--udp] [--ttl 4] [--placa IP] [--repetir]
//
//   --mbps     taxa de envio (padrão: 6). Use a taxa do TS (ex.: 32,297 do mux DVB)
//   --udp      sem cabeçalho RTP (TS direto no UDP)
//   --placa    IP da placa de rede por onde sai o multicast
//   --repetir  volta ao começo do arquivo e continua enviando (Ctrl+C para parar)
'use strict';
const fs = require('fs');
const dgram = require('dgram');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const flag = n => args.includes(n);
const [file, dest] = args.filter((a, i) => !a.startsWith('--') && !['--mbps', '--ttl', '--placa'].includes(args[i - 1]));
if (!file || !dest || !/^\d+\.\d+\.\d+\.\d+:\d+$/.test(dest)) {
  console.log('Uso: node tools/enviar-rtp.js arquivo.ts 239.1.1.1:5000 [--mbps 6] [--udp] [--ttl 4] [--placa IP] [--repetir]');
  process.exit(1);
}
const [host, port] = [dest.split(':')[0], +dest.split(':')[1]];
const mbps = Number(String(opt('--mbps', '6')).replace(',', '.'));
const data = fs.readFileSync(file);
const size = data[0] === 0x47 && data[204] === 0x47 && data[188] !== 0x47 ? 204 : 188;
const per = 7, chunk = per * size;
const sock = dgram.createSocket('udp4');
sock.bind(() => {
  sock.setMulticastTTL(+opt('--ttl', 4));
  if (opt('--placa')) sock.setMulticastInterface(opt('--placa'));
  let off = 0, seq = Math.floor(Math.random() * 65535), sent = 0;
  const ssrc = Math.floor(Math.random() * 0xffffffff), t0 = process.hrtime.bigint();
  const bytesPerMs = mbps * 1e6 / 8 / 1000;
  console.log(`Enviando ${file} (${size} bytes/pacote) para ${dest} a ${mbps} Mbps ${flag('--udp') ? 'em UDP' : 'em RTP'}. Ctrl+C para parar.`);
  const tick = () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    while (sent < ms * bytesPerMs) {
      if (off + chunk > data.length) { if (!flag('--repetir')) { console.log('Fim do arquivo.'); sock.close(); return; } off = 0; }
      const ts = data.subarray(off, off + chunk); off += chunk; sent += chunk;
      let pkt = ts;
      if (!flag('--udp')) {
        const h = Buffer.alloc(12);
        h[0] = 0x80; h[1] = 33; h.writeUInt16BE(seq = (seq + 1) & 0xffff, 2);
        h.writeUInt32BE(Math.floor(ms * 90) >>> 0, 4); h.writeUInt32BE(ssrc >>> 0, 8);
        pkt = Buffer.concat([h, ts]);
      }
      sock.send(pkt, port, host);
    }
    setTimeout(tick, 2);
  };
  tick();
});
