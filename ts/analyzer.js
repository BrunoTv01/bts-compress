// Analisador de MPEG-TS recebido por RTP ou UDP (sem dependências).
//
// Entende:
//   - RTP (RFC 3550, inclusive CSRC, extensão e padding) ou TS direto no UDP
//   - pacotes de 188 bytes (DVB) e de 204 bytes (BTS ISDB-T, com os 16 bytes de informação ISDB-T)
//   - PAT, PMT, SDT (nome dos serviços) e CAT, com verificação de CRC
//   - taxa de cada PID, erros de continuidade (CC), PIDs com PCR e perda de pacotes RTP
//   - camada ISDB-T (A, B, C) de cada PID e capacidade de cada camada, pelo layer_indicator do BTS
'use strict';

const TS = 188;

/* ---------- CRC32 MPEG-2 ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i << 24;
    for (let k = 0; k < 8; k++) c = (c & 0x80000000) ? ((c << 1) ^ 0x04c11db7) : (c << 1);
    t[i] = c >>> 0;
  }
  return t;
})();
function crc32(buf, start, end) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = ((c << 8) ^ CRC_TABLE[((c >>> 24) ^ buf[i]) & 0xff]) >>> 0;
  return c >>> 0;
}

/* ---------- textos de SDT (DVB e ARIB/SBTVD) ---------- */
function decodeText(b) {
  if (!b || !b.length) return '';
  let i = 0, enc = 'latin1';
  const first = b[0];
  if (first < 0x20) {
    if (first === 0x15) { enc = 'utf8'; i = 1; }
    else if (first === 0x11) { // UCS-2
      const out = [];
      for (let k = 1; k + 1 < b.length; k += 2) out.push(String.fromCharCode((b[k] << 8) | b[k + 1]));
      return clean(out.join(''));
    }
    else if (first === 0x10) i = 3;
    else if (first >= 0x01 && first <= 0x0b) i = 1;
    else if (first === 0x1b || first === 0x0e || first === 0x0f) i = 0; // ARIB: tratado abaixo
    else i = 1;
  }
  // ARIB STD-B24 (ISDB-T): tira sequências de escape e códigos de controle, mantém o texto
  const bytes = [];
  for (let k = i; k < b.length; k++) {
    const c = b[k];
    if (c === 0x1b) { // ESC + intermediários (0x20-0x2F) + final
      k++; while (k < b.length && b[k] >= 0x20 && b[k] <= 0x2f) k++;
      continue;
    }
    if (c === 0x0e || c === 0x0f || c === 0x19 || c === 0x1d || c === 0x89 || c === 0x8a) continue;
    if (enc === 'latin1' && (c < 0x20 || (c >= 0x80 && c < 0xa0))) continue;
    bytes.push(c);
  }
  return clean(Buffer.from(bytes).toString(enc));
}
const clean = s => s.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();

/* ---------- tipos de stream ---------- */
const VIDEO_TYPES = { 0x01: 'MPEG 1', 0x02: 'MPEG 2', 0x10: 'MPEG 4 Visual', 0x1b: 'MPEG 4', 0x20: 'MPEG 4', 0x24: 'HEVC', 0x42: 'AVS', 0xea: 'VC-1' };
const AUDIO_TYPES = { 0x03: 'MPEG 1 Áudio', 0x04: 'MPEG 2 Áudio', 0x0f: 'AAC', 0x11: 'AAC LATM', 0x1c: 'MPEG 4 Áudio', 0x81: 'AC-3', 0x87: 'E-AC-3' };
const STREAM_NAMES = {
  0x05: 'Seções privadas', 0x06: 'PES privado', 0x0a: 'DSM-CC tipo A', 0x0b: 'DSM-CC tipo B',
  0x0c: 'DSM-CC tipo C', 0x0d: 'DSM-CC tipo D', 0x15: 'Metadados',
};
const TABLE_PIDS = { 0: 'PAT', 1: 'CAT', 2: 'TSDT', 0x10: 'NIT', 0x11: 'SDT', 0x12: 'EIT', 0x13: 'RST', 0x14: 'TOT',
  0x23: 'SDTT', 0x24: 'BIT', 0x25: 'NBIT', 0x26: 'LDT', 0x27: 'CDT', 0x28: 'SDTT', 0x29: 'CDT', 0x1fff: 'NULO' };

// Papel de cada componente: video, audio, cc, ait, dem, ect, data, other
function classify(es) {
  const st = es.type, d = es.desc;
  const has = tag => d.some(x => x.tag === tag);
  const ctag = (d.find(x => x.tag === 0x52) || {}).data;  // stream_identifier_descriptor (component_tag)
  const tag = ctag && ctag.length ? ctag[0] : null;
  const dataComp = (d.find(x => x.tag === 0xfd) || {}).data;  // data_component_descriptor (ISDB)
  const dcId = dataComp && dataComp.length >= 2 ? (dataComp[0] << 8) | dataComp[1] : null;
  if (VIDEO_TYPES[st]) return { role: 'video', codec: VIDEO_TYPES[st], ident: 'VIDEO' };
  if (AUDIO_TYPES[st]) return { role: 'audio', codec: AUDIO_TYPES[st], ident: 'AUDIO' };
  if (st === 0x06) {
    if (has(0x6a)) return { role: 'audio', codec: 'AC-3', ident: 'AUDIO' };
    if (has(0x7a)) return { role: 'audio', codec: 'E-AC-3', ident: 'AUDIO' };
    if (has(0x7c)) return { role: 'audio', codec: 'AAC', ident: 'AUDIO' };
    if (has(0x7f)) return { role: 'audio', codec: 'AC-4', ident: 'AUDIO' };
    if (has(0x59)) return { role: 'cc', codec: 'Legenda DVB', ident: 'CC' };
    if (has(0x56)) return { role: 'cc', codec: 'Teletexto', ident: 'CC' };
    if (dcId === 0x0008 || dcId === 0x0012 || (tag != null && ((tag >= 0x30 && tag <= 0x37) || tag === 0x87)))
      return { role: 'cc', codec: 'Closed caption', ident: 'CC' };
    return { role: 'data', codec: STREAM_NAMES[st], ident: 'PRIVATE PES' };
  }
  if (st === 0x05 || has(0x6f)) return { role: 'ait', codec: 'AIT', ident: 'PRIVATE SECTIONS' };
  if (st === 0x0b) return { role: 'dem', codec: STREAM_NAMES[st], ident: '13818-6 TYPE B' };
  if (st === 0x0c) return { role: 'ect', codec: STREAM_NAMES[st], ident: '13818-6 TYPE C' };
  if (st === 0x0d) return { role: 'data', codec: STREAM_NAMES[st], ident: '13818-6 TYPE D' };
  if (st === 0x0a) return { role: 'data', codec: STREAM_NAMES[st], ident: '13818-6 TYPE A' };
  return { role: 'other', codec: STREAM_NAMES[st] || `tipo 0x${st.toString(16).padStart(2, '0')}`, ident: 'UNKNOWN' };
}

class TsAnalyzer {
  constructor() {
    this.pkt = new Map();        // pid -> { n, cc, ccErr, pcr, scr, layer: [0,0,0,0,...] }
    this.sections = new Map();   // pid -> { buf, need }
    this.pat = null;             // { tsid, programs: Map(program -> pmtPid), nitPid }
    this.pmts = new Map();       // program -> { pcr, desc, streams: [{ type, pid, desc }] }
    this.sdt = new Map();        // service_id -> { name, provider, type }
    this.onid = null;
    this.packetSize = null;
    this.datagrams = 0; this.bytes = 0; this.notTs = 0;
    this.rtp = { seen: 0, lost: 0, lastSeq: null, pt: null, ssrc: null };
    this.layerTotal = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // pacotes por layer_indicator
    this.isdbInfoOk = 0; this.packets = 0; this.tei = 0;
    this.t0 = null; this.t1 = null;
  }

  // Bytes de um fluxo contínuo (SRT, arquivo): os pacotes podem vir cortados em qualquer ponto.
  // Acha o sincronismo (0x47 a cada 188 ou 204 bytes) e entrega só pacotes inteiros.
  pushStream(chunk, now = Date.now()) {
    this.datagrams++; this.bytes += chunk.length;
    if (this.t0 == null) this.t0 = now;
    this.t1 = now;
    let b = this.rest && this.rest.length ? Buffer.concat([this.rest, chunk]) : chunk;
    let i = 0;
    const synced = (k, size) => { for (let n = 0; n < 4; n++) { if (k + n * size >= b.length) return n > 0; if (b[k + n * size] !== 0x47) return false; } return true; };
    if (!this.packetSize) {
      if (b.length < 204 * 5) { this.rest = Buffer.from(b); return; }
      for (; i < 204 && !this.packetSize; i++) {
        if (b[i] !== 0x47) continue;
        if (synced(i, 204) && b[i + 204] === 0x47 && b[i + 408] === 0x47) this.packetSize = 204;
        else if (synced(i, TS) && b[i + 188] === 0x47 && b[i + 376] === 0x47) this.packetSize = TS;
        if (this.packetSize) break;
      }
      if (!this.packetSize) { this.notTs++; this.rest = Buffer.from(b.subarray(b.length - 204)); return; }
    }
    const size = this.packetSize;
    while (i + size <= b.length) {
      if (b[i] !== 0x47) { // perdeu o sincronismo: procura o próximo 0x47 que se repete
        this.notTs++; let j = i + 1;
        while (j + size < b.length && !(b[j] === 0x47 && b[j + size] === 0x47)) j++;
        i = j; continue;
      }
      this.packet(b, i, size === 204 ? i + TS : -1);
      i += size;
    }
    this.rest = Buffer.from(b.subarray(i));
  }

  // Um datagrama UDP (com ou sem RTP)
  push(buf, now = Date.now()) {
    this.datagrams++; this.bytes += buf.length;
    if (this.t0 == null) this.t0 = now;
    this.t1 = now;
    let p = buf, off = 0, end = buf.length;
    if (buf[0] !== 0x47 && (buf[0] & 0xc0) === 0x80 && buf.length > 12) { // RTP v2
      const cc = buf[0] & 0x0f, ext = buf[0] & 0x10, pad = buf[0] & 0x20;
      off = 12 + cc * 4;
      if (ext && off + 4 <= end) off += 4 + buf.readUInt16BE(off + 2) * 4;
      if (pad) end -= buf[end - 1];
      const seq = buf.readUInt16BE(2);
      const r = this.rtp;
      if (r.lastSeq != null) { const gap = (seq - r.lastSeq - 1 + 65536) % 65536; if (gap > 0 && gap < 1000) r.lost += gap; }
      r.lastSeq = seq; r.seen++; r.pt = buf[1] & 0x7f; r.ssrc = buf.readUInt32BE(8);
    }
    if (off >= end || buf[off] !== 0x47) { this.notTs++; return; }
    const len = end - off;
    let size = this.packetSize;
    if (!size || len % size !== 0) {
      size = len % 204 === 0 && (len % TS !== 0 || buf[off + 204] === 0x47) ? 204 : len % TS === 0 ? TS : null;
      if (!size) { // datagrama sem tamanho múltiplo: tenta pelo próximo byte de sincronismo
        size = buf[off + 204] === 0x47 ? 204 : TS;
      }
      this.packetSize = this.packetSize || size;
    }
    for (let i = off; i + TS <= end; i += size) {
      if (buf[i] !== 0x47) { this.notTs++; break; }
      this.packet(p, i, size === 204 && i + 204 <= end ? i + TS : -1);
    }
  }

  packet(b, i, isdbOff) {
    this.packets++;
    const pid = ((b[i + 1] & 0x1f) << 8) | b[i + 2];
    const pusi = b[i + 1] & 0x40, tei = b[i + 1] & 0x80;
    const afc = (b[i + 3] >> 4) & 3, cc = b[i + 3] & 0x0f, scr = b[i + 3] >> 6;
    let s = this.pkt.get(pid);
    if (!s) { s = { n: 0, cc: -1, ccErr: 0, pcr: 0, scr: 0, layer: null }; this.pkt.set(pid, s); }
    s.n++;
    if (tei) { this.tei++; return; }
    if (scr) s.scr++;
    if (pid !== 0x1fff && (afc & 1)) {
      if (s.cc >= 0 && cc !== ((s.cc + 1) & 0x0f) && cc !== s.cc) s.ccErr++;
      s.cc = cc;
    }
    let pay = i + 4;
    if (afc & 2) {
      const al = b[i + 4];
      if (al > 0 && (b[i + 5] & 0x10)) s.pcr++;
      pay += 1 + al;
    }
    // informação ISDB-T do BTS: byte 1 dos 8 bytes depois do pacote traz o layer_indicator
    if (isdbOff >= 0) {
      const tmcc = b[isdbOff] >> 6, layer = b[isdbOff + 1] >> 4;
      if (tmcc === 0 || tmcc === 1 || tmcc === 2 || tmcc === 3) {
        this.layerTotal[layer]++;
        if (!s.layer) s.layer = new Array(16).fill(0);
        s.layer[layer]++;
      }
    }
    if (!(afc & 1) || pay >= i + TS) return;
    if (this.wantsSection(pid)) this.section(pid, b, pay, i + TS, pusi);
  }

  wantsSection(pid) {
    if (pid === 0 || pid === 1 || pid === 0x11) return true;
    if (!this.pat) return false;
    for (const p of this.pat.programs.values()) if (p === pid) return true;
    return false;
  }

  section(pid, b, start, end, pusi) {
    let st = this.sections.get(pid);
    if (pusi) {
      const ptr = b[start];
      const from = start + 1;
      if (st && st.buf) { this.append(pid, st, b.subarray(from, Math.min(end, from + ptr))); }
      st = { buf: null };
      this.sections.set(pid, st);
      let k = from + ptr;
      while (k < end && b[k] !== 0xff) {
        if (k + 3 > end) { st.buf = Buffer.from(b.subarray(k, end)); return; }
        const slen = (((b[k + 1] & 0x0f) << 8) | b[k + 2]) + 3;
        if (k + slen <= end) { this.table(pid, b.subarray(k, k + slen)); k += slen; }
        else { st.buf = Buffer.from(b.subarray(k, end)); return; }
      }
    } else if (st && st.buf) {
      this.append(pid, st, b.subarray(start, end));
    }
  }

  append(pid, st, chunk) {
    st.buf = Buffer.concat([st.buf, chunk]);
    if (st.buf.length < 3) return;
    const slen = (((st.buf[1] & 0x0f) << 8) | st.buf[2]) + 3;
    if (st.buf.length >= slen) { const sec = st.buf.subarray(0, slen); st.buf = null; this.table(pid, sec); }
    else if (st.buf.length > 4096) st.buf = null;
  }

  table(pid, s) {
    if (s.length < 8 || !(s[1] & 0x80)) return;           // precisa de section_syntax_indicator
    if (crc32(s, 0, s.length) !== 0) return;               // CRC errado: descarta
    const tid = s[0], ext = (s[3] << 8) | s[4], body = s.subarray(8, s.length - 4);
    if (pid === 0 && tid === 0x00) {
      const programs = new Map(); let nitPid = null;
      for (let k = 0; k + 4 <= body.length; k += 4) {
        const prog = (body[k] << 8) | body[k + 1], p = ((body[k + 2] & 0x1f) << 8) | body[k + 3];
        if (prog === 0) nitPid = p; else programs.set(prog, p);
      }
      if (!this.pat) this.pat = { tsid: ext, programs, nitPid };
      else for (const [k, v] of programs) this.pat.programs.set(k, v); // PAT em várias seções
    } else if (tid === 0x02) {
      if (this.pmts.has(ext)) return;
      const pcr = ((body[0] & 0x1f) << 8) | body[1];
      const pil = ((body[2] & 0x0f) << 8) | body[3];
      const desc = descriptors(body, 4, 4 + pil);
      const streams = [];
      for (let k = 4 + pil; k + 5 <= body.length;) {
        const type = body[k], epid = ((body[k + 1] & 0x1f) << 8) | body[k + 2];
        const el = ((body[k + 3] & 0x0f) << 8) | body[k + 4];
        streams.push({ type, pid: epid, desc: descriptors(body, k + 5, k + 5 + el) });
        k += 5 + el;
      }
      this.pmts.set(ext, { pid, pcr, desc, streams });
    } else if (pid === 0x11 && tid === 0x42) {
      this.onid = (body[0] << 8) | body[1];
      for (let k = 3; k + 5 <= body.length;) {
        const sid = (body[k] << 8) | body[k + 1];
        const dl = ((body[k + 3] & 0x0f) << 8) | body[k + 4];
        for (const d of descriptors(body, k + 5, k + 5 + dl)) {
          if (d.tag !== 0x48 || d.data.length < 3) continue;
          const pl = d.data[1], provider = d.data.subarray(2, 2 + pl);
          const nl = d.data[2 + pl], name = d.data.subarray(3 + pl, 3 + pl + nl);
          this.sdt.set(sid, { type: d.data[0], provider: decodeText(provider), name: decodeText(name) });
        }
        k += 5 + dl;
      }
    }
  }

  // Resultado final da medição
  result() {
    const secs = this.t0 != null && this.t1 > this.t0 ? (this.t1 - this.t0) / 1000 : 0;
    const mbps = n => secs ? +(n * TS * 8 / secs / 1e6).toFixed(4) : null;
    const LAYER = { 1: 'A', 2: 'B', 3: 'C' };
    const consistent = s => {
      if (!s.layer) return null;
      let best = 0, bi = 0, tot = 0;
      for (let l = 0; l < 16; l++) { tot += s.layer[l]; if (s.layer[l] > best) { best = s.layer[l]; bi = l; } }
      return tot && best / tot >= 0.9 ? bi : null;
    };
    // 204 bytes pode ser BTS (informação ISDB-T) ou só paridade Reed-Solomon (DVB-ASI 204):
    // só vale como ISDB-T se quase todo pacote útil tiver um layer_indicator coerente por PID
    let okPk = 0, allPk = 0;
    if (this.packetSize === 204) for (const [pid, s] of this.pkt) if (pid !== 0x1fff && s.layer) { allPk += s.n; if ([1, 2, 3].includes(consistent(s))) okPk += s.n; }
    const isdb = this.packetSize === 204 && allPk > 0 && okPk / allPk >= 0.9;
    const pidLayer = s => {
      if (!isdb || !s.layer) return null;
      let best = 0, bi = 0, tot = 0;
      for (let l = 1; l <= 3; l++) { tot += s.layer[l]; if (s.layer[l] > best) { best = s.layer[l]; bi = l; } }
      return tot && best / tot >= 0.9 ? LAYER[bi] : null;
    };
    const pids = [...this.pkt.entries()].sort((a, b) => a[0] - b[0]).map(([pid, s]) => ({
      pid, packets: s.n, mbps: mbps(s.n), ccErrors: s.ccErr, pcr: s.pcr > 0, scrambled: s.scr > 0,
      layer: pidLayer(s), table: TABLE_PIDS[pid] || null,
    }));
    const byPid = new Map(pids.map(p => [p.pid, p]));
    const programs = [];
    for (const [prog, pmtPid] of (this.pat ? this.pat.programs : new Map())) {
      const pmt = this.pmts.get(prog), sdt = this.sdt.get(prog);
      const comps = (pmt ? pmt.streams : []).map(es => {
        const c = classify(es);
        const lang = es.desc.find(d => d.tag === 0x0a);
        return { pid: es.pid, type: es.type, ...c, lang: lang && lang.data.length >= 3 ? lang.data.subarray(0, 3).toString('latin1') : null,
          mbps: byPid.get(es.pid)?.mbps ?? 0, layer: byPid.get(es.pid)?.layer ?? null };
      });
      const set = new Set([pmtPid, ...comps.map(c => c.pid)]);
      if (pmt && pmt.pcr !== 0x1fff) set.add(pmt.pcr);
      const total = [...set].reduce((a, p) => a + (byPid.get(p)?.packets || 0), 0);
      const layers = comps.map(c => c.layer).filter(Boolean);
      programs.push({
        program: prog, pmtPid, pcrPid: pmt ? pmt.pcr : null, name: sdt?.name || null, provider: sdt?.provider || null,
        serviceType: sdt?.type ?? null, components: comps, mbps: mbps(total), pmtFound: !!pmt,
        layer: layers.length ? mode(layers) : null,
      });
    }
    // PIDs que não pertencem a nenhum serviço
    const used = new Set(programs.flatMap(p => [p.pmtPid, p.pcrPid, ...p.components.map(c => c.pid)]));
    if (this.pat?.nitPid != null) used.add(this.pat.nitPid);
    for (const p of pids) p.owner = used.has(p.pid) ? programs.filter(g => g.pmtPid === p.pid || g.pcrPid === p.pid || g.components.some(c => c.pid === p.pid)).map(g => g.program) : [];
    const layers = isdb ? Object.fromEntries([1, 2, 3].map(l => [LAYER[l], {
      totalMbps: mbps(this.layerTotal[l]),
      usedMbps: mbps(pids.filter(p => p.pid !== 0x1fff && this.pkt.get(p.pid).layer).reduce((a, p) => a + this.pkt.get(p.pid).layer[l], 0)),
    }])) : null;
    return {
      seconds: +secs.toFixed(2), datagrams: this.datagrams, packets: this.packets, packetSize: this.packetSize,
      transport: this.rtp.seen ? 'RTP' : 'UDP', rtp: this.rtp.seen ? { lost: this.rtp.lost, payloadType: this.rtp.pt, ssrc: this.rtp.ssrc } : null,
      totalMbps: secs ? +(this.packets * (this.packetSize || TS) * 8 / secs / 1e6).toFixed(4) : null,
      payloadMbps: mbps(this.packets - (this.pkt.get(0x1fff)?.n || 0)),
      nullMbps: mbps(this.pkt.get(0x1fff)?.n || 0),
      tsid: this.pat?.tsid ?? null, onid: this.onid, nitPid: this.pat?.nitPid ?? null,
      system: isdb ? 'ISDB-T' : 'DVB', isdb, layers,
      ccErrors: pids.reduce((a, p) => a + p.ccErrors, 0), teiErrors: this.tei, notTs: this.notTs,
      programs, pids,
    };
  }
}

function descriptors(b, start, end) {
  const out = [];
  for (let k = start; k + 2 <= end && k + 2 <= b.length;) {
    const tag = b[k], len = b[k + 1];
    out.push({ tag, data: b.subarray(k + 2, Math.min(k + 2 + len, end)) });
    k += 2 + len;
  }
  return out;
}
function mode(a) { const m = {}; let best = a[0]; for (const x of a) { m[x] = (m[x] || 0) + 1; if (m[x] > m[best]) best = x; } return best; }

module.exports = { TsAnalyzer, classify, decodeText, crc32 };
