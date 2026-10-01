import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { getCoverage } from '@/lib/services/research/run';
import * as businessesRepo from '@/lib/repositories/businesses';
import * as evidenceRepo from '@/lib/repositories/evidence';
import * as opportunitiesRepo from '@/lib/repositories/opportunities';
import BusinessWorkspace from '@/components/BusinessWorkspace';
import { Card, PageHeader, EvidenceList, ScoreBadge, StatusBadge, ProblemTag, EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function BusinessDetailPage({ params }) {
  const user = await getCurrentUser().catch(() => null);
  if (!user) redirect('/login');
  const { id } = await params;
  const business = await businessesRepo.findBusiness(user.account_id, Number(id));
  if (!business) notFound();

  const [evidence, contacts, opportunities, sources, researchRows] = await Promise.all([
    evidenceRepo.listForBusiness(user.account_id, business.id),
    businessesRepo.listContacts(user.account_id, business.id),
    opportunitiesRepo.findByBusiness(user.account_id, business.id),
    businessesRepo.listSources(user.account_id, business.id),
    query(
      "SELECT output_json FROM ai_jobs WHERE job_type='research_interpretation' AND business_id=? AND status='completed' AND account_id=? ORDER BY id DESC LIMIT 1",
      [business.id, user.account_id]
    ),
  ]);
  const coverage = await getCoverage(user.account_id, business.id);
  let researchProfile = null;
  try {
    const raw = researchRows[0]?.output_json;
    if (raw) researchProfile = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {}

  return (
    <>
      <PageHeader
        title={business.name}
        subtitle={[business.industry, business.location, business.country].filter(Boolean).join(' · ') || null}
      />

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2">
              {business.website && (
                <a href={business.website} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline">{business.website}</a>
              )}
            </div>
            <p className="mt-2 text-sm text-gray-700">{business.description || 'No description on file yet.'}</p>
          </div>
        </div>

        {/* Per-field provenance: these identity fields (name/industry/location/
            country/website) come from the business record as a whole, not
            individual evidence rows, so the real granularity this schema
            tracks is one shared source list + one found-on date for all of
            them — showing a separate confidence per field would imply
            precision that doesn't exist. True per-claim source/confidence/
            date lives on the Evidence list below (business_evidence rows). */}
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 border-t border-gray-100 pt-4 text-xs sm:grid-cols-2">
          {[
            ['Name', business.name],
            ['Industry', business.industry],
            ['Location', business.location],
            ['Country', business.country],
            ['Website', business.website],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3">
              <dt className="font-semibold text-gray-500">{label}</dt>
              <dd className={value ? 'text-gray-700' : 'italic text-gray-400'}>{value || 'Not provided'}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-gray-400">
          {sources.length > 0
            ? <>Source{sources.length === 1 ? '' : 's'}: {sources.map((s) => s.source_name).join(', ')} · on file since {String(business.created_at).slice(0, 10)}</>
            : 'No source on file for this business record.'}
        </p>
      </Card>

      {researchProfile && (
        <Card className="mt-4 border-violet-200 bg-violet-50/40 p-5">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-900">AI research profile</h2>
            <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-violet-700">AI-generated — review before relying on it</span>
          </div>
          <p className="mt-2 text-sm text-gray-700">{researchProfile.business_model}</p>
          <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
            {[['Products', researchProfile.products], ['Services', researchProfile.services], ['Customer types', researchProfile.customer_types], ['Sales channels', researchProfile.sales_channels], ['Ordering channels', researchProfile.ordering_channels], ['Booking channels', researchProfile.booking_channels]].map(([label, arr]) => (
              <div key={label}>
                <dt className="font-semibold text-gray-500">{label}</dt>
                <dd className="text-gray-700">{Array.isArray(arr) && arr.length ? arr.join(' · ') : 'unknown'}</dd>
              </div>
            ))}
            <div>
              <dt className="font-semibold text-gray-500">Delivery model</dt>
              <dd className="text-gray-700">{researchProfile.delivery_model || 'unknown'}</dd>
            </div>
            <div>
              <dt className="font-semibold text-gray-500">Wholesale model</dt>
              <dd className="text-gray-700">{researchProfile.wholesale_model || 'unknown'}</dd>
            </div>
          </dl>
          {Array.isArray(researchProfile.unknowns) && researchProfile.unknowns.length > 0 && (
            <p className="mt-3 text-xs italic text-gray-500">Unknowns: {researchProfile.unknowns.join(' · ')}</p>
          )}
        </Card>
      )}

      <div className="mt-6">
        <BusinessWorkspace businessId={business.id} signals={business.signals} coverage={coverage} />
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Opportunities for this business</h2>
        {opportunities.length ? (
          <div className="space-y-3">
            {opportunities.map((o) => (
              <Link key={o.id} href={`/opportunities/${o.id}`}>
                <Card className="p-4 transition hover:border-blue-300 hover:shadow">
                  <div className="flex items-start gap-3">
                    <ScoreBadge score={o.opportunity_score} />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900">{o.title}</p>
                      <p className="mt-0.5 line-clamp-1 text-sm text-gray-600">{o.problem}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <ProblemTag type={o.problem_type} />
                        <StatusBadge status={o.status} />
                      </div>
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState title="No opportunities yet" hint="Record research findings above, then run “Detect opportunities”." />
        )}
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Evidence ({evidence.length})</h2>
        <EvidenceList evidence={evidence} />
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Public contacts ({contacts.length})</h2>
        {contacts.length ? (
          <Card className="divide-y divide-gray-100">
            {contacts.map((c) => (
              <div key={c.id} className="px-4 py-3 text-sm">
                <p className="font-medium uppercase tracking-wide text-gray-900">{String(c.contact_type).replaceAll('_', ' ')}</p>
                <p className="mt-0.5 text-gray-700">{c.contact_value}</p>
                <p className="mt-0.5 text-xs text-gray-400">
                  verification: {String(c.verification_status).replaceAll('_', ' ')} · confidence {Math.round(Number(c.confidence_score) * 100)}%
                  {c.last_verified_at ? ` · verified ${String(c.last_verified_at).slice(0, 10)}` : ''}
                  {c.source_url && <> · <a href={c.source_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">source</a></>}
                </p>
              </div>
            ))}
</Card>
        ) : (
          <EmptyState title="No contacts stored" hint="Add publicly available contact details in the Contacts tab. Never invent contact information." />
        )}
      </section>
    </>
  );
}
