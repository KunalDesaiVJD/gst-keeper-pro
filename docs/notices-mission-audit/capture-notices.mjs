// Screenshot capture for the Notices & Litigation audit.
//   node capture-notices.mjs                → everything
//   node capture-notices.mjs 01,20,85       → only screens whose id starts with one of these prefixes
//   node capture-notices.mjs --no-mobile    → skip the mobile pass
// Output: shots/{d,m}-<id>.png, capture-results.json, findings/drilldown-counts.json
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { buildData, NOW_MS, LOGIN_USER, STAFF, d as dayOff } from './mock-data.mjs';
import { createDb, installMock, loadSchema } from './mock-server.mjs';
import { renderEmails } from './render-emails.mjs';

const W = path.dirname(new URL(import.meta.url).pathname);
const SHOTS = path.join(W, 'shots');
const BASE = 'http://127.0.0.1:4173';
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(path.join(W, 'findings'), { recursive: true });

const args = process.argv.slice(2);
const only = args.find((a) => !a.startsWith('--'))?.split(',') || null;
const noMobile = args.includes('--no-mobile');
const noDesktop = args.includes('--mobile-only');

const schema = loadSchema();
const db = createDb(buildData);
const { tables: T0, story } = buildData();
let mode = 'strict';
let currentScreen = null;
const logs = [];
const notice = (key) => T0.gst_notices.find((n) => n.id === story[key].id);
const CID = (i) => T0.clients[i].id;
const MID = (n) => `9a000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  // Defence in depth: anything that escapes the route handler cannot resolve DNS.
  args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--no-proxy-server', '--lang=en-IN'],
  // en_IN process locale so native <input type=date> renders dd/mm/yyyy like an Indian user's browser
  env: { ...process.env, LANG: 'en_IN.UTF-8', LANGUAGE: 'en_IN:en', LC_ALL: 'en_IN.UTF-8' },
});

const ctxCache = new Map();
function userObj(key) {
  const s = STAFF[key];
  return { id: s.id, email: s.email, firstName: s.name, role: s.role, userId: s.name, permissions: {} };
}
// Answers the extension/appbridge.js postMessage protocol. The Sync All count mirrors
// background.js startAllClientsSectionPull: clients with saved credentials, minus
// notices_sync_excluded for the notices modes, optionally scoped to clientIds.
function fakeExtension({ version, clients }) {
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.__gstkAppReady) window.postMessage({ __gstkExtensionReady: true, version }, '*');
    if (d.__gstkPullSectionAllClients) {
      const info = d.__gstkPullSectionAllClients;
      let list = clients.filter((c) => c.creds);
      if (info.mode === 'notices' || info.mode === 'notices_bundle') list = list.filter((c) => !c.excluded);
      if (Array.isArray(info.clientIds) && info.clientIds.length) list = list.filter((c) => info.clientIds.includes(c.id));
      setTimeout(() => window.postMessage({ __gstkPullSectionAllClientsResult: list.length ? { ok: true, count: list.length } : { ok: false, error: 'No clients have saved GST portal credentials.' } }, '*'), 400);
    }
    if (d.__gstkOpenNotice) setTimeout(() => window.postMessage({ __gstkOpenNoticeResult: { ok: true } }, '*'), 400);
  });
}
async function getContext(vp, { ext = null, user = 'P' } = {}) {
  const key = `${vp}|${ext}|${user}`;
  if (ctxCache.has(key)) return ctxCache.get(key);
  const ctx = await browser.newContext({
    viewport: vp === 'd' ? { width: 1440, height: 900 } : { width: 390, height: 844 },
    deviceScaleFactor: 1, isMobile: vp === 'm', hasTouch: vp === 'm',
    timezoneId: 'Asia/Kolkata', locale: 'en-IN', serviceWorkers: 'block',
  });
  await ctx.clock.setFixedTime(new Date(NOW_MS));
  await installMock(ctx, { db, schema, getMode: () => mode, onLog: (e) => logs.push({ screen: currentScreen, ...e }), fontDir: path.join(W, 'font-cache'), nowMs: () => NOW_MS });
  await ctx.addInitScript(([u, seen]) => {
    try {
      localStorage.setItem('vjdesai_user', JSON.stringify(u));
      if (!localStorage.getItem('vjdesai_notif_seen')) localStorage.setItem('vjdesai_notif_seen', seen);
    } catch { /* about:blank */ }
  }, [userObj(user), new Date(NOW_MS - 2 * 86400000).toISOString()]);
  if (ext) await ctx.addInitScript(fakeExtension, { version: ext, clients: T0.clients.map((c) => ({ id: c.id, creds: !!c.gst_user_id, excluded: !!c.notices_sync_excluded })) });
  ctxCache.set(key, ctx);
  return ctx;
}

// ───────────── helpers used by actions ─────────────
const wait = (page, ms) => page.waitForTimeout(ms);
const toast = async (page) => { await page.waitForSelector('[data-sonner-toast]', { timeout: 6000 }); await wait(page, 500); };
const queueTable = (page) => page.locator('table').first();
const queueRow = (page, text) => queueTable(page).locator('tbody tr', { hasText: text }).first();
const listRow = (page, text) => page.locator('table tbody tr', { hasText: text }).first();
async function pickOption(page, trigger, name) { await trigger.click(); await wait(page, 300); await page.getByRole('option', { name, exact: true }).click(); await wait(page, 300); }
async function openDrawerFor(page, key) {
  const n = notice(key);
  const c = T0.clients.find((x) => x.id === n.client_id);
  let row = n.reference_number ? queueRow(page, n.reference_number) : queueTable(page).locator('tbody tr', { hasText: c.name }).filter({ hasText: n.notice_type }).first();
  await row.scrollIntoViewIfNeeded();
  await row.locator('td').nth(2).click();
  await page.waitForSelector('[role="dialog"]', { timeout: 6000 });
  await wait(page, 1200);
}
async function drawerTab(page, name) { await page.locator('[role="dialog"]').getByRole('tab', { name }).click(); await wait(page, 500); }
async function textOf(page) { return page.evaluate(() => document.body.innerText); }

// ───────────── screen definitions ─────────────
// group, id, title, route, steps, shows, bugs, gaps, mode, ext, user, mobile, action
const S = [];
const add = (o) => S.push(o);
const nRef = (k) => notice(k).reference_number;

// ── Dashboard ──
add({ id: '01-dashboard', group: 'Dashboard', title: 'Notices & Litigation dashboard (landing)', route: '/notices-dashboard', mobile: true, steps: 'Sidebar → Notices Dashboard', probe: true });
add({ id: '02-dashboard-bell', group: 'Shell', title: 'Notification bell popover', route: '/notices-dashboard', steps: 'Click the bell (fixed top-right)', action: async (p) => { await p.locator('button[aria-label="Notifications"]:visible').first().click(); await wait(p, 800); } });
add({ id: '03-dashboard-reports-menu', group: 'Dashboard', title: 'Top-nav "Reports ▾" dropdown', route: '/notices-dashboard', steps: 'Click "Reports ▾" in the module tab bar', action: async (p) => { await p.locator('nav button', { hasText: 'Reports' }).click(); await wait(p, 600); } });
add({ id: '04-dashboard-search-company', group: 'Dashboard', title: 'Search Company dialog (⌘K pill)', route: '/notices-dashboard', steps: 'Press Ctrl+K (nothing happens) then click the "Search GSTIN, trade name, ARN…" pill; type "pharma"', action: async (p, r) => {
  await p.keyboard.press('Control+k'); await wait(p, 500);
  r.probe = { ctrlKOpensDialog: await p.locator('[role="dialog"]').count() > 0 };
  await p.locator('button', { hasText: 'Search GSTIN, trade name, ARN' }).click(); await wait(p, 700);
  await p.locator('[role="dialog"] input').fill('pharma'); await wait(p, 500);
} });
add({ id: '05-dashboard-add-notice', group: 'Dashboard', title: 'Add Notice dialog — submit fails (portal_key NOT NULL)', route: '/notices-dashboard', steps: 'Click "Add Notice", fill all fields, Submit', action: async (p) => {
  await p.getByRole('button', { name: 'Add Notice' }).click(); await wait(p, 700);
  const dlg = p.locator('[role="dialog"]');
  await dlg.getByRole('combobox').first().click(); await wait(p, 400);
  await p.locator('[cmdk-input]').fill('Sandbox'); await wait(p, 300);
  await p.locator('[cmdk-item]').first().click(); await wait(p, 300);
  const inputs = dlg.locator('input:not([type="file"]):not([type="date"]):not([type="number"])');
  await inputs.nth(0).fill('ZD0605102600999');
  await inputs.nth(1).fill('Ward 3, Gurugram (State Tax)');
  await pickOption(p, dlg.getByRole('combobox').nth(1), 'Notice');
  await dlg.locator('input[type="date"]').nth(0).fill(dayOff(-1));
  await dlg.locator('input[type="date"]').nth(1).fill(dayOff(6));
  await dlg.locator('input[type="number"]').fill('48500');
  await dlg.locator('textarea').fill('Intimation of difference in ITC (DRC-01C) received by post — manual entry (demo)');
  await dlg.getByRole('button', { name: 'Submit' }).click();
  await toast(p);
} });
add({ id: '06-dashboard-sync-all-no-extension', group: 'Dashboard', title: '"Sync All" without the browser extension', route: '/notices-dashboard', steps: 'Click "Sync All" (extension not installed)', action: async (p) => { await p.getByRole('button', { name: 'Sync All' }).click(); await toast(p); } });
add({ id: '07-dashboard-sync-all-extension', group: 'Dashboard', title: '"Sync All" with a (simulated) connected extension v0.3.3', route: '/notices-dashboard', ext: '0.3.3', steps: 'Extension answers the __gstkAppReady ping (simulated via window.postMessage); click "Sync All"', action: async (p) => { await p.getByRole('button', { name: 'Sync All' }).click(); await toast(p); } });
add({ id: '08-dashboard-closing-sweep', group: 'Dashboard', title: 'Work-queue footer "run the closing sweep"', route: '/notices-dashboard', steps: 'Click "run the closing sweep" under the work queue', action: async (p) => { await p.getByRole('button', { name: /run the closing sweep/ }).click(); await toast(p); } });
add({ id: '09-dashboard-send-digest', group: 'Dashboard', title: '"Send digest" button', route: '/notices-dashboard', steps: 'Click "Send digest"', action: async (p) => { await p.getByRole('button', { name: 'Send digest' }).click(); await toast(p); } });
add({ id: '10-dashboard-category-filter', group: 'Dashboard', title: 'Category row clicked → dashboard filtered; empty categories expanded', route: '/notices-dashboard', steps: 'Click the "Demand Notice" bar row; click "+ 8 categories with no data"', action: async (p) => {
  await p.locator('div.cursor-pointer', { hasText: /^Demand Notice/ }).first().click(); await wait(p, 800);
  await p.getByRole('button', { name: /categories with no data/ }).click(); await wait(p, 500);
} });
add({ id: '11-dashboard-calendar-month', group: 'Dashboard', title: 'Deadline strip switched to "Month" (35 days)', route: '/notices-dashboard', steps: 'Click "Month" on the Next 14 days card', action: async (p) => { await p.getByRole('button', { name: 'Month', exact: true }).click(); await wait(p, 600); } });
add({ id: '12-dashboard-queue-assign', group: 'Dashboard', title: 'Work queue → Unassigned tab, 3 rows selected, Assign dialog opened', route: '/notices-dashboard', steps: 'Click "Unassigned · N", tick 3 rows, click "Assign ▾", open the member dropdown', action: async (p) => {
  await p.getByRole('button', { name: /^Unassigned · / }).click(); await wait(p, 500);
  const boxes = queueTable(p).locator('tbody button[role="checkbox"]');
  for (let i = 0; i < 3; i++) await boxes.nth(i).click();
  await p.getByRole('button', { name: 'Assign ▾' }).click(); await wait(p, 600);
  await p.locator('[role="dialog"] [role="combobox"]').click(); await wait(p, 600);
} });
add({ id: '13-dashboard-queue-change-stage', group: 'Dashboard', title: 'Work queue bulk "Change stage" → Closed', route: '/notices-dashboard', steps: 'Tick 2 rows, click "Change stage ▾", choose Closed (close-reason box appears)', action: async (p) => {
  const boxes = queueTable(p).locator('tbody button[role="checkbox"]');
  await boxes.nth(0).click(); await boxes.nth(1).click();
  await p.getByRole('button', { name: 'Change stage ▾' }).click(); await wait(p, 600);
  await pickOption(p, p.locator('[role="dialog"] [role="combobox"]'), 'Closed');
  await p.locator('[role="dialog"] input').fill('Reply accepted by officer');
} });

// ── Work queue (/notices-all) ──
add({ id: '20-workqueue-all', group: 'Work queue', title: 'Notices — All Clients (Work Queue tab)', route: '/notices-all', mobile: true, steps: 'Module tab "Work Queue" (or "View full work queue →")' });
add({ id: '21-workqueue-merged', group: 'Work queue', title: 'Merged Notices tab (notices + refunds + DRC-03)', route: '/notices-all?tab=merged', steps: 'On /notices-all click "Merged Notices"' });
add({ id: '22-workqueue-overdue-drilldown', group: 'Work queue', title: 'Overdue tile drill-down (?filter=overdue)', route: '/notices-all?filter=overdue', steps: 'Dashboard → click "Overdue & still open" tile' });
add({ id: '23-workqueue-matters-submitted', group: 'Work queue', title: '"Matters" tab (?filter=submitted)', route: '/notices-all?filter=submitted', steps: 'Module tab "Matters"' });
add({ id: '24-workqueue-open-exposure', group: 'Work queue', title: 'Exposure tile drill-down (?status=Open)', route: '/notices-all?status=Open', steps: 'Dashboard → click "Exposure under dispute" tile' });
add({ id: '25-workqueue-calendar-date', group: 'Work queue', title: 'Calendar day drill-down (?date=…)', route: `/notices-all?date=${dayOff(4)}`, steps: 'Dashboard → Next 14 days → click a day cell (Fri 9)' });
add({ id: '26-workqueue-client-scope', group: 'Work queue', title: 'Company-scoped list (?client=…) from Company profile "View All"', route: `/notices-all?client=${CID(0)}`, steps: 'Company profile (Demo Textiles) → "Total Notices" tile or "View All"' });
add({ id: '27-workqueue-notice-deeplink', group: 'Work queue', title: 'Single-notice deep link (?noticeId=…) from drawer "Open in list" / bell', route: `/notices-all?noticeId=${story.c1_case_drc01.id}`, steps: 'Notice drawer → "Open in list"' });
add({ id: '29-workqueue-inline-status', group: 'Work queue', title: 'Inline Status select on a row whose stage is "Reply drafted"', route: '/notices-all', steps: 'Open the Status cell select on the Test Engineering Works DRC-01C row', action: async (p) => {
  const row = listRow(p, nRef('c4_drc01c_today'));
  await row.scrollIntoViewIfNeeded();
  await row.locator('button[role="combobox"]').click(); await wait(p, 600);
} });
add({ id: '30-workqueue-edit-dialog', group: 'Work queue', title: '"Log reply / order / submission" edit dialog (auto-closed row)', route: '/notices-all', steps: 'Search the reference no. of the Test Engineering Works "Determination Of Tax" case (closed, auto:closure) and click its pencil', action: async (p) => {
  await p.locator('input[placeholder^="Search reference no."]').fill(nRef('c4_case_drc01_closed')); await wait(p, 600);
  const row = listRow(p, nRef('c4_case_drc01_closed'));
  await row.locator('button[title="Log reply / order / submission"]').click(); await wait(p, 800);
} });
add({ id: '31-workqueue-bulk-update-status', group: 'Work queue', title: 'Bulk "Update Status" dialog', route: '/notices-all', steps: 'Tick 2 rows → "Update Status" → choose Closed', action: async (p) => {
  const boxes = p.locator('table tbody button[role="checkbox"]');
  await boxes.nth(0).click(); await boxes.nth(1).click();
  await p.getByRole('button', { name: 'Update Status' }).click(); await wait(p, 500);
  await pickOption(p, p.locator('[role="dialog"] [role="combobox"]'), 'Closed');
} });
add({ id: '33-workqueue-portal-no-extension', group: 'Work queue', title: 'Work queue right-hand columns; row "open on GST portal" without the extension', route: '/notices-all', steps: 'Work Queue → scroll the table to the right → click the orange external-link icon on the first row', action: async (p) => { await p.locator('button[title="Open this client on the GST portal, logged in"]').first().click(); await toast(p); } });
add({ id: '34-workqueue-employee-readonly', group: 'Work queue', title: 'Work queue as an employee without edit_notice_status', route: '/notices-all', user: 'A2', steps: 'Log in as Associate Two (employee, no edit_notice_status grant) → Work Queue' });

// ── Per-notice drawer ──
add({ id: '40-drawer-notice-not-found', group: 'Per-notice', title: 'Notice drawer as it actually loads (strict schema)', route: '/notices-dashboard', mobile: true, steps: 'Dashboard → click any work-queue row', action: async (p) => { await openDrawerFor(p, 'c4_drc01c_today'); } });
add({ id: '41-drawer-due-today-activity', group: 'Per-notice', title: 'Drawer — DRC-01C due today, Activity tab (lenient schema)', route: '/notices-dashboard', mode: 'lenient', steps: 'Dashboard → click the Test Engineering Works DRC-01C row', action: async (p) => { await openDrawerFor(p, 'c4_drc01c_today'); } });
add({ id: '42-drawer-extended-details', group: 'Per-notice', title: 'Drawer — ASMT-10 with extended due date, Details tab (lenient)', route: '/notices-dashboard', mode: 'lenient', steps: 'Dashboard → click the Example Foods ASMT-10 row → Details', action: async (p) => { await openDrawerFor(p, 'c3_asmt_ext'); await drawerTab(p, 'Details'); } });
add({ id: '43-drawer-case-matter-deadlines', group: 'Per-notice', title: 'Drawer — case-linked DRC-01 with matter, Deadlines tab (lenient)', route: '/notices-dashboard', mode: 'lenient', steps: 'Dashboard → click the Demo Textiles "Determination Of Tax" row → Deadlines', action: async (p) => { await openDrawerFor(p, 'c1_case_drc01'); await drawerTab(p, 'Deadlines'); } });
add({ id: '44-drawer-closed-docs', group: 'Per-notice', title: 'Drawer — closed refund case (auto:refund_order), Docs tab (lenient)', route: '/notices-dashboard', mode: 'lenient', steps: 'Dashboard loaded; the Sample Pharma refund case is then closed (simulating the sweep/colleague); click its still-listed row → Docs', action: async (p) => {
  const row = db.tables.gst_notices.find((n) => n.id === story.c2_case_refund_open.id);
  Object.assign(row, { staff_status: 'Closed', close_reason: 'auto:refund_order' });
  await openDrawerFor(p, 'c2_case_refund_open'); await drawerTab(p, 'Docs');
} });
add({ id: '45-drawer-create-matter', group: 'Per-notice', title: 'Drawer — "Create Matter" clicked on an unlinked notice (lenient)', route: '/notices-dashboard', mode: 'lenient', steps: 'Dashboard → click the Example Foods DRC-01C row → "Create Matter"', action: async (p) => {
  await openDrawerFor(p, 'c3_drc01c');
  await p.locator('[role="dialog"]').getByRole('button', { name: 'Create Matter' }).click(); await wait(p, 1500);
} });

// ── Companies ──
add({ id: '50-company-list', group: 'Companies', title: 'Company List & sync log', route: '/notices-company-list', mobile: true, steps: 'Reports ▾ → Company List & sync log (or Sync & alerts card → "Sync log →")' });
add({ id: '51-company-list-failed', group: 'Companies', title: 'Company List filtered to failed syncs (?status=failed)', route: '/notices-company-list?status=failed', steps: 'Dashboard header → "2 logins failed"' });
add({ id: '52-company-list-sync-log', group: 'Companies', title: 'Sync Log dialog', route: '/notices-company-list', steps: 'Click "Sync Log"', action: async (p) => { await p.getByRole('button', { name: 'Sync Log' }).click(); await wait(p, 700); } });
add({ id: '53-company-list-bulk-update', group: 'Companies', title: 'Bulk Update dialog (Active/Inactive)', route: '/notices-company-list', steps: 'Tick 2 companies → "Bulk Update"', action: async (p) => {
  const boxes = p.locator('table tbody button[role="checkbox"]'); await boxes.nth(0).click(); await boxes.nth(1).click();
  await p.getByRole('button', { name: 'Bulk Update' }).click(); await wait(p, 700);
} });
add({ id: '54-company-list-import', group: 'Companies', title: '"Import" (Bulk Add Clients) dialog', route: '/notices-company-list', steps: 'Click "Import"', action: async (p) => { await p.getByRole('button', { name: 'Import', exact: true }).click(); await wait(p, 800); } });
add({ id: '56-company-profile', group: 'Companies', title: 'Company profile (Company Dashboard)', route: `/notices-company/${CID(0)}`, mobile: true, steps: 'Click a GSTIN anywhere (Company List, GSTIN-wise count, Search Company)' });
add({ id: '57-company-profile-type-filter', group: 'Companies', title: 'Company profile with Type pill = "Refunds"', route: `/notices-company/${CID(6)}`, steps: 'Fictional Exports profile → Type pill → "Refunds"', action: async (p) => { await pickOption(p, p.locator('button[role="combobox"]', { hasText: 'Type:' }), 'Refunds'); } });

// ── Case folder ──
add({ id: '60-case-folder-drc01', group: 'Case folder', title: 'Additional Notice Folder — DRC-01 case (open)', route: `/notices-case-folder/${CID(0)}/${story.c1_case_drc01.case_id}`, mobile: true, steps: 'Work queue → click the blue Reference No. of a case-linked row' });
add({ id: '61-case-folder-refund', group: 'Case folder', title: 'Refund Notice Folder — refund case with audit history', route: `/notices-case-folder/${CID(6)}/${story.c7_case_refund_closed.case_id}`, steps: 'Merged Notices / Company profile → refund ARN link' });
add({ id: '62-case-folder-appeal', group: 'Case folder', title: 'Appeal case (APL-01) rendered by the folder page', route: `/notices-case-folder/${CID(2)}/${story.c3_case_appeal.case_id}`, steps: 'Work queue → Example Foods "Appeal" row Reference No.' });
add({ id: '63-case-folder-enforcement', group: 'Case folder', title: 'Enforcement case with an unmapped folder section (DRC7A)', route: `/notices-case-folder/${CID(7)}/${story.c8_case_enf.case_id}`, steps: 'Work queue → Specimen Chemicals "Enforcement Case" row Reference No.' });

// ── Reports ──
add({ id: '70-notice-summary', group: 'Reports', title: 'Notice Summary report', route: '/notices-report', mobile: true, steps: 'Reports ▾ → Notice Summary' });
add({ id: '72-gstin-wise-count', group: 'Reports', title: 'GSTIN-wise Notice Count ("Clients" tab)', route: '/notices-gstin-wise-count', mobile: true, steps: 'Module tab "Clients" (or Reports ▾ → GSTIN Wise Notice Count)' });

// ── Refunds & DRC-03 ──
add({ id: '75-refunds-all', group: 'Refunds & DRC-03', title: 'Refund — All Clients', route: '/refunds-all', mobile: true, steps: 'Dashboard → Notice summary → "Refund" count (21)' });
add({ id: '76-refunds-open', group: 'Refunds & DRC-03', title: 'Refund — All Clients, open only (?status=Open)', route: '/refunds-all?status=Open', steps: 'Notice Summary report → Refund row → Open count' });
add({ id: '77-drc03-all', group: 'Refunds & DRC-03', title: 'DRC-03 — All Clients', route: '/drc03-all', mobile: true, steps: 'Dashboard → Notice summary → "DRC 03" count' });

// ── Litigation ──
add({ id: '80-litigation-matters', group: 'Litigation', title: 'Litigation Matters list ("Hearings" tab)', route: '/litigation', mobile: true, steps: 'Module tab "Hearings"' });
add({ id: '81-litigation-matters-client', group: 'Litigation', title: 'Matters list scoped to one client (?client=…)', route: `/litigation?client=${CID(2)}`, steps: 'GSTIN-wise count → Matters cell for Example Foods' });
add({ id: '82-litigation-create-dialog', group: 'Litigation', title: 'Create Litigation Matter dialog (filled)', route: '/litigation', steps: 'Click "Create Matter", fill the form', action: async (p) => {
  await p.getByRole('button', { name: 'Create Matter' }).click(); await wait(p, 600);
  const dlg = p.locator('[role="dialog"]');
  await pickOption(p, dlg.getByRole('combobox').nth(0), 'Placeholder Logistics Pvt Ltd (07AAAAA0005A1ZZ)');
  await pickOption(p, dlg.getByRole('combobox').nth(1), 'registration');
  await dlg.locator('input').nth(0).fill('REG-03 query on amendment — FY 2026-27');
  await dlg.locator('input').nth(1).fill('s.28 r/w Rule 19');
} });
add({ id: '84-matter-detail', group: 'Litigation', title: 'Matter detail — Notices tab', route: `/litigation/${MID(1)}`, mobile: true, steps: 'Matters list → click M-2026-0001' });
add({ id: '85-matter-hearings', group: 'Litigation', title: 'Matter detail — Hearings tab', route: `/litigation/${MID(1)}`, steps: 'Matter detail → Hearings', action: async (p) => { await p.getByRole('tab', { name: /Hearings/ }).click(); await wait(p, 500); } });
add({ id: '86-matter-payments', group: 'Litigation', title: 'Matter detail — Payments tab (appeal with pre-deposit)', route: `/litigation/${MID(3)}`, steps: 'Matters list → M-2026-0003 → Payments', action: async (p) => { await p.getByRole('tab', { name: /Payments/ }).click(); await wait(p, 500); } });
add({ id: '87-matter-documents', group: 'Litigation', title: 'Matter detail — Documents tab', route: `/litigation/${MID(1)}`, steps: 'Matter detail → Documents', action: async (p) => { await p.getByRole('tab', { name: /Documents/ }).click(); await wait(p, 500); } });
add({ id: '88-matter-activity', group: 'Litigation', title: 'Matter detail — Activity tab', route: `/litigation/${MID(1)}`, steps: 'Matter detail → Activity', action: async (p) => { await p.getByRole('tab', { name: /Activity/ }).click(); await wait(p, 500); } });
add({ id: '89-matter-change-stage', group: 'Litigation', title: 'Change Stage dialog', route: `/litigation/${MID(1)}`, steps: 'Matter detail → "Change Stage" → open the stage list', action: async (p) => { await p.getByRole('button', { name: 'Change Stage' }).click(); await wait(p, 600); await p.locator('[role="dialog"] [role="combobox"]').click(); await wait(p, 600); } });
add({ id: '90-matter-close', group: 'Litigation', title: 'Close Matter dialog', route: `/litigation/${MID(1)}`, steps: 'Matter detail → "Close" → open reason list', action: async (p) => { await p.getByRole('button', { name: 'Close', exact: true }).click(); await wait(p, 600); await p.locator('[role="dialog"] [role="combobox"]').click(); await wait(p, 600); } });
add({ id: '91-matter-schedule-hearing', group: 'Litigation', title: 'Schedule Hearing dialog', route: `/litigation/${MID(1)}`, steps: 'Matter detail → "Schedule Hearing"', action: async (p) => { await p.getByRole('button', { name: 'Schedule Hearing' }).click(); await wait(p, 700); } });
add({ id: '92-matter-hearing-outcome', group: 'Litigation', title: 'Record Hearing Outcome dialog', route: `/litigation/${MID(1)}`, steps: 'Hearings tab → "Record Outcome" on the upcoming hearing → tick Adjourned', action: async (p) => {
  await p.getByRole('tab', { name: /Hearings/ }).click(); await wait(p, 500);
  await p.getByRole('button', { name: 'Record Outcome' }).first().click(); await wait(p, 600);
  await p.locator('#adjourned-check').check(); await wait(p, 400);
} });
add({ id: '93-matter-record-payment', group: 'Litigation', title: 'Record Payment dialog (kind list open)', route: `/litigation/${MID(1)}`, steps: 'Matter detail → "Record Payment" → open Kind', action: async (p) => { await p.getByRole('button', { name: 'Record Payment' }).click(); await wait(p, 600); await p.locator('[role="dialog"] [role="combobox"]').click(); await wait(p, 600); } });
add({ id: '94-matter-add-document', group: 'Litigation', title: 'Add Document dialog', route: `/litigation/${MID(1)}`, steps: 'Documents tab → "Add Document"', action: async (p) => { await p.getByRole('tab', { name: /Documents/ }).click(); await wait(p, 400); await p.getByRole('button', { name: 'Add Document' }).click(); await wait(p, 700); } });
add({ id: '95-matter-created-detail', group: 'Litigation', title: 'Detail page of a matter just created through "Create Matter"', route: '/litigation', steps: 'Create Matter dialog → fill → Create → click the new M-2026-0012 row', action: async (p) => {
  await p.getByRole('button', { name: 'Create Matter' }).click(); await wait(p, 600);
  const dlg = p.locator('[role="dialog"]');
  await pickOption(p, dlg.getByRole('combobox').nth(0), 'Placeholder Logistics Pvt Ltd (07AAAAA0005A1ZZ)');
  await pickOption(p, dlg.getByRole('combobox').nth(1), 'registration');
  await dlg.locator('input').nth(0).fill('REG-03 query on amendment — FY 2026-27');
  await dlg.getByRole('button', { name: 'Create' }).click(); await toast(p);
  await p.locator('table tbody tr', { hasText: 'M-2026-0012' }).first().click();
  await p.waitForURL(/\/litigation\/[0-9a-f-]+$/); await wait(p, 1500);
} });
add({ id: '96-matter-closed', group: 'Litigation', title: 'Closed matter detail', route: `/litigation/${MID(10)}`, steps: 'Matters list → M-2026-0008 (closed, paid)' });
add({ id: '100-litigation-mis', group: 'Litigation', title: 'Litigation MIS — Exposure', route: '/litigation-mis', mobile: true, steps: 'Reports ▾ → Litigation MIS', action: async (p) => { await wait(p, 1200); } });
for (const [n, tab, label] of [[101, 'By Client', 'by-client'], [102, 'By Stage', 'by-stage'], [103, 'By Lifecycle', 'by-lifecycle'], [104, 'Ageing', 'ageing'], [105, 'Per Staff', 'per-staff'], [106, 'Hearings', 'hearings']]) {
  add({ id: `${n}-litigation-mis-${label}`, group: 'Litigation', title: `Litigation MIS — ${tab}`, route: '/litigation-mis', steps: `Litigation MIS → "${tab}" tab`, action: async (p) => { await p.getByRole('tab', { name: new RegExp('^' + tab) }).click(); await wait(p, 2200); } });
}
add({ id: '130-mobile-nav', group: 'Shell', title: 'Mobile navigation drawer', route: '/notices-dashboard', mobileOnly: true, steps: 'Mobile → hamburger', mobileAction: async (p) => { await p.getByRole('button', { name: 'Open navigation menu' }).click(); await wait(p, 800); } });

// ───────────── runner ─────────────
const results = [];
function sel(def) { return !only || only.some((o) => def.id.startsWith(o)); }

async function capture(def, vp) {
  const id = `${vp}-${def.id}`;
  currentScreen = id;
  db.reset();
  mode = def.mode || 'strict';
  const ctx = await getContext(vp, { ext: def.ext || null, user: def.user || 'P' });
  const page = await ctx.newPage();
  const cons = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) cons.push(`[${m.type()}] ${m.text()}`.slice(0, 400)); });
  page.on('pageerror', (e) => cons.push(`[pageerror] ${e.message}`.slice(0, 400)));
  const rec = { id: def.id, vp, file: `shots/${id}.png`, route: def.route, mode, actionError: null, probe: null };
  try {
    await page.goto(BASE + def.route, { waitUntil: 'networkidle', timeout: 30000 });
    await wait(page, 1500);
    const act = vp === 'm' ? (def.mobileAction || (def.mobileOnly ? null : (def.id.startsWith('40') ? def.action : null))) : def.action;
    if (act) await act(page, rec);
    await wait(page, 600);
  } catch (e) {
    rec.actionError = String(e.message || e).split('\n')[0].slice(0, 300);
  }
  rec.finalUrl = page.url().replace(BASE, '');
  const VIEWPORT_IDS = /^(02|03|04|05|08|09|12|13|29|30|31|33|40|41|42|43|44|45|52|53|54|89|90|91|92|93|94|130)-/;
  rec.capture = VIEWPORT_IDS.test(def.id) ? 'viewport' : 'full-page';
  if (rec.capture === 'full-page') { await page.evaluate(() => window.scrollTo(0, 0)); await wait(page, 300); }
  await page.screenshot({ path: path.join(SHOTS, id + '.png'), fullPage: rec.capture === 'full-page' });
  rec.consoleErrors = [...new Set(cons)];
  rec.mockLog = logs.filter((l) => l.screen === id && (l.status >= 400 || l.blocked || l.unhandled)).map((l) => `${l.status} ${l.method} ${l.table}${l.code ? ' ' + l.code : ''}${l.message ? ' — ' + l.message : ''}${l.query ? ' ' + l.query.slice(0, 160) : ''}`);
  rec.mockLog = [...new Set(rec.mockLog)];
  rec.requests = logs.filter((l) => l.screen === id).length;
  if (def.probe) rec.text = (await textOf(page)).slice(0, 4000);
  results.push(rec);
  console.log(`${id}${rec.actionError ? '  ACTION ERROR: ' + rec.actionError : ''}  (${rec.requests} req, ${rec.mockLog.length} mock errs, ${rec.consoleErrors.length} console)`);
  await page.close();
}

if (!noDesktop) for (const def of S) if (sel(def) && !def.mobileOnly) await capture(def, 'd');
if (!noMobile) for (const def of S) if (sel(def) && (def.mobile || def.mobileOnly)) await capture(def, 'm');

// ───────────── drill-down counts (tile vs. list) ─────────────
if (!only || only.includes('counts')) {
  currentScreen = 'counts'; db.reset(); mode = 'strict';
  const ctx = await getContext('d');
  const page = await ctx.newPage();
  const counts = {};
  await page.goto(BASE + '/notices-dashboard', { waitUntil: 'networkidle' }); await wait(page, 1200);
  const dash = await textOf(page);
  const tiles = await page.evaluate(() => [...document.querySelectorAll('p.font-heading')].slice(0, 4).map((p) => (p.childNodes[0]?.textContent || '').trim()));
  counts.dashboard = {
    overdueTile: tiles[0], due7Tile: tiles[1], newTile: tiles[2], exposureTile: tiles[3],
    exposureMatters: dash.match(/(\d+) matters/)?.[1], queueTabs: dash.match(/Team · \d+[\s\S]*?Hearings · \d+/)?.[0]?.replace(/\s+/g, ' '),
    categoryTotal: dash.match(/([\d,]+) total/)?.[1],
  };
  const variants = ['', '?filter=overdue', '?filter=due7', '?filter=new', '?filter=last24h', '?filter=last15', '?filter=priority', '?filter=submitted', '?filter=replied', '?status=Open', '?status=Closed', '?type=registration', '?type=other', '?category=Demand%20Notice', '?category=Registration', '?category=Non%20filers', `?date=${dayOff(4)}`, `?client=${CID(0)}`, '?tab=merged'];
  counts.notices_all = {};
  for (const v of variants) {
    await page.goto(BASE + '/notices-all' + v, { waitUntil: 'networkidle' }); await wait(page, 800);
    const t = await textOf(page);
    counts.notices_all[v || '(none)'] = t.match(/(\d+) records?[^\n]*/)?.[0] || t.match(/Merged Notices — All Clients\n([^\n]+)/)?.[1] || null;
  }
  await page.goto(BASE + `/notices-company/${CID(0)}`, { waitUntil: 'networkidle' }); await wait(page, 1000);
  const cp = await textOf(page);
  counts.company_profile_demo_textiles = cp.match(/OVER DUE[\s\S]*?TOTAL NOTICES\n\d+[^\n]*/)?.[0]?.replace(/\n+/g, ' | ');
  await page.goto(BASE + '/notices-report', { waitUntil: 'networkidle' }); await wait(page, 800);
  counts.notice_summary_total = (await textOf(page)).match(/\nTotal\t(\d+)\t(\d+)\t(\d+)\t(\d+)/)?.slice(1);
  await page.goto(BASE + '/notices-gstin-wise-count', { waitUntil: 'networkidle' }); await wait(page, 800);
  counts.gstin_wise_header = (await textOf(page)).match(/\d+ companies · \d+ notices/)?.[0];
  await page.goto(BASE + '/notices-company-list?status=failed', { waitUntil: 'networkidle' }); await wait(page, 800);
  counts.company_list_failed_rows = (await textOf(page)).match(/Companies\n(\d+)/)?.[1];
  fs.writeFileSync(path.join(W, 'findings', 'drilldown-counts.json'), JSON.stringify(counts, null, 2));
  console.log('counts', JSON.stringify(counts, null, 1));
  await page.close();
}

// ───────────── extension popup + emails (no app) ─────────────
if (!only || only.some((o) => ['110', '111', '120', '121', '122', '123', 'ext', 'email'].some((x) => x.startsWith(o) || o.startsWith(x)))) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 460 }, deviceScaleFactor: 1, timezoneId: 'Asia/Kolkata', locale: 'en-IN' });
  await ctx.clock.setFixedTime(new Date(NOW_MS));
  await installMock(ctx, { db, schema, getMode: () => 'strict', onLog: (e) => logs.push({ screen: currentScreen, ...e }) });
  const popupClients = T0.clients.map((c) => ({ id: c.id, name: c.name, gstin: c.gstin, gst_user_id: c.gst_user_id, gst_password: c.gst_user_id ? '•••' : null, selected_returns: c.selected_returns }));
  for (const [id, variant] of [['110-extension-popup', 'ok'], ['111-extension-popup-error', 'error']]) {
    currentScreen = 'd-' + id;
    const page = await ctx.newPage();
    const cons = [];
    page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) cons.push(`[${m.type()}] ${m.text()}`.slice(0, 300)); });
    await page.addInitScript(([clients, variant]) => {
      window.chrome = {
        runtime: {
          lastError: null,
          getManifest: () => ({ version: '0.3.3' }),
          sendMessage: (msg, cb) => {
            setTimeout(() => {
              if (variant === 'error') { window.chrome.runtime.lastError = { message: 'Could not establish connection. Receiving end does not exist.' }; cb(undefined); window.chrome.runtime.lastError = null; return; }
              cb(msg.fn === 'getClients' ? { data: clients } : { data: null });
            }, 30);
          },
        },
        storage: { local: { set: async () => {}, remove: async () => {}, get: async () => ({}) }, onChanged: { addListener: () => {} } },
        tabs: { create: async () => ({ id: 1 }) },
      };
    }, [popupClients, variant]);
    await page.goto('file:///home/user/gst-keeper-pro/extension/popup.html');
    await wait(page, 800);
    await page.screenshot({ path: path.join(SHOTS, `d-${id}.png`), fullPage: true });
    results.push({ id, vp: 'd', file: `shots/d-${id}.png`, route: 'file://extension/popup.html', mode: 'n/a', consoleErrors: cons, mockLog: logs.filter((l) => l.screen === currentScreen).map((l) => `${l.status} ${l.table}`) });
    console.log('d-' + id);
    await page.close();
  }
  await ctx.close();

  const ectx = await browser.newContext({ viewport: { width: 800, height: 900 }, deviceScaleFactor: 1 });
  await installMock(ectx, { db, schema, getMode: () => 'strict', onLog: () => {} });
  for (const { id, file } of renderEmails()) {
    const page = await ectx.newPage();
    await page.goto('file://' + file); await wait(page, 300);
    await page.screenshot({ path: path.join(SHOTS, `d-${id}.png`), fullPage: true });
    results.push({ id, vp: 'd', file: `shots/d-${id}.png`, route: 'file://emails/' + id + '.html', mode: 'n/a', consoleErrors: [], mockLog: [] });
    console.log('d-' + id);
    await page.close();
  }
  await ectx.close();
}

// merge into capture-results.json (so partial re-runs keep earlier entries)
const resFile = path.join(W, 'capture-results.json');
const prev = fs.existsSync(resFile) ? JSON.parse(fs.readFileSync(resFile, 'utf8')) : [];
const key = (r) => `${r.vp}-${r.id}`;
const merged = new Map(prev.map((r) => [key(r), r]));
for (const r of results) merged.set(key(r), r);
fs.writeFileSync(resFile, JSON.stringify([...merged.values()], null, 1));
// request log: keep earlier entries for screens not re-run in this invocation
const logFile = path.join(W, 'findings', 'mock-request-log.json');
const prevLog = fs.existsSync(logFile) ? JSON.parse(fs.readFileSync(logFile, 'utf8')) : [];
const runScreens = new Set([...logs.map((l) => l.screen), ...results.map((r) => `${r.vp}-${r.id}`)]);
const keptIds = new Set([...merged.keys()]);
fs.writeFileSync(logFile, JSON.stringify([
  ...prevLog.filter((l) => !runScreens.has(l.screen) && (l.screen === 'counts' || keptIds.has(l.screen))),
  ...logs.filter((l) => l.status >= 400 || l.blocked || l.unhandled),
], null, 1));
const blocked = logs.filter((l) => l.blocked);
console.log('blocked external requests:', blocked.length, [...new Set(blocked.map((b) => b.table))]);
await browser.close();
