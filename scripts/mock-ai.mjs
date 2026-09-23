/**
 * Mock OpenAI-compatible /v1/chat/completions server used by the local E2E suite.
 *
 * Routes agent calls by the system-prompt marker ("You are the X_AGENT") and
 * returns schema-valid JSON for each agent. A control endpoint lets the test
 * force failure modes:
 *
 *   POST /ctl {"mode":"valid"|"invalid_json"|"http_500"|"no_strong"}
 *   GET  /ctl
 *
 * Modes:
 *   valid        default — schema-valid JSON per agent
 *   invalid_json — content that cannot parse as JSON (tests repair + failure path)
 *   http_500     — the model API returns HTTP 500 (tests transient retry + fail)
 *   no_strong    — OPPORTUNITY_ANALYST_AGENT returns NO_STRONG_OPPORTUNITY
 *
 * Run: node scripts/mock-ai.mjs   (MOCK_AI_PORT env, default 4321)
 */

import http from 'node:http';

const PORT = Number(process.env.MOCK_AI_PORT || 4321);
const state = { mode: 'valid' };

function send(res, status, body) {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(data);
}

function bodyJson(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); }
    });
  });
}

/** Pull numeric ids out of the prompt text (evidence ids: "id": N; solution ids: solution_id=N). */
function extractIds(text, mode) {
  const ids = [];
  if (mode === 'solutions') {
    const re = /solution_id=(\d+)/g;
    let m;
    while ((m = re.exec(text))) ids.push(Number(m[1]));
  } else {
    const re = /"id"\s*:\s*(\d+)/g;
    let m;
    while ((m = re.exec(text))) ids.push(Number(m[1]));
  }
  return [...new Set(ids)];
}

function pickCode(text, mode) {
  return extractIds(text, mode)[0] || 1;
}

function researchResponse(text) {
  const eid = extractIds(text, 'research')[0];
  const cite = eid ? [eid] : [];
  return {
    business_model:
      'Sells made-to-order furniture to households, hotels and offices. Orders are taken by phone and WhatsApp, with no online checkout observed.',
    products: ['Made-to-order furniture', 'Furniture finishing services'],
    services: ['Custom furniture design', 'Local delivery'],
    customer_types: ['Local households', 'Hotels', 'Offices'],
    sales_channels: ['Showroom', 'WhatsApp', 'Facebook page'],
    ordering_channels: ['Phone', 'WhatsApp'],
    booking_channels: ['unknown'],
    delivery_model: 'local delivery offered',
    wholesale_model: 'unknown',
    operational_signals: cite.length
      ? [{
          signal: 'manual_ordering_channel',
          interpretation: 'Orders arrive conversationally by WhatsApp/phone rather than through a structured flow',
          claim_type: 'FACT',
          evidence_ids: cite,
        }]
      : [],
    business_maturity_signals: cite.length
      ? [{
          signal: 'established_history',
          assessment: 'Existing local furniture business with published contact details',
          evidence_ids: cite,
        }]
      : [],
    facts: cite.length
      ? [{
          text: 'The business publishes a WhatsApp number for customers and reports taking furniture orders by phone and message.',
          evidence_ids: cite,
          confidence: 0.85,
        }]
      : [],
    inferences: [],
    unknowns: ['Average order value', 'Number of orders per month', 'Any wholesale or export customers'],
  };
}

function analystResponse(text, noStrong) {
  if (noStrong) {
    return {
      status: 'NO_STRONG_OPPORTUNITY',
      problem: null,
      opportunity: null,
      why_it_matters: null,
      money_mechanism: null,
      money_mechanism_key: null,
      evidence_support: null,
      uncertain: null,
      required_assumptions: [],
      confidence: 0.15,
      evidence_ids: [],
      reasoning_summary: 'The linked evidence is not sufficient to confirm this opportunity with confidence.',
    };
  }
  const ids = extractIds(text, 'analyst');
  return {
    status: 'OPPORTUNITY_FOUND',
    problem:
      'Furniture orders are collected manually over WhatsApp and phone, so replies are slow outside working hours and no order history is kept.',
    opportunity:
      'Centralize incoming WhatsApp/phone orders into a simple pipeline with status tracking so every enquiry is captured and fulfilled.',
    why_it_matters:
      'Conversational order taking loses enquiry details, slows responses and leaves no record to follow up on.',
    money_mechanism_key: 'faster_order_processing',
    money_mechanism:
      'Process and fulfill more orders per month by removing manual order-taking overhead across WhatsApp, phone and showroom channels.',
    evidence_support:
      'Evidence shows the business publishes a WhatsApp number, takes manual orders and has no online ordering channel.',
    uncertain: 'The exact number of orders and average ticket size are not directly measured.',
    required_assumptions: [
      { name: 'orders_per_month', description: 'How many furniture orders arrive per month' },
      { name: 'cost_of_slow_or_error_per_order', description: 'Estimated cost of a slow or errored order' },
    ],
    confidence: 0.72,
    evidence_ids: ids.length ? ids.slice(0, 5) : [1],
    reasoning_summary:
      'A published WhatsApp channel with conversational ordering and no online path indicates measurable processing and fulfilment overhead.',
  };
}

function matchingResponse(text) {
  const ids = extractIds(text, 'solutions');
  const recommended = ids[0];
  const alternatives = ids.slice(1, Math.min(3, ids.length));
  return {
    recommended_solution: {
      solution_id: recommended,
      fit_reason:
        'Directly addresses manual order taking for a furniture business; strong problem and commercial fit.',
    },
    alternative_solutions: alternatives.map((id) => ({
      solution_id: id,
      fit_reason: 'Reasonable secondary fit covering related order management needs.',
    })),
    fit_score: 82,
  };
}

function outreachResponse() {
  return {
    short_whatsapp:
      'Hi! Noticed you take furniture orders over WhatsApp. I build simple systems that organise incoming orders so nothing slips between calls. Happy to show you a quick demo, no pressure.',
    normal_whatsapp:
      'Hi, I was looking at how you take furniture orders by phone and WhatsApp. Right now a lot of that happens by hand, so enquiries outside working hours can go unanswered.\nI build simple systems that help shops capture the orders they already get, without changing how you work day to day. If useful, I can put together a small demo around this whenever convenient.',
    professional_whatsapp:
      'Hello, I have been examining how your business captures furniture orders across WhatsApp, phone and your showroom. It appears orders are handled conversationally with no structured record, which is typical at this stage.\nA simple order pipeline would preserve every enquiry, speed up responses and give you a clear fulfilment view. Addressing this could, under the assumptions on file, be worth a meaningful uplift \u2014 this is illustrative, not a guarantee.\nShould it be of interest, I would be glad to prepare a short, no-obligation demo.',
  };
}

function demospecResponse() {
  return {
    demo_name: 'Concept Demo — Furniture Store Order Pipeline for Demo Furniture Company',
    pages: ['Dashboard and key metrics', 'Order intake (WhatsApp/phone)', 'Order status board', 'Customer records', 'Reports and owner view'],
    features: ['Central order list across channels', 'Status tracking for every order', 'Customer record and order history', 'Daily sales and fulfilment summary'],
    workflow: [
      'Open the concept demo and land on the Dashboard',
      'Walk through capturing an incoming WhatsApp order into the intake screen',
      'Show the order status board as the order moves from inquiry to fulfilment',
      'Review the day summary and reports',
      'Discuss setup, training and timeline',
    ],
    sample_entities: [
      { name: 'Sample furniture orders', description: 'Clearly fictional order records representing a typical day' },
    ],
    customization_points: [
      'Use their actual product catalogue and pricing',
      'Configure the order statuses to match their workflow',
      'Apply their branding (logo, colours, name)',
    ],
  };
}

function responseForAgent(agent, text) {
  switch (agent) {
    case 'BUSINESS_RESEARCH_AGENT':
      return researchResponse(text);
    case 'OPPORTUNITY_ANALYST_AGENT':
      return analystResponse(text, state.mode === 'no_strong');
    case 'SOLUTION_MATCHING_AGENT':
      return matchingResponse(text);
    case 'OUTREACH_AGENT':
      return outreachResponse();
    case 'DEMO_SPEC_AGENT':
      return demospecResponse();
    default:
      return { ok: false, note: 'unknown agent marker' };
  }
}

const AGENT_MARKERS = {
  BUSINESS_RESEARCH_AGENT: 'You are the BUSINESS_RESEARCH_AGENT',
  OPPORTUNITY_ANALYST_AGENT: 'You are the OPPORTUNITY_ANALYST_AGENT',
  SOLUTION_MATCHING_AGENT: 'You are the SOLUTION_MATCHING_AGENT',
  OUTREACH_AGENT: 'You are the OUTREACH_AGENT',
  DEMO_SPEC_AGENT: 'You are the DEMO_SPEC_AGENT',
};

function detectAgent(messages) {
  const blob = (messages || [])
    .map((m) => (m && (m.content || '')).toLowerCase())
    .join('\n');
  for (const [agent, marker] of Object.entries(AGENT_MARKERS)) {
    if (blob.includes(marker.toLowerCase())) return agent;
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

    if (url.pathname === '/ctl') {
      if (req.method === 'GET') return send(res, 200, { ok: true, mode: state.mode });
      const b = await bodyJson(req);
      if (b.mode && ['valid', 'invalid_json', 'http_500', 'no_strong'].includes(b.mode)) state.mode = b.mode;
      return send(res, 200, { ok: true, mode: state.mode });
    }

    if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
      const body = await bodyJson(req);
      const text = (body.messages || []).map((m) => String(m.content || '')).join('\n');

      let agent = detectAgent(body.messages);
      if (!agent) {
        agent = text.includes('repair') ? 'UNKNOWN' : null;
      }

      if (state.mode === 'http_500') {
        console.log(`[mock-ai] 500 ${agent}`);
        return send(res, 500, { error: 'mock model API outage' });
      }

      const content = state.mode === 'invalid_json'
        ? 'not a json object { actually broken'
        : JSON.stringify(responseForAgent(agent, text));

      console.log(`[mock-ai] ${state.mode} ${agent || 'unknown'} (${String(content).length} chars)`);
      return send(res, 200, {
        id: 'chatcmpl-mock',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: body.model || 'e2e-mock-model',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
    }

    return send(res, 404, { error: 'not found' });
  } catch (err) {
    console.error('[mock-ai] error:', err);
    if (!res.headersSent) return send(res, 500, { error: String(err.message || err) });
    res.end();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-ai] listening on http://127.0.0.1:${PORT} (mode=${state.mode})`);
});