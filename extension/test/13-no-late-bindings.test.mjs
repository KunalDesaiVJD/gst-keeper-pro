// content.js runs its job from the top of one async function, before the
// helpers further down are reached. A function declaration is ready then; a
// `const` / `let` / `class` at that level is not ("Cannot access 'x' before
// initialization"), which stopped the GSTR-9 pull in 0.11.0 and 0.11.7.
// This fails on any such binding placed after the job dispatch.
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../content.js', import.meta.url), 'utf8').split('\n');
const start = src.findIndex((l) => l.startsWith('    else if (job.step === \'done\')'));
let fail = 0;
if (start < 0) { console.log('FAIL could not find the job dispatch'); fail++; }
const bad = src.map((l, i) => [i + 1, l]).filter(([i, l]) => i > start && /^  (const|let|class) /.test(l));
for (const [i, l] of bad) { console.log('FAIL line ' + i + ': ' + l.trim().slice(0, 80)); fail++; }
if (!fail) console.log('ok   no top-level const / let / class after the job dispatch');
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed'); process.exit(fail ? 1 : 0);
