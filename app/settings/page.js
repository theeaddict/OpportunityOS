import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { isAtLeast } from '@/lib/accounts/roles';
import { getSettingsSummary } from '@/lib/repositories/settings';
import { getCapabilities } from '@/lib/repositories/capabilities';
import { getTwoFactorStatus } from '@/lib/repositories/users';
import * as solutionsRepo from '@/lib/repositories/solutions';
import * as jobsRepo from '@/lib/repositories/jobs';
import { PageHeader, Card } from '@/components/ui';
import ProfileForm from '@/components/ProfileForm';
import PasswordForm from '@/components/PasswordForm';
import TwoFactorForm from '@/components/TwoFactorForm';
import ScoreThresholdEditor from '@/components/ScoreThresholdEditor';
import CapabilitiesForm from '@/components/CapabilitiesForm';
import MyCapabilities from '@/components/MyCapabilities';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) redirect('/login');
  const [summary, capabilities, solutions, twoFactorEnabled] = await Promise.all([
    getSettingsSummary(user.account_id),
    getCapabilities(user.id),
    solutionsRepo.list({ accountId: user.account_id, activeOnly: true }),
    getTwoFactorStatus(user.id),
  ]);
  const recentJobs = (await jobsRepo.listJobs(user.account_id, 5)).length;

  return (
    <>
      <PageHeader title="Settings" subtitle="Your profile and platform configuration." />

      <div className="space-y-6">
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-gray-900">My Capabilities</h2>
          <p className="mb-4 text-xs text-gray-500">
            This is <span className="font-medium text-gray-700">your business</span> — what you build, where you operate and how
            you price. The opportunity engine uses it to only recommend solutions you can actually deliver and to mark
            everything else as <span className="font-medium text-gray-700">not a service fit</span>.
          </p>
          <div className="mb-6 rounded-xl bg-gray-50 p-4">
            <MyCapabilities capabilities={capabilities} solutions={solutions} />
          </div>
          <CapabilitiesForm capabilities={capabilities} solutions={solutions} />
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-gray-900">Profile</h2>
          <ProfileForm user={user} />
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-gray-900">Password</h2>
          <PasswordForm />
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-gray-900">Two-factor authentication</h2>
          <TwoFactorForm enabled={twoFactorEnabled} email={user.email} />
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold text-gray-900">AI provider</h2>
          {summary.ai.configured ? (
            <div className="mt-2 space-y-1 text-sm text-gray-600">
              <p>Status: <span className="font-medium text-emerald-700">Connected</span></p>
              <p>Provider: {summary.ai.provider} · Model: <code className="rounded bg-gray-100 px-1">{summary.ai.model}</code></p>
              <p className="text-xs text-gray-400">Every AI call is recorded in Jobs. AI output is labeled fact / inference / hypothesis and never becomes fact automatically.</p>
            </div>
          ) : (
            <div className="mt-2 rounded-lg bg-orange-50 p-3 text-sm text-orange-800">
              <p className="font-medium">Not configured — the app runs without it.</p>
              <p className="mt-1 text-xs">Problem detection, scoring, scenarios and outreach all work with the built-in deterministic rule engine.
                To enable AI interpretation and drafting, set these environment variables:</p>
              <pre className="mt-2 overflow-x-auto rounded bg-white p-2 text-xs">{`AI_API_KEY=sk-...
AI_MODEL=gpt-4o-mini
AI_BASE_URL=https://api.openai.com/v1   # or any OpenAI-compatible endpoint`}</pre>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold text-gray-900">Discovery providers</h2>
          <ul className="mt-2 space-y-2">
            {summary.discovery_providers.map((p) => (
              <li key={p.id} className="rounded-lg bg-gray-50 p-3 text-sm">
                <p className="font-medium text-gray-900">{p.label}</p>
                <p className="text-xs text-gray-500">{p.description}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-gray-400">
            To plug in a real discovery source later, set <code className="rounded bg-gray-100 px-1">DISCOVERY_API_URL</code> to an endpoint
            that accepts <code className="rounded bg-gray-100 px-1">{'{ query }'}</code> and returns{' '}
            <code className="rounded bg-gray-100 px-1">{'{ results: [...] }'}</code>.
          </p>
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold text-gray-900">Opportunity scoring thresholds</h2>
          <ScoreThresholdEditor thresholds={summary.score_thresholds} isAdmin={isAtLeast(user, 'admin')} />
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold text-gray-900">Recent activity</h2>
          <p className="mt-1 text-sm text-gray-500">{recentJobs > 0 ? `${recentJobs}+ recent jobs recorded.` : 'No jobs recorded yet.'}</p>
        </Card>
      </div>
    </>
  );
}
