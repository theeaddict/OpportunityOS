'use client';

export default function PipelineMetrics({ metrics }) {
  if (!metrics) return null;

  const fmt = (n, currency = 'KES') => {
    if (!n) return `${currency} 0`;
    return `${currency} ${Number(n).toLocaleString()}`;
  };

  const cards = [
    { label: 'Total pipeline', value: fmt(metrics.totalPipeline, metrics.currency), color: 'text-gray-900' },
    { label: 'Weighted pipeline', value: fmt(metrics.weightedPipeline, metrics.currency), color: 'text-indigo-700' },
    { label: 'Won revenue', value: fmt(metrics.wonRevenue, metrics.currency), color: 'text-emerald-700' },
    { label: 'Win rate', value: `${metrics.winRate}%`, color: 'text-blue-700' },
    { label: 'Avg project value', value: fmt(metrics.avgProjectValue, metrics.currency), color: 'text-gray-900' },
    { label: 'Avg days to close', value: `${metrics.avgDaysToClose}d`, color: 'text-gray-900' },
  ];

  return (
    <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {cards.map((c) => (
        <div key={c.label} className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{c.label}</p>
          <p className={`mt-1 text-lg font-bold ${c.color}`}>{c.value}</p>
        </div>
      ))}
    </div>
  );
}
