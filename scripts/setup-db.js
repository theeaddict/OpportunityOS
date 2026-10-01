require('dotenv').config();
const crypto = require('crypto');
const { Client } = require('pg');
const { spawnSync } = require('child_process');

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `$scrypt$N=16384$r=8$p=1$${salt.toString('base64')}$${hash.toString('base64')}`;
}

// Same precedence as lib/db.js and scripts/migrate.js: PG_DATABASE_URL first;
// DATABASE_URL is only a valid Postgres target when it's a postgres:// URL
// (otherwise it's the MariaDB fallback DSN from .env.example).
function resolvePgUrl() {
  if (process.env.PG_DATABASE_URL) return process.env.PG_DATABASE_URL;
  if (process.env.DATABASE_URL && /^postgres(ql)?:\/\//i.test(process.env.DATABASE_URL)) {
    return process.env.DATABASE_URL;
  }
  return null;
}

async function configFromEnv() {
  const url = resolvePgUrl();
  const cfg = url
    ? { connectionString: url }
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

  // 2. Ensure the admin account exists with a real scrypt password hash.
  // The seed password MUST come from the operator — refusing to fall back to a
  // published default means a fresh deployment can never ship with known
  // credentials (default-password finding).
  const defaultPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!defaultPassword) {
    console.error(
      'SEED_ADMIN_PASSWORD is required. Set it to a strong password for the ' +
      'seeded admin@example.com account (tenant + control room).'
    );
    process.exit(1);
  }
  const conn = await configFromEnv();
  await conn.query(
    `INSERT INTO users (name, email, password_hash, role, account_id, is_superadmin, email_verified_at)
     VALUES ('Administrator', 'admin@example.com', $1, 'owner', 1, TRUE, NOW())
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, status = 'active', is_superadmin = TRUE,
       email_verified_at = COALESCE(users.email_verified_at, NOW())`,
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
  console.log('Admin accounts seeded: admin@example.com (tenant + control room).');
  console.log('Password is taken from SEED_ADMIN_PASSWORD and is never printed.');
  await conn.end();
}

main().catch((err) => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});