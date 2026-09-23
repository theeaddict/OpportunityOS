'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CLIENT_SIZES, PROBLEM_TYPES, problemLabel } from '@/lib/constants';

function TagInput({ values, onChange, placeholder = 'Add and press Enter', suggestions = [] }) {
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);

  function add(value) {
    const clean = String(value || '').trim().slice(0, 120);
    if (!clean) return;
    if (!values.some((t) => t.toLowerCase() === clean.toLowerCase())) onChange([...values, clean]);
    setDraft('');
  }

  const matches = suggestions.filter(
    (s) => s.toLowerCase().includes(draft.toLowerCase()) && !values.some((t) => t.toLowerCase() === s.toLowerCase())
  ).slice(0, 6);

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-2 py-1.5 focus-within:border-blue-500">
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
            {v}
            <button type="button" onClick={() => onChange(values.filter((t) => t !== v))} className="text-blue-400 hover:text-blue-700" aria-label={`Remove ${v}`}>×</button>
          </span>
        ))}
        <input
          value={draft}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(draft); }
            if (e.key === 'Backspace' && !draft && values.length) onChange(values.slice(0, -1));
          }}
          placeholder={values.length ? '' : placeholder}
          className="min-w-[8rem] flex-1 bg-transparent px-1 py-1 text-sm focus:outline-none"
        />
      </div>
      {open && matches.length > 0 && (
        <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          {matches.map((m) => (
            <button key={m} type="button" onMouseDown={() => add(m)} className="block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-blue-50">
              + {m}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const sectionTitle = 'text-sm font-semibold text-gray-900';
const fieldLabel = 'mb-1 block text-sm font-medium text-gray-700';

export default function CapabilitiesForm({ capabilities, solutions, notice: initialNotice }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(initialNotice || null);

  // Enabled solution ids — default to everything when no profile is saved yet.
  const defaultEnabled = solutions.map((s) => String(s.id));
  const persistedEnabled = Array.isArray(capabilities?.enabled_solutions)
    ? capabilities.enabled_solutions.map(String)
    : null;
  const [enabled, setEnabled] = useState(persistedEnabled ?? defaultEnabled);

  const [form, setForm] = useState({
    business_name: capabilities?.business_name || '',
    location: capabilities?.location || '',
    services: capabilities?.services || '',
    industries_served: capabilities?.industries_served || [],
    technologies: capabilities?.technologies || [],
    solution_types: capabilities?.solution_types || [],
    min_project_value: capabilities?.min_project_value ?? '',
    max_project_value: capabilities?.max_project_value ?? '',
    preferred_industries: capabilities?.preferred_industries || [],
    preferred_locations: capabilities?.preferred_locations || [],
    preferred_problem_categories: capabilities?.preferred_problem_categories || [],
    preferred_client_size: capabilities?.preferred_client_size || '',
  });
  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  function toggleSolution(id) {
    setEnabled((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  }

  function toggleProblem(key) {
    const cur = form.preferred_problem_categories;
    set('preferred_problem_categories', cur.includes(key) ? cur.filter((x) => x !== key) : [...cur, key]);
  }

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    const res = await fetch('/api/settings/capabilities', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, enabled_solutions: enabled }),
    });
    const data = await res.json();
    setBusy(false);
    setNotice(data.ok
      ? { kind: 'ok', text: 'Capabilities saved. The opportunity engine now uses this profile.' }
      : { kind: 'err', text: data.error || 'Failed to save.' });
    if (data.ok) router.refresh();
  }

  const enabledCount = enabled.length;

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {notice && (
        <p className={`rounded px-3 py-2 text-sm ${notice.kind === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
          {notice.text}
        </p>
      )}

      {/* ---- Your business identity ---- */}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={fieldLabel}>Business name</span>
          <input
            value={form.business_name}
            onChange={(e) => set('business_name', e.target.value)}
            placeholder="e.g. AlvinTech Solutions"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </label>
        <label className="block">
          <span className={fieldLabel}>Location</span>
          <input
            value={form.location}
            onChange={(e) => set('location', e.target.value)}
            placeholder="e.g. Nairobi, Kenya"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </label>
      </div>

      {/* ---- I can build ---- */}
      <div>
        <p className={sectionTitle}>
          I can build <span className="ml-1 text-xs font-normal text-gray-400">({enabledCount} of {solutions.length} enabled)</span>
        </p>
        <p className="mt-1 text-xs text-gray-500">
          The opportunity engine only recommends solutions you build. Disable any you do not ship
          — matching opportunities become <span className="font-medium text-gray-700">Not a service fit</span>.
        </p>
        <div className="mt-3 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {solutions.map((s) => {
            const on = enabled.includes(String(s.id));
            const base = s.project_value?.base != null ? Number(s.project_value.base) : null;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => toggleSolution(String(s.id))}
                className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition ${
                  on
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                    : 'border-gray-200 bg-gray-50 text-gray-400 hover:border-gray-300'
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${on ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-gray-300 bg-white'}`}>
                    {on ? '✓' : ''}
                  </span>
                  <span className="truncate font-medium">{s.name}</span>
                </span>
                <span className="shrink-0 text-[11px]">{base != null ? `$${Math.round(base).toLocaleString()}` : ''}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ---- Services + custom solution types + technologies ---- */}
      <label className="block">
        <span className={fieldLabel}>Services</span>
        <textarea
          value={form.services}
          onChange={(e) => set('services', e.target.value)}
          rows={3}
          placeholder="Describe your offering, e.g. custom software development, installations, training, support…"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={fieldLabel}>Solution types (beyond the library)</span>
          <TagInput values={form.solution_types} onChange={(v) => set('solution_types', v)} placeholder="e.g. Mobile apps, POS hardware, Website" />
        </label>
        <label className="block">
          <span className={fieldLabel}>Technologies</span>
          <TagInput values={form.technologies} onChange={(v) => set('technologies', v)} placeholder="e.g. MySQL, M-Pesa API, React" />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={fieldLabel}>Industries served</span>
          <TagInput
            values={form.industries_served}
            onChange={(v) => set('industries_served', v)}
            placeholder="e.g. Retail, Restaurants, Clinics"
            suggestions={['Retail', 'Restaurants', 'Hospitality', 'Hotels', 'Clinics', 'Schools', 'Wholesale', 'Delivery', 'Manufacturing', 'Salons', 'Services', 'E-commerce']}
          />
        </label>
        <label className="block">
          <span className={fieldLabel}>Project value range (what you charge)</span>
          <span className="mt-1 flex items-center gap-2">
            <input
              type="number"
              min={0}
              value={form.min_project_value}
              onChange={(e) => set('min_project_value', e.target.value)}
              placeholder="Min USD"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            <span className="text-gray-400">to</span>
            <input
              type="number"
              min={0}
              value={form.max_project_value}
              onChange={(e) => set('max_project_value', e.target.value)}
              placeholder="Max USD"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </span>
          <span className="mt-1 block text-[11px] text-gray-400">Solutions priced above your max get a strong commercial-fit penalty.</span>
        </label>
      </div>

      {/* ---- Preferred targets ---- */}
      <div>
        <p className={sectionTitle}>Preferred targets</p>
        <p className="mt-1 text-xs text-gray-500">Soft preferences — matching opportunities in these markets rank slightly higher. They never block a good opportunity.</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={fieldLabel}>Preferred industries</span>
            <TagInput
              values={form.preferred_industries}
              onChange={(v) => set('preferred_industries', v)}
              placeholder="e.g. Restaurants, Clinics"
              suggestions={['Retail', 'Restaurants', 'Hospitality', 'Hotels', 'Clinics', 'Schools', 'Wholesale', 'Delivery', 'Manufacturing', 'Salons', 'Services', 'E-commerce']}
            />
          </label>
          <label className="block">
            <span className={fieldLabel}>Preferred locations</span>
            <TagInput values={form.preferred_locations} onChange={(v) => set('preferred_locations', v)} placeholder="e.g. Nairobi, Mombasa" />
          </label>
        </div>
        <label className="mt-4 block">
          <span className={fieldLabel}>Preferred problem categories</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {Object.keys(PROBLEM_TYPES).map((key) => {
              const on = form.preferred_problem_categories.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleProblem(key)}
                  className={`rounded-full border px-2.5 py-1 text-xs transition ${
                    on ? 'border-blue-500 bg-blue-500 text-white' : 'border-gray-300 bg-white text-gray-600 hover:border-blue-300'
                  }`}
                >
                  {problemLabel(key)}
                </button>
              );
            })}
          </div>
        </label>
        <label className="mt-4 block">
          <span className={fieldLabel}>Preferred client size</span>
          <select
            value={form.preferred_client_size}
            onChange={(e) => set('preferred_client_size', e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none sm:w-64"
          >
            <option value="">Any size</option>
            {CLIENT_SIZES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          {busy ? 'Saving…' : 'Save capabilities'}
        </button>
        <p className="text-xs text-gray-400">Saved on this device and applied to every future analysis.</p>
      </div>
    </form>
  );
}