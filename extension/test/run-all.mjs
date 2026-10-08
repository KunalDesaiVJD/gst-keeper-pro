// Runs every 0.8.0 notices test. No portal, no database, no network:
//   node test/run-all.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const dir = new URL('./', import.meta.url);
execFileSync(process.execPath, [new URL('./_extract.mjs', dir).pathname], { stdio: 'inherit' });
const tests = fs.readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).sort();
let failed = 0;
for (const t of tests) {
  console.log('\n=== ' + t + ' ===');
  try { execFileSync(process.execPath, [new URL('./' + t, dir).pathname], { stdio: 'inherit' }); }
  catch (e) { failed++; }
}
console.log(failed ? '\n' + failed + ' of ' + tests.length + ' test files FAILED' : '\n' + tests.length + ' test files passed');
process.exit(failed ? 1 : 0);
