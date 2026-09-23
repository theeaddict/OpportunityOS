'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import '@/lib/csrf-client';

export default function ApiKeysClient() {
  const [keys, setKeys] = useState(null);
  const [accounts, setAccounts] = useState(null);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [created, setCreated] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(() => {
    return Promise.all([
      fetch('/api/admin/api-keys', { headers: { Accept: 'application/json' } }),
      fetch('/api/admin/accounts', { headers: { Accept: 'application/json' } }),
    ])
      .then(async ([a, b]) => ({
        k: await a.json().catch(() => null),
        accts: await b.json().catch(() => null),
      }))
      .then(({ k, accts }) => {
        if (k?.ok) setKeys(k.keys);
        else setError(k?.error || 'Failed to load keys');
        if (accts?.ok) setAccounts(accts.accounts);
      })
      .catch(() => setError('Failed to load'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function issue(e) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setCreated(null);
    const fd = new FormData(e.currentTarget);
    const res = await fetch('/api/admin/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account_id: Number(fd.get('account_id')),
        name: fd.get('name'),
        rate_limit_hour: fd.get('rate_limit_hour') || null,
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setError(body?.error || 'Request failed');
      return;
    }
    setCreated(body.key);
    e.currentTarget.reset();
    setMessage('');
    await load();
  }

  async function revoke(key) {
    if (!window.confirm(`Revoke API key "${key.name}"? Existing integrations using it will stop immediately.`)) return;
    setBusyId(key.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/api-keys/${key.id}`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || 'Request failed');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  const active = useMemo(() => (keys || []).filter((k) => k.status === 'active'), [keys]);
  const revoked = useMemo(() => (keys || []).filter((k) => k.status === 'revoked'), [keys]);

  if (error && !keys) return <p className="text-sm text-red-600">{error}</p>;
  if (!keys) return <p className="text-sm text-gray-400">Loading API keys…</p>;

  return (
    <div className="space-y-6">
      {message && <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{message}</p>}
      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {created && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">Save this key now — it is shown only once.</p>
          <p className="mt-2 rounded border border-amber-300 bg-white px-3 py-2 font-mono text-sm break-all text-gray-900">{created.full_key}</p>
          <button
            onClick={() => setCreated(null)}
            className="mt-3 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
          >
            I&apos;ve saved it
          </button>
        </div>
      )}

      <form onSubmit={issue} className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">Issue a new key</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <select
            name="account_id"
            required
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none"
          >
            <option value="">Select account…</option>
            {(accounts || []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} (#{a.id} · {a.plan_code})
              </option>
            ))}
          </select>
          <input
            name="name"
            required
            maxLength={80}
            placeholder="Key name (e.g. Production ingest)"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none"
          />
          <input
            name="rate_limit_hour"
            type="number"
            min="1"
            placeholder="Rate limit / hour (blank = default)"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          className="mt-3 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800"
        >
          Issue key
        </button>
      </form>

      <section className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-900">Active keys ({active.length})</h2>
        <KeyTable keys={active} busyId={busyId} onRevoke={revoke} />
      </section>

      {revoked.length > 0 && (
        <section className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-gray-900">Revoked ({revoked.length})</h2>
          <KeyTable keys={revoked} busyId={busyId} />
        </section>
      )}
    </div>
  );
}

function KeyTable({ keys, busyId, onRevoke }) {
  if (!keys.length) return <p className="mt-3 text-sm text-gray-400">No keys.</p>;
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-4 py-3">Name</th>
            <th className="px-4 py-3">Account</th>
            <th className="px-4 py-3">Prefix</th>
            <th className="px-4 py-3">Limit/h</th>
            <th className="px-4 py-3">Last used</th>
            <th className="px-4 py-3">Issued</th>
            {onRevoke && <th className="px-4 py-3 text-right">Actions</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {keys.map((k) => (
            <tr key={k.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 font-medium text-gray-900">{k.name}</td>
              <td className="px-4 py-3 text-gray-600">{k.account_name} <span className="text-gray-400">#{k.account_id}</span></td>
              <td className="px-4 py-3 font-mono text-xs text-gray-500">{k.key_prefix}</td>
              <td className="px-4 py-3 tabular-nums">{k.rate_limit_hour ?? '—'}</td>
              <td className="px-4 py-3 text-gray-500">{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : 'never'}</td>
              <td className="px-4 py-3 text-gray-500">{new Date(k.created_at).toLocaleDateString()}</td>
              {onRevoke && (
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => onRevoke(k)}
                    disabled={busyId === k.id}
                    className="rounded bg-red-600 px-2 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {busyId === k.id ? '…' : 'Revoke'}
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}