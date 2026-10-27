#!/usr/bin/env node
// Gera um stream de TESTE (simulado) em RTP, com os serviços e PIDs da planilha, para testar a
// Coleta RTP sem o mux, o BTS ou os encoders de verdade. Não precisa de arquivo .ts nem de ffmpeg.
//
//   node tools/stream-teste.js dvb  239.255.10.1:5500 [--placa IP] [--ttl 0] [--minutos 15] [--udp]
//   node tools/stream-teste.js isdb 239.255.10.2:5502 [--placa IP] [--ttl 0] [--minutos 15]
//
//   dvb   mux DVB a 32,297 Mbps, pacotes de 188 bytes
//   isdb  BTS ISDB-T a 32,507 Mbps, pacotes de 204 bytes com layer A (1seg) e B
//   --ttl 0 (padrão) o stream não sai da máquina; use 1 ou mais para mandar para a rede
//
// O conteúdo é de mentira (só os pacotes e as tabelas PAT, PMT e SDT): não tem imagem nem som.
'use strict';
const dgram = require('dgram');
const { crc32 } = require('../ts/analyzer');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const profile = args[0], dest = args[1];
if (!['dvb', 'isdb'].includes(profile) || !/^\d+\.\d+\.\d+\.\d+:\d+$/.test(dest || '')) {
  console.log('Uso: node tools/stream-teste.js dvb|isdb 239.255.10.1:5500 [--placa IP] [--ttl 0] [--minutos 15] [--udp]');
  process.exit(1);
}

/* ---------- serviços simulados (PIDs da planilha, taxas em Mbps) ---------- */
const V2 = 0x02, AVC = 0x1b, MP1A = 0x03, AAC = 0x0f, LATM = 0x11;
const a = (pid, type, mbps, lang = 'por') => ({ pid, type, mbps, lang });
const DVB = {
  name: 'TV CULTURA', tsid: 1, onid: 0x2001, rate: 32.297, size: 188, services: [
    { sid: 1, name: 'RÁDIO AM', pmt: 100, pcr: 110, es: [a(120, MP1A, 0.192)] },
    { sid: 2, name: 'RÁDIO FM', pmt: 200, pcr: 210, es: [a(121, MP1A, 0.192)] },
    { sid: 3, name: 'SPNET HD', pmt: 300, pcr: 305, es: [{ pid: 310, type: AVC, mbps: 4.55 }, a(320, AAC, 0.141), a(321, AAC, 0.141, 'eng'), a(322, AAC, 0.141, 'spa')] },
    { sid: 4, name: 'CULTURA SD', pmt: 400, es: [{ pid: 410, type: AVC, mbps: 1.0 }, a(420, AAC, 0.1), a(421, AAC, 0.1, 'eng')] },
    { sid: 5, name: 'RTB SD', pmt: 500, es: [{ pid: 510, type: V2, mbps: 1.08 }, a(520, MP1A, 0.1), a(521, MP1A, 0.1, 'eng')] },
    { sid: 10, name: 'RTB HD', pmt: 1000, es: [{ pid: 1010, type: V2, mbps: 3.75 }, a(1020, MP1A, 0.112), a(1021, MP1A, 0.112, 'eng')] },
    { sid: 11, name: 'CULT AAC', pmt: 1100, pcr: 1105, es: [a(1120, AAC, 0.196)] },
    { sid: 12, name: 'FEED', pmt: 1300, pcr: 1305, es: [{ pid: 1310, type: AVC, mbps: 4.55 }, a(1320, AAC, 0.141), a(1321, AAC, 0.141, 'eng'), a(1322, AAC, 0.141, 'spa')] },
    { sid: 99, name: 'CANAL TESTE', pmt: 1500, es: [{ pid: 1510, type: AVC, mbps: 0.45 }, a(1520, AAC, 0.064)] },
  ],
};
// ISDB-T: componentes de dados com os descritores usados no SBTVD
const cc = pid => ({ pid, type: 0x06, mbps: 0.0043, desc: [[0x52, [0x30]], [0xfd, [0x00, 0x08]]] });
const ait = pid => ({ pid, type: 0x05, mbps: 0.002, desc: [[0x6f, [0x00, 0x10]]] });
const dem = pid => ({ pid, type: 0x0b, mbps: 0.003, desc: [[0x52, [0x40]]] });
const ect = pid => ({ pid, type: 0x0c, mbps: 0.002, desc: [[0x52, [0x41]]] });
const dat = pid => ({ pid, type: 0x0d, mbps: 0.01, desc: [[0x52, [0x42]]] });
const ISDB = {
  name: 'TV CULTURA', tsid: 0x3a60, onid: 0x3a60, rate: 32.50794, size: 204, layers: { A: 0.4164, B: 12.483 }, services: [
    { sid: 59232, name: 'TV CULTURA HD', pmt: 600, pcr: 605, layer: 'B', es: [{ pid: 610, type: AVC, mbps: 4.85 }, a(620, LATM, 0.101), a(621, LATM, 0.064, 'eng'), a(622, LATM, 0.064, 'spa'), a(623, LATM, 0.192, 'por'), cc(630), ect(640), dat(650), ait(660), dem(670)] },
    { sid: 59233, name: 'UNIVESP', pmt: 700, pcr: 705, layer: 'B', es: [{ pid: 710, type: AVC, mbps: 1.9 }, a(720, LATM, 0.068), a(721, LATM, 0.032, 'eng'), cc(730), ect(740), dat(750), ait(760), dem(770)] },
    { sid: 59234, name: 'REDE ALESP', pmt: 800, pcr: 805, layer: 'B', es: [{ pid: 810, type: AVC, mbps: 1.9 }, a(820, LATM, 0.068), a(821, LATM, 0.032, 'eng'), cc(830), ect(840), dat(850), ait(860), dem(870)] },
    { sid: 59235, name: 'CANAL 2.4', pmt: 1200, pcr: 1205, layer: 'B', es: [{ pid: 1210, type: AVC, mbps: 1.25 }, a(1220, LATM, 0.068), cc(1230), ect(1240), dat(1250), ait(1260), dem(1270)] },
    { sid: 59256, name: 'TV CULTURA 1SEG', pmt: 8136, pcr: 905, layer: 'A', type: 0xc0, es: [{ pid: 910, type: AVC, mbps: 0.27 }, a(920, LATM, 0.05), cc(930), ect(940), dat(950), ait(960), dem(970)] },
  ],
};
const P = profile === 'dvb' ? DVB : ISDB;
const isdb = profile === 'isdb';

/* ---------- tabelas PSI/SI ---------- */
function section(tid, ext, body) {
  const len = body.length + 5 + 4;
  const h = Buffer.from([tid, 0xb0 | ((len >> 8) & 0x0f), len & 0xff, ext >> 8, ext & 0xff, 0xc1, 0, 0]);
  const s = Buffer.concat([h, body]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(s, 0, s.length)); return Buffer.concat([s, c]);
}
const u16 = v => [v >> 8 & 0xff, v & 0xff];
const descBytes = list => Buffer.from((list || []).flatMap(([t, d]) => [t, d.length, ...d]));
function pat() {
  const b = [...u16(0), 0xe0 | 0, 0x10]; // programa 0 -> NIT no PID 0x10
  for (const s of P.services) b.push(...u16(s.sid), 0xe0 | (s.pmt >> 8), s.pmt & 0xff);
  return section(0x00, P.tsid, Buffer.from(b));
}
function pmt(s) {
  const pcr = s.pcr ?? s.es[0].pid;
  const b = [0xe0 | (pcr >> 8), pcr & 0xff, 0xf0, 0];
  for (const e of s.es) {
    const d = descBytes([...(e.lang ? [[0x0a, [...Buffer.from(e.lang), 0]]] : []), ...(e.desc || [])]);
    b.push(e.type, 0xe0 | (e.pid >> 8), e.pid & 0xff, 0xf0 | (d.length >> 8), d.length & 0xff, ...d);
  }
  return section(0x02, s.sid, Buffer.from(b));
}
function sdt() {
  const b = [...u16(P.onid), 0xff];
  for (const s of P.services) {
    const name = Buffer.from(s.name, 'latin1'), prov = Buffer.from(P.name, 'latin1');
    const nameB = isdb ? name : Buffer.concat([Buffer.from([0x05]), name]); // DVB: ISO 8859-9 (latin)
    const d = descBytes([[0x48, [s.type || 0x01, prov.length, ...prov, nameB.length, ...nameB]]]);
    b.push(...u16(s.sid), 0xfc, 0x80 | (d.length >> 8), d.length & 0xff, ...d);
  }
  return section(0x42, P.tsid, Buffer.from(b));
}
const simple = (tid, ext) => section(tid, ext, Buffer.from([0xf0, 0x00]));

/* ---------- fluxos: cada PID com sua taxa ---------- */
// taxas variam um pouco a cada execução, como num mux de verdade
const drift = () => 1 + (Math.random() - 0.5) * 0.06;
const flows = [];
const add = (pid, mbps, layer, kind, sec) => flows.push({ pid, rate: mbps * 1e6 / (188 * 8), layer, kind, sec, cc: 0, credit: Math.random(), pos: 0, pcr: false });
const psiRate = (perSec, sec) => perSec * Math.ceil((sec.length + 1) / 184) * 188 * 8 / 1e6;
const L = { A: 1, B: 2 };
const secPat = pat(), secSdt = sdt();
add(0, psiRate(10, secPat), L.B, 'psi', () => secPat);
add(0x11, psiRate(2, secSdt), L.B, 'psi', () => secSdt);
const nit = simple(0x40, P.onid), tot = section(0x73, 0xffff, Buffer.from([0xf0, 0]));
add(0x10, psiRate(10, nit), L.B, 'psi', () => nit);
if (isdb) add(0x14, psiRate(1, tot), L.B, 'psi', () => tot);
for (const s of P.services) {
  const lay = L[s.layer] || L.B, sec = pmt(s);
  add(s.pmt, psiRate(10, sec), lay, 'psi', () => sec);
  if (s.pcr != null && !s.es.some(e => e.pid === s.pcr)) { add(s.pcr, 0.04, lay, 'pcr'); flows.at(-1).pcr = true; }
  s.es.forEach((e, i) => { add(e.pid, e.mbps * drift(), lay, 'es'); if (i === 0 && (s.pcr == null || s.pcr === e.pid)) flows.at(-1).pcr = true; });
}
// pacotes por segundo do TS e nulos de cada layer (no BTS) ou do mux (DVB)
const pktPerSec = P.rate * 1e6 / (P.size * 8);
const used = l => flows.filter(f => f.layer === l).reduce((s, f) => s + f.rate, 0);
if (isdb) {
  for (const [l, cap] of Object.entries(P.layers)) add(0x1fff, Math.max(0, cap - used(L[l]) * 188 * 8 / 1e6), L[l], 'null');
  const rest = pktPerSec - flows.reduce((s, f) => s + f.rate, 0);
  add(0x1fff, rest * 188 * 8 / 1e6, 0, 'null');            // TSP nulo não transmitido (layer 0)
} else {
  add(0x1fff, (pktPerSec - flows.reduce((s, f) => s + f.rate, 0)) * 188 * 8 / 1e6, 0, 'null');
}
const total = flows.reduce((s, f) => s + f.rate, 0);
for (const f of flows) f.share = f.rate / total;

/* ---------- montagem dos pacotes ---------- */
const t0 = Date.now();
function packet(f) {
  const p = Buffer.alloc(P.size, 0xff);
  p[0] = 0x47; p[1] = (f.pid >> 8) & 0x1f; p[2] = f.pid & 0xff;
  let off = 4;
  if (f.kind === 'psi') {
    const sec = f.sec(); const start = f.pos === 0;
    if (start) p[1] |= 0x40;
    p[3] = 0x10 | f.cc;
    if (start) { p[4] = 0; off = 5; }
    const n = Math.min(sec.length - f.pos, 188 - off);
    sec.copy(p, off, f.pos, f.pos + n); f.pos += n;
    if (f.pos >= sec.length) f.pos = 0;
  } else if (f.kind === 'null') {
    p[3] = 0x10;
  } else {
    if (f.pcr) { // campo de adaptação com PCR
      p[3] = 0x30 | f.cc; p[4] = 7; p[5] = 0x10;
      const base = Math.floor((Date.now() - t0) * 90) % 2 ** 33;
      p[6] = Math.floor(base / 2 ** 25) & 0xff; p[7] = (base >>> 17) & 0xff; p[8] = (base >>> 9) & 0xff; p[9] = (base >>> 1) & 0xff; p[10] = ((base & 1) << 7) | 0x7e; p[11] = 0;
      off = 12;
    } else p[3] = 0x10 | f.cc;
    if (f.kind === 'es') for (let k = off; k < 188; k++) p[k] = (k * 7 + f.cc) & 0xff;
  }
  if (f.kind !== 'null') f.cc = (f.cc + 1) & 0x0f;
  if (isdb) { p[188] = 0x80; p[189] = (f.layer & 0x0f) << 4; }
  return p;
}
function next() { // distribui os pacotes na proporção da taxa de cada PID
  let best = flows[0];
  for (const f of flows) { f.credit += f.share; if (f.credit > best.credit) best = f; }
  best.credit -= 1;
  return packet(best);
}

/* ---------- envio ---------- */
const [host, port] = [dest.split(':')[0], +dest.split(':')[1]];
const sock = dgram.createSocket('udp4');
const minutes = Number(opt('--minutos', 15));
sock.bind(() => {
  sock.setMulticastTTL(Number(opt('--ttl', 0)));
  sock.setMulticastLoopback(true);
  if (opt('--placa')) sock.setMulticastInterface(opt('--placa'));
  const bytesPerMs = P.rate * 1e6 / 8 / 1000, chunk = 7 * P.size;
  let sent = 0, seq = 0;
  const ssrc = (Math.random() * 0xffffffff) >>> 0;
  console.log(`Stream de TESTE ${profile.toUpperCase()} (${P.services.length} serviços, ${String(P.rate).replace('.', ',')} Mbps) em ${dest}${opt('--placa') ? ' pela placa ' + opt('--placa') : ''} por ${minutes} min. Ctrl+C para parar.`);
  const stopAt = Date.now() + minutes * 60000;
  const tick = () => {
    const ms = Date.now() - t0;
    if (Date.now() > stopAt) { console.log('Tempo do teste terminou.'); sock.close(); return; }
    let n = 0;
    while (sent < ms * bytesPerMs && n++ < 400) {
      const pk = []; for (let i = 0; i < 7; i++) pk.push(next());
      let buf = Buffer.concat(pk);
      if (!args.includes('--udp')) {
        const h = Buffer.alloc(12); h[0] = 0x80; h[1] = 33; h.writeUInt16BE(seq = (seq + 1) & 0xffff, 2);
        h.writeUInt32BE((ms * 90) >>> 0, 4); h.writeUInt32BE(ssrc, 8); buf = Buffer.concat([h, buf]);
      }
      sock.send(buf, port, host); sent += chunk;
    }
    if (sent < ms * bytesPerMs - bytesPerMs * 1000) sent = ms * bytesPerMs; // máquina lenta: não acumula atraso
    setTimeout(tick, 2);
  };
  tick();
});
process.on('SIGINT', () => { console.log('\nParado.'); process.exit(0); });
