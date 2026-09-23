'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import '@/lib/csrf-client'; // side-effect: X-CSRF-Token on mutating fetches (control room mutations)

// The platform control room has its OWN navigation — it is deliberately NOT
// linked from components/AppShell (normal user nav). You only get here by
// signing in at /admin/login (or typing /admin/*): the layout + every admin
// API route enforce the separate administrator identity (admin_users +
// oos_admin_session) server-side, so a tenant user can never render this.
const ADMIN_NAV = [
  { href: '/admin', label: 'Control room', status: 'ready' },
  { href: '/admin/accounts', label: 'Accounts', status: 'ready' },
  { href: '/admin/plans', label: 'Billing plans', status: 'ready' },
  { href: '/admin/usage', label: 'Usage & cost', status: 'ready' },
  { href: '/admin/api-keys', label: 'API keys', status: 'ready' },
  { href: '/admin/customer-care', label: 'Customer care', status: 'ready' },
  { href: '/admin/system', label: 'System health', status: 'ready' },
  { href: '/admin/scoring', label: 'Scoring thresholds', status: 'ready' },
  { href: '/admin/audit', label: 'Audit log', status: 'ready' },
];

export default function AdminShell({ admin, children }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch('/api/admin/logout', { method: 'POST' });
    router.push('/admin/login');
    router.refresh();
  }

  const isActive = (href) => (href === '/admin' ? pathname === '/admin' : pathname.startsWith(href));

  return (
    <div className="min-h-screen bg-slate-50 lg:flex">
      <aside className="w-60 shrink-0 border-r border-gray-200 bg-white lg:fixed lg:inset-y-0 lg:left-0">
        <div className="px-5 pt-6 pb-4">
          <p className="text-lg font-bold tracking-tight">
            <span className="text-red-700">Opportunity</span>
            <span>OS</span>{' '}
            <span className="rounded bg-red-700 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-white">
              Control room
            </span>
          </p>
          <p className="mt-1 text-xs text-gray-500">Whole-system administrators</p>
        </div>
        <nav className="space-y-1 px-3">
          {ADMIN_NAV.map((item) =>
            item.status === 'ready' ? (
              <Link
                key={item.href}
                href={item.href}
                className={`block rounded-lg px-3 py-2 text-sm font-medium ${
                  isActive(item.href) ? 'bg-red-50 text-red-700' : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                {item.label}
              </Link>
            ) : (
              <span
                key={item.href}
                title="Planned for a later stage"
                className="block cursor-not-allowed rounded-lg px-3 py-2 text-sm font-medium text-gray-400"
              >
                {item.label} <span className="text-[10px] text-gray-300">(next)</span>
              </span>
            )
          )}
        </nav>
        <div className="mt-8 border-t border-gray-200 px-5 py-4">
          <p className="truncate text-sm font-medium text-gray-900">{admin.name}</p>
          <p className="truncate text-xs text-gray-500">{admin.email}</p>
          <span className="mt-1 inline-block rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-700">
            platform admin
          </span>
          <button onClick={logout} className="mt-3 block text-xs font-medium text-red-600 hover:text-red-700">
            Sign out
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 lg:ml-60">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">{children}</div>
      </main>
    </div>
  );
}