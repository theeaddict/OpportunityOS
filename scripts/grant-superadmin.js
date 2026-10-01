// grant-superadmin.js — DEPRECATED. Marks a user in `users` as
// `is_superadmin`, the legacy (migration 026) control-room gate. Since the
// whole-system control room moved to the separate `admin_users` identity
// (migration 028) in STAGE 7, `users.is_superadmin` is no longer honored by
// `/admin/*` or `/api/admin/*`. Use `node scripts/grant-admin.js <email>` to
// grant/update a platform administrator instead.
//
// Kept only for plan parity with the old flag; it no longer unlocks the
// control room.
//
// Usage: node scripts/grant-superadmin.js <email-or-id>
// Idempotent: safe to re-run.
require('dotenv').config();
const { Client } = require('pg');

async function main() {
  console.warn(
    '[deprecated] grant-superadmin.js sets the legacy is_superadmin flag, which the control room no longer honors. Use `node scripts/grant-admin.js <email>` instead.'
  );
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: node scripts/grant-superadmin.js <email-or-id>');
    process.exit(1);
  }

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