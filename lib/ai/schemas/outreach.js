import { SchemaBuilder, nonEmpty } from './util.js';

/** OUTREACH_AGENT output schema — three WhatsApp variants. */
export const outreachSchema = {
  name: 'outreach',

  describe() {
    return `{
  "short_whatsapp": string (max ~50 words, casual),
  "normal_whatsapp": string (max ~100 words, friendly-professional),
  "professional_whatsapp": string (max ~150 words, formal)
}
Rules: reference ONLY the supplied evidence-backed observations; never invent
numbers, names, results or contact details. Never promise specific financial
results — impact may only be framed as an illustrative possibility.`;
  },

  validate(data) {
    const b = new SchemaBuilder(this.name);
    if (!b.require(data && typeof data === 'object', 'response must be a JSON object')) return b.result(null);

    const value = {};
    for (const key of ['short_whatsapp', 'normal_whatsapp', 'professional_whatsapp']) {
      if (!b.require(nonEmpty(data[key], 4000), `${key} is required`)) return b.result(null);
      value[key] = String(data[key]).slice(0, 4000);
    }
    return b.result(value);
  },
};
