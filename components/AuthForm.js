'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AuthForm({ mode }) {
  const router = useRouter();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('credentials'); // credentials -> two-factor (login only)
  const [pending, setPending] = useState(null); // { email, password } kept across the 2FA step

  async function submit(payload) {
    const res = await fetch(`/api/auth/${mode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    // The server can return a non-JSON body (e.g. Next.js's HTML 404 while a
    // route is still compiling on a fresh dev boot). Never crash on it.
    const data = await res.json().catch(() => null);
    return data || { ok: false, error: `Server returned ${res.status}. Please try again.` };
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
      router.push('/');
      router.refresh();
      return;
    }

    const data = await submit(payload);
    setBusy(false);
    if (!data.ok) {
      if (mode === 'login' && data.code === 'two_factor_required') {
        setPending({ email: String(payload.email || '').trim(), password: String(payload.password || '') });
        setStep('two-factor');
        setError(null);
        return;
      }
      setError(data.error || 'Something went wrong');
      return;
    }
    router.push('/');
    router.refresh();
  }

  if (mode === 'login' && step === 'two-factor') {
    return (
      <form onSubmit={onSubmit} className="space-y-4">
        <p className="text-sm">
          Enter the 6-digit code from your authenticator app (or a backup code) to finish signing in.
        </p>
        <Field label="Verification code" name="code" autoComplete="one-time-code" required hint="6-digit code or backup code" />
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy}
            className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
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
      {mode === 'register' && (
        <Field label="Your name" name="name" required />
      )}
      <Field label="Email" name="email" type="email" required />
      <Field label="Password" name="password" type="password" required hint={mode === 'register' ? '8-200 chars with uppercase, lowercase, digit and special char' : undefined} />
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
      </button>
    </form>
  );
}

function Field({ label, name, type = 'text', required, hint, autoComplete }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete || (type === 'password' ? 'current-password' : undefined)}
        className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
      {hint && <span className="mt-1 block text-xs text-gray-400">{hint}</span>}
    </label>
  );
}