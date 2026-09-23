import { getCapabilities, saveCapabilities } from '@/lib/repositories/capabilities';
import { requireUser, jsonOk, handleRouteError, readJson } from '@/lib/api-helpers';

export async function GET() {
  try {
    const user = await requireUser();
    const capabilities = await getCapabilities(user.id);
    return jsonOk({ capabilities });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function PATCH(request) {
  try {
    const user = await requireUser();
    const body = await readJson(request);
    const capabilities = await saveCapabilities(user.id, body);
    return jsonOk({ capabilities });
  } catch (err) {
    return handleRouteError(err);
  }
}