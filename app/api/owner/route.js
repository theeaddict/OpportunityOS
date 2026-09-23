import * as ownerRepo from '@/lib/repositories/owner';
import * as opportunitiesRepo from '@/lib/repositories/opportunities';
import { enqueue } from '@/lib/jobs/queue';
import { buildStrategy } from '@/lib/owner/strategy.js';
import { ownerGoal, OWNER_GOALS } from '@/lib/owner/goals.js';
import {
  statusMessage, progressLabel, ownerResultItem, ownerMessage,
} from '@/lib/owner/language.js';
import { audit } from '@/lib/audit';
import { requireAccount, jsonOk, handleRouteError, readJson } from '@/lib/api-helpers';
import { assertWithinLimit } from '@/lib/accounts/usage';
import { defaultProvider } from '@/lib/services/discovery';

/**
 * Business Owner Mode API. Everything here is phrased for a business owner.
 */

const GOALS = Object.values(OWNER_GOALS).map(({ key, label }) => ({ key, label }));

export async function GET(request) {
  try {
    const user = await requireAccount();
    const url = new URL(request.url);
    const jobId = url.searchParams.get('job_id');

    const profile = await ownerRepo.getOwnerProfile(user.id);

    // A status + results poll for a running owner run.
    if (jobId) {
      const job = await ownerRepo.ownerJobById(user.id, jobId);
      if (!job) return Response.json({ ok: false, error: 'Run not found' }, { status: 404 });
      return jsonOk(await runView(user, profile, job));
    }

    const recentRuns = await ownerRepo.ownerJobs(user.id, 5);
    return jsonOk({
      profile,
      strategy: profile?.strategy || null,
      goals: GOALS,
      recent_runs: recentRuns,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** Save (or update) the owner's onboarding answers and derive the strategy. */
export async function POST(request) {
  try {
    const user = await requireAccount();
    const body = await readJson(request);
    if (body.onboard) {
      const raw = {
        business_name: body.business_name,
        sell_what: body.sell_what,
        location: body.location,
        ideal_customers: body.ideal_customers,
        goals: Array.isArray(body.goals) ? body.goals.slice(0, 9) : [],
      };
      const profile = await ownerRepo.saveOwnerProfile(user.id, raw);
      const strategy = buildStrategy(profile).strategy;
      await ownerRepo.saveOwnerProfile(user.id, { ...raw, strategy });
      const updated = await ownerRepo.getOwnerProfile(user.id);
      await audit('owner.onboarded', {
        entity_type: 'owner_profiles', entity_id: updated.id,
        metadata: { goals: updated.goals }, user_id: user.id, account_id: user.account_id,
      }).catch(() => {});
      return jsonOk({ profile: updated, strategy: updated.strategy, goals: GOALS });
    }

    if (body.action === 'run') {
      const profile = await ownerRepo.getOwnerProfile(user.id);
      if (!profile || !profile.strategy) {
        return Response.json({ ok: false, error: 'Answer the questions first' }, { status: 400 });
      }
      // Plan caps before enqueuing the scan (researches + opportunity creation).
      await assertWithinLimit(user.account_id, 'researches');
      await assertWithinLimit(user.account_id, 'opportunities');
      const filters = profile.strategy.filters || {};
      const payload = {
        provider: defaultProvider(),
        filters,
        owner_run: true,
      };
      const { id, duplicate } = await enqueue({
        type: 'DISCOVERY',
        payload,
        dedupParams: { owner: user.id, filters },
        createdBy: user.id,
        accountId: user.account_id,
      });
      await audit('owner.run', {
        entity_type: 'background_jobs', entity_id: id,
        metadata: { duplicate }, user_id: user.id, account_id: user.account_id,
      }).catch(() => {});
      return jsonOk({ job_id: id, started: true, duplicate });
    }

    return Response.json({ ok: false, error: 'Unknown request' }, { status: 400 });
  } catch (err) {
    return handleRouteError(err);
  }
}

async function runView(user, profile, job) {
  const base = {
    job: {
      id: job.id,
      status: job.status,
      progress: job.progress,
      stage: job.stage,
      attempts: job.attempts,
      error: job.error,
    },
    message: statusMessage(job.status, job.progress, job.stage, job.error),
    progress_label: progressLabel(job.status, job.progress),
    strategy: profile?.strategy || null,
  };
  if (job.status !== 'completed') return base;

  const result = job.result || {};
  const ids = (result.opportunity_ids || []).map(Number).filter(Boolean);
  const rows = ids.length ? await opportunitiesRepo.listByIds(user.account_id, ids) : [];
  const scored = rows.filter((o) => o.opportunity_score != null);
  const found = scored.length;

  const summary = found > 0
    ? { headline: `${found} ${found === 1 ? 'opportunity' : 'opportunities'} found`, tone: 'positive' }
    : { headline: 'No strong opportunities found yet', tone: 'empty' };

  const goal = ownerGoal((profile?.goals || [])[0]);

  const results = scored.map((opp) => ({
    ...ownerResultItem(opp),
    message_body: ownerMessage({
      customerName: opp.business_name,
      ownerBusiness: profile?.business_name,
      ownerLocation: profile?.location,
      goal,
      why: opp.why_it_matters || opp.problem,
    }),
    message_tag: ownerTag(profile?.goals || []),
  }));

  const studied = Number(result.businesses_researched || 0);
  summary.subtext = found > 0
    ? (studied
      ? `We studied ${studied} business${studied === 1 ? '' : 'es'} and ${found} stood out as strong match${found === 1 ? '' : 'es'} for you.`
      : `${found} stood out as a strong match for you.`)
    : (studied > 0
      ? `We studied ${studied} business${studied === 1 ? '' : 'es'} but none matched closely enough yet. Try widening "who are your ideal customers" and run it again.`
      : 'No businesses matched what you described this time. Add a few more words to "who are your ideal customers" and try again.');

  const followUp = Number(result.manual_follow_up || 0);
  if (followUp > 0) {
    summary.subtext += ` ${followUp} ${followUp === 1 ? 'business was' : 'businesses were'} listed without public contact details — they need manual follow-up to confirm a way to reach them.`;
  }

  return {
    ...base,
    summary,
    results,
    studied,
    found,
  };
}

function ownerTag(goals) {
  const label = ownerGoal((goals || [])[0])?.label;
  return label ? `Goal: ${label}` : 'Business owner run';
}