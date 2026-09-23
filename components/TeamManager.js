'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function TeamManager({ team, canManage, usersLimit, currentUserId }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  async function api(path, method, payload) {
    const res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.ok) router.refresh();
    return data;
  }

  async function addMember(e) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    const f = e.target;
    const data = await api('/api/account', 'POST', {
      name: f.name.value,
      email: f.email.value,
      password: f.password.value,
      role: f.role.value,
    });
    setBusy(false);
    setNotice({ kind: data.ok ? 'ok' : 'err', text: data.ok ? 'Team member added.' : data.error });
    if (data.ok) f.reset();
  }

  async function setRole(m, value) {
    setNotice(null);
    const data = await api(`/api/account/members/${m.id}`, 'PATCH', { role: value });
    if (!data.ok) setNotice({ kind: 'err', text: data.error });
  }

  async function toggleStatus(m) {
    setNotice(null);
    const data = await api(`/api/account/members/${m.id}`, 'PATCH', { status: m.status === 'active' ? 'suspended' : 'active' });
    if (!data.ok) setNotice({ kind: 'err', text: data.error });
  }

  return (
    <div className="space-y-4">
      {notice && <p className={`rounded px-3 py-2 text-sm ${notice.kind === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{notice.text}</p>}

      {canManage ? (
        <form onSubmit={addMember} className="grid gap-3 rounded-xl bg-gray-50 p-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Name</label>
            <input name="name" required maxLength={120} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Email</label>
            <input name="email" type="email" required className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Temporary password</label>
            <input name="password" type="password" required minLength={8} maxLength={72} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
            <p className="mt-1 text-xs text-gray-400">At least 8 characters. Share it securely; there is no password-reset email yet.</p>
          </div>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-gray-600">Role</label>
              <select name="role" defaultValue="member" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <button disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {busy ? 'Adding…' : 'Add member'}
            </button>
          </div>
          {usersLimit != null && (
            <p className="text-xs text-gray-400 sm:col-span-2">
              Plan allows {usersLimit} team members ({team.length} used).
            </p>
          )}
        </form>
      ) : (
        <p className="text-xs text-gray-400">Owners and Admins can invite team members and change roles.</p>
      )}

      {canManage && team.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-400">
                <th className="py-2 pr-4 font-medium">Member</th>
                <th className="py-2 pr-4 font-medium">Role</th>
                <th className="py-2 font-medium">Access</th>
              </tr>
            </thead>
            <tbody>
              {team.map((m) => {
                const isSelf = Number(m.id) === Number(currentUserId);
                const isOwner = m.role === 'owner';
                return (
                  <tr key={m.id} className="border-b border-gray-100">
                    <td className="py-2 pr-4">
                      <p className="font-medium text-gray-900">{m.name}{isSelf ? ' (you)' : ''}</p>
                      <p className="text-xs text-gray-400">{m.email}</p>
                    </td>
                    <td className="py-2 pr-4">
                      {isOwner ? (
                        <span className="text-xs font-medium uppercase tracking-wide text-gray-400">Owner</span>
                      ) : (
                        <select
                          defaultValue={m.role}
                          onChange={(e) => setRole(m, e.target.value)}
                          className="rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
                        >
                          <option value="admin">Admin</option>
                          <option value="member">Member</option>
                        </select>
                      )}
                    </td>
                    <td className="py-2">
                      {isSelf || isOwner ? (
                        <span className={`text-xs capitalize ${m.status === 'active' ? 'text-emerald-600' : 'text-red-500'}`}>{m.status}</span>
                      ) : (
                        <button
                          onClick={() => toggleStatus(m)}
                          disabled={busy}
                          className={`rounded-lg px-3 py-1 text-xs font-semibold ${
                            m.status === 'active'
                              ? 'bg-red-50 text-red-700 hover:bg-red-100'
                              : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          }`}
                        >
                          {m.status === 'active' ? 'Suspend' : 'Activate'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}