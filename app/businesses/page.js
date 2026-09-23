import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import * as businessesRepo from '@/lib/repositories/businesses';
import { PageHeader, Card, EmptyState } from '@/components/ui';
import AddBusinessForm from '@/components/AddBusinessForm';

export const dynamic = 'force-dynamic';

export default async function BusinessesPage({ searchParams }) {
  const user = await getCurrentUser().catch(() => null);
  if (!user) redirect('/login');
  const { q = '' } = await searchParams;
  const businesses = await businessesRepo.list({ accountId: user.account_id, q });

  return (
    <>
      <PageHeader title="Businesses" subtitle="Every business on file, with its research status." />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <form className="flex-1 sm:max-w-md">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search by name, industry or city…"
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none"
          />
        </form>
        <AddBusinessForm />
      </div>

      {businesses.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {businesses.map((b) => (
            <Link key={b.id} href={`/businesses/${b.id}`} className="block">
              <Card className="p-4 transition hover:border-blue-300 hover:shadow">
                <div className="flex items-center gap-2">
                  <p className="truncate font-semibold text-gray-900">{b.name}</p>
                </div>
                <p className="mt-0.5 line-clamp-2 text-sm text-gray-600">{b.description || b.industry}</p>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
                  {[b.industry, b.location].filter(Boolean).map((x) => <span key={x}>{x}</span>)}
                  <span>{b.opportunity_count} opportunit{b.opportunity_count === 1 ? 'y' : 'ies'}</span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState title="No businesses yet" hint="Use Discover to find candidates, or add one manually above." />
      )}
    </>
  );
}
