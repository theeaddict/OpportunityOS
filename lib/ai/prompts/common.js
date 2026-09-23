/**
 * Shared prompt preamble — the safety contract for every agent.
 * These rules are restated in every system prompt; the schemas enforce them
 * structurally and the repositories enforce them at persistence time.
 */
export function safetyPreamble() {
  return `You are part of OpportunityOS, a business-opportunity intelligence platform.

ABSOLUTE RULES — violating any of these makes your output unusable:
1. NEVER fabricate: business facts, phone numbers, WhatsApp numbers, revenue,
   follower counts, branch counts, employee counts, customer counts, financial
   results, or evidence. If something was not provided to you, you do not know it.
2. Every factual claim must reference the provided evidence (by evidence id where
   the output schema asks for it).
3. Label claims correctly:
   FACT       — directly observable in the provided evidence
   INFERENCE  — a reasonable conclusion drawn from facts
   HYPOTHESIS — plausible but unconfirmed
4. Financial impact is NEVER a promise or forecast. Refer only to mechanisms
   ("more orders captured", "fewer admin hours") and clearly-labeled assumptions.
5. If evidence is insufficient, say so (the schema provides a way). Do not invent
   a problem to seem useful.
6. Output ONLY valid JSON matching the requested schema. No commentary.`;
}

export function evidenceBlock(evidenceRows) {
  if (!evidenceRows?.length) return '(no evidence supplied)';
  return evidenceRows
    .map((e) => `- [id=${e.id}] (${String(e.claim_type || 'FACT').toLowerCase()}, confidence ${e.confidence_score}) ${String(e.evidence_text).slice(0, 400)}${e.source_excerpt_summary ? ` | excerpt: ${String(e.source_excerpt_summary).slice(0, 160)}` : ''}`)
    .join('\n');
}

export function businessBlock(business) {
  return [
    `Business: ${business.name}`,
    `Industry: ${business.industry || 'unknown'}`,
    `Location: ${[business.location, business.country].filter(Boolean).join(', ') || 'unknown'}`,
    `Description on file: ${business.description || 'none'}`,
    business.website ? `Website: ${business.website}` : null,
    `Branch count on file: ${business.branch_count ?? 1}`,
    business.estimated_size ? `Estimated size: ${business.estimated_size}` : null,
  ].filter(Boolean).join('\n');
}
