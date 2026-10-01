'use client';

import Link from 'next/link';
import { useState } from 'react';

export default function ResetPasswordForm({ token }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const password = String(fd.get('password') || '');
    if (password !== String(fd.get('confirm') || '')) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    if (data?.ok) setDone(true);
    else setError(data?.error || 'Something went wrong. Please try again.');
  }

  if (!token) {
    return (
      <p className="rounded-lg bg-red-50 px-3 py-3 text-sm text-red-700">
        This reset link is incomplete. <Link href="/forgot-password" className="font-medium underline">Request a new one</Link>.
      </p>
    );
  }
  if (done) {
    return (
      <div className="space-y-3">
        <p className="rounded-lg bg-green-50 px-3 py-3 text-sm text-green-800">Password updated. You&apos;ve been signed out everywhere else.</p>
        <Link href="/login" className="block w-full rounded-lg bg-blue-600 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-blue-700">Sign in</Link>
      </div>
    );
  }

  const input = 'block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-700">New password</span>
        <input name="password" type="password" required autoComplete="new-password" className={input} />
        <span className="mt-1 block text-xs text-gray-400">8-200 chars with uppercase, lowercase, digit and special char</span>
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-700">Confirm new password</span>
        <input name="confirm" type="password" required autoComplete="new-password" className={input} />
      </label>
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error} {/expired|invalid/i.test(error) && <Link href="/forgot-password" className="font-medium underline">Request a new link</Link>}
        </p>
      )}
      <button type="submit" disabled={busy} className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
        {busy ? 'Saving…' : 'Set new password'}
      </button>
    </form>
  );
}
