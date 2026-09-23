/**
 * Mock DiscoveryProvider (DISCOVERY_API_URL) for the local E2E suite.
 *
 * Receives POST {filters} from the app and returns {results:[Candidate]} for a
 * small, clearly-fictional furniture-manufacturing set. Candidates carry
 * contacts + evidence using the signal keys the rules analyzer maps to the
 * manual-ordering problem, so the one-click discovery pipeline has real
 * material to research, analyze, score and match.
 *
 * Control: POST /ctl {"mode":"ok"|"fail"}
 *    ok    — schema-valid candidates
 *    fail  — HTTP 500 (tests the "Discovery provider failed" path)
 *
 * Run: node scripts/mock-discovery.mjs   (MOCK_DISCOVERY_PORT env, default 4323)
 */

import http from 'node:http';

const PORT = Number(process.env.MOCK_DISCOVERY_PORT || 4323);
const state = { mode: 'ok', extras: [] };

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

function evidenceFor(slug) {
  return [
    {
      signal_key: 'phone_whatsapp_published',
      evidence_type: 'listing_detail',
      claim_type: 'FACT',
      text: `Public posts by ${slug} publish a WhatsApp number for taking furniture orders.`,
      excerpt_summary: 'WhatsApp number published for customer orders',
      source_name: 'Facebook page (fictional, for testing)',
      source_url: `https://facebook.com/fictional/${slug}`,
      confidence: 0.85,
    },
    {
      signal_key: 'no_online_ordering',
      evidence_type: 'observation',
      claim_type: 'FACT',
      text: `No online ordering or website checkout was found for ${slug}; customers order by calling or messaging.`,
      excerpt_summary: 'No online ordering path observed',
      source_name: 'Public listing (fictional)',
      source_url: `https://business.example.test/${slug}`,
      confidence: 0.8,
    },
    {
      signal_key: 'active_social_commerce',
      evidence_type: 'observation',
      claim_type: 'INFERENCE',
      text: `${slug} posts furniture pieces with prices to its social profiles and answers interest by DM.`,
      excerpt_summary: 'Sells via social media responses',
      source_name: 'Social media review (fictional)',
      source_url: `https://social.example.test/${slug}`,
      confidence: 0.7,
    },
    {
      signal_key: 'wholesale_operations',
      evidence_type: 'observation',
      claim_type: 'INFERENCE',
      text: `${slug} advertises contractor and bulk-buyer pricing, so wholesale orders are part of its revenue.`,
      excerpt_summary: 'Serves wholesale / contractor buyers',
      source_name: 'Public listing (fictional)',
      source_url: `https://business.example.test/${slug}`,
      confidence: 0.6,
    },
  ];
}

function candidates() {
  const mk = (name, slug, city) => ({
    name,
    industry: 'Furniture manufacturing',
    description: `${name} manufactures and sells furniture, taking orders by phone, WhatsApp and social DMs.`,
    location: city,
    country: 'Kenya',
    phone: '+254700000111',
    socialUrl: `https://www.instagram.com/${slug}`,
    platform: 'instagram',
    contacts: [
      { contact_type: 'whatsapp', contact_value: '+254700000111', verification_status: 'source_published', confidence: 0.9 },
      { contact_type: 'phone', contact_value: '+254700000111', verification_status: 'source_published', confidence: 0.8 },
    ],
    evidence: evidenceFor(slug),
    source: {
      source_type: 'provider_api',
      source_name: 'Mock licensed discovery provider (fictional, for testing)',
      source_url: `https://social.example.test/${slug}`,
      external_identifier: `mock:${slug}`,
    },
  });
  return [
    mk('Fictional Nairobi Furniture Works', 'fictional-nairobi-furniture-works', 'Nairobi'),
    mk('Fictional Mombasa Woodcraft', 'fictional-mombasa-woodcraft', 'Mombasa'),
  ];
}

/**
 * A generic OpenStreetMap-shaped listing candidate — the same shape the built-in
 * osm_overpass / google_places providers emit (`contact_value` on the contact
 * row, `signal_key`-tagged listing evidence, `external_identifier` on the
 * source). Lets the suite prove the full lifecycle a live listing goes through:
 * import → contacts persisted → detected → scored, plus cross-source dedupe.
 */
function listingCandidate(name, externalId, { phone = null } = {}) {
  const osmLink = `https://www.openstreetmap.org/${externalId.includes('/') ? externalId.slice(externalId.indexOf('/') + 1) : externalId}`;
  const evidence = [
    {
      signal_key: null,
      evidence_type: 'listing_detail',
      claim_type: 'FACT',
      text: `${name} is listed on OpenStreetMap${phone ? ` with phone ${phone}` : ''}.`,
      excerpt_summary: 'OSM listing contact info published',
      source_name: 'OpenStreetMap',
      source_url: osmLink,
      confidence: 0.8,
    },
  ];
  if (phone) {
    evidence.push({
      signal_key: 'public_phone_published',
      evidence_type: 'listing_detail',
      claim_type: 'FACT',
      text: `${name} publishes a public phone number on OpenStreetMap (${phone}).`,
      excerpt_summary: 'OSM listing includes public phone number',
      source_name: 'OpenStreetMap',
      source_url: osmLink,
      confidence: 0.8,
    });
  }
  return {
    name,
    industry: 'Restaurant',
    description: null,
    location: 'Nyeri, Kenya',
    country: 'Kenya',
    phone,
    website: null,
    socialUrl: null,
    contacts: phone
      ? [{ contact_type: 'phone', contact_value: phone, verification_status: 'phone_only', confidence: 0.8 }]
      : [],
    evidence,
    source: {
      source_type: 'provider_api',
      source_name: 'OpenStreetMap',
      source_url: osmLink,
      external_identifier: externalId,
    },
    contact_verified: Boolean(phone),
  };
}

const extraBuilders = {
  'osm-style': () => listingCandidate('Fictional Nyeri Restaurant', 'osm:node/4242424242', { phone: '+254799000111' }),
  // Same OSM source re-observed under a different display name (e.g. a chain
  // rebrand or a provider that keys listings by place id) — must not duplicate.
  'osm-spinoff': () => listingCandidate('Fictional Nyeri Restaurant Bistro', 'osm:node/4242424242'),
  // A bare listing with no published contact whatsoever — the manual-follow-up
  // case that still deserves automated research.
  'bare-listing': () => listingCandidate('Fictional Bare Caf\u00e9', 'osm:node/4242424243'),
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

    if (url.pathname === '/ctl') {
      if (req.method === 'GET') return send(res, 200, { ok: true, mode: state.mode });
      const b = await bodyJson(req);
      if (b.mode === 'ok' || b.mode === 'fail') state.mode = b.mode;
      if (typeof b.add === 'string' && extraBuilders[b.add]) state.extras.push(extraBuilders[b.add]());
      if (b.clear === true) state.extras = [];
      return send(res, 200, { ok: true, mode: state.mode, extras: state.extras.length });
    }

    if (url.pathname === '/search' && req.method === 'POST') {
      const body = await bodyJson(req);
      console.log(`[mock-discovery] mode=${state.mode} industry="${body.industry || ''}" query="${body.query || ''}" extras=${state.extras.length}`);
      if (state.mode === 'fail') {
        return send(res, 500, { error: 'simulated discovery provider outage' });
      }
      const results = [...candidates(), ...state.extras];
      return send(res, 200, { results });
    }

    return send(res, 404, { error: 'not found' });
  } catch (err) {
    console.error('[mock-discovery] error:', err);
    if (!res.headersSent) return send(res, 500, { error: String(err.message || err) });
    res.end();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-discovery] listening on http://127.0.0.1:${PORT} (mode=${state.mode})`);
});
