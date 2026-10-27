const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const pg = require('pg');
const { seed } = require('./db/seed');
const auth = require('./auth');

// NUMERIC volta como número, não como texto
pg.types.setTypeParser(1700, v => (v === null ? null : parseFloat(v)));

const { resolveDatabaseUrl, loadEnvFiles, sslOpt } = require('./db/connect');
loadEnvFiles(); // .env da pasta do sistema e /etc/bts-compress.env (PORT, ADMIN_TOKEN, DATABASE_URL...)
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// O banco é descoberto na inicialização (veja db/connect.js); as rotas usam este objeto
let realPool = null;
const pool = {
  query: (...a) => realPool.query(...a),
  connect: () => realPool.connect(),
};

// Campos que podem ser editados pelo sistema: tabela -> { chave primária, colunas, tipo }
const EDITABLE = {
  settings:      { pk: 'key',        cols: ['value'], type: 'number' },
  bitrates:      { pk: 'id',         cols: ['mbps'],  type: 'number', text: ['note', 'encoder', 'label'], extra: { equipment_id: 'ref' } },
  service_pids:  { pk: 'service_id', cols: ['v', 'a1', 'a2', 'a3', 'a4', 'pcr', 'pmt', 'dem', 'ait', 'cc', 'ect', 'data'], type: 'int' },
  encoder_rates: { pk: 'id',         cols: ['a1', 'a2', 'a3', 'a4', 'v', 'cc'], type: 'number', text: ['equipment'], extra: { equipment_id: 'ref' } },
  services:      { pk: 'id',         cols: ['service_id'], type: 'ref', text: ['name', 'codec', 'system'] },
  equipment:     { pk: 'id',         cols: [], type: 'text', text: ['name', 'manufacturer', 'model', 'function', 'location', 'serial', 'notes'] },
  isdb_layers:   { pk: 'id',         cols: ['mbps'],  type: 'number', text: ['name'], extra: { equipment_id: 'ref' } },
  isdb_pids:     { pk: 'id',         cols: ['pid'],   type: 'int', text: ['grp', 'ident'], extra: { mbps: 'number' } },
};

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8'));
    const { rows } = await client.query('SELECT count(*)::int AS n FROM services');
    if (rows[0].n === 0) {
      await client.query('BEGIN');
      await seed(client);
      await client.query('COMMIT');
      console.log('Banco populado com os dados da planilha.');
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

const app = express();
// atrás de nginx/Render: confia no proxy da rede local para saber o IP real e se é https
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback, linklocal, uniquelocal');
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));
const { requireRole, bootstrap } = auth.setup(app, pool);
const requireEditor = requireRole('editor'); // alterar dados: Editor ou Admin
// Coleta de dados de streams RTP/UDP (aba Coleta RTP)
require('./coleta').setup(app, pool, { requireEditor, who: auth.who });

app.get('/api/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }); }
  catch { res.status(503).json({ ok: false }); }
});

// Todos os dados do estudo numa chamada
app.get('/api/data', async (req, res, next) => {
  try {
    const q = sql => pool.query(sql).then(r => r.rows);
    const [settings, services, pids, bitrates, encoder, layers, isdbPids, equipment] = await Promise.all([
      q('SELECT key,label,value FROM settings ORDER BY key'),
      q('SELECT * FROM services ORDER BY sort'),
      q('SELECT p.* FROM service_pids p JOIN services s ON s.id=p.service_id ORDER BY s.sort'),
      q('SELECT b.* FROM bitrates b JOIN services s ON s.id=b.service_id ORDER BY s.sort'),
      q('SELECT e.* FROM encoder_rates e JOIN services s ON s.id=e.service_id ORDER BY s.sort'),
      q('SELECT * FROM isdb_layers ORDER BY sort'),
      q('SELECT * FROM isdb_pids ORDER BY sort'),
      q('SELECT * FROM equipment ORDER BY lower(name), id'),
    ]);
    res.json({ settings, services, pids, bitrates, encoder, layers, isdbPids, equipment, editable: req.user.role !== 'viewer' });
  } catch (e) { next(e); }
});

app.get('/api/history', async (_req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM audit_log ORDER BY at DESC LIMIT 200');
    res.json(rows);
  } catch (e) { next(e); }
});


const EQUIP_FIELDS = ['name', 'manufacturer', 'model', 'function', 'location', 'serial', 'notes'];
const clean = v => (v == null ? null : String(v).trim().slice(0, 500) || null);
const equipLabel = e => [e.name, e.model].filter(Boolean).join(' · ');

// Cadastra equipamento: POST /api/equipment { name, manufacturer, model, function, location, serial, notes }
app.post('/api/equipment', requireEditor, async (req, res, next) => {
  const b = req.body || {};
  const vals = EQUIP_FIELDS.map(f => clean(b[f]));
  if (!vals[0]) return res.status(400).json({ error: 'O nome do equipamento é obrigatório.' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO equipment (${EQUIP_FIELDS.join(',')}) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, vals);
    await pool.query('INSERT INTO audit_log (tbl,row_id,field,old_value,new_value,context,username) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      ['equipment', String(rows[0].id), 'cadastro', null, equipLabel(rows[0]), 'Equipamento cadastrado', auth.who()]);
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

// Exclui equipamento; os serviços que o usavam ficam sem equipamento
app.delete('/api/equipment/:id', requireEditor, async (req, res, next) => {
  try {
    const { rows } = await pool.query('DELETE FROM equipment WHERE id=$1 RETURNING *', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Equipamento não encontrado.' });
    await pool.query('INSERT INTO audit_log (tbl,row_id,field,old_value,new_value,context,username) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      ['equipment', String(rows[0].id), 'exclusão', equipLabel(rows[0]), null, 'Equipamento excluído', auth.who()]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ===== Inclusão e exclusão de linhas ===== */
const num = v => { if (v === '' || v == null) return null; const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : NaN; };
const audit = (c, tbl, id, field, oldV, newV, ctx) => c.query(
  'INSERT INTO audit_log (tbl,row_id,field,old_value,new_value,context,username) VALUES ($1,$2,$3,$4,$5,$6,$7)',
  [tbl, String(id), field, oldV, newV, ctx ? String(ctx).slice(0, 200) : null, auth.who()]);

// tabela -> colunas aceitas (tipo), obrigatórias e se tem ordem própria
const ROWS = {
  service_pids:  { pk: 'service_id', cols: { service_id: 'int' }, req: ['service_id'] },
  bitrates:      { pk: 'id', cols: { service_id: 'int', config: 'text', mbps: 'num' }, req: ['service_id', 'config'], oneOf: { config: ['pids_total', 'titular', 'reserva', 'antigo'] } },
  encoder_rates: { pk: 'id', cols: { service_id: 'int', source: 'text', a1: 'num', a2: 'num', a3: 'num', a4: 'num', v: 'num', cc: 'num' }, req: ['service_id', 'source'], oneOf: { source: ['enc', 'mux'] } },
  isdb_layers:   { pk: 'id', cols: { layer: 'text', name: 'text', mbps: 'num' }, req: ['layer', 'name'], oneOf: { layer: ['A', 'B', 'C', 'Tabelas'] }, sort: true },
  isdb_pids:     { pk: 'id', cols: { grp: 'text', pid: 'int', ident: 'text', mbps: 'num' }, req: ['grp'], sort: true },
};

function parseRow(spec, body) {
  const out = {};
  for (const [k, t] of Object.entries(spec.cols)) {
    let v = body[k];
    if (t === 'text') v = v == null ? null : String(v).trim().slice(0, 200) || null;
    else {
      v = num(v);
      if (Number.isNaN(v) || (v != null && v < 0)) throw Object.assign(new Error(`Valor inválido em ${k}.`), { status: 400 });
      if (t === 'int' && v != null && !Number.isInteger(v)) throw Object.assign(new Error(`${k} precisa ser inteiro.`), { status: 400 });
    }
    out[k] = v;
  }
  for (const k of spec.req) if (out[k] == null) throw Object.assign(new Error('Preencha os campos obrigatórios.'), { status: 400 });
  for (const [k, list] of Object.entries(spec.oneOf || {})) if (!list.includes(out[k])) throw Object.assign(new Error(`Valor inválido em ${k}.`), { status: 400 });
  if (out.pid != null && out.pid > 8191) throw Object.assign(new Error('PID vai de 0 a 8191.'), { status: 400 });
  return out;
}

app.post('/api/rows/:table', requireEditor, async (req, res, next) => {
  const spec = ROWS[req.params.table];
  if (!spec) return res.status(404).json({ error: 'Tabela não permite inclusão.' });
  let row;
  try { row = parseRow(spec, req.body || {}); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const t = req.params.table;
    if (spec.sort) row.sort = (await client.query(`SELECT COALESCE(max(sort),0)+1 AS n FROM ${t}`)).rows[0].n;
    const keys = Object.keys(row);
    const { rows } = await client.query(`INSERT INTO ${t} (${keys.join(',')}) VALUES (${keys.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`, keys.map(k => row[k]));
    await audit(client, t, rows[0][spec.pk], 'inclusão', null, 'linha incluída', req.body.context);
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (e.code === '23505') return res.status(409).json({ error: 'Esse serviço já está nesta tabela.' });
    if (e.code === '23503') return res.status(400).json({ error: 'Serviço não encontrado. Atualize a página.' });
    next(e);
  } finally { client.release(); }
});

app.delete('/api/rows/:table/:id', requireEditor, async (req, res, next) => {
  const spec = ROWS[req.params.table];
  if (!spec) return res.status(404).json({ error: 'Tabela não permite exclusão.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`DELETE FROM ${req.params.table} WHERE ${spec.pk}=$1 RETURNING *`, [req.params.id]);
    if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Linha não encontrada.' }); }
    await audit(client, req.params.table, req.params.id, 'exclusão', JSON.stringify(rows[0]).slice(0, 400), null, req.query.context);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); next(e); }
  finally { client.release(); }
});

/* ===== Cadastro de serviços ===== */
// POST /api/services { name, service_id, codec, system, include: ['pids','titular','reserva','antigo','enc','mux','isdb'] }
app.post('/api/services', requireEditor, async (req, res, next) => {
  const b = req.body || {};
  const name = clean(b.name), codec = clean(b.codec), system = b.system === 'ISDB-T' ? 'ISDB-T' : 'DVB';
  const sid = num(b.service_id);
  if (!name) return res.status(400).json({ error: 'O nome do serviço é obrigatório.' });
  if (Number.isNaN(sid) || (sid != null && (!Number.isInteger(sid) || sid < 0))) return res.status(400).json({ error: 'ID de serviço precisa ser um número inteiro.' });
  const inc = new Set(Array.isArray(b.include) ? b.include : []);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sort = (await client.query('SELECT COALESCE(max(sort),0)+1 AS n FROM services')).rows[0].n;
    const { rows } = await client.query('INSERT INTO services (service_id,name,codec,system,sort) VALUES ($1,$2,$3,$4,$5) RETURNING *', [sid, name, codec, system, sort]);
    const id = rows[0].id;
    if (inc.has('pids')) {
      await client.query('INSERT INTO service_pids (service_id) VALUES ($1)', [id]);
      await client.query("INSERT INTO bitrates (service_id,config) VALUES ($1,'pids_total')", [id]);
    }
    for (const cfg of ['titular', 'reserva', 'antigo']) if (inc.has(cfg)) await client.query('INSERT INTO bitrates (service_id,config) VALUES ($1,$2)', [id, cfg]);
    for (const src of ['enc', 'mux']) if (inc.has(src)) await client.query('INSERT INTO encoder_rates (service_id,source) VALUES ($1,$2)', [id, src]);
    if (inc.has('isdb')) await client.query("INSERT INTO isdb_layers (layer,name,sort) VALUES ('B',$1,(SELECT COALESCE(max(sort),0)+1 FROM isdb_layers))", [name]);
    await audit(client, 'services', id, 'cadastro', null, name, 'Serviço cadastrado');
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (e.code === '23505') return res.status(409).json({ error: 'Já existe um serviço com esse nome.' });
    next(e);
  } finally { client.release(); }
});

// Exclui o serviço e todas as linhas dele (PIDs, bitrates, taxas)
app.delete('/api/services/:id', requireEditor, async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('DELETE FROM services WHERE id=$1 RETURNING *', [req.params.id]);
    if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Serviço não encontrado.' }); }
    await client.query('DELETE FROM isdb_layers WHERE name=$1', [rows[0].name]);
    await audit(client, 'services', req.params.id, 'exclusão', rows[0].name, null, 'Serviço excluído de todas as abas');
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); next(e); }
  finally { client.release(); }
});

// Edita um campo: PATCH /api/bitrates/12  { "field": "mbps", "value": 4.5, "context": "FEED · titular" }
app.patch('/api/:table/:id', requireEditor, async (req, res, next) => {
  const spec = EDITABLE[req.params.table];
  const { field, context } = req.body || {};
  let { value } = req.body || {};
  if (!spec) return res.status(404).json({ error: 'Tabela não editável.' });

  let type = null;
  if (spec.cols.includes(field)) type = spec.type;
  else if (spec.text && spec.text.includes(field)) type = 'text';
  else if (spec.extra && spec.extra[field]) type = spec.extra[field];
  if (!type) return res.status(400).json({ error: 'Campo não editável.' });

  if (value === '' || value === undefined) value = null;
  if (value !== null && type !== 'text') {
    const n = Number(String(value).replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'Use um número maior ou igual a zero.' });
    if (type === 'int' && !Number.isInteger(n)) return res.status(400).json({ error: 'PID precisa ser um número inteiro.' });
    if (type === 'int' && n > 8191) return res.status(400).json({ error: 'PID vai de 0 a 8191.' });
    if (type === 'ref' && !Number.isInteger(n)) return res.status(400).json({ error: 'Use um número inteiro.' });
    value = n;
  }
  if (type === 'text' && value !== null) value = String(value).trim().slice(0, 500) || null;
  if ((['equipment', 'services', 'isdb_layers'].includes(req.params.table) && field === 'name' || field === 'grp') && value === null)
    return res.status(400).json({ error: 'O nome é obrigatório.' });

  const t = req.params.table;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(`SELECT ${field} AS v FROM ${t} WHERE ${spec.pk}=$1 FOR UPDATE`, [req.params.id]);
    if (!cur.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Registro não encontrado.' }); }
    await client.query(`UPDATE ${t} SET ${field}=$1 WHERE ${spec.pk}=$2`, [value, req.params.id]);
    if (t === 'services' && field === 'name' && cur.rows[0].v) // a linha ISDB-T com o mesmo nome acompanha a troca
      await client.query('UPDATE isdb_layers SET name=$1 WHERE name=$2', [value, cur.rows[0].v]);
    let oldTxt = cur.rows[0].v == null ? null : String(cur.rows[0].v), newTxt = value == null ? null : String(value);
    if (field === 'equipment_id') { // no histórico, mostra o nome do equipamento em vez do número
      const names = await client.query('SELECT id,name,model FROM equipment WHERE id = ANY($1::int[])', [[cur.rows[0].v, value].filter(v => v != null)]);
      const lbl = id => { const e = names.rows.find(r => r.id === id); return e ? equipLabel(e) : null; };
      oldTxt = lbl(cur.rows[0].v); newTxt = lbl(value);
    }
    await client.query('INSERT INTO audit_log (tbl,row_id,field,old_value,new_value,context,username) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [t, String(req.params.id), field === 'equipment_id' ? 'equipamento' : field, oldTxt, newTxt, context ? String(context).slice(0, 200) : null, auth.who()]);
    await client.query('COMMIT');
    res.json({ ok: true, value });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (e.code === '23505') return res.status(409).json({ error: 'Esse valor já está em uso.' });
    if (e.code === '23503') return res.status(400).json({ error: 'Esse equipamento não existe mais. Atualize a página.' });
    if (e.code === '23502') return res.status(400).json({ error: 'Esse campo não pode ficar vazio.' });
    next(e);
  } finally {
    client.release();
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Erro no servidor. Tente de novo.' });
});

resolveDatabaseUrl()
  .then(({ url, how }) => {
    realPool = new pg.Pool({ connectionString: url, ssl: sslOpt() });
    console.log(`Banco de dados: ${how}`);
  })
  .then(migrate)
  .then(bootstrap)
  .then(() => app.listen(PORT, HOST, () => console.log(`BTS Compress rodando em ${HOST}:${PORT}`)))
  .catch(e => { console.error(e.friendly ? e.message : 'Falha ao preparar o banco: ' + (e.stack || e)); process.exit(1); });
