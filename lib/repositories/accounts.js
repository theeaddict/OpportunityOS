/**
 * Account repository + team management.
 * Tenant identities + membership. User password/email lives in users table.
 */

import { query, insert } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import * as usersRepo from '@/lib/repositories/users';

export async function createAccount({ name, plan_code = 'free', created_by = null }) {
  return insert(
    `INSERT INTO accounts (name, plan_code, status, created_by) VALUES (?, ?, 'active', ?)`,
    [String(name || '').trim().slice(0, 120) || 'My workspace', plan_code || 'free', Number(created_by) || null]
  );
}

export async function getAccount(id) {
  const rows = await query('SELECT * FROM accounts WHERE id = ?', [Number(id)]);
  return rows[0] || null;
}

export async function listAccounts() {
  return query('SELECT id, name, plan_code, status, created_at FROM accounts ORDER BY id');
}

export async function updateAccount(id, { name = null, plan_code = null, status = null } = {}) {
  const sets = [];
  const params = [];
  if (name != null) { sets.push('name = ?'); params.push(String(name).slice(0, 120)); }
  if (plan_code != null) { sets.push('plan_code = ?'); params.push(String(plan_code)); }
  if (status != null) { sets.push('status = ?'); params.push(String(status)); }
  if (!sets.length) return;
  params.push(Number(id));
  await query(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`, params);
}

export async function listUsers(accountId) {
  return query(
    `SELECT id, name, email, role, status, created_at
       FROM users WHERE account_id = ? ORDER BY id`,
    [Number(accountId)]
  );
}

export async function countUsers(accountId) {
  const rows = await query('SELECT COUNT(*) AS n FROM users WHERE account_id = ?', [Number(accountId)]);
  return Number(rows[0]?.n || 0);
}

export async function createUserInAccount({ account_id, name, email, password, role = 'member', status = 'active' }) {
  const password_hash = hashPassword(password);
  return usersRepo.createUser({ account_id, name, email, password_hash, role, status });
}

export async function updateUserRole(userId, role) {
  const allowed = ['owner', 'admin', 'member'];
  const next = allowed.includes(String(role)) ? String(role) : 'member';
  await query('UPDATE users SET role = ?, updated_at = NOW() WHERE id = ?', [next, Number(userId)]);
}

export async function setUserStatus(userId, status) {
  const next = ['active', 'suspended'].includes(String(status)) ? String(status) : 'active';
  await query('UPDATE users SET status = ?, updated_at = NOW() WHERE id = ?', [next, Number(userId)]);
}

export async function listPlans() {
  return query(
    `SELECT code, name, description, limit_researches, limit_opportunities,
            limit_ai_analyses, limit_demo_generations, limit_users
       FROM billing_plans ORDER BY code`
  );
}