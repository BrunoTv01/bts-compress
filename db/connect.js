// Descobre sozinho como falar com o PostgreSQL, para o sistema rodar sem configurar nada.
//
// Ordem:
//   1. DATABASE_URL, se alguém informou (Render, Docker, instalador).
//   2. Arquivo .env da pasta do sistema ou /etc/bts-compress.env (lidos em loadEnvFiles).
//   3. PostgreSQL da própria máquina, pelo socket local (sem senha).
//   4. Se nada disso funcionar e o sistema estiver rodando como root, cria o usuário
//      e o banco "bts" com senha aleatória e grava a configuração em .env.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const pg = require('pg');

const APP_DIR = path.join(__dirname, '..');
const LOCAL_ENV = path.join(APP_DIR, '.env');
const ETC_ENV = '/etc/bts-compress.env';
const DB_NAME = 'bts';
const DB_USER = 'bts';
const SOCKETS = ['/var/run/postgresql', '/run/postgresql', '/tmp'];

// Lê arquivos KEY=valor sem sobrescrever o que já veio do ambiente
const envSource = {};
function loadEnvFiles() {
  for (const file of [LOCAL_ENV, ETC_ENV]) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m || line.trim().startsWith('#')) continue;
      const v = m[2].replace(/^(['"])(.*)\1$/, '$2');
      if (process.env[m[1]] === undefined) { process.env[m[1]] = v; envSource[m[1]] = file; }
    }
  }
}

const sslOpt = () => (process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false);

async function tryConnect(connectionString) {
  const pool = new pg.Pool({ connectionString, ssl: sslOpt(), max: 1, connectionTimeoutMillis: 3000 });
  try { await pool.query('SELECT 1'); return { ok: true }; }
  catch (e) { return { ok: false, code: e.code, msg: e.message }; }
  finally { await pool.end?.().catch(() => {}); }
}

const socketUrl = (dir, user, db) => `postgresql:///${db}?host=${encodeURIComponent(dir)}&user=${encodeURIComponent(user)}`;
const hasSocket = dir => { try { return fs.readdirSync(dir).some(f => f.startsWith('.s.PGSQL.')); } catch { return false; } };

function saveLocalEnv(url) {
  let text = '';
  try { text = fs.readFileSync(LOCAL_ENV, 'utf8'); } catch {}
  text = text.split(/\r?\n/).filter(l => l && !l.startsWith('DATABASE_URL=')).join('\n');
  fs.writeFileSync(LOCAL_ENV, `${text ? text + '\n' : ''}# Gerado automaticamente pelo BTS Compress\nDATABASE_URL=${url}\n`, { mode: 0o600 });
}

// Cria usuário e banco "bts" usando o superusuário postgres (só funciona rodando como root)
function provisionAsRoot() {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return null;
  const psql = sql => execFileSync('su', ['-', 'postgres', '-c', `psql -qtAX -c "${sql}"`], { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  try {
    const pass = crypto.randomBytes(16).toString('hex');
    if (psql(`SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'`) === '1') psql(`ALTER ROLE ${DB_USER} LOGIN PASSWORD '${pass}'`);
    else psql(`CREATE ROLE ${DB_USER} LOGIN PASSWORD '${pass}'`);
    if (psql(`SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'`) !== '1')
      execFileSync('su', ['-', 'postgres', '-c', `createdb -O ${DB_USER} ${DB_NAME}`], { stdio: 'ignore' });
    return `postgres://${DB_USER}:${pass}@127.0.0.1:5432/${DB_NAME}`;
  } catch { return null; }
}

// Se o usuário conecta mas o banco "bts" não existe, tenta criar
async function ensureDatabase(url) {
  const adminUrl = url.replace(new RegExp(`/${DB_NAME}(\\?|$)`), '/postgres$1');
  const pool = new pg.Pool({ connectionString: adminUrl, ssl: sslOpt(), max: 1, connectionTimeoutMillis: 3000 });
  try { await pool.query(`CREATE DATABASE ${DB_NAME}`); return true; }
  catch { return false; }
  finally { await pool.end?.().catch(() => {}); }
}

async function resolveDatabaseUrl() {
  loadEnvFiles();
  if (process.env.DATABASE_URL)
    return { url: process.env.DATABASE_URL, how: envSource.DATABASE_URL ? `configuração salva em ${envSource.DATABASE_URL}` : 'DATABASE_URL do ambiente' };

  const me = os.userInfo().username;
  const tried = [];
  for (const dir of SOCKETS.filter(hasSocket)) {
    for (const user of [...new Set([me, DB_USER, 'postgres'])]) {
      const url = socketUrl(dir, user, DB_NAME);
      let r = await tryConnect(url);
      if (!r.ok && r.code === '3D000' && await ensureDatabase(url)) r = await tryConnect(url); // banco não existe: cria
      if (r.ok) return { url, how: `PostgreSQL local (socket ${dir}, usuário ${user})` };
      tried.push(`${user}@${dir}: ${r.msg}`);
    }
  }

  const url = provisionAsRoot();
  if (url && (await tryConnect(url)).ok) {
    saveLocalEnv(url);
    return { url, how: `banco "${DB_NAME}" criado automaticamente; configuração salva em ${LOCAL_ENV}` };
  }

  const err = new Error([
    'Não encontrei um PostgreSQL para usar.',
    '  • Instale o PostgreSQL nesta máquina:  sudo apt install postgresql   (ou: sudo dnf install postgresql-server)',
    '  • Depois rode o sistema uma vez como root (sudo npm start) ou use  sudo ./deploy/install.sh',
    '    O banco "bts" e a senha são criados sozinhos.',
    '  • Para usar um banco de outro servidor, defina DATABASE_URL.',
    tried.length ? '  Tentativas: ' + tried.join(' | ') : '',
  ].filter(Boolean).join('\n'));
  err.friendly = true;
  throw err;
}

module.exports = { resolveDatabaseUrl, loadEnvFiles, sslOpt };
