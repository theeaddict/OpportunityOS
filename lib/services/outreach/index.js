import * as opportunitiesRepo from '@/lib/repositories/opportunities';
import * as financialRepo from '@/lib/repositories/financial';
import * as businessesRepo from '@/lib/repositories/businesses';
import * as solutionsRepo from '@/lib/repositories/solutions';
import * as outreachRepo from '@/lib/repositories/outreach';
import { runOutreachAgent } from '@/lib/ai/agents/outreach.js';
import { updatePipeline } from '@/lib/repositories/financial';
import { HttpError } from '@/lib/api-helpers';

const DISPLAY_PREFIX = /^\[DEMO\]\s*/i;

function displayName(business) {
  return String(business.name || '').replace(DISPLAY_PREFIX, '').trim() || business.name;
}

/** Human, natural way to address the business (location-aware). */
function place(business) {
  return [business.location, business.country].filter(Boolean).join(', ');
}

/**
 * Pick the single strongest usable piece of linked evidence (FACT over
 * INFERENCE, highest confidence) to ground a SPECIFIC, honest observation.
 * HYPOTHESIS is never used in outreach — it stays internal.
 */
function strongestEvidence(evidence = []) {
  const usable = evidence.filter((e) => String(e.claim_type).toUpperCase() !== 'HYPOTHESIS');
  return usable
    .sort((a, b) => (Number(b.confidence_score) || 0) - (Number(a.confidence_score) || 0))[0] || null;
}

/** Strip a leading "Short title — " prefix so the message reads conversationally. */
function coreText(text) {
  const s = String(text || '').trim();
  const m = s.match(/^[^—-]+—\s*(.+)$/);
  if (m && m[1].trim().length > 16) return m[1].trim();
  return s;
}

function lowerFirst(s) {
  if (!s) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function scenarioLine(scenarios = []) {
  if (!scenarios.length) return null;
  const s = scenarios[0];
  const low = Number(s.impact_low ?? s.low_value);
  const high = Number(s.impact_high ?? s.high_value);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  return `${String(s.scenario_type).replaceAll('_', ' ')} worth roughly ${low.toLocaleString()}–${high.toLocaleString()} ${s.currency}/year, IF the assumptions on file hold — not a promise`;
}

/**
 * A specific, evidence-grounded observation in the "I noticed…" voice the
 * Personalized Outreach Engine requires. Never asserts the business is "losing
 * money" — it references what the evidence actually shows.
 */
function observationSentence(evidence) {
  const e = strongestEvidence(evidence);
  if (!e) return 'I was looking at how you currently handle orders and enquiries.';
  const core = coreText(e.evidence_text).replace(/[.;,]+$/, '').trim();
  return `I noticed ${lowerFirst(core)}.`;
}

function simpleSolution(solution) {
  if (!solution) return 'a simple way to organise this online';
  const n = String(solution.name || '').trim();
  return n ? n.toLowerCase() : 'a simple way to organise this online';
}

/**
 * Build the three outreach variants — short (casual WhatsApp), normal
 * (friendly-professional), professional (formal). All follow the P-12 structure:
 * natural intro → specific observation → specific opportunity/problem → simple
 * solution → low-pressure CTA. No "I help businesses…", no unsupported claims,
 * no robotic language.
 */
export function buildPersonalizedVariants({ business, opportunity, solution, evidence, scenarios = [], senderName = null }) {
  const biz = displayName(business);
  const where = place(business);
  const observation = observationSentence(evidence);
  const problem = opportunity.problem ? lowerFirst(String(opportunity.problem)) : 'orders and enquiries can fall through the cracks';
  const why = opportunity.why_it_matters ? String(opportunity.why_it_matters) : null;
  const sol = simpleSolution(solution);
  const scenario = scenarioLine(scenarios);
  const location = where ? ` in ${where}` : '';

  const ctaShort = 'If you\u2019re keen, I can walk you through it on WhatsApp \u2014 no pressure.';
  const ctaNormal = 'If you\u2019d like, I can put together a small demo around this so you can see what I mean \u2014 whenever it\u2019s convenient, no obligation.';
  const ctaPro = 'Should it be of interest, I\u2019d be glad to put together a short, no-obligation demo so you can see exactly what this would look like in practice.';

  const short = `Hi ${biz},\n\n${observation}\n\nI had an idea around that which could make it easier for customers to place orders, so you don\u2019t have to chase them. ${ctaShort}`;

  const normal = [
    `Hi, ${biz}${location}.`,
    '',
    `One thing that caught my attention while looking at how you take orders: ${lowerFirst(observation.slice('I noticed '.length)) ?? observation}`,
    '',
    `It looks like ${problem} \u2014 which is normal at this stage.`,
    why ? `The thing is, ${lowerFirst(why)}.` : '',
    '',
    `I build simple systems (like ${sol}) that help shops capture the orders they\u2019re already getting, without changing how they do business day to day.`,
    '',
    ctaNormal,
  ].filter((l) => l !== '').join('\n');

  const professional = [
    `Hello ${biz},`,
    '',
    `I have been looking at how ${biz}${location} currently takes orders and follows up enquiries. One thing stood out: ${lowerFirst(observation.replace(/^I noticed\s*/i, ''))}`,
    '',
    `This points to ${problem}.`,
    why ? `Commercially, this matters because ${lowerFirst(why)}.` : '',
    scenario ? `Under the assumptions on file, addressing this could be ${scenario}. Please note this is illustrative, not a guarantee.` : '',
    `The sort of thing I put together for shops like this is ${sol}.`,
    '',
    ctaPro,
    '',
    'Best regards,',
    senderName || 'A software provider',
  ].filter((l) => l !== '').join('\n');

  return { short, normal, professional };
}

/**
 * Personalized Outreach Engine entry point.
 * Produces short / normal / professional WhatsApp drafts grounded in linked
 * evidence, saved UNAPPROVED for human review. No automated sending ever.
 * Uses the AI agent when configured; otherwise the deterministic,
 * evidence-based engine above (clearly labeled template-generated).
 */
export async function generateDraft({ accountId, opportunityId, userId }) {
  const opportunity = await opportunitiesRepo.findById(accountId, opportunityId);
  if (!opportunity) throw new HttpError(404, 'Opportunity not found');
  const business = await businessesRepo.findBusiness(accountId, opportunity.business_id);
  const evidence = await opportunitiesRepo.linkedEvidence(accountId, opportunityId);
  if (!evidence.length) throw new HttpError(400, 'No linked evidence — add evidence before writing outreach');

  const usableEvidence = evidence.filter((e) => String(e.claim_type).toUpperCase() !== 'HYPOTHESIS');
  if (!usableEvidence.length) {
    throw new HttpError(400, 'Outreach needs at least one FACT or INFERENCE with a source — this opportunity only has hypotheses');
  }

  // Honor any past opt-out at the opportunity level before generating more.
  const existingMessages = await outreachRepo.listForOpportunity(accountId, opportunityId);
  if (existingMessages.some((m) => m.lifecycle_status === 'opted_out')) {
    throw new HttpError(409, 'This recipient has opted out of outreach — not generating further messages.');
  }

  const links = await opportunitiesRepo.solutionLinks(accountId, opportunityId);
  const solutionLink = links.find((l) => l.recommended) || links[0] || null;
  const solution = solutionLink ? await solutionsRepo.findById(accountId, solutionLink.solution_id) : null;
  const scenarios = await financialRepo.listScenarios(accountId, opportunityId);

  // Localized, evidence-based deterministic variants.
  const t = buildPersonalizedVariants({ business, opportunity, solution, evidence, scenarios });
  const variants = [
    ['short', t.short],
    ['normal', t.normal],
    ['professional', t.professional],
  ];
  let aiModel = null;

  const result = await runOutreachAgent({ business, opportunity, solution, evidence: usableEvidence, userId, accountId });
  if (result.ok) {
    variants[0][1] = result.data.short_whatsapp;
    variants[1][1] = result.data.normal_whatsapp;
    variants[2][1] = result.data.professional_whatsapp;
    aiModel = result.meta?.model || null;
  } else if (result.reason === 'failed' || result.reason === 'invalid') {
    // AI was configured but failed (e.g. no credits). Never lose the feature:
    // fall back to the deterministic, evidence-based engine and label it clearly
    // as template-generated rather than pretending AI wrote it.
    console.error(`[outreach] AI fallback (${result.reason}): ${result.error || ''}`);
  }
  // not_configured or failed → keep the deterministic variants above (template-generated).

  const ids = [];
  for (const [variant, text] of variants) {
    ids.push(await outreachRepo.createOutreach({
      account_id: accountId,
      opportunity_id: opportunityId,
      message_type: 'whatsapp',
      variant,
      message_text: text,
      ai_model: aiModel,
      generation_status: 'generated',
      approved: 0,
      lifecycle_status: 'generated',
    }));
  }
  return { messageIds: ids, generatedBy: aiModel ? 'llm' : 'template_not_configured', jobId: result.jobId };
}

/** Approval guard: message must be approved before it can be sent/contacted. */
export async function approveMessage(accountId, messageId) {
  const msg = await outreachRepo.findById(accountId, messageId);
  if (!msg) throw new HttpError(404, 'Message not found');
  if (msg.opted_out_at) throw new HttpError(409, 'This recipient has opted out — cannot approve outreach.');
  await outreachRepo.updateDraft(accountId, messageId, { message_text: msg.message_text, approved: 1 });
  await outreachRepo.setLifecycle(accountId, messageId, 'approved');
  return true;
}

/**
 * Mark a message as sent/contacted (backward-compatible with the existing
 * sent_status flow). Guard rails: approved=1 AND a public contact on file.
 */
export async function markSent(accountId, messageId, userId = null) {
  const msg = await outreachRepo.findById(accountId, messageId);
  if (!msg) throw new HttpError(404, 'Message not found');
  if (msg.opted_out_at) throw new HttpError(409, 'This recipient has opted out — do not contact.');
  if (!msg.approved) throw new HttpError(400, 'Approve the message before marking it as sent');
  const opportunity = await opportunitiesRepo.findById(accountId, msg.opportunity_id);
  const contacts = await businessesRepo.listContacts(accountId, opportunity.business_id);
  if (!contacts.some((c) => c.contact_value)) {
    throw new HttpError(400, 'Link a public business contact before sending outreach');
  }
  await outreachRepo.markSent(accountId, messageId, 'sent');
  await outreachRepo.setLifecycle(accountId, messageId, 'contacted');
  await updatePipeline(accountId, msg.opportunity_id, 'contacted',
    { notes: `Outreach (${msg.message_type}${msg.variant ? ` · ${msg.variant}` : ''}) marked as sent`, actor_user_id: userId });
  return true;
}

/**
 * Lifecycle transition for the Personalized Outreach Engine.
 * Human-driven, never automatic. Refuses any action once the recipient has
 * opted out; requires approval before "contacted". Returns the resulting
 * message state plus anything the UI needs to show.
 */
const ACTION_PIPELINE = {
  contacted: 'contacted',
  replied: 'replied',
  proposal: 'proposal',
  won: 'won',
  lost: 'lost',
};

export async function advanceMessage(accountId, messageId, action, userId = null) {
  const msg = await outreachRepo.findById(accountId, messageId);
  if (!msg) throw new HttpError(404, 'Message not found');

  if (action === 'opted_out') {
    await outreachRepo.markOptedOut(accountId, messageId);
    return { lifecycle_status: 'opted_out', stopped: true };
  }
  if (msg.opted_out_at) {
    throw new HttpError(409, 'This recipient has opted out — no further automated outreach.');
  }

  if (action === 'approve') {
    await approveMessage(accountId, messageId);
    return { lifecycle_status: 'approved' };
  }

  if (action === 'contacted') {
    if (!msg.approved) throw new HttpError(400, 'Approve the message before marking it as contacted');
    const opportunity = await opportunitiesRepo.findById(accountId, msg.opportunity_id);
    const contacts = await businessesRepo.listContacts(accountId, opportunity.business_id);
    if (!contacts.some((c) => c.contact_value)) {
      throw new HttpError(400, 'Link a public business contact before contacting');
    }
    await outreachRepo.markSent(accountId, messageId, 'sent');
    await outreachRepo.setLifecycle(accountId, messageId, 'contacted');
    await updatePipeline(accountId, msg.opportunity_id, ACTION_PIPELINE.contacted,
      { notes: `Outreach (${msg.message_type}${msg.variant ? ` · ${msg.variant}` : ''}) marked contacted`, actor_user_id: userId });
    return { lifecycle_status: 'contacted' };
  }

if (ACTION_PIPELINE[action]) {
    if (!msg.approved) throw new HttpError(400, 'Approve the message before advancing it');
    await outreachRepo.setLifecycle(accountId, messageId, action);
    await updatePipeline(accountId, msg.opportunity_id, ACTION_PIPELINE[action],
      { notes: `Outreach lifecycle → ${action} (${msg.message_type}${msg.variant ? ` · ${msg.variant}` : ''})`, actor_user_id: userId });
    return { lifecycle_status: action };
  }

  throw new Error(`Unknown outreach action: ${action}`);
}
