// deno test --allow-read supabase/functions/bu-confirm-code/test/
import { assert, assertEquals, assertStringIncludes, assertThrows } from 'jsr:@std/assert@1';
import { checkedAddress, checkedCode, codeEmail, codeRef, esc } from '../message.ts';

const row = {
  code_id: '00000000-0000-0000-0000-000000000001',
  code: '042917',
  to_email: 'owner@client.test',
  project_name: 'Shree <Heights> & Co',
  client_name: 'SHREE TEST INFRA',
  gstin: '24AAAAA0000A1Z5',
  expires_at: '2026-10-21T10:30:00Z',
};

Deno.test('the code is in the e-mail, with how long it works', () => {
  const { html, subject } = codeEmail(row);
  assertStringIncludes(html, '>042917</span>');
  assertStringIncludes(html, 'works for 30 minutes');
  assertStringIncludes(html, 'Nobody can answer for you without this code');
  assertEquals(subject, 'Your confirmation code (AAAA) · Shree <Heights> & Co');
  assert(!subject.includes('042917'), 'the subject does not carry the code (the firm\'s message trace lists subjects)');
});

// Finding of 21 Oct 2026 (low): another holder of the link asked a code for
// the same address right after the owner's page did; the owner typed that
// one, the newest in the mailbox, because the page said "the latest e-mail".
// The e-mail now carries the code's reference, as the page and the database
// name it (supabase/tests/bu_confirm/test_78_code_reference.sql: the same id
// gives DRLK there).
Deno.test('the e-mail carries the code\'s reference, as the page and the database work it out', () => {
  assertEquals(codeRef('3fa90000-0000-4000-8000-000000000000'), 'DRLK');
  assertEquals(codeRef('0123ABCD-ef01-4000-8000-000000000000'), 'ABCD');
  assert(/^[A-HJ-NP-R]{4}$/.test(codeRef(crypto.randomUUID())), 'four letters, no digit, I or O');
  const at = new Date('2026-10-21T05:12:00Z');
  const { html, subject } = codeEmail({ ...row, code_id: '3fa90000-0000-4000-8000-000000000000' }, at);
  assertStringIncludes(subject, '(DRLK)');
  assertStringIncludes(html, 'This e-mail is marked <strong>DRLK</strong> (sent at 10:42 am IST)');
  assertStringIncludes(html, 'type the one from the e-mail with that mark');
  assert(!/latest/.test(html), 'never "the latest e-mail"');
});

Deno.test('values from the database are escaped', () => {
  const { html } = codeEmail(row);
  assertStringIncludes(html, 'Shree &lt;Heights&gt; &amp; Co');
  assert(!html.includes('<Heights>'));
  assertStringIncludes(html, '>24AAAAA0000A1Z5</td>');
  assertEquals(esc(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
});

Deno.test('only a 6-digit code is sent', () => {
  assertEquals(checkedCode('000123'), '000123');
  for (const bad of ['12345', '1234567', 'abcdef', '12 456', '', null, undefined, '<b>1</b>']) {
    assertThrows(() => checkedCode(bad), Error, 'not a 6-digit code');
  }
  assertThrows(() => codeEmail({ ...row, code: '<script>' }));
});

Deno.test('to one address only', () => {
  assertEquals(checkedAddress(' owner@client.test '), 'owner@client.test');
  for (const bad of ['a@x.test, b@y.test', 'a@x.test;b@y.test', 'Owner <a@x.test>', 'nobody', '', 'a b@x.test']) {
    assertThrows(() => checkedAddress(bad), Error, 'not one e-mail address');
  }
});

// The firm's staff must not be able to read a client's code in the shared
// mailbox: the function sends through _shared/graph.ts, which keeps no copy in
// Sent Items, and never through email_outbox.
Deno.test('no copy in Sent Items, nothing through email_outbox', async () => {
  const here = new URL('..', import.meta.url);
  const index = await Deno.readTextFile(new URL('index.ts', here)) + await Deno.readTextFile(new URL('handler.ts', here));
  const graph = await Deno.readTextFile(new URL('../_shared/graph.ts', here));
  assertStringIncludes(index, "import { graphToken, sendMail } from '../_shared/graph.ts';");
  assertStringIncludes(index, 'send: async (to, subject, html) => sendMail(await graphToken(), to, subject, html)');
  assert(/saveToSentItems:\s*false/.test(graph), 'graph.ts sendMail keeps no copy');
  assert(!/saveToSentItems:\s*true/.test(graph));
  assert(!/email_outbox['"]/.test(index.replace(/^\/\/.*$/gm, '')), 'index.ts never writes email_outbox');
  assert(!/console\.\w+\([^\n]*row\.code(?!_id)/.test(index), 'never logs a code');
  assert(!/json\([^\n]*row\.code(?!_id)/.test(index), 'never answers with the code');
});
