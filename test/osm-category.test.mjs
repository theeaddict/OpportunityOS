/** OSM category resolution — pure functions, no network. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTags, buildQuery } from '../lib/services/discovery/providers/osm-overpass.js';

const BBOX = { south: -1.4, north: -1.2, west: 36.7, east: 37.0 };

test('"phone sellers" (the real failing search) resolves to shop=mobile_phone, not amenity=phone sellers', () => {
  for (const t of ['phone sellers', 'Phone Sellers', 'phone shops', 'phone seller', 'phones', 'mobile phone dealers', 'phone']) {
    assert.deepEqual(resolveTags(t), { shop: 'mobile_phone' }, t);
  }
});

test('plurals and filler words reduce to a known type', () => {
  assert.deepEqual(resolveTags('restaurants'), { amenity: 'restaurant' });
  assert.deepEqual(resolveTags('hardware stores'), { shop: 'hardware' });
  assert.deepEqual(resolveTags('printing services'), { shop: 'copyshop' });
  assert.deepEqual(resolveTags('bakeries'), { shop: 'bakery' });
  assert.deepEqual(resolveTags('furniture workshops'), { shop: 'furniture' });
});

test('existing exact mappings and raw key=value are unchanged', () => {
  assert.deepEqual(resolveTags('plumber'), { craft: 'plumber' });
  assert.deepEqual(resolveTags('dentist'), { amenity: 'dentist' });
  assert.deepEqual(resolveTags('shop=bakery'), { shop: 'bakery' });
  assert.equal(resolveTags(''), null);
});

test('an unknown type falls back to a NAME search, never to a nonexistent amenity tag', () => {
  const t = resolveTags('quantum widgets');
  assert.ok(t.__name, JSON.stringify(t));
  assert.equal(t.amenity, undefined);
  const q = buildQuery(t, BBOX);
  assert.match(q, /\["name"~"quantum widget/);
  assert.match(q, /\["shop"\]/);
  assert.match(q, /\["amenity"\]/);
});

test('name-search queries cannot be injected into', () => {
  const q = buildQuery({ __name: 'x"];out;//' }, BBOX);
  assert.ok(!/x"\]/.test(q), q);
  assert.match(q, /"name"~"xout"/);
});

test('very short fragments do not fuzzy-match arbitrary categories', () => {
  assert.equal(resolveTags('a'), null);
  assert.equal(resolveTags('zz'), null);
});

import { isChainOutlet } from '../lib/services/discovery/providers/osm-overpass.js';

test('chain/brand outlets are recognised; independent dealers and shops are not', () => {
  assert.equal(isChainOutlet({ name: 'Samsung' }), true);
  assert.equal(isChainOutlet({ name: 'Safaricom Outlet' }), true);
  assert.equal(isChainOutlet({ name: 'M-PESA' }), true);
  assert.equal(isChainOutlet({ name: 'Airtel' }), true);
  assert.equal(isChainOutlet({ name: 'Anything', 'brand:wikidata': 'Q123' }), true);
  // An independent Safaricom dealer is a real SME lead, not corporate.
  assert.equal(isChainOutlet({ name: 'Extelcom shop', brand: 'safaricom' }), false);
  assert.equal(isChainOutlet({ name: 'Abdihamid' }), false);
  assert.equal(isChainOutlet({ name: 'nmobile phone repair' }), false);
  assert.equal(isChainOutlet({ name: 'Totally Local Phones' }), false, 'a name merely beginning with a chain word must not match');
  assert.equal(isChainOutlet({}), false);
});
