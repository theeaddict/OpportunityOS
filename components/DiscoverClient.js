'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, ScoreBadge, StatusBadge, ProblemTag, fmtMoney } from '@/components/ui';
import { PROBLEM_TYPE_KEYS, problemLabel, moneyMechanismLabel } from '@/lib/constants';
import { parseSearchIntent } from '@/lib/services/discovery/intent';
import MapAreaPicker from '@/components/MapAreaPicker';

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

const INTERVAL_OPTIONS = [15, 30, 60, 180, 720, 1440];
const intervalLabel = (m) => (m === 60 ? 'hour' : m === 1440 ? 'day' : m === 180 ? '3 hours' : `${m} min`);

/** A "Campaign: Industry" naming convention groups schedules created by
 * saveCampaign() into one card each — no separate backend concept, just
 * display grouping over the same discover_schedules rows a single watch uses. */
function groupSchedules(schedules) {
  const byPrefix = new Map();
  for (const s of schedules) {
    const idx = s.name.indexOf(': ');
    const prefix = idx > -1 ? s.name.slice(0, idx) : null;
    const key = prefix || `__standalone_${s.id}`;
    if (!byPrefix.has(key)) byPrefix.set(key, { prefix, items: [] });
    byPrefix.get(key).items.push(s);
  }
  const campaigns = [];
  const standalone = [];
  for (const { prefix, items } of byPrefix.values()) {
    if (prefix && items.length > 1) campaigns.push({ name: prefix, items });
    else standalone.push(...items);
  }
  return { campaigns, standalone };
}

function ScheduleRow({ s, patchWatch, deleteWatch, label }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
      <div className="min-w-0">
        <p className="font-semibold text-gray-900">{label}</p>
        <p className="text-xs text-gray-400">
          Every {s.interval_minutes} min{s.last_run_at ? ` · last ran ${s.last_run_at}` : ' · next run in ~1 min'}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <select value={s.interval_minutes} onChange={(e) => patchWatch(s.id, { interval_minutes: Number(e.target.value) })}
          className="rounded-lg border border-gray-300 px-2 py-1 text-xs">
          {INTERVAL_OPTIONS.map((m) => <option key={m} value={m}>{intervalLabel(m)}</option>)}
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
  );
}

export default function DiscoverClient({ providers, schedules: initialSchedules = [] }) {
  const router = useRouter();
  const external = providers.find((p) => p.id !== 'manual');
  const defaultProvider = external ? external.id : 'manual';
  const [provider] = useState(defaultProvider);
  // 'http'/'feed' are a deliberate single operator-configured source; every
  // other public-listing provider (osm_overpass, google_places) runs together
  // automatically for one search (see lib/services/discovery/pipeline.js) —
  // reflect that in what's shown here rather than naming only the first one.
  const explicitProvider = providers.find((p) => p.id === 'http' || p.id === 'feed');
  const autoProviders = providers.filter((p) => p.id === 'osm_overpass' || p.id === 'google_places');

  const [form, setForm] = useState({
    industry: '', location: '', platform: '', minimumAudience: '',
    problemCategories: [], solutions: '', bbox: null,
  });
  const [showMap, setShowMap] = useState(false);
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
  const [quickText, setQuickText] = useState('');
  const [quickNote, setQuickNote] = useState(null);
  const [campaignMode, setCampaignMode] = useState(false);
  const [campaignName, setCampaignName] = useState('');
  const [campaignIndustries, setCampaignIndustries] = useState('');
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
    const startedAt = Date.now();
    let failures = 0;
    const stop = (message) => {
      clearInterval(pollRef.current);
      setBusy(false);
      if (message) setError(message);
    };
    pollRef.current = setInterval(async () => {
      // Never poll forever: a run that hasn't finished in 30 minutes is lost
      // track of, not still running.
      if (Date.now() - startedAt > 30 * 60_000) {
        stop('This run is taking unusually long — refresh the page and check Recent runs below.');
        return;
      }
      try {
        const res = await fetch(`/api/discover/jobs/${jobId}`, { cache: 'no-store' });
        // Signed out / job not yours / job gone: retrying can never fix these.
        if ([401, 403, 404].includes(res.status)) {
          stop(res.status === 401
            ? 'You were signed out — sign in again and check Recent runs below.'
            : 'Lost track of this run — refresh the page and check Recent runs below.');
          return;
        }
        const data = await res.json();
        failures = 0;
        if (!data.ok) {
          // A definitive non-ok response (session expired, server error, …) —
          // unlike the network-exception branch below, this will never
          // resolve itself by retrying. Stop polling and say so, instead of
          // leaving the UI stuck on "Finding opportunities…" forever.
          clearInterval(pollRef.current);
          setBusy(false);
          setError(data.error || 'Lost track of this run — refresh the page and check Recent runs below.');
          return;
        }
        setProgress({ status: data.status, stage: data.stage, pct: data.progress });
        if (data.status === 'completed') {
          clearInterval(pollRef.current);
          setBusy(false);
          setSummary(data.summary);
          setResults(data.results || []);
          setProgress({ status: 'completed', stage: data.stage, pct: 100 });
          router.refresh(); // Recent runs (server-rendered) — reflect this run without a manual reload.
        } else if (data.status === 'failed') {
          clearInterval(pollRef.current);
          setBusy(false);
          setError(data.error || 'This run failed. Please try again.');
          router.refresh();
        } else if (data.status === 'cancelled') {
          clearInterval(pollRef.current);
          setBusy(false);
          setError('This run was cancelled before it finished. Partial work is kept on file.');
          router.refresh();
        }
      } catch {
        // Transient network glitch or a non-JSON error page: retry a few
        // times, then give up instead of hammering the server indefinitely.
        if (++failures >= 10) stop('Lost connection while checking this run — refresh the page and check Recent runs below.');
      }
    }, 1500);
  }

  // filters override lets the quick-search box run a search with freshly
  // parsed values immediately, instead of waiting a render cycle for `form`
  // state to catch up (setForm is async — reading `form` right after calling
  // it would still see the stale pre-parse value).
  async function findOpportunities(e, filtersOverride) {
    if (e?.preventDefault) e.preventDefault();
    const filters = filtersOverride || form;
    setBusy(true); setError(null); setSummary(null); setResults([]);
    setProgress({ status: 'queued', stage: null, pct: 0 });
    try {
      const res = await fetch('/api/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, ...filters }),
      });
      const data = await res.json();
      if (!data.ok) { setBusy(false); setError(data.error || 'Something went wrong.'); return; }
      setJob(data.job_id);
      poll(data.job_id);
    } catch (err) {
      setBusy(false); setError(err.message);
    }
  }

  // Translates a free-text description into real search filters (industry,
  // location, problem categories) — never a TikTok/social search (no API for
  // that exists to any third party; see ARCHITECTURE.md). Keyword-based, so it
  // can miss indirect phrasing; the parsed fields are always shown in the
  // form below so nothing runs silently on a wrong guess.
  function runQuickSearch() {
    const parsed = parseSearchIntent(quickText);
    const nextForm = {
      ...form,
      industry: parsed.industry || form.industry,
      location: parsed.location || form.location,
      problemCategories: [...new Set([...form.problemCategories, ...parsed.problem_categories])],
    };
    setForm(nextForm);

    if (!nextForm.industry && !nextForm.location) {
      setQuickNote('Couldn’t tell what kind of business or where from that — try naming the business type and a city, or fill in the fields below directly.');
      return;
    }
    if (!nextForm.location) {
      setQuickNote(`Found "${nextForm.industry}" but no location — add a city (e.g. "in Nairobi") and search again.`);
      return;
    }
    setQuickNote(null);
    findOpportunities(null, nextForm);
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

  // A "campaign" (spec §23) is just several recurring watches created at
  // once — one per industry, sharing the same location/criteria/interval —
  // grouped for display by a shared "Campaign name: Industry" naming
  // convention. No new backend concept: it reuses discover_schedules exactly
  // as a single watch does, just created in bulk.
  async function saveCampaign() {
    if (watchBusy) return;
    const industries = [...new Set(campaignIndustries.split(/[,\n]/).map((s) => s.trim()).filter(Boolean))];
    const name = campaignName.trim();
    if (!name || !industries.length) {
      setWatchError('Give the campaign a name and at least one industry (comma or newline separated).');
      return;
    }
    setWatchBusy(true); setWatchError(null);
    try {
      for (const industry of industries) {
        const res = await fetch('/api/discover/schedules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `${name}: ${industry}`,
            provider,
            filters: { ...form, industry },
            interval_minutes: intervalMin,
          }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || `Could not create a search for "${industry}"`);
      }
      await loadSchedules();
      setCampaignMode(false);
      setCampaignName('');
      setCampaignIndustries('');
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
      <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-6">
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-gray-900">Describe what you&apos;re looking for</span>
          <span className="mb-2 block text-xs text-gray-500">
            Paste a description and we&apos;ll turn it into a real search below — business type, location, and the
            kind of problem. This searches real, public listings (Google Places / OpenStreetMap), never social
            media — there&apos;s no API that lets any app search TikTok or Instagram for businesses.
          </span>
          <textarea
            value={quickText}
            onChange={(e) => setQuickText(e.target.value)}
            rows={3}
            placeholder="e.g. Furniture and upholstery workshops in Nairobi that track jobs and quotations by hand"
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </label>
        {quickNote && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{quickNote}</p>}
        <button
          type="button"
          onClick={runQuickSearch}
          disabled={busy || !quickText.trim()}
          className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Turn this into a search
        </button>
      </div>

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

        <div>
          <button
            type="button"
            onClick={() => setShowMap((v) => !v)}
            className="text-xs font-medium text-blue-600 hover:underline"
          >
            {showMap ? 'Hide map — type a location instead' : 'Or pick an exact area on a map →'}
          </button>
          {showMap && (
            <div className="mt-2">
              <MapAreaPicker onChange={({ bbox }) => setForm((f) => ({ ...f, bbox }))} />
              {form.bbox && (
                <p className="mt-1 text-xs text-emerald-700">
                  Map area set — this takes priority over the location text above for this search.
                </p>
              )}
            </div>
          )}
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
                {INTERVAL_OPTIONS.map((m) => <option key={m} value={m}>{intervalLabel(m)}</option>)}
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

        <div>
          <button type="button" onClick={() => setCampaignMode((v) => !v)} className="text-xs font-medium text-blue-600 hover:underline">
            {campaignMode ? 'Cancel campaign' : 'Or set up a campaign across several industries at once →'}
          </button>
          {campaignMode && (
            <div className="mt-3 space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
              <p className="text-xs text-gray-500">
                Creates one recurring watch per industry (using the location and other filters above), grouped under
                this campaign name — e.g. &ldquo;Nairobi Software Leads: Furniture&rdquo;, &ldquo;...: Printing&rdquo;, &ldquo;...: Cleaning&rdquo;.
              </p>
              <Field label="Campaign name">
                <input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} placeholder="e.g. Nairobi Software Leads" className={inputCls} />
              </Field>
              <Field label="Industries" hint="One per line, or comma-separated.">
                <textarea
                  value={campaignIndustries}
                  onChange={(e) => setCampaignIndustries(e.target.value)}
                  rows={3}
                  placeholder={'Furniture\nPrinting\nCleaning\nEquipment Hire\nBakery'}
                  className={inputCls}
                />
              </Field>
              <button type="button" onClick={saveCampaign} disabled={watchBusy}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                {watchBusy ? 'Creating…' : 'Create campaign'}
              </button>
            </div>
          )}
        </div>

        <p className="text-xs text-gray-400">
          {explicitProvider
            ? `Using the configured discovery source (${explicitProvider.label}).`
            : autoProviders.length
              ? `Searching ${autoProviders.map((p) => p.label).join(' and ')} at once — results are merged and deduplicated automatically.`
              : 'No external discovery source is configured. Add businesses manually (the platform researches and analyzes them) or set DISCOVERY_API_URL / SOCIAL_MEDIA_FEED_URL. Real-time leads still arrive via the webhook.'}
        </p>
      </form>

      {watchError && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{watchError}</p>}

      {schedules.length > 0 && (
        <section className="space-y-6">
          {(() => {
            const { campaigns, standalone } = groupSchedules(schedules);
            return (
              <>
                {campaigns.map((c) => (
                  <div key={c.name}>
                    <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
                      Campaign: {c.name} <span className="normal-case text-gray-400">({c.items.length} industries)</span>
                    </h2>
                    <div className="space-y-2">
                      {c.items.map((s) => <ScheduleRow key={s.id} s={s} patchWatch={patchWatch} deleteWatch={deleteWatch} label={s.filters?.industry || s.name} />)}
                    </div>
                  </div>
                ))}
                {standalone.length > 0 && (
                  <div>
                    <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
                      {campaigns.length > 0 ? 'Other watches' : 'Watching for new leads'}
                    </h2>
                    <div className="space-y-2">
                      {standalone.map((s) => <ScheduleRow key={s.id} s={s} patchWatch={patchWatch} deleteWatch={deleteWatch} label={s.name} />)}
                    </div>
                  </div>
                )}
              </>
            );
          })()}
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
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <Link href="/businesses" className="font-medium text-blue-600 hover:underline">
              View all {summary.businesses_researched} businesses found →
            </Link>
            {summary.with_evidence > 0 && (
              <Link href="/opportunities" className="font-medium text-blue-600 hover:underline">
                View opportunities, including lower-scored ones →
              </Link>
            )}
          </div>
        </Card>
      )}

      {summary && !busy && results.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">
          <p>
            We researched {summary.businesses_researched} business{summary.businesses_researched === 1 ? '' : 'es'} and found evidence on {summary.with_evidence}
            {summary.with_evidence > 0 ? ', but the evidence found wasn’t enough to clear the bar for a strong opportunity.' : '.'}
          </p>
          <p className="mt-2">
            {summary.with_evidence > 0
              ? 'Businesses with only a listing (no website content) rarely score high — that’s by design, not a bug: a thin lead isn’t worth your time to chase.'
              : 'Try an industry or location where businesses are more likely to have their own website — that’s where most of the evidence comes from.'}
          </p>
        </div>
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