#!/usr/bin/env node
// Checks the engagement letter's rules in the app (src/lib/engagementLetterRules.ts,
// migration 20261028110000, docs/ENGAGEMENT_LETTERS.md): the text the page
// fingerprints is the text the database fingerprinted, and where a letter stands.
//
//   node --experimental-strip-types scripts/verify-engagement-letter.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const R = await import('../src/lib/engagementLetterRules.ts');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`ok  ${name}`); };

t('the page fingerprints the text exactly as the database does (engagement_letter_doc_text, SHA-256)', () => {
  const text = R.letterDocText('Engagement letter', 'Dear X,\n\nIntro ₹ “quoted”.', [
    { heading: 'Who we are', text: 'A line.\n• one\n• two' },
    { heading: 'Fees', text: 'Rs. 6,000 a month' },
  ]);
  // The database's own answer for the same letter, run on live on 28 October 2026.
  assert.equal(createHash('sha256').update(text, 'utf8').digest('hex'), '418597ddd2f8b56268e9d9bba4b7e8301935a76bd8d0c8617fcee2731d939fda');
});

t('where a letter stands', () => {
  const now = new Date('2026-10-28T12:00:00Z');
  const base = { status: 'sent', send_error: null, expires_at: '2026-11-27T12:00:00Z', created_at: '2026-10-28T11:58:00Z', first_opened_at: null, full_opened_at: null, declined_at: null };
  assert.equal(R.letterState({ ...base, status: 'ready' }, now), 'ready');
  // Made 20 minutes ago and never e-mailed (the mailer was not reached): not e-mailed.
  assert.equal(R.letterState({ ...base, status: 'ready', created_at: '2026-10-28T11:40:00Z' }, now), 'failed');
  assert.equal(R.letterState({ ...base, status: 'ready', send_error: 'graph 500' }, now), 'failed');
  assert.equal(R.letterState(base, now), 'sent');
  assert.equal(R.letterState({ ...base, first_opened_at: '2026-10-28T10:00:00Z' }, now), 'opened');
  assert.equal(R.letterState({ ...base, first_opened_at: 'x', full_opened_at: '2026-10-28T10:05:00Z' }, now), 'read');
  assert.equal(R.letterState({ ...base, full_opened_at: 'x', declined_at: '2026-10-28T11:00:00Z' }, now), 'changes');
  assert.equal(R.letterState({ ...base, expires_at: '2026-10-01T00:00:00Z' }, now), 'expired');
  // A resend that failed leaves a letter whose earlier link still works as it was.
  assert.equal(R.letterState({ ...base, send_error: 'graph 500' }, now), 'sent');
  assert.equal(R.letterState({ ...base, status: 'signed', expires_at: '2026-10-01T00:00:00Z' }, now), 'signed');
  assert.equal(R.letterState({ ...base, status: 'revoked' }, now), 'revoked');
  assert.ok(Object.keys(R.LETTER_STATE).length === 9);
});

console.log(`verify-engagement-letter: ${n} checks passed`);
