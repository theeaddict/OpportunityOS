import { query, insert } from '@/lib/db';

export async function findByEmail(email) {
  const rows = await query('SELECT * FROM users WHERE email = ? AND status = \'active\'', [email.trim().toLowerCase()]);
  return rows[0] || null;
}

export async function findById(id) {
  const rows = await query('SELECT id, email, name, role, status, account_id, created_at FROM users WHERE id = ?', [id]);
  return rows[0] || null;
}

export async function createUser({ name, email, password_hash, role = 'member', account_id = null, status = 'active' }) {
  return insert(
    'INSERT INTO users (name, email, password_hash, role, account_id, status) VALUES (?, ?, ?, ?, ?, ?)',
    [
      name,
      email.trim().toLowerCase(),
      password_hash,
      ['owner', 'admin', 'member'].includes(String(role)) ? String(role) : 'member',
      account_id ? Number(account_id) : null,
      String(status) === 'suspended' ? 'suspended' : 'active',
    ]
  );
}

// Backwards-compatible alias used by auth.register
export const create = createUser;

export async function setAccount(userId, accountId) {
  await query('UPDATE users SET account_id = ?, updated_at = NOW() WHERE id = ?', [Number(accountId), Math.floor(Number(userId))]);
}

export async function updateRole(userId, role) {
  const allowed = ['owner', 'admin', 'member'];
  const next = allowed.includes(String(role)) ? String(role) : 'member';
  await query('UPDATE users SET role = ?, updated_at = NOW() WHERE id = ?', [next, Math.floor(Number(userId))]);
}

export async function updateProfile(id, { name }) {
  await query('UPDATE users SET name = ? WHERE id = ?', [name, id]);
}

export async function updatePassword(userId, passwordHash) {
  await query('UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?', [passwordHash, Math.floor(Number(userId))]);
}

export async function setOtpPending(userId, secret) {
  await query('UPDATE users SET otp_pending_secret = ?, updated_at = NOW() WHERE id = ?', [secret, Math.floor(Number(userId))]);
}

export async function setOtp(userId, { secret, backupCodes }) {
  await query(
    'UPDATE users SET otp_secret = ?, otp_enabled = ?, otp_backup_codes = ?, otp_pending_secret = NULL, updated_at = NOW() WHERE id = ?',
    [secret, true, JSON.stringify(backupCodes || []), Math.floor(Number(userId))]
  );
}

export async function setOtpBackupCodes(userId, backupCodes) {
  await query(
    'UPDATE users SET otp_backup_codes = ?, updated_at = NOW() WHERE id = ?',
    [JSON.stringify(backupCodes || []), Math.floor(Number(userId))]
  );
}

export async function clearOtp(userId) {
  await query(
    'UPDATE users SET otp_secret = NULL, otp_enabled = ?, otp_backup_codes = NULL, otp_pending_secret = NULL, updated_at = NOW() WHERE id = ?',
    [false, Math.floor(Number(userId))]
  );
}

/** Safe (secret-free) 2FA status for display; never returns the secret itself. */
export async function getTwoFactorStatus(userId) {
  const rows = await query('SELECT otp_enabled FROM users WHERE id = ?', [Math.floor(Number(userId))]);
  return Boolean(rows[0] && rows[0].otp_enabled);
}
