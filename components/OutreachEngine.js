'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const LIFECYCLE_LABEL = {
  generated: 'Generated (needs review)',
  approved: 'Approved',
  contacted: 'Contacted',
  replied: 'Replied',
  demo: 'Demo shown',
  proposal: 'Proposal sent',
  won: 'Won',
  lost: 'Lost',
  opted_out: 'Opted out',
};

const LIFECYCLE_STYLE = {
  generated: 'bg-gray-100 text-gray-600',
  approved: 'bg-emerald-50 text-emerald-700',
  contacted: 'bg-blue-50 text-blue-700',
  replied: 'bg-violet-50 text-violet-700',
  demo: 'bg-indigo-50 text-indigo-700',
  proposal: 'bg-fuchsia-50 text-fuchsia-700',
  won: 'bg-green-100 text-green-800',
  lost: 'bg-red-50 text-red-700',
  opted_out: 'bg-gray-200 text-gray-500',
};

export default function OutreachEngine({ opportunityId, initialMessages = [], hasContact, disabledReason }) {
  const router = useRouter();
  const [messages, setMessages] = useState(initialMessages);
  const [drafts, setDrafts] = useState(() =>
    Object.fromEntries(initialMessages.map((m) => [m.id, m.message_text])));
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState(null);

  async function call(url, body) {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  function show(kind, text) {
    setNotice({ kind, text });
  }

  async function generate() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/outreach`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Generation failed');
      show('success', '3 personalized messages generated — review, edit and approve before contacting.');
      router.refresh();
    } catch (err) {
      show('error', err.message);
    } finally {
      setBusy(false);
    }
  }

  async function patch(id, body, okText) {
    setBusyId(id);
    setNotice(null);
    const data = await call(`/api/outreach/${id}`, body);
    setBusyId(null);
    if (!data.ok) {
      show('error', data.error || 'Request failed');
      return;
    }
    if (okText) show('success', okText);
    router.refresh();
  }

  async function save(id) {
    await patch(id, { message_text: drafts[id] }, 'Changes saved.');
  }

  async function approve(id) {
    await patch(id, { approved: true }, 'Approved — you can now mark it as contacted.');
  }

  async function lifecycle(id, action, okText) {
    await patch(id, { lifecycle_status: action }, okText);
  }

  async function copy(id) {
    try {
      await navigator.clipboard.writeText(drafts[id] || '');
      show('success', 'Copied to clipboard.');
    } catch {
      show('error', 'Could not copy.');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-gray-600">
            Evidence-based, personalized first-touch messages. Nothing is ever sent
            automatically — review, then approve and mark as contacted.
          </p>
          {!hasContact && (
            <p className="mt-1 text-xs text-amber-600">Add a public contact on the business before contacting.</p>
          )}
          {disabledReason && (
            <p className="mt-1 rounded bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{disabledReason}</p>
          )}
        </div>
        <button onClick={generate} disabled={busy || Boolean(disabledReason)}
          title={disabledReason || undefined}
          className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500 disabled:hover:bg-gray-300">
          {busy ? 'Generating…' : 'Generate 3 messages (short · normal · professional)'}
        </button>
      </div>

      {notice && (
        <p className={`rounded-lg px-3 py-2 text-sm ${notice.kind === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
          {notice.text}
        </p>
      )}

      {messages.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-sm text-gray-500">
          No messages yet. Generate three personalized outreach drafts grounded in this
          opportunity&apos;s evidence — every claim in them comes from the evidence list below.
        </p>
      ) : (
        messages.map((m) => {
          const opt = m.lifecycle_status === 'opted_out';
          const approved = Boolean(m.approved);
          const contacted = ['contacted', 'replied', 'demo', 'proposal', 'won', 'lost'].includes(m.lifecycle_status);
          return (
            <div key={m.id} className={`rounded-xl border bg-white p-4 ${opt ? 'border-gray-200 opacity-70' : 'border-gray-200'}`}>
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                <span className="font-semibold uppercase tracking-wide text-gray-600">
                  {String(m.variant || 'whatsapp').replaceAll('_', ' ')}
                </span>
                <span className={`rounded px-1.5 py-0.5 font-semibold ${LIFECYCLE_STYLE[m.lifecycle_status] || LIFECYCLE_STYLE.generated}`}>
                  {LIFECYCLE_LABEL[m.lifecycle_status] || m.lifecycle_status}
                </span>
                {m.approved ? (
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-700">Approved</span>
                ) : (
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-500">Not approved</span>
                )}
                {m.ai_model ? (
                  <span>AI-generated ({m.ai_model}) — review carefully</span>
                ) : (
                  <span>Evidence-based template</span>
                )}
                {opt && <span className="font-semibold text-gray-500">· outreach stopped on opt-out</span>}
              </div>

              <textarea
                value={drafts[m.id]}
                onChange={(e) => setDrafts({ ...drafts, [m.id]: e.target.value })}
                disabled={opt}
                rows={7}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none disabled:bg-gray-50"
              />

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button onClick={() => copy(m.id)}
                  className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">Copy</button>
                <button onClick={() => save(m.id)} disabled={busyId === m.id || opt}
                  className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40">Edit / Save</button>

                {!approved && !opt && (
                  <button onClick={() => approve(m.id)} disabled={busyId === m.id}
                    className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">Approve</button>
                )}

                {!opt && (
                  <button onClick={() => lifecycle(m.id, 'contacted', 'Marked contacted.')}
                    disabled={busyId === m.id || !approved}
                    title={!approved ? 'Approve the message first' : ''}
                    className="rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-40">
                    Mark Contacted
                  </button>
                )}

                {contacted && !opt && (
                  <>
                    <button onClick={() => lifecycle(m.id, 'replied', 'Marked replied.')}
                      disabled={busyId === m.id} className="rounded-lg bg-gray-100 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200">Replied</button>
                    <button onClick={() => lifecycle(m.id, 'demo', 'Marked demo shown.')}
                      disabled={busyId === m.id} className="rounded-lg bg-gray-100 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200">Demo</button>
                    <button onClick={() => lifecycle(m.id, 'proposal', 'Marked proposal sent.')}
                      disabled={busyId === m.id} className="rounded-lg bg-gray-100 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200">Proposal</button>
                    <button onClick={() => lifecycle(m.id, 'won', 'Marked won.')}
                      disabled={busyId === m.id} className="rounded-lg bg-green-100 px-2.5 py-1.5 text-xs font-semibold text-green-800 hover:bg-green-200">Won</button>
                    <button onClick={() => lifecycle(m.id, 'lost', 'Marked lost.')}
                      disabled={busyId === m.id} className="rounded-lg bg-red-100 px-2.5 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-200">Lost</button>
                  </>
                )}

                {!opt && (
                  <button onClick={() => lifecycle(m.id, 'opted_out', 'Opt-out recorded — outreach stopped.')}
                    disabled={busyId === m.id}
                    className="ml-auto rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50">Opt out</button>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
