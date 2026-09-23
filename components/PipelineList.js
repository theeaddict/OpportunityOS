'use client';

import Link from 'next/link';
import { ScoreBadge } from '@/components/ui';
import { statusLabel } from '@/lib/constants';

function fmtMoney(n, currency = 'KES') {
  if (n == null) return '—';
  return `${currency} ${Number(n).toLocaleString()}`;
}

const STATUS_DOT_COLORS = {
  new: 'bg-gray-400',
  researching: 'bg-blue-500',
  qualified: 'bg-indigo-500',
  contacted: 'bg-purple-500',
  replied: 'bg-amber-500',
  demo: 'bg-orange-500',
  proposal: 'bg-cyan-500',
  negotiation: 'bg-pink-500',
  won: 'bg-emerald-500',
  lost: 'bg-red-400',
  not_a_fit: 'bg-gray-300',
};

export default function PipelineList({ kanban }) {
  if (!kanban) return <p className="text-sm text-gray-400">No pipeline data.</p>;

  // Flatten all items from kanban into a single sorted list.
  const all = Object.values(kanban).flat().sort((a, b) => (b.opportunity_score || 0) - (a.opportunity_score || 0));

  if (!all.length) return <p className="text-sm text-gray-400">No opportunities in the pipeline.</p>;

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
            <th className="px-3 py-2">Score</th>
            <th className="px-3 py-2">Business</th>
            <th className="px-3 py-2">Stage</th>
            <th className="px-3 py-2 text-right">Project value</th>
            <th className="px-3 py-2 text-right">Probability</th>
            <th className="px-3 py-2 text-right">Weighted</th>
            <th className="px-3 py-2 text-right">Days in stage</th>
            <th className="px-3 py-2">Next action</th>
          </tr>
        </thead>
        <tbody>
          {all.map((o) => (
            <tr key={o.id} className="border-b border-gray-100 hover:bg-gray-50">
              <td className="px-3 py-2"><ScoreBadge score={o.opportunity_score} /></td>
              <td className="px-3 py-2">
                <Link href={`/opportunities/${o.id}`} className="font-medium text-gray-900 hover:text-blue-700">
                  {o.business_name}
                </Link>
                {o.title && <p className="text-xs text-gray-400 line-clamp-1">{o.title}</p>}
              </td>
              <td className="px-3 py-2">
                <span className="inline-flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${STATUS_DOT_COLORS[o.status] || 'bg-gray-400'}`} />
                  <span className="text-xs font-medium text-gray-700">{statusLabel(o.status)}</span>
                </span>
              </td>
              <td className="px-3 py-2 text-right font-medium text-gray-800">{fmtMoney(o.project_value, o.project_currency)}</td>
              <td className="px-3 py-2 text-right text-gray-600">{o.probability != null ? `${o.probability}%` : '—'}</td>
              <td className="px-3 py-2 text-right font-medium text-indigo-700">{fmtMoney(o.weighted_pipeline, o.project_currency)}</td>
              <td className="px-3 py-2 text-right text-gray-500">{o.days_in_stage != null ? `${o.days_in_stage}d` : '—'}</td>
              <td className="px-3 py-2 text-xs text-gray-500 max-w-[200px] truncate">{o.next_action || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
