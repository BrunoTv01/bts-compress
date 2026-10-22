const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const pg = require('pg');
const { seed } = require('./db/seed');

// NUMERIC volta como número, não como texto
pg.types.setTypeParser(1700, v => (v === null ? null : parseFloat(v)));

const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://localhost:5432/bts',
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
});

// Campos que podem ser editados pelo sistema: tabela -> { chave primária, colunas, tipo }
const EDITABLE = {
  settings:      { pk: 'key',        cols: ['value'], type: 'number' },
  bitrates:      { pk: 'id',         cols: ['mbps'],  type: 'number', text: ['note'] },
  service_pids:  { pk: 'service_id', cols: ['v', 'a1', 'a2', 'a3', 'a4', 'pcr', 'pmt', 'dem', 'ait', 'cc', 'ect', 'data'], type: 'int' },
  encoder_rates: { pk: 'id',         cols: ['a1', 'a2', 'a3', 'a4', 'v', 'cc'], type: 'number' },
  isdb_layers:   { pk: 'id',         cols: ['mbps'],  type: 'number' },
  isdb_pids:     { pk: 'id',         cols: ['pid'],   type: 'int', extra: { mbps: 'number' } },
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

function requireAdmin(req, res, next) {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const ok = ADMIN_TOKEN && token.length === ADMIN_TOKEN.length &&
    crypto.timingSafeEqual(Buffer.from(token), Buffer.from(ADMIN_TOKEN));
  if (!ok) return res.status(401).json({ error: 'Senha de edição inválida.' });
  next();
}

const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }); }
  catch { res.status(503).json({ ok: false }); }
});

// Todos os dados do estudo numa chamada
app.get('/api/data', async (_req, res, next) => {
  try {
    const q = sql => pool.query(sql).then(r => r.rows);
    const [settings, services, pids, bitrates, encoder, layers, isdbPids] = await Promise.all([
      q('SELECT key,label,value FROM settings ORDER BY key'),
      q('SELECT * FROM services ORDER BY sort'),
      q('SELECT p.* FROM service_pids p JOIN services s ON s.id=p.service_id ORDER BY s.sort'),
      q('SELECT b.* FROM bitrates b JOIN services s ON s.id=b.service_id ORDER BY s.sort'),
      q('SELECT e.* FROM encoder_rates e JOIN services s ON s.id=e.service_id ORDER BY s.sort'),
      q('SELECT * FROM isdb_layers ORDER BY sort'),
      q('SELECT * FROM isdb_pids ORDER BY sort'),
    ]);
    res.json({ settings, services, pids, bitrates, encoder, layers, isdbPids, editable: Boolean(ADMIN_TOKEN) });
  } catch (e) { next(e); }
});

app.get('/api/history', async (_req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM audit_log ORDER BY at DESC LIMIT 200');
    res.json(rows);
  } catch (e) { next(e); }
});

app.post('/api/auth/check', requireAdmin, (_req, res) => res.json({ ok: true }));

// Edita um campo: PATCH /api/bitrates/12  { "field": "mbps", "value": 4.5, "context": "FEED · titular" }
app.patch('/api/:table/:id', requireAdmin, async (req, res, next) => {
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
    value = n;
  }
  if (type === 'text' && value !== null) value = String(value).slice(0, 500);

  const t = req.params.table;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(`SELECT ${field} AS v FROM ${t} WHERE ${spec.pk}=$1 FOR UPDATE`, [req.params.id]);
    if (!cur.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Registro não encontrado.' }); }
    await client.query(`UPDATE ${t} SET ${field}=$1 WHERE ${spec.pk}=$2`, [value, req.params.id]);
    await client.query('INSERT INTO audit_log (tbl,row_id,field,old_value,new_value,context) VALUES ($1,$2,$3,$4,$5,$6)',
      [t, String(req.params.id), field, cur.rows[0].v == null ? null : String(cur.rows[0].v), value == null ? null : String(value), context ? String(context).slice(0, 200) : null]);
    await client.query('COMMIT');
    res.json({ ok: true, value });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (e.code === '23505') return res.status(409).json({ error: 'Esse valor já está em uso.' });
    next(e);
  } finally {
    client.release();
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Erro no servidor. Tente de novo.' });
});

migrate()
  .then(() => app.listen(PORT, () => console.log(`BTS Compress rodando na porta ${PORT}`)))
  .catch(e => { console.error('Falha ao preparar o banco:', e); process.exit(1); });
