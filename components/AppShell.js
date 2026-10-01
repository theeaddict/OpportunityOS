'use client';

import '@/lib/csrf-client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { isAtLeast } from '@/lib/accounts/roles';

const NAV = [
  { group: 'Find money', items: [
    { href: '/', label: 'Dashboard' },
    { href: '/discover', label: 'Find opportunities' },
    { href: '/opportunities', label: 'Opportunities' },
    { href: '/businesses', label: 'Businesses' },
  ] },
  { group: 'Follow through', items: [
    { href: '/pipeline', label: 'Deal pipeline' },
    { href: '/account', label: 'Account' },
  ] },
  { group: 'Admin & settings', items: [
    { href: '/solutions', label: 'Solution library', adminOnly: true },
    { href: '/jobs', label: 'Jobs', adminOnly: true },
    { href: '/analytics', label: 'Analytics', adminOnly: true },
    { href: '/settings', label: 'Settings' },
  ] },
];

export default function AppShell({ user, children }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // The control room (/admin/*) has its own shell (components/AdminShell.js),
  // nested inside this one via app/admin/(control)/layout.js. Without this
  // check, an operator who is ALSO a signed-in tenant user in the same
  // browser — the normal case for the person running their own workspace AND
  // administering the platform — gets two competing fixed-position sidebars,
  // with this tenant one winning and the real admin nav never showing.
  if (!user || pathname.startsWith('/admin')) {
    return <div className="min-h-screen">{children}</div>;
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  const isActive = (href) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <div className="min-h-screen lg:flex">
      {/* Mobile top bar */}
      <header className="lg:hidden sticky top-0 z-40 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
        <Link href="/" className="font-semibold text-blue-700">Opportunity<span className="text-gray-900">OS</span></Link>
        <button onClick={() => setOpen(!open)} aria-label="Menu" className="rounded p-2 hover:bg-gray-100">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
        </button>
      </header>

      {/* Sidebar */}
      <aside className={`${open ? 'block' : 'hidden'} lg:block fixed lg:sticky inset-x-0 top-[52px] lg:top-0 z-30 h-[calc(100vh-52px)] lg:h-screen w-full lg:w-60 shrink-0 overflow-y-auto border-r border-gray-200 bg-white`}>
        <div className="hidden lg:block px-5 pt-6 pb-4">
          <Link href="/" className="text-lg font-bold tracking-tight">
            <span className="text-blue-700">Opportunity</span><span>OS</span>
          </Link>
          <p className="mt-1 text-xs text-gray-500">Business Opportunity Intelligence</p>
        </div>
        <nav className="space-y-4 px-3 py-3">
          {NAV.map((section) => {
            const items = section.items.filter((item) => !item.adminOnly || isAtLeast(user, 'admin'));
            if (!items.length) return null;
            return (
              <div key={section.group}>
                <p className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-widest text-gray-400">{section.group}</p>
                <div className="space-y-0.5">
                  {items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className={`block rounded-lg px-3 py-2 text-sm font-medium transition ${
                        isActive(item.href) ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>
        <div className="border-t border-gray-200 px-5 py-4 mt-4">
          <p className="truncate text-sm font-medium text-gray-900">{user.name}</p>
          <p className="truncate text-xs text-gray-500">{user.email}</p>
          <button onClick={logout} className="mt-3 text-xs font-medium text-red-600 hover:text-red-700">Sign out</button>
        </div>
      </aside>

      <main className={`flex-1 ${open ? 'hidden lg:block' : ''} min-w-0`}>
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          {!user.email_verified_at && !pathname.startsWith('/verify-email') && <VerifyEmailBanner email={user.email} />}
          {children}
        </div>
      </main>
    </div>
  );
}

function VerifyEmailBanner({ email }) {
  const [state, setState] = useState('idle'); // idle | sending | sent | error
  const [message, setMessage] = useState('');

  async function resend() {
    setState('sending');
    const res = await fetch('/api/auth/resend-verification', { method: 'POST' }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    if (data?.ok) setState('sent');
    else { setState('error'); setMessage(data?.error || 'Could not send the email. Try again later.'); }
  }

  return (
    <div role="status" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <span>
        {state === 'sent'
          ? `Verification email sent to ${email}. Check your inbox (and spam).`
          : `Please verify your email address (${email}) — we sent you a link when you signed up.`}
        {state === 'error' && <span className="ml-2 text-red-700">{message}</span>}
      </span>
      {state !== 'sent' && (
        <button
          type="button"
          onClick={resend}
          disabled={state === 'sending'}
          className="rounded-md border border-amber-300 bg-white px-3 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-60"
        >
          {state === 'sending' ? 'Sending…' : 'Resend email'}
        </button>
      )}
    </div>
  );
}
