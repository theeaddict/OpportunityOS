/**
 * Provenance tagging — makes it obvious, at a glance, what kind of information
 * each part of the Opportunity Detail page is. Server-safe (no "use client").
 */

const TYPES = {
  fact: {
    label: 'Verified fact',
    hint: 'Directly observable from a public source.',
    cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  },
  inference: {
    label: 'AI inference',
    hint: 'A reasonable conclusion drawn from facts — reasonable but not certain.',
    cls: 'bg-amber-50 text-amber-700 ring-amber-200',
  },
  hypothesis: {
    label: 'Hypothesis',
    hint: 'A plausible explanation that still needs confirmation.',
    cls: 'bg-violet-50 text-violet-700 ring-violet-200',
  },
  assumption: {
    label: 'Financial assumption',
    hint: 'An input you or the engine assumed — not a measured figure.',
    cls: 'bg-sky-50 text-sky-700 ring-sky-200',
  },
  estimate: {
    label: 'Estimated project value',
    hint: 'What implementing the solution might cost — a configured estimate, not a quotation.',
    cls: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  },
  impact: {
    label: 'Potential business impact',
    hint: 'An illustrative, scenario-driven figure — not a forecast or promise.',
    cls: 'bg-rose-50 text-rose-700 ring-rose-200',
  },
};

export function ProvenanceTag({ type }) {
  const t = TYPES[type];
  if (!t) return null;
  return (
    <span title={t.hint}
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ${t.cls}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {t.label}
    </span>
  );
}

export function ProvenanceLegend() {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">How to read this page</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {Object.entries(TYPES).map(([key, t]) => (
          <span key={key} title={t.hint}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium ring-1 ${t.cls}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {t.label}
          </span>
        ))}
      </div>
      <p className="mt-2 text-xs text-gray-500">
        Each section below is labeled so you can always tell verified facts from AI inference,
        hypotheses, assumptions, estimates and illustrative impact — nothing is presented as
        more certain than it is.
      </p>
    </div>
  );
}
