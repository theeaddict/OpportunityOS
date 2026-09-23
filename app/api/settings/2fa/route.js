import * as usersRepo from '@/lib/repositories/users';
import { requireAccount, jsonOk, HttpError, handleRouteError, readJson } from '@/lib/api-helpers';
import { generateSecret, totpUri, validateTotp, generateBackupCodes, hashBackupCodes, findBackupCode } from '@/lib/totp';
import { audit } from '@/lib/audit';
import { enforce } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

function parseBackupCodes(full) {
  if (Array.isArray(full.otp_backup_codes)) return full.otp_backup_codes;
  try {
    return full.otp_backup_codes ? JSON.parse(full.otp_backup_codes) : [];
  } catch {
    return [];
  }
}

// Two-factor authentication lifecycle (port of BiasharaOS's admin 2FA + totp).
//   generate  -> issues a pending secret + otpauth URI (nothing stored as live)
//   enable    -> verifies a TOTP code against the pending secret, stores it,
//                returns the one-time backup codes
//   disable   -> verifies a current code (or backup code) against the live
//                secret, then removes 2FA
export async function POST(request) {
  try {
    enforce(request, { limit: 10, windowMs: 15 * 60_000, key: '2fa' });
    const user = await requireAccount();
    const full = await usersRepo.findByEmail(user.email);
    if (!full) throw new HttpError(401, 'Not signed in');

    const body = await readJson(request);
    const action = String(body.action || '');

    if (action === 'generate') {
      if (full.otp_enabled) throw new HttpError(400, 'Two-factor authentication is already enabled');
      const secret = generateSecret();
      await usersRepo.setOtpPending(user.id, secret);
      return jsonOk({ secret, uri: totpUri(secret, 'OpportunityOS', full.email) });
    }

    if (action === 'enable') {
      if (full.otp_enabled) throw new HttpError(400, 'Two-factor authentication is already enabled');
      if (!full.otp_pending_secret) throw new HttpError(400, 'Generate a secret first');
      const code = String(body.code || '').trim();
      if (!validateTotp(full.otp_pending_secret, code)) {
        throw new HttpError(400, 'Invalid code — check the time in your authenticator app and try again');
      }
      const backupCodes = generateBackupCodes();
      await usersRepo.setOtp(user.id, { secret: full.otp_pending_secret, backupCodes: hashBackupCodes(backupCodes) });
      await audit('user.2fa_enabled', {
        entity_type: 'user', entity_id: user.id,
        metadata: { backup_codes: String(backupCodes.length) },
      });
      return jsonOk({ enabled: true, backupCodes });
    }

    if (action === 'disable') {
      if (!full.otp_enabled || !full.otp_secret) throw new HttpError(400, 'Two-factor authentication is not enabled');
      const code = String(body.code || '').trim();
      const validTotp = /^\d{6}$/.test(code) && validateTotp(full.otp_secret, code);
      const validBackup = findBackupCode(parseBackupCodes(full), code) !== -1;
      if (!validTotp && !validBackup) throw new HttpError(400, 'Invalid code — cannot disable two-factor authentication');
      await usersRepo.clearOtp(user.id);
      await audit('user.2fa_disabled', { entity_type: 'user', entity_id: user.id });
      return jsonOk({ enabled: false });
    }

    throw new HttpError(400, 'Unknown action');
  } catch (err) {
    return handleRouteError(err);
  }
}