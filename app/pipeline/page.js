import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { pipelineKanban, pipelineMetrics } from '@/lib/repositories/financial';
import PipelinePage from '@/components/PipelinePage';

export const dynamic = 'force-dynamic';

export default async function Pipeline() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) redirect('/login');

  const [kanban, metrics] = await Promise.all([
    pipelineKanban({ accountId: user.account_id, memberUserId: user.role === 'member' ? user.id : null }),
    pipelineMetrics(user.account_id),
  ]);

  return <PipelinePage kanban={kanban} metrics={metrics} />;
}
