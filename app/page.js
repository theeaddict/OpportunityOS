import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { getDashboard } from '@/lib/repositories/dashboard';
import DashboardCards from '@/components/DashboardCards';
import { OpportunityFeed } from '@/components/OpportunityFeedCard';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) redirect('/login');

  const { metrics, feed } = await getDashboard(user.account_id, user.role === 'member' ? user.id : null);

  return (
    <>
      <section className="mb-8 rounded-2xl bg-slate-900 px-6 py-8 text-white sm:px-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-2xl">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Stop searching for customers. Start with the money.
            </h1>
            <p className="mt-2 text-sm text-slate-300">
              OpportunityOS researches real businesses and shows you where a money-making opportunity is worth
              pursuing — with the evidence, the impact, and exactly how to approach it. No more hunting for leads
              all day.
            </p>
          </div>
          <Link
            href="/discover"
            className="shrink-0 rounded-xl bg-emerald-500 px-6 py-3 text-center text-base font-semibold text-slate-900 shadow hover:bg-emerald-400"
          >
            Find opportunities
          </Link>
        </div>
        <p className="mt-4 text-xs italic text-slate-400">
          Welcoming {user.name.split(' ')[0]} — here&apos;s the money at stake across everything you&apos;ve found so far.
        </p>
      </section>

      <DashboardCards metrics={metrics} />

      <div className="mb-3 mt-8 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Money-making opportunities</h2>
          <p className="mt-0.5 text-xs text-gray-400">Evidence-backed problems, ranked by impact and confidence.</p>
        </div>
        <Link href="/opportunities" className="text-xs font-medium text-blue-600 hover:underline">View all →</Link>
      </div>
      <OpportunityFeed feed={feed} />

      <p className="mt-6 text-xs italic text-gray-400">
        Business-impact and delivery-value figures are illustrative estimates from your assumptions and the solution
        library — never quoted as facts.
      </p>
    </>
  );
}