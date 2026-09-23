import crypto from 'crypto';
import { cookies } from 'next/headers';
import { query, insert } from '@/lib/db';
import { validateTotp, findBackupCode } from '@/lib/totp';
import * as usersRepo from '@/lib/repositories/users';

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

// Map of tracked login attempts per email (BiasharaOS LoginThrottle parity):
// max THROTTLE_MAX failures within THROTTLE_WINDOW_MS lock the identifier for
// THROTTLE_LOCKOUT_MS. Reset clears both on a successful login.
const THROTTLE_MAX = 5;
const THROTTLE_WINDOW_MS = 15 * 60 * 1000;
const THROTTLE_LOCKOUT_MS = 15 * 60 * 1000;
const throttle = new Map();

function throttleTouch() {
  const now = Date.now();
  for (const [key, t] of throttle) {
    if (now - t.updatedAt > 60 * 60 * 1000) throttle.delete(key);
  }
}

export function throttleStatus(email) {
  const key = String(email || '').trim().toLowerCase();
  const t = throttle.get(key);
  const now = Date.now();
  if (!t) return { locked: false, attempts: 0, remainingMs: 0 };
  // Attempt counter expires after the window even if the last failure did not lock.
  if (now - t.updatedAt > THROTTLE_WINDOW_MS) {
    throttle.delete(key);
    return { locked: false, attempts: 0, remainingMs: 0 };
  }
  const lockedUntil = t.lockedUntil || 0;
  if (lockedUntil > now) return { locked: true, attempts: t.attempts, remainingMs: lockedUntil - now };
  return { locked: false, attempts: t.attempts, remainingMs: 0 };
}

export function recordFailedLogin(email) {
  const now = Date.now();
  throttleTouch();
  const key = String(email || '').trim().toLowerCase();
  if (!key) return { locked: false };
  const t = throttle.get(key);
  if (t && t.lockedUntil && t.lockedUntil > now) return { locked: true, attempts: t.attempts, remainingMs: t.lockedUntil - now };
  const attempts = (t && now - t.updatedAt <= THROTTLE_WINDOW_MS ? t.attempts : 0) + 1;
  const entry = { attempts, updatedAt: now, lockedUntil: t && t.lockedUntil > now ? t.lockedUntil : 0 };
  if (attempts >= THROTTLE_MAX) entry.lockedUntil = now + THROTTLE_LOCKOUT_MS;
  throttle.set(key, entry);
  return { locked: entry.lockedUntil > now, attempts, remainingMs: Math.max(0, entry.lockedUntil - now) };
}

export function resetLoginThrottle(email) {
  const key = String(email || '').trim().toLowerCase();
  if (key) throttle.delete(key);
}

export async function verifyPasswordCredential(email, password) {
  const user = await usersRepo.findByEmail(email);
  if (!user) {
    verifyPassword(password, DUMMY_HASH);
    return null;
  }
  return verifyPassword(password, user.password_hash) ? user : null;
}

function verifyPassword(password, stored) {
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

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const rows = await query(
    `SELECT u.id, u.email, u.name, u.role, u.account_id, u.status, u.is_superadmin
       FROM sessions s JOIN users u ON u.id = s.user_id
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
