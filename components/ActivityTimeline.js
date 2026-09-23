'use client';

const TYPE_ICONS = {
  status_change: '→',
  note: '📝',
  outreach: '📧',
  demo: '🖥',
  analysis: '📊',
  pipeline_edit: '✏',
  contact: '📞',
  payment: '💰',
};

export default function ActivityTimeline({ activities }) {
  if (!activities?.length) {
    return <p className="text-sm text-gray-400">No activity recorded yet.</p>;
  }

  return (
    <div className="space-y-0">
      {activities.map((a, i) => {
        const icon = TYPE_ICONS[a.activity_type] || '•';
        const time = a.created_at ? new Date(a.created_at).toLocaleString() : '';
        return (
          <div key={a.id || i} className="relative flex gap-3 pb-4">
            {/* Vertical connector */}
            {i < activities.length - 1 && (
              <div className="absolute left-3 top-5 h-full w-px bg-gray-200" />
            )}
            {/* Icon */}
            <div className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs">
              {icon}
            </div>
            {/* Content */}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-800">{a.title || a.activity_type}</p>
              {a.detail && <p className="mt-0.5 text-xs text-gray-500">{a.detail}</p>}
              <p className="mt-0.5 text-[11px] text-gray-400">
                {a.actor_name && <span>{a.actor_name} · </span>}
                {time}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
