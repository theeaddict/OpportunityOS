'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Card, ScoreBadge, StatusBadge, ProblemTag, fmtMoney } from '@/components/ui';
import { PROBLEM_TYPE_KEYS, problemLabel, moneyMechanismLabel } from '@/lib/constants';

const STAGES = [
  ['discovering', 'Discovering businesses…'],
  ['researching', 'Researching businesses…'],
  ['checking_contacts', 'Checking public contact information…'],
  ['analyzing', 'Analyzing business operations…'],
  ['identifying_opportunities', 'Identifying opportunities…'],
  ['calculating_scenarios', 'Calculating scenarios…'],
  ['matching_solutions', 'Matching solutions…'],
  ['ranking', 'Ranking opportunities…'],
];

function stageIndex(stage) {
  const i = STAGES.findIndex(([k]) => k === stage);
  return i < 0 ? -1 : i;
}

const inputCls = 'block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none';

function Field({ label, hint, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      {hint && <span className="mb-1 block text-xs text-gray-400">{hint}</span>}
      {children}
    </label>
  );
}

export default function DiscoverClient({ providers, schedules: initialSchedules = [] }) {
  const external = providers.find((p) => p.id !== 'manual');
  const defaultProvider = external ? external.id : 'manual';
  const [provider] = useState(defaultProvider);

  const [form, setForm] = useState({
    industry: '', location: '', platform: '', minimumAudience: '',
    problemCategories: [], solutions: '',
  });
  const [job, setJob] = useState(null);
  const [progress, setProgress] = useState(null);
  const [results, setResults] = useState([]);
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [schedules, setSchedules] = useState(initialSchedules);
  const [watchBusy, setWatchBusy] = useState(false);
  const [watchError, setWatchError] = useState(null);
  const [intervalMin, setIntervalMin] = useState(60);
  const pollRef = useRef(null);

  useEffect(() => () => clearInterval(pollRef.current), []);

  async function loadSchedules() {
    try {
      const res = await fetch('/api/discover/schedules', { cache: 'no-store' });
      const data = await res.json();
      if (data.ok) setSchedules(data.schedules || []);
    } catch { /* non-fatal */ }
  }

  const setF = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  function toggleCategory(cat) {
    const has = form.problemCategories.includes(cat);
    setForm({
      ...form,
      problemCategories: has
        ? form.problemCategories.filter((c) => c !== cat)
        : [...form.problemCategories, cat],
    });
  }

  async function poll(jobId) {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/discover/jobs/${jobId}`, { cache: 'no-store' });
        const data = await res.json();
        if (!data.ok) return;
        setProgress({ status: data.status, stage: data.stage, pct: data.progress });
        if (data.status === 'completed') {
          clearInterval(pollRef.current);
          setBusy(false);
          setSummary(data.summary);
          setResults(data.results || []);
          setProgress({ status: 'completed', stage: data.stage, pct: 100 });
        } else if (data.status === 'failed') {
          clearInterval(pollRef.current);
          setBusy(false);
          setError(data.error || 'This run failed. Please try again.');
        } else if (data.status === 'cancelled') {
          clearInterval(pollRef.current);
          setBusy(false);
          setError('This run was cancelled before it finished. Partial work is kept on file.');
        }
      } catch {
        /* keep polling; transient network glitch */
      }
    }, 1500);
  }

  async function findOpportunities(e) {
    e.preventDefault();
    setBusy(true); setError(null); setSummary(null); setResults([]);
    setProgress({ status: 'queued', stage: null, pct: 0 });
    try {
      const res = await fetch('/api/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, ...form }),
      });
      const data = await res.json();
      if (!data.ok) { setBusy(false); setError(data.error || 'Something went wrong.'); return; }
      setJob(data.job_id);
      poll(data.job_id);
    } catch (err) {
      setBusy(false); setError(err.message);
    }
  }

  async function cancelRun() {
    if (!job) return;
    try {
      await fetch(`/api/discover/jobs/${job}/cancel`, { method: 'POST' });
    } catch { /* ignore */ }
  }

  async function saveWatch() {
    if (watchBusy) return;
    setWatchBusy(true); setWatchError(null);
    try {
      const res = await fetch('/api/discover/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: [form.industry, form.location].filter(Boolean).join(', ') || 'Untitled watch',
          provider,
          filters: form,
          interval_minutes: intervalMin,
        }),
      });
      const data = await res.json();
      if (!data.ok) { setWatchError(data.error || 'Could not create watch.'); return; }
      await loadSchedules();
    } catch (err) {
      setWatchError(err.message);
    } finally {
      setWatchBusy(false);
    }
  }

  async function patchWatch(id, patch) {
    try {
      const res = await fetch(`/api/discover/schedules/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (data.ok) {
        setSchedules((s) => s.map((x) => (x.id === id ? data.schedule : x)));
      }
    } catch { /* non-fatal */ }
  }

  async function deleteWatch(id) {
    try {
      await fetch(`/api/discover/schedules/${id}`, { method: 'DELETE' });
      await loadSchedules();
    } catch { /* non-fatal */ }
  }

  const activeIdx = progress ? stageIndex(progress.stage) : -1;
  const pct = progress?.pct || 0;

  return (
    <div className="space-y-8">
      <form onSubmit={findOpportunities} className="space-y-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="What solutions can you deliver?" hint="We use this to match the opportunity to your capability and estimate what you could charge.">
            <input value={form.solutions} onChange={setF('solutions')} placeholder="e.g. e-commerce, ordering portal, WhatsApp automation" className={inputCls} />
          </Field>
          <Field label="What industry or sector?" hint="Optional — narrow the search to a sector you already serve.">
            <input value={form.industry} onChange={setF('industry')} placeholder="e.g. Furniture, restaurants, agriculture" className={inputCls} />
          </Field>
          <Field label="Where are you looking?" hint="Country or city — the closer the better.">
            <input value={form.location} onChange={setF('location')} placeholder="e.g. Nairobi, Kenya" className={inputCls} />
          </Field>
        </div>
        <p className="text-xs text-gray-400">
          Business maturity isn&apos;t filtered at search time — it&apos;s evaluated from the evidence gathered during research and shown on each result.
        </p>

        <div className="sm:col-span-2">
          <span className="mb-2 block text-xs font-medium text-gray-500">What problems are you best positioned to solve?</span>
          <div className="flex flex-wrap gap-2">
            {PROBLEM_TYPE_KEYS.map((key) => (
              <button type="button" key={key} onClick={() => toggleCategory(key)}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${form.problemCategories.includes(key) ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                {problemLabel(key)}
              </button>
            ))}
          </div>
        </div>

        <details className="sm:col-span-2">
          <summary className="cursor-pointer text-xs font-medium text-gray-400 hover:text-gray-600">Optional filters — narrow by platform or audience size</summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label="Platform" hint="If the business sells mainly on one platform">
              <select value={form.platform} onChange={setF('platform')} className={inputCls}>
                {[
                  ['', 'Any platform'],
                  ['tiktok', 'TikTok'],
                  ['instagram', 'Instagram'],
                  ['facebook', 'Facebook'],
                  ['x', 'X / Twitter'],
                  ['linkedin', 'LinkedIn'],
                  ['web', 'Website'],
                ].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            <Field label="Minimum audience" hint="Follower count threshold — ignore early-stage pages">
              <input type="number" min="0" value={form.minimumAudience} onChange={setF('minimumAudience')} placeholder="e.g. 20000" className={inputCls} />
            </Field>
          </div>
        </details>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-gray-500">
              Start a watch that re-runs every
              <select value={intervalMin} onChange={(e) => setIntervalMin(Number(e.target.value))} className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs">
                {[15, 30, 60, 180, 720, 1440].map((m) => <option key={m} value={m}>{m === 60 ? 'hour' : m === 1440 ? 'day' : m === 180 ? '3 hours' : `${m} min`}</option>)}
              </select>
            </label>
            <button type="button" onClick={saveWatch} disabled={watchBusy}
              className="rounded-xl border border-emerald-300 px-4 py-3 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
              {watchBusy ? 'Saving…' : 'Watch automatically'}
            </button>
          </div>
          <button type="submit" disabled={busy && !results}
            className="rounded-xl bg-emerald-600 px-8 py-3 text-base font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50">
            {busy ? 'Finding opportunities…' : 'Find money-making opportunities'}
          </button>
        </div>
        <p className="text-xs text-gray-400">
          {external
            ? `Using the configured discovery source (${external.label}).`
            : 'No external discovery source is configured. Add businesses manually (the platform researches and analyzes them) or set DISCOVERY_API_URL / SOCIAL_MEDIA_FEED_URL. Real-time leads still arrive via the webhook.'}
        </p>
      </form>

      {watchError && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{watchError}</p>}

      {schedules.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Watching for new leads</h2>
          <div className="space-y-2">
            {schedules.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900">{s.name}</p>
                  <p className="text-xs text-gray-400">
                    Every {s.interval_minutes} min{s.last_run_at ? ` · last ran ${s.last_run_at}` : ' · next run in ~1 min'}
                    {s.filters && s.filters.industry ? ` · ${s.filters.industry}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <select value={s.interval_minutes} onChange={(e) => patchWatch(s.id, { interval_minutes: Number(e.target.value) })}
                    className="rounded-lg border border-gray-300 px-2 py-1 text-xs">
                    {[15, 30, 60, 180, 720, 1440].map((m) => <option key={m} value={m}>{m === 60 ? 'hour' : m === 1440 ? 'day' : m === 180 ? '3 hours' : `${m} min`}</option>)}
                  </select>
                  <button type="button" onClick={() => patchWatch(s.id, { enabled: !s.enabled })}
                    className={`rounded-lg px-3 py-1 text-xs font-semibold ${s.enabled ? 'border border-emerald-300 text-emerald-700 hover:bg-emerald-50' : 'border border-gray-300 text-gray-500 hover:bg-gray-100'}`}>
                    {s.enabled ? 'Watching' : 'Paused'}
                  </button>
                  <button type="button" onClick={() => deleteWatch(s.id)}
                    className="rounded-lg border border-red-200 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-50">
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <Card className="p-6">
        <h2 className="mb-1 text-base font-bold text-gray-900">Real-time leads by webhook</h2>
        <p className="mb-3 text-sm text-gray-500">
          Push leads the moment they surface (from a licensed social/lead collector): <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">POST /api/leads/webhook</code>.
          The platform deduplicates, saves any new evidence, and starts analysis immediately — no rescan needed.
        </p>
        <pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">{`{
  "results": [
    {
      "name": "Acme Soaps Ltd",
      "industry": "FMCG",
      "website": "acmesoaps.ng",
      "phone": "+2348012345678",
      "platform": "instagram",
      "socialUrl": "https://instagram.com/acmesoaps",
      "evidence": [
        { "text": "Publishes their WhatsApp number on their page", "claimType": "FACT", "signalKey": "publishes_whatsapp", "confidence": 0.9 },
        { "text": "Buys stock in small wholesale lots from distributors", "claimType": "FACT", "signalKey": "wholesale_operations", "confidence": 0.85 }
      ]
    }
  ]
}`}</pre>
        <p className="mt-3 text-xs text-gray-400">Auth: sign in as a workspace user, or configure <code className="rounded bg-gray-100 px-1 py-0.5">OPPORTUNITYOS_INGEST_TOKEN</code> and send the token + account id headers.</p>
      </Card>

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      {busy && progress && (
        <Card className="p-6">
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="font-semibold text-gray-900">Looking for money-making opportunities…</span>
            <span className="text-gray-500">{pct}%</span>
          </div>
          <div className="mb-5 h-2 w-full overflow-hidden rounded-full bg-gray-100">
            <div className="h-full rounded-full bg-emerald-600 transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
          <div className="mb-3 flex items-center justify-end">
            <button type="button" onClick={cancelRun}
              className="rounded-lg border border-orange-200 px-3 py-1 text-xs font-semibold text-orange-700 hover:bg-orange-50">
              Cancel run
            </button>
          </div>
          <ul className="space-y-1.5">
            {STAGES.map(([key, label], i) => {
              let cls = 'text-gray-300';
              let mark = null;
              if (progress.status === 'completed') { cls = 'text-emerald-700'; mark = '✔'; }
              else if (i < activeIdx) { cls = 'text-emerald-700'; mark = '✔'; }
              else if (i === activeIdx) { cls = 'text-blue-700 font-medium'; mark = '●'; }
              else { cls = 'text-gray-400'; mark = '○'; }
              return (
                <li key={key} className={`flex items-center gap-3 text-sm ${cls}`}>
                  <span className="w-4 text-center">{mark}</span>
                  <span>{label}</span>
                  {i === activeIdx && progress.status !== 'completed' && <span className="ml-auto animate-pulse text-xs">in progress</span>}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {summary && !busy && (
        <Card className="p-6">
          <h2 className="mb-3 text-base font-bold text-gray-900">Found {summary.strong_opportunities} strong {summary.strong_opportunities === 1 ? 'opportunity' : 'opportunities'}</h2>
          <dl className="grid gap-3 sm:grid-cols-3">
            <SummaryStat label="Businesses researched" value={summary.businesses_researched} />
            <SummaryStat label="With some evidence" value={summary.with_evidence} />
            <SummaryStat label="Strong opportunities" value={summary.strong_opportunities} />
          </dl>
          {Number(summary.manual_follow_up || 0) > 0 && (
            <p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {summary.manual_follow_up} {summary.manual_follow_up === 1 ? 'business was' : 'businesses were'} imported with no public phone/website on the source listing — they need manual follow-up to confirm a contact channel before outreach.
            </p>
          )}
        </Card>
      )}

      {summary && !busy && results.length === 0 && (
        <p className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">
          We researched {summary.businesses_researched} business{summary.businesses_researched === 1 ? '' : 'es'} and found evidence on {summary.with_evidence}, but none scored high enough to be a strong opportunity. Adjust your capability or location and try again.
        </p>
      )}

      {results.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Money-making opportunities found</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {results.map((o) => <ResultCard key={o.id} o={o} />)}
          </div>
        </section>
      )}
    </div>
  );
}

function ResultCard({ o }) {
  const mechanism = o.money_mechanism_key
    ? moneyMechanismLabel(o.money_mechanism_key)
    : (o.money_mechanism || '').replaceAll('_', ' ');
  return (
    <Link href={`/opportunities/${o.id}`} className="block">
      <Card className="p-4 transition hover:border-emerald-300 hover:shadow">
        <div className="flex items-start gap-3">
          <ScoreBadge score={o.opportunity_score} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="truncate font-semibold text-gray-900">{o.business_name}</p>
              {o.score_category && (
                <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">{o.score_category}</span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-gray-400">{[o.business_industry, o.business_location].filter(Boolean).join(' · ')}</p>
          </div>
        </div>
        <p className="mt-2 line-clamp-2 text-sm text-gray-700">{o.problem}</p>
        {mechanism && <p className="mt-1.5 text-xs text-gray-500"><span className="font-medium text-gray-600">Money:</span> {mechanism}</p>}
        {o.business_maturity_score != null && (
          <p className="mt-1 text-xs text-gray-500"><span className="font-medium text-gray-600">Maturity:</span> {o.business_maturity_score}/100</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
          <ProblemTag type={o.problem_type} />
          <StatusBadge status={o.status} />
          {o.confidence_score != null && (
            <span className="font-medium text-gray-700">{Math.round(Number(o.confidence_score) * 100)}% confident</span>
          )}
          {o.evidence_count != null && <span>{o.evidence_count} evidence items</span>}
          {o.recommended_solution_name && <span>Charge estimate: <span className="font-medium text-gray-700">{o.recommended_solution_name}</span></span>}
          {o.project_value_high != null && (
            <span><span className="font-medium text-gray-700">{fmtMoney(o.project_value_low)}–{fmtMoney(o.project_value_high)}</span></span>
          )}
        </div>
      </Card>
    </Link>
  );
}

function SummaryStat({ label, value }) {
  return (
    <div className="rounded-xl bg-gray-50 p-4 text-center">
      <p className="text-3xl font-bold text-gray-900">{value}</p>
      <p className="mt-1 text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
    </div>
  );
}