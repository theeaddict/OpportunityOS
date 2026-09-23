require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');

function configFromEnv() {
  if (process.env.DATABASE_URL) return { connectionString: process.env.DATABASE_URL };
  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env;
  if (!DB_USER || !DB_NAME) {
    console.error('Missing DATABASE_URL or DB_* variables. See .env.example');
    process.exit(1);
  }
  return {
    host: DB_HOST || 'localhost',
    port: Number(DB_PORT || 5432),
    user: DB_USER,
    password: DB_PASSWORD || '',
    database: DB_NAME,
  };
}

async function ensureDatabase(cfg) {
  // Create the database itself if missing (needs a connection to a maintenance DB).
  const dbName = cfg.database
    || (process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).pathname.replace(/^\//, '') : null);
  if (!dbName) throw new Error('No database name configured');

  const bare = { ...cfg };
  delete bare.database;
  delete bare.connectionString;

  let maint = { host: 'localhost', port: 5432, user: 'root', password: '' };
  if (process.env.DATABASE_URL) {
    const u = new URL(process.env.DATABASE_URL);
    maint = {
      host: u.hostname || 'localhost',
      port: Number(u.port || 5432),
      user: decodeURIComponent(u.username || 'root'),
      password: decodeURIComponent(u.password || ''),
      database: u.pathname ? 'postgres' : undefined,
    };
  } else {
    maint = { ...bare, database: 'postgres', user: bare.user || 'root' };
  }

  const conn0 = new Client(maint);
  await conn0.connect();
  const exists = await conn0.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (exists.rowCount === 0) {
    // CREATE DATABASE cannot run inside a transaction block; escape the name.
    await conn0.query(`CREATE DATABASE "${dbName.replace(/"/g, '')}"`);
  }
  await conn0.end();
}

async function reconcileSequences(conn) {
  // Some migrations seed rows with explicit ids (e.g. accounts id=1). PG
  // serial sequences are not advanced by explicit-id inserts (unlike MariaDB's
  // AUTO_INCREMENT), so a fresh install would hand out the seeded ids again on
  // the next implicit insert. Rewind every id sequence to the current max.
  const tables = await conn.query(
    `SELECT c.relname AS tablename
       FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'id'
      WHERE c.relkind = 'r' AND n.nspname = 'public'
      ORDER BY c.relname`
  );
  let fixed = 0;
  for (const { tablename } of tables.rows) {
    const seqRes = await conn.query(
      'SELECT pg_get_serial_sequence($1, $2) AS seq',
      [`public.${tablename}`, 'id']
    );
    const seq = seqRes.rows[0] && seqRes.rows[0].seq;
    if (!seq) continue;
    const max = await conn.query(`SELECT MAX(id) AS m FROM "${tablename}"`);
    if (max.rows[0].m == null) continue;
    await conn.query(`SELECT setval($1, MAX(id)) FROM "${tablename}"`, [seq]);
    fixed++;
  }
  if (fixed) console.log(`${fixed} table sequence(s) reconciled.`);
}

async function main() {
  const cfg = configFromEnv();
  await ensureDatabase(cfg);

  const conn = new Client(cfg);
  await conn.connect();
  await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    migration VARCHAR(100) PRIMARY KEY,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const applied = await conn.query('SELECT migration FROM schema_migrations');
  const appliedSet = new Set(applied.rows.map((r) => r.migration));

  let ran = 0;
  for (const file of files) {
    if (appliedSet.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    process.stdout.write(`Applying ${file}… `);
    try {
      await conn.query('BEGIN');
      await conn.query(sql);
      await conn.query('INSERT INTO schema_migrations (migration) VALUES ($1)', [file]);
      await conn.query('COMMIT');
      console.log('ok');
      ran++;
    } catch (err) {
      await conn.query('ROLLBACK');
      console.error(`FAILED: ${err.message}`);
      console.error(`  in ${file} at:`, err.position ? JSON.stringify(sql.slice(Math.max(0, err.position - 80), err.position + 80)) : '');
      process.exit(1);
    }
  }
  console.log(ran ? `${ran} migration(s) applied.` : 'Already up to date.');
  await reconcileSequences(conn);
  await conn.end();
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});