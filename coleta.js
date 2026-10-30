// Coleta de dados de streams RTP/UDP: mede o TS, compara com o banco e grava só o que o usuário aprovar.
'use strict';
const path = require('path');
const { spawn } = require('child_process');
const { capture, interfaces, isIPv4, isMulticast } = require('./ts/capture');
const { captureSrt, srtTool, srtBridge, isHost } = require('./ts/srt');

/* ---------- teste local: streams simulados gerados dentro do próprio servidor ---------- */
const TEST_PREFIX = 'TESTE · ';
const TEST_STREAMS = [
  { profile: 'dvb', name: TEST_PREFIX + 'Mux DVB (simulado)', kind: 'dvb', group: '239.255.10.1', port: 5500, targets: ['pids', 'pids_total', 'mux'] },
  { profile: 'isdb', name: TEST_PREFIX + 'BTS ISDB-T (simulado)', kind: 'isdb', group: '239.255.10.2', port: 5502, targets: ['pids', 'isdb_layers', 'isdb_pids'] },
];
// stream SRT de teste: gerador -> UDP local -> repasse SRT em modo listener -> coleta como caller
// stream unicast de teste: o gerador manda direto para o IP deste servidor
const TEST_UNI = { profile: 'dvb', name: TEST_PREFIX + 'Mux DVB unicast (simulado)', kind: 'dvb', port: 5530, targets: ['pids', 'pids_total', 'mux'] };
const TEST_SRT = { profile: 'isdb', name: TEST_PREFIX + 'BTS ISDB-T por SRT (simulado)', kind: 'isdb', udp: 5510, port: 5520, targets: ['pids', 'isdb_layers', 'isdb_pids'] };
const test = { procs: [], until: null, mode: null, iface: null, timer: null, srt: false };
function stopTest() {
  test.stopping = true;
  for (const p of test.procs) { try { p.kill(); } catch { /* já parou */ } }
  test.procs = []; test.until = null; test.mode = null; test.srt = false; clearTimeout(test.timer);
  test.stopping = false;
}
function startSrtTest(minutes) {
  if (!srtTool()) return false;
  const script = path.join(__dirname, 'tools', 'stream-teste.js');
  const g = spawn(process.execPath, [script, TEST_SRT.profile, `127.0.0.1:${TEST_SRT.udp}`, '--udp', '--minutos', String(minutes)], { stdio: 'ignore' });
  test.procs.push(g);
  // o repasse em listener encerra quando a coleta desconecta: liga de novo enquanto o teste estiver ativo
  const bridge = () => {
    const b = srtBridge(TEST_SRT.udp, TEST_SRT.port);
    if (!b) return;
    test.procs.push(b);
    b.on('exit', () => { test.procs = test.procs.filter(x => x !== b); if (!test.stopping && test.until && test.procs.includes(g)) setTimeout(bridge, 300); });
  };
  bridge();
  return true;
}
process.on('exit', stopTest);
// sistema desligando (systemd, Render, Docker): para os geradores antes de sair
for (const sig of ['SIGTERM', 'SIGINT']) process.once(sig, () => { stopTest(); process.exit(0); });
function startGenerators(mode, iface, minutes) {
  const script = path.join(__dirname, 'tools', 'stream-teste.js');
  for (const t of TEST_STREAMS) {
    const dest = mode === 'multicast' ? `${t.group}:${t.port}` : `127.0.0.1:${t.port}`;
    const args = [script, t.profile, dest, '--ttl', '0', '--minutos', String(minutes), ...(mode === 'multicast' && iface ? ['--placa', iface] : [])];
    const p = spawn(process.execPath, args, { stdio: 'ignore' });
    p.on('exit', () => { test.procs = test.procs.filter(x => x !== p); if (!test.procs.length) { test.until = null; test.mode = null; test.srt = false; } });
    test.procs.push(p);
  }
}
const testStatus = () => ({ running: test.procs.length > 0, until: test.until, mode: test.mode, iface: test.iface, srt: test.srt });

const TARGETS = {
  pids:        'Serviços & PIDs · PIDs, ID e codificação',
  pids_total:  'Serviços & PIDs · bitrate',
  titular:     'DVB atual · titular',
  reserva:     'DVB atual · reserva',
  mux:         'Taxas · mux',
  enc:         'Taxas · encoder',
  isdb_layers: 'ISDB-T · layers',
  isdb_pids:   'ISDB-T · PIDs e taxas',
};
const KINDS = {
  auto:    { label: 'Automático', system: null, targets: ['pids', 'pids_total', 'mux', 'isdb_layers', 'isdb_pids'] },
  dvb:     { label: 'Mux DVB (satélite)', system: 'DVB', targets: ['pids', 'pids_total', 'mux'] },
  isdb:    { label: 'BTS ISDB-T', system: 'ISDB-T', targets: ['pids', 'isdb_layers', 'isdb_pids'] },
  encoder: { label: 'Saída de encoder', system: null, targets: ['enc'] },
};
const SHORT = { pids: 'PIDs', pids_total: 'bitrate PIDs', titular: 'titular', reserva: 'reserva', mux: 'taxas mux', enc: 'taxas encoder' };
const PID_COLS = ['v', 'a1', 'a2', 'a3', 'a4', 'pcr', 'pmt', 'dem', 'ait', 'cc', 'ect', 'data'];
const PID_LABEL = { v: 'Vídeo', a1: 'Áudio 1', a2: 'Áudio 2', a3: 'Áudio 3', a4: 'Áudio 4', pcr: 'PCR', pmt: 'PMT', dem: 'DEM CC', ait: 'AIT', cc: 'CC', ect: 'ECT', data: 'Data' };
const RATE_LABEL = { a1: 'Áudio 1 (kbps)', a2: 'Áudio 2 (kbps)', a3: 'Áudio 3 (kbps)', a4: 'Áudio 4 (kbps)', v: 'Vídeo (Mbps)', cc: 'CC (kbps)' };
const round = (v, d) => v == null ? null : +(+v).toFixed(d);
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^TV/, '');
const same = (a, b) => (a == null && b == null) || (a != null && b != null && String(a) === String(b));

// codificação no formato do cadastro (MPEG 1 / MPEG 2 / MPEG 4 / HEVC)
function codecOf(p) {
  const v = p.components.find(c => c.role === 'video'), a = p.components.find(c => c.role === 'audio');
  if (v) return v.codec === 'MPEG 4 Visual' ? 'MPEG 4' : v.codec;
  if (a) return /AAC|MPEG 4/.test(a.codec) ? 'MPEG 4' : /MPEG 1|MPEG 2/.test(a.codec) ? 'MPEG 1' : a.codec;
  return null;
}
// PIDs do serviço nas colunas da aba Serviços & PIDs
function pidCols(p) {
  const out = Object.fromEntries(PID_COLS.map(k => [k, null]));
  const by = r => p.components.filter(c => c.role === r);
  out.v = by('video')[0]?.pid ?? null;
  by('audio').slice(0, 4).forEach((c, i) => { out['a' + (i + 1)] = c.pid; });
  out.pcr = p.pcrPid != null && p.pcrPid !== 0x1fff ? p.pcrPid : null;
  out.pmt = p.pmtPid;
  for (const r of ['cc', 'ait', 'dem', 'ect', 'data']) out[r] = by(r)[0]?.pid ?? null;
  return out;
}
function rateCols(p) {
  const by = r => p.components.filter(c => c.role === r);
  const out = { a1: null, a2: null, a3: null, a4: null, v: null, cc: null };
  by('audio').slice(0, 4).forEach((c, i) => { out['a' + (i + 1)] = round(c.mbps * 1000, 0); });
  const v = by('video'); if (v.length) out.v = round(v.reduce((s, c) => s + c.mbps, 0), 2);
  const cc = by('cc'); if (cc.length) out.cc = round(cc.reduce((s, c) => s + c.mbps, 0) * 1000, 1);
  return out;
}

// Liga cada serviço do stream a um serviço do cadastro: pelo PMT, pelo ID de serviço e por fim pelo nome
function matchPrograms(result, db, system) {
  const used = new Set(), map = new Map();
  const pidsBySvc = new Map(db.pids.map(p => [p.service_id, p]));
  const okSys = s => !system || s.system === system;
  const pick = (p, list) => {
    const c = list.filter(s => !used.has(s.id));
    if (!c.length) return null;
    return c.find(s => p.name && norm(s.name) === norm(p.name)) || c[0];
  };
  const steps = [
    p => db.services.filter(s => okSys(s) && pidsBySvc.get(s.id)?.pmt === p.pmtPid && (s.service_id == null || s.service_id === p.program)),
    p => db.services.filter(s => okSys(s) && s.service_id === p.program),
    p => p.name ? db.services.filter(s => okSys(s) && norm(s.name) === norm(p.name)) : [],
    p => p.name ? db.services.filter(s => okSys(s) && norm(s.name).length >= 3 && (norm(p.name).includes(norm(s.name)) || norm(s.name).includes(norm(p.name)))) : [],
    p => db.services.filter(s => okSys(s) && pidsBySvc.get(s.id)?.pmt === p.pmtPid),
  ];
  for (const step of steps)
    for (const p of result.programs) {
      if (map.has(p.program)) continue;
      const s = pick(p, step(p));
      if (s) { map.set(p.program, s); used.add(s.id); }
    }
  return map;
}

// Lista de mudanças propostas (não grava nada)
function propose(result, db, opts) {
  const targets = new Set(opts.targets || []);
  const system = KINDS[opts.kind]?.system || null;
  const match = matchPrograms(result, db, system);
  const out = [];
  const add = o => out.push({ default: true, ...o });
  const programs = result.programs.filter(p => p.pmtFound);

  for (const p of programs) {
    const s = match.get(p.program);
    const label = s ? s.name : (p.name || `Serviço ${p.program}`);
    const cols = pidCols(p), rates = rateCols(p), codec = codecOf(p);
    if (!s) {
      const wants = [...targets].filter(t => t !== 'isdb_layers' && t !== 'isdb_pids');
      if (!wants.length) continue;
      let name = label, n = 2;
      while (db.services.some(x => norm(x.name) === norm(name))) name = `${label} (${n++})`;
      const row = { name, service_id: p.program, codec, system: system || (result.isdb ? 'ISDB-T' : 'DVB'), targets: wants, pids: cols, mbps: round(p.mbps, 3), rates };
      add({ id: `svc|new|${p.program}`, op: 'newService', group: name, area: 'Serviços', item: `Cadastrar serviço novo (ID ${p.program})`,
        old: null, new: `${name} em: ${wants.map(t => SHORT[t]).join(', ')}`, row,
        note: 'Não achei este serviço no cadastro (nem pelo PMT, nem pelo ID, nem pelo nome).' });
      continue;
    }
    const pidRow = db.pids.find(x => x.service_id === s.id);
    if (targets.has('pids')) {
      if (!same(s.service_id, p.program)) add({ id: `services|${s.id}|service_id`, op: 'set', table: 'services', match: { id: s.id }, field: 'service_id', group: s.name, area: TARGETS.pids, item: 'ID de serviço', old: s.service_id, new: p.program });
      if (codec && !same(s.codec, codec)) add({ id: `services|${s.id}|codec`, op: 'set', table: 'services', match: { id: s.id }, field: 'codec', group: s.name, area: TARGETS.pids, item: 'Codificação', old: s.codec, new: codec });
      if (p.name && norm(p.name) !== norm(s.name)) {
        const taken = db.services.some(x => x.id !== s.id && x.name.toLowerCase() === p.name.toLowerCase());
        add({ id: `services|${s.id}|name`, op: 'set', table: 'services', match: { id: s.id }, field: 'name', group: s.name, area: TARGETS.pids, item: 'Nome (SDT)', old: s.name, new: p.name, default: false,
          blocked: taken ? 'Já existe outro serviço com esse nome no cadastro.' : undefined, note: taken ? undefined : 'O nome muda em todas as abas.' });
      }
      for (const k of PID_COLS) {
        const oldV = pidRow ? pidRow[k] : null, newV = cols[k];
        if (same(oldV, newV)) continue;
        add({ id: `service_pids|${s.id}|${k}`, op: 'set', table: 'service_pids', match: { service_id: s.id }, field: k, group: s.name, area: TARGETS.pids, item: `PID ${PID_LABEL[k]}`, old: oldV, new: newV,
          default: newV != null, note: newV == null ? 'Não apareceu na PMT do stream.' : !pidRow ? 'Serviço ainda não está na aba Serviços & PIDs.' : undefined });
      }
    }
    for (const cfg of ['pids_total', 'titular', 'reserva']) {
      if (!targets.has(cfg)) continue;
      const b = db.bitrates.find(x => x.service_id === s.id && x.config === cfg), nv = round(p.mbps, 3);
      if (!same(b?.mbps ?? null, nv)) add({ id: `bitrates|${s.id}|${cfg}|mbps`, op: 'set', table: 'bitrates', match: { service_id: s.id, config: cfg }, field: 'mbps', group: s.name, area: TARGETS[cfg], item: 'Bitrate (Mbps)', old: b?.mbps ?? null, new: nv, unit: 'Mbps' });
      if (opts.equipment_id && cfg !== 'pids_total' && !same(b?.equipment_id ?? null, opts.equipment_id))
        add({ id: `bitrates|${s.id}|${cfg}|equipment_id`, op: 'set', table: 'bitrates', match: { service_id: s.id, config: cfg }, field: 'equipment_id', group: s.name, area: TARGETS[cfg], item: 'Encoder', old: eqName(db, b?.equipment_id), new: eqName(db, opts.equipment_id), value: opts.equipment_id });
    }
    for (const src of ['mux', 'enc']) {
      if (!targets.has(src)) continue;
      const e = db.encoder.find(x => x.service_id === s.id && x.source === src);
      for (const k of Object.keys(rates)) {
        const oldV = e ? e[k] : null;
        if (same(oldV, rates[k])) continue;
        add({ id: `encoder_rates|${s.id}|${src}|${k}`, op: 'set', table: 'encoder_rates', match: { service_id: s.id, source: src }, field: k, group: s.name, area: TARGETS[src], item: RATE_LABEL[k], old: oldV, new: rates[k], default: rates[k] != null, note: rates[k] == null ? 'Não apareceu no stream.' : undefined });
      }
      if (opts.equipment_id && !same(e?.equipment_id ?? null, opts.equipment_id))
        add({ id: `encoder_rates|${s.id}|${src}|equipment_id`, op: 'set', table: 'encoder_rates', match: { service_id: s.id, source: src }, field: 'equipment_id', group: s.name, area: TARGETS[src], item: src === 'mux' ? 'Mux' : 'Encoder', old: eqName(db, e?.equipment_id), new: eqName(db, opts.equipment_id), value: opts.equipment_id });
    }
  }

  // ISDB-T: serviços por layer e linha de tabelas
  if (targets.has('isdb_layers')) {
    const usedRows = new Set();
    for (const p of programs) {
      const s = match.get(p.program), names = [s?.name, p.name].filter(Boolean).map(norm);
      const row = db.layers.find(l => l.layer !== 'Tabelas' && !usedRows.has(l.id) && names.some(n => norm(l.name) === n))
        || db.layers.find(l => l.layer !== 'Tabelas' && !usedRows.has(l.id) && names.some(n => n.length >= 3 && (norm(l.name).includes(n) || n.includes(norm(l.name)))));
      const layer = p.layer || (result.isdb ? null : 'B'), nv = round(p.mbps, 3), nm = s?.name || p.name || `Serviço ${p.program}`;
      if (row) {
        usedRows.add(row.id);
        if (!same(row.mbps, nv)) add({ id: `isdb_layers|${row.id}|mbps`, op: 'set', table: 'isdb_layers', match: { id: row.id }, field: 'mbps', group: row.name, area: TARGETS.isdb_layers, item: 'Bitrate (Mbps)', old: row.mbps, new: nv });
        if (layer && row.layer !== layer) add({ id: `isdb_layers|${row.id}|layer`, op: 'set', table: 'isdb_layers', match: { id: row.id }, field: 'layer', group: row.name, area: TARGETS.isdb_layers, item: 'Layer', old: row.layer, new: layer });
      } else {
        add({ id: `isdb_layers|new|${p.program}`, op: 'insert', table: 'isdb_layers', row: { layer: layer || 'B', name: nm, mbps: nv }, group: nm, area: TARGETS.isdb_layers, item: 'Incluir linha', old: null, new: `Layer ${layer || 'B'} · ${String(nv).replace('.', ',')} Mbps` });
      }
    }
    const loose = result.pids.filter(x => !x.owner.length && x.pid !== 0x1fff);
    const tabMbps = round(loose.reduce((a, x) => a + x.mbps, 0), 4);
    const tab = db.layers.find(l => l.layer === 'Tabelas');
    if (tab) { if (!same(tab.mbps, tabMbps)) add({ id: `isdb_layers|${tab.id}|mbps`, op: 'set', table: 'isdb_layers', match: { id: tab.id }, field: 'mbps', group: tab.name, area: TARGETS.isdb_layers, item: 'Tabelas (Mbps)', old: tab.mbps, new: tabMbps, note: loose.map(x => x.table || x.pid).join(', ') }); }
    else if (loose.length) add({ id: 'isdb_layers|new|tabelas', op: 'insert', table: 'isdb_layers', row: { layer: 'Tabelas', name: loose.map(x => x.table || 'PID ' + x.pid).slice(0, 4).join(', ') + (loose.length > 4 ? '…' : ''), mbps: tabMbps }, group: 'Tabelas', area: TARGETS.isdb_layers, item: 'Incluir linha', old: null, new: `${String(tabMbps).replace('.', ',')} Mbps` });
    const lb = result.layers?.B;
    if (lb && lb.totalMbps) {
      const cur = db.settings.find(x => x.key === 'isdb_layer_b_total');
      const nv = round(lb.totalMbps, 3);
      if (cur && !same(cur.value, nv)) add({ id: 'settings|isdb_layer_b_total', op: 'set', table: 'settings', match: { key: 'isdb_layer_b_total' }, field: 'value', group: 'Geral', area: TARGETS.isdb_layers, item: 'Capacidade da layer B (Mbps)', old: cur.value, new: nv, note: 'Medida pelos pacotes da layer B no BTS (inclui nulos).' });
    }
  }

  // ISDB-T: taxa de cada PID
  if (targets.has('isdb_pids')) {
    const seen = new Set();
    for (const x of result.pids) {
      if (x.pid === 0x1fff) continue;
      seen.add(x.pid);
      const owner = programs.find(p => x.owner.includes(p.program));
      const comp = owner?.components.find(c => c.pid === x.pid);
      const ident = comp ? comp.ident : owner && owner.pmtPid === x.pid ? 'PMT' : owner && owner.pcrPid === x.pid ? 'PCR' : x.table || (x.pid === result.nitPid ? 'NIT' : 'UNKNOWN');
      const nv = round(x.mbps, 4);
      const row = db.isdbPids.find(r => r.pid === x.pid);
      if (row) {
        if (!same(row.mbps, nv)) add({ id: `isdb_pids|${row.id}|mbps`, op: 'set', table: 'isdb_pids', match: { id: row.id }, field: 'mbps', group: row.grp, area: TARGETS.isdb_pids, item: `PID ${x.pid} ${row.ident || ident} (Mbps)`, old: row.mbps, new: nv });
        if (!row.ident && ident) add({ id: `isdb_pids|${row.id}|ident`, op: 'set', table: 'isdb_pids', match: { id: row.id }, field: 'ident', group: row.grp, area: TARGETS.isdb_pids, item: `PID ${x.pid} identificação`, old: null, new: ident });
      } else {
        const s = owner && match.get(owner.program);
        // usa o mesmo grupo dos outros PIDs desse serviço que já estão na tabela (ex.: "1-SEG")
        const ownPids = owner ? new Set([owner.pmtPid, owner.pcrPid, ...owner.components.map(c => c.pid)]) : null;
        const known = owner ? db.isdbPids.filter(r => ownPids.has(r.pid)).map(r => r.grp) : [];
        const grp = !owner ? (db.isdbPids.find(r => /TABELA/i.test(r.grp))?.grp || 'TABELAS') : (known.length ? mostCommon(known) : (s?.name || owner.name || `Serviço ${owner.program}`));
        add({ id: `isdb_pids|new|${x.pid}`, op: 'insert', table: 'isdb_pids', row: { grp, pid: x.pid, ident, mbps: nv }, group: grp, area: TARGETS.isdb_pids, item: `Incluir PID ${x.pid} (${ident})`, old: null, new: `${String(nv).replace('.', ',')} Mbps` });
      }
    }
    for (const r of db.isdbPids) {
      if (r.pid == null || seen.has(r.pid) || r.mbps === 0) continue;
      add({ id: `isdb_pids|${r.id}|mbps`, op: 'set', table: 'isdb_pids', match: { id: r.id }, field: 'mbps', group: r.grp, area: TARGETS.isdb_pids, item: `PID ${r.pid} ${r.ident || ''} (Mbps)`.replace('  ', ' '), old: r.mbps, new: 0, default: false, note: 'Esse PID não apareceu no stream.' });
    }
  }

  if (targets.has('pids_total') && !result.isdb && result.totalMbps) {
    const cur = db.settings.find(x => x.key === 'dvb_available'), nv = round(result.totalMbps, 3);
    if (cur && !same(cur.value, nv)) add({ id: 'settings|dvb_available', op: 'set', table: 'settings', match: { key: 'dvb_available' }, field: 'value', group: 'Geral', area: TARGETS.pids_total, item: 'Banda total do mux (Mbps)', old: cur.value, new: nv, default: false, note: 'Taxa total medida do TS, com os pacotes nulos.' });
  }
  const matches = result.programs.map(p => ({ program: p.program, name: p.name, service: match.get(p.program)?.name || null, serviceId: match.get(p.program)?.id || null }));
  return { proposals: out, matches, unmatched: matches.filter(m => !m.service).length };
}
function mostCommon(a) { const m = {}; let b = a[0]; for (const x of a) { m[x] = (m[x] || 0) + 1; if (m[x] > m[b]) b = x; } return b; }
function eqName(db, id) { const e = id != null && db.equipment.find(x => x.id === id); return e ? [e.name, e.model].filter(Boolean).join(' · ') : null; }

async function loadDb(q) {
  const [services, pids, bitrates, encoder, layers, isdbPids, settings, equipment] = await Promise.all([
    q('SELECT * FROM services ORDER BY sort'), q('SELECT * FROM service_pids'), q('SELECT * FROM bitrates'),
    q('SELECT * FROM encoder_rates'), q('SELECT * FROM isdb_layers ORDER BY sort'), q('SELECT * FROM isdb_pids ORDER BY sort'),
    q('SELECT * FROM settings'), q('SELECT id,name,model FROM equipment'),
  ]);
  return { services, pids, bitrates, encoder, layers, isdbPids, settings, equipment };
}

const KEY_TABLES = {
  services: ['id'], service_pids: ['service_id'], bitrates: ['service_id', 'config'], encoder_rates: ['service_id', 'source'],
  isdb_layers: ['id'], isdb_pids: ['id'], settings: ['key'],
};
const FIELDS = {
  services: ['service_id', 'codec', 'name'], service_pids: PID_COLS, bitrates: ['mbps', 'equipment_id'],
  encoder_rates: ['a1', 'a2', 'a3', 'a4', 'v', 'cc', 'equipment_id'], isdb_layers: ['mbps', 'layer'], isdb_pids: ['mbps', 'ident'], settings: ['value'],
};

async function applyOne(c, p, ctx, audit) {
  const fmtV = v => v == null ? null : String(v);
  if (p.op === 'set') {
    const keys = KEY_TABLES[p.table];
    if (!keys || !FIELDS[p.table].includes(p.field)) throw new Error('Campo não permitido: ' + p.table + '.' + p.field);
    const where = keys.map((k, i) => `${k}=$${i + 1}`).join(' AND '), vals = keys.map(k => p.match[k]);
    const value = p.value !== undefined ? p.value : p.new;
    const cur = await c.query(`SELECT ${p.field} AS v, ${keys[0]} AS pk FROM ${p.table} WHERE ${where} FOR UPDATE`, vals);
    let rowId;
    if (cur.rows.length) {
      await c.query(`UPDATE ${p.table} SET ${p.field}=$${keys.length + 1} WHERE ${where}`, [...vals, value]);
      rowId = p.table === 'bitrates' || p.table === 'encoder_rates' ? (await c.query(`SELECT id FROM ${p.table} WHERE ${where}`, vals)).rows[0].id : cur.rows[0].pk;
    } else {
      if (p.table === 'settings' || p.table === 'services' || p.table === 'isdb_layers' || p.table === 'isdb_pids') return false;
      const cols = [...keys, p.field];
      const r = await c.query(`INSERT INTO ${p.table} (${cols.join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`, [...vals, value]);
      rowId = r.rows[0].id ?? r.rows[0].service_id;
    }
    if (p.table === 'services' && p.field === 'name' && cur.rows[0]?.v) await c.query('UPDATE isdb_layers SET name=$1 WHERE name=$2', [value, cur.rows[0].v]);
    await audit(c, p.table, rowId, p.field === 'equipment_id' ? 'equipamento' : p.field, p.field === 'equipment_id' ? p.old : fmtV(cur.rows[0]?.v ?? null), p.field === 'equipment_id' ? p.new : fmtV(value), `${ctx} · ${p.group} · ${p.item}`);
    return true;
  }
  if (p.op === 'insert') {
    if (!['isdb_layers', 'isdb_pids'].includes(p.table)) throw new Error('Tabela não permitida');
    const row = { ...p.row, sort: (await c.query(`SELECT COALESCE(max(sort),0)+1 AS n FROM ${p.table}`)).rows[0].n };
    const cols = Object.keys(row);
    const r = await c.query(`INSERT INTO ${p.table} (${cols.join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING id`, cols.map(k => row[k]));
    await audit(c, p.table, r.rows[0].id, 'inclusão', null, p.new, `${ctx} · ${p.group} · ${p.item}`);
    return true;
  }
  if (p.op === 'newService') {
    const r0 = p.row;
    const sort = (await c.query('SELECT COALESCE(max(sort),0)+1 AS n FROM services')).rows[0].n;
    const { rows } = await c.query('INSERT INTO services (service_id,name,codec,system,sort) VALUES ($1,$2,$3,$4,$5) RETURNING id', [r0.service_id, r0.name, r0.codec, r0.system, sort]);
    const id = rows[0].id, t = new Set(r0.targets);
    if (t.has('pids')) await c.query(`INSERT INTO service_pids (service_id,${PID_COLS.join(',')}) VALUES ($1,${PID_COLS.map((_, i) => '$' + (i + 2)).join(',')})`, [id, ...PID_COLS.map(k => r0.pids[k])]);
    for (const cfg of ['pids_total', 'titular', 'reserva']) if (t.has(cfg) || (cfg === 'pids_total' && t.has('pids')))
      await c.query('INSERT INTO bitrates (service_id,config,mbps,equipment_id) VALUES ($1,$2,$3,$4)', [id, cfg, r0.mbps, cfg === 'pids_total' ? null : r0.equipment_id || null]);
    for (const src of ['mux', 'enc']) if (t.has(src))
      await c.query('INSERT INTO encoder_rates (service_id,source,a1,a2,a3,a4,v,cc,equipment_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id, src, r0.rates.a1, r0.rates.a2, r0.rates.a3, r0.rates.a4, r0.rates.v, r0.rates.cc, r0.equipment_id || null]);
    await audit(c, 'services', id, 'cadastro', null, r0.name, `${ctx} · serviço novo encontrado no stream`);
    return true;
  }
  throw new Error('Operação desconhecida');
}

function parseSource(b) {
  // nome e tipo são opcionais: sem nome usa "endereço:porta"; sem tipo, detecta DVB ou ISDB-T na medição
  const name = String(b.name || '').trim().slice(0, 120) || null;
  const kind = KINDS[b.kind] ? b.kind : null;
  const protocol = b.protocol === 'srt' ? 'srt' : 'udp';
  const address = String(b.address || '').trim(), iface = String(b.iface || '').trim(), source_ip = String(b.source_ip || '').trim();
  const port = Number(b.port), seconds = Math.min(60, Math.max(2, Number(b.seconds) || 10));
  // SRT: modo, latência, senha e stream ID
  const srt = { srt_mode: null, srt_latency: null, srt_passphrase: null, srt_streamid: null };
  if (protocol === 'srt') {
    srt.srt_mode = b.srt_mode === 'listener' ? 'listener' : 'caller';
    if (srt.srt_mode === 'caller' && !address) throw bad('No modo caller, informe o IP do equipamento SRT.');
    if (address && !isHost(address)) throw bad('Endereço inválido.');
    srt.srt_latency = Math.min(8000, Math.max(20, Math.round(Number(b.srt_latency) || 200)));
    const pw = String(b.srt_passphrase ?? '');
    if (b.srt_passphrase_clear) srt.srt_passphrase = null;
    else if (pw) { if (pw.length < 10 || pw.length > 79) throw bad('A senha do SRT precisa ter de 10 a 79 caracteres.'); srt.srt_passphrase = pw; }
    else srt.srt_passphrase = undefined; // vazio = mantém a senha que já estava
    srt.srt_streamid = String(b.srt_streamid || '').trim().slice(0, 512) || null;
  } else {
    if (address && !isIPv4(address)) throw bad('Endereço IP inválido. Ex.: 239.1.1.1');
    // envio: multicast (grupo 224.0.0.0 a 239.255.255.255) ou unicast (o equipamento manda para o IP deste servidor)
    if (b.delivery === 'multicast' && !isMulticast(address)) throw bad('Informe o grupo multicast (de 224.0.0.0 a 239.255.255.255). Ex.: 239.1.1.1');
    if (b.delivery === 'unicast' && address && isMulticast(address)) throw bad('Esse endereço é de multicast. Para unicast, escolha um IP deste servidor ou deixe "Todas as placas".');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw bad('Porta inválida (1 a 65535).');
  if (iface && !isIPv4(iface)) throw bad('IP da placa de rede inválido.');
  if (source_ip && !isIPv4(source_ip)) throw bad('IP de origem inválido.');
  const targets = (Array.isArray(b.targets) ? b.targets : KINDS[kind || 'auto'].targets).filter(t => TARGETS[t]);
  const equipment_id = b.equipment_id === '' || b.equipment_id == null ? null : Number(b.equipment_id);
  if (equipment_id != null && !Number.isInteger(equipment_id)) throw bad('Equipamento inválido.');
  return { name, kind, protocol, ...srt, address: address || null, port, iface: protocol === 'srt' || !isMulticast(address) ? null : iface || null, source_ip: source_ip || null, seconds, targets: JSON.stringify(targets), equipment_id, notes: String(b.notes || '').trim().slice(0, 300) || null };
}
const bad = m => Object.assign(new Error(m), { status: 400 });
// a senha do SRT nunca volta para o navegador
const pub = s => { if (!s) return s; const { srt_passphrase, ...rest } = s; return { ...rest, has_passphrase: !!srt_passphrase, targets: JSON.parse(s.targets || '[]') }; };
const autoName = s => s.protocol === 'srt' ? `srt://${s.address || ''}:${s.port}${s.srt_mode === 'listener' ? ' (listener)' : ''}`
  : isMulticast(s.address) ? `${s.address}:${s.port}` : `unicast :${s.port}${s.source_ip ? ' de ' + s.source_ip : ''}`;
const summary = r => `${r.system} · ${r.programs.length} serviço${r.programs.length === 1 ? '' : 's'} · ${String(r.totalMbps).replace('.', ',')} Mbps` + (r.ccErrors ? ` · ${r.ccErrors} erros CC` : '');

function setup(app, pool, { requireEditor, who }) {
  const q = (sql, v) => pool.query(sql, v).then(r => r.rows);
  const audit = (c, tbl, id, field, oldV, newV, ctx) => c.query('INSERT INTO audit_log (tbl,row_id,field,old_value,new_value,context,username) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [tbl, String(id), field, oldV, newV, String(ctx).slice(0, 200), who()]);
  let running = 0;
  const wrap = fn => (req, res, next) => fn(req, res, next).catch(e => e.status || e.friendly ? res.status(e.status || 422).json({ error: e.message, code: e.code }) : next(e));

  app.get('/api/coleta', requireEditor, wrap(async (_req, res) => {
    // primeira vez: já deixa cadastrado o stream padrão 226.0.0.1:5000 (multicast, placa automática)
    const [flag] = await q("SELECT 1 FROM settings WHERE key='coleta_stream_padrao'");
    if (!flag) {
      await q(`INSERT INTO stream_sources (name,kind,protocol,address,port,seconds,targets,notes)
        SELECT '226.0.0.1:5000','auto','udp','226.0.0.1',5000,10,$1,'Stream padrão: RTP multicast pela porta de rede'
        WHERE NOT EXISTS (SELECT 1 FROM stream_sources WHERE address='226.0.0.1' AND port=5000)`, [JSON.stringify(KINDS.auto.targets)]);
      await q("INSERT INTO settings (key,label,value) VALUES ('coleta_stream_padrao','Stream padrão da coleta já criado',1) ON CONFLICT (key) DO NOTHING");
    }
    // teste desligado (terminou o tempo ou o sistema reiniciou): tira os streams TESTE da lista
    if (!test.procs.length) await q('DELETE FROM stream_sources WHERE name LIKE $1', [TEST_PREFIX + '%']);
    const sources = (await q('SELECT * FROM stream_sources ORDER BY lower(name), id')).map(pub);
    const last = await q(`SELECT DISTINCT ON (source_id) id, source_id, at, username, applied FROM stream_measurements ORDER BY source_id, at DESC`);
    res.json({ sources, last, interfaces: interfaces(), srt: srtTool()?.label || null, cloud: !!process.env.RENDER, test: testStatus(), targets: TARGETS, kinds: Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, { label: v.label, targets: v.targets }])) });
  }));

  // Teste local: { acao: 'iniciar' | 'parar', minutos }
  app.post('/api/coleta/teste', requireEditor, wrap(async (req, res) => {
    const b = req.body || {};
    if (b.acao === 'parar') {
      stopTest();
      await q('DELETE FROM stream_sources WHERE name LIKE $1', [TEST_PREFIX + '%']);
      await audit(pool, 'stream_sources', '-', 'teste local', null, 'parado', 'Coleta RTP · teste local desligado');
      return res.json(testStatus());
    }
    const minutes = Math.min(60, Math.max(1, Number(b.minutos) || 15));
    stopTest();
    // 1) multicast pela placa principal (testa o mesmo caminho do stream real); 2) se não der, unicast local
    const iface = interfaces().find(i => !i.internal)?.address || '127.0.0.1';
    let mode = 'multicast';
    startGenerators(mode, iface, minutes);
    await new Promise(r => setTimeout(r, 1200));
    try { await capture({ address: TEST_STREAMS[0].group, port: TEST_STREAMS[0].port, iface, seconds: 2 }); }
    catch {
      stopTest(); mode = 'unicast';
      startGenerators(mode, null, minutes);
      await new Promise(r => setTimeout(r, 1200));
      try { await capture({ address: '127.0.0.1', port: TEST_STREAMS[0].port, seconds: 2 }); }
      catch (e) { stopTest(); throw Object.assign(new Error('Não consegui receber nem o stream de teste gerado aqui: ' + e.message), { status: 500 }); }
    }
    test.mode = mode; test.iface = mode === 'multicast' ? iface : null; test.until = new Date(Date.now() + minutes * 60000).toISOString();
    test.srt = startSrtTest(minutes);
    // unicast: gerador -> IP deste servidor:5530, coleta só aceita pacotes vindos desse IP
    {
      const uip = interfaces().find(i => !i.internal)?.address || '127.0.0.1';
      const g = spawn(process.execPath, [path.join(__dirname, 'tools', 'stream-teste.js'), TEST_UNI.profile, `${uip}:${TEST_UNI.port}`, '--minutos', String(minutes)], { stdio: 'ignore' });
      test.procs.push(g);
      const [row] = await q('SELECT id FROM stream_sources WHERE name=$1', [TEST_UNI.name]);
      const vals = [TEST_UNI.kind, TEST_UNI.port, uip, JSON.stringify(TEST_UNI.targets)];
      if (row) await q("UPDATE stream_sources SET kind=$1, protocol='udp', address=NULL, port=$2, source_ip=$3, iface=NULL, seconds=5, targets=$4 WHERE id=$5", [...vals, row.id]);
      else await q("INSERT INTO stream_sources (name,kind,protocol,address,port,source_ip,seconds,targets,notes) VALUES ($5,$1,'udp',NULL,$2,$3,5,$4,'Stream unicast simulado pelo teste local. Os valores não podem ser gravados.')", [...vals, TEST_UNI.name]);
    }
    if (test.srt) {
      const [row] = await q('SELECT id FROM stream_sources WHERE name=$1', [TEST_SRT.name]);
      const vals = [TEST_SRT.kind, '127.0.0.1', TEST_SRT.port, JSON.stringify(TEST_SRT.targets)];
      if (row) await q("UPDATE stream_sources SET kind=$1, protocol='srt', srt_mode='caller', srt_latency=120, address=$2, port=$3, iface=NULL, seconds=5, targets=$4 WHERE id=$5", [...vals, row.id]);
      else await q("INSERT INTO stream_sources (name,kind,protocol,srt_mode,srt_latency,address,port,seconds,targets,notes) VALUES ($5,$1,'srt','caller',120,$2,$3,5,$4,'Stream SRT simulado pelo teste local. Os valores não podem ser gravados.')", [...vals, TEST_SRT.name]);
    }
    test.timer = setTimeout(() => { stopTest(); q('DELETE FROM stream_sources WHERE name LIKE $1', [TEST_PREFIX + '%']).catch(() => {}); }, minutes * 60000 + 2000);
    for (const t of TEST_STREAMS) {
      const address = mode === 'multicast' ? t.group : '127.0.0.1', ifc = mode === 'multicast' ? iface : null;
      const [row] = await q('SELECT id FROM stream_sources WHERE name=$1', [t.name]);
      if (row) await q('UPDATE stream_sources SET kind=$1, address=$2, port=$3, iface=$4, seconds=5, targets=$5 WHERE id=$6', [t.kind, address, t.port, ifc, JSON.stringify(t.targets), row.id]);
      else await q('INSERT INTO stream_sources (name,kind,address,port,iface,seconds,targets,notes) VALUES ($1,$2,$3,$4,$5,5,$6,$7)',
        [t.name, t.kind, address, t.port, ifc, JSON.stringify(t.targets), 'Stream simulado pelo teste local. Os valores não podem ser gravados.']);
    }
    await audit(pool, 'stream_sources', '-', 'teste local', null, `${mode} por ${minutes} min`, 'Coleta RTP · teste local ligado');
    res.json(testStatus());
  }));

  app.post('/api/coleta/fontes', requireEditor, wrap(async (req, res) => {
    const s = parseSource(req.body || {});
    s.name = s.name || autoName(s); s.kind = s.kind || 'auto';
    if (s.srt_passphrase === undefined) s.srt_passphrase = null;
    const cols = Object.keys(s);
    const [row] = await q(`INSERT INTO stream_sources (${cols.join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`, cols.map(k => s[k]));
    await audit(pool, 'stream_sources', row.id, 'cadastro', null, `${row.name} · ${row.address || '*'}:${row.port}`, 'Coleta RTP · stream cadastrado');
    res.status(201).json(pub(row));
  }));

  app.put('/api/coleta/fontes/:id', requireEditor, wrap(async (req, res) => {
    const s = parseSource(req.body || {});
    if (s.srt_passphrase === undefined) delete s.srt_passphrase;
    const cols = Object.keys(s);
    // sem nome ou tipo no formulário, mantém os que já estavam
    const rows = await q(`UPDATE stream_sources SET ${cols.map((k, i) => k === 'name' || k === 'kind' ? `${k}=COALESCE($${i + 1},${k})` : `${k}=$${i + 1}`).join(',')} WHERE id=$${cols.length + 1} RETURNING *`, [...cols.map(k => s[k]), req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Stream não encontrado.' });
    await audit(pool, 'stream_sources', rows[0].id, 'alteração', null, `${rows[0].name} · ${rows[0].address || '*'}:${rows[0].port}`, 'Coleta RTP · stream alterado');
    res.json(pub(rows[0]));
  }));

  app.delete('/api/coleta/fontes/:id', requireEditor, wrap(async (req, res) => {
    const rows = await q('DELETE FROM stream_sources WHERE id=$1 RETURNING *', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Stream não encontrado.' });
    await audit(pool, 'stream_sources', rows[0].id, 'exclusão', `${rows[0].name} · ${rows[0].address || '*'}:${rows[0].port}`, null, 'Coleta RTP · stream excluído');
    res.json({ ok: true });
  }));

  // Mede: { source_id } (stream cadastrado) ou { address, port, iface, source_ip, seconds, kind, targets } (avulso)
  app.post('/api/coleta/medir', requireEditor, wrap(async (req, res) => {
    const b = req.body || {};
    let src = null, opts;
    if (b.source_id) {
      const [row] = await q('SELECT * FROM stream_sources WHERE id=$1', [b.source_id]);
      if (!row) return res.status(404).json({ error: 'Stream não encontrado. Atualize a página.' });
      src = { ...pub(row), srt_passphrase: row.srt_passphrase };
      opts = { kind: src.kind, targets: Array.isArray(b.targets) ? b.targets.filter(t => TARGETS[t]) : src.targets, equipment_id: src.equipment_id, name: src.name, test: src.name.startsWith(TEST_PREFIX) };
    } else {
      const s = parseSource(b); s.kind = s.kind || 'auto'; if (s.srt_passphrase === undefined) s.srt_passphrase = null;
      src = { ...s, targets: JSON.parse(s.targets) };
      opts = { kind: s.kind, targets: src.targets, equipment_id: s.equipment_id, name: autoName(s) };
    }
    if (opts.test && !test.procs.length) {
      await q('DELETE FROM stream_sources WHERE name LIKE $1', [TEST_PREFIX + '%']);
      return res.status(409).json({ error: 'O teste local está desligado (terminou o tempo ou o sistema reiniciou). Clique em Iniciar teste e colete de novo.', code: 'teste_desligado' });
    }
    if (running >= 3) return res.status(429).json({ error: 'Já há 3 medições rodando. Espere uma terminar.' });
    running++;
    let result;
    try {
      result = src.protocol === 'srt'
        ? await captureSrt({ host: src.address || '', port: src.port, mode: src.srt_mode, latency: src.srt_latency, passphrase: src.srt_passphrase || '', streamid: src.srt_streamid || '', seconds: b.seconds || src.seconds })
        : await capture({ address: src.address || '', port: src.port, iface: src.iface || '', source: src.source_ip || '', seconds: b.seconds || src.seconds });
    }
    finally { running--; }
    // tipo automático: decide pelo que chegou (BTS ISDB-T ou DVB) e só usa as abas que fazem sentido
    if (opts.kind === 'auto') {
      opts.kind = result.isdb ? 'isdb' : 'dvb';
      if (!result.isdb) opts.targets = opts.targets.filter(t => !t.startsWith('isdb_'));
    }
    const [m] = await q('INSERT INTO stream_measurements (source_id, username, opts, result) VALUES ($1,$2,$3,$4) RETURNING id, at',
      [b.source_id || null, who(), JSON.stringify(opts), JSON.stringify(result)]);
    if (b.source_id) await q('UPDATE stream_sources SET last_at=now(), last_summary=$1 WHERE id=$2', [summary(result), b.source_id]);
    await q('DELETE FROM stream_measurements WHERE id IN (SELECT id FROM stream_measurements WHERE source_id IS NOT DISTINCT FROM $1 ORDER BY at DESC OFFSET 50)', [b.source_id || null]);
    const db = await loadDb(q);
    const { proposals, matches, unmatched } = propose(result, db, opts);
    res.json({ measurement: { id: m.id, at: m.at }, opts, result, proposals, matches, unmatched });
  }));

  // Reabre uma medição já feita, com as diferenças recalculadas contra o banco de agora
  app.get('/api/coleta/medicoes/:id', requireEditor, wrap(async (req, res) => {
    const [m] = await q('SELECT * FROM stream_measurements WHERE id=$1', [req.params.id]);
    if (!m) return res.status(404).json({ error: 'Medição não encontrada.' });
    const opts = JSON.parse(m.opts), result = JSON.parse(m.result);
    const { proposals, matches, unmatched } = propose(result, await loadDb(q), opts);
    res.json({ measurement: { id: m.id, at: m.at, username: m.username, applied: m.applied }, opts, result, proposals, matches, unmatched });
  }));

  // Grava as mudanças marcadas: { measurement_id, ids: [...] }
  app.post('/api/coleta/aplicar', requireEditor, wrap(async (req, res) => {
    const { measurement_id, ids } = req.body || {};
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'Marque pelo menos uma mudança.' });
    const [m] = await q('SELECT * FROM stream_measurements WHERE id=$1', [measurement_id]);
    if (!m) return res.status(404).json({ error: 'Medição não encontrada. Colete de novo.' });
    const opts = JSON.parse(m.opts), result = JSON.parse(m.result);
    if (opts.test) return res.status(400).json({ error: 'Medição de teste: os valores são simulados e não podem ser gravados.' });
    const want = new Set(ids.map(String));
    const c = await pool.connect();
    let applied = 0;
    const skipped = [];
    try {
      await c.query('BEGIN');
      const db = await loadDb((sql, v) => c.query(sql, v).then(r => r.rows));
      const { proposals } = propose(result, db, opts);
      const byId = new Map(proposals.map(p => [p.id, p]));
      for (const id of want) if (!byId.has(id)) skipped.push(id);
      const ctx = `Coleta ${opts.name} (${new Date(m.at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })})`;
      // serviços novos primeiro, depois o resto na ordem da lista
      for (const p of proposals) if (want.has(p.id) && p.blocked) skipped.push(p.id);
      const list = proposals.filter(p => want.has(p.id) && !p.blocked).sort((a, b) => (a.op === 'newService' ? 0 : 1) - (b.op === 'newService' ? 0 : 1));
      for (const p of list) {
        if (p.op === 'newService') p.row.equipment_id = opts.equipment_id || null;
        if (await applyOne(c, p, ctx, audit)) applied++; else skipped.push(p.id);
      }
      await c.query('UPDATE stream_measurements SET applied = applied + $1 WHERE id=$2', [applied, m.id]);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      if (e.code === '23505') return res.status(409).json({ error: 'Já existe um serviço com esse nome. Desmarque o cadastro ou renomeie o serviço existente.' });
      throw e;
    } finally { c.release(); }
    res.json({ applied, skipped });
  }));
}

module.exports = { setup, propose, matchPrograms, TARGETS, KINDS };
