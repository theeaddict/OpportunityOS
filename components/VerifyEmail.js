'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

export default function VerifyEmail({ token }) {
  const [state, setState] = useState(token ? 'working' : 'bad');
  const [message, setMessage] = useState(token ? '' : 'This verification link is incomplete.');
  const ran = useRef(false);

  // The link opens this page; the token is only spent by this POST (not by the
  // GET), so mail scanners that pre-fetch links can't burn it.
  useEffect(() => {
    if (!token || ran.current) return;
    ran.current = true;
    fetch('/api/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then((r) => r.json().catch(() => null))
      .then((d) => {
        if (d?.ok) setState('ok');
        else { setState('bad'); setMessage(d?.error || 'Verification failed.'); }
      })
      .catch(() => { setState('bad'); setMessage('Could not reach the server. Please try again.'); });
  }, [token]);

  if (state === 'working') return <p className="text-sm text-gray-600">Verifying your email…</p>;
  if (state === 'ok') {
    return (
      <div className="space-y-3">
        <p className="rounded-lg bg-green-50 px-3 py-3 text-sm text-green-800">Your email is verified. Thank you.</p>
        <Link href="/" className="block w-full rounded-lg bg-blue-600 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-blue-700">Continue</Link>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="rounded-lg bg-red-50 px-3 py-3 text-sm text-red-700">{message}</p>
      <p className="text-xs text-gray-500">Sign in and use the banner at the top to send a fresh link.</p>
      <Link href="/login" className="block text-center text-sm font-medium text-blue-600 hover:underline">Go to sign in</Link>
    </div>
  );
}
