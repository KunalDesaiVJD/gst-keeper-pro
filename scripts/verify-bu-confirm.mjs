#!/usr/bin/env node
// Checks the browser side of the BU agreement value confirmation (firm's
// request of 21 Oct 2026; docs/BUILDER_GST_POSITIONS.md section 6):
//  - the To / CC boxes read "Name <address>" pastes from Outlook (quoted names
//    with commas too), refuse what Graph would refuse, with the same pattern
//    as the database (builder_bu_confirm_email_ok), and know the firm's own
//    addresses (src/lib/builderConfirmRules.ts);
//  - the pop-up drops a unit answered since BU Events loaded (its statuses are
//    read again on opening and after a refused send), sends the statuses it
//    showed, leaves out a unit confirmed or accepted meanwhile and sends
//    again, but stops on a unit disputed meanwhile and shows it (round 2);
//    it asks the database which typed addresses are the firm's own, and says
//    "no e-mail on record" only when the master is empty
//    (src/components/builder/SendAgreementConfirmDialog.tsx,
//    src/lib/builderAgreementConfirmData.ts);
//  - the public page asks for a code e-mailed to the reader's address and
//    sends the proof with each answer (round 2), leaves a unit whose dispute
//    box is open out of "Confirm all", keeps the other drafts when one unit is
//    answered, and does not say "every unit has an answer" when some were
//    moved to a newer e-mail (src/pages/AgreementConfirmPage.tsx);
//  - round 3: the pop-up sends each unit's request and words a colleague's
//    request sent meanwhile as that, with its To and CC; it shows why Send is
//    off; the page types a code back with its code_id, says so when the code
//    may not have gone, wraps long addresses and notes at phone width, and
//    says an answer given there stands;
//  - round 4: BU Events and the pop-up say when a unit's e-mail failed or is
//    still queued (not "Asked"), flag every such request on the event, and a
//    failed send speaks of the request's own units; the public page keeps its
//    code step per link, so a closed tab or a reload does not lose the code
//    already e-mailed or the proof;
//  - follow-up (20261021160000): the pop-up reads the event's requests again
//    when it opens (badges, the failed-To hint and the To it fills come from
//    them; a unit asked in a request the page had not loaded says so); a
//    per-unit e-mail of before 21 Oct 2026 that failed is not "Asked" and its
//    link is not said to answer; a failed send speaks of each unit's earlier
//    link; the proof is kept only in sessionStorage (not for a new tab); a
//    reload after the mailer did not report back does not say the code was
//    e-mailed; each code's e-mail is named by its reference (codeRef).
// The database side is tested in supabase/tests/bu_confirm/run.sh.
//
//   node scripts/verify-bu-confirm.mjs
//
// Prints pass / fail; exits 1 on any failure.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.GSTK_ROOT || path.resolve(here, '..');
const { build } = createRequire(path.join(root, 'package.json'))('esbuild');

let failed = 0;
const check = (ok, label, info = '') => {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${label}${ok || !info ? '' : `  (${info})`}`);
  if (!ok) failed++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// A section whose rules are missing (an older tree, GSTK_ROOT) fails as a whole, not the script.
const guard = (label, fn) => {
  try { fn(); } catch (e) { check(false, `${label}: ${e.message}`); }
};

const out = await build({
  entryPoints: [path.join(root, 'src/lib/builderConfirmRules.ts')],
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error',
});
const R = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const src = (p) => readFileSync(path.join(root, p), 'utf8');

// ── Addresses ───────────────────────────────────────────────────────────────
const parse = (t) => R.parseEmailList(t);
let r = parse('Rajesh Shah <rajesh@client.com>; Accounts <accounts@client.com>');
check(same(r, { valid: ['rajesh@client.com', 'accounts@client.com'], invalid: [] }), 'Outlook "Name <addr>; Name <addr>" gives both addresses', JSON.stringify(r));
r = parse('"Shah, Rajesh" <Rajesh@Client.com>, accounts@client.com');
check(same(r, { valid: ['rajesh@client.com', 'accounts@client.com'], invalid: [] }), 'a quoted name with a comma', JSON.stringify(r));
r = parse('Rajesh Shah <owner@client.test>; accounts@client.test');
check(same(r, { valid: ['owner@client.test', 'accounts@client.test'], invalid: [] }), 'a name and a bare address mixed', JSON.stringify(r));
r = parse(' Owner@Client.test ;\naccounts@client.test  partner@client.test,, owner@client.test ');
check(same(r, { valid: ['owner@client.test', 'accounts@client.test', 'partner@client.test'], invalid: [] }),
  'commas, semicolons, new lines and spaces; lower case; each once', JSON.stringify(r));
// Outlook's unquoted "Last, First <address>" (round 2, defect: refused as "shah, mehta").
r = parse('Shah, Rajesh <rajesh@client.test>; Mehta, Priya <priya@client.test>');
check(same(r, { valid: ['rajesh@client.test', 'priya@client.test'], invalid: [] }), 'unquoted "Last, First <addr>; Last, First <addr>"', JSON.stringify(r));
r = parse('Shah, Rajesh <rajesh@client.test>, accounts@client.test, Mehta, Priya <priya@client.test>');
check(same(r, { valid: ['rajesh@client.test', 'accounts@client.test', 'priya@client.test'], invalid: [] }), 'the same, comma separated, a bare address between', JSON.stringify(r));
r = parse('Shah, Rajesh, Sr. <rajesh@client.test>');
check(same(r, { valid: ['rajesh@client.test'], invalid: [] }), 'two commas in one name', JSON.stringify(r));
r = parse('garbage; Name <a@client.test>');
check(same(r, { valid: ['a@client.test'], invalid: ['garbage'] }), 'a stray word before a semicolon is still reported', JSON.stringify(r));
r = parse('garbage, other@client.test');
check(same(r, { valid: ['other@client.test'], invalid: ['garbage'] }), 'and before a bare address', JSON.stringify(r));
r = parse('Owner@Client.test; accounts@client.test, bad-address');
check(same(r, { valid: ['owner@client.test', 'accounts@client.test'], invalid: ['bad-address'] }), 'a bad master address is reported, not dropped', JSON.stringify(r));
check(same(parse(''), { valid: [], invalid: [] }) && same(parse(' ;, '), { valid: [], invalid: [] }), 'blank boxes give nothing');

// The same refusals and acceptances as supabase/tests/bu_confirm/test_10_send.sql.
const refused = ['user@domain..com', 'user@.domain.com', '.user@domain.com', 'us..er@domain.com', 'user.@domain.com',
  'user@-domain.com', 'user@domain-.com', 'user@domain.c', 'user@domain.com.', 'user@domain', 'user@@domain.com',
  'us er@domain.com', 'user@dom_ain.com', 'user@domain.123', '<user@domain.com>', `${'a'.repeat(65)}@domain.com`];
for (const a of refused) check(!R.emailOk(a), `refused: ${a}`);
for (const a of ["o'brien+bu@sub.client-co.in", 'a.b-c_d@x.co', 'Owner@Client.Test', 'a@b.xn--p1ai', '1@2.com']) check(R.emailOk(a), `accepted: ${a}`);

// The browser's pattern is the database's.
const mig = src('supabase/migrations/20261021140000_bu_confirm_cc.sql');
const m = /p ~ \('([^]*?)'\s*\|\|\s*'([^]*?)'\);/.exec(mig);
const sqlRe = m ? (m[1] + m[2]).replace(/''/g, "'") : null;
check(sqlRe !== null && sqlRe === R.EMAIL_RE.source, 'EMAIL_RE is the pattern of builder_bu_confirm_email_ok', `${sqlRe} vs ${R.EMAIL_RE.source}`);

check(R.isFirmAddress('gst@vjdesai.com') && R.isFirmAddress(' Junior@VJDesai.com ') && R.isFirmAddress('a@mail.vjdesai.com'), 'the firm\'s domain and subdomains are the firm\'s');
check(!R.isFirmAddress('a@notvjdesai.com') && !R.isFirmAddress('vjdesai.com@client.com'), 'look-alikes are not');
const mig2 = /= '([a-z.]+)'\s*\n\s*OR split_part\(lower\(btrim\(COALESCE\(p, ''\)\)\), '@', 2\) LIKE '%\.([a-z.]+)'/.exec(mig);
check(mig2 && mig2[1] === R.FIRM_DOMAIN && mig2[2] === R.FIRM_DOMAIN, 'the database knows the same firm domain', mig2 ? mig2.slice(1).join(',') : 'not found');

// The client master's e-mail (round 2, defect: "no e-mail on record" shown next to the invalid one it holds).
check(R.masterState(null) === null && R.masterState({ valid: [], invalid: [] }) === 'empty', 'an empty master is "empty"');
check(R.masterState(parse('accounts@client')) === 'invalid', 'a master holding only an invalid address is "invalid", not "empty"');
check(R.masterState(parse('accounts@client.test; bad')) === 'ok', 'one good address is enough');

// ── The pop-up's units ──────────────────────────────────────────────────────
const cand = (n, status) => ({ unitId: `u${n}`, unitNo: `A-10${n}`, agreementValue: 100 * n, status });
const page = [cand(1, 'PENDING'), cand(2, 'PENDING'), cand(3, 'NOT_SENT')];
check(same(R.freshCandidates(page, null), page), 'not read yet: the page\'s list as it is');
const fresh = [
  { unitId: 'u1', status: 'CONFIRMED', disputeNotes: null, respondedByName: 'Rajesh' },
  { unitId: 'u2', status: 'DISPUTED', disputeNotes: 'Now 54 lakh', respondedByName: 'Meena' },
];
const shown = R.freshCandidates(page, fresh);
check(same(shown.map((c) => `${c.unitNo}:${c.status}`), ['A-102:DISPUTED', 'A-103:NOT_SENT']),
  'a unit confirmed since the page loaded is left out; the others show their status now', JSON.stringify(shown));
check(shown[0].disputeNotes === 'Now 54 lakh' && shown[0].respondedByName === 'Meena', 'with the dispute and who raised it');
check(R.freshCandidates(page, [{ unitId: 'u3', status: 'OVERRIDDEN' }]).every((c) => c.unitId !== 'u3'), 'an accepted unit is left out too');

// What the pop-up showed goes with the send (round 2, defect: a dispute given while it was open was wiped).
check(same(R.seenFor([{ unitId: 'u1', status: 'PENDING' }, { unitId: 'u2', status: 'DISPUTED', respondedAt: '2026-10-21T06:00:00.123456+00:00' }]),
  { u1: { status: 'PENDING', responded_at: null }, u2: { status: 'DISPUTED', responded_at: '2026-10-21T06:00:00.123456+00:00' } }),
  'seenFor: status and answer time per unit');
const split = R.splitAnswered([{ unitNo: 'A-101', status: 'CONFIRMED' }, { unitNo: 'A-102', status: 'DISPUTED' }, { unitNo: 'A-103', status: 'OVERRIDDEN' }]);
check(same(split.cleared.map((a) => a.unitNo), ['A-101', 'A-103']) && same(split.changed.map((a) => a.unitNo), ['A-102']),
  'answered meanwhile: confirmed and accepted are dropped, a dispute stops the send');
check(fresh.length && R.freshCandidates(page, [{ unitId: 'u2', status: 'DISPUTED', respondedAt: 't1' }])[1].respondedAt === 't1',
  'the pop-up keeps each unit\'s answer time, to send it back');
// Failed first send (round 2, defect: "the earlier link still takes answers" when there was none).
check(R.failedMailWords(false, ['A-103']) === 'No earlier link to A-103 has reached the client.',
  'no earlier link: says no link to the request\'s own units reached the client', R.failedMailWords(false, ['A-103']));
// Round 4 (low, s1): A-101 confirmed and A-102 accepted from an earlier e-mail; a send for A-103 fails.
check(!/No e-mail has reached the client/.test(R.failedMailWords(false, ['A-103'])) && R.failedMailWords(false).includes('these units'),
  'never "no e-mail has reached the client" when an earlier one about other units was answered');

// Round 3 (low): a colleague's request sent while the pop-up was open is not "answered ... (changed)".
check(same(R.seenFor([{ unitId: 'u1', status: 'PENDING', requestId: 'r1' }, { unitId: 'u2', status: 'NOT_SENT', requestId: null }, { unitId: 'u3', status: 'PENDING' }]),
  { u1: { status: 'PENDING', responded_at: null, request_id: 'r1' }, u2: { status: 'NOT_SENT', responded_at: null, request_id: null },
    u3: { status: 'PENDING', responded_at: null } }),
  'seenFor sends each unit\'s request when the pop-up knows it, and none when it does not');
check(R.freshCandidates(page, [{ unitId: 'u1', status: 'PENDING', requestId: 'r9' }])[0].requestId === 'r9', 'the pop-up keeps each unit\'s request');
const asked = { unitNo: 'A-101', status: 'PENDING', respondedByName: null, requestTo: ['priya@client.test'], requestCc: ['accounts@client.test'] };
check(R.meanwhileWords?.(asked) === 'A-101 (asked meanwhile in another request to priya@client.test, CC accounts@client.test)',
  'a unit a colleague asked about: "asked meanwhile in another request to <To>, CC <CC>"', R.meanwhileWords?.(asked));
check(R.meanwhileWords?.({ unitNo: 'A-102', status: 'DISPUTED', respondedByName: 'Meena', respondedByEmail: 'meena@ca.test' }) === 'A-102 (disputed by Meena, meena@ca.test)',
  'a dispute keeps its words');
check(R.meanwhileWords?.({ unitNo: 'A-103', status: 'OVERRIDDEN' }) === 'A-103 (accepted by the firm)', 'an acceptance too');
check(!/changed/.test(R.meanwhileWords?.(asked)) && !/Answered/.test(R.meanwhileHeading?.([asked])), 'never "answered" or "changed" when nobody answered');
check(R.meanwhileHeading?.([asked]) === 'Asked meanwhile in another request, so nothing was sent:'
  && R.meanwhileHeading?.([{ status: 'DISPUTED' }]) === 'Answered since this pop-up opened, so nothing was sent:'
  && /Answered or asked again/.test(R.meanwhileHeading?.([asked, { status: 'DISPUTED' }])), 'the heading says which happened');
check(/earlier link still takes answers/.test(R.failedMailWords(true)), 'an earlier link: says it still answers');

const dialog = src('src/components/builder/SendAgreementConfirmDialog.tsx');
check(/seen: seenFor\(ticked\)/.test(dialog), 'the pop-up sends the statuses it showed');
check(/requestId: c\?\.requestId \?\? null/.test(src('src/pages/BuilderBuEventsPage.tsx')), 'BU Events gives the pop-up each unit\'s request');
check(/meanwhileHeading\(changedNotice\)/.test(dialog) && /meanwhileWords\(a\)/.test(dialog) && !/'changed'\}`/.test(dialog),
  'the pop-up words what happened meanwhile from the rules');
// Round 3 (low): a disabled Send shows no tooltip, so the reason is a line of its own.
check(/\{problem && !problemShown && \(\s*<p className="text-xs text-destructive"[^>]*>\{problem\}<\/p>/.test(dialog),
  'the reason Send is off is shown above the buttons when no hint says it');
check(/\(!toList\.valid\.length && master === 'empty'\)/.test(dialog) && /\(everyone\.length > 0 && !outsideFirm\.length\)/.test(dialog),
  'and not twice when a hint under a box already says it');
check(/res\.status === 'changed'[\s\S]{0,600}?setChangedNotice\(res\.changed\)[\s\S]{0,300}?next\.delete\(c\.unitId\)[\s\S]{0,500}?void reloadUnits\(\);\s*return;/.test(dialog),
  'a dispute given meanwhile stops the send: shown, unticked, list reloaded, pop-up kept open');
check(/Sending asks again and clears this dispute\. It stays in the unit's history\./.test(dialog), 'a ticked disputed unit says sending clears it');
check(/fetchFirmAddresses\(userId/.test(dialog) && /isFirmAddress\(a\) \|\| dbFirm\.includes\(a\)/.test(dialog),
  'the pop-up asks the database which addresses are the firm\'s own (a staff member\'s personal one)');
check(/master === 'empty' \?/.test(dialog) && !/fromMaster/.test(dialog), '"no e-mail on record" only when the master is empty');
check(/failedMailWords\(res\.earlierLink, sentNos, earlierNos\)/.test(dialog), 'the failed toast speaks of an earlier link only when there is one, and of its units');
const events = src('src/pages/BuilderBuEventsPage.tsx');
check(/onSent=\{\(\) => void load\(true\)\}/.test(events) && /if \(!quiet\) setIsLoading\(true\);/.test(events),
  'BU Events refreshes quietly after a send, so the pop-up (and what staff typed, and a dispute it shows) stays');
check(/failedMailWords\(lastReq\.earlierLink, lastReq\.unitIds\.map\(unitNoOf\), lastReq\.earlierUnits\?\.map\(unitNoOf\)\)/.test(events),
  'the Last request line speaks of an earlier link only when there is one, per unit');
check(/Earlier disputed/.test(events) && /fetchClearedDisputes\(ids\)/.test(events), 'BU Events shows a dispute asked about again');
check(/fetchAgreementConfirmationStatus\(eventId\)/.test(dialog) && /const reqs = await reloadUnits\(\);/.test(dialog),
  'the pop-up reads the statuses again each time it opens');
check(/freshCandidates\(candidates, fresh\)/.test(dialog), 'and lists the units from them');
check(/else if \(!res\.requestId\) \{[\s\S]{0,400}?onSent\(\);\s*void reloadUnits\(\);\s*return;/.test(dialog), 'a refused send refreshes BU Events and the list');
check(!/open it again/.test(dialog + mig), 'nobody is told to close the window and open it again');
check(!/ca@firm/.test(dialog), 'the CC box does not suggest a firm address');
check(/toEdited \? ''/.test(dialog), 'the "from the client master" words go once the To box is edited');
check(/masterInvalid/.test(dialog), 'a bad master address is shown');

const data = src('src/lib/builderAgreementConfirmData.ts');
check(/p_seen: /.test(data), 'the send passes the statuses to the database');
check(/if \(changed\.length\) \{[\s\S]{0,300}?status: 'changed'/.test(data), 'a unit answered meanwhile other than confirmed or accepted is never re-sent automatically');
check(/res\.sent !== false\) break;/.test(data) && /units = left;/.test(data), 'a send that finds units answered meanwhile drops them and sends again');
check(/left\.length === units\.length\) return refuse/.test(data), 'and never loops without progress');

// ── Round 4 (medium, s2): was a pending unit really asked? ──────────────────
// R1 asks A-101 and A-102 (sent); R2 asks A-103 To a mistyped address (550);
// the owner disputes A-101 on R1 and staff ask it again in R3 (sent).
const reqs = [
  { id: 'R3', unitIds: ['u1'], to: ['owner@client.test'], sentAt: '2026-10-21T08:05:00Z', createdAt: '2026-10-21T08:05:00Z',
    mailStatus: 'sent', mailError: null, mailSentAt: '2026-10-21T08:05:09Z', earlierLink: true },
  { id: 'R2', unitIds: ['u3'], to: ['owner@clent.test'], sentAt: '2026-10-21T08:00:00Z', createdAt: '2026-10-21T08:00:00Z',
    mailStatus: 'failed', mailError: '550 recipient rejected', mailSentAt: null, earlierLink: false },
  { id: 'R1', unitIds: ['u1', 'u2'], to: ['owner@client.test'], sentAt: '2026-10-20T08:00:00Z', createdAt: '2026-10-20T08:00:00Z',
    mailStatus: 'sent', mailError: null, mailSentAt: '2026-10-20T08:00:05Z', earlierLink: false },
];
const cfs = [
  { unitId: 'u1', status: 'PENDING', requestId: 'R3' },
  { unitId: 'u2', status: 'PENDING', requestId: 'R1' },
  { unitId: 'u3', status: 'PENDING', requestId: 'R2' },
];
let a = R.unitAsk('u3', cfs[2], reqs);
check(a?.state === 'failed' && a.error === '550 recipient rejected' && a.earlier === null,
  'A-103: its only e-mail failed, never asked', JSON.stringify(a));
a = R.unitAsk('u1', cfs[0], reqs);
check(a?.state === 'asked' && a.at === '2026-10-21T08:05:09Z', 'A-101: asked, dated when its e-mail went', JSON.stringify(a));
a = R.unitAsk('u2', cfs[1], reqs);
check(a?.state === 'asked' && a.at === '2026-10-20T08:00:05Z', 'A-102: asked on R1', JSON.stringify(a));
let no = R.requestsNotOut(reqs, cfs);
check(no.length === 1 && no[0].request.id === 'R2' && same(no[0].unitIds, ['u3']),
  'the event flags R2 (failed, A-103 still waiting on it), though it is not the last request', JSON.stringify(no));
// Queued, and failed after an earlier link went out.
const queued = [{ ...reqs[0], id: 'R4', unitIds: ['u2'], mailStatus: 'pending', mailSentAt: null }, ...reqs];
a = R.unitAsk('u2', { unitId: 'u2', status: 'PENDING', requestId: 'R4' }, queued);
check(a?.state === 'waiting' && a.earlier?.kind === 'request' && a.earlier.at === '2026-10-20T08:00:05Z',
  'a unit whose new e-mail is queued: not sent yet, and the R1 link still answers', JSON.stringify(a));
a = R.unitAsk('u3', { unitId: 'u3', status: 'PENDING', requestId: 'R2', legacyLink: true }, reqs);
check(a?.state === 'failed' && a.earlier?.kind === 'legacy', 'a failed request over a per-unit e-mail of before: that link still answers');
check(R.unitAsk('u1', { unitId: 'u1', status: 'CONFIRMED', requestId: 'R3' }, reqs) === null
  && R.unitAsk('u1', { unitId: 'u1', status: 'PENDING', requestId: null }, reqs) === null, 'nothing to say for an answered unit or an old per-unit row');
check(R.requestsNotOut(reqs, [{ unitId: 'u3', status: 'CONFIRMED', requestId: 'R2' }]).length === 0,
  'a failed request whose units were answered elsewhere is not flagged');
check(R.mailOutcome('skipped') === 'failed' && R.mailOutcome('cancelled') === 'failed' && R.mailOutcome('sending') === 'waiting'
  && R.mailOutcome(null) === 'out', 'outbox statuses read as the database reads them (a gone row is out)');
const eventsSrc = src('src/pages/BuilderBuEventsPage.tsx');
check(/const ask = unitAsk\(r\.unit_id, cf, evRequests\);/.test(eventsSrc) && /E-mail of \$\{shortDate\(ask\.at\)\} failed/.test(eventsSrc)
  && /queued, not sent yet/.test(eventsSrc), 'BU Events: "Asked" only once the unit\'s e-mail is out, else failed or queued');
check(/requestsNotOut\(evRequests, cfRows\)/.test(eventsSrc) && /Waiting on it: /.test(eventsSrc), 'BU Events flags every request not out that units wait on');
const dialogSrc = src('src/components/builder/SendAgreementConfirmDialog.tsx');
check(/unitAsk\(c\.unitId, c, requestsNow\)/.test(dialogSrc) && /' · e-mail failed' : ' · not sent yet'/.test(dialogSrc),
  'the pop-up badges such units "Pending · e-mail failed" or "not sent yet"');
check(/The last e-mail to these addresses failed/.test(dialogSrc), 'and says when the To it fills in from the last request failed');
check(/requests=\{sendFor \? requests\[sendFor\.id\] \|\| \[\] : \[\]\}/.test(eventsSrc), 'BU Events gives the pop-up the event\'s requests');
check(/legacy_emails/.test(src('src/lib/builderAgreementConfirmData.ts')) && /mailSentAt: r\.outbox_id/.test(src('src/lib/builderAgreementConfirmData.ts')),
  'the page reads when each e-mail went and which units an old per-unit e-mail asked');

const pageSrc = src('src/pages/AgreementConfirmPage.tsx');
// ── Round 4 (medium, p4): the code step survives a closed tab ───────────────
guard('the code step', () => {
  const now = Date.UTC(2026, 9, 21, 8, 0, 0);
  const step = { name: 'Rajesh Shah', email: 'owner@client.test', codeSentTo: 'owner@client.test', codeId: '3fa90000-0000-4000-8000-000000000000',
    codeAt: now - 5 * 60e3, codeStatus: 'sent', proof: null, proofEmail: null, proofUntil: null };
  const stored = (st) => R.codeStepForStorage(st);
  let back = R.readCodeStep(stored(step).local, stored(step).session, now);
  check(back?.codeId === step.codeId && back.codeSentTo === 'owner@client.test' && back.name === 'Rajesh Shah' && back.codeStatus === 'sent',
    'a code asked 5 minutes ago is restored', JSON.stringify(back));
  back = R.readCodeStep(stored(step).local, null, now + 30 * 60e3);
  check(back?.codeId === null && back.codeStatus === null && back.email === 'owner@client.test', 'past its 30 minutes the code is dropped, the address kept', JSON.stringify(back));
  const proved = { ...step, proof: 'p', proofEmail: 'owner@client.test', proofUntil: now + 60 * 60e3 };
  back = R.readCodeStep(stored(proved).local, stored(proved).session, now);
  check(back?.proof === 'p' && back.proofEmail === 'owner@client.test', 'a proof still good survives a reload of the tab (sessionStorage)');
  check(R.readCodeStep(stored(proved).local, null, now)?.proof === null,
    'a new tab (no sessionStorage) gets no proof: someone else at the same browser must ask for a code (follow-up, low)');
  check(R.readCodeStep(JSON.stringify(proved), null, now)?.proof === null,
    'a proof left in localStorage by the earlier page is not trusted');
  check(!('proof' in JSON.parse(stored(proved).local)) && !/"p"/.test(stored(proved).local) && JSON.parse(stored(proved).session).proof === 'p',
    'the proof is written to sessionStorage only');
  check(stored({ ...step, name: '', email: '', codeId: null, codeSentTo: null, codeAt: null }).local === null && stored(step).session === null,
    'nothing to keep: nothing written');
  check(R.readCodeStep(stored(proved).local, stored({ ...proved, proofUntil: now - 1 }).session, now)?.proof === null, 'an expired proof is dropped');
  check(R.readCodeStep(null, JSON.stringify({ proof: 'p', proofEmail: 'x@y.z', proofUntil: now + 10 * 3600e3 }), now) === null,
    'a proof claiming to last longer than 2 hours is not trusted');
  check(R.readCodeStep('{not json', null, now) === null && R.readCodeStep(null, null, now) === null && R.readCodeStep('"x"', '[1]', now) === null,
    'nothing usable stored: nothing restored');
  check(R.codeStepKey('abc') === 'bu-confirm:abc', 'one entry per link');
  // The mailer did not report back: a reload says so, not "We e-mailed a code" (follow-up, low).
  const clock = () => '02:15 pm';
  let msg = R.restoredCodeMessage({ ...step, codeStatus: 'unknown' }, clock);
  check(msg?.tone === 'warn' && /^We could not confirm the code asked for at 02:15 pm was sent to owner@client\.test\./.test(msg.text)
    && /e-mail marked DRLK/.test(msg.text) && !/We e-mailed/.test(msg.text), 'a code the mailer did not report on is restored as "could not confirm"', msg?.text);
  msg = R.restoredCodeMessage(step, clock);
  check(msg?.tone === 'ok' && msg.text === 'We e-mailed a code to owner@client.test at 02:15 pm, in the e-mail marked DRLK. Type it below, or ask for a new one.',
    'a code the mailer sent is restored as e-mailed, with its mark', msg?.text);
  check(R.restoredCodeMessage(proved, clock) === null && R.restoredCodeMessage(null, clock) === null, 'nothing to say once proved, or with nothing kept');
  check(R.readCodeStep(R.codeStepForStorage({ ...step, codeStatus: 'unknown' }).local, null, now)?.codeStatus === 'unknown',
    'the send status is kept with the code');
  check(/try \{\s*return storage\(kind\)\.getItem\(key\);\s*\} catch/.test(pageSrc)
    && /try \{\s*if \(value === null\) storage\(kind\)\.removeItem\(key\);\s*else storage\(kind\)\.setItem\(key, value\);\s*\} catch/.test(pageSrc)
    && /kind === 'local' \? window\.localStorage : window\.sessionStorage/.test(pageSrc),
    'every storage access is wrapped');
  check(/readCodeStep\(storeGet\('local', key\), storeGet\('session', key\), Date\.now\(\)\)/.test(pageSrc)
    && /storeSet\('local', key, kept\.local\);\s*storeSet\('session', key, kept\.session\);/.test(pageSrc)
    && /restoredFor !== token\) return;/.test(pageSrc), 'the page restores the step on load and saves it after, the proof in sessionStorage only');
  check(!/window\.localStorage\.setItem/.test(pageSrc) && /codeStepForStorage\(\{/.test(pageSrc), 'nothing else writes localStorage');
  check(/until: Date\.now\(\) \+ PROOF_LIFE_MS/.test(pageSrc) && /setCodeAt\(Date\.now\(\)\)/.test(pageSrc), 'with the code\'s time and the proof\'s end');
  check(/setCodeMessage\(restoredCodeMessage\(step, clockTime\)\)/.test(pageSrc) && /setCodeStatus\(res\.status === 'sent' \? 'sent' : 'unknown'\)/.test(pageSrc),
    'a restored code says where and when it went, and whether it was sure it went');
  check(/const startAgain = \(\) => \{/.test(pageSrc) && (pageSrc.match(/onClick=\{startAgain\}/g) || []).length >= 2,
    '"Not you? Start again" forgets the step');
});

// ── Follow-up (finding of 21 Oct 2026, low): the code's reference ───────────
guard("the code's reference", () => {
  check(R.codeRef('3fa90000-0000-4000-8000-000000000000') === 'DRLK', 'codeRef: the same letters as the database and the e-mail (DRLK)');
  check(R.codeRef('0123ABCD-ef01-4000-8000-000000000000') === 'ABCD' && /^[A-HJ-NP-R]{4}$/.test(R.codeRef('ffffeeee-0000-4000-8000-000000000000')),
    'four letters, never a digit, an I or an O');
  const followMig = src('supabase/migrations/20261021160000_bu_confirm_followup.sql');
  check(/translate\(left\(replace\(lower\(p_id::text\), '-', ''\), 4\), '0123456789abcdef', 'ABCDEFGHJKLMNPQR'\)/.test(followMig)
    && /const map = '0123456789abcdef';\s*const to = 'ABCDEFGHJKLMNPQR';/.test(src('supabase/functions/bu-confirm-code/message.ts')),
    'the database and the e-mail map the id the same way');
  check(/Type the code from our e-mail marked <strong[^>]*>\{codeRef\(codeId\)\}<\/strong>/.test(pageSrc), 'the page shows the mark next to the Code box');
  check(!/latest e-mail/.test(followMig.slice(followMig.indexOf('FUNCTION public.builder_bu_confirm_code_verify'))), 'no message says "the latest e-mail"');
});

// ── Follow-up (medium): per-unit e-mails of before 21 Oct 2026 that failed ──
guard('per-unit e-mails that failed', () => {
  const legacyFailed = { mail: 'failed', error: '550 5.1.1 recipient rejected', at: '2026-10-18T06:00:00Z' };
  a = R.unitAsk('u1', { status: 'PENDING', requestId: null, legacyLink: false, legacy: legacyFailed }, []);
  check(a?.state === 'failed' && a.error === '550 5.1.1 recipient rejected' && a.earlier === null,
    'an old per-unit row whose e-mail failed: "E-mail of … failed", not "Asked"', JSON.stringify(a));
  a = R.unitAsk('u1', { status: 'PENDING', requestId: null, legacyLink: true, legacy: { mail: 'out', error: null, at: '2026-10-18T06:00:05Z' } }, []);
  check(a?.state === 'asked' && a.at === '2026-10-18T06:00:05Z', 'one whose e-mail went: asked, dated when it went', JSON.stringify(a));
  a = R.unitAsk('u1', { status: 'PENDING', requestId: null, legacyLink: false, legacy: { mail: 'waiting', error: null, at: null } }, []);
  check(a?.state === 'waiting', 'one whose e-mail waits: queued');
  const failedReq = [{ id: 'R9', unitIds: ['u1'], to: ['owner@client.test'], sentAt: '2026-10-21T08:00:00Z', createdAt: '2026-10-21T08:00:00Z',
    mailStatus: 'failed', mailError: '550', mailSentAt: null, earlierLink: false }];
  a = R.unitAsk('u1', { status: 'PENDING', requestId: 'R9', legacyLink: false, legacy: legacyFailed }, failedReq);
  check(a?.state === 'failed' && a.earlier === null,
    'a failed request over a per-unit e-mail that failed: no link reached the client (not "the per-unit link still takes answers")', JSON.stringify(a));
  a = R.unitAsk('u1', { status: 'PENDING', requestId: 'R9', legacyLink: true, legacy: legacyFailed }, failedReq);
  check(a?.earlier === null, 'even if a caller says legacyLink, a failed per-unit e-mail is not an earlier link');
  check(R.freshCandidates([{ unitId: 'u1', unitNo: 'A-101', status: 'PENDING' }], [{ unitId: 'u1', status: 'PENDING', legacy: legacyFailed }])[0].legacy === legacyFailed,
    'the pop-up keeps the per-unit e-mail\'s status');
  check(/legacy_outbox_id/.test(data) && /from\('email_outbox'\)\.select\('id, status, error, sent_at'\)\.in\('id', legacyIds\)/.test(data)
    && /legacyLink: !!legacy && legacy\.mail === 'out'/.test(data), 'BU Events reads the status of each per-unit e-mail, a link only when it went');
  check(!/Asked \{shortDate\(cf\.sentAt\)\}/.test(eventsSrc) && /if \(!ask\) return null;/.test(eventsSrc), 'no "Asked <date>" from the row alone');
  check(/legacy: c\?\.legacy \?\? null/.test(eventsSrc), 'BU Events gives the pop-up each unit\'s per-unit e-mail status');
});

// ── Follow-up (low): a failed send speaks of each unit's earlier link ───────
guard('failed words per unit', () => {
  check(R.failedMailWords(true, ['A-101', 'A-102', 'A-103'], ['A-101'])
    === 'The earlier link still takes answers for A-101 until an e-mail goes out. No link to A-102, A-103 has reached the client.',
    'A-101 had a link, A-102 and A-103 never did: said per unit', R.failedMailWords(true, ['A-101', 'A-102', 'A-103'], ['A-101']));
  check(R.failedMailWords(true, ['A-101', 'A-102'], ['A-101', 'A-102']) === 'The earlier link still takes answers for A-101, A-102 until an e-mail goes out.',
    'every unit had one: no "no link" sentence');
  check(R.failedMailWords(false, ['A-103'], []) === 'No earlier link to A-103 has reached the client.', 'none had one');
  check(R.failedMailWords(true, ['A-101'], null) === 'The earlier link still takes answers until an e-mail goes out.', 'a request sent before the change: as before');
  check(/earlier_units/.test(data) && /earlierUnits: Array\.isArray\(res\.earlier_units\)/.test(data) && /earlierUnits: Array\.isArray\(r\.earlier_units\)/.test(data),
    'the send and the requests carry earlier_units');
  check(/failedMailWords\(rq\.earlierLink, nos, earlierNos\)/.test(eventsSrc), 'every request line on the event speaks per unit too');
});

// ── Follow-up (medium): the pop-up reads the requests again ─────────────────
guard('the pop-up reads the requests again', () => {
  check(/fetchConfirmRequests\(\[eventId\]\)/.test(dialogSrc) && /setFreshRequests\(reqs\)/.test(dialogSrc), 'the pop-up reads the event\'s requests when it opens');
  check(/const last = \(reqs && \(reqs\.length \|\| !requests\.length\) \? reqs\[0\] : lastRequest\) \?\? null;/.test(dialogSrc)
    && /setFilledFrom\(last\)/.test(dialogSrc) && !/if \(lastRequest\) \{/.test(dialogSrc),
    'To is filled from the last request as it is now (the page\'s only when they cannot be read)');
  check(/filledNow && mailOutcome\(filledNow\.mailStatus\) === 'failed'/.test(dialogSrc), 'the failed-To hint reads that request\'s status now');
  const known = ['R1'];
  const freshReqs = [{ id: 'R2', to: ['priya@client.test'], cc: ['accounts@client.test'] }, { id: 'R1', to: ['owner@client.test'], cc: [] }];
  check(R.unseenRequest('R2', freshReqs, known)?.id === 'R2' && R.unseenRequest('R1', freshReqs, known) === null
    && R.unseenRequest('R2', null, known) === null && R.unseenRequest(null, freshReqs, known) === null,
    'a unit on a request the page had not loaded is found');
  check(R.unseenRequestWords(freshReqs[0]) === 'Asked since this page loaded, in another request to priya@client.test, CC accounts@client.test.',
    'and worded with its To and CC');
  check(/unseenRequest\(c\.requestId, freshRequests, knownIds\)/.test(dialogSrc) && /\{unseenRequestWords\(unseen\)\}/.test(dialogSrc),
    'the pop-up shows it under the unit');
  check(/sent since this page loaded/.test(dialogSrc), 'and says when the To it filled in is from such a request');
});

// ── The public page ─────────────────────────────────────────────────────────
const pu = (id, state, v = 100) => ({ unit_id: id, state, agreement_value: v });
const units = [pu('a', 'PENDING'), pu('b', 'PENDING'), pu('c', 'PENDING'), pu('d', 'CONFIRMED')];
check(same(R.confirmAllTargets(units, []), ['a', 'b', 'c']), 'Confirm all: every open unit');
check(same(R.confirmAllTargets(units, ['b']), ['a', 'c']), 'a unit whose dispute box is open is left out of Confirm all');
check(same(R.confirmAllTargets(units, new Set(['a', 'b', 'c'])), []), 'every open unit disputing: nothing to confirm');

let s = R.pageSummary([pu('a', 'CONFIRMED', 4500000), pu('b', 'REPLACED', 5200000)]);
check(!s.allAnswered && s.restReplaced && s.totalLabel === 'Total of units still on this link' && s.total === 4500000,
  'partly replaced: not "every unit here has an answer", and the total says which units', JSON.stringify(s));
s = R.pageSummary([pu('a', 'CONFIRMED'), pu('b', 'ACCEPTED')]);
check(s.allAnswered && !s.restReplaced && s.totalLabel === 'Total', 'all answered, none replaced');
s = R.pageSummary([pu('a', 'REPLACED'), pu('b', 'REPLACED')]);
check(s.allReplaced && !s.restReplaced, 'all replaced');
s = R.pageSummary([pu('a', 'PENDING'), pu('b', 'REPLACED')]);
check(!s.allAnswered && !s.restReplaced && s.open === 1, 'an open unit: the form, not a summary');

const pg = src('src/pages/AgreementConfirmPage.tsx');
// Round 2 (defect: anyone holding the link answered as the client by typing their address).
check(/askConfirmCode\(token, person\.e\)/.test(pg) && /verifyConfirmCode\(token, codeSentTo, code, codeId\)/.test(pg), 'the page e-mails a code and checks it');
// Round 3 (low): only the page that asked can try a code.
check(/setCodeId\(res\.codeId\)/.test(pg) && /_code_id: codeId/.test(data), 'the code goes back with the id only the asking page has');
check(/res\.status === 'sent'\s*\?[\s\S]{0,300}?We have e-mailed[\s\S]{0,300}?We could not confirm the code was sent/.test(pg),
  'a code the mailer did not report on is not said to be e-mailed');
check(/grid grid-cols-1 gap-3 sm:grid-cols-2/.test(pg) && (pg.match(/\[overflow-wrap:anywhere\]/g) || []).length >= 5 && /min-w-0 space-y-1/.test(pg),
  'long addresses, notes and links wrap at phone width (one column of minmax(0,1fr), min-w-0, overflow-wrap)');
check(/An answer given here stands\. If you think it is wrong, write to us at \{GST_FIRM\.email\}\./.test(pg), 'the page says an answer given there stands');
check(/_proof: proved\.proof/.test(pg), 'every answer carries the proof');
check(/proof\.email === typedEmail/.test(pg), 'the proof holds only for the address it was given for');
check(/const busy = savingUnit !== null \|\| !proved;/.test(pg), 'no answer buttons until the address is checked');
check(/functions\.invoke\('bu-confirm-code', \{ body: \{ code_id: codeId \} \}\)/.test(data), 'the code goes through the Edge Function, by its id only');
const migr = mig;
check(!/builder_bu_confirm_code_request[\s\S]{0,4000}?email_outbox/.test(migr.slice(migr.indexOf('FUNCTION public.builder_bu_confirm_code_request'), migr.indexOf('FUNCTION public.builder_bu_confirm_code_claim'))),
  'the code request never writes email_outbox');
check(/confirmAllTargets\(page\.units, disputing\)/.test(pg) && /allTargets\.map\(\(id\) => \(\{ unit_id: id, action: 'CONFIRM'/.test(pg),
  'the page\'s Confirm all sends only those units');
check(/Confirm the other/.test(pg), 'and says so on the button');
check(/filter\(\(\[id\]\) => !answered\.has\(id\)\)/.test(pg) && !/setDisputeNotes\(''\)/.test(pg),
  'answering one unit keeps the other units\' dispute drafts');
check(/summary\.restReplaced \?/.test(pg), 'a partly replaced link says the others moved to a newer e-mail');
check(/If you have not received it/.test(pg), 'the replaced wording says what to do if the newer e-mail never came');

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
