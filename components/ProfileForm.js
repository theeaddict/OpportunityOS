'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ProfileForm({ user }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    const payload = Object.fromEntries(new FormData(e.target).entries());
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setBusy(false);
    setNotice(data.ok ? { kind: 'ok', text: 'Profile saved.' } : { kind: 'err', text: data.error });
    if (data.ok) router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">Your name</span>
          <input name="name" defaultValue={user.name} required className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
        </label>

      </div>
      {notice && <p className={`rounded px-3 py-2 text-sm ${notice.kind === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{notice.text}</p>}
      <button disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{busy ? 'Saving…' : 'Save profile'}</button>
    </form>
  );
}
