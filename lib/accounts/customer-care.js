import { query, insert } from '@/lib/db';

/** Platform-level customer-care records per account (control-room processed). */
export function listCareContacts(accountId = null) {
  const where = accountId != null ? 'WHERE c.account_id = ?' : '';
  const params = accountId != null ? [Number(accountId)] : [];
  return query(
    `SELECT c.id, c.account_id, c.name, c.role, c.email, c.phone, c.notes,
            c.reach_out, c.created_at, c.updated_at, a.name AS account_name, a.status AS account_status
       FROM customer_care_contacts c
       JOIN accounts a ON a.id = c.account_id
      ${where} ORDER BY c.reach_out DESC, c.updated_at DESC, c.id DESC`,
    params
  );
}

export async function getCareContact(id) {
  const rows = await query('SELECT * FROM customer_care_contacts WHERE id = ?', [Number(id)]);
  return rows[0] || null;
}

export async function createCareContact({ account_id, name, role = null, email = null, phone = null, notes = null, reach_out = false, created_by = null }) {
  return insert(
    `INSERT INTO customer_care_contacts
       (account_id, name, role, email, phone, notes, reach_out, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      Number(account_id),
      String(name || '').slice(0, 120),
      role != null ? String(role).slice(0, 80) : null,
      email != null ? String(email).slice(0, 255) : null,
      phone != null ? String(phone).slice(0, 40) : null,
      notes != null ? String(notes) : null,
      reach_out ? 1 : 0,
      created_by != null ? Number(created_by) : null,
    ]
  );
}

export async function updateCareContact(id, fields) {
  const sets = [];
  const params = [];
  if ('role' in fields) { sets.push('role = ?'); params.push(fields.role != null ? String(fields.role).slice(0, 80) : null); }
  if ('email' in fields) { sets.push('email = ?'); params.push(fields.email != null ? String(fields.email).slice(0, 255) : null); }
  if ('phone' in fields) { sets.push('phone = ?'); params.push(fields.phone != null ? String(fields.phone).slice(0, 40) : null); }
  if ('notes' in fields) { sets.push('notes = ?'); params.push(fields.notes != null ? String(fields.notes) : null); }
  if ('reach_out' in fields) { sets.push('reach_out = ?'); params.push(fields.reach_out ? 1 : 0); }
  if (fields.name != null) { sets.push('name = ?'); params.push(String(fields.name).slice(0, 120)); }
  if (!sets.length) return;
  params.push(Number(id));
  await query(`UPDATE customer_care_contacts SET ${sets.join(', ')}, updated_at = NOW() WHERE id = ?`, params);
}

export async function deleteCareContact(id) {
  const res = await query('DELETE FROM customer_care_contacts WHERE id = ?', [Number(id)]);
  return Number(res.affectedRows || 0);
}