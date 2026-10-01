import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { isAtLeast } from '@/lib/accounts/roles';
import * as accountsRepo from '@/lib/repositories/accounts';
import { getUsage, getAccountLimits } from '@/lib/accounts/usage';
import { PageHeader, Card } from '@/components/ui';
import TeamManager from '@/components/TeamManager';
import BillingUpgrade from '@/components/BillingUpgrade';

export const dynamic = 'force-dynamic';

const USAGE_LABELS = [
  ['researches', 'Business discoveries'],
  ['opportunities', 'Opportunities'],
  ['ai_analyses', 'AI analyses'],
  ['demo_generations', 'Demo generations'],
];

function UsageRow({ label, used, limit }) {
  const pct = limit != null ? Math.min(100, Math.round((used / Math.max(1, limit)) * 100)) : null;
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-sm text-gray-700">{label}</span>
      <span className="text-sm text-gray-500">
        {limit == null ? `${used} / unlimited` : `${used} / ${limit}`}
        {limit != null && (
          <span className={`ml-2 font-medium ${pct >= 100 ? 'text-red-600' : pct >= 80 ? 'text-orange-600' : 'text-gray-400'}`}>{pct}%</span>
        )}
      </span>
    </div>
  );
}

export default async function AccountPage() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) redirect('/login');
  const canManage = isAtLeast(user, 'admin');
  const canManageBilling = isAtLeast(user, 'owner');
  // The roster (names + emails) is a management view; members see counts only.
  const [usage, limits, team, account, plans] = await Promise.all([
    getUsage(user.account_id),
    getAccountLimits(user.account_id),
    canManage ? accountsRepo.listUsers(user.account_id) : Promise.resolve([]),
    accountsRepo.getAccount(user.account_id),
    canManageBilling ? accountsRepo.listPlans() : Promise.resolve([]),
  ]);
  const usersLimit = limits.limits.users;
  const purchasablePlans = plans.filter((p) => p.is_active && p.code !== 'internal');

  return (
    <>
      <PageHeader title="Account" subtitle="Your workspace, plan limits and team." />

      <div className="space-y-6">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Workspace</h2>
              <p className="mt-1 text-2xl font-semibold text-gray-900">{account?.name || 'My workspace'}</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-medium text-gray-700">{limits.plan_name}</p>
              <p className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${limits.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                {limits.status}
              </p>
            </div>
          </div>
          {canManageBilling && (
            <BillingUpgrade
              currentPlanCode={limits.plan}
              plans={purchasablePlans}
              canManage={canManageBilling}
              hasBillingAccount={Boolean(account?.stripe_customer_id)}
            />
          )}
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold text-gray-900">Usage this month</h2>
          <p className="mt-0.5 text-xs text-gray-500">Resets at the start of each month.</p>
          <div className="mt-2 divide-y divide-gray-100">
            {USAGE_LABELS.map(([key, label]) => (
              <UsageRow key={key} label={label} used={usage[key] || 0} limit={limits.limits[key] ?? null} />
            ))}
            <UsageRow label="Team members" used={team.length} limit={usersLimit ?? null} />
          </div>
        </Card>

        {canManage && (
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">Team</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-400">
                    <th className="py-2 pr-4 font-medium">Name</th>
                    <th className="py-2 pr-4 font-medium">Email</th>
                    <th className="py-2 pr-4 font-medium">Role</th>
                    <th className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {team.map((m) => (
                    <tr key={m.id} className="border-b border-gray-100">
                      <td className="py-2 pr-4 font-medium text-gray-900">{m.name}</td>
                      <td className="py-2 pr-4 text-gray-500">{m.email}</td>
                      <td className="py-2 pr-4 capitalize text-gray-600">{m.role}</td>
                      <td className="py-2">
                        <span className={`capitalize ${m.status === 'active' ? 'text-emerald-600' : 'text-red-500'}`}>{m.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4">
              <TeamManager team={team} canManage={canManage} usersLimit={usersLimit} currentUserId={user.id} />
            </div>
          </Card>
        )}
      </div>
    </>
  );
}