#!/usr/bin/env node
// Mede um stream RTP/UDP ou SRT pelo terminal, sem abrir o sistema.
//   node tools/analisar-rtp.js 239.1.1.1:5000 [--segundos 10] [--placa IP] [--origem IP] [--json]
//   node tools/analisar-rtp.js srt://10.0.0.20:9000 [--listener] [--senha X] [--streamid X] [--latencia 200]
'use strict';
const { capture, parseAddress } = require('../ts/capture');
const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const { captureSrt } = require('../ts/srt');
const srtArg = args.find(x => /^srt:\/\//i.test(x));
const a = srtArg ? null : parseAddress(args.find(x => /:\d+$/.test(x)));
if (!a && !srtArg) { console.log('Uso: node tools/analisar-rtp.js 239.1.1.1:5000 [--segundos 10] [--placa IP] [--origem IP] [--json]'); process.exit(1); }
const f = v => v == null ? '—' : String(v).replace('.', ',');
const m = srtArg && srtArg.match(/^srt:\/\/([^:/]*):(\d+)/i);
(srtArg
  ? captureSrt({ host: m ? m[1] : '', port: m ? +m[2] : 0, mode: args.includes('--listener') ? 'listener' : 'caller', passphrase: opt('--senha') || '', streamid: opt('--streamid') || '', latency: +(opt('--latencia') || 200), seconds: opt('--segundos') || 10 })
  : capture({ ...a, seconds: opt('--segundos') || 10, iface: opt('--placa') || '', source: opt('--origem') || '' }))
  .then(r => {
    if (args.includes('--json')) return console.log(JSON.stringify(r, null, 2));
    console.log(`\n${r.transport} · pacotes de ${r.packetSize} bytes · ${r.system} · ${f(r.seconds)} s`);
    console.log(`Taxa total ${f(r.totalMbps)} Mbps · útil ${f(r.payloadMbps)} · nulos ${f(r.nullMbps)} · erros CC ${r.ccErrors}${r.rtp ? ` · RTP perdidos ${r.rtp.lost}` : ''}`);
    if (r.layers) for (const [l, v] of Object.entries(r.layers)) if (v.totalMbps) console.log(`Layer ${l}: ${f(v.usedMbps)} de ${f(v.totalMbps)} Mbps`);
    for (const p of r.programs) {
      console.log(`\n[${p.program}] ${p.name || '(sem nome na SDT)'} · PMT ${p.pmtPid} · PCR ${p.pcrPid} · ${f(p.mbps)} Mbps${p.layer ? ' · layer ' + p.layer : ''}`);
      for (const c of p.components) console.log(`   PID ${String(c.pid).padStart(4)}  ${c.ident.padEnd(16)} ${String(c.codec || '').padEnd(14)} ${f(c.mbps)} Mbps${c.lang ? ' · ' + c.lang : ''}`);
    }
    const loose = r.pids.filter(p => !p.owner.length);
    if (loose.length) { console.log('\nOutros PIDs:'); for (const p of loose) console.log(`   PID ${String(p.pid).padStart(4)}  ${(p.table || 'UNKNOWN').padEnd(16)} ${f(p.mbps)} Mbps`); }
  })
  .catch(e => { console.error('✖ ' + e.message); process.exit(1); });
