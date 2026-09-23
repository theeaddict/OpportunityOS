'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fmtMoney } from '@/components/ui';
import { PIPELINE_TRANSITIONS, statusLabel } from '@/lib/constants';

export default function OpportunityActions({ opportunity }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  async function call(url, options = {}) {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
        body: options.body ? JSON.stringify(options.body) : undefined,
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

  async function runAnalysis() {
    const data = await call(`/api/opportunities/${opportunity.id}/analyze`, { method: 'POST' });
    if (!data) return;
    if (data.verdict === 'NO_STRONG_OPPORTUNITY') {
      setNotice({ kind: 'info', text: `The AI analyst found no strong opportunity in the current evidence: ${data.reasoning || ''}` });
      router.refresh();
      return;
    }
    setNotice({
      kind: data.provider === 'llm' ? 'success' : 'info',
      text: data.provider === 'llm'
        ? `AI analysis complete — scored ${data.opportunity_score}/100.`
        : `Analyzed with the built-in rule engine (no AI provider configured) — scored ${data.opportunity_score}/100.`,
    });
    router.refresh();
  }

  async function setStatus(status) {
    await call(`/api/opportunities/${opportunity.id}`, { method: 'PATCH', body: { status } });
    router.refresh();
  }

  async function generateOutreach() {
    const data = await call(`/api/opportunities/${opportunity.id}/outreach`, { method: 'POST', body: {} });
    if (!data) return;
    setNotice({
      kind: 'success',
      text: `3 WhatsApp drafts created (${data.generated_by === 'llm' ? 'AI-generated — review carefully' : 'template fallback — no AI provider configured'}). Approve below before sending.`,
    });
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={runAnalysis} disabled={busy}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          {busy && !notice ? 'Working…' : opportunity.analysis_provider === 'none' ? 'Analyze this opportunity' : 'Re-analyze'}
        </button>
        <button onClick={() => generateOutreach()} disabled={busy}
          className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50">
          Draft WhatsApp messages (3 variants)
        </button>
        <div className="ml-auto flex flex-wrap gap-1">
          {(PIPELINE_TRANSITIONS[opportunity.status] || []).map((status) => (
            <button key={status} onClick={() => setStatus(status)} disabled={busy}
              className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              {statusLabel(status)}
            </button>
          ))}
        </div>
      </div>

      {notice && (
        <p className={`rounded-lg px-3 py-2 text-sm ${notice.kind === 'error' ? 'bg-red-50 text-red-700' : notice.kind === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>
          {notice.text}
        </p>
      )}
    </div>
  );
}

/**
 * Scenario editor: edits assumption values stored in opportunity_assumptions,
 * then recalculates financial_scenarios server-side (deterministic code).
 */
/**
 * Scenario editor — BUSINESS IMPACT only, computed deterministically in app code
 * from low / base / high assumption triples. PROJECT VALUE is kept separate and
 * only ever comes from the solution library (rendered in the adjacent card).
 */
export function ScenarioEditor({ opportunityId, scenarios, assumptions, disclaimer }) {
  const router = useRouter();
  // Each assumption carries a low/base/high triple (base persisted as value).
  const [tris, setTris] = useState(() => {
    const o = {};
    for (const a of assumptions || []) {
      o[a.assumption_name] = {
        low: a.assumption_low != null ? Number(a.assumption_low) : Number(a.assumption_value),
        base: Number(a.assumption_value),
        high: a.assumption_high != null ? Number(a.assumption_high) : Number(a.assumption_value),
      };
    }
    return o;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function recalculate() {
    setBusy(true); setError(null);
    const res = await fetch(`/api/opportunities/${opportunityId}/analyze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario_overrides: { mechanism: tris } }),
    });
    const data = await res.json();
    setBusy(false);
    if (!data.ok) return setError(data.error);
    router.refresh();
  }

  const fmtRange = (s) => {
    const low = s.low_value != null ? Number(s.low_value) : (s.impact_low != null ? Number(s.impact_low) : null);
    const high = s.high_value != null ? Number(s.high_value) : (s.impact_high != null ? Number(s.impact_high) : null);
    if (low == null || high == null) return 'Assumption data needed to calculate';
    return `${fmtMoney(low, s.currency)} – ${fmtMoney(high, s.currency)}${s.period === 'monthly' ? ' / month' : ' / year'}`;
  };

  return (
    <div className="space-y-5">
      {(scenarios || []).map((s) => {
        const sj = typeof s.assumptions_json === 'string' ? JSON.parse(s.assumptions_json) : s.assumptions_json || {};
        const name = s.scenario_name || String(s.scenario_type).replaceAll('_', ' ');
        const fields = Object.keys(sj);
        return (
          <div key={s.id} className="rounded-lg border border-gray-200 p-3">
            <p className="text-sm font-semibold text-gray-900">{name}</p>
            <p className="text-xs text-gray-500">{s.formula_description}</p>
            <div className="mt-2 space-y-2">
              {fields.map((key) => {
                const t = tris[key] || { low: 0, base: 0, high: 0 };
                const set = (mode, v) => setTris({ ...tris, [key]: { ...t, [mode]: v === '' ? 0 : Number(v) } });
                return (
                  <div key={key} className="grid grid-cols-3 gap-2">
                    <label className="block">
                      <span className="mb-0.5 block text-[11px] text-gray-400">Low</span>
                      <input type="number" step="any" value={t.low}
                        onChange={(e) => set('low', e.target.value)}
                        className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none" />
                    </label>
                    <label className="block">
                      <span className="mb-0.5 block text-[11px] font-semibold text-gray-500">{key.replaceAll('_', ' ')}</span>
                      <input type="number" step="any" value={t.base}
                        onChange={(e) => set('base', e.target.value)}
                        className="w-full rounded-lg border border-blue-300 bg-blue-50/40 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none" />
                    </label>
                    <label className="block">
                      <span className="mb-0.5 block text-[11px] text-gray-400">High</span>
                      <input type="number" step="any" value={t.high}
                        onChange={(e) => set('high', e.target.value)}
                        className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none" />
                    </label>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 text-sm">
              <span className="text-gray-500">Business impact: </span>
              <span className="font-bold text-gray-900">{fmtRange(s)}</span>
            </div>
          </div>
        );
      })}
      {!scenarios?.length && (
        <p className="text-sm text-gray-500">Not enough assumptions to build a financial scenario yet. Add the required inputs, then run the analysis.</p>
      )}
      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs italic text-gray-500">{disclaimer}</p>
        <button onClick={recalculate} disabled={busy} className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          {busy ? 'Recalculating…' : 'Recalculate'}
        </button>
      </div>
    </div>
  );
}

/** Outreach draft editor: edit → approve → mark sent (guarded). */
export function OutreachEditor({ message }) {
  const router = useRouter();
  const [text, setText] = useState(message.message_text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save(payload) {
    setBusy(true); setError(null);
    const res = await fetch(`/api/outreach/${message.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setBusy(false);
    if (!data.ok) return setError(data.error);
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-gray-400">
        <span>{message.message_type}{message.variant ? ` · ${message.variant}` : ''}</span>
        <span>·</span>
        <span>{message.sent_status.replaceAll('_', ' ')}</span>
        <span>·</span>
        <span>{message.ai_model ? `AI-generated (${message.ai_model}) — review carefully` : 'Template-generated'}</span>
        {message.approved ? (
          <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-semibold text-emerald-700">Approved</span>
        ) : (
          <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-500">Needs approval</span>
        )}
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={9}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
      {error && <p className="mt-2 rounded bg-red-50 px-3 py-1.5 text-sm text-red-700">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={() => save({ message_text: text })} disabled={busy}
          className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-200">Save changes</button>
        {!message.approved && (
          <button onClick={() => save({ approved: true })} disabled={busy}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">Approve</button>
        )}
        <button onClick={() => save({ message_text: text, sent_status: 'sent' })} disabled={busy || message.sent_status === 'sent'}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-40">
          {message.sent_status === 'sent' ? 'Sent ✓' : 'Mark as sent'}
        </button>
      </div>
    </div>
  );
}

export function DemoSpecPanel({ opportunityId }) {
  const [spec, setSpec] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function generate() {
    setBusy(true); setError(null);
    const res = await fetch(`/api/opportunities/${opportunityId}/demo-spec`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    const data = await res.json();
    setBusy(false);
    if (!data.ok) return setError(data.error);
    setSpec(data.spec);
  }

  if (!spec) {
    return (
      <div>
        <button onClick={generate} disabled={busy} className="text-sm font-medium text-blue-600 hover:underline disabled:opacity-50">
          {busy ? 'Generating…' : 'Generate a demo plan for this opportunity'}
        </button>
        {error && <p className="mt-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>
    );
  }
  return (
    <div className="space-y-4 text-sm">
      <p className="font-semibold text-gray-900">{spec.demo_name}</p>

      {spec.workflow?.length > 0 && (
        <div>
          <p className="font-medium text-gray-900">Walkthrough</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-gray-600">
            {spec.workflow.map((w, i) => <li key={i}>{w}</li>)}
          </ol>
        </div>
      )}

      {spec.features?.length > 0 && (
        <div>
          <p className="font-medium text-gray-900">Features to show</p>
          <ul className="mt-1 list-disc pl-5 text-gray-600">{spec.features.map((f, i) => <li key={i}>{f}</li>)}</ul>
        </div>
      )}

      {spec.pages?.length > 0 && (
        <div>
          <p className="font-medium text-gray-900">Pages / screens</p>
          <ul className="mt-1 list-disc pl-5 text-gray-600">{spec.pages.map((f, i) => <li key={i}>{f}</li>)}</ul>
        </div>
      )}

      {spec.sample_entities?.length > 0 && (
        <div>
          <p className="font-medium text-gray-900">Sample data to load</p>
          <ul className="mt-1 space-y-1 text-gray-600">
            {spec.sample_entities.map((e, i) => (
              <li key={i}><span className="font-medium">{e.name}</span>{e.description ? ` — ${e.description}` : ''}</li>
            ))}
          </ul>
        </div>
      )}

      {spec.customization_points?.length > 0 && (
        <div>
          <p className="font-medium text-gray-900">Customization points</p>
          <ul className="mt-1 list-disc pl-5 text-gray-600">{spec.customization_points.map((f, i) => <li key={i}>{f}</li>)}</ul>
        </div>
      )}

      {spec._note && <p className="text-xs italic text-gray-400">{spec._note}</p>}
</div>
  );
}
