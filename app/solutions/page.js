import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { isAtLeast } from '@/lib/accounts/roles';
import * as solutionsRepo from '@/lib/repositories/solutions';
import { PageHeader } from '@/components/ui';
import { PROBLEM_TYPES } from '@/lib/constants';
import SolutionLibraryManager from '@/components/SolutionLibraryManager';

export const dynamic = 'force-dynamic';

export default async function SolutionsPage() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) redirect('/login');
  const solutions = await solutionsRepo.list({ accountId: user.account_id, activeOnly: false });
  const problemTypes = Object.entries(PROBLEM_TYPES).map(([key, v]) => ({ key, label: v.label }));

  return (
    <>
      <PageHeader
        title="Solution Library"
        subtitle="The software you can deliver. Configure every solution — project pricing, features, target industries and which problems it solves. Matching uses this library and never invents project prices."
      />
      <p className="mb-4 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
        Project value is set as <strong>low / base / high</strong> and is reported as an <strong>estimate, not a quotation</strong> — displayed separately from the client&apos;s potential business impact.
      </p>
      <SolutionLibraryManager
        solutions={solutions}
        problemTypes={problemTypes}
        isAdmin={isAtLeast(user, 'admin')}
      />
    </>
  );
}
