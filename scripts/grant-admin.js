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
  const password = process.argv[3] || process.env.SEED_ADMIN_PASSWORD || 'opportunityos';
  if (!email) {
    console.error('Usage: node scripts/grant-admin.js <email> [password]');
    process.exit(1);
  }

  const conn = process.env.DATABASE_URL
    ? new Client({ connectionString: process.env.DATABASE_URL })
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