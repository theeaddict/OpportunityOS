'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ClaimBadge } from '@/components/ui';
import { SIGNAL_KEYS } from '@/lib/constants';

/**
 * Business research workspace: structured checklist, AI interpretation,
 * candidate findings (accept → become evidence with a claim type), manual
 * evidence entry and public-contact management (v2 contact model).
 */
export default function BusinessWorkspace({ businessId, signals, coverage }) {
  const router = useRouter();
  const [tab, setTab] = useState('research');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [candidates, setCandidates] = useState(null);

  async function call(url, options) {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
        body: options?.body ? JSON.stringify(options.body) : undefined,
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Request failed');
      return data;
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function acceptCandidate(c, claimType) {
    const result = await call(`/api/businesses/${businessId}/evidence`, {
      method: 'POST',
      body: {
        evidence_text: `${c.title}: ${c.summary}`,
        source_excerpt_summary: c.summary,
        evidence_type: c.evidence_type || 'observation',
        signal_key: c.signal_key,
        source_name: c.source_name,
        confidence_score: c.confidence ?? 0.5,
        claim_type: claimType.toUpperCase(),
      },
    });
    if (!result) return;
    setCandidates((prev) => prev.filter((x) => x !== c));
    setNotice({
      kind: 'success',
      text: `Saved as ${claimType.toUpperCase()}. ${result.detected_opportunities?.length ? `${result.detected_opportunities.length} new opportunity proposed.` : ''}`,
    });
    router.refresh();
  }

  async function runAutomated() {
    const data = await call(`/api/businesses/${businessId}/research`, {
      method: 'POST',
    });
    if (!data) return;
    const r = data.result;
    setNotice({
      kind: r.findings_saved ? 'success' : 'info',
      text: r.findings_saved
        ? `Saved ${r.findings_saved} evidence item(s) from ${r.pages_fetched.length} page(s).${r.skipped.length ? ` Skipped: ${r.skipped.join('; ').slice(0, 140)}` : ''}`
        : `No new findings. ${r.note || ''}${r.skipped.length ? ` Skipped: ${r.skipped.join('; ').slice(0, 120)}` : ''}`,
    });
    router.refresh();
  }

  async function detectOpportunities() {
    const data = await call(`/api/businesses/${businessId}/detect-opportunities`, { method: 'POST' });
    if (!data) return;
    setNotice({
      kind: data.created_count ? 'success' : 'info',
      text: data.created_count
        ? `Proposed ${data.created_count} new opportunit${data.created_count === 1 ? 'y' : 'ies'} from the evidence.`
        : 'No new problems detected. The rule engine only proposes problems with sufficient evidence.',
    });
    router.refresh();
  }

  async function aiInterpret() {
    const data = await call(`/api/businesses/${businessId}/interpret`, { method: 'POST' });
    if (!data) return;
    setNotice({ kind: 'info', text: 'AI interpretation complete — review its claims in the Evidence tab.' });
    router.refresh();
  }

  const tabs = [['research', 'Research'], ['evidence', 'Evidence'], ['contacts', 'Contacts']];

  return (
    <div>
      {coverage && (
        <div className={`mb-4 rounded-xl border p-3 text-sm ${coverage.complete ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
          {coverage.complete ? (
            <p><strong>Research complete</strong> — all {coverage.total} aspects have evidence-backed findings.</p>
          ) : (
            <p>
              <strong>Research incomplete</strong> ({coverage.coveredCount}/{coverage.total} aspects covered).
              Missing: {coverage.missing.join(', ')}. We do not fill gaps with assumptions.
            </p>
          )}
          <button onClick={runAutomated} disabled={busy}
            className="mt-2 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
            {busy && !notice ? 'Running…' : 'Run automated research'}
          </button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map(([id, label]) => (
          <button key={id}
            onClick={() => { setTab(id); setNotice(null); }}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${tab === id ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50'}`}>
            {label}
          </button>
        ))}
        <button onClick={detectOpportunities} disabled={busy}
          className="ml-auto rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
          Detect opportunities
        </button>
        <button onClick={aiInterpret} disabled={busy} title="Requires an LLM provider"
          className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
          AI interpretation
        </button>
      </div>

      {notice && (
        <p className={`mb-4 rounded-lg px-3 py-2 text-sm ${notice.kind === 'error' ? 'bg-red-50 text-red-700' : notice.kind === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>
          {notice.text}
        </p>
      )}

      {tab === 'research' && (
        <div>
          <p className="mb-4 text-sm text-gray-500">
            Record what you can verify publicly about how this business operates. Suggestions below are
            hypotheses — accepting one saves it as evidence under your chosen claim type.
          </p>
          {candidates === null && (
            <button onClick={async () => {
              const data = await call(`/api/businesses/${businessId}/research`);
              if (data) setCandidates(data.candidates);
            }} disabled={busy} className="text-sm font-medium text-blue-600 hover:underline">
              Load suggested findings
            </button>
          )}
          {candidates && !candidates.length && (
            <p className="rounded-lg border border-dashed border-gray-300 bg-white p-5 text-sm text-gray-500">
              No prefilled findings for this business. Use “Add evidence” to record what you find.
            </p>
          )}
          <div className="space-y-3">
            {(candidates || []).map((c, i) => (
              <div key={i} className="rounded-xl border border-gray-200 bg-white p-4">
                <ClaimBadge claimType="HYPOTHESIS" />
                <p className="mt-2 font-medium text-gray-900">{c.title}</p>
                <p className="mt-0.5 text-sm text-gray-600">{c.summary}</p>
                <p className="mt-1 text-xs text-gray-400">Suggested signal: {c.signal_key?.replaceAll('_', ' ') || '—'} · confidence {Math.round((c.confidence || 0) * 100)}% · source: {c.source_name}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => acceptCandidate(c, 'FACT')} disabled={busy} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">Accept as fact</button>
                  <button onClick={() => acceptCandidate(c, 'INFERENCE')} disabled={busy} className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600">Accept as inference</button>
                  <button onClick={() => acceptCandidate(c, 'HYPOTHESIS')} disabled={busy} className="rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-600">Keep as hypothesis</button>
                </div>
              </div>
            ))}
            <EvidenceForm businessId={businessId} onDone={() => router.refresh()} />
          </div>

          {Object.keys(signals || {}).length > 0 && (
            <div className="mt-6 rounded-xl border border-gray-200 bg-white p-4">
              <h3 className="text-sm font-semibold text-gray-900">Maturity signals derived from evidence</h3>
              <ul className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
                {Object.entries(signals).map(([key, v]) => (
                  <li key={key} className="flex justify-between text-sm text-gray-700">
                    <span>{key.replaceAll('_', ' ')}</span>
                    <span className="text-xs text-gray-400">{v.support_count} item{v.support_count > 1 ? 's' : ''} · {Math.round(v.avg_confidence * 100)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {tab === 'evidence' && (
        <p className="text-sm text-gray-500">See the full evidence list below the workspace.</p>
      )}

      {tab === 'contacts' && <ContactsPanel businessId={businessId} onDone={() => router.refresh()} />}
    </div>
  );
}

function EvidenceForm({ businessId, onDone }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const payload = Object.fromEntries(new FormData(e.target).entries());
    const res = await fetch(`/api/businesses/${businessId}/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setBusy(false);
    if (!data.ok) return setError(data.error);
    e.target.reset();
    setOpen(false);
    onDone();
  }

  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-white p-4">
      {!open ? (
        <button onClick={() => setOpen(true)} className="text-sm font-medium text-blue-600 hover:underline">+ Add evidence manually</button>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          <textarea name="evidence_text" required rows={2} placeholder="What did you observe? (evidence text)" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
          <div className="grid gap-3 sm:grid-cols-2">
            <select name="signal_key" defaultValue="" className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="">No specific signal</option>
              {Object.entries(SIGNAL_KEYS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
            <select name="claim_type" defaultValue="FACT" className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="FACT">Fact — directly observable</option>
              <option value="INFERENCE">Inference — reasonable conclusion</option>
              <option value="HYPOTHESIS">Hypothesis — needs confirmation</option>
            </select>
            <input name="source_name" required placeholder="Source (required)" className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
            <input name="source_url" type="url" placeholder="Source URL" className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
            <input name="source_excerpt_summary" placeholder="Excerpt summary (optional)" className="rounded-lg border border-gray-300 px-3 py-2 text-sm sm:col-span-2" />
            <label className="flex items-center gap-2 text-xs text-gray-500">
              Confidence
              <input name="confidence_score" type="number" min="0" max="1" step="0.05" defaultValue="0.7" className="w-full rounded border border-gray-300 px-2 py-1" />
            </label>
          </div>
          {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex gap-2">
            <button disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save evidence'}</button>
            <button type="button" onClick={() => setOpen(false)} className="px-3 py-2 text-sm text-gray-500">Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

function ContactsPanel({ businessId, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    const payload = Object.fromEntries(new FormData(e.target).entries());
    const res = await fetch(`/api/businesses/${businessId}/contacts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const data = await res.json();
    setBusy(false);
    if (!data.ok) return setError(data.error);
    e.target.reset();
    onDone();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs text-gray-500">
        Only publicly available business contact details are stored, each tied to a source.
        WhatsApp can be saved only when the business itself publishes it as WhatsApp.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <select name="contact_type" defaultValue="email" className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
          <option value="email">Email</option>
          <option value="phone">Phone</option>
          <option value="whatsapp">WhatsApp (published)</option>
          <option value="social">Social profile</option>
          <option value="website_form">Website form</option>
        </select>
        <input name="contact_value" required placeholder="Contact value (number / address / URL)" className="rounded-lg border border-gray-300 px-3 py-2 text-sm sm:col-span-2" />
        <input name="contact_source" placeholder="Where did this come from?" className="rounded-lg border border-gray-300 px-3 py-2 text-sm sm:col-span-2" />
        <input name="source_url" type="url" placeholder="Source URL" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        <select name="verification_status" defaultValue="unverified" className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
          <option value="unverified">Unverified</option>
          <option value="source_published">Published by the business</option>
          <option value="user_confirmed">Confirmed by me directly</option>
        </select>
        <label className="flex items-center gap-2 text-xs text-gray-500">
          Confidence
          <input name="confidence_score" type="number" min="0" max="1" step="0.05" defaultValue="0.6" className="w-full rounded border border-gray-300 px-2 py-1" />
        </label>
      </div>
      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Add contact'}</button>
    </form>
  );
}
