import { interpretResearch } from '@/lib/services/analysis';
import { audit } from '@/lib/audit';
import { requireAccount, requireRole, jsonOk, handleRouteError } from '@/lib/api-helpers';
import { enforce } from '@/lib/rate-limit';

export async function POST(request, { params }) {
  try {
    const user = await requireAccount();
    requireRole(user, 'admin'); // AI interpretation spends the account's analysis allowance
    enforce(request, { limit: 60, windowMs: 60 * 60_000, key: 'interpret' });
    const { id } = await params;
    const result = await interpretResearch(user.account_id, Number(id), user.id);
    if (!result.ok && result.reason === 'not_configured') {
      return Response.json(
        { ok: false, error: 'AI interpretation requires a configured provider (AI_API_KEY / AI_MODEL). Manual research works without it.' },
        { status: 501 }
      );
    }
    if (!result.ok) return Response.json({ ok: false, error: result.error || 'AI job failed' }, { status: 502 });
    await audit('research.ai_interpreted', {
      entity_type: 'businesses', entity_id: Number(id),
      metadata: { job_id: result.jobId }, user_id: user.id, account_id: user.account_id,
    });
    // Output is returned for human review; it is never persisted as fact automatically.
    return jsonOk({ output: result.data });
  } catch (err) {
    if (/Collect some evidence/.test(err.message)) {
      return Response.json({ ok: false, error: err.message }, { status: 400 });
    }
    return handleRouteError(err);
  }
}
