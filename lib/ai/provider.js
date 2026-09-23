/**
 * AI provider abstraction — the single entry point for the rest of the app.
 *
 *   import { aiProvider } from '@/lib/ai/provider';
 *   const result = await aiProvider.generateStructured({ system, user, schema });
 *
 * result:
 *   { ok: true,  data, meta: { model, duration_ms, attempts } }
 *   { ok: false, reason: 'not_configured' | 'invalid' | 'failed', error? , meta }
 *
 * Structured-output contract:
 *   1. call model with JSON mode
 *   2. validate against the agent's schema
 *   3. if invalid -> ONE repair attempt (schema errors fed back to the model)
 *   4. still invalid -> { ok:false, reason:'invalid' } — never fabricate a fallback
 */

import { complete, parseJsonResponse, isConfigured, providerConfig } from './client.js';

export { isConfigured };

export function providerInfo() {
  const cfg = providerConfig();
  return {
    configured: cfg.configured,
    provider: process.env.AI_PROVIDER || (cfg.configured ? 'openai-compatible' : 'none'),
    model: cfg.model,
    base_url: cfg.baseUrl,
  };
}

/**
 * schema: { name, validate(data) -> { ok:true, value } | { ok:false, errors:[string] },
 *           describe() -> string (used for repair instructions) }
 */
export const aiProvider = {
  info: providerInfo,
  isConfigured,

  async generateStructured({ system, user, schema, temperature = 0.2 }) {
    const started = Date.now();
    const metaBase = () => ({
      model: providerConfig().model,
      duration_ms: Date.now() - started,
      attempts: 0,
    });

    if (!isConfigured()) {
      return { ok: false, reason: 'not_configured', error: 'AI_API_KEY / AI_MODEL not set', meta: metaBase() };
    }

    // --- attempt 1 ---
    let raw;
    try {
      raw = await complete({ system, user, json: true, temperature });
    } catch (err) {
      return { ok: false, reason: 'failed', error: String(err.message || err), meta: { ...metaBase(), attempts: 1 } };
    }

    let parsed = safeParse(raw);
    let check = parsed === undefined ? invalid('unparseable JSON') : schema.validate(parsed);
    if (check.ok) {
      return { ok: true, data: check.value, meta: { ...metaBase(), attempts: 1 } };
    }

    // --- repair attempt (exactly one) ---
    const repairUser = [
      'Your previous response was invalid.',
      `Schema "${schema.name}" violations:`,
      ...check.errors.map((e) => `- ${e}`),
      '',
      'Return ONLY corrected JSON that fully satisfies this schema description:',
      schema.describe(),
      '',
      'Your previous response:',
      String(raw).slice(0, 4000),
    ].join('\n');

    try {
      raw = await complete({ system, user: repairUser, json: true, temperature: 0 });
      parsed = safeParse(raw);
      check = parsed === undefined ? invalid('unparseable JSON on repair') : schema.validate(parsed);
      if (check.ok) {
        return { ok: true, data: check.value, meta: { ...metaBase(), attempts: 2, repaired: true } };
      }
      return {
        ok: false, reason: 'invalid',
        error: `schema validation failed after repair: ${check.errors.slice(0, 5).join('; ')}`,
        meta: { ...metaBase(), attempts: 2 },
      };
    } catch (err) {
      return { ok: false, reason: 'failed', error: String(err.message || err), meta: { ...metaBase(), attempts: 2 } };
    }
  },

  /** Free-text generation (rarely used; agents should prefer structured output). */
  async generateText({ system, user, temperature = 0.4 }) {
    const started = Date.now();
    try {
      const text = await complete({ system, user, json: false, temperature });
      return { ok: true, data: text, meta: { model: providerConfig().model, duration_ms: Date.now() - started } };
    } catch (err) {
      return { ok: false, reason: 'failed', error: String(err.message || err), meta: { model: providerConfig().model, duration_ms: Date.now() - started } };
    }
  },
};

function safeParse(raw) {
  try {
    return parseJsonResponse(raw);
  } catch {
    return undefined;
  }
}

function invalid(msg) {
  return { ok: false, errors: [msg] };
}
