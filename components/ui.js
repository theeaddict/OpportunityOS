import { statusLabel, problemLabel, CLAIM_TYPES } from '@/lib/constants';

export function Card({ children, className = '' }) {
  return <div className={`rounded-xl border border-gray-200 bg-white shadow-sm ${className}`}>{children}</div>;
}

export function PageHeader({ title, subtitle, action }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

const BADGE_STYLES = {
  new: 'bg-gray-100 text-gray-700',
  analyzing: 'bg-blue-50 text-blue-700',
  qualified: 'bg-emerald-50 text-emerald-700',
  outreach_sent: 'bg-indigo-50 text-indigo-700',
  in_conversation: 'bg-violet-50 text-violet-700',
  proposal_sent: 'bg-fuchsia-50 text-fuchsia-700',
  won: 'bg-green-100 text-green-800',
  lost: 'bg-red-50 text-red-700',
  archived: 'bg-gray-100 text-gray-400',
};

export function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGE_STYLES[status] || 'bg-gray-100 text-gray-700'}`}>
      {statusLabel(status)}
    </span>
  );
}

export function ScoreBadge({ score }) {
  const color = score == null ? 'bg-gray-100 text-gray-500'
    : score >= 70 ? 'bg-emerald-600' : score >= 50 ? 'bg-blue-600' : score >= 30 ? 'bg-amber-500' : 'bg-gray-400';
  return (
    <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${color}`}>
      {score ?? '–'}
    </span>
  );
}

export function ClaimBadge({ claimType }) {
  const styles = {
    FACT: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    INFERENCE: 'bg-amber-50 text-amber-700 ring-amber-200',
    HYPOTHESIS: 'bg-violet-50 text-violet-700 ring-violet-200',
  };
  const key = String(claimType || 'FACT').toUpperCase();
  return (
    <span title={CLAIM_TYPES[key.toLowerCase()]?.hint || ''} className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ${styles[key] || styles.FACT}`}>
      {key}
    </span>
  );
}

export function ProblemTag({ type }) {
  return <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{problemLabel(type)}</span>;
}

export function EmptyState({ title, hint }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
      <p className="text-sm font-medium text-gray-700">{title}</p>
      {hint && <p className="mt-1 text-sm text-gray-500">{hint}</p>}
    </div>
  );
}

export function EvidenceList({ evidence }) {
  if (!evidence?.length) return <p className="text-sm text-gray-500">No evidence recorded yet.</p>;
  return (
    <ul className="space-y-3">
      {evidence.map((e) => (
        <li key={e.id} className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <ClaimBadge claimType={e.claim_type} />
            <span className="text-xs text-gray-500">{String(e.evidence_type).replaceAll('_', ' ')}</span>
            {e.signal_key && (
              <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">{String(e.signal_key).replaceAll('_', ' ')}</span>
            )}
            <span className="ml-auto text-xs text-gray-400">confidence {Math.round(Number(e.confidence_score) * 100)}%</span>
          </div>
          <p className="mt-1.5 text-sm text-gray-800">{e.evidence_text}</p>
          {e.source_excerpt_summary && (
            <p className="mt-0.5 text-xs italic text-gray-500">Excerpt summary: {e.source_excerpt_summary}</p>
          )}
          <p className="mt-1.5 text-xs text-gray-500">
            Source: {e.source_name || '(unspecified)'}
            {e.source_url && <> · <a href={e.source_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">link</a></>}
            · captured {String(e.captured_at || '').slice(0, 10)}
            {!e.captured_by && e.evidence_type === 'ai_interpretation' && <> · AI-generated, pending human review</>}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function fmtMoney(value, currency = 'USD') {
  if (value === null || value === undefined) return '—';
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(value));
  } catch {
    return `${value} ${currency}`;
  }
}
