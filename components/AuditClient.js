'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';

function Stat({ label, value, sub }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">{label}</p>
      <p className="mt-1 text-lg font-semibold text-gray-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-500">{sub}</p>}
    </div>
  );
}

function SummaryCell({ s }) {
  const parts = [];
  if (s.from && s.to) parts.push(`${formatVal(s.from)} → ${formatVal(s.to)}`);
  return parts.length ? (
    <span className="text-gray-700 tabular-nums">{parts.join(' · ')}</span>
  ) : (
    <span className="text-gray-400">—</span>
  );
}

function formatVal(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export default function AuditClient() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');

  const load = (a = action, e = entityType) => {
    const params = new URLSearchParams();
    if (a) params.set('action', a);
    if (e) params.set('entity_type', e);
    return fetch(`/api/admin/audit?${params.toString()}`, { headers: { Accept: 'application/json' } })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => (ok ? setData(d.audit) : setError(d?.error || 'Failed to load')))
      .catch(() => setError('Failed to load'));
  };

  useEffect(() => {
    load('', '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const topActions = useMemo(() => (data?.actions || []).slice(0, 8), [data]);
  const topEntities = useMemo(() => (data?.entity_types || []).slice(0, 6), [data]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <p className="text-sm text-gray-400">Loading audit log…</p>;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total entries" value={data.total} sub="append-only, never pruned" />
        <Stat label="Actions" value={data.actions.length} />
        <Stat label="Entity types" value={data.entity_types.length} sub="non-null entities only" />
        <Stat label="Showing" value={data.rows.length} sub="newest first" />
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-widest text-gray-400">Action</span>
          <select
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setEntityType('');
              load(e.target.value, '');
            }}
            className="mt-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none"
          >
            <option value="">All actions</option>
            {data.actions.map((a) => (
              <option key={a.action} value={a.action}>
                {a.action} ({a.count})
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-widest text-gray-400">Entity type</span>
          <select
            value={entityType}
            onChange={(e) => {
              setEntityType(e.target.value);
              setAction('');
              load('', e.target.value);
            }}
            className="mt-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none"
          >
            <option value="">All entity types</option>
            {data.entity_types.map((t) => (
              <option key={t.entity_type} value={t.entity_type}>
                {t.entity_type} ({t.count})
              </option>
            ))}
          </select>
        </label>

        <button
          onClick={() => {
            setAction('');
            setEntityType('');
            load('', '');
          }}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Reset
        </button>
        <p className="ml-auto shrink-0 text-sm text-gray-500">
          {data.rows.length} row{data.rows.length === 1 ? '' : 's'}
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Most frequent actions</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {topActions.map((a) => (
            <button
              key={a.action}
              onClick={() => {
                setAction(a.action);
                setEntityType('');
                load(a.action, '');
              }}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                action === a.action ? 'border-red-700 bg-red-700 text-white' : 'border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              {a.action} · {a.count}
            </button>
          ))}
        </div>
        {topEntities.length > 0 && (
          <p className="mt-3 text-xs text-gray-500">
            Entities: {topEntities.map((t) => `${t.entity_type} (${t.count})`).join(' · ')}
          </p>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Actor</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Entity</th>
              <th className="px-4 py-3">Account</th>
              <th className="px-4 py-3">Summary</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap px-4 py-3 text-gray-500 tabular-nums">
                  {String(r.created_at).slice(0, 19)}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <span className="text-gray-800">{r.user_name || 'system'}</span>
                  {r.user_id && <span className="ml-1 text-xs text-gray-400">#{r.user_id}</span>}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <span className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-700">{r.action}</span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-gray-700 tabular-nums">
                  {r.entity_type || '—'}
                  {r.entity_id != null && ` #${r.entity_id}`}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-gray-700 tabular-nums">
                  {r.account_name || (r.account_id != null ? `#${r.account_id}` : '—')}
                </td>
                <td className="px-4 py-3">
                  <SummaryCell s={r.metadata} />
                </td>
              </tr>
            ))}
            {!data.rows.length && (
              <tr>
                <td colSpan={6} className="px-4 py-3 text-gray-500">
                  No audit entries match{action || entityType ? ' the selected filters.' : ' yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}