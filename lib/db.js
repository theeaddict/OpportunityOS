import pg from 'pg';

// ---------------------------------------------------------------------------
// PostgreSQL-backed drop-in for the mysql2/promise pool used by the rest of
// the app. Reads PG_DATABASE_URL (postgres://...). DATABASE_URL (MariaDB) is
// deliberately left untouched so rolling back is a one-line env change.
//
// The rest of the codebase speaks mysql2:
//   * `?` positional placeholders
//   * ON DUPLICATE KEY UPDATE ... VALUES(col)
//   * DATE_ADD/DATEDIFF/TIMESTAMPDIFF/JSON_EXTRACT/IF()/CONCAT()/FIELD()
//   * backtick-quoted identifiers   `key`
//   * INSERT IGNORE INTO
//   * SELECT → rows array; INSERT/UPDATE/DELETE → { insertId, affectedRows }
//   * getConnection() with beginTransaction/commit/rollback/release
//      (scheduler, job queue)
//
// This shim translates statements and remaps results so those callers work
// against PostgreSQL unchanged.
// ---------------------------------------------------------------------------

const { Pool, types } = pg;

const INT8_OID = 20;
const DATE_OID = 1082;
const TIMESTAMP_OID = 1114;
const TIMESTAMPTZ_OID = 1184;
const NUMERIC_OID = 1700;

// PG returns BIGINT/DECIMAL as strings by default; mysql2 (decimalNumbers:true)
// returns numbers. Interactions like `id1 !== id2` and self-test comparisons on
// numeric columns are strict — parity requires JS numbers.
types.setTypeParser(INT8_OID, (v) => (v === null ? null : Number(v)));
types.setTypeParser(NUMERIC_OID, (v) => (v === null ? null : Number(v)));

// mysql2 with dateStrings:true returns wall-clock strings ('YYYY-MM-DD HH:MM:SS'
// for timestamps, 'YYYY-MM-DD' for dates). UI code slices String(col).slice(0,10),
// so mirror that instead of PG's Date objects.
const pad2 = (n) => String(n).padStart(2, '0');
// mysql2 with dateStrings:true returns the stored wall-clock string as-is.
// PG naive timestamps (TIMESTAMP_OID) come back as 'YYYY-MM-DD HH:MM:SS[.ms]'
// (slice below). Timestamptz results must ALSO be rendered in UTC wall-clock so
// they stay in parity with the MariaDB storage (all timestamps are UTC):
// format the ISO string, not the host-local Date getters.
const formatTs = (v) => v.slice(0, 19).replace('T', ' ');
types.setTypeParser(DATE_OID, (v) => (v === null ? null : v.slice(0, 10)));
types.setTypeParser(TIMESTAMP_OID, (v) => (v === null ? null : v.slice(0, 19)));
types.setTypeParser(TIMESTAMPTZ_OID, (v) => (v === null ? null : formatTs(v)));

// Per-table unique constraints that serve as the PG ON CONFLICT arbiter.
// Must match the uniques created by db/migrations.
const CONFLICT_TARGETS = {
  account_usage: 'account_id, period',
  owner_profiles: 'user_id',
  opportunity_assumptions: 'opportunity_id, assumption_name',
  business_sources: 'business_id, source_name, external_identifier',
  app_settings: 'account_id, "key"',
  opportunity_evidence: 'opportunity_id, evidence_id',
  opportunity_solutions: 'opportunity_id, solution_id',
  user_capabilities: 'user_id',
  solutions: 'account_id, slug',
};

// Tables whose primary key is NOT a single auto-increment `id` column — appending
// `RETURNING id` to their INSERTs would error.
const NO_AUTO_ID = new Set([
  'schema_migrations',
  'sessions',
  'app_settings',
  'account_usage',
  'billing_plans',
  'platform_settings',
]);

// ---------------------------------------------------------------------------
// SQL translation
// ---------------------------------------------------------------------------

function convertPlaceholders(sql) {
  let out = '';
  let n = 0;
  let inStr = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (inStr) {
      out += ch;
      if (ch === "'") {
        if (sql[i + 1] === "'") {
          out += "'";
          i++;
        } else {
          inStr = false;
        }
      }
      continue;
    }
    if (ch === "'") {
      inStr = true;
      out += ch;
      continue;
    }
    if (ch === '?') {
      out += `$${++n}`;
      continue;
    }
    out += ch;
  }
  return out;
}

function findMatchingParen(s, openIndex) {
  let depth = 0;
  let inStr = false;
  for (let i = openIndex; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === "'") inStr = false;
      continue;
    }
    if (ch === "'") {
      inStr = true;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTopLevel(inner) {
  const args = [];
  let depth = 0;
  let inStr = false;
  let cur = '';
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (inStr) {
      cur += ch;
      if (ch === "'") inStr = false;
      continue;
    }
    if (ch === "'") {
      inStr = true;
      cur += ch;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      args.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) args.push(cur);
  return args;
}

// IF(cond, a, b) -> CASE WHEN cond THEN a ELSE b END
function rewriteIf(sql) {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === 'I' && sql[i + 1] === 'F' && sql[i + 2] === '(') {
      const prev = i > 0 ? sql[i - 1] : '';
      if (!/[A-Za-z0-9_]/.test(prev)) {
        const close = findMatchingParen(sql, i + 2);
        if (close !== -1) {
          const args = splitTopLevel(sql.slice(i + 3, close));
          if (args.length === 3) {
            out += `CASE WHEN ${args[0].trim()} THEN ${args[1].trim()} ELSE ${args[2].trim()} END`;
            i = close + 1;
            continue;
          }
        }
      }
    }
    out += ch;
    i++;
  }
  return out;
}

// CONCAT(a, b, ...) -> (a || b || ...) — || propagates NULL exactly like MySQL's
// CONCAT. Only used for the capability-gate note line.
function rewriteConcat(sql) {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (sql.slice(i, i + 7).toUpperCase() === 'CONCAT(') {
      const close = findMatchingParen(sql, i + 6);
      if (close !== -1) {
        const args = splitTopLevel(sql.slice(i + 7, close));
        if (args.length) {
          out += `(${args.map((a) => a.trim()).join(' || ')})`;
          i = close + 1;
          continue;
        }
      }
    }
    out += ch;
    i++;
  }
  return out;
}

// ORDER BY FIELD(x, 'a','b','c') -> ORDER BY CASE x WHEN 'a' THEN 1 ... END
function rewriteFieldOrder(sql) {
  const idx = sql.search(/\bORDER\s+BY\s+FIELD\s*\(/i);
  if (idx === -1) return sql;
  const open = sql.indexOf('(', idx);
  const close = findMatchingParen(sql, open);
  if (close === -1) return sql;
  const inner = sql.slice(open + 1, close);
  const parts = splitTopLevel(inner);
  const [colExpr, ...values] = parts;
  if (!colExpr) return sql;
  const whens = values.map((v, k) => `WHEN ${v.trim()} THEN ${k + 1}`).join(' ');
  const then = `CASE ${colExpr.trim()} ${whens} ELSE ${values.length + 1} END`;
  return sql.slice(0, idx + 9) + then + sql.slice(close + 1);
}

function rewriteInsertIgnore(sql) {
  if (!/\bINSERT\s+IGNORE\s+INTO\b/i.test(sql)) return sql;
  return (
    sql.replace(/\bINSERT\s+IGNORE\s+INTO\b/i, 'INSERT INTO').replace(/;\s*$/, '') +
    ' ON CONFLICT DO NOTHING'
  );
}

function rewriteOnDuplicate(sql) {
  const match = sql.match(/\bINSERT\s+INTO\s+"?([A-Za-z0-9_]+)"?\b/i);
  const idx = sql.search(/\bON\s+DUPLICATE\s+KEY\s+UPDATE\b/i);
  if (idx === -1) return sql;
  const table = match ? match[1].toLowerCase() : '';
  const target = CONFLICT_TARGETS[table];
  if (!target) throw new Error(`db shim: no ON CONFLICT target for table "${table}"`);
  const head = sql.slice(0, idx);
  const tail = sql
    .slice(idx)
    .replace(/\bON\s+DUPLICATE\s+KEY\s+UPDATE\b/i, `ON CONFLICT (${target}) DO UPDATE SET`);
  const setMatch = tail.match(/^([\s\S]*?\bDO\s+UPDATE\s+SET\b)([\s\S]*)$/i);
  if (!setMatch) return head + tail;
  // PG treats a bare column reference on the RHS of DO UPDATE SET as ambiguous
  // with EXCLUDED — qualify self-referential columns with the table name:
  //   researches_used = researches_used + EXCLUDED.researches_used
  // -> researches_used = account_usage.researches_used + EXCLUDED.researches_used
  const segs = [];
  for (const seg of splitTopLevel(setMatch[2])) {
    const m = seg.match(/^(\s*(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*))\s*=\s*([\s\S]*)$/);
    if (!m) {
      segs.push(seg);
      continue;
    }
    const lhs = m[1].trim();
    const lhsEsc = lhs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rhs = m[2]
      .replace(/VALUES\(\s*("?[A-Za-z0-9_.]+"?)\s*\)/g, 'EXCLUDED.$1')
      .replace(new RegExp(`(?<![.\\w])${lhsEsc}(?!\\w)`, 'g'), `${table}.${lhs}`);
    segs.push(`${m[1]} = ${rhs}`);
  }
  return head + setMatch[1] + segs.join(', ');
}

function maybeAppendReturningId(sql) {
  if (!/^\s*INSERT\b/i.test(sql)) return sql;
  const match = sql.match(/\bINSERT\s+INTO\s+"?([A-Za-z0-9_]+)"?\b/i);
  if (!match || NO_AUTO_ID.has(match[1].toLowerCase())) return sql;
  if (/\bRETURNING\b/i.test(sql)) return sql;
  return sql.replace(/\s*;\s*$/, '') + ' RETURNING id';
}

function translateStatement(sql) {
  let s = sql.replace(/`/g, '"'); // backtick identifiers -> PG double quotes
  s = convertPlaceholders(s); // ? -> $1..$n (respects string literals)
  s = s.replace(
    /DATE_ADD\(\s*NOW\(\)\s*,\s*INTERVAL\s+(\$\d+)\s+DAY\s*\)/gi,
    'NOW() + ($1 * INTERVAL \'1 day\')'
  );
  s = s.replace(
    /DATEDIFF\(\s*([\w.$]+)\s*,\s*([\w.$]+)\s*\)/gi,
    '(($1)::date - ($2)::date)'
  );
  s = s.replace(
    /TIMESTAMPDIFF\(\s*SECOND\s*,\s*([\w.$]+)\s*,\s*([\w.$]+)\s*\)/gi,
    'EXTRACT(EPOCH FROM (($2) - ($1)))::int'
  );
  s = s.replace(
    /JSON_EXTRACT\(\s*([\w.$]+)\s*,\s*'\$\.(\w+)'\s*\)\s*=\s*([01])/gi,
    (m, col, key, bit) => `((${col}) ->> '${key}')::boolean = ${bit === '1' ? 'true' : 'false'}`
  );
  s = rewriteIf(s);
  s = rewriteConcat(s);
  s = rewriteFieldOrder(s);
  s = rewriteInsertIgnore(s);
  s = rewriteOnDuplicate(s);
  s = maybeAppendReturningId(s);
  return s;
}

// ---------------------------------------------------------------------------
// Execution + result-shape mapping (mysql2 contract)
// ---------------------------------------------------------------------------

async function runOn(target, sql, params = []) {
  const text = translateStatement(sql);
  // node-pg serializes JS Date params as local-time-with-offset; next_run_at /
  // created_at / etc. are stored as UTC naive timestamps, so writing local+offset
  // shifts scheduled times by the host TZ (e.g. +3h). Send UTC wall-clock strings
  // instead — parity with the MariaDB storage regardless of the server's TZ.
  const values = params.map((p) =>
    p instanceof Date ? p.toISOString().slice(0, 19).replace('T', ' ') : p
  );
  const res = await target.query({ text, values });
  if (/^\s*(SELECT|WITH|VALUES|SHOW|EXPLAIN)\b/i.test(text)) return res.rows;
  const isInsert = /^\s*INSERT\b/i.test(text);
  const hasReturning = isInsert && /\bRETURNING\b/i.test(text);
  return {
    insertId: hasReturning && res.rows && res.rows[0] ? Number(res.rows[0].id) : 0,
    affectedRows: Number(res.rowCount ?? 0),
    fieldCount: 0,
  };
}

class PgCompatConn {
  constructor(client) {
    this._client = client;
  }
  async beginTransaction() {
    await this._client.query('BEGIN');
  }
  async commit() {
    await this._client.query('COMMIT');
  }
  async rollback() {
    await this._client.query('ROLLBACK');
  }
  release() {
    this._client.release();
  }
  async execute(sql, params) {
    return [await runOn(this._client, sql, params)];
  }
  async query(sql, params) {
    return [await runOn(this._client, sql, params)];
  }
}

class PgCompatPool {
  constructor(pool) {
    this._pool = pool;
  }
  async execute(sql, params) {
    return [await runOn(this._pool, sql, params)];
  }
  async query(sql, params) {
    return [await runOn(this._pool, sql, params)];
  }
  async getConnection() {
    const client = await this._pool.connect();
    return new PgCompatConn(client);
  }
  async end() {
    return this._pool.end();
  }
}

let pool;

export function getPool() {
  if (!pool) {
    const url =
      process.env.PG_DATABASE_URL ||
      (process.env.DATABASE_URL && /^postgres(ql)?:\/\//i.test(process.env.DATABASE_URL)
        ? process.env.DATABASE_URL
        : '');
    if (!url) {
      throw new Error(
        'No PostgreSQL URL configured. Set PG_DATABASE_URL (postgres://user:pass@host:port/db) ' +
          'to run against PostgreSQL. DATABASE_URL is left as the MariaDB fallback.'
      );
    }
    pool = new PgCompatPool(
      new Pool({
        connectionString: url,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      })
    );
  }
  return pool;
}

export async function query(sql, params = []) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}

// For statements without placeholders where execute() would reject (rare).
export async function rawQuery(sql) {
  const [rows] = await getPool().query(sql);
  return rows;
}

export async function insert(sql, params = []) {
  const result = await query(sql, params);
  return result.insertId;
}

// MySQL JSON columns come back as strings in some drivers — normalize here.
export function parseJson(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}