'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import '@/lib/csrf-client';

const LIMIT_FIELDS = [
  { key: 'limit_researches', label: 'Researches' },
  { key: 'limit_opportunities', label: 'Opportunities' },
  { key: 'limit_ai_analyses', label: 'AI analyses' },
  { key: 'limit_demo_generations', label: 'Demos' },
  { key: 'limit_users', label: 'Seats' },
  { key: 'limit_watches', label: 'Watches' },
];

const BLANK = () => ({
  code: '',
  name: '',
  description: '',
  price_cents: '',
  currency: 'USD',
  stripe_price_id: '',
  limit_researches: '',
  limit_opportunities: '',
  limit_ai_analyses: '',
  limit_demo_generations: '',
  limit_users: '',
  limit_watches: '',
  is_active: true,
});

export default function BillingPlansClient() {
  const [plans, setPlans] = useState(null);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [creating, setCreating] = useState(false);
  const [editingCode, setEditingCode] = useState(null);
  const [savingCode, setSavingCode] = useState(null);

  const load = useCallback(() => {
    return fetch('/api/admin/plans', { headers: { Accept: 'application/json' } })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => (ok ? setPlans(d.plans) : setError(d?.error || 'Failed to load plans')))
      .catch(() => setError('Failed to load plans'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function savePlan(payload, isNew, originalCode) {
    setSavingCode(isNew ? 'new' : originalCode);
    setError(null);
    setMessage(null);
    const url = isNew ? '/api/admin/plans' : `/api/admin/plans/${encodeURIComponent(originalCode)}`;
    const res = await fetch(url, {
      method: isNew ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error || 'Request failed');
    return body.plan;
  }

  function handleCreate(e) {
    e.preventDefault();
    setCreating(true);
  }

  async function submitNew(e) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = {};
    for (const [k, v] of fd.entries()) {
      if (k === 'code') payload.code = String(v).trim();
      else if (k === 'name') payload.name = String(v).trim();
      else if (k === 'description') payload.description = String(v).trim();
      else if (k === 'currency') payload.currency = String(v).trim();
      else if (k === 'stripe_price_id') payload.stripe_price_id = String(v).trim() || null;
      else if (LIMIT_FIELDS.some((f) => f.key === k)) payload[k] = v === '' ? null : Number(v);
      else if (k === 'is_active') payload.is_active = v === 'on';
    }
    try {
      const plan = await savePlan(payload, true);
      setCreating(false);
      setMessage(`Plan ${plan.code} created.`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingCode(null);
    }
  }

  async function submitEdit(e, originalCode) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = {};
    for (const [k, v] of fd.entries()) {
      if (k === 'name') payload.name = String(v).trim();
      else if (k === 'description') payload.description = String(v).trim();
      else if (k === 'currency') payload.currency = String(v).trim();
      else if (k === 'stripe_price_id') payload.stripe_price_id = String(v).trim() || null;
      else if (LIMIT_FIELDS.some((f) => f.key === k)) payload[k] = v === '' ? null : Number(v);
      else if (k === 'is_active') payload.is_active = v === 'on';
    }
    try {
      await savePlan(payload, false, originalCode);
      setEditingCode(null);
      setMessage(`Plan ${originalCode} updated.`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingCode(null);
    }
  }

  async function removePlan(plan) {
    if (!window.confirm(`Remove plan "${plan.name}" (${plan.code})? Accounts already on this plan must move first.`)) return;
    setSavingCode(plan.code);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/plans/${encodeURIComponent(plan.code)}`, { method: 'DELETE' });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || 'Request failed');
      setMessage(`Plan ${plan.code} removed.`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingCode(null);
    }
  }

  const sorted = useMemo(() => details(plans), [plans]);
  if (error && !plans) return <p className="text-sm text-red-600">{error}</p>;
  if (!plans) return <p className="text-sm text-gray-400">Loading plans…</p>;

  return (
    <div className="space-y-6">
      {message && <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{message}</p>}
      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <section className="rounded-lg border border-gray-200 bg-white p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Plans</h2>
            <p className="mt-1 text-sm text-gray-500">
              NULL limit means unlimited. <span className="font-medium">internal</span> and <span className="font-medium">free</span> are protected.
            </p>
          </div>
          <button
            onClick={handleCreate}
            className="shrink-0 rounded-lg bg-red-700 px-3 py-2 text-sm font-semibold text-white hover:bg-red-800"
          >
            New plan
          </button>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Price</th>
                {LIMIT_FIELDS.map((f) => (
                  <th key={f.key} className="px-4 py-3">{f.label}</th>
                ))}
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sorted.map((p) => {
                const editing = editingCode === p.code;
                const saving = savingCode === p.code;
                const protectedPlan = p.code === 'internal' || p.code === 'free';
                return (
                  <Fragment key={p.code}>
                    <tr className={editing ? 'bg-red-50/40' : 'hover:bg-gray-50'}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{p.name}</p>
                        <p className="text-xs text-gray-500">
                          {p.code}
                          {p.description ? ` · ${p.description}` : ''}
                        </p>
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        {p.price_cents == null ? '—' : `${(p.price_cents / 100).toLocaleString(undefined, { style: 'currency', currency: p.currency })}`}
                      </td>
                      {LIMIT_FIELDS.map((f) => (
                        <td key={f.key} className="px-4 py-3 tabular-nums">
                          {p[f.key] == null ? '∞' : p[f.key]}
                        </td>
                      ))}
                      <td className="px-4 py-3">
                        {p.is_active ? (
                          <span className="inline-block rounded bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">active</span>
                        ) : (
                          <span className="inline-block rounded bg-gray-200 px-2 py-0.5 text-xs font-semibold text-gray-600">hidden</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setEditingCode(editing ? null : p.code)}
                          disabled={saving}
                          className="mr-2 text-xs font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50"
                        >
                          {editing ? 'Cancel' : 'Edit'}
                        </button>
                        <button
                          onClick={() => removePlan(p)}
                          disabled={saving || protectedPlan}
                          title={protectedPlan ? 'This plan is protected' : 'Remove plan'}
                          className="text-xs font-semibold text-red-600 hover:text-red-800 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {saving ? '…' : 'Remove'}
                        </button>
                      </td>
                    </tr>
                    {editing && <EditingRow plan={p} onCancel={() => setEditingCode(null)} onSubmit={(e) => submitEdit(e, p.code)} />}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {creating && (
        <section className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-gray-900">New plan</h2>
          <PlanForm
            blank
            onCancel={() => setCreating(false)}
            onSubmit={submitNew}
            saving={savingCode === 'new'}
          />
        </section>
      )}
    </div>
  );
}

function details(plans) {
  if (!plans) return [];
  const order = { internal: 0, free: 1 };
  return [...plans].sort((a, b) => {
    const ra = order[a.code] ?? 2;
    const rb = order[b.code] ?? 2;
    return ra - rb || String(a.code).localeCompare(String(b.code));
  });
}

function EditingRow({ plan, onCancel, onSubmit }) {
  return (
    <tr>
      <td colSpan={10} className="bg-gray-50 px-4 py-4">
        <PlanForm plan={plan} onCancel={onCancel} onSubmit={onSubmit} />
      </td>
    </tr>
  );
}

function PlanForm({ plan = BLANK(), blank = false, onCancel, onSubmit, saving }) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-4">
        {blank && (
          <Label label="Code">
            <input name="code" defaultValue="" required pattern="[a-z0-9][a-z0-9_-]{0,39}" placeholder="e.g. growth" className={inputCls} />
          </Label>
        )}
        <Label label="Name">
          <input name="name" defaultValue={plan.name} required maxLength={120} className={inputCls} />
        </Label>
        <Label label="Price (cents)">
          <input name="price_cents" type="number" min="0" step="1" defaultValue={plan.price_cents ?? ''} className={inputCls} />
        </Label>
        <Label label="Currency">
          <input name="currency" defaultValue={plan.currency || 'USD'} maxLength={3} className={inputCls} />
        </Label>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Label label="Description">
          <input name="description" defaultValue={plan.description || ''} maxLength={300} className={inputCls} />
        </Label>
        <Label label="Stripe price ID">
          <input
            name="stripe_price_id"
            defaultValue={plan.stripe_price_id || ''}
            maxLength={120}
            placeholder="price_… (leave blank to keep this plan un-purchasable)"
            className={inputCls}
          />
        </Label>
      </div>
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
        {LIMIT_FIELDS.map((f) => (
          <Label key={f.key} label={f.label}>
            <input
              name={f.key}
              type="number"
              min="0"
              step="1"
              defaultValue={plan[f.key] ?? ''}
              placeholder="∞"
              className={inputCls}
            />
          </Label>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input name="is_active" type="checkbox" defaultChecked={plan.is_active !== false} className="h-4 w-4 rounded border-gray-300" />
        Active (visible to new/upgraded accounts)
      </label>
      <div className="flex gap-3">
        <button type="submit" disabled={saving} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
          Cancel
        </button>
      </div>
    </form>
  );
}

const inputCls =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none';

function Label({ label, children, wide = false }) {
  return (
    <label className={`block ${wide ? 'lg:col-span-4' : ''}`}>
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">{label}</span>
      {children}
    </label>
  );
}