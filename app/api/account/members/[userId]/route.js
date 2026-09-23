import { requireAccount, requireRole, HttpError, jsonOk, handleRouteError, readJson } from '@/lib/api-helpers';
import * as accountsRepo from '@/lib/repositories/accounts';

export const dynamic = 'force-dynamic';

export async function PATCH(request, { params }) {
  try {
    const user = await requireAccount();
    requireRole(user, 'admin');
    const { userId } = await params;
    const uid = Number(userId);

    const team = await accountsRepo.listUsers(user.account_id);
    const member = team.find((m) => Number(m.id) === Number(uid));
    if (!member) throw new HttpError(404, 'Team member not found in this workspace');

    const body = await readJson(request);

    if (body.role != null && user.id === uid) {
      throw new HttpError(403, 'You cannot change your own role here');
    }
    if (body.role != null) {
      if (member.role === 'owner') throw new HttpError(403, 'The workspace owner role cannot be changed');
      // Owner promotion is not exposed here; ADMIN and MEMBER are assignable.
      if (body.role !== 'admin' && body.role !== 'member' && body.role !== 'owner') {
        throw new HttpError(400, 'Invalid role');
      }
      await accountsRepo.updateUserRole(uid, body.role === 'owner' ? 'admin' : body.role);
    }
    if (body.status != null) {
      if (user.id === uid) throw new HttpError(403, 'You cannot suspend your own account');
      if (member.role === 'owner' && body.status !== 'active') throw new HttpError(403, 'Cannot suspend the workspace owner');
      await accountsRepo.setUserStatus(uid, body.status);
    }

    return jsonOk({ id: uid });
  } catch (err) {
    return handleRouteError(err);
  }
}