'use client';

import { useEffect, useState } from 'react';

export default function ControlRoomClient({ user }) {
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
          Platform-wide visibility across every tenant account. Access is restricted to the superadmin flag only —
          not linkable from normal navigation, enforced server-side on every page and API route.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Signed in as</p>
          <p className="mt-2 text-lg font-semibold text-gray-900">{user?.name}</p>
          <p className="text-sm text-gray-500">{user?.email}</p>
          <span className="mt-2 inline-block rounded bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
            {user?.role} · is_superadmin
          </span>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">System-wide</p>
          {overview ? (
            <>
              <p className="mt-2 text-3xl font-bold text-gray-900">{overview.system.accounts}</p>
              <p className="text-sm text-gray-500">tenant accounts</p>
              <p className="mt-2 text-xs text-gray-400">Generated {new Date(overview.system.generated_at).toLocaleString()}</p>
            </>
          ) : error ? (
            <p className="mt-2 text-sm text-red-600">{error}</p>
          ) : (
            <p className="mt-2 text-sm text-gray-400">Loading…</p>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Access control (stage 1)</p>
        <ul className="mt-3 space-y-2 text-sm text-gray-700">
          <li>
            <span className="font-medium text-gray-900">users.is_superadmin</span> — platform flag, orthogonal to the
            tenant role. Never writable through register, members APIs, or any settings form.
          </li>
          <li>
            <span className="font-medium text-gray-900">/admin/*</span> — layout calls{' '}
            <code className="rounded bg-gray-100 px-1">getCurrentUser()</code> and{' '}
            <code className="rounded bg-gray-100 px-1">forbidden()</code> (403) unless is_superadmin.
          </li>
          <li>
            <span className="font-medium text-gray-900">API layer</span> — every /api/admin route runs{' '}
            <code className="rounded bg-gray-100 px-1">requireSuperadmin()</code> (401 / 403 JSON), independent of any
            UI state.
          </li>
        </ul>
      </div>
    </div>
  );
}