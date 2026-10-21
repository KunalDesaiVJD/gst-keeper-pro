// deno test --allow-read supabase/functions/bu-confirm-code/test/
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import { makeHandler } from '../handler.ts';

const ID = '11111111-2222-4333-8444-555555555555';
const row = {
  code_id: ID, code: '042917', to_email: 'owner@client.test', project_name: 'Test Heights',
  client_name: 'SHREE TEST INFRA', gstin: '24AAAAA0000A1Z5', expires_at: '2026-10-21T10:30:00Z',
};

function fakes(claim: unknown[] | { message: string }, sendFails = false) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const sent: { to: string; subject: string; html: string }[] = [];
  const logs: string[] = [];
  const handler = makeHandler({
    rpc: (fn, args) => {
      calls.push({ fn, args });
      if (fn === 'builder_bu_confirm_code_claim') {
        return Promise.resolve(Array.isArray(claim) ? { data: claim, error: null } : { data: null, error: claim });
      }
      return Promise.resolve({ data: null, error: null });
    },
    send: (to, subject, html) => {
      if (sendFails) return Promise.reject(new Error('sendMail 400: invalid recipient'));
      sent.push({ to, subject, html });
      return Promise.resolve();
    },
    log: (l) => logs.push(l),
  });
  return { handler, calls, sent, logs };
}
const post = (body: unknown) => new Request('http://x/bu-confirm-code', { method: 'POST', body: JSON.stringify(body) });

Deno.test('claims the code, e-mails it to that one address, reports it sent', async () => {
  const f = fakes([row]);
  const res = await f.handler(post({ code_id: ID }));
  assertEquals(await res.json(), { ok: true, status: 'sent' });
  assertEquals(f.calls.map((c) => c.fn), ['builder_bu_confirm_code_claim', 'builder_bu_confirm_code_mark']);
  assertEquals(f.calls[1].args, { p_code_id: ID, p_error: null });
  assertEquals(f.sent.length, 1);
  assertEquals(f.sent[0].to, 'owner@client.test');
  assertStringIncludes(f.sent[0].html, '042917');
  assert(!f.logs.join('\n').includes('042917'), 'the code is never logged');
});

Deno.test('a failed send is reported failed, and the page learns nothing more', async () => {
  const f = fakes([row], true);
  const res = await f.handler(post({ code_id: ID }));
  const body = await res.json();
  assertEquals(body, { ok: false, status: 'failed' });
  assertEquals(f.calls[1].args, { p_code_id: ID, p_error: 'sendMail 400: invalid recipient' });
  assert(!JSON.stringify(body).includes('042917'));
});

Deno.test('a code already claimed or too old sends nothing', async () => {
  const f = fakes([]);
  assertEquals(await (await f.handler(post({ code_id: ID }))).json(), { ok: true, status: 'none' });
  assertEquals(f.sent.length, 0);
  assertEquals(f.calls.map((c) => c.fn), ['builder_bu_confirm_code_claim']);
});

Deno.test('takes nothing but a code id', async () => {
  for (const body of [{}, { code_id: 'x' }, { code_id: `${ID}; drop` }, { to: 'a@b.test' }]) {
    const f = fakes([row]);
    const res = await f.handler(post(body));
    assertEquals(res.status, 400);
    assertEquals(f.calls.length, 0);
    assertEquals(f.sent.length, 0);
  }
  const f = fakes([row]);
  assertEquals((await f.handler(new Request('http://x', { method: 'GET' }))).status, 405);
  assertEquals((await f.handler(new Request('http://x', { method: 'POST', body: 'not json' }))).status, 400);
});

Deno.test('a row that is not one address or not a 6-digit code is not sent', async () => {
  for (const bad of [{ ...row, to_email: 'a@x.test, b@y.test' }, { ...row, code: '12345' }]) {
    const f = fakes([bad]);
    assertEquals(await (await f.handler(post({ code_id: ID }))).json(), { ok: false, status: 'failed' });
    assertEquals(f.sent.length, 0);
    assert(String(f.calls[1].args.p_error).startsWith('refused'));
  }
});

Deno.test('a claim error answers failed', async () => {
  const f = fakes({ message: 'permission denied' });
  const res = await f.handler(post({ code_id: ID }));
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { ok: false, status: 'failed' });
});
