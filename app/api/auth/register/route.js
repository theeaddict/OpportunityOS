import { register } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { handleRouteError, readJson } from '@/lib/api-helpers';
import { isEmail, isNonEmptyString, passwordPolicyError } from '@/lib/validation';
import { enforce } from '@/lib/rate-limit';

export async function POST(request) {
  try {
    enforce(request, { limit: 10, windowMs: 60 * 60_000, key: 'register' });
    const body = await readJson(request);
    if (!isEmail(body.email)) return Response.json({ ok: false, error: 'Enter a valid email' }, { status: 400 });
    if (typeof body.password !== 'string' || !body.password.trim())
      return Response.json({ ok: false, error: 'Password required' }, { status: 400 });
    const pwProblem = passwordPolicyError(body.password);
    if (pwProblem) return Response.json({ ok: false, error: pwProblem }, { status: 400 });
    if (!isNonEmptyString(body.name, 120)) return Response.json({ ok: false, error: 'Name is required' }, { status: 400 });
    const userId = await register(body);
    await audit('user.registered', { entity_type: 'user', entity_id: userId });
    return Response.json({ ok: true });
  } catch (err) {
    if (/already exists/.test(err.message)) return Response.json({ ok: false, error: err.message }, { status: 409 });
    return handleRouteError(err);
  }
}
