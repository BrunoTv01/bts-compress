// Login, sessões e usuários do BTS Compress
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');

const ROLES = ['viewer', 'editor', 'admin'];           // ordem = nível de permissão
const ROLE_LABEL = { viewer: 'Leitura', editor: 'Editor', admin: 'Admin' };
const SESSION_HOURS = 12;                              // sessão expira após 12 h
const IDLE_MINUTES = 120;                              // ou após 2 h sem uso
const MAX_FAILS = 5;                                   // tentativas erradas antes do bloqueio
const LOCK_MINUTES = 10;                               // tempo de bloqueio
const COOKIE = 'bts_sid';
const MIN_PASSWORD = 8;

const als = new AsyncLocalStorage();
const who = () => als.getStore()?.user?.username || null;

/* ---------- senhas (scrypt, sem dependências) ---------- */
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw).normalize('NFC'), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(String(pw).normalize('NFC'), Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
  const want = Buffer.from(hashHex, 'hex');
  return want.length === hash.length && crypto.timingSafeEqual(hash, want);
}
const DUMMY_HASH = hashPassword(crypto.randomBytes(8).toString('hex')); // iguala o tempo quando o usuário não existe

function passwordProblem(pw, username) {
  pw = String(pw || '');
  if (pw.length < MIN_PASSWORD) return `A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`;
  if (pw.length > 200) return 'A senha é longa demais.';
  if (!/[A-Za-zÀ-ÿ]/.test(pw) || !/[0-9]/.test(pw)) return 'Use letras e números na senha.';
  if (username && pw.toLowerCase().includes(String(username).toLowerCase())) return 'A senha não pode conter o nome de usuário.';
  return null;
}

/* ---------- bloqueio por tentativas ---------- */
const fails = new Map(); // chave -> { n, until }
function lockedFor(key) {
  const f = fails.get(key);
  if (!f || !f.until) return 0;
  const ms = f.until - Date.now();
  if (ms <= 0) { fails.delete(key); return 0; }
  return Math.ceil(ms / 60000);
}
function registerFail(key) {
  const f = fails.get(key) || { n: 0, until: 0 };
  f.n += 1;
  // por usuário: 5 erros; por IP: 20 (vários colegas podem sair pelo mesmo IP)
  if (f.n >= (key.startsWith('ip:') ? MAX_FAILS * 4 : MAX_FAILS)) { f.until = Date.now() + LOCK_MINUTES * 60000; f.n = 0; }
  fails.set(key, f);
}
setInterval(() => { const now = Date.now(); for (const [k, f] of fails) if (f.until && f.until < now) fails.delete(k); }, 600000).unref();

/* ---------- cookies ---------- */
function readCookie(req, name) {
  const m = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}
function setSessionCookie(req, res, token, maxAgeSec) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`);
}
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const publicUser = u => ({ id: u.id, username: u.username, name: u.name, role: u.role, roleLabel: ROLE_LABEL[u.role], mustChange: u.must_change });

function setup(app, pool) {
  async function audit(tbl, id, field, oldV, newV, ctx, username) {
    await pool.query('INSERT INTO audit_log (tbl,row_id,field,old_value,new_value,context,username) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [tbl, String(id), field, oldV, newV, ctx, username ?? who()]);
  }

  // Recupera o acesso sem terminal (ex.: Render): se ADMIN_RESET_PASSWORD estiver definido,
  // redefine a senha do usuário admin (ou o cria) ao iniciar. Remova a variável depois de entrar.
  async function resetFromEnv() {
    const pw = (process.env.ADMIN_RESET_PASSWORD || '').trim().replace(/^["']|["']$/g, '');
    if (!pw) return;
    const problem = passwordProblem(pw, 'admin');
    if (problem) { console.log(`ADMIN_RESET_PASSWORD ignorado: ${problem}`); return; }
    const { rows } = await pool.query("SELECT id FROM users WHERE username = 'admin'");
    let id;
    if (rows.length) {
      id = rows[0].id;
      await pool.query("UPDATE users SET password_hash=$1, must_change=true, active=true, role='admin' WHERE id=$2", [hashPassword(pw), id]);
      await pool.query('DELETE FROM sessions WHERE user_id=$1', [id]);
    } else {
      const r = await pool.query("INSERT INTO users (username,name,role,password_hash,must_change) VALUES ('admin','Administrador','admin',$1,true) RETURNING id", [hashPassword(pw)]);
      id = r.rows[0].id;
    }
    fails.delete('u:admin');
    await audit('users', id, 'senha redefinida', null, null, 'Pela variável ADMIN_RESET_PASSWORD', 'servidor');
    console.log('Senha do usuário admin redefinida pela variável ADMIN_RESET_PASSWORD. Entre, troque a senha e remova essa variável do painel.');
  }

  // Cria o primeiro administrador se ainda não houver usuários
  async function bootstrap() {
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM users');
    if (rows[0].n > 0) return resetFromEnv();
    const initial = (process.env.ADMIN_TOKEN || '').trim().replace(/^["']|["']$/g, '');
    const pw = initial || crypto.randomBytes(9).toString('base64').replace(/[+/=]/g, '').slice(0, 12) + '7a';
    await pool.query("INSERT INTO users (username,name,role,password_hash,must_change) VALUES ('admin','Administrador','admin',$1,true)", [hashPassword(pw)]);
    console.log('Usuário inicial criado: admin');
    console.log(initial ? 'Senha inicial: o valor de ADMIN_TOKEN. Troque no primeiro acesso.' : `Senha inicial: ${pw}  (troque no primeiro acesso)`);
    return resetFromEnv();
  }

  // Lê a sessão do cookie em todas as rotas /api
  app.use('/api', async (req, res, next) => {
    const token = readCookie(req, COOKIE);
    if (!token) return als.run({}, next);
    try {
      const { rows } = await pool.query(
        `SELECT s.id AS sid, s.last_seen, u.* FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active`, [sha(token)]);
      const r = rows[0];
      if (r && Date.now() - new Date(r.last_seen).getTime() <= IDLE_MINUTES * 60000) {
        req.user = r; req.sessionId = r.sid;
        pool.query('UPDATE sessions SET last_seen = now() WHERE id = $1', [r.sid]).catch(() => {});
      } else if (r) {
        pool.query('DELETE FROM sessions WHERE id = $1', [r.sid]).catch(() => {});
      }
      als.run({ user: req.user }, next);
    } catch (e) { next(e); }
  });

  // Pedidos que alteram dados precisam deste cabeçalho (proteção contra CSRF)
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.get('x-requested-with') !== 'bts') return res.status(403).json({ error: 'Pedido recusado.' });
    next();
  });

  const OPEN = new Set(['/health', '/auth/login']);
  const DURING_CHANGE = new Set(['/auth/me', '/auth/password', '/auth/logout']);
  app.use('/api', (req, res, next) => {
    if (OPEN.has(req.path)) return next();
    if (!req.user) return res.status(401).json({ error: 'Faça login para continuar.', code: 'login' });
    if (req.user.must_change && !DURING_CHANGE.has(req.path))
      return res.status(403).json({ error: 'Troque sua senha para continuar.', code: 'must_change' });
    next();
  });

  /* ----- rotas de login ----- */
  app.post('/api/auth/login', async (req, res, next) => {
    const username = String(req.body?.username || '').trim().toLowerCase().slice(0, 60);
    const password = String(req.body?.password || '');
    const ip = req.ip || req.socket.remoteAddress || '';
    const keys = [`u:${username}`, `ip:${ip}`];
    const mins = Math.max(...keys.map(lockedFor));
    if (mins) return res.status(429).json({ error: `Muitas tentativas erradas. Tente de novo em ${mins} min.` });
    if (!username || !password) return res.status(400).json({ error: 'Informe usuário e senha.' });
    try {
      const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
      const u = rows[0];
      const ok = verifyPassword(password, u ? u.password_hash : DUMMY_HASH) && u && u.active;
      if (!ok) {
        keys.forEach(registerFail);
        await audit('users', u ? u.id : '-', 'login falhou', null, null, `Usuário "${username}" · IP ${ip}`, username);
        return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
      }
      keys.forEach(k => fails.delete(k));
      const token = crypto.randomBytes(32).toString('base64url');
      await pool.query(`INSERT INTO sessions (user_id, token_hash, expires_at, ip, user_agent)
        VALUES ($1, $2, now() + interval '${SESSION_HOURS} hours', $3, $4)`, [u.id, sha(token), ip, String(req.get('user-agent') || '').slice(0, 200)]);
      await pool.query('UPDATE users SET last_login = now() WHERE id = $1', [u.id]);
      await pool.query("DELETE FROM sessions WHERE expires_at < now() OR last_seen < now() - interval '1 day'");
      await audit('users', u.id, 'login', null, null, `IP ${ip}`, u.username);
      setSessionCookie(req, res, token, SESSION_HOURS * 3600);
      res.json(publicUser(u));
    } catch (e) { next(e); }
  });

  app.post('/api/auth/logout', async (req, res) => {
    if (req.sessionId) await pool.query('DELETE FROM sessions WHERE id = $1', [req.sessionId]).catch(() => {});
    setSessionCookie(req, res, '', 0);
    res.json({ ok: true });
  });

  app.get('/api/auth/me', (req, res) => res.json(publicUser(req.user)));

  app.post('/api/auth/password', async (req, res, next) => {
    const { current, password } = req.body || {};
    if (!verifyPassword(current, req.user.password_hash)) return res.status(400).json({ error: 'A senha atual está incorreta.' });
    const p = passwordProblem(password, req.user.username);
    if (p) return res.status(400).json({ error: p });
    if (verifyPassword(password, req.user.password_hash)) return res.status(400).json({ error: 'A nova senha precisa ser diferente da atual.' });
    try {
      await pool.query('UPDATE users SET password_hash = $1, must_change = false WHERE id = $2', [hashPassword(password), req.user.id]);
      await pool.query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [req.user.id, req.sessionId]); // encerra outros acessos
      await audit('users', req.user.id, 'troca de senha', null, null, 'Senha alterada pelo próprio usuário');
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  /* ----- permissões ----- */
  const requireRole = role => (req, res, next) => {
    if (ROLES.indexOf(req.user?.role) >= ROLES.indexOf(role)) return next();
    res.status(403).json({ error: role === 'admin' ? 'Só administradores podem fazer isso.' : 'Seu perfil é só de leitura.' });
  };

  /* ----- usuários (admin) ----- */
  const admin = requireRole('admin');
  const cleanName = v => String(v || '').trim().slice(0, 100);
  const validUsername = u => /^[a-z0-9._-]{3,40}$/.test(u);

  app.get('/api/users', admin, async (_req, res, next) => {
    try {
      const { rows } = await pool.query(`SELECT u.id, u.username, u.name, u.role, u.active, u.must_change, u.last_login, u.created_at,
          (SELECT count(*)::int FROM sessions s WHERE s.user_id = u.id AND s.expires_at > now()) AS sessions
        FROM users u ORDER BY u.active DESC, lower(u.name), u.username`);
      res.json(rows);
    } catch (e) { next(e); }
  });

  app.post('/api/users', admin, async (req, res, next) => {
    const username = String(req.body?.username || '').trim().toLowerCase();
    const name = cleanName(req.body?.name);
    const role = req.body?.role;
    const password = String(req.body?.password || '');
    if (!validUsername(username)) return res.status(400).json({ error: 'Usuário: 3 a 40 caracteres, só letras minúsculas, números, ponto, hífen ou _.' });
    if (!name) return res.status(400).json({ error: 'Informe o nome da pessoa.' });
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'Perfil inválido.' });
    const p = passwordProblem(password, username); if (p) return res.status(400).json({ error: p });
    try {
      const { rows } = await pool.query('INSERT INTO users (username,name,role,password_hash,must_change) VALUES ($1,$2,$3,$4,true) RETURNING id',
        [username, name, role, hashPassword(password)]);
      await audit('users', rows[0].id, 'cadastro', null, `${username} (${ROLE_LABEL[role]})`, 'Usuário criado');
      res.status(201).json({ ok: true, id: rows[0].id });
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'Esse nome de usuário já existe.' });
      next(e);
    }
  });

  async function otherActiveAdmins(id) {
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM users WHERE role='admin' AND active AND id <> $1", [id]);
    return rows[0].n;
  }

  // PATCH /api/users/:id { name } | { role } | { active } | { password }  (password = redefinir, pede troca no próximo acesso)
  app.patch('/api/users/:id', admin, async (req, res, next) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    try {
      const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
      const u = rows[0];
      if (!u) return res.status(404).json({ error: 'Usuário não encontrado.' });
      const self = id === req.user.id;
      if ('name' in b) {
        const name = cleanName(b.name); if (!name) return res.status(400).json({ error: 'Informe o nome.' });
        await pool.query('UPDATE users SET name=$1 WHERE id=$2', [name, id]);
        await audit('users', id, 'nome', u.name, name, `Usuário ${u.username}`);
      }
      if ('role' in b) {
        if (!ROLES.includes(b.role)) return res.status(400).json({ error: 'Perfil inválido.' });
        if (u.role === 'admin' && b.role !== 'admin' && !(await otherActiveAdmins(id)))
          return res.status(400).json({ error: 'Precisa existir pelo menos um administrador ativo.' });
        await pool.query('UPDATE users SET role=$1 WHERE id=$2', [b.role, id]);
        await audit('users', id, 'perfil', ROLE_LABEL[u.role], ROLE_LABEL[b.role], `Usuário ${u.username}`);
      }
      if ('active' in b) {
        const active = Boolean(b.active);
        if (!active && self) return res.status(400).json({ error: 'Você não pode desativar o próprio usuário.' });
        if (!active && u.role === 'admin' && !(await otherActiveAdmins(id)))
          return res.status(400).json({ error: 'Precisa existir pelo menos um administrador ativo.' });
        await pool.query('UPDATE users SET active=$1 WHERE id=$2', [active, id]);
        if (!active) await pool.query('DELETE FROM sessions WHERE user_id=$1', [id]);
        await audit('users', id, active ? 'reativado' : 'desativado', null, null, `Usuário ${u.username}`);
      }
      if ('password' in b) {
        const p = passwordProblem(b.password, u.username); if (p) return res.status(400).json({ error: p });
        await pool.query('UPDATE users SET password_hash=$1, must_change=$2 WHERE id=$3', [hashPassword(b.password), !self, id]);
        if (!self) await pool.query('DELETE FROM sessions WHERE user_id=$1', [id]);
        await audit('users', id, 'senha redefinida', null, null, `Usuário ${u.username}`);
      }
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  app.delete('/api/users/:id', admin, async (req, res, next) => {
    const id = Number(req.params.id);
    if (id === req.user.id) return res.status(400).json({ error: 'Você não pode excluir o próprio usuário.' });
    try {
      const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [id]);
      if (!rows.length) return res.status(404).json({ error: 'Usuário não encontrado.' });
      if (rows[0].role === 'admin' && !(await otherActiveAdmins(id)))
        return res.status(400).json({ error: 'Precisa existir pelo menos um administrador ativo.' });
      await pool.query('DELETE FROM users WHERE id=$1', [id]);
      await audit('users', id, 'exclusão', rows[0].username, null, 'Usuário excluído');
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  return { requireRole, bootstrap, audit };
}

module.exports = { setup, hashPassword, verifyPassword, passwordProblem, who, ROLES };
