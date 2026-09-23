import { query, insert } from '@/lib/db';
import { normalizeBusinessName, normalizePhone, normalizeWebsite, normalizeSocialHandle, inferContactType } from '@/lib/normalize';

/**
 * Business repository.
 *
 * Deduplication considers (in order): normalized name, normalized website,
 * normalized phone, and social/external identifiers on business_sources.
 * All writes are parameterized — no string interpolation into SQL ever.
 *
 * Multi-tenant: every query is scoped to the caller's account via accountId.
 */

export async function createBusiness(data) {
  return insert(
    `INSERT INTO businesses
       (account_id, name, normalized_name, industry, description, location, country,
        website, website_normalized, phone_normalized, estimated_size,
        employee_signal, branch_count, business_maturity_score,
        business_maturity_notes, primary_social_platform, data_origin, contact_verified, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      Number(data.account_id) || null,
      data.name,
      normalizeBusinessName(data.name),
      data.industry || null,
      data.description || null,
      data.location || null,
      data.country || null,
      data.website || null,
      normalizeWebsite(data.website),
      normalizePhone(data.phone),
      data.estimated_size || null,
      data.employee_signal || null,
      Number(data.branch_count) > 0 ? Math.floor(Number(data.branch_count)) : 1,
      data.business_maturity_score ?? null,
      data.business_maturity_notes || null,
      data.primary_social_platform || null,
      data.data_origin || 'manual',
      data.contact_verified == null ? null : (data.contact_verified ? 1 : 0),
      data.created_by || null,
    ]
  );
}

/** Find a business by exact id (account-scoped). */
export async function findBusiness(accountId, id) {
  const rows = await query(
    'SELECT * FROM businesses WHERE id = ? AND account_id = ?',
    [Number(id), Number(accountId)]
  );
  return rows[0] || null;
}

/** Bulk lookup by ids (account-scoped). */
export async function findByIds(accountId, ids) {
  if (!ids?.length) return [];
  const nums = [...new Set(ids.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  if (!nums.length) return [];
  return query(
    `SELECT * FROM businesses WHERE account_id = ? AND id IN (${nums.map(() => '?').join(',')})`,
    [Number(accountId), ...nums]
  );
}

/**
 * Deduplicating lookup: matches on normalized name, website or phone, then on
 * social / external identifiers recorded on business_sources.
 * Returns the first match found (name match is strongest).
 * Dedup NEVER crosses account boundaries.
 */
export async function findBusinessByMatch(accountId, { name, website, phone, socialUrl, externalId } = {}) {
  if (name) {
    const key = normalizeBusinessName(name);
    if (key) {
      const rows = await query(
        'SELECT * FROM businesses WHERE normalized_name = ? AND account_id = ? LIMIT 1',
        [key, Number(accountId)]
      );
      if (rows[0]) return rows[0];
    }
  }
  const websiteNorm = normalizeWebsite(website);
  if (websiteNorm) {
    const rows = await query(
      'SELECT * FROM businesses WHERE website_normalized = ? AND account_id = ? LIMIT 1',
      [websiteNorm, Number(accountId)]
    );
    if (rows[0]) return rows[0];
  }
  const phoneNorm = normalizePhone(phone);
  if (phoneNorm) {
    const rows = await query(
      `SELECT b.* FROM businesses b
        JOIN business_contacts c ON c.business_id = b.id AND c.contact_type IN ('phone','whatsapp')
       WHERE b.account_id = ? AND c.contact_value_normalized = ? LIMIT 1`,
      [Number(accountId), phoneNorm]
    );
    if (rows[0]) return rows[0];
  }
  // Social / external identifier match via sources
  const social = socialUrl
    ? normalizeSocialHandle(socialUrl)?.normalized || null
    : (website && /^(https?:\/\/)?(www\.)?(facebook|instagram|linkedin|x|twitter|tiktok)\./i.test(website)
        ? normalizeSocialHandle(website)?.normalized : null);
  if (social) {
    const rows = await query(
      `SELECT b.* FROM businesses b
        JOIN business_sources s ON s.business_id = b.id
       WHERE b.account_id = ? AND s.external_identifier = ? LIMIT 1`,
      [Number(accountId), social]
    );
    if (rows[0]) return rows[0];
  }
  // Explicit source identifier (OSM node id, Google place id, feed/lead id):
  // the same listing re-observed by any provider must map to one business.
  if (externalId) {
    const rows = await query(
      `SELECT b.* FROM businesses b
        JOIN business_sources s ON s.business_id = b.id
       WHERE b.account_id = ? AND s.external_identifier = ? LIMIT 1`,
      [Number(accountId), externalId]
    );
    if (rows[0]) return rows[0];
  }
  return null;
}

/** create-or-return-existing, the standard entry point for imports and manual adds. */
export async function findOrCreateBusiness(accountId, data) {
  const existing = await findBusinessByMatch(accountId, { name: data.name, website: data.website, phone: data.phone });
  if (existing) return { business: existing, businessId: existing.id, id: existing.id, created: false };
  const id = await createBusiness({ ...data, account_id: accountId });
  return { businessId: id, id, created: true };
}

export async function updateBusiness(accountId, id, data) {
  await query(
    `UPDATE businesses SET name = ?, normalized_name = ?, industry = ?, description = ?,
       location = ?, country = ?, website = ?, website_normalized = ?, phone_normalized = ?,
       estimated_size = ?, employee_signal = ?, branch_count = ?,
       business_maturity_score = ?, business_maturity_notes = ?, primary_social_platform = ?
     WHERE id = ? AND account_id = ?`,
    [
      data.name,
      normalizeBusinessName(data.name),
      data.industry || null,
      data.description || null,
      data.location || null,
      data.country || null,
      data.website || null,
      normalizeWebsite(data.website),
      normalizePhone(data.phone),
      data.estimated_size || null,
      data.employee_signal || null,
      Number(data.branch_count) > 0 ? Math.floor(Number(data.branch_count)) : 1,
      data.business_maturity_score ?? null,
      data.business_maturity_notes || null,
      data.primary_social_platform || null,
      Number(id),
      Number(accountId),
    ]
  );
}

// ------------------------------------------------------------------ sources

export async function addSource({ account_id, business_id, source_type, source_name, source_url, external_identifier, source_status }) {
  return insert(
    `INSERT INTO business_sources (account_id, business_id, source_type, source_name, source_url, external_identifier, source_status)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE source_url = VALUES(source_url), updated_at = NOW()`,
    [
      Number(account_id) || null,
      Number(business_id),
      source_type || 'other',
      source_name,
      source_url || null,
      external_identifier || null,
      source_status || 'active',
    ]
  );
}

export async function listSources(accountId, businessId) {
  return query(
    `SELECT * FROM business_sources
      WHERE account_id = ? AND business_id = ? ORDER BY discovered_at DESC`,
    [Number(accountId), Number(businessId)]
  );
}

// ------------------------------------------------------------------ contacts

export async function addContact({ account_id, business_id, contact_type, contact_value, is_public = 1,
                                   verification_status = 'unverified', confidence_score = 0.5,
                                   source_id = null }) {
  const type = contact_type || inferContactType(contact_value);
  let normalized = String(contact_value).trim().toLowerCase();
  if (type === 'phone' || type === 'whatsapp') {
    normalized = normalizePhone(contact_value);
  } else if (type === 'social' || type === 'website_form') {
    normalized = normalizeWebsite(contact_value);
  }
  if (!normalized) throw new Error('Contact value is empty after normalization');

  // CONTACT RULES:
  //  - explicit WhatsApp publication/confirmation -> 'verified_public_whatsapp'
  //  - phone without confirmed WhatsApp           -> 'phone_only'
  //  - PHONE_ONLY is never converted to WhatsApp automatically.
  if (type === 'whatsapp') {
    if (!['source_published', 'user_confirmed', 'verified_public_whatsapp'].includes(verification_status)) {
      throw new Error('A WhatsApp number can only be stored when the source explicitly identifies it as WhatsApp, or you confirmed it directly.');
    }
    if (verification_status === 'source_published') verification_status = 'verified_public_whatsapp';
  }
  if (type === 'phone' && !['user_confirmed'].includes(verification_status)) {
    verification_status = 'phone_only';
  }

  const existing = await query(
    `SELECT id FROM business_contacts
      WHERE account_id = ? AND business_id = ? AND contact_type = ? AND contact_value_normalized = ?`,
    [Number(account_id), Number(business_id), type, normalized]
  );
  if (existing[0]) {
    await query(
      `UPDATE business_contacts SET verification_status = ?, confidence_score = GREATEST(confidence_score, ?),
         source_id = COALESCE(?, source_id), last_verified_at = IF(? = 'user_confirmed', NOW(), last_verified_at)
       WHERE id = ?`,
      [verification_status, Number(confidence_score), source_id, verification_status, existing[0].id]
    );
    return existing[0].id;
  }
  return insert(
    `INSERT INTO business_contacts
       (account_id, business_id, contact_type, contact_value, contact_value_normalized, is_public,
        verification_status, confidence_score, source_id, last_verified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, IF(? = 'user_confirmed', NOW(), NULL))`,
    [Number(account_id), Number(business_id), type, String(contact_value).trim(), normalized, is_public ? 1 : 0,
     verification_status, Number(confidence_score), source_id, verification_status]
  );
}

export async function listContacts(accountId, businessId) {
  return query(
    `SELECT c.*, s.source_name AS contact_source, s.source_url AS source_url
       FROM business_contacts c LEFT JOIN business_sources s ON s.id = c.source_id
      WHERE c.account_id = ? AND c.business_id = ? AND c.is_public = 1
      ORDER BY FIELD(c.contact_type, 'email','whatsapp','phone','social','website_form','other'), c.confidence_score DESC`,
    [Number(accountId), Number(businessId)]
  );
}

export async function findContact(accountId, contactId) {
  const rows = await query(
    'SELECT * FROM business_contacts WHERE id = ? AND account_id = ?',
    [Number(contactId), Number(accountId)]
  );
  return rows[0] || null;
}

export async function deleteContact(accountId, id) {
  await query('DELETE FROM business_contacts WHERE id = ? AND account_id = ?', [Number(id), Number(accountId)]);
}

// ------------------------------------------------------------------ listing

const LIST_SELECT = `
  SELECT b.*,
         (SELECT COUNT(*) FROM opportunities o WHERE o.business_id = b.id) AS opportunity_count,
         (SELECT COUNT(*) FROM business_evidence e WHERE e.business_id = b.id) AS evidence_count
    FROM businesses b`;

export async function list({ accountId, q = '', limit = 100 } = {}) {
  const params = [Number(accountId)];
  let sql = `${LIST_SELECT} WHERE b.account_id = ?`;
  if (q) {
    sql += ' AND (b.name LIKE ? OR b.industry LIKE ? OR b.location LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += ` ORDER BY b.updated_at DESC LIMIT ${Number(limit)}`;
  return query(sql, params);
}

export async function findByNameKey(accountId, normalizedName) {
  const rows = await query(
    'SELECT * FROM businesses WHERE normalized_name = ? AND account_id = ? LIMIT 1',
    [normalizedName, Number(accountId)]
  );
  return rows[0] || null;
}

export async function deleteBusiness(accountId, id) {
  await query('DELETE FROM businesses WHERE id = ? AND account_id = ?', [Number(id), Number(accountId)]);
}