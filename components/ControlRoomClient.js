'use client';

import { useEffect, useState } from 'react';

export default function ControlRoomClient({ admin }) {
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/admin/overview', { headers: { Accept: 'application/json' } })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => (ok ? setOverview(d) : setError(d?.error || 'Failed to load')))
      .catch(() => setError('Failed to load'));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Control room</h1>
        <p className="mt-1 text-sm text-gray-600">
          Whole-system visibility across every tenant account. The administrator uses a separate
          identity (admin_users) and its own sign-in — no tenant account data is shared.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Signed in as</p>
          <p className="mt-2 text-lg font-semibold text-gray-900">{admin?.name}</p>
          <p className="text-sm text-gray-500">{admin?.email}</p>
          <span className="mt-2 inline-block rounded bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
            platform admin
          </span>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">System-wide</p>
          {overview ? (
            <>
              <p className="mt-2 text-3xl font-bold text-gray-900">{overview.system.accounts}</p>
              <p className="text-sm text-gray-500">tenant accounts</p>
            </>
          ) : error ? (
            <p className="mt-2 text-sm text-red-600">{error}</p>
          ) : (
            <p className="mt-2 text-sm text-gray-400">Loading…</p>
          )}
        </div>
      </div>
    </div>
  );
}