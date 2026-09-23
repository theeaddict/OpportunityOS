import * as opportunitiesRepo from '@/lib/repositories/opportunities';
import * as businessesRepo from '@/lib/repositories/businesses';
import * as solutionsRepo from '@/lib/repositories/solutions';
import { runDemoSpecAgent } from '@/lib/ai/agents/demo-spec.js';
import { generateDemoSpec } from '@/lib/services/demo/index.js';
import { templateDemoSpec } from '@/lib/services/analysis/rules-analyzer';
import { audit } from '@/lib/audit';
import { requireAccount, HttpError, jsonOk, handleRouteError } from '@/lib/api-helpers';
import { isMember } from '@/lib/accounts/roles';
import { assertWithinLimit } from '@/lib/accounts/usage';
import { hasVerifiedContact, isRejectedOpportunity } from '@/lib/services/gating';

export async function POST(request, { params }) {
  try {
    const user = await requireAccount();
    const { id } = await params;
    const opportunityId = Number(id);
    const opportunity = await opportunitiesRepo.findById(user.account_id, opportunityId);
    if (!opportunity) return Response.json({ ok: false, error: 'Opportunity not found' }, { status: 404 });
    if (isMember(user) && opportunity.assignee_id != user.id) {
      throw new HttpError(403, 'You do not have permission to do this');
    }
    await assertWithinLimit(user.account_id, 'demo_generations');

    const business = await businessesRepo.findBusiness(user.account_id, opportunity.business_id);
    const links = await opportunitiesRepo.solutionLinks(user.account_id, opportunityId);
    const bestLink = links.find((l) => l.recommended) || links[0];
    const solution = bestLink ? await solutionsRepo.findById(user.account_id, bestLink.solution_id) : null;
    if (!solution) {
      return Response.json({ ok: false, error: 'Match a solution first (run analysis)' }, { status: 400 });
    }
    if (isRejectedOpportunity(opportunity)) {
      return Response.json(
        { ok: false, error: 'This opportunity is scored REJECT — demo generation is disabled until the score improves.' },
        { status: 409 },
      );
    }
    const contacts = await businessesRepo.listContacts(user.account_id, opportunity.business_id);
    if (!hasVerifiedContact(contacts)) {
      return Response.json(
        { ok: false, error: 'Add a verified public contact on the business before generating a demo' },
        { status: 409 },
      );
    }

    // 1. Build the template-based concept demo (always available).
    let spec = generateDemoSpec({ business, opportunity, solution });
    let provider = 'template';

    // 2. Try AI enhancement — if it succeeds, merge its richer content into the
    //    template-based spec. If it fails, the template spec is always good enough.
    const result = await runDemoSpecAgent({ business, opportunity, solution, userId: user.id, accountId: user.account_id });
    if (result.ok && result.data) {
      // Merge AI output: use AI pages/features/workflow if they are richer, but
      // always keep the concept demo labeling and sample data from the template.
      const aiSpec = result.data;
      spec = {
        ...spec,
        demo_name: aiSpec.demo_name || spec.demo_name,
        pages: aiSpec.pages?.length > spec.pages.length ? aiSpec.pages : spec.pages,
        features: aiSpec.features?.length > spec.features.length ? aiSpec.features : spec.features,
        workflow: aiSpec.workflow?.length > spec.workflow.length ? aiSpec.workflow : spec.workflow,
        customization_points: aiSpec.customization_points?.length > spec.customization_points.length
          ? aiSpec.customization_points : spec.customization_points,
        _ai_enhanced: true,
        _ai_model: result.meta?.model || null,
      };
      provider = 'llm_enhanced';
    }
    // If AI failed or was not configured, provider stays 'template' and spec is
    // the template-based concept demo. Never throw on AI failure.

    await audit('demo_spec.generated', {
      entity_type: 'opportunities', entity_id: opportunityId,
      metadata: { provider, job_id: result.jobId || null, industry: spec.industry },
      user_id: user.id, account_id: user.account_id,
    });
    return jsonOk({ spec });
  } catch (err) {
    return handleRouteError(err);
  }
}
