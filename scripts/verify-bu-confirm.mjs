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
//    moved to a newer e-mail (src/pages/AgreementConfirmPage.tsx).
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
check(R.failedMailWords(false) === 'No e-mail has reached the client yet.', 'no earlier link: says no e-mail reached the client');
check(/earlier link still takes answers/.test(R.failedMailWords(true)), 'an earlier link: says it still answers');

const dialog = src('src/components/builder/SendAgreementConfirmDialog.tsx');
check(/seen: seenFor\(ticked\)/.test(dialog), 'the pop-up sends the statuses it showed');
check(/res\.status === 'changed'[\s\S]{0,600}?setChangedNotice\(res\.changed\)[\s\S]{0,300}?next\.delete\(c\.unitId\)[\s\S]{0,500}?void reloadUnits\(\);\s*return;/.test(dialog),
  'a dispute given meanwhile stops the send: shown, unticked, list reloaded, pop-up kept open');
check(/Sending asks again and clears this dispute\. It stays in the unit's history\./.test(dialog), 'a ticked disputed unit says sending clears it');
check(/fetchFirmAddresses\(userId/.test(dialog) && /isFirmAddress\(a\) \|\| dbFirm\.includes\(a\)/.test(dialog),
  'the pop-up asks the database which addresses are the firm\'s own (a staff member\'s personal one)');
check(/master === 'empty' \?/.test(dialog) && !/fromMaster/.test(dialog), '"no e-mail on record" only when the master is empty');
check(/failedMailWords\(res\.earlierLink\)/.test(dialog), 'the failed toast speaks of an earlier link only when there is one');
const events = src('src/pages/BuilderBuEventsPage.tsx');
check(/onSent=\{\(\) => void load\(true\)\}/.test(events) && /if \(!quiet\) setIsLoading\(true\);/.test(events),
  'BU Events refreshes quietly after a send, so the pop-up (and what staff typed, and a dispute it shows) stays');
check(/failedMailWords\(lastReq\.earlierLink\)/.test(events), 'the Last request line speaks of an earlier link only when there is one');
check(/Earlier disputed/.test(events) && /fetchClearedDisputes\(ids\)/.test(events), 'BU Events shows a dispute asked about again');
check(/fetchAgreementConfirmationStatus\(eventId\)/.test(dialog) && /void reloadUnits\(\);\s*\n\s*if \(lastRequest\)/.test(dialog),
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
check(/askConfirmCode\(token, person\.e\)/.test(pg) && /verifyConfirmCode\(token, codeSentTo, code\)/.test(pg), 'the page e-mails a code and checks it');
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
