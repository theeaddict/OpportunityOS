import Link from 'next/link';
import { Card, fmtMoney } from '@/components/ui';

/**
 * Money-grade headline metrics. The first thing a user sees should be the
 * money at stake and what to do next — not deal-administration counts.
 */
export default function DashboardCards({ metrics }) {
  const cards = [
    {
      label: 'Money identified',
      value: metrics.businessImpact?.total
        ? fmtMoney(metrics.businessImpact.total, metrics.businessImpact.currency)
        : '—',
      hint: 'Est. annual business impact of open opportunities',
      href: '/opportunities',
      accent: 'text-emerald-600',
    },
    {
      label: 'Worth pursuing',
      value: metrics.activeCount ?? 0,
      hint: `${metrics.hotOpportunities} scoring HOT`,
      href: '/opportunities',
      accent: 'text-blue-600',
    },
    {
      label: 'Need your action',
      value: metrics.needingAction,
      hint: 'Evidence-backed and open — start here',
      href: '/opportunities',
      accent: 'text-amber-600',
    },
    {
      label: 'What you could charge',
      value: metrics.projectValue?.total ? fmtMoney(metrics.projectValue.total, metrics.projectValue.currency) : '—',
      hint: 'Est. delivery value of open opportunities',
      href: '/opportunities',
      accent: 'text-indigo-600',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {cards.map((c) => (
        <Link key={c.label} href={c.href} className="block">
          <Card className="p-4 transition hover:border-emerald-300 hover:shadow">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{c.label}</p>
            <p className={`mt-1 truncate text-2xl font-bold ${c.accent}`}>{c.value}</p>
            <p className="truncate text-xs text-gray-400">{c.hint}</p>
          </Card>
        </Link>
      ))}
    </div>
  );
}