// The agent's database requests say they come from the office agent, for the
// change log (gst_change_log, migration 20261021130000), and keep the key headers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from '../src/db.js';

test('every request carries x-gst-source: agent and a request id', async () => {
  const seen: Array<{ url: string; headers: Record<string, string> }> = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    seen.push({ url: String(url), headers: init.headers as Record<string, string> });
    return new Response('[]', { status: 200 });
  }) as unknown as typeof fetch;
  const db = makeDb({ supabaseUrl: 'https://db.test', anonKey: 'anon' }, fakeFetch);
  await db.get('portal_jobs?select=id');
  await db.post('portal_job_events', [{ job_id: 'x' }]);
  await db.rpc('portal_job_claim', { p_agent: 'a' });
  assert.equal(seen.length, 3);
  for (const s of seen) {
    assert.equal(s.headers['x-gst-source'], 'agent');
    assert.match(s.headers['x-gst-request'], /^agent [0-9a-f]{1,8}$/);
    assert.equal(s.headers.apikey, 'anon');
    assert.equal(s.headers.Authorization, 'Bearer anon');
    assert.equal('x-gst-actor' in s.headers, false);
  }
  assert.equal(seen[1].headers.Prefer, 'return=minimal');
});
