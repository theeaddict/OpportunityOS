import crypto from 'crypto';
import { cookies } from 'next/headers';
import { query, insert } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/auth';
import { validateTotp, findBackupCode } from '@/lib/totp';
import { HttpError } from '@/lib/http-error';
import { createLoginThrottle } from '@/lib/login-throttle';

// Whole-system administrator identity — deliberately SEPARATE from the tenant
// users table and its oos_session cookie. The admin logs in through its own
// /admin/login flow, gets its own oos_admin_session cookie and is never a
// member row of any account (no account_id, no role). Granting is only ever
// done via scripts (setup-db bootstrap admin, grant-admin.js) — never from
// the application.

const COOKIE_NAME = 'oos_admin_session';
export const CSRF_COOKIE_NAME = 'oos_admin_csrf';
const SESSION_DAYS = 14;

// Same scrypt-timing equalization as users: burn a valid-hash verify when the
// email is unknown so an admin email probe is not faster to answer.
const DUMMY_HASH =
  '$scrypt$N=16384$r=8$p=1$c42+B+5wj1zgRmoaSxODPg==$4pRrr9XMZf8P6n88h21zF+BG1y7/vxcHEp0NRLvyTg3tW8tYqXz1aMQIPXDvaoqs0vKDI49bP0PbyPC5StAhjw==';

// Login lockout for administrators, in its OWN keyspace (an admin email is a
// separate identity from any tenant user row). Locks per (email, source IP)
// after 5 failures so a stranger can't lock the admin out from their own
// address; a stricter cross-IP ceiling (15) still stops distributed guessing.
const adminThrottle = createLoginThrottle({ perIpMax: 5, perAccountMax: 15 });

export const adminThrottleStatus = (email, ip) => adminThrottle.status(email, ip);
export const adminRecordFailedLogin = (email, ip) => adminThrottle.recordFailure(email, ip);
export const adminResetThrottle = (email, ip) => adminThrottle.reset(email, ip);

export async function findByEmail(email) {
  const rows = await query(
    'SELECT * FROM admin_users WHERE email = ?',
    [String(email || '').trim().toLowerCase()]
  );
  return rows[0] || null;
}

export async function findById(id) {
  const rows = await query('SELECT id, name, email, is_active FROM admin_users WHERE id = ?', [Number(id)]);
  return rows[0] || null;
}

export async function createAdmin({ name, email, password }) {
  const id = await insert(
    'INSERT INTO admin_users (name, email, password_hash) VALUES (?, ?, ?)',
    [String(name || '').trim().slice(0, 120), String(email || '').trim().toLowerCase(), hashPassword(password)]
  );
  return id;
}

export async function updatePassword(adminId, password) {
  await query('UPDATE admin_users SET password_hash = ?, updated_at = NOW() WHERE id = ?', [hashPassword(password), Number(adminId)]);
}

/**
 * Sign in a platform administrator. Two-factor mirrors the tenant flow: when
 * the admin has enrolled (otp_enabled + otp_secret), a valid TOTP code or a
 * one-time backup code is required before a session is issued. Enrolment lives
 * in admin_users (migration 031) and reuses lib/totp.js unchanged.
 */
export async function adminLogin(email, password, { code } = {}) {
  const admin = await findByEmail(email);
  if (!admin) {
    verifyPassword(password, DUMMY_HASH);
    throw new Error('Invalid admin email or password');
  }
  // Disabled admins get the SAME generic error as bad credentials so the admin
  // sign-in never doubles as an account-status oracle.
  if (!admin.is_active) throw new Error('Invalid admin email or password');
  if (!verifyPassword(password, admin.password_hash)) {
    throw new Error('Invalid admin email or password');
  }

  if (admin.otp_enabled && admin.otp_secret) {
    if (await verifyAdminSecondFactor(admin, code)) {
      // second factor satisfied — continue to session creation
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
  return admin;
}

/**
 * Verify a TOTP code or a one-time backup code for an admin. Backup codes are
 * single-use: a matching hash is removed from the stored list so it can't be
 * replayed. Gated purely on the admin_users row — never consulted during
 * enrollment (see otp_pending_secret notes in the 2FA route).
 */
export function adminBackupCodes(admin) {
  const raw = admin.otp_backup_codes;
  if (Array.isArray(raw)) return raw;
  try {
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function verifyAdminSecondFactor(admin, provided) {
  const c = String(provided || '').trim();
  if (/^\d{6}$/.test(c) && validateTotp(admin.otp_secret, c)) return true;

  const hashed = adminBackupCodes(admin);
  const idx = findBackupCode(hashed, c);
  if (idx === -1) return false;
  hashed.splice(idx, 1);
  await setAdminOtpBackupCodes(admin.id, hashed).catch(() => {});
  return true;
}

// ---------------------------------------------------------------------------
// Admin 2FA lifecycle (migration 031). Mirrors the tenant users lifecycle so
// the same TOTP primitives are exercised.
// ---------------------------------------------------------------------------

export async function setAdminOtpPending(adminId, secret) {
  await query(
    'UPDATE admin_users SET otp_pending_secret = ?, updated_at = NOW() WHERE id = ?',
    [secret, Number(adminId)]
  );
}

export async function setAdminOtp(adminId, { secret, backupCodes }) {
  await query(
    'UPDATE admin_users SET otp_secret = ?, otp_enabled = ?, otp_backup_codes = ?, otp_pending_secret = NULL, updated_at = NOW() WHERE id = ?',
    [secret, true, JSON.stringify(backupCodes || []), Number(adminId)]
  );
}

export async function setAdminOtpBackupCodes(adminId, backupCodes) {
  await query(
    'UPDATE admin_users SET otp_backup_codes = ?, updated_at = NOW() WHERE id = ?',
    [JSON.stringify(backupCodes || []), Number(adminId)]
  );
}

export async function clearAdminOtp(adminId) {
  await query(
    'UPDATE admin_users SET otp_secret = NULL, otp_enabled = ?, otp_backup_codes = NULL, otp_pending_secret = NULL, updated_at = NOW() WHERE id = ?',
    [false, Number(adminId)]
  );
}

export async function createAdminSession(adminId) {
  const token = crypto.randomBytes(32).toString('hex');
  const csrfToken = crypto.randomBytes(32).toString('hex');
  await insert(
    'INSERT INTO admin_sessions (token, admin_user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))',
    [token, adminId, SESSION_DAYS]
  );
  const cookieStore = await cookies();
  const base = {
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  };
  cookieStore.set(COOKIE_NAME, token, { ...base, httpOnly: true });
  cookieStore.set(CSRF_COOKIE_NAME, csrfToken, { ...base, httpOnly: false });
}

export async function destroyAdminSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (token) {
    await query('DELETE FROM admin_sessions WHERE token = ?', [token]).catch(() => {});
    cookieStore.delete(COOKIE_NAME);
  }
  cookieStore.delete(CSRF_COOKIE_NAME);
}

export async function getCurrentAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const rows = await query(
    `SELECT a.id, a.name, a.email, a.is_active
       FROM admin_sessions s JOIN admin_users a ON a.id = s.admin_user_id
      WHERE s.token = ? AND s.expires_at > NOW()`,
    [token]
  );
  return rows[0] || null;
}

/**
 * Internal safety net for platform-wide helpers (list all accounts, all API
 * keys, customer-care contacts, job counts). These functions have no account
 * discriminator by design, so they may ONLY be reached while a superadmin
 * session is present. An explicit ASSERTION inside the helper (not just a
 * route-level gate) makes it impossible for a future tenant-facing caller to
 * silently query the whole platform. Requires a request context (next/headers).
 */
export async function assertSuperadmin() {
  const admin = await getCurrentAdmin();
  if (!admin) throw new HttpError(401, 'Administrator sign-in required');
  if (!admin.is_active) throw new HttpError(403, 'Admin account disabled');
  return admin;
}