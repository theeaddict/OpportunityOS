import { createToken } from '@/lib/repositories/auth-tokens';
import { sendMail, appUrl } from '@/lib/mail';

export const RESET_TTL_MINUTES = 60;
export const VERIFY_TTL_MINUTES = 60 * 24 * 3;

/** Emails a password-reset link. Never throws; returns nothing the caller could use to probe an address. */
export async function sendPasswordResetEmail(user) {
  try {
    const token = await createToken(user.id, 'password_reset', RESET_TTL_MINUTES);
    await sendMail({
      to: user.email,
      subject: 'Reset your OpportunityOS password',
      text:
        `Hi ${user.name || 'there'},\n\n` +
        `Someone asked to reset the password for this OpportunityOS account. ` +
        `Use this link within ${RESET_TTL_MINUTES} minutes:\n\n` +
        `${appUrl()}/reset-password?token=${token}\n\n` +
        `If you didn't ask for this, ignore this email — your password stays the same.`,
    });
  } catch (err) {
    console.error('[auth-emails] password reset email failed', err?.message || err);
  }
}

export async function sendVerificationEmail(user) {
  try {
    const token = await createToken(user.id, 'email_verify', VERIFY_TTL_MINUTES);
    await sendMail({
      to: user.email,
      subject: 'Verify your OpportunityOS email',
      text:
        `Hi ${user.name || 'there'},\n\n` +
        `Confirm this is your email address by opening:\n\n` +
        `${appUrl()}/verify-email?token=${token}\n\n` +
        `The link works for 3 days. If you didn't create an OpportunityOS account, ignore this email.`,
    });
  } catch (err) {
    console.error('[auth-emails] verification email failed', err?.message || err);
  }
}
