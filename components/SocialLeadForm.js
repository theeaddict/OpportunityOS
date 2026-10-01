'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const PLATFORMS = ['TikTok', 'Instagram', 'Facebook', 'Other'];

// Plain-language observations mapped to the real signal vocabulary (lib/constants.js
// SIGNAL_KEYS) the scoring/rules engine already understands — checking one of these
// produces the exact same kind of evidence a discovery provider or the website
// crawler would, just sourced from what YOU saw on their public profile instead of
// automated scraping (TikTok/Instagram scraping violates their Terms of Service and
// is deliberately not something this app does).
const OBSERVATIONS = [
  { key: 'active_social_commerce', label: 'They actively post content that shows their work (styles, products, services, menu, portfolio)' },
  { key: 'no_booking_system', label: 'Customers book appointments through comments, DMs, calls or texts — no online booking' },
  { key: 'no_online_ordering', label: 'Customers order/buy through comments, DMs, calls or texts — no online ordering' },
  { key: 'unanswered_enquiries', label: 'Comments/DMs asking to book or order are visibly going unanswered' },
  { key: 'public_phone_published', label: 'They publish a phone number in their bio/profile' },
  { key: 'phone_whatsapp_published', label: 'They publish a WhatsApp number in their bio/profile' },
];

function Field({ name, label, required, type = 'text' }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}{required && ' *'}</span>
      <input name={name} type={type} required={required} className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
    </label>
  );
}

export default function SocialLeadForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [checked, setChecked] = useState({});

  function toggle(key) {
    setChecked((c) => ({ ...c, [key]: !c[key] }));
  }

  async function postEvidence(businessId, payload) {
    const res = await fetch(`/api/businesses/${businessId}/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.json().catch(() => null);
  }

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const platform = String(fd.get('platform') || 'Other');
    const socialUrl = String(fd.get('socialUrl') || '').trim();
    const notes = String(fd.get('notes') || '').trim();

    try {
      const created = await fetch('/api/businesses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: String(fd.get('name') || '').trim(),
          industry: String(fd.get('industry') || '').trim() || undefined,
          location: String(fd.get('location') || '').trim() || undefined,
          phone: String(fd.get('phone') || '').trim() || undefined,
          platform,
          socialUrl,
        }),
      }).then((r) => r.json());
      if (!created.ok) { setError(created.error || 'Could not save this business'); return; }
      const businessId = created.id;

      for (const o of OBSERVATIONS.filter((x) => checked[x.key])) {
        await postEvidence(businessId, {
          evidence_text: `Observed on ${platform}: ${o.label.charAt(0).toLowerCase()}${o.label.slice(1)}.`,
          signal_key: o.key,
          claim_type: 'INFERENCE',
          source_name: `${platform} profile`,
          source_url: socialUrl || undefined,
          confidence_score: 0.6,
        });
      }
      if (notes) {
        await postEvidence(businessId, {
          evidence_text: notes,
          claim_type: 'HYPOTHESIS',
          source_name: `${platform} profile`,
          source_url: socialUrl || undefined,
          confidence_score: 0.5,
        });
      }

      setOpen(false);
      setChecked({});
      router.push(`/businesses/${businessId}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="rounded-lg border border-blue-600 px-4 py-2.5 text-sm font-semibold text-blue-600 hover:bg-blue-50">
        Add a lead you found on social media
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="w-full rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="mb-3 text-sm text-gray-500">
        For a business you found on TikTok, Instagram or Facebook rather than a directory listing — record what you
        saw on their profile and it flows straight into scoring and outreach, same as anything found automatically.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="name" label="Business name" required />
        <Field name="industry" label="Industry (optional)" />
        <Field name="location" label="Location (optional)" />
        <Field name="phone" label="Public phone (if shown)" />
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-[140px_1fr]">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">Platform</span>
          <select name="platform" defaultValue="TikTok" className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
            {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <Field name="socialUrl" label="Profile URL" type="url" required />
      </div>

      <fieldset className="mt-4">
        <legend className="mb-2 text-sm font-medium text-gray-700">What did you notice on their profile?</legend>
        <div className="space-y-2">
          {OBSERVATIONS.map((o) => (
            <label key={o.key} className="flex items-start gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={Boolean(checked[o.key])}
                onChange={() => toggle(o.key)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300"
              />
              {o.label}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="mt-3 block">
        <span className="mb-1 block text-sm font-medium text-gray-700">Anything else worth noting?</span>
        <textarea
          name="notes"
          rows={2}
          placeholder="e.g. 40k followers, posts a few times a week, comments full of “how do I book?”"
          className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        />
      </label>

      {error && <p className="mt-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="mt-4 flex gap-2">
        <button disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          {busy ? 'Saving…' : 'Save lead'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100">Cancel</button>
      </div>
    </form>
  );
}
