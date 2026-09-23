'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PIPELINE_TRANSITIONS, statusLabel } from '@/lib/constants';

function usePatch(url, method = 'PATCH') {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  async function run(body) {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Request failed');
      router.refresh();
      return data;
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { busy, notice, run };
}

export function AnalyzeControl({ opportunity }) {
  const { busy, notice, run } = usePatch(`/api/opportunities/${opportunity.id}/analyze`, 'POST');
  const [info, setInfo] = useState(null);

  async function analyze() {
    const data = await run();
    if (!data) return;
    if (data.verdict === 'NO_STRONG_OPPORTUNITY') {
      setInfo({ kind: 'info', text: `No strong opportunity in the current evidence: ${data.reasoning || ''}` });
    } else {
      setInfo({
        kind: 'success',
        text: `${data.provider === 'llm' ? 'AI' : 'Rule engine'} analysis complete — scored ${data.opportunity_score}/100 (${data.score_category}).`,
      });
    }
  }

  return (
    <div className="mt-3">
      <button onClick={analyze} disabled={busy}
        className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
        {busy ? 'Analyzing…' : opportunity.analysis_provider === 'none' ? 'Analyze this opportunity' : 'Re-analyze'}
      </button>
      {(notice || info) && (
        <p className={`mt-2 rounded-lg px-3 py-2 text-sm ${(notice?.kind || info?.kind) === 'error' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>
          {(notice?.text || info?.text || '')}
        </p>
      )}
    </div>
  );
}

export function PipelineControl({ opportunity }) {
  const { busy, notice, run } = usePatch(`/api/opportunities/${opportunity.id}`, 'PATCH');
  const transitions = PIPELINE_TRANSITIONS[opportunity.status] || [];

  if (!transitions.length) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-gray-400">
          This opportunity is in a terminal state ({statusLabel(opportunity.status)}).
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="mb-2 text-xs font-medium text-gray-500">Move pipeline stage (records activity history)</p>
        <div className="flex flex-wrap gap-1">
          {transitions.map((status) => (
            <button key={status} onClick={() => run({ status })} disabled={busy}
              className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40">
              {statusLabel(status)}
            </button>
          ))}
        </div>
      </div>
      {notice && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{notice.text}</p>}
    </div>
  );
}
