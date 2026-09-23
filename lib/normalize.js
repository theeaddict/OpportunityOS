/**
 * Normalization helpers — used for business deduplication and contact hygiene.
 */

const LEGAL_SUFFIXES = new Set([
  'ltd', 'limited', 'llc', 'inc', 'incorporated', 'plc', 'co', 'company',
  'corp', 'corporation',
]);

/**
 * Aggressive business-name normalization for dedup:
 * "Jua Hardware & Building Supplies Ltd" -> "jua hardware building"
 */
export function normalizeBusinessName(name) {
  let n = String(name || '').toLowerCase();
  n = n.replace(/[^\p{L}\p{N}]+/gu, ' ');
  const words = n.split(/\s+/).filter(Boolean);
  const kept = words.filter((w, i) => !(i > 0 && LEGAL_SUFFIXES.has(w)));
  return kept.join(' ').trim();
}

/** Phone -> E.164-style digits with leading '+', e.g. '+254712345678'. */
export function normalizePhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/[^\d+]/g, '');
  const plus = digits.startsWith('+');
  const body = digits.replaceAll('+', '');
  if (!body) return null;
  return `+${body}`;
}

/** URL -> comparable host+path key: lowercase, no protocol, no www, no trailing slash. */
export function normalizeWebsite(url) {
  if (!url) return null;
  let u = String(url).trim().toLowerCase();
  u = u.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
  if (!u) return null;
  // Keep host + path only (strip query/hash which rarely identify the business).
  return u.split('?')[0].split('#')[0];
}

/** Infer a contact_type from a raw value when not supplied. */
export function inferContactType(value, hint) {
  if (hint && ['email','phone','whatsapp','social','website_form','other'].includes(hint)) return hint;
  const v = String(value || '');
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'email';
  if (/^\+?[\d\s()-]{7,}$/.test(v)) return 'phone';
  return 'other';
}

/** Social URL -> { platform, handle, normalized } for dedup and storage. */
export function normalizeSocialHandle(url, platformHint = null) {
  if (!url) return null;
  let u = String(url).trim().toLowerCase();
  u = u.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
  const platforms = [
    ['facebook.com', 'facebook'],
    ['instagram.com', 'instagram'],
    ['tiktok.com', 'tiktok'],
    ['x.com', 'x'], ['twitter.com', 'x'],
    ['linkedin.com', 'linkedin'],
    ['wa.me', 'whatsapp'], ['api.whatsapp.com', 'whatsapp'],
  ];
  let platform = platformHint ? String(platformHint).toLowerCase() : null;
  let path = u;
  if (!platform) {
    for (const [domain, name] of platforms) {
      if (u.includes(domain)) { platform = name; break; }
    }
  }
  if (!platform) return null;
  const match = u.match(/(?:^|\/)(?:@)?([a-z0-9._-]{2,60})\/?$/);
  if (u.includes('wa.me')) {
    const phone = normalizePhone(u.replace(/^.*?wa\.me\//, '+' + ''));
    return phone ? { platform: 'whatsapp', handle: phone, normalized: `whatsapp:${phone}` } : null;
  }
  if (!match) return null;
  path = `${platform}:${match[1]}`;
  return { platform, handle: match[1], normalized: path };
}
