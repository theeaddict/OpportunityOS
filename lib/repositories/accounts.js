/**
 * Account repository + team management.
 * Tenant identities + membership. User password/email lives in users table.
 */

import { query, insert } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { assertSuperadmin } from '@/lib/admin-auth';
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
  await assertSuperadmin();
  return query('SELECT id, name, plan_code, status, created_at FROM accounts ORDER BY id');
}

export async function updateAccount(id, {
  name = null, plan_code = null, status = null,
  stripe_customer_id = undefined, stripe_subscription_id = undefined,
} = {}) {
  const sets = [];
  const params = [];
  if (name != null) { sets.push('name = ?'); params.push(String(name).slice(0, 120)); }
  if (plan_code != null) { sets.push('plan_code = ?'); params.push(String(plan_code)); }
  if (status != null) { sets.push('status = ?'); params.push(String(status)); }
  if (stripe_customer_id !== undefined) { sets.push('stripe_customer_id = ?'); params.push(stripe_customer_id); }
  if (stripe_subscription_id !== undefined) { sets.push('stripe_subscription_id = ?'); params.push(stripe_subscription_id); }
  if (!sets.length) return;
  params.push(Number(id));
  await query(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`, params);
}

/** Looked up from webhook events that only carry the Stripe customer id (no metadata). */
export async function getAccountByStripeCustomerId(customerId) {
  const rows = await query('SELECT * FROM accounts WHERE stripe_customer_id = ?', [String(customerId)]);
  return rows[0] || null;
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
  return usersRepo.createUser({ account_id, name, email, password_hash, role, status, email_verified: true });
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
            limit_ai_analyses, limit_demo_generations, limit_users, limit_watches,
            price_cents, currency, stripe_price_id, is_active, created_at
       FROM billing_plans ORDER BY code`
  );
}

export async function getPlan(code) {
  const rows = await query(
    `SELECT code, name, description, limit_researches, limit_opportunities,
            limit_ai_analyses, limit_demo_generations, limit_users, limit_watches,
            price_cents, currency, stripe_price_id, is_active, created_at
       FROM billing_plans WHERE code = ?`,
    [String(code)]
  );
  return rows[0] || null;
}

export async function createPlan(plan) {
  return insert(
    `INSERT INTO billing_plans
       (code, name, description, limit_researches, limit_opportunities,
        limit_ai_analyses, limit_demo_generations, limit_users, limit_watches,
        price_cents, currency, stripe_price_id, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      plan.code,
      plan.name,
      plan.description,
      plan.limit_researches,
      plan.limit_opportunities,
      plan.limit_ai_analyses,
      plan.limit_demo_generations,
      plan.limit_users,
      plan.limit_watches,
      plan.price_cents,
      plan.currency,
      plan.stripe_price_id || null,
      plan.is_active ? 1 : 0,
    ]
  );
}

export async function updatePlan(code, fields) {
  const sets = [];
  const params = [];
  const COL = {
    name: 'name',
    description: 'description',
    limit_researches: 'limit_researches',
    limit_opportunities: 'limit_opportunities',
    limit_ai_analyses: 'limit_ai_analyses',
    limit_demo_generations: 'limit_demo_generations',
    limit_users: 'limit_users',
    limit_watches: 'limit_watches',
    price_cents: 'price_cents',
    currency: 'currency',
    stripe_price_id: 'stripe_price_id',
    is_active: 'is_active',
  };
  for (const key of Object.keys(fields)) {
    if (!(key in COL)) continue;
    sets.push(`${COL[key]} = ?`);
    params.push(
      key === 'is_active' ? (fields[key] ? 1 : 0) : fields[key]
    );
  }
  if (!sets.length) return;
  params.push(String(code));
  await query(`UPDATE billing_plans SET ${sets.join(', ')} WHERE code = ?`, params);
}

export async function deletePlan(code) {
  const res = await query('DELETE FROM billing_plans WHERE code = ? AND code <> ?', [
    String(code),
    'internal',
  ]);
  return Number(res.affectedRows || 0);
}