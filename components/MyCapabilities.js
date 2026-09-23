import { problemLabel } from '@/lib/constants';

function List({ label, items, empty = 'Not specified' }) {
  if (!items?.length) return null;
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {items.map((t) => (
          <span key={t} className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{t}</span>
        ))}
      </div>
    </div>
  );
}

export default function MyCapabilities({ capabilities, solutions }) {
  const enabledIds = new Set((capabilities?.enabled_solutions || []).map(String));
  const buildable = solutions.filter((s) => !enabledIds.size || enabledIds.has(String(s.id))).sort((a, b) => a.name.localeCompare(b.name));
  const profile = capabilities || {};

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
        <p className="font-semibold text-gray-900">{profile.business_name || 'My Capabilities'}</p>
        {profile.location && <p className="text-gray-500">📍 {profile.location}</p>}
        {profile.preferred_client_size && (
          <p className="text-gray-500">Preferred client: {String(profile.preferred_client_size).replaceAll('_', ' ')}</p>
        )}
        {profile.min_project_value != null && profile.max_project_value != null && (
          <p className="text-gray-500">
            Project range: <span className="font-medium text-gray-700">{fmt(profile.min_project_value)}–{fmt(profile.max_project_value)} USD</span>
          </p>
        )}
      </div>

      <div>
        <p className="text-sm font-medium text-gray-900">I can build:</p>
        {buildable.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {buildable.map((s) => (
              <span key={s.id} className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">
                {s.name}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-1 text-sm text-gray-500">No solutions configured — everything is treated as unavailable.</p>
        )}
      </div>

      {profile.services && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Services</p>
          <p className="mt-1 text-sm text-gray-600">{profile.services}</p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <List label="Industries served" items={profile.industries_served} />
        <List label="Technologies" items={profile.technologies} />
        <List label="Solution types" items={profile.solution_types} />
        <List label="Preferred industries" items={profile.preferred_industries} />
        <List label="Preferred locations" items={profile.preferred_locations} />
        {profile.preferred_problem_categories?.length > 0 && (
          <List label="Preferred problems" items={profile.preferred_problem_categories.map(problemLabel)} />
        )}
      </div>
    </div>
  );
}

function fmt(n) {
  return Number(n).toLocaleString();
}