'use client';

import Link from 'next/link';
import { ScoreBadge } from '@/components/ui';
import { PIPELINE_COLUMNS, statusLabel } from '@/lib/constants';

const STAGE_COLORS = {
  new: 'bg-gray-100 border-gray-200',
  researching: 'bg-blue-50 border-blue-200',
  qualified: 'bg-indigo-50 border-indigo-200',
  contacted: 'bg-purple-50 border-purple-200',
  replied: 'bg-amber-50 border-amber-200',
  demo: 'bg-orange-50 border-orange-200',
  proposal: 'bg-cyan-50 border-cyan-200',
  negotiation: 'bg-pink-50 border-pink-200',
  won: 'bg-emerald-50 border-emerald-200',
};

const STAGE_HEADER_COLORS = {
  new: 'bg-gray-500',
  researching: 'bg-blue-500',
  qualified: 'bg-indigo-500',
  contacted: 'bg-purple-500',
  replied: 'bg-amber-500',
  demo: 'bg-orange-500',
  proposal: 'bg-cyan-500',
  negotiation: 'bg-pink-500',
  won: 'bg-emerald-500',
};

function fmtMoney(n, currency = 'KES') {
  if (n == null) return '—';
  return `${currency} ${Number(n).toLocaleString()}`;
}

export default function PipelineKanban({ kanban }) {
  if (!kanban) return <p className="text-sm text-gray-400">No pipeline data.</p>;

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {PIPELINE_COLUMNS.map((status) => {
        const items = kanban[status] || [];
        return (
          <div key={status} className="w-72 shrink-0">
            <div className="mb-2 flex items-center gap-2 px-1">
              <div className={`h-2 w-2 rounded-full ${STAGE_HEADER_COLORS[status] || 'bg-gray-400'}`} />
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-600">{statusLabel(status)}</h2>
              <span className="rounded-full bg-gray-200 px-2 text-xs font-medium text-gray-600">{items.length}</span>
            </div>
            <div className={`space-y-2 rounded-xl p-2 min-h-32 ${STAGE_COLORS[status] || 'bg-gray-100'}`}>
              {items.map((o) => (
                <Link key={o.id} href={`/opportunities/${o.id}`}>
                  <div className="rounded-lg bg-white p-3 shadow-sm ring-1 ring-gray-200/60 transition hover:ring-blue-300 hover:shadow-md">
                    <div className="flex items-start gap-2">
                      <ScoreBadge score={o.opportunity_score} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-gray-900">{o.business_name}</p>
                        {o.title && <p className="mt-0.5 line-clamp-1 text-xs text-gray-500">{o.title}</p>}
                      </div>
                    </div>

                    {o.project_value != null && (
                      <div className="mt-2 flex items-center justify-between text-xs">
                        <span className="font-semibold text-gray-800">{fmtMoney(o.project_value, o.project_currency)}</span>
                        {o.probability != null && (
                          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-500">{o.probability}%</span>
                        )}
                      </div>
                    )}

                    {o.weighted_pipeline != null && o.project_value != null && (
                      <p className="mt-0.5 text-[11px] text-gray-400">
                        Weighted: {fmtMoney(o.weighted_pipeline, o.project_currency)}
                      </p>
                    )}

                    <div className="mt-2 flex items-center gap-2 text-[11px] text-gray-400">
                      {o.days_in_stage != null && <span>{o.days_in_stage}d in stage</span>}
                      {o.recommended_solution_name && <span className="truncate">{o.recommended_solution_name}</span>}
                    </div>

                    {o.next_action && (
                      <p className="mt-1.5 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-700 line-clamp-1">
                        {o.next_action}
                      </p>
                    )}
                  </div>
                </Link>
              ))}
              {!items.length && <p className="px-1 py-4 text-center text-xs text-gray-400">Empty</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
