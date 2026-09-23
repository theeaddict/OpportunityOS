/**
 * Mock BusinessResearchProvider (RESEARCH_PROVIDER=http) for the local E2E suite.
 *
 * Receives POST /research from the app and returns structured findings for the
 * controlled "Demo Furniture Company" scenario. Findings use the signal keys the
 * rules analyzer maps to the `manual_ordering` problem, plus an explicitly
 * published WhatsApp number so the verified-contact path can be tested.
 *
 * Control: POST /ctl {"mode":"ok"|"fail"}
 *    ok    — schema-valid findings
 *    fail  — HTTP 500 (tests the "Research provider failed" 502 path)
 *
 * Run: node scripts/mock-research.mjs   (MOCK_RESEARCH_PORT env, default 4322)
 */

import http from 'node:http';

const PORT = Number(process.env.MOCK_RESEARCH_PORT || 4322);
const state = { mode: 'ok' };

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
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

function findings() {
  return [
    {
      signal_key: 'phone_whatsapp_published',
      evidence_type: 'listing_detail',
      claim_type: 'FACT',
      text: 'Demo Furniture Company publishes a WhatsApp number (+254700000999) on its Facebook page and Google listing for receiving furniture orders.',
      excerpt_summary: 'WhatsApp number published for customer orders',
      source_name: 'Facebook page (fictional, for testing)',
      source_url: 'https://facebook.com/fictional/demo-furniture-company',
      confidence: 0.9,
      whatsapp_number: '+254700000999',
    },
    {
      signal_key: 'no_online_ordering',
      evidence_type: 'observation',
      claim_type: 'FACT',
      text: 'No online ordering or website checkout was found for Demo Furniture Company; customers order by calling or messaging.',
      excerpt_summary: 'No online ordering path observed',
      source_name: 'Public listing (fictional)',
      source_url: 'https://business.example.test/demo-furniture-company',
      confidence: 0.8,
    },
    {
      signal_key: 'active_social_commerce',
      evidence_type: 'observation',
      claim_type: 'INFERENCE',
      text: 'The business posts furniture pieces with prices to its social profiles and responds to customer interest by DM.',
      excerpt_summary: 'Sells via social media responses',
      source_name: 'Social media review (fictional)',
      source_url: 'https://social.example.test/demo-furniture-company',
      confidence: 0.7,
    },
    {
      signal_key: 'delivery_operations',
      evidence_type: 'observation',
      claim_type: 'INFERENCE',
      text: 'Delivery is mentioned as available within Nairobi and the listing shows a delivery van in photos.',
      excerpt_summary: 'Offers local delivery',
      source_name: 'Public listing (fictional)',
      source_url: 'https://business.example.test/demo-furniture-company',
      confidence: 0.6,
    },
  ];
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

    if (url.pathname === '/ctl') {
      if (req.method === 'GET') return send(res, 200, { ok: true, mode: state.mode });
      const b = await bodyJson(req);
      if (b.mode === 'ok' || b.mode === 'fail') state.mode = b.mode;
      return send(res, 200, { ok: true, mode: state.mode });
    }

    if (url.pathname === '/research' && req.method === 'POST') {
      const body = await bodyJson(req);
      console.log(`[mock-research] mode=${state.mode} business="${body.name}"`);
      if (state.mode === 'fail') {
        return send(res, 500, { error: 'simulated research provider outage' });
      }
      return send(res, 200, {
        findings: findings(),
        pages_fetched: ['https://business.example.test/demo-furniture-company'],
        skipped: [],
      });
    }

    return send(res, 404, { error: 'not found' });
  } catch (err) {
    console.error('[mock-research] error:', err);
    if (!res.headersSent) return send(res, 500, { error: String(err.message || err) });
    res.end();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-research] listening on http://127.0.0.1:${PORT} (mode=${state.mode})`);
});