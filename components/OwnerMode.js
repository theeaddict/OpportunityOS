'use client';

import { useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui';

/**
 * Business Owner Mode — a plain-language, guided experience.
 *
 * The owner answers four questions, the system quietly builds an opportunity-
 * finding strategy, runs it in the background, and reports results in business
 * terms ("6 opportunities found") — never "Agent 1 completed".
 */

const POLL_MS = 2500;

const inputCls = 'block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none';
const labelCls = 'mb-1 block text-xs font-medium text-gray-600';

export function OwnerMode({ initial }) {
  const { goals } = initial;
  const [profile, setProfile] = useState(initial.profile);
  const [strategy, setStrategy] = useState(initial.profile?.strategy || null);

  // If there's already a live run when the page loads, resume monitoring it.
  const resumeLive = Boolean(
    initial.profile && initial.latestRun && ['queued', 'running'].includes(initial.latestRun.status)
  );
  const [step, setStep] = useState(resumeLive ? 'running' : (initial.profile ? 'plan' : 'setup'));
  const [form, setForm] = useState({
    business_name: initial.profile?.business_name || '',
    sell_what: initial.profile?.sell_what || '',
    location: initial.profile?.location || '',
    ideal_customers: initial.profile?.ideal_customers || '',
    goals: initial.profile?.goals || [],
  });

  const [view, setView] = useState(null);
  const [jobId, setJobId] = useState(resumeLive ? initial.latestRun.id : null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [copied, setCopied] = useState(null);
  const [openMessage, setOpenMessage] = useState(null);
  const [watchState, setWatchState] = useState({ status: 'idle', message: null });
  const [watchInterval, setWatchInterval] = useState(1440);
  const pollRef = useRef(null);
  const mountedRef = useRef(true);

  // Resume an in-flight run (or a finished one) on first load.
  useEffect(() => {
    mountedRef.current = true;
    const run = initial.latestRun;
    if (initial.profile && run) {
      void fetchRun(run.id);
    }
    return () => {
      mountedRef.current = false;
      clearTimeout(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchRun(id) {
    try {
      const res = await fetch(`/api/owner?job_id=${id}`, { cache: 'no-store' });
      const data = await res.json();
      if (!data.ok || !mountedRef.current) return;
      setView(data);
      setJobId(id);
      const live = data.job.status === 'queued' || data.job.status === 'running';
      if (data.job.status === 'completed') setStep('results');
      else if (live) setStep('running');
      if (live) {
        clearTimeout(pollRef.current);
        pollRef.current = setTimeout(() => { void fetchRun(id); }, POLL_MS);
      }
    } catch {
      /* transient network blip — next poll or manual action resumes */
    }
  }

  async function buildPlan(e) {
    e.preventDefault();
    if (!String(form.sell_what || '').trim() || !form.goals.length) {
      setErr('Tell us what you sell and pick at least one goal so we can build your plan.');
      return;
    }
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/owner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onboard: true, ...form }),
      });
      const data = await res.json();
      if (!data.ok) { setErr(data.error || 'Something went wrong. Please try again.'); return; }
      setProfile(data.profile);
      setStrategy(data.strategy);
      setStep('plan');
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }

  async function startRun() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/owner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run' }),
      });
      const data = await res.json();
      if (!data.ok) { setErr(data.error || 'Could not start. Please try again.'); return; }
      await fetchRun(data.job_id);
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelRun() {
    if (!jobId) return;
    await fetch(`/api/jobs/${jobId}/cancel`, { method: 'POST' }).catch(() => {});
    void fetchRun(jobId);
  }

  async function copyMessage(text, id) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setErr('Could not copy — please select the text manually.');
    }
  }

  // Turn the completed run's strategy into a recurring "watch" (keeps scanning
  // on the chosen interval and pings when a new strong opportunity appears).
  async function startWatch() {
    if (watchState.status === 'saving') return;
    const filters = view?.strategy?.filters || strategy?.filters;
    if (!filters) { setWatchState({ status: 'error', message: 'No search strategy saved yet — run the search once first.' }); return; }
    const name = [strategy?.focus?.industries, strategy?.focus?.location].flat().filter(Boolean).join(', ') || 'Opportunity watch';
    setWatchState({ status: 'saving', message: null });
    try {
      const res = await fetch('/api/discover/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.slice(0, 160),
          filters,
          interval_minutes: watchInterval,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setWatchState({ status: 'error', message: data.error || 'Could not create the watch.' });
        return;
      }
      setWatchState({
        status: 'saved',
        message: `Watching — this search now re-runs every ${data.schedule.interval_minutes} min. Manage it under Find opportunities.`,
      });
    } catch (ex) {
      setWatchState({ status: 'error', message: ex.message });
    }
  }

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const toggleGoal = (key) => setForm((f) => ({
    ...f,
    goals: f.goals.includes(key) ? f.goals.filter((g) => g !== key) : [...f.goals, key],
  }));

  const focusIndustries = strategy?.focus?.industries || [];
  const focusLocation = strategy?.focus?.location || null;
  const goalLabels = strategy?.focus?.goalLabels || [];

  return (
    <div className="space-y-6">
      {err && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{err}</p>
      )}

      {step === 'setup' && (
        <SetupWizard
          form={form}
          goals={goals}
          setField={setField}
          toggleGoal={toggleGoal}
          onSubmit={buildPlan}
          busy={busy}
        />
      )}

      {step === 'plan' && strategy && (
        <div className="space-y-6">
          <Card className="p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Your plan</p>
            <h2 className="mt-1 text-xl font-bold text-gray-900">
              Here&apos;s what we&apos;ll do for {profile?.business_name || 'your business'}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-sm text-gray-500">We&apos;ll look for:</span>
              {(focusIndustries.length ? focusIndustries : ['businesses like the ones you described']).map((t) => (
                <span key={t} className="rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700">
                  {t}
                </span>
              ))}
              {focusLocation && (
                <span className="rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-600">
                  in {focusLocation}
                </span>
              )}
            </div>
            {goalLabels.length > 0 && (
              <p className="mt-3 text-sm text-gray-600">
                Your goal{goalLabels.length === 1 ? '' : 's'}:{' '}
                <span className="font-medium">{goalLabels.join(', ')}.</span>
              </p>
            )}
          </Card>

          <Card className="p-6">
            <h3 className="mb-4 text-base font-bold text-gray-900">What happens next — in plain English</h3>
            <ol className="space-y-3">
              {(strategy.steps || []).map((s, i) => (
                <li key={i} className="flex gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">
                    {i + 1}
                  </span>
                  <span className="text-sm leading-6 text-gray-700">{s}</span>
                </li>
              ))}
            </ol>
            <button
              onClick={startRun}
              disabled={busy}
              className="mt-6 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? 'Starting…' : 'Start looking for opportunities'}
            </button>
            <button
              onClick={() => setStep('setup')}
              className="ml-3 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              Edit my answers
            </button>
          </Card>
        </div>
      )}

      {step === 'running' && (
        <RunningView
          view={view}
          profile={profile}
          jobId={jobId}
          onCancel={cancelRun}
          onRetry={startRun}
          onEdit={() => setStep('setup')}
        />
      )}

      {step === 'results' && view?.summary && (
        <ResultsView
          view={view}
          profile={profile}
          copied={copied}
          openMessage={openMessage}
          setOpenMessage={setOpenMessage}
          onCopy={copyMessage}
          onAgain={startRun}
          busy={busy}
          onEdit={() => setStep('setup')}
          watchState={watchState}
          watchInterval={watchInterval}
          setWatchInterval={setWatchInterval}
          onWatch={startWatch}
        />
      )}
    </div>
  );
}

function SetupWizard({ form, goals, setField, toggleGoal, onSubmit, busy }) {
  return (
    <Card className="p-6 sm:p-8">
      <span className="inline-block rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700">
        Let&apos;s get set up
      </span>
      <h2 className="mt-3 text-2xl font-bold text-gray-900">Tell us about your business</h2>
      <p className="mt-1 text-sm text-gray-500">
        Four quick questions. We&apos;ll handle the rest and show you results in plain English.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-5">
        <div>
          <label htmlFor="owner-business" className={labelCls}>1. What does your business sell or provide?</label>
          <textarea
            id="owner-business"
            rows={2}
            value={form.sell_what}
            onChange={(e) => setField('sell_what', e.target.value)}
            placeholder="e.g. Made-to-order furniture for homes and offices"
            className={inputCls}
          />
        </div>

        <div>
          <label htmlFor="owner-location" className={labelCls}>2. Where do you operate?</label>
          <input
            id="owner-location"
            type="text"
            value={form.location}
            onChange={(e) => setField('location', e.target.value)}
            placeholder="e.g. Nairobi"
            className={inputCls}
          />
        </div>

        <div>
          <label htmlFor="owner-customers" className={labelCls}>3. Who are your ideal customers?</label>
          <textarea
            id="owner-customers"
            rows={2}
            value={form.ideal_customers}
            onChange={(e) => setField('ideal_customers', e.target.value)}
            placeholder="e.g. Restaurants, hotels and offices outfitting their spaces"
            className={inputCls}
          />
        </div>

        <fieldset>
          <legend className="mb-2 text-xs font-medium text-gray-600">4. What are you trying to achieve?</legend>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {goals.map((g) => (
              <label
                key={g.key}
                className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2.5 text-sm transition ${
                  form.goals.includes(g.key)
                    ? 'border-blue-400 bg-blue-50 font-medium text-blue-800'
                    : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={form.goals.includes(g.key)}
                  onChange={() => toggleGoal(g.key)}
                  className="mt-0.5 h-4 w-4 accent-blue-600"
                />
                <span>{g.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'Building your plan…' : 'Build my plan'}
          </button>
          <p className="text-xs text-gray-400">You can change these answers any time.</p>
        </div>
      </form>
    </Card>
  );
}

function RunningView({ view, profile, jobId, onCancel, onRetry, onEdit }) {
  const live = view?.job && (view.job.status === 'queued' || view.job.status === 'running');
  const pct = view?.job?.progress || 0;
  return (
    <Card className="p-6">
      <h2 className="text-xl font-bold text-gray-900">
        Looking for opportunities for {profile?.business_name || 'your business'}
      </h2>
      <p className="mt-1 text-sm text-gray-500">
        This usually takes about a minute. No need to stay on this page — we keep working in the background.
      </p>

      <div className="mt-6">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-gray-700">{view?.message || 'Starting…'}</span>
          <span className="font-semibold text-blue-700">{view?.progress_label || '0%'}</span>
        </div>
        <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className={`h-full rounded-full transition-all ${view?.job?.status === 'cancelled' ? 'bg-orange-400' : view?.job?.status === 'failed' ? 'bg-red-400' : 'bg-blue-600'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {!live && view?.job?.status === 'cancelled' && (
          <p className="mt-3 rounded-lg bg-orange-50 px-4 py-3 text-sm text-orange-700">
            You stopped this run. Nothing was sent to anyone.
          </p>
        )}
        {!live && view?.job?.status === 'failed' && (
          <p className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {view.message}
          </p>
        )}
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        {live ? (
          <button
            onClick={onCancel}
            className="rounded-lg border border-orange-200 px-4 py-2.5 text-sm font-semibold text-orange-700 hover:bg-orange-50"
          >
            Stop this run
          </button>
        ) : (
          <>
            <button
              onClick={onRetry}
              className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Run again
            </button>
            <button
              onClick={onEdit}
              className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              Edit my answers
            </button>
          </>
        )}
        {!live && <span className="self-center text-xs text-gray-400">Run {jobId ? `#${jobId}` : ''}</span>}
      </div>
    </Card>
  );
}

function ResultsView({ view, profile, copied, openMessage, setOpenMessage, onCopy, onAgain, busy, onEdit, watchState, watchInterval, setWatchInterval, onWatch }) {
  const { summary, results } = view;
  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h2 className={`text-2xl font-bold ${summary.tone === 'positive' ? 'text-gray-900' : 'text-gray-900'}`}>
          {summary.headline}
        </h2>
        <p className="mt-1 text-sm text-gray-600">{summary.subtext}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            onClick={onAgain}
            disabled={busy}
            className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'Starting…' : 'Run again'}
          </button>
          <button
            onClick={onEdit}
            className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            Edit my answers
          </button>
        </div>

        <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-emerald-900">Keep watching for opportunities like this</p>
              <p className="text-xs text-emerald-700">We&apos;ll re-run this search on a schedule and tell you when something new turns up.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-emerald-700">
                every
                <select
                  value={watchInterval}
                  onChange={(e) => setWatchInterval(Number(e.target.value))}
                  className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs"
                >
                  {[60, 180, 720, 1440].map((m) => <option key={m} value={m}>{m === 1440 ? 'day' : m === 720 ? '12 hours' : m === 180 ? '3 hours' : 'hour'}</option>)}
                </select>
              </label>
              <button
                onClick={onWatch}
                disabled={watchState.status === 'saving'}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {watchState.status === 'saving' ? 'Starting…' : 'Watch automatically'}
              </button>
            </div>
          </div>
          {(watchState.status === 'saved' || watchState.status === 'error') && (
            <p className={`mt-3 text-xs ${watchState.status === 'error' ? 'text-red-700' : 'text-emerald-800'}`}>
              {watchState.message}
            </p>
          )}
        </div>
      </Card>

      {results.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-lg font-semibold text-gray-800">Nothing matched closely enough yet</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-gray-500">
            Try adding a few more words to “who are your ideal customers” — like the kinds of businesses you already
            serve — then run it again.
          </p>
        </Card>
      ) : (
        results.map((r) => (
          <div key={r.id} className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold text-gray-900">{r.business_name}</h3>
                  <p className="mt-0.5 text-sm text-gray-500">
                    {[r.business_industry, r.business_location].filter(Boolean).join(' · ') || 'Business'}
                  </p>
                </div>
                <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${r.priority.tone}`}>
                  {r.priority.label}
                </span>
              </div>

              {r.problem && (
                <p className="mt-3 text-sm text-gray-600">
                  What we noticed: <span className="font-medium text-gray-800">{r.problem}</span>.
                </p>
              )}
              {r.why && <p className="mt-1 text-sm leading-6 text-gray-600">{r.why}</p>}

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  onClick={() => setOpenMessage(openMessage === r.id ? null : r.id)}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  {openMessage === r.id ? 'Close message' : 'Draft a message'}
                </button>
                <span className="text-xs text-gray-400">A starting point — review before you send.</span>
              </div>
            </div>

            {openMessage === r.id && (
              <div className="border-t border-gray-100 bg-gray-50 p-5">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Message draft</p>
                  <button
                    onClick={() => onCopy(r.message_body, r.id)}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-100"
                  >
                    {copied === r.id ? 'Copied ✓' : 'Copy to clipboard'}
                  </button>
                </div>
                <pre className="mt-3 whitespace-pre-wrap rounded-lg border border-gray-200 bg-white p-4 font-sans text-sm leading-6 text-gray-700">
                  {r.message_body}
                </pre>
                <p className="mt-2 text-xs text-gray-400">
                  Personalise the details, then send it however you normally reach this kind of business.
                </p>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}