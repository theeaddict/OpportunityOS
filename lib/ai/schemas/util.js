/** Shared validation helpers for AI output schemas. */

export const isStr = (v) => typeof v === 'string';
export const nonEmpty = (v, max = 5000) => isStr(v) && v.trim().length > 0 && v.length <= max;
export const optStr = (v, max = 2000) => (isStr(v) ? v.slice(0, max) : null);
export const strArray = (v, { maxItems = 50, maxLen = 500 } = {}) => {
  if (!Array.isArray(v)) return null;
  return v.filter((x) => isStr(x) && x.trim()).map((x) => x.trim().slice(0, maxLen)).slice(0, maxItems);
};
export const num01 = (v, fallback = 0.5) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
};
export const num100 = (v, fallback = null) => {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : fallback;
};
export const idRef = (v, allowed = null) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) return null;
  if (allowed && !allowed.has(n)) return null;
  return n;
};

export class SchemaBuilder {
  constructor(name) {
    this.name = name;
    this.errors = [];
  }
  require(cond, msg) {
    if (!cond) this.errors.push(msg);
    return cond;
  }
  result(value) {
    return this.errors.length ? { ok: false, errors: this.errors } : { ok: true, value };
  }
}
