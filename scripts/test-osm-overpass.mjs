/**
 * Standalone test for the osm_overpass discovery provider.
 *
 * Run: node scripts/test-osm-overpass.mjs "dentist" "Nairobi, Kenya"
 * (args default to exactly that search).
 * Prints the candidate count + the mapped candidates so data quality can be
 * checked before the provider is wired up further.
 */

import { osmOverpassProvider } from '../lib/services/discovery/providers/osm-overpass.js';

const query = process.argv[2] || 'dentist';
const location = process.argv[3] || 'Nairobi, Kenya';

console.log(`\n[osm_overpass] searching query="${query}" location="${location}"...\n`);

const started = Date.now();
const candidates = await osmOverpassProvider.search({ query, location, industry: query });
const tookMs = Date.now() - started;

console.log(`[osm_overpass] ${candidates.length} candidate(s) in ${tookMs}ms\n`);

for (let i = 0; i < candidates.length; i += 1) {
  const c = candidates[i];
  const has = [
    c.name ? `name="${c.name}"` : null,
    c.industry ? `industry="${c.industry}"` : null,
    c.location ? `location="${c.location}"` : null,
    c.country ? `country="${c.country}"` : null,
    c.phone ? `phone="${c.phone}"` : '(no phone)',
    c.website ? `website="${c.website}"` : '(no website)',
    Number.isFinite(c.latitude) ? `lat=${c.latitude.toFixed(4)}` : null,
    Number.isFinite(c.longitude) ? `lon=${c.longitude.toFixed(4)}` : null,
    `contact_verified=${c.contact_verified}`,
  ].filter(Boolean);
  console.log(`#${i + 1} ${has.join(' | ')}`);
  if (c.contacts?.length) console.log(`      contacts: ${JSON.stringify(c.contacts)}`);
  if (c.evidence?.length) console.log(`      evidence: ${c.evidence.map((e) => e.text.slice(0, 140)).join(' | ')}`);
  console.log(`      source: ${JSON.stringify(c.source)}`);
  console.log('');
}

const missing = candidates.filter((c) => !c.contact_verified);
console.log(`[osm_overpass] ${missing.length}/${candidates.length} candidates are missing phone AND website (contact_verified=false) → need manual contact info.`);