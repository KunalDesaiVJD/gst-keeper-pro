// engagement-letter without the database or Graph:
//   deno test --allow-read supabase/functions/engagement-letter/test/
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { makeHandler, mintToken, tokenHash, type Deps } from '../handler.ts';
import { letterEmail } from '../message.ts';

const LETTER = '11111111-2222-4333-8444-555555555555';
const CODE = '66666666-7777-4888-8999-000000000000';
const TOKEN = 'tok_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd';

const issued = {
  id: LETTER, to: 'owner@client.example', cc: 'accounts@client.example', client_name: 'M J SURGICAL', gstin: '24ABQFM3869C1Z1',
  title: 'Engagement letter for GST services', version: 1, firm: { name: 'V. J. Desai & Co. LLP', email: 'gst@vjdesai.com', partner_name: 'A Partner' },
  expires_at: '2026-11-27T12:00:00Z', message: 'Please sign <soon>', resend: false,
  summary: [
    { n: 1, key: 'parties', heading: 'Who we are', summary: 'We act for M J SURGICAL.' },
    { n: 9, key: 'personal_data', heading: 'Personal data', summary: 'Under the DPDP Act.' },
  ],
};
const signed = {
  id: LETTER, ref: '11111111', to: 'owner@client.example', cc: null, client_name: 'M J SURGICAL', gstin: '24ABQFM3869C1Z1',
  title: 'Engagement letter for GST services', version: 1, firm: { name: 'V. J. Desai & Co. LLP', email: 'gst@vjdesai.com', grievance_email: 'privacy@vjdesai.example' },
  signer_name: 'Sanjay Kumar', signer_capacity: 'Partner', signed_at: '2026-10-28T12:17:02Z',
  consents: { engagement: true, data_processing: true, ai_processing: true }, doc_sha256: 'a'.repeat(64),
};

function fake(replies: Record<string, unknown>, failSend = false) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const sent: { to: string; subject: string; html: string; cc?: string | null }[] = [];
  const logs: string[] = [];
  const deps: Deps = {
    rpc: (fn, args) => { calls.push({ fn, args }); return Promise.resolve({ data: replies[fn] ?? null, error: null }); },
    send: (to, subject, html, cc) => { if (failSend) return Promise.reject(new Error('graph 500 with secret detail')); sent.push({ to, subject, html, cc }); return Promise.resolve(); },
    firmMailbox: 'gst@vjdesai.com',
    token: () => TOKEN,
    log: (l) => logs.push(l),
  };
  return { deps, calls, sent, logs };
}
const post = (body: unknown) => new Request('http://x/', { method: 'POST', body: JSON.stringify(body) });

Deno.test('send: only the hash goes to the database; the e-mail carries only the signing link', async () => {
  const f = fake({ engagement_letter_issue: issued });
  const r = await makeHandler(f.deps)(post({ action: 'send', letter_id: LETTER }));
  assertEquals(await r.json(), { ok: true, status: 'sent' });
  assertEquals(f.calls[0].fn, 'engagement_letter_issue');
  assertEquals(f.calls[0].args.p_token_hash, await tokenHash(TOKEN));
  assert(!JSON.stringify(f.calls).includes(TOKEN), 'the token never reaches the database');
  assertEquals(f.calls[1], { fn: 'engagement_letter_mark_sent', args: { p_letter_id: LETTER, p_error: null } });
  const m = f.sent[0];
  assertEquals([m.to, m.cc], ['owner@client.example', 'accounts@client.example']);
  assertStringIncludes(m.subject, 'Engagement letter for M J SURGICAL');
  assertStringIncludes(m.html, `https://gst.vjdesai.com/engagement/${TOKEN}"`);
  assertStringIncludes(m.html, 'Review and sign the engagement letter');
  assertStringIncludes(m.html, 'Please sign &lt;soon&gt;');
  assert(!m.html.includes('?clause='), 'only the signing link: the clauses are on the page');
  assert(m.html.length < 6000, `a short e-mail (${m.html.length})`);
  assert(!f.logs.join('\n').includes(TOKEN), 'the token is never logged');
});

Deno.test('send: nothing pending sends nothing; a failed e-mail is reported without Graph\'s words', async () => {
  const none = fake({});
  assertEquals(await (await makeHandler(none.deps)(post({ action: 'send', letter_id: LETTER }))).json(), { ok: true, status: 'none' });
  assertEquals(none.sent.length, 0);
  const bad = fake({ engagement_letter_issue: issued }, true);
  const r = await (await makeHandler(bad.deps)(post({ action: 'send', letter_id: LETTER }))).json();
  assertEquals(r, { ok: false, status: 'failed' });
  assertStringIncludes(String(bad.calls[1].args.p_error), 'graph 500');
  assertEquals((await makeHandler(bad.deps)(post({ action: 'send', letter_id: 'nope' }))).status, 400);
  assertEquals((await makeHandler(bad.deps)(post({ action: 'delete', letter_id: LETTER }))).status, 400);
});

Deno.test('code: the code goes to the one address, never in the subject', async () => {
  const f = fake({ engagement_letter_code_claim: { code_id: CODE, code: '042917', to: 'owner@client.example', purpose: 'sign', client_name: 'M J SURGICAL', gstin: null, title: 'x', firm: {}, ref: 'ABCD' } });
  const r = await (await makeHandler(f.deps)(post({ action: 'code', code_id: CODE }))).json();
  assertEquals(r, { ok: true, status: 'sent' });
  assertEquals(f.sent[0].to, 'owner@client.example');
  assertStringIncludes(f.sent[0].html, '042917');
  assert(!f.sent[0].subject.includes('042917'));
  assertStringIncludes(f.sent[0].subject, 'ABCD');
  assert(!f.logs.join('\n').includes('042917'), 'the code is never logged');
  assertEquals(f.calls[1].fn, 'engagement_letter_code_mark');
});

Deno.test('copy: the signer gets a short note to download the signed letter; the firm a note with the record\'s address', async () => {
  const f = fake({ engagement_letter_copy_claim: signed });
  const r = await (await makeHandler(f.deps)(post({ action: 'copy', letter_id: LETTER }))).json();
  assertEquals(r, { ok: true, status: 'sent' });
  assertEquals(f.calls[0].args.p_view_hash, await tokenHash(TOKEN));
  const [client, firm] = f.sent;
  assertEquals(client.to, 'owner@client.example');
  assertStringIncludes(client.html, `https://gst.vjdesai.com/engagement/${TOKEN}?download=1`);
  assertStringIncludes(client.html, 'Download the signed letter');
  assert(!client.html.includes('a'.repeat(64)) && !client.html.includes('AI tools'), 'short: only the signed letter to download');
  assertEquals(firm.to, 'gst@vjdesai.com');
  assert(!firm.html.includes(TOKEN), 'the firm\'s note has no client link');
  assertStringIncludes(firm.html, `/notices-reply-factory?tab=consent&amp;letter=${LETTER}`.replace('&amp;', '&'));
});

Deno.test('tokens are long and random; the e-mail escapes what it shows', async () => {
  const a = mintToken(), b = mintToken();
  assert(a !== b && a.length >= 43 && /^[A-Za-z0-9_-]+$/.test(a));
  assertEquals((await tokenHash('x')).length, 64);
  assertStringIncludes(letterEmail({ ...issued, client_name: '<b>' }, 't').html, '&lt;b&gt;');
  assertStringIncludes(letterEmail({ ...issued, resend: true }, 't').subject, 'Reminder: ');
});
