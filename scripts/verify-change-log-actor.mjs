#!/usr/bin/env node
// Checks that every request names the user signed in in the tab that sends
// it (round 2 review of the change log, migration 20261021130000): two tabs of
// one browser share localStorage, so a second sign-in in tab B overwrites the
// saved sign-in while tab A still shows, and saves as, its own user. The
// headers come from src/lib/changeLogHeaders.ts, whose person AuthContext
// sets with every change of its user (setChangeLogActor).
//
//   node scripts/verify-change-log-actor.mjs
//
// Each tab is its own copy of the module (as each browser tab is its own
// JavaScript world), over one shared localStorage. Prints pass / fail.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.GSTK_ROOT || path.resolve(here, '..');
const { build } = createRequire(path.join(root, 'package.json'))('esbuild');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gstk-actor-'));
await build({ entryPoints: [path.join(root, 'src/lib/changeLogHeaders.ts')], bundle: true, format: 'esm', platform: 'neutral',
  outfile: path.join(dir, 'h.mjs'), logLevel: 'error' });
const tabA = await import(pathToFileURL(path.join(dir, 'h.mjs')).href + '?tab=A');
const tabB = await import(pathToFileURL(path.join(dir, 'h.mjs')).href + '?tab=B');

let fail = 0;
let count = 0;
const eq = (a, b, name) => { count++; const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) { fail++; console.log(`FAIL ${name}  [got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}]`); } else if (process.env.VERBOSE) console.log('ok   ' + name); };

const SAM = '10000000-0000-0000-0000-000000000001';
const GITA = '10000000-0000-0000-0000-000000000002';
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const signIn = (tab, id, name) => { store.set('vjdesai_user', JSON.stringify({ id, firstName: name })); tab.setChangeLogActor(id); };
const actorOf = (tab) => new Headers(tab.withChangeLogHeaders('https://x.supabase.co/rest/v1/suspended_reco?id=eq.1', { method: 'PATCH' }, undefined, '/suspended-reco')?.headers).get('x-gst-actor');

eq([actorOf(tabA), actorOf(tabB)], [null, null], 'before anyone signs in: no person');
signIn(tabA, SAM, 'Sam');
eq(actorOf(tabA), SAM, 'tab A: Sam signed in, his requests name him');
signIn(tabB, GITA, 'Gita');
eq(JSON.parse(store.get('vjdesai_user')).firstName, 'Gita', 'the saved sign-in is now Gita (tab B wrote it)');
eq(actorOf(tabA), SAM, 'tab A still names Sam, the user it shows and saves as');
eq(actorOf(tabB), GITA, 'tab B names Gita');
eq([tabA.currentActorId(), tabB.currentActorId()], [SAM, GITA], 'the bridges\' actorId: each tab its own');
store.delete('vjdesai_user'); tabB.setChangeLogActor(null);
eq([actorOf(tabA), actorOf(tabB)], [SAM, null], 'tab B signs out: tab A still names Sam, tab B no one');
tabA.setChangeLogActor('not-a-user-id');
eq(actorOf(tabA), null, 'a value that is not a user id names no one');
eq(new Headers(tabA.withChangeLogHeaders('https://x.supabase.co/functions/v1/send-gst-email', { method: 'POST' })?.headers).get('x-gst-source'), null,
  'Edge Functions get no change-log headers');

// AuthContext sets the person whenever its user changes, before React renders it.
const auth = fs.readFileSync(path.join(root, 'src/contexts/AuthContext.tsx'), 'utf8');
const setter = auth.match(/const setUser = useCallback\(\(next: AppUser \| null\) => \{\s*setChangeLogActor\(next\?\.id \?\? null\);\s*setUserState\(next\);/);
eq(!!setter, true, 'AuthContext: every setUser sets the change-log actor first');
eq((auth.match(/\bsetUserState\(/g) || []).length, 1, 'AuthContext: nothing sets its user any other way');
eq(/localStorage/.test(fs.readFileSync(path.join(root, 'src/lib/changeLogHeaders.ts'), 'utf8').replace(/^\s*\/\/.*$/gm, '')), false,
  'changeLogHeaders.ts never reads the saved sign-in');

console.log(fail ? `${fail} of ${count} checks FAILED` : `${count} of ${count} checks passed`);
process.exit(fail ? 1 : 0);
