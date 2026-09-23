require('dotenv').config();
const crypto = require('crypto');
const { Client } = require('pg');
const { spawnSync } = require('child_process');

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `$scrypt$N=16384$r=8$p=1$${salt.toString('base64')}$${hash.toString('base64')}`;
}

async function configFromEnv() {
  const cfg = process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT || 5432),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME,
      };
  const c = new Client(cfg);
  await c.connect();
  return c;
}

async function main() {
  // 1. Apply migrations (creates database if needed)
  const mig = spawnSync('node', [require('path').join(__dirname, 'migrate.js')], { stdio: 'inherit' });
  if (mig.status !== 0) process.exit(1);

  // 2. Ensure the admin account exists with a real scrypt password hash
  const conn = await configFromEnv();
  const defaultPassword = process.env.SEED_ADMIN_PASSWORD || 'opportunityos';
  await conn.query(
    `INSERT INTO users (name, email, password_hash, role, account_id, is_superadmin)
     VALUES ('Administrator', 'admin@example.com', $1, 'owner', 1, TRUE)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, status = 'active', is_superadmin = TRUE`,
    [hashPassword(defaultPassword)]
  );
  console.log(`Admin login: admin@example.com / ${defaultPassword} (change it after first login)`);
  await conn.end();
}

main().catch((err) => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});