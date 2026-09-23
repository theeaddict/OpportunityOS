import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { listProviders } from '@/lib/services/discovery';
import * as jobsRepo from '@/lib/repositories/jobs';
import * as schedulesRepo from '@/lib/repositories/discover-schedules';
import { parseJson } from '@/lib/db';
import DiscoverClient from '@/components/DiscoverClient';
import { Card, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

const STAGE_LABEL = {
  discovering: 'Discovering businesses',
  researching: 'Researching businesses',
  checking_contacts: 'Checking contacts',
  analyzing: 'Analyzing operations',
  identifying_opportunities: 'Identifying opportunities',
  calculating_scenarios: 'Calculating scenarios',
  matching_solutions: 'Matching solutions',
  ranking: 'Ranking opportunities',
};

function parseSummary(raw) {
  if (!raw) return null;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
}

export default async function DiscoverPage() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) redirect('/login');
  const jobs = await jobsRepo.listJobs(user.account_id, 8);
  const schedules = (await schedulesRepo.listSchedules(user.account_id)).map((s) => ({
    ...s,
    filters: parseJson(s.filters_json, {}),
  }));

  return (
    <>
      <PageHeader
        title="Find opportunities"
        subtitle="Tell us what you're looking for in plain words. We'll discover, research, analyze and rank real opportunities for you."
      />

      <DiscoverClient providers={listProviders()} schedules={schedules} />

      <section className="mt-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Recent runs</h2>
        <Card className="overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr><th className="px-4 py-2.5">What we looked at</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5">Stage</th><th className="px-4 py-2.5">Found</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {jobs.map((j) => {
                const s = parseSummary(j.result_summary);
                return (
                  <tr key={j.id}>
                    <td className="max-w-xs truncate px-4 py-2.5">{j.query_name}</td>
                    <td className="px-4 py-2.5">
                      <span className={j.status === 'completed' ? 'text-emerald-700' : j.status === 'failed' ? 'text-red-600' : 'text-blue-700'}>{j.status}</span>{' '}
                      <span className="text-gray-400">{j.progress}%</span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-500">{STAGE_LABEL[j.stage] || '—'}</td>
                    <td className="px-4 py-2.5 text-gray-500">{s ? `${s.strong_opportunities} strong` : '—'}</td>
                  </tr>
                );
              })}
              {!jobs.length && <tr><td colSpan="4" className="px-4 py-4 text-center text-gray-400">No runs yet — start with the form above.</td></tr>}
            </tbody>
          </table>
        </Card>
      </section>
    </>
  );
}
