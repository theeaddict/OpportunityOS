'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// TOTP two-factor lifecycle for PLATFORM ADMINISTRATORS (control room). Same
// primitives as the tenant TwoFactorForm but bound to the separate admin_users
// identity via /api/admin/2fa (gated by requireSuperadmin() server-side).
//   disabled -> generate secret/URI -> verify a code -> show backup codes once
//   enabled  -> disable with a current code (or backup code)
export default function AdminTwoFactorForm({ enabled, email }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [phase, setPhase] = useState(enabled ? 'enabled' : 'idle'); // idle|setup|verify|codes
  const [setup, setSetup] = useState(null); // { secret, uri }
  const [backupCodes, setBackupCodes] = useState([]);
  const [disableCode, setDisableCode] = useState('');

  async function api(action, extra = {}) {
    const res = await fetch('/api/admin/2fa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...extra }),
    });
    return res.json();
  }

  async function startSetup() {
    setBusy(true);
    setNotice(null);
    const data = await api('generate');
    setBusy(false);
    if (!data.ok) { setNotice({ kind: 'err', text: data.error }); return; }
    setSetup({ secret: data.secret, uri: data.uri });
    setPhase('setup');
  }

  async function verify(e) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    const code = String(e.target.code.value || '').trim();
    const data = await api('enable', { code });
    setBusy(false);
    if (!data.ok) { setNotice({ kind: 'err', text: data.error }); return; }
    setBackupCodes(data.backupCodes || []);
    setPhase('codes');
  }

  async function disable(e) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    const data = await api('disable', { code: disableCode });
    setBusy(false);
    if (!data.ok) { setNotice({ kind: 'err', text: data.error }); return; }
    setPhase('idle');
    setDisableCode('');
    setNotice({ kind: 'ok', text: 'Two-factor authentication disabled.' });
    router.refresh();
  }

  if (phase === 'setup' && setup) {
    return (
      <div className="space-y-3 text-sm">
        <ol className="list-decimal space-y-1 pl-5 text-gray-600">
          <li>Open your authenticator app and add <code className="rounded bg-gray-100 px-1">{email}</code> using the secret below.</li>
          <li>Enter the 6-digit code it shows to confirm.</li>
        </ol>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-medium text-gray-600">Manual secret</p>
            <code className="block break-all rounded bg-gray-100 px-2 py-1.5 text-xs">{setup.secret}</code>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-gray-600">Setup key link</p>
            <a href={setup.uri} className="text-red-600 underline">{setup.uri}</a>
          </div>
        </div>
        <form onSubmit={verify} className="flex items-start gap-2">
          <input name="code" inputMode="numeric" pattern="[0-9]*" maxLength={6} required autoComplete="one-time-code"
            placeholder="6-digit code" className="w-40 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none" />
          <button disabled={busy} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50">
            {busy ? 'Verifying…' : 'Verify & enable'}
          </button>
        </form>
        {notice && <p className={`rounded px-3 py-2 text-sm ${notice.kind === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{notice.text}</p>}
      </div>
    );
  }

  if (phase === 'codes') {
    return (
      <div className="space-y-3 text-sm">
        <div className="rounded-xl bg-orange-50 p-4 text-orange-800">
          <p className="font-medium">Two-factor authentication is enabled.</p>
          <p className="mt-1 text-xs">Save these one-time backup codes somewhere safe. Each works only once, and they are your only way back in if you lose your authenticator app.</p>
        </div>
        <ul className="grid grid-cols-2 gap-1 font-mono text-xs sm:grid-cols-3">
          {backupCodes.map((c) => <li key={c} className="rounded bg-gray-100 px-2 py-1">{c}</li>)}
        </ul>
        <button onClick={() => { setPhase('enabled'); router.refresh(); }} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800">Done</button>
      </div>
    );
  }

  if (enabled) {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-emerald-700"><span className="font-medium">Enabled.</span> You will be asked for a 6-digit code at every control-room sign-in.</p>
        <form onSubmit={disable} className="flex items-end gap-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Current code (or backup code)</label>
            <input value={disableCode} onChange={(e) => setDisableCode(e.target.value)} autoComplete="one-time-code"
              className="w-44 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none" />
          </div>
          <button disabled={busy} className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">
            {busy ? 'Disabling…' : 'Disable 2FA'}
          </button>
        </form>
        {notice && <p className={`rounded px-3 py-2 text-sm ${notice.kind === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{notice.text}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      <p className="text-gray-600">
        Protect the control room with a time-based one-time password (TOTP) from an authenticator app.
        Once enabled, sign-in requires both your password and a 6-digit code.
      </p>
      <button onClick={startSetup} disabled={busy} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50">
        {busy ? 'Preparing…' : 'Enable two-factor authentication'}
      </button>
      {notice && <p className={`rounded px-3 py-2 text-sm ${notice.kind === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{notice.text}</p>}
    </div>
  );
}