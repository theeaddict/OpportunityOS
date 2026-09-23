'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui';

export default function SolutionLibraryManager({ solutions = [], problemTypes = [], currency = 'KES', isAdmin = false }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState(null); // null | 'new' | solution id
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save(e, id) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.target);
    const payload = {
      name: fd.get('name'),
      description: fd.get('description'),
      currency: fd.get('currency'),
      demo_template: fd.get('demo_template') || null,
      active: fd.get('active') === 'on' || fd.get('active') === 'true',
      features: splitList(fd.get('features')),
      industries: splitList(fd.get('industries')),
      solves_problem_types: problemTypes.filter((p) => fd.get(`pt_${p.key}`) === 'on').map((p) => p.key),
      project_value_low: toNum(fd.get('project_value_low')),
      project_value_base: toNum(fd.get('project_value_base')),
      project_value_high: toNum(fd.get('project_value_high')),
    };

    const isNew = id === 'new';
    const url = isNew ? '/api/solutions' : `/api/solutions/${id}`;
    const res = await fetch(url, {
      method: isNew ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setBusy(false);
    if (!data.ok) return setError(data.error || 'Save failed');
    setEditingId(null);
    router.refresh();
  }

  return (
    <div>
      {isAdmin && (
        <div className="mb-5">
          {editingId === 'new' ? (
            <SolutionForm
              key="new"
              title="New solution"
              problemTypes={problemTypes}
              defaultCurrency={currency}
              onSubmit={(e) => save(e, 'new')}
              onCancel={() => setEditingId(null)}
              busy={busy}
              error={error}
            />
          ) : (
            <button onClick={() => { setError(null); setEditingId('new'); }} className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
              Add solution
            </button>
          )}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {solutions.map((s) => {
          if (editingId === s.id) {
            return (
              <div key={s.id} className="md:col-span-2 xl:col-span-3">
                <SolutionForm
                  key={s.id}
                  title={`Edit ${s.name}`}
                  solution={s}
                  problemTypes={problemTypes}
                  defaultCurrency={s.currency || currency}
                  onSubmit={(e) => save(e, s.id)}
                  onCancel={() => setEditingId(null)}
                  busy={busy}
                  error={error}
                />
              </div>
            );
          }
          return (
            <Card key={s.id} className={`flex flex-col p-4 ${!s.active ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-gray-900">{s.name}</p>
                <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide ${s.active ? 'text-emerald-600' : 'text-gray-400'}`}>
                  {s.active ? 'active' : 'inactive'}
                </span>
              </div>
              <p className="mt-1 flex-1 text-sm text-gray-600">{s.description}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {(s.solves_problem_types || []).map((t) => (
                  <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                    {problemTypes.find((p) => p.key === t)?.label || String(t).replaceAll('_', ' ')}
                  </span>
                ))}
              </div>
              {(s.features || []).length > 0 && (
                <p className="mt-2 text-[11px] text-gray-500"><span className="font-medium text-gray-600">Features:</span> {(s.features || []).join(' · ')}</p>
              )}
              <p className="mt-2 text-xs text-gray-500">
                <span className="font-medium text-gray-600">Project value:</span>{' '}
                {(s.project_value && s.project_value.low != null)
                  ? `${money(s.project_value.low)} – ${money(s.project_value.high)}${s.project_value.base != null ? ` (base ${money(s.project_value.base)})` : ''} ${s.currency || currency}`
                  : 'not set'}
              </p>
              {(s.demo_template) && <p className="mt-1 text-[11px] text-gray-400">Demo: {s.demo_template}</p>}
              {(s.industries || []).length > 0 && (
                <p className="mt-1 text-[11px] text-gray-400"><span className="font-medium text-gray-600">Industries:</span> {(s.industries || []).join(', ')}</p>
              )}
              {isAdmin && (
                <button onClick={() => { setError(null); setEditingId(s.id); }} className="mt-3 self-start rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
                  Edit
                </button>
              )}
            </Card>
          );
        })}
      </div>
      {!solutions.length && (
        <Card className="p-6 text-center text-sm text-gray-500">Library is empty — add your first solution.</Card>
      )}
    </div>
  );
}

function SolutionForm({ title, solution, problemTypes, defaultCurrency, onSubmit, onCancel, busy, error }) {
  const d = solution || {};

  return (
    <Card className="p-5">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      {error && <p className="mt-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <form onSubmit={onSubmit}>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Name *</span>
            <input name="name" defaultValue={d.name || ''} required className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Currency</span>
            <input name="currency" defaultValue={d.currency || defaultCurrency} maxLength={3} className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
          </label>
        </div>

        <label className="mt-3 block">
          <span className="mb-1 block text-sm font-medium text-gray-700">Description *</span>
          <textarea name="description" rows={2} defaultValue={d.description || ''} required className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
        </label>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Project value low</span>
            <input name="project_value_low" type="number" min="0" step="1000" defaultValue={d.project_value?.low ?? ''} className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Project value base</span>
            <input name="project_value_base" type="number" min="0" step="1000" defaultValue={d.project_value?.base ?? ''} className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Project value high</span>
            <input name="project_value_high" type="number" min="0" step="1000" defaultValue={d.project_value?.high ?? ''} className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
          </label>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Industries (comma-separated)</span>
            <input name="industries" defaultValue={(d.industries || []).join(', ')} className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Features (comma-separated)</span>
            <input name="features" defaultValue={(d.features || []).join(', ')} className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
          </label>
        </div>

        <label className="mt-3 block">
          <span className="mb-1 block text-sm font-medium text-gray-700">Demo template</span>
          <input name="demo_template" defaultValue={d.demo_template || ''} placeholder="ts-… (theme name)" className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
        </label>

        <fieldset className="mt-3">
          <legend className="text-sm font-medium text-gray-700">Problems this solution solves</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {problemTypes.map((p) => (
              <label key={p.key} className="flex items-center gap-1 rounded bg-gray-50 px-2 py-1 text-xs text-gray-700 ring-1 ring-gray-200">
                <input type="checkbox" name={`pt_${p.key}`} defaultChecked={(d.solves_problem_types || []).includes(p.key)} />
                {p.label}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" name="active" defaultChecked={d.active !== false} />
          Active (available for matching)
        </label>

        <div className="mt-4 flex gap-2">
          <button disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
            {busy ? 'Saving…' : 'Save solution'}
          </button>
          <button type="button" onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100">Cancel</button>
        </div>
      </form>
    </Card>
  );
}

function splitList(v) {
  return String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function toNum(v) {
  const n = Number(v);
  return (v !== '' && Number.isFinite(n) && n > 0) ? n : null;
}

function money(v) {
  if (v == null) return '—';
  return new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(Number(v));
}
