// Builds manifest.json from capture-results.json + annotations.mjs + the screen
// definitions in capture-notices.mjs (parsed, so there is one source of truth).
import fs from 'node:fs';
import path from 'node:path';
import { A, BUG } from './annotations.mjs';

const W = path.dirname(new URL(import.meta.url).pathname);
const results = JSON.parse(fs.readFileSync(path.join(W, 'capture-results.json'), 'utf8'));
const src = fs.readFileSync(path.join(W, 'capture-notices.mjs'), 'utf8');

const unq = (s) => s.replace(/\\(["'\\])/g, '$1');
const meta = {};
const re = /add\(\{ id: '([^']+)', group: '([^']+)', title: '((?:[^'\\]|\\.)*)', route: (?:'([^']*)'|`([^`]*)`),[\s\S]*?steps: '((?:[^'\\]|\\.)*)'/g;
let m;
while ((m = re.exec(src))) meta[m[1]] = { group: m[2], title: unq(m[3]), steps: unq(m[6]) };
const MIS = { '101-litigation-mis-by-client': 'By Client', '102-litigation-mis-by-stage': 'By Stage', '103-litigation-mis-by-lifecycle': 'By Lifecycle', '104-litigation-mis-ageing': 'Ageing', '105-litigation-mis-per-staff': 'Per Staff', '106-litigation-mis-hearings': 'Hearings' };
for (const [id, tab] of Object.entries(MIS)) meta[id] = { group: 'Litigation', title: `Litigation MIS — ${tab}`, steps: `Reports ▾ → Litigation MIS → "${tab}" tab` };
meta['110-extension-popup'] = { group: 'Extension', title: 'Browser-extension popup (GST Keeper — Portal Sync)', steps: 'Chrome toolbar → GST Keeper Sync icon' };
meta['111-extension-popup-error'] = { group: 'Extension', title: 'Extension popup — background worker unreachable', steps: 'Open the popup while the service worker is not responding' };
meta['120-email-due-soon-inapp'] = { group: 'Emails', title: 'Notice-alert email E3 "due soon" — in-app path', steps: 'Dashboard "Send digest" → email_outbox → send-gst-email' };
meta['121-email-due-soon-cron'] = { group: 'Emails', title: 'Notice-alert email E3 "due soon" — cron path', steps: 'pg_cron → queue-notice-alerts → send-gst-email' };
meta['122-email-overdue-digest-inapp'] = { group: 'Emails', title: 'Notice-alert email E2 daily overdue digest — in-app path', steps: 'Dashboard "Send digest" → email_outbox → send-gst-email' };
meta['123-email-limitation-critical-cron'] = { group: 'Emails', title: 'Notice-alert email E5 limitation warning (critical) — cron path', steps: 'pg_cron → queue-notice-alerts → send-gst-email' };

const GROUP_ORDER = ['Dashboard', 'Shell', 'Work queue', 'Per-notice', 'Companies', 'Case folder', 'Reports', 'Refunds & DRC-03', 'Litigation', 'Extension', 'Emails'];
const ids = [...new Set(results.map((r) => r.id))];
const routeOf = (r) => (r.route || '').replace(/\?$/, '');
const out = ids.map((id) => {
  const d = results.find((r) => r.id === id && r.vp === 'd');
  const mo = results.find((r) => r.id === id && r.vp === 'm');
  const a = A[id] || {};
  const md = meta[id] || {};
  const consoleErrors = [...new Set([...(d?.consoleErrors || []), ...(mo?.consoleErrors || [])])];
  const failedRequests = [...new Set([...(d?.mockLog || []), ...(mo?.mockLog || [])])];
  const gaps = [a.gaps, (d?.mode === 'lenient' && !a.gaps) ? 'Captured with the mock in lenient (schema-tolerant) mode.' : null].filter(Boolean);
  return {
    id,
    group: md.group || 'Shell',
    title: md.title || id,
    route: routeOf(d || mo),
    steps: md.steps || '',
    desktop: d ? d.file : null,
    mobile: mo ? mo.file : null,
    capture: d?.capture || mo?.capture || 'full-page',
    mockMode: d?.mode || mo?.mode || 'strict',
    shows: [a.shows || '', mo && a.mobile ? `Mobile (390 px): ${a.mobile}` : ''].filter(Boolean).join(' '),
    consoleErrors,
    failedRequests,
    mockGaps: gaps.join(' ') || 'none',
    suspectedAppBugs: [...new Set([...(a.bugs || []), ...(mo ? a.mobileBugs || [] : [])])].map((k) => BUG[k] || k),
    actionError: d?.actionError || mo?.actionError || null,
  };
});
const num = (id) => parseInt(id, 10);
out.sort((x, y) => (GROUP_ORDER.indexOf(x.group) - GROUP_ORDER.indexOf(y.group)) || (num(x.id) - num(y.id)));
fs.writeFileSync(path.join(W, 'manifest.json'), JSON.stringify(out, null, 2));
const missing = out.filter((e) => !e.shows).map((e) => e.id);
console.log('entries', out.length, 'desktop', out.filter((e) => e.desktop).length, 'mobile', out.filter((e) => e.mobile).length, 'missing shows:', missing.join(', ') || 'none');
console.log('action errors:', out.filter((e) => e.actionError).map((e) => e.id + ': ' + e.actionError));
