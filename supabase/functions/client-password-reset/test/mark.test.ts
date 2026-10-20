// deno test supabase/functions/client-password-reset/test/
// The mailer's report back (client_password_reset_mark) is retried with
// backoff: a link that was e-mailed but never reported is voided after 15
// minutes, and the client is left holding a dead link.
import { assertEquals } from 'jsr:@std/assert@1';
import { MARK_RETRY_DELAYS_MS, markWithRetry } from '../mark.ts';

/** A report that answers with each of `answers` in turn ('ok', an error message, or 'throw'). */
function fakeReport(answers: string[]) {
  const calls = { n: 0 };
  const call = () => {
    const a = answers[Math.min(calls.n, answers.length - 1)];
    calls.n++;
    if (a === 'throw') return Promise.reject(new Error('network down'));
    return Promise.resolve({ error: a === 'ok' ? null : { message: a } });
  };
  return { call, calls };
}

function recorder() {
  const waits: number[] = [];
  return { waits, sleep: (ms: number) => { waits.push(ms); return Promise.resolve(); } };
}

Deno.test('a report that arrives is made once, with no wait', async () => {
  const { call, calls } = fakeReport(['ok']);
  const r = recorder();
  assertEquals(await markWithRetry(call, { sleep: r.sleep }), { ok: true, attempts: 1 });
  assertEquals(calls.n, 1);
  assertEquals(r.waits, []);
});

Deno.test('a failed report is retried, waiting longer each time', async () => {
  const { call, calls } = fakeReport(['503 upstream', 'throw', 'ok']);
  const r = recorder();
  assertEquals(await markWithRetry(call, { sleep: r.sleep }), { ok: true, attempts: 3 });
  assertEquals(calls.n, 3);
  assertEquals(r.waits, [500, 1500]);
});

Deno.test('it gives up after four attempts and says why', async () => {
  const { call, calls } = fakeReport(['throw', 'throw', 'throw', 'connection refused']);
  const r = recorder();
  assertEquals(await markWithRetry(call, { sleep: r.sleep }), { ok: false, attempts: 4, error: 'connection refused' });
  assertEquals(calls.n, 4);
  assertEquals(r.waits, [...MARK_RETRY_DELAYS_MS]);
  assertEquals(MARK_RETRY_DELAYS_MS, [500, 1500, 4000]);
});

Deno.test('the waits can be set', async () => {
  const { call, calls } = fakeReport(['down']);
  const r = recorder();
  assertEquals((await markWithRetry(call, { delays: [10], sleep: r.sleep })).attempts, 2);
  assertEquals(calls.n, 2);
  assertEquals(r.waits, [10]);
});
