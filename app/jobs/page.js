import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import * as businessesRepo from '@/lib/repositories/businesses';
import * as opportunitiesRepo from '@/lib/repositories/opportunities';
import { list } from '@/lib/jobs/queue';
import { JOB_TYPE_LABELS, JOB_TYPE_KEYS } from '@/lib/jobs/registry';
import { PageHeader } from '@/components/ui';
import { JobsClient } from '@/components/JobsClient';

export const dynamic = 'force-dynamic';

export default async function JobsPage() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) redirect('/login');

  const [jobs, businesses, opportunities] = await Promise.all([
    list({ accountId: user.account_id, limit: 50 }),
    businessesRepo.list({ accountId: user.account_id, limit: 100 }),
    opportunitiesRepo.list({ accountId: user.account_id, limit: 200 }),
  ]);

  return (
    <>
      <PageHeader
        title="Jobs"
        subtitle="The unified background job queue — every discovery run, analysis, match, outreach and demo generation, with real progress."
      />
      <JobsClient
        initialJobs={jobs}
        businesses={businesses.map((b) => ({ id: b.id, name: b.name }))}
        opportunities={opportunities.map((o) => ({ id: o.id, title: o.title }))}
        jobTypes={JOB_TYPE_KEYS}
        jobTypeLabels={JOB_TYPE_LABELS}
      />
    </>
  );
}