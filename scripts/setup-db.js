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
  // The platform administrator is a SEPARATE identity (admin_users) with its
  // own sign-in at /admin/login — seeding it alongside the tenant bootstrap
  // user keeps both surfaces ready with the same default credentials.
  await conn.query(
    `INSERT INTO admin_users (name, email, password_hash)
     VALUES ('Administrator', 'admin@example.com', $1)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_active = TRUE`,
    [hashPassword(defaultPassword)]
  );
  console.log(`Admin login (tenant): admin@example.com / ${defaultPassword}`);
  console.log(`Admin login (control room): admin@example.com / ${defaultPassword} (URL /admin/login)`);
  await conn.end();
}

main().catch((err) => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});