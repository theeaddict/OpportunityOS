// grant-admin.js — one-time seed: creates (or revives) a whole-system
// platform administrator in the SEPARATE admin_users table. This is the ONLY
// supported way to grant the control-room role besides editing the DB
// directly; it is never reachable from the application (there is no
// self-signup for administrators).
//
// Usage: node scripts/grant-admin.js <email> [password]
// Idempotent: safe to re-run (re-hashes the password each run).
require('dotenv').config();
const crypto = require('crypto');
const { Client } = require('pg');

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `$scrypt$N=16384$r=8$p=1$${salt.toString('base64')}$${hash.toString('base64')}`;
}

async function main() {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  // No published-default fallback: the operator must supply a password, so a
  // grant can never reintroduce known credentials (default-password finding).
  const password = process.argv[3] || process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    console.error('Usage: node scripts/grant-admin.js <email> <password>');
    console.error('  (or set SEED_ADMIN_PASSWORD instead of passing the password as an argument)');
    process.exit(1);
  }

  // Same precedence as lib/db.js: PG_DATABASE_URL first; DATABASE_URL is only
  // a valid Postgres target when it's actually a postgres:// URL.
  const pgUrl = process.env.PG_DATABASE_URL
    || (process.env.DATABASE_URL && /^postgres(ql)?:\/\//i.test(process.env.DATABASE_URL) ? process.env.DATABASE_URL : null);
  const conn = pgUrl
    ? new Client({ connectionString: pgUrl })
    : new Client({
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT || 5432),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME,
      });
  await conn.connect();

  await conn.query(
    `INSERT INTO admin_users (name, email, password_hash, is_active)
     VALUES ($1, $2, $3, TRUE)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_active = TRUE, updated_at = NOW()`,
    ['Platform administrator', email, hashPassword(password)]
  );
  console.log(`Platform admin granted/updated: ${email} (control room at /admin/login)`);
  await conn.end();
}

main().catch((err) => {
  console.error('grant-admin failed:', err.message);
  process.exit(1);
});