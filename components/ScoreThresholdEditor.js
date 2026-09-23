'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SCORE_CATEGORIES } from '@/lib/constants';

const FIELDS = [
  { key: 'hot', label: 'HOT', min: 90, hint: '90-100' },
  { key: 'high', label: 'HIGH', min: 80, hint: '80-89' },
  { key: 'medium', label: 'MEDIUM', min: 65, hint: '65-79' },
  { key: 'low', label: 'LOW', min: 50, hint: '50-64' },
  { key: 'reject', label: 'REJECT', min: 0, hint: 'below this = REJECT' },
];

export default function ScoreThresholdEditor({ thresholds, isAdmin }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [values, setValues] = useState({
    hot: thresholds.hot, high: thresholds.high, medium: thresholds.medium,
    low: thresholds.low, reject: thresholds.reject ?? 0,
  });

  function set(key, val) {
    setValues((v) => ({ ...v, [key]: Number(val) }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    const res = await fetch('/api/settings/score-thresholds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ score_thresholds: values }),
    });
    const data = await res.json();
    setBusy(false);
    setNotice(data.ok
      ? { kind: 'ok', text: 'Thresholds saved and now applied to every future score.' }
      : { kind: 'err', text: data.error || 'Failed to save.' });
    if (data.ok) router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <p className="text-xs text-gray-500">
        The overall score (0-100) is classified into a category using these boundaries. A score
        equal to a threshold falls into the higher bucket (e.g. 90 → HOT). Below the REJECT bound
        the opportunity is dropped.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {FIELDS.map((f) => (
          <label key={f.key} className="block">
            <span className="mb-1 flex items-center gap-1.5 text-sm font-medium text-gray-700">
              <span className={`inline-flex h-3 w-3 rounded-full ${SCORE_CATEGORIES[f.key.toUpperCase()]?.color || 'bg-gray-400'}`} />
              {f.label}
            </span>
            <span className="mb-1 block text-[11px] text-gray-400">{f.hint}</span>
            <input
              name={f.key}
              type="number"
              min={0}
              max={100}
              disabled={!isAdmin}
              value={values[f.key] ?? ''}
              onChange={(e) => set(f.key, e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none disabled:bg-gray-100 disabled:opacity-70"
            />
          </label>
        ))}
      </div>
      {!isAdmin && <p className="text-xs text-amber-600">Only admins can change scoring thresholds.</p>}
      {notice && <p className={`rounded px-3 py-2 text-sm ${notice.kind === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{notice.text}</p>}
      {isAdmin && (
        <button disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          {busy ? 'Saving…' : 'Save thresholds'}
        </button>
      )}
    </form>
  );
}
