// The portal e-mail parser (src/mail/parse.ts) against synthetic e-mails in
// test/fixtures/emails/. Every company, address and GSTIN there is made up: the
// GSTINs carry a valid check character but a PAN whose fourth letter is 'Z',
// which no real PAN has.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PORTAL_SENDERS,
  gstinCheckChar,
  htmlToText,
  isValidGstin,
  normaliseFormCode,
  parsePortalEmail,
  type ParseOptions,
} from '../src/mail/parse.js';
import { emailInputFromSource } from '../src/mail/inbox.js';
import { fixtureSource } from './mail-fixtures.js';

async function parseFixture(name: string, opts?: ParseOptions) {
  const input = await emailInputFromSource(fixtureSource(name), { fallbackId: 'uid:1:1@INBOX' });
  return parsePortalEmail(input, opts);
}

// ── GSTIN ──────────────────────────────────────────────────────────────────

test('GSTIN check character: the published sample GSTINs validate', () => {
  for (const g of ['27AAPFU0939F1ZV', '29AAGCB7383J1Z4', '33AAACH7409R1Z8', '07AAACB2894G1ZP']) {
    assert.equal(gstinCheckChar(g.slice(0, 14)), g[14], g);
    assert.equal(isValidGstin(g), true, g);
  }
});

test('GSTIN: the fixture GSTINs are valid, a wrong check character is not', () => {
  for (const g of ['24ZZZZA0001A1ZZ', '24ZZZZB0002B1ZV', '27ZZZZC0003C1ZL', '24ZZZZD0004D1ZN', '24ZZZZE0005E1ZJ', '24ZZZZG0007G1ZB']) {
    assert.equal(isValidGstin(g), true, g);
  }
  assert.equal(isValidGstin('24zzzza0001a1zz'), true, 'lower case is read as upper case');
  assert.equal(isValidGstin('24ZZZZA0001A1ZQ'), false, 'wrong check character');
  assert.equal(isValidGstin('24ZZZZA0001A1Z'), false, '14 characters');
  assert.equal(isValidGstin('ZD241026000123A'), false, 'a reference number');
});

test('GSTIN: the state code must be 01-38, 97 or 99, and a 15-digit number never counts', () => {
  const withCheck = (first14: string) => first14 + gstinCheckChar(first14);
  assert.equal(isValidGstin(withCheck('38ZZZZA0001A1Z')), true);
  assert.equal(isValidGstin(withCheck('97ZZZZA0001A1Z')), true);
  assert.equal(isValidGstin(withCheck('99ZZZZA0001A1Z')), true);
  assert.equal(isValidGstin(withCheck('00ZZZZA0001A1Z')), false);
  assert.equal(isValidGstin(withCheck('39ZZZZA0001A1Z')), false);
  assert.equal(isValidGstin(withCheck('96ZZZZA0001A1Z')), false);
  assert.equal(isValidGstin(withCheck('24102600012345')), false);
});

test('a 15-character token with a bad check character is not taken as a GSTIN', () => {
  const e = parsePortalEmail({
    messageId: '<t1@x.example>',
    from: 'donotreply@gst.gov.in',
    subject: 'Notice',
    text: 'GSTIN: 24ZZZZA0001A1ZQ\nAlso 24ZZZZA0001A1ZZX and X24ZZZZA0001A1ZZ are glued to other characters.',
  });
  assert.deepEqual(e.gstins, []);
  const ok = parsePortalEmail({ messageId: '<t2@x.example>', text: 'GSTIN:24ZZZZA0001A1ZZ.' });
  assert.deepEqual(ok.gstins, ['24ZZZZA0001A1ZZ']);
});

// ── Form codes ─────────────────────────────────────────────────────────────

test('form codes are written the way the app writes them', () => {
  const cases: Array<[string, string | null]> = [
    ['Form GST DRC-01B', 'DRC-01B'],
    ['FORM GST DRC 01B', 'DRC-01B'],
    ['DRC01B', 'DRC-01B'],
    ['drc-1b', 'DRC-01B'],
    ['Form-GST-DRC-01C Part A', 'DRC-01C'],
    ['FORM GST DRC-01A', 'DRC-01A'],
    ['DRC-01 Part A', 'DRC-01'],
    ['DRC – 07', 'DRC-07'],
    ['DRC-22', 'DRC-22'],
    ['GSTR 3A', 'GSTR-3A'],
    ['GSTR3A', 'GSTR-3A'],
    ['FORM GSTR-3A', 'GSTR-3A'],
    ['GSTR-9C', 'GSTR-9C'],
    ['ASMT 10', 'ASMT-10'],
    ['ASMT-13', 'ASMT-13'],
    ['REG17', 'REG-17'],
    ['Form GST REG-31', 'REG-31'],
    ['REG 03', 'REG-03'],
    ['RFD 06', 'RFD-06'],
    ['MOV-07', 'MOV-07'],
    ['ADT-02', 'ADT-02'],
    ['APL-01', 'APL-01'],
    ['FORM GST CMP-05', 'CMP-05'],
    ['Form GST ITC-04', 'ITC-04'],
    ['ITC 10 lakh', null],
    ['ITC-04', null],
    ['DRC-100', null],
    ['Reg: the notice dated 12.10', null],
    ['no form here', null],
  ];
  for (const [input, want] of cases) assert.equal(normaliseFormCode(input), want, input);
});

test('form: the subject wins over the body, and a form the portal issued wins over one the taxpayer files', () => {
  const pick = (subject: string, text: string) => parsePortalEmail({ messageId: '<f@x.example>', subject, text }).formCode;
  assert.equal(pick('Intimation - FORM GST DRC-01B', 'Pay through DRC-03 or reply in DRC-01C'), 'DRC-01B');
  assert.equal(pick('Intimation', 'issued in FORM GST DRC-01C; also see ASMT-10'), 'DRC-01C');
  assert.equal(pick('Notice for not filing GSTR-3B', 'A notice in FORM GSTR-3A has been issued'), 'GSTR-3A');
  assert.equal(pick('Reply filed', 'Your reply in FORM GST DRC-06 against the notice in FORM GST DRC-01'), 'DRC-01');
  assert.equal(pick('Payment received', 'Your payment through FORM GST DRC-03 is received'), 'DRC-03');
  assert.equal(pick('GSTR-1 filed', 'You have filed GSTR-1 for September'), 'GSTR-1');
});

// ── The fixtures ───────────────────────────────────────────────────────────

test('direct portal e-mail: DRC-01B intimation', async () => {
  const e = await parseFixture('drc01b-direct.eml');
  assert.equal(e.isPortal, true);
  assert.equal(e.messageId, '<fixture-drc01b-0001@mail.gst.gov.in>');
  assert.equal(e.receivedAt, '2026-10-01T04:45:00.000Z');
  assert.equal(e.from, 'donotreply@gst.gov.in');
  assert.equal(e.subject, 'Intimation of difference in liability - FORM GST DRC-01B Part A');
  assert.deepEqual(e.gstins, ['24ZZZZA0001A1ZZ']);
  assert.equal(e.formCode, 'DRC-01B');
  assert.equal(e.reference, 'ZD241026000123A');
  assert.ok(e.snippet.startsWith('Dear Taxpayer, GSTIN: 24ZZZZA0001A1ZZ Legal Name: EXAMPLE WEAVING WORKS'), e.snippet);
  assert.ok(e.snippet.length <= 400);
  assert.ok(!/\s{2,}|\n/.test(e.snippet), 'whitespace is collapsed');
});

test('GSTR-3A defaulter e-mail: the notice form, not the return it names', async () => {
  const e = await parseFixture('gstr3a-defaulter.eml');
  assert.equal(e.isPortal, true);
  assert.equal(e.from, 'noreply@gst.gov.in');
  assert.deepEqual(e.gstins, ['24ZZZZB0002B1ZV']);
  assert.equal(e.formCode, 'GSTR-3A');
  assert.equal(e.reference, 'ZA2410260004567');
});

test('REG-17 show-cause notice from a gst.gov.in subdomain (quoted-printable body)', async () => {
  const e = await parseFixture('reg17-scn.eml');
  assert.equal(e.from, 'noreply@services.gst.gov.in');
  assert.equal(e.isPortal, true);
  assert.deepEqual(e.gstins, ['24ZZZZA0001A1ZZ'], 'the GSTIN split by a soft line break is whole again');
  assert.equal(e.formCode, 'REG-17', '"FORM GST REG 17" normalised; the REG-18 reply form does not win');
  assert.equal(e.reference, 'ZD241026000456B');
});

test('forwarded portal e-mail, Gmail style: the forwarded text comes first', async () => {
  const e = await parseFixture('forwarded-gmail.eml');
  assert.equal(e.isPortal, true);
  assert.equal(e.from, 'accounts@sample-agro.example', 'from is whoever forwarded it');
  assert.deepEqual(e.gstins, ['27ZZZZC0003C1ZL', '24ZZZZD0004D1ZN'], "the portal's GSTIN before the one in the forwarder's signature");
  assert.equal(e.formCode, 'DRC-01C');
  assert.equal(e.reference, 'ZD271026000456D');
  assert.ok(e.snippet.startsWith('Dear Taxpayer, GSTIN: 27ZZZZC0003C1ZL'), e.snippet);
  assert.ok(!e.snippet.includes('Please look into'), "the snippet is the portal's text, not the forwarding note");
  assert.ok(!e.snippet.includes('Forwarded message'));
});

test('forwarded portal e-mail, Outlook style (-----Original Message----- and [mailto:])', async () => {
  const e = await parseFixture('forwarded-outlook.eml');
  assert.equal(e.isPortal, true);
  assert.equal(e.from, 'accounts@demo-builders.example');
  assert.deepEqual(e.gstins, ['24ZZZZB0002B1ZV']);
  assert.equal(e.formCode, 'ASMT-10', 'the ASMT-11 reply form does not win');
  assert.equal(e.reference, 'ZD241026000999E', 'from "Notice No."');
  assert.ok(e.snippet.startsWith('Dear Taxpayer, GSTIN: 24ZZZZB0002B1ZV A notice in FORM GST ASMT-10'), e.snippet);
});

test('forwarded portal e-mail, new Outlook HTML (rule line and bold From:/Sent:)', async () => {
  const e = await parseFixture('forwarded-outlook-html.eml');
  assert.equal(e.isPortal, true);
  assert.deepEqual(e.gstins, ['24ZZZZE0005E1ZJ']);
  assert.equal(e.formCode, 'DRC-01A');
  assert.equal(e.reference, 'ZD241026000777K');
  assert.ok(e.snippet.startsWith('Dear Taxpayer'), e.snippet);
});

test('portal e-mail forwarded as an attachment (message/rfc822)', async () => {
  const e = await parseFixture('forwarded-attachment.eml');
  assert.equal(e.isPortal, true);
  assert.equal(e.messageId, '<fixture-fwd-attachment-0011@demo-builders.example>', 'the outer message is the one recorded');
  assert.deepEqual(e.gstins, ['24ZZZZB0002B1ZV']);
  assert.equal(e.formCode, 'DRC-01A');
  assert.equal(e.reference, 'ZD241026000888H');
});

test('HTML-only portal e-mail: table cells kept apart, styles and title ignored', async () => {
  const e = await parseFixture('html-only.eml');
  assert.equal(e.isPortal, true);
  assert.deepEqual(e.gstins, ['24ZZZZE0005E1ZJ']);
  assert.equal(e.formCode, 'REG-31', 'DRC-07 in <title> and <style> is not read');
  assert.equal(e.reference, 'ZA2410260003210', 'the column header is not a value; the portal-shaped token is');
  assert.ok(e.snippet.startsWith('Dear Taxpayer, Your registration has been suspended'), e.snippet);
  assert.ok(e.snippet.includes('Test Spice Traders & Co. (fictitious)'), 'entities decoded');
  assert.ok(!/padding|color|DRC-07/.test(e.snippet), 'no CSS or title in the snippet');
});

test('HTML-only body handed straight to the parser (no text part)', () => {
  const e = parsePortalEmail({
    messageId: '<h@x.example>',
    from: 'GST Network <donotreply@gst.gov.in>',
    subject: 'Notice',
    html: '<html><head><style>.a{}</style></head><body><table><tr><td>GSTIN</td><td>24ZZZZA0001A1ZZ</td></tr>' +
      '<tr><td>Reference&nbsp;No.</td><td>ZD241026000123A</td></tr></table><p>Form&nbsp;GST&nbsp;DRC-01B &amp; more</p></body></html>',
  });
  assert.equal(e.isPortal, true);
  assert.deepEqual(e.gstins, ['24ZZZZA0001A1ZZ']);
  assert.equal(e.reference, 'ZD241026000123A');
  assert.equal(e.formCode, 'DRC-01B');
  assert.equal(e.snippet, 'GSTIN 24ZZZZA0001A1ZZ Reference No. ZD241026000123A Form GST DRC-01B & more');
});

test('htmlToText keeps rows on lines and cells apart', () => {
  assert.equal(
    htmlToText('<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table><p>x&lt;y&#8377;&#x20B9;</p>'),
    'A B\n1 2\n\nx<y₹₹',
  );
});

test('a non-portal e-mail is not a portal e-mail, even when it mentions gst.gov.in', async () => {
  const e = await parseFixture('non-portal.eml');
  assert.equal(e.isPortal, false);
  assert.equal(e.from, 'billing@demo-supplier.example');
  assert.deepEqual(e.gstins, ['24ZZZZF0006F1ZF'], 'fields are still read; the watcher just does not send it');
});

test('several GSTINs: all valid ones, upper case, once each, in order', async () => {
  const e = await parseFixture('several-gstins.eml');
  assert.equal(e.isPortal, true);
  assert.deepEqual(e.gstins, ['24ZZZZA0001A1ZZ', '27ZZZZA0001A1ZT', '24ZZZZA0001A2ZY']);
  assert.equal(e.reference, null);
  assert.equal(e.formCode, null);
});

test('an e-mail with an ARN and a reference: the reference, never the application ARN', async () => {
  const e = await parseFixture('arn-and-reference.eml');
  assert.equal(e.isPortal, true);
  assert.equal(e.reference, 'ZA2410260007777');
  assert.deepEqual(e.gstins, ['24ZZZZG0007G1ZB']);
  assert.equal(e.formCode, 'RFD-08', 'not the RFD-01 application or the RFD-09 reply');
});

test('reference: labelled tokens first, ARNs only when labelled as the reference', () => {
  const ref = (text: string, subject = '') => parsePortalEmail({ messageId: '<r@x.example>', subject, text }).reference;
  assert.equal(ref('ARN AA241026000654G was filed.'), null, 'an unlabelled ARN is not a reference');
  assert.equal(ref('Reference No: AA241026000654G'), 'AA241026000654G', 'labelled as the reference');
  assert.equal(ref('Application Reference Number: AA241026000654G'), null, "an application's own number");
  assert.equal(ref('Payment Reference Number: ZA2410260001111'), 'ZA2410260001111', 'still a portal-shaped token');
  assert.equal(ref('See ZD241026000111A. Order No.: ZA2410260002222'), 'ZA2410260002222', 'labelled beats first');
  assert.equal(ref('Notice ZD241026000111A and ZD241026000222B'), 'ZD241026000111A', 'else the first');
  assert.equal(ref('Ref No & Date: ZD241026000333C dt 01/10/2026'), 'ZD241026000333C');
  assert.equal(ref('Reference ID - zd241026000444d'), 'ZD241026000444D', 'upper case');
  assert.equal(ref('GSTIN 24ZZZZA0001A1ZZ only'), null, 'a GSTIN is never a reference unless labelled');
  assert.equal(ref('Token ZD401026000123A has no state code, ZD991026000123A has 99'), 'ZD991026000123A');
  assert.equal(ref('', 'Notice ZD241026000555E issued'), 'ZD241026000555E', 'the subject counts');
});

// ── Sender, forwards, snippet ──────────────────────────────────────────────

test('the sender is the address in brackets, not one written into the display name', () => {
  const e = parsePortalEmail({ messageId: '<s@x.example>', from: '"donotreply@gst.gov.in" <relay@spoof.example>', text: 'hello' });
  assert.equal(e.from, 'relay@spoof.example');
  assert.equal(e.isPortal, false);
  const lookalike = parsePortalEmail({ messageId: '<s2@x.example>', from: 'x@gst.gov.in.spoof.example', text: '' });
  assert.equal(lookalike.isPortal, false);
  const notSub = parsePortalEmail({ messageId: '<s3@x.example>', from: 'x@fakegst.gov.in', text: '' });
  assert.equal(notSub.isPortal, false);
});

test('the portal sender pattern can be changed', () => {
  const opts = { portalSenders: /@notices\.portal\.example$/i };
  assert.equal(parsePortalEmail({ messageId: '<p1@x>', from: 'a@notices.portal.example' }, opts).isPortal, true);
  assert.equal(parsePortalEmail({ messageId: '<p2@x>', from: 'donotreply@gst.gov.in' }, opts).isPortal, false);
  assert.equal(parsePortalEmail({ messageId: '<p3@x>', from: 'donotreply@gst.gov.in' }, { portalSenders: /gst\.gov\.in$/gi }).isPortal, true);
  assert.equal(DEFAULT_PORTAL_SENDERS.test('a@b.services.gst.gov.in'), true);
});

test('a quoted portal e-mail ("On … wrote:") counts like a forward', () => {
  const e = parsePortalEmail({
    messageId: '<q@x.example>',
    from: 'client@example-weaving.example',
    subject: 'Re: Notice',
    text: 'Please handle.\n\nOn Fri, 2 Oct 2026 at 10:14, GST Network <\ndonotreply@gst.gov.in> wrote:\n> Dear Taxpayer,\n> GSTIN: 24ZZZZA0001A1ZZ\n> Reference No.: ZD241026000123A\n',
  });
  assert.equal(e.isPortal, true);
  assert.equal(e.reference, 'ZD241026000123A');
  assert.equal(e.snippet, 'Dear Taxpayer, GSTIN: 24ZZZZA0001A1ZZ Reference No.: ZD241026000123A');
});

test('a From: line that is not a forwarded header block does not make an e-mail a portal one', () => {
  const e = parsePortalEmail({
    messageId: '<n@x.example>',
    from: 'someone@client.example',
    text: 'We got a mail\nFrom: donotreply@gst.gov.in\nlast week about something.',
  });
  assert.equal(e.isPortal, false);
});

test('snippet: own text only — quoted lines, reply history and the "-- " signature are dropped', () => {
  const e = parsePortalEmail({
    messageId: '<sn@x.example>',
    from: 'donotreply@gst.gov.in',
    text: 'Dear Taxpayer,\n\n  The   notice\tis issued.\n> quoted line\n-- \nGST Network signature\n',
  });
  assert.equal(e.snippet, 'Dear Taxpayer, The notice is issued.');
  const reply = parsePortalEmail({
    messageId: '<sn2@x.example>',
    text: 'New text here.\n\n-----Original Message-----\nFrom: a@b.example\nSent: Monday\nOld text',
  });
  assert.equal(reply.snippet, 'New text here.');
  const long = parsePortalEmail({ messageId: '<sn3@x.example>', text: 'word '.repeat(300) });
  assert.equal(long.snippet.length, 399, '400 characters, the trailing space trimmed');
});

test('an OTP e-mail keeps its digits out of the subject and snippet', () => {
  const e = parsePortalEmail({
    messageId: '<otp@x.example>',
    from: 'donotreply@gst.gov.in',
    subject: 'OTP 482913 for filing GSTR-3B',
    text: 'Your one time password is 482913. It is valid for 10 minutes.',
  });
  assert.ok(!e.subject.includes('482913') && !e.snippet.includes('482913'), `${e.subject} / ${e.snippet}`);
  assert.ok(e.snippet.includes('valid for 10 minutes'), 'short numbers stay');
});

test('received time: Date, ISO string or epoch; null when missing or invalid', () => {
  const at = (date: Date | string | number | null) => parsePortalEmail({ messageId: '<d@x>', date }).receivedAt;
  assert.equal(at(new Date('2026-10-06T10:00:00+05:30')), '2026-10-06T04:30:00.000Z');
  assert.equal(at('2026-10-06T04:30:00Z'), '2026-10-06T04:30:00.000Z');
  assert.equal(at(Date.UTC(2026, 9, 6, 4, 30)), '2026-10-06T04:30:00.000Z');
  assert.equal(at(null), null);
  assert.equal(at('not a date'), null);
});

test('hostile input stays fast (no regex runs quadratic)', () => {
  const started = performance.now();
  parsePortalEmail({ messageId: '<big1@x>', from: 'donotreply@gst.gov.in', text: ' '.repeat(256 * 1024) + 'x' });
  parsePortalEmail({ messageId: '<big2@x>', text: 'From: x@y.example\nSent: Monday\n'.repeat(5000) });
  htmlToText('<div'.repeat(128 * 1024));
  htmlToText('<!--'.repeat(128 * 1024));
  htmlToText('<style>' + ('</' + ' '.repeat(200)).repeat(2000));
  parsePortalEmail({ messageId: '<big3@x>', html: '<p>'.repeat(100_000) + 'GSTIN 24ZZZZA0001A1ZZ' });
  assert.ok(performance.now() - started < 3000, `took ${Math.round(performance.now() - started)} ms`);
});

test('text for the database: no control characters, no half emoji', () => {
  const e = parsePortalEmail({
    messageId: '<c\u0000@x.example>',
    from: 'donotreply@gst.gov.in',
    subject: 'Notice\u0000 \u0007issued',
    text: 'a'.repeat(399) + '😀 tail',
  });
  assert.equal(e.messageId, '<c@x.example>');
  assert.equal(e.subject, 'Notice issued');
  assert.equal(e.snippet, 'a'.repeat(399), 'the emoji cut in half at 400 is dropped');
});
