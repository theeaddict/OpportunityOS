'use client';

import { useState } from 'react';

export default function ForgotPasswordForm() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const email = String(new FormData(e.target).get('email') || '').trim();
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    if (data?.ok) setDone(true);
    else setError(data?.error || 'Something went wrong. Please try again.');
  }

  if (done) {
    return (
      <p className="rounded-lg bg-green-50 px-3 py-3 text-sm text-green-800">
        If that email has an account, a reset link is on its way. It works for 60 minutes. Check your spam folder if it doesn&apos;t arrive.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="text-sm text-gray-600">Enter your account email and we&apos;ll send you a link to choose a new password.</p>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-700">Email</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="username"
          className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </label>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button type="submit" disabled={busy} className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
        {busy ? 'Sending…' : 'Send reset link'}
      </button>
    </form>
  );
}
