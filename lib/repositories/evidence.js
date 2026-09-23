import { query, insert } from '@/lib/db';

/**
 * Evidence repository — the evidence principle lives here.
 * Every row: business_id, source_id (provenance), claim_type FACT|INFERENCE|HYPOTHESIS,
 * evidence_text, source_excerpt_summary, confidence_score.
 * Multi-tenant: every query is scoped to the caller's account via accountId.
 */

export async function addEvidence({ account_id, business_id, source_id = null, evidence_type = 'observation',
                                    claim_type = 'FACT', signal_key = null, evidence_text,
                                    source_excerpt_summary = null, confidence_score = 0.5,
                                    captured_by = null }) {
  return insert(
    `INSERT INTO business_evidence
       (account_id, business_id, source_id, evidence_type, claim_type, signal_key,
        evidence_text, source_excerpt_summary, confidence_score, captured_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      Number(account_id) || null,
      Number(business_id),
      source_id ? Number(source_id) : null,
      evidence_type,
      ['FACT', 'INFERENCE', 'HYPOTHESIS'].includes(claim_type) ? claim_type : 'FACT',
      signal_key || null,
      String(evidence_text).slice(0, 5000),
      source_excerpt_summary || null,
      Math.min(1, Math.max(0, Number(confidence_score) || 0.5)),
      captured_by || null,
    ]
  );
}

export async function findById(accountId, id) {
  const rows = await query(
    'SELECT * FROM business_evidence WHERE id = ? AND account_id = ?',
    [Number(id), Number(accountId)]
  );
  return rows[0] || null;
}

export async function listForBusiness(accountId, businessId) {
  return query(
    `SELECT e.*, s.source_name, s.source_url
       FROM business_evidence e LEFT JOIN business_sources s ON s.id = e.source_id
      WHERE e.business_id = ? AND e.account_id = ?
      ORDER BY e.captured_at DESC, e.id DESC`,
    [Number(businessId), Number(accountId)]
  );
}

export async function countForBusiness(accountId, businessId) {
  const rows = await query(
    'SELECT COUNT(*) AS n FROM business_evidence WHERE business_id = ? AND account_id = ?',
    [Number(businessId), Number(accountId)]
  );
  return Number(rows[0]?.n || 0);
}

/** Research evidence = non-HYPOTHESIS rows. HYPOTHESIS follow-up notes (e.g. "no
 *  public contact found") never count as research evidence. */
export async function countResearchEvidenceForBusiness(accountId, businessId) {
  const rows = await query(
    `SELECT COUNT(*) AS n FROM business_evidence
      WHERE business_id = ? AND account_id = ? AND claim_type != 'HYPOTHESIS'`,
    [Number(businessId), Number(accountId)]
  );
  return Number(rows[0]?.n || 0);
}

/** All evidence texts for a business (for deduping inserted evidence). */
export async function getTextsForBusiness(accountId, businessId) {
  const rows = await query(
    'SELECT evidence_text FROM business_evidence WHERE business_id = ? AND account_id = ?',
    [Number(businessId), Number(accountId)]
  );
  return rows.map((r) => String(r.evidence_text || ''));
}

export async function updateEvidence(accountId, id, data) {
  await query(
    `UPDATE business_evidence SET evidence_type = ?, claim_type = ?, signal_key = ?,
       evidence_text = ?, source_excerpt_summary = ?, confidence_score = ?
     WHERE id = ? AND account_id = ?`,
    [
      data.evidence_type,
      ['FACT', 'INFERENCE', 'HYPOTHESIS'].includes(data.claim_type) ? data.claim_type : 'FACT',
      data.signal_key || null,
      String(data.evidence_text).slice(0, 5000),
      data.source_excerpt_summary || null,
      Math.min(1, Math.max(0, Number(data.confidence_score) || 0.5)),
      Number(id),
      Number(accountId),
    ]
  );
}

export async function removeEvidence(accountId, id) {
  await query('DELETE FROM business_evidence WHERE id = ? AND account_id = ?', [Number(id), Number(accountId)]);
}

/**
 * Aggregate signal support from accepted evidence — input to the analyzer.
 * Unconfirmed HYPOTHESIS claims never drive automatic opportunity detection;
 * only FACT / INFERENCE (and explicitly accepted statements) count as signal.
 */
export async function signalsForBusiness(accountId, businessId) {
  const rows = await query(
    `SELECT signal_key, COUNT(*) AS support_count, MAX(confidence_score) AS max_confidence,
            AVG(confidence_score) AS avg_confidence
       FROM business_evidence
      WHERE business_id = ? AND account_id = ? AND signal_key IS NOT NULL AND signal_key != ''
        AND claim_type != 'HYPOTHESIS'
      GROUP BY signal_key`,
    [Number(businessId), Number(accountId)]
  );
  const map = {};
  for (const row of rows) {
    map[row.signal_key] = {
      support_count: Number(row.support_count),
      max_confidence: Number(row.max_confidence),
      avg_confidence: Number(row.avg_confidence),
    };
  }
  return map;
}

export async function evidenceBySignal(accountId, businessId) {
  const rows = await query(
    `SELECT * FROM business_evidence
      WHERE business_id = ? AND account_id = ? AND signal_key IS NOT NULL AND signal_key != ''
        AND claim_type != 'HYPOTHESIS'
      ORDER BY confidence_score DESC`,
    [Number(businessId), Number(accountId)]
  );
  const map = {};
  for (const ev of rows) (map[ev.signal_key] ||= []).push(ev);
  return map;
}