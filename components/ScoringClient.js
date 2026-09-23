'use client';

import { useEffect, useState } from 'react';
import '@/lib/csrf-client';

const KEYS = ['hot', 'high', 'medium', 'low', 'reject'];
const LABELS = { hot: 'HOT', high: 'HIGH', medium: 'MEDIUM', low: 'LOW', reject: 'REJECT' };

export default function ScoringClient() {
  const [scoring, setScoring] = useState(null);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/admin/scoring', { headers: { Accept: 'application/json' } })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) return setError(d?.error || 'Failed to load');
        setScoring(d.scoring);
        setDraft({ ...d.scoring.defaults });
      })
      .catch(() => setError('Failed to load'));
  }, []);

  const validationError = (() => {
    if (!draft) return null;
    for (let i = 0; i < KEYS.length - 1; i++) {
      const a = Number(draft[KEYS[i]]);
      const b = Number(draft[KEYS[i + 1]]);
      if (a < b) return `${KEYS[i]} must be >= ${KEYS[i + 1]}`;
    }
    for (const k of KEYS) {
      const v = Number(draft[k]);
      if (!Number.isFinite(v) || v < 0 || v > 100) return `${k} must be between 0 and 100`;
    }
    return null;
  })();

  async function save() {
    setBusy(true);
    setSaved(null);
    try {
      const res = await fetch('/api/admin/scoring', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thresholds: { ...draft } }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || 'Request failed');
      setScoring((prev) => (prev ? { ...prev, defaults: body.score_thresholds } : prev));
      setDraft({ ...body.score_thresholds });
      setSaved('Platform defaults updated and audited.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !scoring) return <p className="text-sm text-red-600">{error}</p>;
  if (!scoring || !draft) return <p className="text-sm text-gray-400">Loading scoring configuration…</p>;

  const { weights, categories, defaults, accounts_overriding } = scoring;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Weighted dimensions (read-only)</p>
          <ul className="mt-3 space-y-2 text-sm">
            {Object.entries(weights).map(([key, w]) => (
              <li key={key} className="flex items-center justify-between">
                <span className="capitalize text-gray-700">{key.replaceAll('_', ' ')}</span>
                <span className="font-semibold text-gray-900">{Math.round(w * 100)}%</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-gray-500">
            Weights live in code (lib/constants.js) — this stage surfaces them; changing them is a deploy-time decision.
          </p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Category legend</p>
          <ul className="mt-3 space-y-2 text-sm">
            {Object.entries(categories).map(([label, c]) => (
              <li key={label} className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${c.color}`} />
                <span className="font-medium text-gray-900">{label}</span>
                <span className="text-gray-500">≥ {c.min}</span>
                <span className="text-xs text-gray-500">{c.hint}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">
          Platform defaults (inherit unless an account overrides)
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {KEYS.map((k) => (
            <label key={k} className="rounded border border-gray-200 p-3">
              <span className="text-xs text-gray-500">{LABELS[k]}</span>
              <input
                type="number"
                min={0}
                max={100}
                value={Number.isFinite(Number(draft[k])) ? draft[k] : ''}
                onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-red-500 focus:outline-none"
                aria-label={`${LABELS[k]} threshold`}
              />
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-gray-500">Current defaults: {JSON.stringify(defaults)}</p>
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={save}
            disabled={busy || Boolean(validationError)}
            className="rounded bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save defaults'}
          </button>
          {(validationError || error) && (
            <span className="text-sm text-red-600">{validationError || error}</span>
          )}
          {saved && <span className="text-sm text-green-700">{saved}</span>}
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">
          Accounts with their own override ({accounts_overriding.length})
        </p>
        {accounts_overriding.length ? (
          <ul className="mt-3 space-y-2 text-sm">
            {accounts_overriding.map((a) => (
              <li key={a.account_id} className="flex flex-wrap gap-2">
                <span className="font-medium text-gray-900">#{a.account_id} {a.name}</span>
                <span className="text-gray-500">{JSON.stringify(a.score_thresholds)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-gray-500">No workspace has customized thresholds — all inherit the platform defaults.</p>
        )}
      </div>
    </div>
  );
}