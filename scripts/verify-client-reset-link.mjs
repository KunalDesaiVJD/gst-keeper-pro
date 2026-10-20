#!/usr/bin/env node
// Checks that staff are never told a reset link goes to an address it does
// not go to. staff_send_client_reset_link sends to clients.email as saved, so
// Edit Client must name the saved address and keep "E-mail reset link" off
// ("Save the new e-mail first.") while the e-mail field holds an unsaved one.
// The link goes only to the addresses the database's rule (client_email_list)
// accepts, so the screens name only those, and say so when none is usable.
// And a password set from Edit Client goes on the saved row, so the User ID
// staff are told is the saved GSTIN, and a reset waits while a new one is
// typed but not saved.
//
//   node scripts/verify-client-reset-link.mjs
//
// Builds the pure rule (src/lib/clientResetLink.ts) with esbuild and runs it,
// then checks the wiring in EditClientPage, ClientAppLoginCard and
// ResetClientPasswordDialog. Prints pass / fail; exits 1 on any failure.
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

const out = await build({
  entryPoints: [path.join(root, 'src/lib/clientResetLink.ts')],
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error',
});
const M = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

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
const mig = src('supabase/migrations/20261020100000_client_password_reset.sql');
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
check(/resetLinkBlock\(\{ saved: client\.email, typed: client\.typedEmail \}\)/.test(dialog), 'the dialog asks the rule');
check(/disabled=\{!!linkBlock \|\|/.test(dialog), '"E-mail reset link" is off while the rule says so');
check(/\{linkBlock \?\? </.test(dialog), 'and the dialog shows why');
check(/Goes to \{linkTo\}/.test(dialog) && /resetLinkAddresses\(client\.email\)/.test(dialog), 'the dialog names only the usable addresses');

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
