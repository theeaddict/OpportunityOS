/**
 * Account role model (SaaS):
 *   OWNER — everything in the workspace (incl. team + plan)
 *   ADMIN — manage opportunities / searches / team
 *   MEMBER — view & manage only the opportunities assigned to them
 * `requireRole(user, 'admin')` means OWNER *or* ADMIN (level >= admin).
 */

export const ROLE_LEVEL = { owner: 3, admin: 2, member: 1 };

export function roleLevel(role) {
  return ROLE_LEVEL[String(role || 'member').toLowerCase()] ?? 1;
}

export function isAtLeast(user, minRole) {
  if (!user) return false;
  return roleLevel(user.role) >= roleLevel(minRole);
}

export const canManageTeam = (user) => isAtLeast(user, 'admin');
export const canEditSolutions = (user) => isAtLeast(user, 'admin');
export const canSeeAllOpportunities = (user) => isAtLeast(user, 'admin');
export const isMember = (user) => String(user?.role || '').toLowerCase() === 'member';