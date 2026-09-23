'use client';

import { useEffect, useState } from 'react';

function Pill({ ok, label }) {
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${
        ok ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
      }`}
    >
      {label || (ok ? 'ok' : 'problem')}
    </span>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">{label}</p>
      <p className="mt-1 text-lg font-semibold text-gray-900">{value}</p>
    </div>
  );
}

export default function SystemHealthClient() {
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/admin/system', { headers: { Accept: 'application/json' } })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => (ok ? setHealth(d.health) : setError(d?.error || 'Failed to load')))
      .catch(() => setError('Failed to load'));
  }, []);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!health) return <p className="text-sm text-gray-400">Loading system health…</p>;

  const { db, jobs, providers, app } = health;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Pill ok={health.ok} label={health.ok ? 'All systems ok' : 'Degraded'} />
        <p className="text-xs text-gray-500">Generated {new Date(health.generated_at).toLocaleString()}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Database" value={db.ok ? `${db.latency_ms}ms` : 'unreachable'} />
        <Stat label="Uptime" value={`${app.uptime_seconds}s`} />
        <Stat label="Queue total" value={jobs.total} />
        <Stat label="Registered handlers" value={jobs.registered_handlers} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Database</p>
            <Pill ok={db.ok} />
          </div>
          <p className="mt-2 text-sm text-gray-700">
            {db.backend} · {db.latency_ms}ms{db.error ? ` — ${db.error}` : ''}
          </p>
          <p className="mt-1 text-xs text-gray-500">App {app.version} · Node {app.node_version} · {app.env}</p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Background worker</p>
            <Pill ok={jobs.worker.running} label={jobs.worker.running ? 'running' : 'stopped'} />
          </div>
          <p className="mt-2 text-sm text-gray-700">
            {jobs.worker.running ? 'Claiming and processing background jobs.' : 'No worker in this process.'}
          </p>
          {jobs.worker.started_at && (
            <p className="mt-1 text-xs text-gray-500">Started {new Date(jobs.worker.started_at).toLocaleString()}</p>
          )}
          {jobs.stale_running > 0 && (
            <p className="mt-2 text-sm text-red-700">
              {jobs.stale_running} running job{jobs.stale_running === 1 ? '' : 's'} over 30 minutes old — possible
              wedged worker (ids: {jobs.stale_running_ids.join(', ')})
            </p>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Job queue by status</p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {Object.entries(jobs.counts).map(([status, n]) => (
            <div key={status} className="rounded border border-gray-200 p-3">
              <p className="text-xs text-gray-500">{status}</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">{n}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-gray-500">
          Oldest queued:{' '}
          {jobs.oldest_queued_at ? new Date(jobs.oldest_queued_at).toLocaleString() : 'none'} · Handler types:{' '}
          {jobs.handler_types.join(', ')}
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Providers</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded border border-gray-200 p-3">
            <p className="text-xs text-gray-500">AI engine</p>
            <div className="mt-1 flex items-center gap-2">
              <Pill ok={providers.ai.configured} label={providers.ai.configured ? providers.ai.provider : 'not configured'} />
            </div>
            <p className="mt-1 text-xs text-gray-500">{providers.ai.configured ? providers.ai.model : 'Set AI_API_KEY + AI_MODEL'}</p>
          </div>
          <div className="rounded border border-gray-200 p-3">
            <p className="text-xs text-gray-500">Research</p>
            <div className="mt-1 flex items-center gap-2">
              <Pill ok={providers.research.configured} label={providers.research.provider} />
            </div>
            <p className="mt-1 text-xs text-gray-500">RESEARCH_PROVIDER={providers.research.provider}</p>
          </div>
          <div className="rounded border border-gray-200 p-3">
            <p className="text-xs text-gray-500">Discovery sources</p>
            <p className="mt-1 text-sm text-gray-800">
              {providers.discovery.length ? providers.discovery.map((d) => d.label).join(' · ') : 'manual only'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}