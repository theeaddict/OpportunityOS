'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Change password. Verifies the current password server-side before applying
// the new one (same BiasharaOS password-validation policy).
export default function PasswordForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    const f = e.target;
    const payload = Object.fromEntries(new FormData(f).entries());
    if (payload.new_password !== payload.confirm_password) {
      setBusy(false);
      setNotice({ kind: 'err', text: 'New password and confirmation do not match' });
      return;
    }
    const res = await fetch('/api/settings/password', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: payload.current_password, new_password: payload.new_password }),
    });
    const data = await res.json();
    setBusy(false);
    setNotice(data.ok ? { kind: 'ok', text: 'Password updated.' } : { kind: 'err', text: data.error || 'Something went wrong' });
    if (data.ok) f.reset();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <input name="current_password" type="password" required placeholder="Current password" autoComplete="current-password"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
        <input name="new_password" type="password" required placeholder="New password" autoComplete="new-password"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
        <input name="confirm_password" type="password" required placeholder="Confirm new password" autoComplete="new-password"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
      </div>
      <p className="text-xs text-gray-400">8-200 characters with uppercase, lowercase, digit and special character.</p>
      {notice && <p className={`rounded px-3 py-2 text-sm ${notice.kind === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{notice.text}</p>}
      <button disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
        {busy ? 'Updating…' : 'Update password'}
      </button>
    </form>
  );
}