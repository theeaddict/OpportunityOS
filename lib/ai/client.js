/**
 * Low-level AI transport — the ONLY place that talks to a model API.
 *
 * Supports any OpenAI-compatible /chat/completions endpoint (OpenAI, OpenRouter,
 * Groq, vLLM, llama.cpp server, …). Provider identity is configuration, not code.
 *
 * Guarantees:
 *  - timeout on every request (AI_TIMEOUT_MS, default 60s)
 *  - transient failures (network, 408/429/5xx) retried with backoff
 *  - JSON extraction tolerant of code fences
 *  - secrets are NEVER logged: only model name / status codes appear in errors
 *
 * Environment:
 *   AI_API_KEY    bearer token (required)
 *   AI_MODEL      model name (required)
 *   AI_BASE_URL   default https://api.openai.com/v1
 *   AI_TIMEOUT_MS default 60000
 */

const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export function isConfigured() {
  return Boolean(process.env.AI_API_KEY && process.env.AI_MODEL);
}

export function providerConfig() {
  const configured = isConfigured();
  return {
    configured,
    // Never include the API key here.
    baseUrl: configured ? process.env.AI_BASE_URL || 'https://api.openai.com/v1' : null,
    model: process.env.AI_MODEL || null,
    timeoutMs: Number(process.env.AI_TIMEOUT_MS || 60_000),
  };
}

export class AiTransportError extends Error {
  constructor(message, { status = null, transient = false } = {}) {
    super(message);
    this.name = 'AiTransportError';
    this.status = status;
    this.transient = transient;
  }
}

/**
 * Execute a chat completion with retries. Returns raw text content.
 */
export async function complete({ system, user, json = true, temperature = 0.2 }) {
  const cfg = providerConfig();
  if (!cfg.configured) throw new AiTransportError('AI not configured');

  const maxAttempts = 3;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.AI_API_KEY}`,
        },
        body: JSON.stringify({
          model: cfg.model,
          temperature,
          ...(json ? { response_format: { type: 'json_object' } } : {}),
          messages: [
            ...(system ? [{ role: 'system', content: system }] : []),
            { role: 'user', content: user },
          ],
        }),
        signal: AbortSignal.timeout(cfg.timeoutMs),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new AiTransportError(
          `model API responded ${res.status}: ${body.slice(0, 200)}`,
          { status: res.status, transient: TRANSIENT_STATUS.has(res.status) }
        );
      }

      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      if (!text) throw new AiTransportError('empty completion', { transient: true });
      return text;
    } catch (err) {
      lastError = err;
      const transient =
        err instanceof AiTransportError ? err.transient : !(err instanceof SyntaxError);
      if (!transient || attempt === maxAttempts) break;
      await sleep(400 * 2 ** (attempt - 1)); // 400ms, 800ms
    }
  }
  throw lastError instanceof Error ? lastError : new AiTransportError(String(lastError));
}

/** Parse a JSON object out of a model response, tolerating code fences/prose. */
export function parseJsonResponse(text) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    const err = new Error('could not parse JSON from model response');
    err.unparseable = true;
    throw err;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
