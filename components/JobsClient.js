'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui';

const STATUS_STYLE = {
  queued: 'bg-gray-100 text-gray-600',
  running: 'bg-blue-100 text-blue-700',
  completed: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-orange-100 text-orange-700',
};

// Types that take an opportunity id in the payload vs a business id, so the
// quick-run panel can offer the right entity picker.
const TYPE_ENTITY = {
  RESEARCH: 'business',
  AI_RESEARCH: 'business',
  OPPORTUNITY_ANALYSIS: 'opportunity',
  FINANCIAL_ANALYSIS: 'opportunity',
  SOLUTION_MATCHING: 'opportunity',
  OUTREACH_GENERATION: 'opportunity',
  DEMO_GENERATION: 'opportunity',
  DISCOVERY: null,
};

const POLL_MS = 2000;

export function JobsClient({ initialJobs, businesses, opportunities, jobTypes, jobTypeLabels }) {
  const [jobs, setJobs] = useState(initialJobs);
  const [type, setType] = useState('OPPORTUNITY_ANALYSIS');
  const [entityId, setEntityId] = useState('');
  const [enqueueing, setEnqueueing] = useState(false);
  const [actionMsg, setActionMsg] = useState(null);
  const [actionErr, setActionErr] = useState(null);
  const busyRef = useRef(false);

  async function refresh() {
    try {
      const res = await fetch('/api/jobs?limit=50', { cache: 'no-store' });
      const data = await res.json();
      if (data.ok) setJobs(data.jobs || []);
    } catch { /* transient */ }
  }

  // Poll while any job is live; this reflects the real job state (progress,
  // stage, status) straight from the DB — never a fake animation.
  useEffect(() => {
    let timer;
    const poll = async () => {
      const live = jobs.some((j) => j.status === 'queued' || j.status === 'running');
      if (live || busyRef.current) {
        await refresh();
        timer = setTimeout(poll, POLL_MS);
      }
    };
    poll();
    return () => clearTimeout(timer);
  }, [jobs]);

  async function enqueue(e) {
    e.preventDefault();
    setEnqueueing(true); setActionMsg(null); setActionErr(null);
    try {
      const entityField = TYPE_ENTITY[type];
      if (entityField && !entityId) {
        setActionErr('Choose a business or opportunity first.');
        return;
      }
      const payload = entityField ? { [entityField === 'business' ? 'businessId' : 'opportunityId']: Number(entityId) } : {};
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, payload }),
      });
      const data = await res.json();
      if (!data.ok) { setActionErr(data.error || 'Could not enqueue job.'); return; }
      setActionMsg(`Queued ${jobTypeLabels[type] || type} — it will run in the background.`);
      setEntityId('');
      busyRef.current = true;
      await refresh();
      busyRef.current = false;
    } catch (err) {
      setActionErr(err.message);
    } finally {
      setEnqueueing(false);
    }
  }

  async function act(path, verb, id) {
    setActionMsg(null); setActionErr(null);
    try {
      const res = await fetch(path, { method: 'POST' });
      const data = await res.json();
      if (!data.ok) { setActionErr(data.error || 'Action failed.'); return; }
      setActionMsg(`${verb} requested for job #${id}.`);
      await refresh();
    } catch (err) {
      setActionErr(err.message);
    }
  }

  const entityOptions = TYPE_ENTITY[type] === 'business' ? businesses : opportunities;
  const liveCount = jobs.filter((j) => j.status === 'queued' || j.status === 'running').length;

  return (
    <div className="space-y-6">
      {liveCount > 0 && (
        <p className="flex items-center gap-2 rounded-lg bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-600" />
          {liveCount} job{liveCount === 1 ? '' : 's'} running in the background — progress below is the real state.
        </p>
      )}

      <Card className="p-6">
        <h2 className="mb-1 text-base font-bold text-gray-900">Run a job in the background</h2>
        <p className="mb-4 text-sm text-gray-500">
          The worker executes the underlying work (research, analysis, matching, outreach, demo) and the job
          only completes when that work is actually done.
        </p>
        <form onSubmit={enqueue} className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-600">Job type</span>
            <select value={type} onChange={(e) => { setType(e.target.value); setEntityId(''); }} className={inputCls}>
              {jobTypes.filter((t) => TYPE_ENTITY[t] != null).map((t) => (
                <option key={t} value={t}>{t} — {jobTypeLabels[t]}</option>
              ))}
            </select>
          </label>
          {TYPE_ENTITY[type] && (
            <label className="block min-w-64">
              <span className="mb-1 block text-xs font-medium text-gray-600">
                {TYPE_ENTITY[type] === 'business' ? 'Business' : 'Opportunity'}
              </span>
              <select value={entityId} onChange={(e) => setEntityId(e.target.value)} className={inputCls}>
                <option value="">Choose…</option>
                {entityOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name || o.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="submit" disabled={enqueueing}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
            {enqueueing ? 'Enqueuing…' : 'Run job'}
          </button>
        </form>
        {actionMsg && <p className="mt-3 text-sm text-emerald-700">{actionMsg}</p>}
        {actionErr && <p className="mt-3 text-sm text-red-600">{actionErr}</p>}
      </Card>

      <Card className="overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-2.5">ID</th>
              <th className="px-4 py-2.5">Type</th>
              <th className="px-4 py-2.5">Target</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Progress</th>
              <th className="px-4 py-2.5">Attempts</th>
              <th className="px-4 py-2.5">Started</th>
              <th className="px-4 py-2.5">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {jobs.map((j) => (
              <JobRow key={j.id} j={j} labels={jobTypeLabels} onCancel={() => act(`/api/jobs/${j.id}/cancel`, 'Cancel', j.id)} onRetry={() => act(`/api/jobs/${j.id}/retry`, 'Retry', j.id)} />
            ))}
            {!jobs.length && <tr><td colSpan="8" className="px-4 py-4 text-center text-gray-400">No jobs yet</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function JobRow({ j, labels, onCancel, onRetry }) {
  const label = labels[j.type] || j.type;
  const target = describeTarget(j);
  const live = j.status === 'queued' || j.status === 'running';
  const errorPreview = j.error ? truncate(j.error, 200) : null;

  return (
    <tr className="align-top">
      <td className="px-4 py-2.5 text-gray-400">#{j.id}</td>
      <td className="px-4 py-2.5 font-medium text-gray-900">{label}</td>
      <td className="px-4 py-2.5 text-gray-500">{target}</td>
      <td className="px-4 py-2.5">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${STATUS_STYLE[j.status] || 'bg-gray-100 text-gray-600'}`}>
          {j.status}
        </span>
        {j.status === 'cancelled' && <p className="mt-1 max-w-xs text-[11px] text-orange-600">Stopped at a safe point — not completed.</p>}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-gray-100">
            <div className={`h-full ${j.status === 'failed' ? 'bg-red-400' : j.status === 'cancelled' ? 'bg-orange-400' : 'bg-blue-600'}`}
              style={{ width: `${j.progress || 0}%` }} />
          </div>
          <span className="text-gray-500">{j.progress || 0}%</span>
        </div>
        {j.stage && <p className="mt-0.5 text-[11px] text-gray-400">{String(j.stage).replaceAll('_', ' ')}</p>}
      </td>
      <td className="px-4 py-2.5 text-gray-500">{j.attempts}/{j.max_attempts}</td>
      <td className="px-4 py-2.5 text-gray-400">{String(j.started_at || j.created_at || '').slice(0, 16)}</td>
      <td className="px-4 py-2.5">
        <div className="flex gap-2">
          {live && (
            <button onClick={onCancel} className="rounded-lg border border-orange-200 px-2.5 py-1 text-xs font-semibold text-orange-700 hover:bg-orange-50">
              Cancel
            </button>
          )}
          {j.status === 'failed' && (
            <button onClick={onRetry} className="rounded-lg border border-blue-200 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50">
              Retry
            </button>
          )}
          {j.status === 'completed' && j.type === 'DISCOVERY' && j.result?.businesses_researched != null && (
            <span className="text-[11px] text-gray-400">{j.result.strong_opportunities} strong / {j.result.businesses_researched} researched</span>
          )}
        </div>
        {errorPreview && <p className="mt-1 max-w-xs text-[11px] text-red-500" title={j.error}>{errorPreview}</p>}
        {!live && j.result?.interrupted && <p className="mt-1 text-[11px] text-orange-600">Partial work recorded before stop.</p>}
        {!live && j.status === 'completed' && j.result?.skipped === true && (
          <p className="mt-1 text-[11px] text-gray-500">Skipped: {j.result.reason || 'no work available'}.</p>
        )}
        {!live && j.status === 'completed' && j.result?.opportunity_id && (
          <Link href={`/opportunities/${j.result.opportunity_id}`} className="mt-1 inline-block text-[11px] text-blue-600 hover:underline">
            View opportunity →
          </Link>
        )}
        {j.status === 'completed' && j.type === 'OUTREACH_GENERATION' && j.result?.messageIds?.length && (
          <Link href={`/opportunities/${j.result.opportunity_id}/#outreach`} className="mt-1 inline-block text-[11px] text-blue-600 hover:underline">
            {j.result.messageIds.length} draft{j.result.messageIds.length === 1 ? '' : 's'} awaiting approval →
          </Link>
        )}
      </td>
    </tr>
  );
}

function describeTarget(j) {
  const p = j.payload || {};
  if (p.opportunityId) return `Opportunity #${p.opportunityId}`;
  if (p.businessId) return `Business #${p.businessId}`;
  if (j.type === 'DISCOVERY') {
    const f = p.filters || {};
    return [f.industry, f.query, f.location].filter(Boolean).join(' · ') || '—';
  }
  return '—';
}

function truncate(s, n) {
  const t = String(s || '');
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

const inputCls = 'block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none';