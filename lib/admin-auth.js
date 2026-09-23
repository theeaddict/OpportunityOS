import crypto from 'crypto';
import { cookies } from 'next/headers';
import { query, insert } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/auth';

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
 * Sign in a platform administrator. Two-factor is not (yet) available for
 * admins — separate table, separate rate-limit key, separate session cookie.
 */
export async function adminLogin(email, password) {
  const admin = await findByEmail(email);
  if (!admin) {
    verifyPassword(password, DUMMY_HASH);
    throw new Error('Invalid admin email or password');
  }
  if (!admin.is_active) throw new Error('Admin account is disabled');
  if (!verifyPassword(password, admin.password_hash)) {
    throw new Error('Invalid admin email or password');
  }
  return admin;
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