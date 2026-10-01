// Usage: node scripts/send-test-email.mjs you@example.com
// Sends one real email through the SMTP_* settings in .env so you can confirm
// delivery works before users depend on it (password reset, verification).
import 'dotenv/config';
import { sendMail, mailConfigured } from '../lib/mail.js';

const to = process.argv[2];
if (!to) {
  console.error('Usage: node scripts/send-test-email.mjs you@example.com');
  process.exit(1);
}
if (!mailConfigured()) {
  console.error('SMTP_HOST is not set in .env — nothing can be sent. See the EMAIL section of .env.example.');
  process.exit(1);
}
const r = await sendMail({
  to,
  subject: 'OpportunityOS test email',
  text: 'If you can read this, your SMTP settings work and password-reset emails will be delivered.',
});
console.log(r.sent ? `Sent to ${to}. Check the inbox (and spam).` : 'NOT sent — see the [mail] error above for the reason.');
process.exit(r.sent ? 0 : 2);
