'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminLoginForm() {
  const router = useRouter();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('credentials'); // credentials -> two-factor (admin 2FA)
  const [pending, setPending] = useState(null); // { email, password } kept across the 2FA step

  async function submit(payload) {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    return data || { ok: false, error: `Server returned ${res.status}` };
  }

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.target);
    const payload = Object.fromEntries(form.entries());

    if (step === 'two-factor') {
      const data = await submit({ ...pending, code: String(payload.code || '').trim() });
      setBusy(false);
      if (!data.ok) {
        setError(data.error || 'Something went wrong');
        return;
      }
      router.push('/admin');
      router.refresh();
      return;
    }

    const data = await submit(payload);
    setBusy(false);
    if (!data.ok) {
      if (data.code === 'two_factor_required') {
        setPending({ email: String(payload.email || '').trim(), password: String(payload.password || '') });
        setStep('two-factor');
        setError(null);
        return;
      }
      setError(data.error || 'Something went wrong');
      return;
    }
    router.push('/admin');
    router.refresh();
  }

  if (step === 'two-factor') {
    return (
      <form onSubmit={onSubmit} className="space-y-4">
        <p className="text-sm text-gray-600">
          Enter the 6-digit code from your authenticator app (or a backup code) to finish signing in.
        </p>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">Verification code</span>
          <input
            name="code"
            inputMode="numeric"
            pattern="[0-9]*"
            required
            autoComplete="one-time-code"
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
          />
        </label>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy}
            className="flex-1 rounded-lg bg-red-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
          >
            {busy ? 'Verifying…' : 'Verify code'}
          </button>
          <button type="button" disabled={busy} onClick={() => setStep('credentials')}
            className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50">
            Back
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-700">Administrator email</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="username"
          className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-700">Password</span>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
        />
      </label>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg bg-red-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
      >
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}