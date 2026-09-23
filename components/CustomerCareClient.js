'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import '@/lib/csrf-client';

export default function CustomerCareClient() {
  const [contacts, setContacts] = useState(null);
  const [accounts, setAccounts] = useState(null);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(() => {
    return Promise.all([
      fetch('/api/admin/customer-care', { headers: { Accept: 'application/json' } }),
      fetch('/api/admin/accounts', { headers: { Accept: 'application/json' } }),
    ])
      .then(async ([a, b]) => ({
        c: await a.json().catch(() => null),
        accts: await b.json().catch(() => null),
      }))
      .then(({ c, accts }) => {
        if (c?.ok) setContacts(c.contacts);
        else setError(c?.error || 'Failed to load contacts');
        if (accts?.ok) setAccounts(accts.accounts);
      })
      .catch(() => setError('Failed to load'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function saveContact(e, contact) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    const fd = new FormData(e.currentTarget);
    const payload = {
      reach_out: fd.get('reach_out') === 'on',
    };
    const url = contact
      ? `/api/admin/customer-care/${contact.id}`
      : '/api/admin/customer-care';
    if (!contact) payload.account_id = Number(fd.get('account_id'));
    for (const k of ['name', 'role', 'email', 'phone', 'notes']) {
      payload[k] = (fd.get(k) || '').trim() || null;
    }
    setBusyId(contact ? contact.id : 'new');
    try {
      const res = await fetch(url, {
        method: contact ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || 'Request failed');
      setMessage(contact ? `Contact for ${payload.name} updated.` : `Contact for ${payload.name} added.`);
      setShowForm(false);
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(contact) {
    if (!window.confirm(`Remove the ${contact.name} contact record?`)) return;
    setBusyId(contact.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/customer-care/${contact.id}`, { method: 'DELETE' });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || 'Request failed');
      setMessage(`Contact removed.`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  const sorted = useMemo(() => {
    if (!contacts) return [];
    return [...contacts].sort((a, b) => {
      if (a.reach_out !== b.reach_out) return b.reach_out ? 1 : -1;
      return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
    });
  }, [contacts]);

  if (error && !contacts) return <p className="text-sm text-red-600">{error}</p>;
  if (!contacts) return <p className="text-sm text-gray-400">Loading contacts…</p>;

  const pending = contacts.filter((c) => c.reach_out);

  return (
    <div className="space-y-6">
      {message && <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{message}</p>}
      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {showForm && (
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-900">Add a contact</h2>
          <ContactForm accounts={accounts} onSubmit={(e) => saveContact(e, null)} onCancel={() => setShowForm(false)} busy={busyId === 'new'} />
        </section>
      )}

      {!showForm && (
        <button onClick={() => setShowForm(true)} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800">
          Record a contact
        </button>
      )}

      {pending.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">{pending.length} contact{pending.length === 1 ? '' : 's'} flagged for follow-up.</p>
        </div>
      )}

      <section className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-900">Contacts ({contacts.length})</h2>
        <div className="mt-3 space-y-3">
          {sorted.map((c) => (
            <div key={c.id} className={`rounded-lg border p-4 ${c.reach_out ? 'border-amber-300 bg-amber-50/40' : 'border-gray-200'}`}>
              {editingId === c.id ? (
                <ContactForm
                  accounts={accounts}
                  contact={c}
                  onSubmit={(e) => saveContact(e, c)}
                  onCancel={() => setEditingId(null)}
                  busy={busyId === c.id}
                />
              ) : (
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">
                      {c.name}
                      {c.reach_out && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">reach out</span>}
                    </p>
                    <p className="text-xs text-gray-500">
                      {c.account_name} <span className="text-gray-400">#{c.account_id}</span>
                      {c.role ? ` · ${c.role}` : ''}
                    </p>
                    {(c.email || c.phone) && (
                      <p className="mt-1 text-xs text-gray-600">
                        {c.email && <span className="mr-3">{c.email}</span>}
                        {c.phone && <span>{c.phone}</span>}
                      </p>
                    )}
                    {c.notes && <p className="mt-1 text-sm whitespace-pre-wrap text-gray-700">{c.notes}</p>}
                    <p className="mt-1 text-[11px] text-gray-400">Updated {new Date(c.updated_at).toLocaleString()}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button onClick={() => setEditingId(c.id)} disabled={busyId === c.id} className="text-xs font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50">
                      Edit
                    </button>
                    <button onClick={() => remove(c)} disabled={busyId === c.id} className="text-xs font-semibold text-red-600 hover:text-red-800 disabled:opacity-50">
                      {busyId === c.id ? '…' : 'Remove'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {sorted.length === 0 && <p className="text-sm text-gray-400">No contacts recorded yet.</p>}
        </div>
      </section>
    </div>
  );
}

function ContactForm({ accounts, contact = null, onSubmit, onCancel, busy }) {
  return (
    <form onSubmit={onSubmit} className="mt-3 space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        {!contact && (
          <select name="account_id" required className={inputCls}>
            <option value="">Select account…</option>
            {(accounts || []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} (#{a.id})
              </option>
            ))}
          </select>
        )}
        <input name="name" required maxLength={120} defaultValue={contact?.name || ''} placeholder="Contact name" className={inputCls} />
        <input name="role" maxLength={80} defaultValue={contact?.role || ''} placeholder="Role (e.g. Owner, Billing)" className={inputCls} />
        <input name="email" type="email" maxLength={255} defaultValue={contact?.email || ''} placeholder="Email" className={inputCls} />
        <input name="phone" maxLength={40} defaultValue={contact?.phone || ''} placeholder="Phone" className={inputCls} />
      </div>
      <textarea name="notes" rows={2} defaultValue={contact?.notes || ''} placeholder="Notes (context for the next conversation)" className={inputCls} />
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input name="reach_out" type="checkbox" defaultChecked={contact?.reach_out === true} className="h-4 w-4 rounded border-gray-300" />
        Flag for follow-up (keep this contact on top of the list)
      </label>
      <div className="flex gap-3">
        <button type="submit" disabled={busy} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50">
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
          Cancel
        </button>
      </div>
    </form>
  );
}

const inputCls = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none';