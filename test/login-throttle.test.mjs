/** Unit tests for lib/login-throttle.js — pure in-memory, no DB/network. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLoginThrottle } from '../lib/login-throttle.js';

test('5 failures from one IP lock that (account, IP) pair', () => {
  const t = createLoginThrottle();
  for (let i = 0; i < 4; i++) assert.equal(t.recordFailure('a@x.test', '1.1.1.1').locked, false);
  assert.equal(t.recordFailure('a@x.test', '1.1.1.1').locked, true);
  assert.equal(t.status('a@x.test', '1.1.1.1').locked, true);
});

test('an attacker locking themselves out does NOT lock the real user from another IP', () => {
  const t = createLoginThrottle();
  for (let i = 0; i < 10; i++) t.recordFailure('victim@x.test', '6.6.6.6');
  assert.equal(t.status('victim@x.test', '6.6.6.6').locked, true, 'attacker pair is locked');
  assert.equal(t.status('victim@x.test', '9.9.9.9').locked, false, 'victim from their own IP is not');
});

test('a distributed campaign (many IPs, one account) still trips the account-wide ceiling', () => {
  const t = createLoginThrottle({ perIpMax: 5, perAccountMax: 30 });
  for (let i = 0; i < 30; i++) t.recordFailure('victim@x.test', `10.0.${i}.1`);
  assert.equal(t.status('victim@x.test', '9.9.9.9').locked, true);
});

test('success (reset) clears only the caller\'s own pair', () => {
  const t = createLoginThrottle();
  for (let i = 0; i < 3; i++) { t.recordFailure('a@x.test', '1.1.1.1'); t.recordFailure('a@x.test', '2.2.2.2'); }
  t.reset('a@x.test', '1.1.1.1');
  assert.equal(t.status('a@x.test', '1.1.1.1').attempts, 0);
  assert.equal(t.status('a@x.test', '2.2.2.2').attempts, 3);
});

test('emails are case/space-insensitive and empty emails are ignored', () => {
  const t = createLoginThrottle();
  for (let i = 0; i < 5; i++) t.recordFailure('  A@X.test ', '1.1.1.1');
  assert.equal(t.status('a@x.test', '1.1.1.1').locked, true);
  assert.deepEqual(t.recordFailure('', '1.1.1.1'), { locked: false });
});
