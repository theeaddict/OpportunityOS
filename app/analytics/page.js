import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import * as opportunitiesRepo from '@/lib/repositories/opportunities';
import { query } from '@/lib/db';
import { problemLabel, statusLabel, PIPELINE_COLUMNS } from '@/lib/constants';
import { PageHeader, Card } from '@/components/ui';

export const dynamic = 'force-dynamic';

async function countBy(sql, params = []) {
  const rows = await query(sql, params);
  return rows;
}

export default async function AnalyticsPage() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) redirect('/login');

  const [byStatus, byProblem, scoreStats, funnel] = await Promise.all([
    countBy('SELECT status, COUNT(*) AS n FROM opportunities WHERE account_id = ? GROUP BY status ORDER BY n DESC', [user.account_id]),
    countBy('SELECT problem_type, COUNT(*) AS n, AVG(opportunity_score) AS avg_score FROM opportunities WHERE account_id = ? GROUP BY problem_type ORDER BY n DESC', [user.account_id]),
    countBy("SELECT COUNT(*) AS total, AVG(opportunity_score) AS avg_score, SUM(CASE WHEN opportunity_score >= 50 THEN 1 ELSE 0 END) AS qualified, MAX(opportunity_score) AS best FROM opportunities WHERE opportunity_score IS NOT NULL AND account_id = ?", [user.account_id]),
    Promise.all(
      PIPELINE_COLUMNS.map(async (s) => {
        const rows = await query('SELECT COUNT(*) AS n FROM opportunities WHERE status = ? AND account_id = ?', [s, user.account_id]);
        return { status: s, n: Number(rows[0].n) };
      })
    ),
  ]);

  const totals = scoreStats[0] || {};

  return (
    <>
      <PageHeader title="Analytics" subtitle="How your opportunity pipeline is performing." />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Scored opportunities" value={Number(totals.total) || 0} />
        <Stat label="Average score" value={totals.avg_score ? Number(totals.avg_score).toFixed(1) : '—'} />
        <Stat label="Qualified (50+)" value={Number(totals.qualified) || 0} />
        <Stat label="Best score" value={totals.best ?? '—'} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-gray-900">Pipeline funnel</h2>
          <ul className="mt-3 space-y-2">
            {funnel.map((f) => {
              const max = Math.max(...funnel.map((x) => x.n), 1);
              return (
                <li key={f.status}>
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>{statusLabel(f.status)}</span><span>{f.n}</span>
                  </div>
                  <div className="mt-1 h-2 rounded bg-gray-100">
                    <div className="h-2 rounded bg-blue-600" style={{ width: `${(f.n / max) * 100}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold text-gray-900">By problem type</h2>
          {byProblem.length ? (
            <table className="mt-3 w-full text-sm">
              <tbody className="divide-y divide-gray-100">
                {byProblem.map((r) => (
                  <tr key={r.problem_type}>
                    <td className="py-2">{problemLabel(r.problem_type)}</td>
                    <td className="py-2 text-right text-gray-500">{r.n} found</td>
                    <td className="py-2 text-right text-gray-500">avg {r.avg_score ? Number(r.avg_score).toFixed(0) : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="mt-2 text-sm text-gray-500">No data yet.</p>}
        </Card>

        <Card className="p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold text-gray-900">Status breakdown</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {byStatus.map((r) => (
              <span key={r.status} className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700">
                {statusLabel(r.status)}: <strong>{r.n}</strong>
              </span>
            ))}
            {!byStatus.length && <p className="text-sm text-gray-500">No opportunities yet.</p>}
          </div>
        </Card>
      </div>
    </>
  );
}

function Stat({ label, value }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-gray-900">{value}</p>
    </Card>
  );
}
