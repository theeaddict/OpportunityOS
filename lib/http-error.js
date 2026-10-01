/**
 * Shared HTTP error type. Lives in its own module so identity is guaranteed
 * through re-exports (api-helpers) and imports (admin-auth guards) without
 * creating a circular dependency — `instanceof HttpError` must always match.
 */
export class HttpError extends Error {
  constructor(status, message, opts = {}) {
    super(message);
    this.status = status;
    if (opts.retryAfterMs != null) this.retryAfterMs = opts.retryAfterMs;
  }
}