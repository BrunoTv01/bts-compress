// Redefine a senha de um usuário direto no banco (para quando ninguém consegue entrar).
// Uso no servidor:  sudo /opt/bts-compress/deploy/reset-senha.sh            (volta o admin para a senha padrão "admin")
//                   sudo /opt/bts-compress/deploy/reset-senha.sh maria Prov1234
const pg = require('pg');
const { hashPassword, passwordProblem, DEFAULT_PASSWORD } = require('../auth');

const username = process.argv[2] || 'admin';
let password = process.argv[3];
if (!password) password = DEFAULT_PASSWORD; // senha padrão; a troca é exigida no próximo acesso
else { const problem = passwordProblem(password, username); if (problem) { console.error(problem); process.exit(1); } }

const { resolveDatabaseUrl, sslOpt } = require('../db/connect');
let pool;
(async () => {
  const { url } = await resolveDatabaseUrl();
  pool = new pg.Pool({ connectionString: url, ssl: sslOpt() });
  const u = username.trim().toLowerCase();
  const { rows } = await pool.query('SELECT id FROM users WHERE username = $1', [u]);
  if (rows.length) {
    await pool.query('UPDATE users SET password_hash=$1, must_change=true, active=true WHERE id=$2', [hashPassword(password), rows[0].id]);
    await pool.query('DELETE FROM sessions WHERE user_id=$1', [rows[0].id]);
    console.log(`Senha de "${u}" redefinida para "${password}". Será pedida uma senha nova no próximo acesso.`);
  } else {
    await pool.query("INSERT INTO users (username,name,role,password_hash,must_change) VALUES ($1,$1,'admin',$2,true)", [u, hashPassword(password)]);
    console.log(`Usuário "${u}" não existia e foi criado como Admin.`);
  }
  await pool.query("INSERT INTO audit_log (tbl,row_id,field,context,username) VALUES ('users',$1,'senha redefinida','Pelo terminal do servidor','servidor')", [u]);
  await pool.end?.();
})().catch(e => { console.error('Erro:', e.message); process.exit(1); });
