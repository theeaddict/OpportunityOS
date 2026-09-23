export function isNonEmptyString(v, max = 5000) {
  return typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max;
}

export function optionalString(v, max = 5000) {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length > 0 && s.length <= max ? s : null;
}

export function isEmail(v) {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

export function isUrl(v) {
  if (!v || typeof v !== 'string') return false;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function clampNumber(v, min, max, fallback = null) {
  const n = Number(v);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function confidence(v) {
  return clampNumber(v, 0, 1, 0.5);
}

// Special characters accepted by the password policy (mirrors BiasharaOS
// internal/auth/password.go specialChars — the ~printable ASCII set that's
// neither a letter nor a digit).
const SPECIAL_CHARS = '!@#$%^&*()-_=+[]{}\\|;:\'",.<>/?~`';

// BiasharaOS ValidatePassword parity: >= 8 chars + at least one uppercase,
// one lowercase, one digit and one special character. Returns a human-readable
// message on failure, null when the password satisfies the policy.
export function passwordPolicyError(pw) {
  if (typeof pw !== 'string' || pw.length < 8 || pw.length > 200) {
    return 'Password must be 8-200 characters with uppercase, lowercase, digit and special character';
  }
  if (!/[A-Z]/.test(pw) || !/[a-z]/.test(pw) || !/\d/.test(pw)) {
    return 'Password must be 8-200 characters with uppercase, lowercase, digit and special character';
  }
  if (![...pw].some((c) => SPECIAL_CHARS.includes(c))) {
    return 'Password must be 8-200 characters with uppercase, lowercase, digit and special character';
  }
  return null;
}
