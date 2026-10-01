import { requireSuperadmin, jsonOk, HttpError, handleRouteError, readJson } from '@/lib/api-helpers';
import {
  findByEmail, setAdminOtpPending, setAdminOtp, clearAdminOtp, adminBackupCodes,
} from '@/lib/admin-auth';
import { generateSecret, totpUri, validateTotp, generateBackupCodes, hashBackupCodes, findBackupCode } from '@/lib/totp';
import { audit } from '@/lib/audit';
import { enforce } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// Admin two-factor lifecycle — same TOTP primitives (lib/totp.js) as the tenant
// flow at /api/settings/2fa, but bound to the SEPARATE admin_users identity and
// gated by requireSuperadmin().
//   generate -> issues a pending secret + otpauth URI (nothing stored as live)
//   enable   -> verifies a TOTP code against the pending secret, stores it,
//               returns the one-time backup codes
//   disable  -> verifies a current code (or backup code) against the live secret,
//               then removes 2FA
export async function POST(request) {
  try {
    enforce(request, { limit: 10, windowMs: 15 * 60_000, key: 'admin-2fa' });
    const admin = await requireSuperadmin();
    const full = await findByEmail(admin.email);
    if (!full) throw new HttpError(401, 'Administrator sign-in required');

    const body = await readJson(request);
    const action = String(body.action || '');

    if (action === 'generate') {
      if (full.otp_enabled) throw new HttpError(400, 'Two-factor authentication is already enabled');
      const secret = generateSecret();
      await setAdminOtpPending(admin.id, secret);
      return jsonOk({ secret, uri: totpUri(secret, 'OpportunityOS Control Room', full.email) });
    }

    if (action === 'enable') {
      if (full.otp_enabled) throw new HttpError(400, 'Two-factor authentication is already enabled');
      if (!full.otp_pending_secret) throw new HttpError(400, 'Generate a secret first');
      const code = String(body.code || '').trim();
      if (!validateTotp(full.otp_pending_secret, code)) {
        throw new HttpError(400, 'Invalid code — check the time in your authenticator app and try again');
      }
      const backupCodes = generateBackupCodes();
      await setAdminOtp(admin.id, { secret: full.otp_pending_secret, backupCodes: hashBackupCodes(backupCodes) });
      await audit('admin.2fa_enabled', {
        entity_type: 'admin', entity_id: admin.id,
        admin_user_id: admin.id,
        metadata: { backup_codes: String(backupCodes.length) },
      });
      return jsonOk({ enabled: true, backupCodes });
    }

    if (action === 'disable') {
      if (!full.otp_enabled || !full.otp_secret) throw new HttpError(400, 'Two-factor authentication is not enabled');
      const code = String(body.code || '').trim();
      const validTotp = /^\d{6}$/.test(code) && validateTotp(full.otp_secret, code);
      const validBackup = findBackupCode(adminBackupCodes(full), code) !== -1;
      if (!validTotp && !validBackup) throw new HttpError(400, 'Invalid code — cannot disable two-factor authentication');
      await clearAdminOtp(admin.id);
      await audit('admin.2fa_disabled', { entity_type: 'admin', entity_id: admin.id, admin_user_id: admin.id });
      return jsonOk({ enabled: false });
    }

    throw new HttpError(400, 'Unknown action');
  } catch (err) {
    return handleRouteError(err);
  }
}