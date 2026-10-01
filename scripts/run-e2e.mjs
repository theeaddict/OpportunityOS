/**
 * E2E orchestrator for OpportunityOS.
 *
 * Starts:
 *   1. mock-ai (http://127.0.0.1:4321 or MOCK_AI_PORT)
 *   2. mock-research (http://127.0.0.1:4322 or MOCK_RESEARCH_PORT)
 *   3. mock-discovery (http://127.0.0.1:4323 or MOCK_DISCOVERY_PORT)
 *   4. mock-stripe (http://127.0.0.1:4324 or MOCK_STRIPE_PORT) — real Stripe API
 *      shape for Checkout/Portal sessions, plus /ctl endpoints the suite uses
 *      to simulate a completed checkout or a cancelled subscription by firing
 *      a correctly-signed webhook straight at the app
 *   5. `next dev` on E2E_APP_PORT (default 3100) with the app pointed at the
 *      mocks (AI_API_KEY/AI_MODEL/AI_BASE_URL, RESEARCH_PROVIDER=http,
 *      DISCOVERY_API_URL, STRIPE_API_BASE_URL/STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET)
 *
 * then runs `node --test test/` (with the @/ alias loader registered, so
 * pure-unit test files can import app source directly — see
 * scripts/app-alias-loader.mjs) and tears everything down.
 *
 * The E2E app server must run in dev mode: the session cookie is marked
 * `secure` only in production, so `next start` over plain http would drop the
 * auth cookie and break every request here.
 *
 * Run:              npm test
 * Port occupied?    set E2E_APP_PORT, or E2E_FORCE_PORT=1 to free it
 * Environment:      DATABASE_URL is read from .env (or the shell) and passed
 *                   through; the tests also get the E2E_* URLs and mock ports.
 */

import dotenv from 'dotenv';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

// ---------------------------------------------------------------------------
// Isolated database for this run
// ---------------------------------------------------------------------------
// The app under test starts its own background worker + scheduler, but so does
// ANY other server connected to the same database (e.g. a `next dev` left
// running). A foreign worker racing our jobs claims them and "completes" them
// in a process without the e2e mock URLs (DISCOVERY_API_URL & co.) — which
// produces exactly the 0-result flakes we chased. Give each run a private,
// freshly-migrated database so nothing can interfere.
async function prepareIsolatedDb(basePgUrl) {
  const { default: pg } = await import('pg');
  const u = new URL(basePgUrl);
  const db = (u.pathname || '/').replace(/^\//, '') || 'opportunityos';
  const e2eName = `${db}_e2e`;
  const e2eUrl = new URL(u);
  e2eUrl.pathname = `/${e2eName}`;

  const maintUrl = new URL(u);
  maintUrl.pathname = '/postgres';
  const sys = new pg.Client({ connectionString: maintUrl.toString() });
  await sys.connect();
  await sys.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [e2eName]).catch(() => {});
  await sys.query(`DROP DATABASE IF EXISTS "${e2eName}"`);
  await sys.query(`CREATE DATABASE "${e2eName}"`);
  await sys.end();

  console.log(`[e2e] isolated database ready: ${e2eName}`);
  // Migrations + the seeded admin account (self-test / token fixtures depend on it).
  const migrated = await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(here, 'setup-db.js')], {
      env: {
        ...process.env,
        DATABASE_URL: e2eUrl.toString(),
        PG_DATABASE_URL: e2eUrl.toString(),
        // setup-db hard-fails without an explicit seed password (no published
        // default); the suite's admin fixtures log in with this literal.
        SEED_ADMIN_PASSWORD: 'opportunityos',
      },
      cwd: root,
      stdio: 'inherit',
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
  if (migrated !== 0) {
    console.error('[e2e] migration of the isolated database failed');
    process.exit(1);
  }
  return e2eUrl.toString();
}

const AI_PORT = Number(process.env.MOCK_AI_PORT || 4321);
const RESEARCH_PORT = Number(process.env.MOCK_RESEARCH_PORT || 4322);
const DISCOVERY_PORT = Number(process.env.MOCK_DISCOVERY_PORT || 4323);
const STRIPE_PORT = Number(process.env.MOCK_STRIPE_PORT || 4324);
const APP_PORT = Number(process.env.E2E_APP_PORT || 3100);
const APP_BASE_URL = `http://127.0.0.1:${APP_PORT}`;
const AI_URL = `http://127.0.0.1:${AI_PORT}`;
const RESEARCH_URL = `http://127.0.0.1:${RESEARCH_PORT}`;
const DISCOVERY_URL = `http://127.0.0.1:${DISCOVERY_PORT}`;
const STRIPE_URL = `http://127.0.0.1:${STRIPE_PORT}`;
const STRIPE_WEBHOOK_SECRET = 'whsec_e2e_mock_secret';
const FORCE_PORT = process.env.E2E_FORCE_PORT === '1';
const SUITE_TIMEOUT = Number(process.env.E2E_TIMEOUT_MS || 600_000);
const LOG_DIR = process.env.E2E_LOG_DIR || '/tmp/oos-e2e';
// Outgoing email (password reset / verification) is written here as JSON files
// instead of being sent, so tests can read their links. Wiped each run.
const MAIL_DIR = path.join(LOG_DIR, 'mail');

fs.mkdirSync(LOG_DIR, { recursive: true });

const children = [];
function spawnChild(label, cmd, args, env, logName) {
  const logStream = fs.createWriteStream(path.join(LOG_DIR, logName), { flags: 'a' });
  const child = spawn(cmd, args, { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout?.pipe(logStream);
  child.stderr?.pipe(logStream);
  children.push({ label, child, logStream });
  return child;
}

function killAll(graceMs = 2000) {
  for (const { label, child } of children.reverse()) {
    try { child.kill('SIGTERM'); } catch { /* noop */ }
  }
  const deadline = Date.now() + graceMs;
  const timer = setInterval(() => {
    const alive = children.filter((c) => c.child.exitCode == null);
    if (!alive.length || Date.now() > deadline) {
      for (const c of alive) { try { c.child.kill('SIGKILL'); } catch { /* noop */ } }
      clearInterval(timer);
    }
  }, 100);
}

async function fetchOk(url, timeoutMs = 4000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'manual' });
    return res.status;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function waitForApp(attempts = 180, intervalMs = 1000) {
  for (let i = 0; i < attempts; i++) {
    const status = await fetchOk(`${APP_BASE_URL}/login`);
    if (status != null) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

// Pre-compile the admin routes against the booted server so the suite never
// races Turbopack's lazy first-compile (a fresh .next/dev w/o this returns
// 404 for a route that is still compiling on its first hit).
function apiRoutesOnDisk() {
  const out = [];
  const walk = (dir, urlPath) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const seg = /^\[.+\]$/.test(entry.name) ? '1' : entry.name;
        walk(path.join(dir, entry.name), `${urlPath}/${seg}`);
      } else if (entry.name === 'route.js') {
        out.push(urlPath);
      }
    }
  };
  walk(path.join(root, 'app/api'), '/api');
  return out;
}

async function warmAdminRoutes() {
  // Anonymous GETs compile a route module with zero side effects (the handler
  // short-circuits on auth before doing anything; POST-only routes answer 405
  // only once their module is compiled). Dynamic sub-routes are included so a
  // mid-suite first hit can't produce the cold-compile 404.
  const routes = [
    // Server pages.
    '/', '/login', '/register',
    '/admin', '/admin/login', '/admin/accounts', '/admin/plans', '/admin/api-keys',
    '/admin/customer-care', '/admin/system', '/admin/scoring', '/admin/usage', '/admin/audit',
    // Auth routes (first tenant hit cold-compiles the shared graph — must not
    // race PDFMS01's 30s window).
    '/api/auth/login', '/api/auth/register', '/api/auth/logout',
    // Admin API top-level.
    '/api/admin/overview', '/api/admin/accounts', '/api/admin/plans', '/api/admin/api-keys',
    '/api/admin/customer-care', '/api/admin/system', '/api/admin/scoring',
    '/api/admin/usage', '/api/admin/audit',
    // Admin + tenant dynamic sub-routes hit by the suite.
    '/api/admin/accounts/1/status', '/api/admin/accounts/1/plan',
    '/api/admin/2fa',
    '/api/account', '/api/account/members/1',
    '/api/settings', '/api/settings/password', '/api/settings/two-factor',
    '/api/settings/capabilities', '/api/settings/score-thresholds',
    '/api/owner',
    '/api/businesses', '/api/businesses/1/evidence', '/api/businesses/1/contacts',
    '/api/businesses/1/research', '/api/businesses/1/interpret',
    '/api/businesses/1/detect-opportunities',
    '/api/evidence/1',
    '/api/jobs', '/api/jobs/1/cancel', '/api/jobs/1/retry',
    '/api/discover', '/api/discover/jobs/1/cancel', '/api/discover/jobs/1',
    '/api/discover/schedules', '/api/discover/schedules/1',
    '/api/opportunities/1/analyze', '/api/opportunities/1/outreach',
    '/api/opportunities/1/demo-spec',
    '/api/pipeline', '/api/pipeline/activity',
    '/api/leads/webhook',
    '/api/billing/checkout', '/api/billing/portal', '/api/billing/webhook',
    '/api/system/self-test', '/api/system/ai-test',
  ];
  // Every real API route on disk, so a route added later (or missed above) is
  // warmed too — the hand-kept list above had drifted (12 routes missing, 1
  // nonexistent), and a cold 404 on a dynamic route failed unrelated tests.
  const onDisk = apiRoutesOnDisk();
  const all = [...new Set([...routes.filter((r) => !r.startsWith('/api/') || onDisk.includes(r)), ...onDisk])];
  for (const route of all) {
    // Retry until the route answers with ANY status other than a 404/500 the
    // cold server can briefly produce while a route is still compiling. Up to
    // ~45s per route: on a busy machine (other dev servers) compiles are slow.
    for (let attempt = 0; attempt < 30; attempt++) {
      const status = await fetchOk(`${APP_BASE_URL}${route}`);
      if (status != null && status !== 404) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

function printLog(label, logName, tail = 40) {
  const file = path.join(LOG_DIR, logName);
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const slice = lines.slice(Math.max(0, lines.length - tail));
  console.log(`\n--- ${label} (last ${slice.length} lines of ${lines.length}) ---`);
  console.log(slice.join('\n'));
}

async function main() {
  console.log(`[e2e] mock-ai on ${AI_URL} | mock-research on ${RESEARCH_URL} | mock-discovery on ${DISCOVERY_URL} | mock-stripe on ${STRIPE_URL} | app on ${APP_BASE_URL}`);

  // Private PostgreSQL database for this run (see prepareIsolatedDb above).
  const basePgUrl = process.env.PG_DATABASE_URL;
  const pgUrl = basePgUrl ? await prepareIsolatedDb(basePgUrl) : null;
  if (pgUrl) console.log(`[e2e] app + tests will use the isolated DB (${pgUrl.split('/').pop()})`);

  const portFree = (await fetchOk(APP_BASE_URL, 1500)) == null;
  if (!portFree) {
    if (!FORCE_PORT) {
      console.error(
        `[e2e] port ${APP_PORT} is already in use. Stop the other server or set ` +
        `E2E_APP_PORT to a free port. (E2E_FORCE_PORT=1 frees the port automatically.)`
      );
      process.exit(2);
    }
    console.log(`[e2e] freeing port ${APP_PORT} (E2E_FORCE_PORT=1)`);
    const { execSync } = await import('node:child_process');
    try { execSync(`fuser -k ${APP_PORT}/tcp`); } catch { /* nothing listening */ }
    await new Promise((r) => setTimeout(r, 1000));
  }

  spawnChild('mock-ai', process.execPath, [path.join(here, 'mock-ai.mjs')],
    { ...process.env, MOCK_AI_PORT: String(AI_PORT) }, 'mock-ai.log');
  spawnChild('mock-research', process.execPath, [path.join(here, 'mock-research.mjs')],
    { ...process.env, MOCK_RESEARCH_PORT: String(RESEARCH_PORT) }, 'mock-research.log');
  spawnChild('mock-discovery', process.execPath, [path.join(here, 'mock-discovery.mjs')],
    { ...process.env, MOCK_DISCOVERY_PORT: String(DISCOVERY_PORT) }, 'mock-discovery.log');
  spawnChild('mock-stripe', process.execPath, [path.join(here, 'mock-stripe.mjs')], {
    ...process.env,
    MOCK_STRIPE_PORT: String(STRIPE_PORT),
    MOCK_STRIPE_WEBHOOK_URL: `${APP_BASE_URL}/api/billing/webhook`,
    MOCK_STRIPE_WEBHOOK_SECRET: STRIPE_WEBHOOK_SECRET,
  }, 'mock-stripe.log');

  await new Promise((r) => setTimeout(r, 500));

  const nextBin = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
  const appEnv = {
    ...process.env,
    ...(pgUrl ? { PG_DATABASE_URL: pgUrl } : {}),
    AI_API_KEY: 'e2e-test-key',
    AI_MODEL: 'e2e-mock-model',
    AI_PROVIDER: 'mock',
    AI_BASE_URL: `${AI_URL}/v1`,
    AI_TIMEOUT_MS: '15000',
    RESEARCH_PROVIDER: 'http',
    RESEARCH_API_URL: `${RESEARCH_URL}/research`,
    DISCOVERY_API_URL: `${DISCOVERY_URL}/search`,
    STRIPE_SECRET_KEY: 'sk_test_e2e_mock',
    STRIPE_WEBHOOK_SECRET,
    STRIPE_API_BASE_URL: `${STRIPE_URL}/v1`,
    // Ingest webhook token, bound to the seeded admin account (id 1) so the
    // e2e suite can exercise the token auth path (account-scoping + suspension).
    OPPORTUNITYOS_INGEST_TOKEN: 'e2e-ingest-token',
    OPPORTUNITYOS_INGEST_ACCOUNT_ID: '1',
    PORT: String(APP_PORT),
    NODE_ENV: 'development',
    MAIL_CAPTURE_DIR: MAIL_DIR,
  };
  fs.rmSync(MAIL_DIR, { recursive: true, force: true });
  fs.mkdirSync(MAIL_DIR, { recursive: true });
  spawnChild('app', process.execPath, [nextBin, 'dev', '-p', String(APP_PORT)], appEnv, 'app.log');

  console.log('[e2e] waiting for the app to boot (next dev) ...');
  const up = await waitForApp();
  if (!up) {
    printLog('app', 'app.log', 80);
    console.error('[e2e] app failed to start in time');
    killAll();
    process.exit(1);
  }
  console.log(`[e2e] app is up: ${APP_BASE_URL}`);
  await warmAdminRoutes();
  console.log('[e2e] admin routes warm (compiled)');

  const testEnv = {
    ...process.env,
    ...(pgUrl
      ? { PG_DATABASE_URL: pgUrl, DATABASE_URL: pgUrl } // suite drives its DB off DATABASE_URL
      : {}),
    E2E_APP_BASE_URL: APP_BASE_URL,
    E2E_MAIL_DIR: MAIL_DIR,
    E2E_AI_URL: AI_URL,
    E2E_RESEARCH_URL: RESEARCH_URL,
    E2E_DISCOVERY_URL: DISCOVERY_URL,
    E2E_STRIPE_URL: STRIPE_URL,
    MOCK_AI_PORT: String(AI_PORT),
    MOCK_RESEARCH_PORT: String(RESEARCH_PORT),
    MOCK_DISCOVERY_PORT: String(DISCOVERY_PORT),
    MOCK_STRIPE_PORT: String(STRIPE_PORT),
  };

  const exitCode = await new Promise((resolve) => {
    // --test-concurrency=1: every test file shares ONE live app server + DB.
    // Node's test runner runs test *files* concurrently by default; once more
    // than one file makes real HTTP calls against that shared server (as
    // test/billing.test.mjs now does alongside test/e2e.test.mjs), concurrent
    // load corrupts timing-sensitive admin session/2FA flows. Pure-unit files
    // (test/lead-quality.test.mjs) are unaffected either way, so forcing
    // sequential execution only costs wall-clock time, not correctness.
    const runner = spawn(process.execPath, [
      '--import', path.join(root, 'scripts/register-app-alias.mjs'),
      '--test-concurrency=1', '--test', 'test/',
    ], {
      cwd: root,
      env: testEnv,
      stdio: 'inherit',
    });
    const timer = setTimeout(() => {
      console.error(`[e2e] suite exceeded ${SUITE_TIMEOUT}ms — aborting`);
      runner.kill('SIGTERM');
    }, SUITE_TIMEOUT);
    runner.on('exit', (code) => { clearTimeout(timer); resolve(code ?? 1); });
  });

  killAll();

  if (exitCode !== 0) {
    printLog('app', 'app.log', 60);
    printLog('mock-ai', 'mock-ai.log', 20);
    printLog('mock-research', 'mock-research.log', 20);
    printLog('mock-discovery', 'mock-discovery.log', 20);
  } else {
    console.log('[e2e] all E2E tests passed');
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error('[e2e] fatal:', err);
  killAll();
  process.exit(1);
});