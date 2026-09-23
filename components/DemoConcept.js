'use client';

import { useState } from 'react';

export default function DemoConcept({ opportunityId, disabledReason }) {
  const [spec, setSpec] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function generate() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/opportunities/${opportunityId}/demo-spec`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    const data = await res.json();
    setBusy(false);
    if (!data.ok) return setError(data.error);
    setSpec(data.spec);
  }

  if (!spec) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-gray-600">
          Generate a concept demo — a detailed specification of what to build and walk
          the business through. Includes recommended pages, features, a step-by-step
          walkthrough, sample data, and customization points. Clearly labeled as a
          concept demo, not the prospect&apos;s existing system.
        </p>
        {disabledReason && (
          <p className="rounded bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{disabledReason}</p>
        )}
        <button onClick={generate} disabled={busy || Boolean(disabledReason)}
          title={disabledReason || undefined}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500 disabled:hover:bg-gray-300">
          {busy ? 'Generating…' : 'Generate concept demo'}
        </button>
        {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-5 text-sm">
      {/* CONCEPT DEMO banner */}
      <div className="rounded-lg border-2 border-dashed border-amber-400 bg-amber-50 p-4">
        <p className="text-xs font-bold uppercase tracking-wider text-amber-700">Concept Demo</p>
        <p className="mt-1 text-base font-semibold text-gray-900">{spec.demo_name}</p>
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-500">
          {spec.industry && <span className="rounded bg-gray-100 px-2 py-0.5">{spec.industry}</span>}
          {spec.business_name && <span className="rounded bg-gray-100 px-2 py-0.5">{spec.business_name}</span>}
          {spec.recommended_solution && <span className="rounded bg-indigo-50 px-2 py-0.5 text-indigo-700">{spec.recommended_solution}</span>}
          {spec._ai_enhanced && <span className="rounded bg-purple-50 px-2 py-0.5 text-purple-700">AI enhanced</span>}
        </div>
      </div>

      {/* Problem addressed */}
      {spec.problem_addressed && (
        <div>
          <p className="font-medium text-gray-900">Problem addressed</p>
          <p className="mt-1 text-gray-600">{spec.problem_addressed}</p>
        </div>
      )}

      {/* Recommended pages */}
      {spec.pages?.length > 0 && (
        <div>
          <p className="font-medium text-gray-900">Recommended pages</p>
          <div className="mt-2 space-y-2">
            {spec.pages.map((page, i) => (
              <div key={i} className="rounded border border-gray-100 bg-gray-50 px-3 py-2">
                {typeof page === 'string' ? (
                  <p className="font-medium text-gray-800">{page}</p>
                ) : (
                  <>
                    <p className="font-medium text-gray-800">{page.name}</p>
                    {page.description && <p className="text-xs text-gray-500">{page.description}</p>}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Features */}
      {spec.features?.length > 0 && (
        <div>
          <p className="font-medium text-gray-900">Features to demonstrate</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-gray-600">
            {spec.features.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
        </div>
      )}

      {/* Walkthrough */}
      {spec.workflow?.length > 0 && (
        <div>
          <p className="font-medium text-gray-900">Demo walkthrough</p>
          <ol className="mt-1 list-decimal space-y-1.5 pl-5 text-gray-600">
            {spec.workflow.map((w, i) => (
              <li key={i} className={i === 0 && spec._concept ? 'italic text-gray-400' : ''}>{w}</li>
            ))}
          </ol>
        </div>
      )}

      {/* Sample data */}
      {spec.sample_data?.length > 0 && (
        <div>
          <p className="font-medium text-gray-900">Sample data</p>
          <p className="text-xs text-amber-600 mb-2">All sample data below is fictional — representative of this industry, not copied from the prospect.</p>
          <div className="space-y-3">
            {spec.sample_data.map((entity, i) => (
              <div key={i} className="rounded border border-gray-100 bg-gray-50 p-3">
                <p className="text-xs font-medium text-gray-500 uppercase">{entity.entity}</p>
                {entity.label && <p className="text-xs text-gray-400 italic mb-2">{entity.label}</p>}
                {entity.records?.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-200">
                          {Object.keys(entity.records[0]).map((k) => (
                            <th key={k} className="px-2 py-1 text-left font-medium text-gray-500">{k}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {entity.records.map((rec, j) => (
                          <tr key={j} className="border-b border-gray-100">
                            {Object.values(rec).map((v, k) => (
                              <td key={k} className="px-2 py-1 text-gray-600">
                                {typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Data structure */}
      {spec.data_structure?.length > 0 && (
        <div>
          <p className="font-medium text-gray-900">Data structure</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {spec.data_structure.map((ds, i) => (
              <div key={i} className="rounded border border-gray-100 bg-gray-50 p-2">
                <p className="text-xs font-medium text-gray-700">{ds.entity}</p>
                <p className="text-xs text-gray-400">
                  {ds.fields.map((f) => `${f.field} (${f.type})`).join(', ')}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Customization points */}
      {spec.customization_points?.length > 0 && (
        <div>
          <p className="font-medium text-gray-900">Customization points</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-gray-600">
            {spec.customization_points.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </div>
      )}

      {/* Disclaimer */}
      {spec._note && (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {spec._note}
        </div>
      )}

      {/* Regenerate */}
      <div className="border-t border-gray-100 pt-3">
        <button onClick={generate} disabled={busy}
          className="text-xs font-medium text-blue-600 hover:underline disabled:opacity-50">
          {busy ? 'Regenerating…' : 'Regenerate concept demo'}
        </button>
      </div>
    </div>
  );
}
