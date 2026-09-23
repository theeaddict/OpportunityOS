'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AddBusinessForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const payload = Object.fromEntries(new FormData(e.target).entries());
    const res = await fetch('/api/businesses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setBusy(false);
    if (!data.ok) return setError(data.error);
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
        Add business manually
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="w-full rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="name" label="Business name" required />
        <Field name="industry" label="Industry" />
        <Field name="location" label="Location (city / area)" />
        <Field name="country" label="Country" />
        <Field name="website" label="Website" type="url" />
        <Field name="phone" label="Public phone" />
        <Field name="email" label="Public email" type="email" />
      </div>
      <label className="mt-3 block">
        <span className="mb-1 block text-sm font-medium text-gray-700">What does the business do?</span>
        <textarea name="description" rows={2} className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
      </label>
      {error && <p className="mt-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="mt-4 flex gap-2">
        <button disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          {busy ? 'Saving…' : 'Save business'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100">Cancel</button>
      </div>
    </form>
  );
}

function Field({ name, label, required, type = 'text' }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}{required && ' *'}</span>
      <input name={name} type={type} required={required} className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
    </label>
  );
}
