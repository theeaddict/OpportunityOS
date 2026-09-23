import { query, insert } from '@/lib/db';

/**
 * Outreach repository.
 * approved must be 1 before sent_status may move to 'sent' (enforced in the
 * service layer, which also checks that a public contact exists).
 * Multi-tenant: every query is scoped to the caller's account via accountId.
 */

export async function createOutreach({ account_id, opportunity_id, message_type = 'email', variant = null,
                                       message_text, ai_model = null, generation_status = 'generated',
                                       approved = 0, lifecycle_status = 'generated' }) {
  return insert(
    `INSERT INTO outreach_messages
       (account_id, opportunity_id, message_type, variant, message_text, ai_model, generation_status, approved, lifecycle_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [Number(account_id) || null, Number(opportunity_id), message_type, variant || null, String(message_text).slice(0, 8000),
     ai_model || null, generation_status || 'generated', approved ? 1 : 0,
     lifecycle_status || 'generated']
  );
}

export async function findById(accountId, id) {
  const rows = await query(
    'SELECT * FROM outreach_messages WHERE id = ? AND account_id = ?',
    [Number(id), Number(accountId)]
  );
  return rows[0] || null;
}

export async function listForOpportunity(accountId, opportunityId) {
  return query(
    `SELECT * FROM outreach_messages
      WHERE opportunity_id = ? AND account_id = ? ORDER BY created_at DESC, id DESC`,
    [Number(opportunityId), Number(accountId)]
  );
}

/** Update draft text / approval. Sent status changes go through markSent(). */
export async function updateDraft(accountId, id, { message_text, subject = null, approved }) {
  await query(
    'UPDATE outreach_messages SET message_text = ?, approved = ? WHERE id = ? AND account_id = ?',
    [String(message_text).slice(0, 8000), approved ? 1 : 0, Number(id), Number(accountId)]
  );
}

export async function markSent(accountId, id, sentStatus) {
  await query(
    'UPDATE outreach_messages SET sent_status = ? WHERE id = ? AND account_id = ?',
    [sentStatus, Number(id), Number(accountId)]
  );
}

export async function setGenerationFailed(accountId, id, model = null) {
  await query(
    "UPDATE outreach_messages SET generation_status = 'failed', ai_model = ? WHERE id = ? AND account_id = ?",
    [model, Number(id), Number(accountId)]
  );
}

/**
 * Lifecycle transitions (Personalized Outreach Engine). Sets lifecycle_status and
 * stamps the relevant timestamps. 'contacted' records contacted_at; 'opted_out'
 * records opted_out_at; any other value advances the relationship state.
 */
export async function setLifecycle(accountId, id, status) {
  const allowed = ['generated', 'approved', 'contacted', 'replied', 'demo', 'proposal', 'won', 'lost', 'opted_out'];
  const next = allowed.includes(status) ? status : 'generated';
  await query(
    `UPDATE outreach_messages
        SET lifecycle_status = ?,
            contacted_at = IF(? = 'contacted', COALESCE(contacted_at, NOW()), contacted_at),
            opted_out_at = IF(? = 'opted_out', COALESCE(opted_out_at, NOW()), opted_out_at)
      WHERE id = ? AND account_id = ?`,
    [next, next, next, Number(id), Number(accountId)]
  );
  return next;
}

export async function markOptedOut(accountId, id) {
  await query(
    `UPDATE outreach_messages SET lifecycle_status = 'opted_out', opted_out_at = NOW()
      WHERE id = ? AND account_id = ? AND opted_out_at IS NULL`,
    [Number(id), Number(accountId)]
  );
}

export async function isOptedOut(accountId, id) {
  const rows = await query(
    'SELECT opted_out_at FROM outreach_messages WHERE id = ? AND account_id = ?',
    [Number(id), Number(accountId)]
  );
  return !!(rows[0] && rows[0].opted_out_at);
}