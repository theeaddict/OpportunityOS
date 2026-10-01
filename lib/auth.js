import crypto from 'crypto';
import { cookies } from 'next/headers';
import { query, insert } from '@/lib/db';
import { validateTotp, findBackupCode } from '@/lib/totp';
import * as usersRepo from '@/lib/repositories/users';
import { createLoginThrottle } from '@/lib/login-throttle';

const COOKIE_NAME = 'oos_session';
export const CSRF_COOKIE_NAME = 'oos_csrf';
const SESSION_DAYS = 14;

// BiasharaOS-style timing equalization: a valid scrypt hash (same N/r/p as
// hashPassword) of an arbitrary password no account uses. On the "no such
// user" login path we run a full verify against it, so an unknown email takes
// the same ~scrypt time as a wrong password for a known one. Otherwise
// response timing leaks which emails have accounts.
const DUMMY_HASH =
  '$scrypt$N=16384$r=8$p=1$c42+B+5wj1zgRmoaSxODPg==$4pRrr9XMZf8P6n88h21zF+BG1y7/vxcHEp0NRLvyTg3tW8tYqXz1aMQIPXDvaoqs0vKDI49bP0PbyPC5StAhjw==';

// Failed-login lockout (BiasharaOS LoginThrottle parity, hardened): locks per
// (email, source IP) after 5 failures so a stranger can't lock someone else out
// of their account from their own address, with a much higher cross-IP ceiling
// (30) that still stops a distributed guessing campaign. See lib/login-throttle.js.
const loginThrottle = createLoginThrottle({ perIpMax: 5, perAccountMax: 30 });

export const throttleStatus = (email, ip) => loginThrottle.status(email, ip);
export const recordFailedLogin = (email, ip) => loginThrottle.recordFailure(email, ip);
export const resetLoginThrottle = (email, ip) => loginThrottle.reset(email, ip);

export async function verifyPasswordCredential(email, password) {
  const user = await usersRepo.findByEmail(email);
  if (!user) {
    verifyPassword(password, DUMMY_HASH);
    return null;
  }
  return verifyPassword(password, user.password_hash) ? user : null;
}

export function verifyPassword(password, stored) {
  try {
    const [, , nstr, rstr, pstr, saltB64, hashB64] = stored.split('$');
    const N = Number(nstr.split('=')[1]);
    const r = Number(rstr.split('=')[1]);
    const p = Number(pstr.split('=')[1]);
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(password, salt, expected.length, { N, r, p });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `$scrypt$N=16384$r=8$p=1$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const csrfToken = crypto.randomBytes(32).toString('hex');
  await insert(
    'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))',
    [token, userId, SESSION_DAYS]
  );
  const cookieStore = await cookies();
  // BiasharaOS CookiePair parity: the session cookie is httpOnly (no script
  // can read it); the CSRF cookie is deliberately NOT httpOnly so the frontend
  // can read it and echo it in X-CSRF-Token for the proxy double-submit check.
  // The CSRF value alone is useless — it must ride alongside the session cookie.
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
  cookieStore.set(CSRF_COOKIE_NAME, csrfToken, {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function destroySession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (token) {
    await query('DELETE FROM sessions WHERE token = ?', [token]).catch(() => {});
    cookieStore.delete(COOKIE_NAME);
  }
  cookieStore.delete(CSRF_COOKIE_NAME);
}

/** The raw session token currently held by this request (null when signed out). */
export async function getSessionToken() {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_NAME)?.value || null;
}

/**
 * Session invalidation helpers. Sessions live as rows in `sessions`, so a
 * password change or a suspension can (and should) revoke them server-side
 * instead of waiting for expiry.
 */
export async function destroyOtherSessions(userId, keepToken) {
  const token = String(keepToken || '');
  if (token) {
    // Keep only the session the action was initiated from.
    await query('DELETE FROM sessions WHERE user_id = ? AND token <> ?', [Number(userId), token]).catch(() => {});
    return;
  }
  await destroyAllSessionsForUser(userId);
}

export async function destroyAllSessionsForUser(userId) {
  await query('DELETE FROM sessions WHERE user_id = ?', [Number(userId)]).catch(() => {});
}

export async function destroySessionsForAccount(accountId) {
  await query(
    'DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE account_id = ?)',
    [Number(accountId)]
  ).catch(() => {});
}

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const rows = await query(
    `SELECT u.id, u.email, u.name, u.role, u.account_id, u.status, u.email_verified_at,
            a.status AS account_status
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN accounts a ON a.id = u.account_id
      WHERE s.token = ? AND s.expires_at > NOW()`,
    [token]
  );
  return rows[0] || null;
}

/**
 * Public signup: creates a brand-new workspace for the user (SaaS-ready).
 * The signer becomes the account's OWNER; every user is tied to exactly one
 * account via users.account_id. No payment handling anywhere yet.
 */
export async function register({ email, password, name }) {
  const existing = await usersRepo.findByEmail(email);
  if (existing) throw new Error('An account with this email already exists');
  const { createAccount } = await import('@/lib/repositories/accounts');
  const id = await usersRepo.create({
    email,
    password_hash: hashPassword(password),
    name,
  });
  const accountId = await createAccount({
    name: `${name}'s workspace`,
    plan_code: 'free',
    created_by: id,
  });
  await usersRepo.setAccount(id, accountId);
  await usersRepo.updateRole(id, 'owner');
  // A new workspace starts with a starter solution library: without one every
  // opportunity scores 0 on solution fit. Best-effort — signing up must never
  // fail because of seeding; the owner can load them later from /solutions.
  try {
    const { seedStarterSolutions } = await import('@/lib/repositories/solutions');
    await seedStarterSolutions(accountId);
  } catch (err) {
    console.error('[register] starter solutions not seeded', err);
  }
  // Verification email: fire-and-forget so a slow/failed mail server never
  // delays or breaks signup (the user can resend it from the banner).
  import('@/lib/auth-emails')
    .then((m) => m.sendVerificationEmail({ id, email: String(email).trim().toLowerCase(), name }))
    .catch(() => {});
  await createSession(id);
  return id;
}

export async function login(email, password, { code } = {}) {
  const user = await usersRepo.findByEmail(email);
  if (!user) {
    // Timing equalization: burn the same scrypt cost as a real compare so an
    // unknown email does not reveal itself by responding faster than a wrong
    // password on a known email (BiasharaOS dummy-password parity).
    verifyPassword(password, DUMMY_HASH);
    throw new Error('Invalid email or password');
  }
  if (!verifyPassword(password, user.password_hash)) {
    throw new Error('Invalid email or password');
  }

  // A suspended workspace must not be reachable again just by logging in.
  // Suspension kills sessions (server-side deletes) AND blocks new ones here,
  // so a suspended account is never usable through the tenant API. The response
  // is deliberately the SAME generic error as bad credentials: a login endpoint
  // must not act as an account-status oracle (login-verb flattening).
  if (user.account_id) {
    const [acct] = await query('SELECT status FROM accounts WHERE id = ?', [Number(user.account_id)]);
    if (acct && acct.status === 'suspended') {
      verifyPassword(password, DUMMY_HASH);
      throw new Error('Invalid email or password');
    }
  }

  // Second factor: when enrolled, a valid TOTP code (or a one-time backup
  // code) is required before a session is issued (BiasharaOS pending2fa).
  if (user.otp_enabled && user.otp_secret) {
    if (await verifySecondFactor(user, code)) {
      // all good — continue to create the session
    } else if (!code) {
      const err = new Error('Two-factor code required');
      err.code = '2FA_REQUIRED';
      throw err;
    } else {
      const err = new Error('Invalid two-factor code');
      err.code = '2FA_INVALID';
      throw err;
    }
  }

  await createSession(user.id);
  return user.id;
}

/**
 * Verify a TOTP code or a one-time backup code. Backup codes are single-use:
 * a matching hash is removed from the stored list so it can't be replayed.
 */
async function verifySecondFactor(user, provided) {
  const c = String(provided || '').trim();
  if (/^\d{6}$/.test(c) && validateTotp(user.otp_secret, c)) return true;

  let hashed = user.otp_backup_codes;
  if (Array.isArray(hashed)) hashed = hashed;
  else {
    try {
      hashed = hashed ? JSON.parse(hashed) : [];
    } catch {
      hashed = [];
    }
  }
  const idx = findBackupCode(hashed, c);
  if (idx === -1) return false;
  hashed.splice(idx, 1);
  await usersRepo.setOtpBackupCodes(user.id, hashed).catch(() => {});
  return true;
}
