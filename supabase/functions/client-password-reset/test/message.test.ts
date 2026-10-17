// deno test supabase/functions/client-password-reset/test/
import { assert, assertEquals, assertStringIncludes, assertThrows } from 'jsr:@std/assert@1';
import { APP_ORIGIN, checkedLink, esc, LOGIN_URL, resetEmail } from '../message.ts';

const row = {
  reset_id: '00000000-0000-0000-0000-000000000001',
  token: 'ab'.repeat(32),
  link: `https://gst.vjdesai.com/reset-password#token=${'ab'.repeat(32)}`,
  client_id: '00000000-0000-0000-0000-000000000002',
  client_name: 'NAVRATNA <S G> HIGHWAY & CO',
  gstin: '24AAACN0000A1ZK',
  to_email: 'p.owner@navratna.com',
  expires_at: '2026-10-17T10:00:00Z',
  via: 'self',
};

Deno.test('the link is the button and the plain-text fallback', () => {
  const { html } = resetEmail(row);
  assertEquals(html.split(row.link).length - 1, 3); // button href, text href, text
  assertStringIncludes(html, '>Set a new password</a>');
  assertStringIncludes(html, 'expires in 60 minutes');
  assertStringIncludes(html, 'https://gst.vjdesai.com/login');
  assertStringIncludes(html, 'your current password keeps working');
});

Deno.test('client values are escaped', () => {
  const { html, subject } = resetEmail(row);
  assertStringIncludes(html, 'NAVRATNA &lt;S G&gt; HIGHWAY &amp; CO');
  assert(!html.includes('<S G>'));
  assertEquals(subject, 'Reset your password · NAVRATNA <S G> HIGHWAY & CO');
});

Deno.test('details box: GSTIN as the User ID', () => {
  const { html } = resetEmail(row);
  assertStringIncludes(html, '>User ID</td>');
  assertStringIncludes(html, '>24AAACN0000A1ZK</td>');
  assertStringIncludes(html, '60 minutes, one use');
});

Deno.test('a staff-sent link says so', () => {
  assertStringIncludes(resetEmail({ ...row, via: 'staff' }).html, 'Our team has sent you this link');
  assertStringIncludes(resetEmail(row).html, 'We received a request');
});

Deno.test('helpers', () => {
  assertEquals(esc(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  assertEquals(APP_ORIGIN, 'https://gst.vjdesai.com');
  assertEquals(LOGIN_URL, 'https://gst.vjdesai.com/login');
});

// A link to another site would hand that site a working token: the mailer
// refuses it (and reports the link as failed), and the sign-in link in the
// e-mail is always the app's own, whatever the link says.
Deno.test('only a link to the app is e-mailed', () => {
  assertEquals(checkedLink(row), row.link);
  const evil = { ...row, link: `https://evil.example/reset-password#token=${row.token}` };
  assertThrows(() => resetEmail(evil), Error, 'does not point at the app');
  assertThrows(() => checkedLink({ ...row, link: `https://gst.vjdesai.com.evil.example/reset-password#token=${row.token}` }));
  assertThrows(() => checkedLink({ ...row, link: `https://gst.vjdesai.com/reset-password#token=${'cd'.repeat(32)}` }));
  assertThrows(() => checkedLink({ token: 'not-hex', link: 'https://gst.vjdesai.com/reset-password#token=not-hex' }));
});

Deno.test('the sign-in link is always the app\'s', () => {
  const { html } = resetEmail(row);
  assertStringIncludes(html, `href="${LOGIN_URL}"`);
  const appLinks = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]).filter((h) => /login|reset-password/.test(h));
  assertEquals(appLinks.length, 3); // button, plain-text fallback, sign-in
  assert(appLinks.every((h) => h.startsWith(`${APP_ORIGIN}/`)), appLinks.join(' '));
});
