import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import * as ownerRepo from '@/lib/repositories/owner';
import { OWNER_GOALS } from '@/lib/owner/goals.js';
import { PageHeader } from '@/components/ui';
import { OwnerMode } from '@/components/OwnerMode';

export const dynamic = 'force-dynamic';

export default async function OwnerPage() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) redirect('/login');

  const [profile, runs] = await Promise.all([
    ownerRepo.getOwnerProfile(user.id),
    ownerRepo.ownerJobs(user.id, 3),
  ]);

  return (
    <>
      <PageHeader
        title="Owner Mode"
        subtitle="A simple view for business owners — answer a few questions and we find opportunities for you, in plain English."
      />
      <OwnerMode
        initial={{
          profile: profile ? {
            business_name: profile.business_name,
            sell_what: profile.sell_what,
            location: profile.location,
            ideal_customers: profile.ideal_customers,
            goals: profile.goals,
            strategy: profile.strategy,
          } : null,
          goals: Object.values(OWNER_GOALS).map(({ key, label }) => ({ key, label })),
          latestRun: runs[0] || null,
        }}
      />
    </>
  );
}