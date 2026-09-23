// grant-superadmin.js — one-time seed: marks a user as a platform
// superadmin. This is the ONLY supported way to grant the role besides
// editing the DB directly; it is never reachable from the application.
//
// Usage: node scripts/grant-superadmin.js <email-or-id>
// Idempotent: safe to re-run.
require('dotenv').config();
const { Client } = require('pg');

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: node scripts/grant-superadmin.js <email-or-id>');
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

  const numeric = /^\d+$/.test(target) ? Number(target) : null;
  const res = await conn.query(
    `UPDATE users SET is_superadmin = TRUE
      WHERE is_superadmin = FALSE AND (email = $1 OR id = $2)`,
    [target, numeric]
  );

  if (res.rowCount === 0) {
    const existing = await conn.query(
      `SELECT id, email, name, role, account_id, is_superadmin FROM users WHERE email = $1 OR id = $2`,
      [target, numeric]
    );
    if (existing.rowCount === 0) {
      console.error(`No user found for "${target}". Nothing changed.`);
      process.exit(1);
    }
    console.log(
      `User ${existing.rows[0].email} (id ${existing.rows[0].id}) is already a superadmin (is_superadmin=${existing.rows[0].is_superadmin}). Nothing changed.`
    );
    process.exit(0);
  }

  console.log(`Superadmin granted to "${target}".`);
  await conn.end();
}

main().catch((err) => {
  console.error('grant-superadmin failed:', err.message);
  process.exit(1);
});