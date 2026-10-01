import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Transactional email over SMTP (works with any provider: Gmail app password,
 * Brevo, Mailgun, SES, Zoho, ...). Configure with:
 *   SMTP_HOST, SMTP_PORT (587), SMTP_SECURE (1 for port 465), SMTP_USER,
 *   SMTP_PASS, MAIL_FROM ("OpportunityOS <no-reply@yourdomain.com>")
 *
 * sendMail NEVER throws and never claims a send that didn't happen: callers
 * (forgot-password in particular) must not reveal whether an address exists, so
 * delivery problems are logged server-side only.
 *
 *   - MAIL_CAPTURE_DIR (non-production only): write each message to a JSON file
 *     instead of sending — how the end-to-end tests read their links.
 *   - no SMTP in development: the message (with its link) is printed to the
 *     server console so you can click it.
 *   - no SMTP in production: nothing is sent and an error is logged. The
 *     message body is NOT logged there, because it contains a live token.
 */

let transporter;

export function mailConfigured() {
  return Boolean(process.env.SMTP_HOST);
}

async function getTransporter() {
  if (transporter) return transporter;
  const nodemailer = (await import('nodemailer')).default;
  const port = Number(process.env.SMTP_PORT || 587);
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE === '1' || port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return transporter;
}

export async function sendMail({ to, subject, text }) {
  const isProd = process.env.NODE_ENV === 'production';
  try {
    const captureDir = !isProd && process.env.MAIL_CAPTURE_DIR;
    if (captureDir) {
      fs.mkdirSync(captureDir, { recursive: true });
      const file = path.join(captureDir, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.json`);
      fs.writeFileSync(file, JSON.stringify({ to, subject, text }, null, 2));
      return { sent: true, captured: true };
    }
    if (!mailConfigured()) {
      if (isProd) {
        console.error(`[mail] SMTP_HOST is not set — email "${subject}" to ${to} was NOT sent`);
      } else {
        console.log(`\n[mail:dev] SMTP not configured — would send:\nTo: ${to}\nSubject: ${subject}\n\n${text}\n`);
      }
      return { sent: false };
    }
    const t = await getTransporter();
    await t.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER || 'no-reply@localhost',
      to,
      subject,
      text,
    });
    return { sent: true };
  } catch (err) {
    console.error(`[mail] failed to send "${subject}" to ${to}:`, err?.message || err);
    return { sent: false };
  }
}

export function appUrl() {
  return (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}
