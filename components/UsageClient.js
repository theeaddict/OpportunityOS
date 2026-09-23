'use client';

import { useEffect, useMemo, useState } from 'react';

const METRICS = [
  { key: 'researches', label: 'Researches' },
  { key: 'opportunities', label: 'Opportunities' },
  { key: 'ai_analyses', label: 'AI analyses' },
  { key: 'demo_generations', label: 'Demos' },
  { key: 'users', label: 'Seats' },
];

function Stat({ label, value, sub }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">{label}</p>
      <p className="mt-1 text-lg font-semibold text-gray-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-500">{sub}</p>}
    </div>
  );
}

function FlagBadge({ over, near }) {
  if (over)
    return (
      <span className="inline-block rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">Over limit</span>
    );
  if (near)
    return (
      <span className="inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
        Near limit
      </span>
    );
  return (
    <span className="inline-block rounded bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">Within</span>
  );
}

export default function UsageClient() {
  const [usage, setUsage] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    fetch('/api/admin/usage', { headers: { Accept: 'application/json' } })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => (ok ? setUsage(d.usage) : setError(d?.error || 'Failed to load')))
      .catch(() => setError('Failed to load'));
  }, []);

  const accounts = useMemo(() => usage?.accounts || [], [usage]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return accounts;
    return accounts.filter(
      (a) =>
        String(a.id).includes(needle) ||
        a.name.toLowerCase().includes(needle) ||
        a.plan_code.toLowerCase().includes(needle)
    );
  }, [accounts, q]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!usage) return <p className="text-sm text-gray-400">Loading usage…</p>;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Period" value={usage.period} />
        <Stat label="Accounts" value={usage.accounts.length} />
        <Stat
          label="Over limit"
          value={usage.flags.over_limit}
          sub={usage.flags.over_limit ? 'Workspaces consuming past their plan cap' : 'All workspaces within their caps'}
        />
        <Stat label="Near limit" value={usage.flags.near_limit} sub="At or above 80% of a plan limit" />
      </div>

      {!usage.billing_implemented && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Billing is not implemented yet — these counters are surfaced so over-and-near-limit workspaces can be
          reviewed before billing is enabled.
        </p>
      )}

      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Plan rollup</p>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="py-2 pr-4">Plan</th>
                <th className="px-4 py-2">Accounts</th>
                <th className="px-4 py-2">Over</th>
                {METRICS.map((m) => (
                  <th key={m.key} className="px-4 py-2 text-right">
                    {m.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {usage.plans.map((p) => (
                <tr key={p.code}>
                  <td className="py-2 pr-4 font-medium text-gray-900">{p.name}</td>
                  <td className="px-4 py-2 text-gray-700 tabular-nums">{p.accounts}</td>
                  <td className="px-4 py-2 text-gray-700 tabular-nums">{p.over_limit_accounts}</td>
                  {METRICS.map((m) => {
                    const limit = p.limits[m.key];
                    return (
                      <td key={m.key} className="px-4 py-2 text-right text-gray-700 tabular-nums">
                        {p.usage[m.key] || 0}/{limit == null ? '∞' : limit}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {!usage.plans.length && (
                <tr>
                  <td colSpan={2 + METRICS.length} className="py-2 text-gray-500">
                    No plans configured.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter workspaces by name, plan, or id"
            className="w-full max-w-sm rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none"
          />
          <p className="shrink-0 text-sm text-gray-500">
            {filtered.length} of {accounts.length} workspace{accounts.length === 1 ? '' : 's'}
          </p>
        </div>

        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Workspace</th>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Usage vs limit</th>
                <th className="px-4 py-3">Flag</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((a) => (
                <tr key={a.id} className={a.over_limit ? 'bg-red-50/60' : ''}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">#{a.id} {a.name}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {a.plan_name}
                    <span className="ml-1 text-xs text-gray-400">({a.plan_code})</span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{a.status}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {METRICS.map((m) => {
                        const u = a.usage[m.key];
                        const over = u.limit != null && u.used > u.limit;
                        return (
                          <span key={m.key} className="text-xs text-gray-600">
                            <span className="text-gray-400">{m.label.toLowerCase()}:</span>{' '}
                            <span className={`tabular-nums ${over ? 'font-semibold text-red-700' : 'text-gray-800'}`}>
                              {u.used}/{u.limit == null ? '∞' : u.limit}
                            </span>
                            {u.pct != null && <span className="text-gray-400"> ({u.pct}%)</span>}
                          </span>
                        );
                      })}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <FlagBadge over={a.over_limit} near={a.near_limit} />
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td colSpan={5} className="px-4 py-3 text-gray-500">
                    No workspaces match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}