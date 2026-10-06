#!/usr/bin/env node
// Type-check gate (Phase 0 of the notices roadmap).
//
// `vite build` does not type-check, which is how queries naming columns that do
// not exist (gst_notices.hearing_date, gst_case_folder_items.notice_id, ...) shipped
// to production while the build stayed green. This script runs `tsc --noEmit` and:
//   - fails on ANY error in a protected path (the notices & litigation module),
//   - fails if any other file has more errors than recorded in scripts/tsc-baseline.json
//     (a ratchet: existing errors elsewhere are tolerated, new ones are not).
// Usage:  npm run typecheck            check
//         npm run typecheck -- --update-baseline   record current counts (only after fixing errors)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const BASELINE = path.join(ROOT, 'scripts', 'tsc-baseline.json');
const PROTECTED = [
  /^src\/components\/notices\//,
  /^src\/components\/litigation\//,
  /^src\/components\/reports\/views\/(NoticeWorkflowListView|EvidenceEventListView)\.tsx$/,
  /^src\/pages\/(NoticesDashboardPage|CompanyListPage|CompanyProfilePage|NoticeSummaryReportPage|GstinWiseNoticeCountPage|AdditionalNoticeFolderPage|AllClientsNoticesPage|AllClientsRefundsPage|AllClientsDrc03Page|NoticeWorkspacePage|NoticeQueuePage|NoticesHearingsPage|NoticesCalendarPage|NoticesAutopilotPage|Litigation\w*)\.tsx$/,
  /^src\/lib\/(notice\w*|litigationData|fetchAllRows|autopilot)\.ts$/,
  /^src\/hooks\/(useExtensionBridge|useStaffList)\.ts$/,
  /^src\/utils\/(notice\w*|litigationPdfExport)\.ts$/,
];

const tsc = spawnSync('npx', ['tsc', '--noEmit', '-p', 'tsconfig.app.json', '--pretty', 'false'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const out = `${tsc.stdout ?? ''}${tsc.stderr ?? ''}`;
const errors = out.split('\n').filter((l) => /\): error TS\d+:/.test(l)).map((l) => ({ file: l.slice(0, l.indexOf('(')).replace(/\\/g, '/'), line: l }));
if (tsc.status !== 0 && errors.length === 0) { console.error(out); console.error('typecheck: tsc failed without reporting errors'); process.exit(2); }

const byFile = {};
for (const e of errors) byFile[e.file] = (byFile[e.file] ?? 0) + 1;

if (process.argv.includes('--update-baseline')) {
  const unprotected = Object.fromEntries(Object.entries(byFile).filter(([f]) => !PROTECTED.some((re) => re.test(f))).sort());
  fs.writeFileSync(BASELINE, JSON.stringify(unprotected, null, 2) + '\n');
  console.log(`typecheck: baseline updated (${Object.values(unprotected).reduce((a, b) => a + b, 0)} tolerated errors in ${Object.keys(unprotected).length} files)`);
}

const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {};
const failures = [];
for (const e of errors) if (PROTECTED.some((re) => re.test(e.file))) failures.push(`protected  ${e.line}`);
for (const [file, n] of Object.entries(byFile)) {
  if (PROTECTED.some((re) => re.test(file))) continue;
  if (n > (baseline[file] ?? 0)) {
    failures.push(`new errors  ${file}: ${n} (baseline ${baseline[file] ?? 0})`);
    for (const e of errors.filter((x) => x.file === file)) failures.push(`           ${e.line}`);
  }
}
const tolerated = Object.entries(byFile).filter(([f]) => !PROTECTED.some((re) => re.test(f))).reduce((a, [, n]) => a + n, 0);
if (failures.length) {
  console.error(failures.join('\n'));
  console.error(`\ntypecheck: FAILED — ${failures.filter((f) => f.startsWith('protected')).length} error(s) in protected notices files, ${failures.filter((f) => f.startsWith('new errors')).length} file(s) with new errors.`);
  process.exit(1);
}
console.log(`typecheck: ok — 0 errors in protected files; ${tolerated} pre-existing error(s) elsewhere, none new.`);
