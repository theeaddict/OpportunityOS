'use client';

import { useState } from 'react';
import '@/lib/csrf-client';

function formatPrice(cents, currency) {
  if (cents == null) return null;
  return `${(cents / 100).toLocaleString(undefined, { style: 'currency', currency: currency || 'USD' })}/month`;
}

/**
 * OWNER-only upgrade/manage-billing controls. Renders nothing when there is
 * nothing to offer — no purchasable plan and no existing Stripe customer —
 * so the account page stays clean until an operator actually wires up Stripe
 * (sets a plan's stripe_price_id in the admin Plans control room).
 */
export default function BillingUpgrade({ currentPlanCode, plans, canManage, hasBillingAccount }) {
  const [busyCode, setBusyCode] = useState(null);
  const [error, setError] = useState(null);

  if (!canManage) return null;

  const purchasable = (plans || []).filter((p) => p.code !== currentPlanCode && p.stripe_price_id);
  if (!purchasable.length && !hasBillingAccount) return null;

  async function goTo(url) {
    const res = await fetch(url, { method: 'POST' });
    const data = await res.json().catch(() => null);
    if (!data?.ok) { setError(data?.error || 'Something went wrong — try again shortly.'); return; }
    window.location.href = data.url;
  }

  async function upgrade(code) {
    setBusyCode(code);
    setError(null);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_code: code }),
      });
      const data = await res.json().catch(() => null);
      if (!data?.ok) { setError(data?.error || 'Could not start checkout.'); return; }
      window.location.href = data.url;
    } finally {
      setBusyCode(null);
    }
  }

  async function manageBilling() {
    setBusyCode('portal');
    setError(null);
    try {
      await goTo('/api/billing/portal');
    } finally {
      setBusyCode(null);
    }
  }

  return (
    <div className="mt-4 space-y-3 border-t border-gray-100 pt-4">
      {purchasable.map((p) => (
        <div key={p.code} className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-gray-900">{p.name}</p>
            {formatPrice(p.price_cents, p.currency) && (
              <p className="text-xs text-gray-500">{formatPrice(p.price_cents, p.currency)}</p>
            )}
          </div>
          <button
            onClick={() => upgrade(p.code)}
            disabled={Boolean(busyCode)}
            className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
          >
            {busyCode === p.code ? 'Redirecting…' : `Upgrade to ${p.name}`}
          </button>
        </div>
      ))}
      {hasBillingAccount && (
        <button
          onClick={manageBilling}
          disabled={Boolean(busyCode)}
          className="text-xs font-medium text-gray-600 underline hover:text-gray-900 disabled:opacity-50"
        >
          {busyCode === 'portal' ? 'Opening…' : 'Manage billing / cancel subscription'}
        </button>
      )}
      {error && <p className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}
