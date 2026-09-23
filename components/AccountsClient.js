'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import '@/lib/csrf-client';

const METRICS = [
  { key: 'researches', label: 'Researches' },
  { key: 'opportunities', label: 'Opportunities' },
  { key: 'ai_analyses', label: 'AI analyses' },
  { key: 'demo_generations', label: 'Demos' },
  { key: 'users', label: 'Seats' },
];

function StatusBadge({ status }) {
  const suspended = status === 'suspended';
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${
        suspended ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'
      }`}
    >
      {status}
    </span>
  );
}

function UsageCell({ used, limit }) {
  const unlimited = limit == null;
  const over = !unlimited && used >= limit;
  return (
    <span className={`tabular-nums ${over ? 'font-semibold text-red-700' : 'text-gray-700'}`}>
      {used}/{unlimited ? '∞' : limit}
    </span>
  );
}

export default function AccountsClient() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState(null);

  const load = useCallback(() => {
    return fetch('/api/admin/accounts', { headers: { Accept: 'application/json' } })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => (ok ? setData(d) : setError(d?.error || 'Failed to load')))
      .catch(() => setError('Failed to load'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const accounts = useMemo(() => data?.accounts || [], [data]);
  const plans = useMemo(() => data?.plans || [], [data]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return accounts;
    return accounts.filter((a) =>
      [String(a.id), a.name, a.plan_code, a.status].some((v) => String(v).toLowerCase().includes(needle))
    );
  }, [accounts, q]);

  async function toggleStatus(account) {
    const next = account.status === 'suspended' ? 'active' : 'suspended';
    setBusyId(account.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/accounts/${account.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || 'Request failed');
      setData((prev) =>
        prev
          ? { ...prev, accounts: prev.accounts.map((a) => (a.id === account.id ? { ...a, status: next } : a)) }
          : prev
      );
      if (expandedId === account.id) {
        setDetail((prev) => (prev ? { ...prev, account: { ...prev.account, status: next } } : prev));
      }
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function changePlan(account, plan_code) {
    if (plan_code === account.plan_code) return;
    setBusyId(account.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/accounts/${account.id}/plan`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_code }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || 'Request failed');
      // Plan limits change with plan_code — re-read the list so usage/limit
      // columns reflect the new plan immediately.
      await load();
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function deleteAccount(account) {
    const ok = window.confirm(
      `Permanently delete "${account.name}" (#${account.id}) and ALL of its data?\n\n` +
        'This cannot be undone. The audit trail is kept.'
    );
    if (!ok) return;
    setBusyId(account.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/accounts/${account.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || 'Request failed');
      if (expandedId === account.id) toggleDetail(account.id);
      setData((prev) =>
        prev ? { ...prev, accounts: prev.accounts.filter((a) => a.id !== account.id) } : prev
      );
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function toggleDetail(id) {
    if (expandedId === id) {
      setExpandedId(null);
      setDetail(null);
      setDetailError(null);
      return;
    }
    setExpandedId(id);
    setDetail(null);
    setDetailError(null);
    try {
      const res = await fetch(`/api/admin/accounts/${id}`, { headers: { Accept: 'application/json' } });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || 'Failed to load detail');
      setDetail(body);
    } catch (e) {
      setDetailError(e.message);
    }
  }

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <p className="text-sm text-gray-400">Loading accounts…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search accounts by name, plan, status, or id"
          className="w-full max-w-sm rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none"
        />
        <p className="shrink-0 text-sm text-gray-500">
          {filtered.length} of {accounts.length} account{accounts.length === 1 ? '' : 's'}
        </p>
      </div>

      {actionError && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</p>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3">Account</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Members</th>
              <th className="px-4 py-3">Researches</th>
              <th className="px-4 py-3">Opportunities</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((a) => {
              const busy = busyId === a.id;
              const suspended = a.status === 'suspended';
              return (
                <Fragment key={a.id}>
                  <tr className={expandedId === a.id ? 'bg-red-50/40' : 'hover:bg-gray-50'}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{a.name}</p>
                      <p className="text-xs text-gray-500">#{a.id} · {new Date(a.created_at).toLocaleDateString()}</p>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={a.plan_code}
                        disabled={busy}
                        onChange={(e) => changePlan(a, e.target.value)}
                        className="rounded border border-gray-300 px-2 py-1 text-sm disabled:opacity-50"
                        aria-label={`Plan for ${a.name}`}
                      >
                        {plans.map((p) => (
                          <option key={p.code} value={p.code}>{p.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={a.status} /></td>
                    <td className="px-4 py-3 tabular-nums">{a.member_count}</td>
                    <td className="px-4 py-3"><UsageCell used={a.usage.researches} limit={a.limits.researches} /></td>
                    <td className="px-4 py-3"><UsageCell used={a.usage.opportunities} limit={a.limits.opportunities} /></td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => toggleDetail(a.id)}
                        className="mr-2 text-xs font-medium text-gray-600 hover:text-gray-900"
                      >
                        {expandedId === a.id ? 'Hide' : 'Details'}
                      </button>
                      <button
                        onClick={() => toggleStatus(a)}
                        disabled={busy}
                        className={`rounded px-2 py-1 text-xs font-semibold disabled:opacity-50 ${
                          suspended ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-amber-600 text-white hover:bg-amber-700'
                        }`}
                      >
                        {busy ? '…' : suspended ? 'Reactivate' : 'Suspend'}
                      </button>
                      <button
                        onClick={() => deleteAccount(a)}
                        disabled={busy}
                        className="ml-2 rounded bg-red-600 px-2 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                        aria-label={`Delete ${a.name}`}
                      >
                        {busy ? '…' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                  {expandedId === a.id && (
                    <tr>
                      <td colSpan={7} className="bg-gray-50 px-4 py-4">
                        {detailError && <p className="text-sm text-red-600">{detailError}</p>}
                        {!detail && !detailError && <p className="text-sm text-gray-400">Loading detail…</p>}
                        {detail && (
                          <div className="space-y-4">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                Members ({detail.users.length})
                              </p>
                              <ul className="mt-2 space-y-1 text-sm">
                                {detail.users.map((u) => (
                                  <li key={u.id} className="flex flex-wrap gap-2">
                                    <span className="font-medium text-gray-900">{u.name}</span>
                                    <span className="text-gray-500">{u.email}</span>
                                    <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs uppercase text-gray-600">{u.role}</span>
                                    <StatusBadge status={u.status} />
                                  </li>
                                ))}
                                {detail.users.length === 0 && <li className="text-gray-500">No members yet.</li>}
                              </ul>
                            </div>
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                Usage this period ({detail.usage.period}) vs {detail.limits.plan_name} limits
                              </p>
                              <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                                {METRICS.map((m) => (
                                  <div key={m.key} className="rounded border border-gray-200 bg-white p-3">
                                    <p className="text-xs text-gray-500">{m.label}</p>
                                    <p className="mt-1 text-lg font-semibold text-gray-900">
                                      <UsageCell used={detail.usage[m.key]} limit={detail.limits.limits[m.key]} />
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-sm text-gray-500">No accounts match that search.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}