#!/usr/bin/env node
// Checks that staff are never told a reset link goes to an address it does
// not go to. staff_send_client_reset_link sends to clients.email as saved, so
// Edit Client must name the saved address and keep "E-mail reset link" off
// ("Save the new e-mail first.") while the e-mail field holds an unsaved one.
// The link goes only to the addresses the database's rule (client_email_list)
// accepts, so the screens name only those, and say so when none is usable.
// And a password set from Edit Client goes on the saved row, so the User ID
// staff are told is the saved GSTIN, and a reset waits while a new one is
// typed but not saved. And a request waiting on the Dashboard sends staff only
// to the reset dialog, which every staff level can open and which says why no
// link reached the client (src/lib/clientPasswordReason.ts); the dialog and the
// staff-link error name Edit Client only to staff who can open it. And Edit
// Client's GST-password sync leaves the client's reset link and waiting
// request alone (keepResets -> p_close_resets false).
//
//   node scripts/verify-client-reset-link.mjs
//
// Builds the pure rules (src/lib/clientResetLink.ts, clientPasswordReason.ts)
// with esbuild and runs them, then checks the wiring in EditClientPage,
// ClientAppLoginCard, ResetClientPasswordDialog and the Dashboard's requests. Prints pass / fail; exits 1 on any failure.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.GSTK_ROOT || path.resolve(here, '..');
const { build } = createRequire(path.join(root, 'package.json'))('esbuild');

let failed = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${label}`);
  if (!ok) failed++;
};

const load = async (file) => {
  const out = await build({
    entryPoints: [path.join(root, file)],
    bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error',
  });
  return import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
};
const M = await load('src/lib/clientResetLink.ts');
const R = await load('src/lib/clientPasswordReason.ts');

const src = (p) => readFileSync(path.join(root, p), 'utf8');

// The rule.
const SAVE_FIRST = 'Save the new e-mail first.';
check(M.resetLinkBlock({ saved: 'a@x.com' }) === null, 'a saved address, no form: a link can go');
check(M.resetLinkBlock({ saved: 'a@x.com', typed: 'a@x.com' }) === null, 'form shows the saved address: a link can go');
check(M.resetLinkBlock({ saved: 'a@x.com', typed: ' A@X.com ' }) === null, 'same address, other case or spaces: a link can go');
check(M.resetLinkBlock({ saved: 'a@x.com', typed: 'b@y.com' }) === SAVE_FIRST, 'a new address typed: save it first');
check(M.resetLinkBlock({ saved: 'a@x.com', typed: '' }) === SAVE_FIRST, 'the address cleared but not saved: save first');
check(M.resetLinkBlock({ saved: '', typed: 'new@y.com' }) === SAVE_FIRST, 'an address added but not saved: save first');
check(/^No e-mail address on record/.test(M.resetLinkBlock({ saved: null }) ?? ''), 'no saved address: says so');
check(/^No e-mail address on record/.test(M.resetLinkBlock({ saved: '', typed: '' }) ?? ''), 'none saved, none typed: says so');
check(M.emailUnsaved({ saved: 'a@x.com' }) === false, 'no form: nothing unsaved');
// Edit Client only for staff who can open it (canAddEditClients()).
const EDITS = { canEditClients: true };
const VIEWS = { canEditClients: false };
for (const [saved, what] of [[null, 'no address'], ['', 'an empty address'], ['accounts@sorath.com.', 'no usable address']]) {
  const forViewer = M.resetLinkBlock({ saved }, VIEWS) ?? '';
  check(forViewer !== '' && !/Edit Client/.test(forViewer), `${what}, staff without add_edit_clients: Edit Client never named (${JSON.stringify(forViewer)})`);
  check(/set a password below/.test(forViewer), `  and told to set a password below`);
  const byDefault = M.resetLinkBlock({ saved }) ?? '';
  check(byDefault !== '' && !/Edit Client/.test(byDefault), `${what}, viewer not given: Edit Client never named`);
  check(/Edit Client/.test(M.resetLinkBlock({ saved }, EDITS) ?? ''), `${what}, staff who edit clients: sent to Edit Client`);
}
check(/^No e-mail address on record/.test(M.resetLinkBlock({ saved: null }, VIEWS) ?? '')
  && /^No usable e-mail address on record/.test(M.resetLinkBlock({ saved: 'a@x.c' }, VIEWS) ?? ''),
  'the same opening words whoever looks');
check(M.resetLinkBlock({ saved: 'a@x.com', typed: 'b@y.com' }, VIEWS) === 'Save the new e-mail first.', 'save first, whoever looks');
// Only the addresses the database e-mails (client_email_list).
const NO_USABLE = /^No usable e-mail address on record/;
for (const bad of ['accounts@sorath.com.', 'accounts@sorath.c', 'accounts@sorath', '<a@x.com>', 'a@@x.com']) {
  check(NO_USABLE.test(M.resetLinkBlock({ saved: bad }) ?? ''), `not usable: ${JSON.stringify(bad)} (button off, says so)`);
  check(M.resetLinkAddresses(bad) === '', `  and names no address for ${JSON.stringify(bad)}`);
}
check(M.resetLinkAddresses('a@x.com; b@gmail') === 'a@x.com', 'names only the usable address of two');
check(M.resetLinkAddresses('a@x.com, b@y.co.in;c@z.org  A@X.com') === 'a@x.com, b@y.co.in, c@z.org',
  'commas, semicolons and spaces separate; each address once, first spelling, in order');
check(M.resetLinkBlock({ saved: 'a@x.com; b@gmail' }) === null, 'one usable address is enough');
const mig = src('supabase/migrations/20261020140000_client_password_reset.sql');
const sqlRule = mig.match(/WHERE btrim\(t\.x\) ~ '([^']+)'/)?.[1] ?? '';
const tsRule = (src('src/lib/clientResetLink.ts').match(/const ADDRESS = \/(.+)\/;/)?.[1] ?? '').replaceAll('\\s', '[:space:]');
check(sqlRule !== '' && sqlRule === tsRule, 'the address rule is the database\'s (client_email_list)');
// The GSTIN (User ID).
check(M.gstinUnsaved('24AAACA0001A1Z1', undefined) === false, 'no form: GSTIN not unsaved');
check(M.gstinUnsaved('24AAACA0001A1Z1', ' 24aaaca0001a1z1 ') === false, 'same GSTIN, other case or spaces');
check(M.gstinUnsaved('24AAACA0001A1Z1', '24AAACA0002A1Z2') === true, 'a new GSTIN typed: unsaved');
check(M.emailUnsaved({ saved: 'a@x.com', typed: 'b@x.com' }) === true, 'a different address is unsaved');

const edit = src('src/pages/EditClientPage.tsx');
const card = edit.match(/<ClientAppLoginCard[\s\S]*?\/>/)?.[0] ?? '';
check(card !== '', 'Edit Client shows the Client app login card');
check(/email=\{savedEmail\.current\}/.test(card), 'the card is given the e-mail as saved');
check(!/email=\{formData\.email\}/.test(card), 'never the live form value as the address a link goes to');
check(/typedEmail=\{formData\.email\}/.test(card), 'the form value only as the typed address');
check(/savedEmail\.current = data\.email/.test(edit), 'the saved address is set on load');
check(/savedEmail\.current = formData\.email/.test(edit), 'and again after a save');
check(/gstin=\{savedGstin\.current\}/.test(card) && /name=\{savedName\.current\}/.test(card), 'the card is given the GSTIN and name as saved');
check(!/\bgstin=\{formData\.gstin\}/.test(card) && !/name=\{formData\.name\}/.test(card), 'never the live form values as the User ID');
check(/typedGstin=\{formData\.gstin\}/.test(card), 'the form GSTIN only as the typed one');
check(/savedGstin\.current = data\.gstin/.test(edit) && /savedGstin\.current = formData\.gstin/.test(edit), 'the saved GSTIN is set on load and after a save');
check(/clientEmailList\(formData\.email\)\.length === 0/.test(edit), 'Edit Client refuses to save an address the database would not e-mail');

const cardSrc = src('src/components/clients/ClientAppLoginCard.tsx');
check(/\{ id: clientId, name, gstin, email, typedEmail \}/.test(cardSrc), 'the card passes both to the dialog');
check(/gstinUnsaved\(gstin, typedGstin\)/.test(cardSrc) && /disabled=\{newGstin\}/.test(cardSrc), 'Reset app password is off while a new GSTIN is unsaved');
check(/open && !newGstin \?/.test(cardSrc), 'and the dialog does not open then');
const dialog = src('src/components/clients/ResetClientPasswordDialog.tsx');
check(/resetLinkBlock\(\{ saved: client\.email, typed: client\.typedEmail \}, \{ canEditClients: canAddEditClients\(\) \}\)/.test(dialog),
  'the dialog asks the rule, saying whether the viewer can open Edit Client');
check(/const \{ user, canAddEditClients \} = useAuth\(\);/.test(dialog), '  from the auth context\'s own check');
check(!/Edit Client/.test(dialog.replace(/\/\/.*$/gm, '')), 'the dialog itself never names Edit Client (outside comments)');
check(/disabled=\{!!linkBlock \|\|/.test(dialog), '"E-mail reset link" is off while the rule says so');
check(/\{linkBlock \?\? </.test(dialog), 'and the dialog shows why');
check(/Goes to \{linkTo\}/.test(dialog) && /resetLinkAddresses\(client\.email\)/.test(dialog), 'the dialog names only the usable addresses');

// Why a request waits on the Dashboard: never "Edit Client shows why" (not
// every employee can open Edit Client), and the reset dialog says why.
const note = mig.match(/client_password_staff_note\(\)[\s\S]*?AS \$\$ SELECT '([^']+)'::text \$\$/)?.[1] ?? '';
check(note !== '' && !/Edit Client/.test(note), `the Dashboard note sends nobody to Edit Client (${JSON.stringify(note)})`);
check(/Reset password shows why\./.test(note), 'it names the Dashboard\'s own "Reset password" button');
const section = src('src/components/dashboard/PasswordResetRequestsSection.tsx');
check(/askedForHelp: !!r\.note/.test(section), 'a client request filed by this flow (it carries the note) opens the dialog asking it to say why');
check(/'Reset password'/.test(section) && /request\.client \? setClientTarget\(request\.client\)/.test(section),
  'that button is the one every staff member sees on a client request');
check(/loadClientPasswordLog\(actorId, clientId, 50\)/.test(dialog) && /latestFallbackReason\(log\)/.test(dialog),
  'the dialog reads why through client_password_log_for (any staff level)');
check(/if \(!actorId \|\| !clientId \|\| !askedForHelp\) return;/.test(dialog), 'only when opened from a waiting request');
check(/Why no link reached the client/.test(dialog) && /\{why\.text\}/.test(dialog), 'and shows it');
const log = [
  { action: 'link_queued', at: '2026-10-20T09:00:00+00:00', detail: 'The client asked for a reset link, to a•••@x.com.' },
  { action: 'fallback_request', at: '2026-10-18T09:00:00+00:00', detail: 'Asked for a reset link, but there is no e-mail address on record. A request is waiting on the Dashboard.' },
  { action: 'fallback_request', at: '2026-10-20T09:20:00+00:00', detail: 'The e-mail with the reset link could not be sent. A request is waiting on the Dashboard.' },
  { action: 'link_failed', at: '2026-10-20T09:19:59+00:00', detail: 'The reset link could not be e-mailed to a•••@x.com: 503' },
];
check(JSON.stringify(R.latestFallbackReason(log)) === JSON.stringify({ at: '2026-10-20T09:20:00+00:00', text: 'The e-mail with the reset link could not be sent.' }),
  'the newest reason staff were asked, without the Dashboard sentence');
check(R.latestFallbackReason([...log].reverse())?.at === '2026-10-20T09:20:00+00:00', 'whatever the order of the log');
check(R.latestFallbackReason(log.filter((l) => l.action !== 'fallback_request')) === null, 'none logged: nothing shown');
check(R.latestFallbackReason([{ action: 'fallback_request', at: '2026-10-20T09:20:00+00:00', detail: null }]) === null, 'an empty reason: nothing shown');

// The staff-link error, shown in the same dialog, sends nobody to Edit Client.
const staffLink = mig.match(/CREATE OR REPLACE FUNCTION public\.staff_send_client_reset_link[\s\S]*?\n\$\$;/)?.[0] ?? '';
const raised = [...staffLink.matchAll(/RAISE EXCEPTION '((?:[^']|'')*)'/g)].map((m) => m[1]);
check(raised.length > 0 && raised.every((m) => !/Edit Client/.test(m)), `staff_send_client_reset_link's errors never name Edit Client (${raised.length} checked)`);

// Edit Client's GST-password sync keeps the client's reset state.
const lib = src('src/lib/clientPasswordReset.ts');
check(/\.\.\.\(opts\.keepResets \? \{ p_close_resets: false \} : \{\}\)/.test(lib), 'keepResets is sent as p_close_resets false');
const sync = edit.match(/await staffSetClientPassword\(user\.id, clientId, gstPassword, \{[\s\S]*?\}\);/)?.[0] ?? '';
check(sync !== '' && /keepResets: true/.test(sync), 'Edit Client\'s GST-password sync keeps the client\'s link and waiting request');
const dialogSet = dialog.match(/await staffSetClientPassword\([^;]*\);/)?.[0] ?? '';
check(dialogSet !== '' && !/keepResets/.test(dialogSet), 'the reset dialog does not: a reset there voids links and answers requests');
const setFn = mig.match(/CREATE OR REPLACE FUNCTION public\.staff_set_client_password\([\s\S]*?\)\nRETURNS/)?.[0] ?? '';
check(/p_close_resets boolean DEFAULT true/.test(setFn), 'staff_set_client_password takes p_close_resets, true by default');

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
