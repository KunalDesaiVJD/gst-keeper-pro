export const pillars = [
 { key:'Zero-touch', name:'Minimum human intervention', today:1, target:4,
   now:'Nothing runs unless someone clicks. Sweep errors on every run, alert e-mails cannot be produced, and a newly captured notice creates no event, owner or reminder.',
   next:'Database triggers turn every portal change into an owner, a clock and an alert; the sweep runs after each sync; the agent runs on a schedule.' },
 { key:'Fetch', name:'Easiest fetching from the portal', today:2, target:4,
   now:'The extension already reaches 22 portal data sets through the portal’s own JSON calls — a strong base. But every refresh is a serial 2–4 hour run with one typed CAPTCHA per client, everything is re-downloaded each time, and about 3 staff-hours a day go into keeping data current.',
   next:'Incremental, identity-checked runs through one server door; an office agent on a 05:30 / 13:00 schedule; all CAPTCHAs on one screen; portal e-mails trigger targeted syncs.' },
 { key:'Reply speed', name:'Minimum time to furnish a reply', today:1, target:4,
   now:'The reply happens outside the app — Excel workings, Word drafts, e-mail review, manual filing. A typical ASMT-10 / DRC-01A takes about 9–11 staff-hours over 12–25 days although the app already holds most of the evidence.',
   next:'Read the notice automatically, split it into issues, compute the firm’s position from GSTR-1 / 3B / 2B data, draft with AI under hard numeric gates, file with the extension’s help and record the ARN automatically.' },
 { key:'At-a-glance', name:'Dashboard at a glance', today:2, target:5,
   now:'The redesigned dashboard looks right, but its numbers do not reconcile with the lists they open — on one fictional test data set the Overdue tile says 14 while the list it opens shows 69 — exposure is computed three ways, the work queue reads an arbitrary 1,000-row slice sorted newest-first, and the sync card shows hard-coded text. The all-notices “work queue” is a 23-column export, not a queue.',
   next:'One canonical notice view feeds every tile, list, report and e-mail; the Command centre shows today’s plan with one next action per row.' },
 { key:'Per-notice', name:'Per-notice view', today:1, target:5,
   now:'The only per-notice view (the drawer) queries a column that does not exist and shows “Notice not found”; even when fixed it is read-only and cannot be opened by URL. Due dates, hearings and demand by head stay trapped inside folder JSON.',
   next:'A Notice workspace at /notices/:id with issues, evidence, draft, documents, clocks, payments and the next action — the page every e-mail links to.' },
 { key:'Data trust', name:'Foundation — data you can trust', today:2, target:5,
   now:'A zero-row or partly failed pull soft-deletes a client’s notices; failed PDF downloads blank good links; an old extension copy still hard-deletes; Add Notice cannot save; the build does not type-check, which is how several broken queries shipped.',
   next:'Safety rails on every write, a run ledger, a type-check gate and one definition of every metric.' },
 { key:'Security', name:'Foundation — security', today:1, target:4,
   now:'Notice PDFs sit in a public bucket anyone can overwrite or delete; client portal passwords are plaintext and readable with the public key; the extension obeys any *.vercel.app page; a third-party token is committed to the repository.',
   next:'Private storage with signed links, a locked-down bridge, rotated secrets, then the project-wide move to server-side sessions and encrypted credentials.' }];

export const execSummary = `
<p><b>Bottom line.</b> The Notices &amp; Litigation module has the right skeleton. The Chrome extension already reaches almost every portal data set a CA firm needs, and the September redesign put a dashboard, work queue, notice drawer, alert rules and litigation tables in place. But very little of the automation actually runs, the dashboard’s numbers do not agree with the lists behind them, and the reply itself — the slowest and most expensive part — still happens entirely outside the app. <b>Of the 35 items in the September roadmap, none is complete: 30 are partly built and 5 have not started.</b></p>
<p><b>What the audit found.</b></p>
<ul>
<li><b>Built but not running.</b> The notice drawer, the alert e-mails and the closing sweep fail at runtime because the code asks for database columns that do not exist (<code>hearing_date</code>, <code>notice_id</code>, <code>contact_person</code>, <code>last_name</code>). The drawer shows “Notice not found” for every notice; no alert e-mail can be queued; nothing has ever been auto-closed or given a due date by the sweep. The TypeScript checker reports every one of these — but the commit gate (<code>vite build</code>) does not run it.</li>
<li><b>People do the machine’s work.</b> About 3 staff-hours a day go into keeping portal data current: a serial run, one typed CAPTCHA per client, a tab that must stay open. Each ASMT-10 or DRC-01A then costs about 9–11 staff-hours, most of it re-keying and hunting for figures the app already holds (filed GSTR-1 / 3B, 2B reconciliation, ITC and RCM ledgers, DRC-03).</li>
<li><b>The screens disagree with each other.</b> On one fictional test data set, the Overdue tile says 14 while the list it opens shows 69; “22 matters” on the dashboard are notices with a demand, while Litigation MIS shows 9 open matters; a matter created from the list offers “Reopen” because one screen writes “open” and another checks for “Open”. Across {{UI_N}} screens the average score is <b>{{UI_AVG}} / 10</b>, and none of them uses the house style the rest of the app adopted this month.</li>
<li><b>Data can be lost.</b> A pull that returns zero rows or partly fails soft-deletes the client’s notices; one failed PDF download blanks a link that worked yesterday; an outdated extension copy still hard-deletes notices and staff work; Add Notice cannot save at all.</li>
<li><b>Security needs attention before any automation or AI.</b> Notice PDFs are in a public bucket that anyone can overwrite or delete; portal passwords are stored in plain text and readable with the public key that ships in the extension; the extension obeys any <code>*.vercel.app</code> page; a third-party token is committed to the repository and should be rotated now.</li>
</ul>
<p><b>The plan.</b> Seven phases over about 20 weeks with two developers working with Claude Code (≈ 150 person-days plus slack). It first makes the module safe and truthful, then lets the database turn every portal change into work, then builds the Command centre and a Notice workspace, puts fetching on autopilot, and finally builds a <b>Reply Factory</b> that reads each notice, computes the firm’s position from the app’s own data, drafts the reply under hard numeric gates and helps file it.</p>`;

export const outcomes = [
 ['Human time to keep portal data current','≈ 3 h / day','≤ 20 min / day','Phase 3'],
 ['Portal issue → notice in the app','2–7 days (whenever someone syncs)','&lt; 24 h; &lt; 4 h for 7-day forms','Phase 1–3'],
 ['Staff time per ASMT-10 / DRC-01A reply','≈ 9–11 h','≈ 1 h 45 min','Phase 4–5'],
 ['Time to first draft','7–14 days','≤ 1 working day (DRC-01B/01C ≤ 2 h)','Phase 5'],
 ['Re-keyed fields per notice','15–25','≤ 2','Phase 4–5'],
 ['Dashboard numbers that match their lists','some','all (tested)','Phase 1'],
 ['Filings recorded without re-keying','0%','≥ 95% within 24 h','Phase 5']];

export const firstTen = [
 ['Rotate the token committed in <code>supabase/functions/gst-push/README.md</code>; keep it only in Supabase secrets.','R-02'],
 ['Make the <code>return-pdfs</code> bucket private and serve signed URLs; remove anonymous upload / update / delete policies.','R-01'],
 ['Restrict the extension bridge to the app’s own origin.','S-12'],
 ['Fix the four broken queries (<code>hearing_date</code>, <code>notice_id</code>, <code>contact_person</code>, <code>last_name</code>) and seed the missing alert templates.','L-01, L-02, L-03, L-08'],
 ['Add <code>tsc --noEmit</code> to the commit gate.','L-20'],
 ['Guard the soft-delete against zero-row and failed pulls; never send portal-owned columns as NULL.','L-05, L-06'],
 ['Fix Add Notice (manual <code>portal_key</code>, never soft-deleted by sync).','L-07'],
 ['Enforce a minimum extension version and block hard deletes with a trigger.','S-04'],
 ['Remove the hard-coded “06:00 IST” and “0 e-mails” lines from the sync card.','S-13'],
 ['Fix the top-nav labels (“Matters” and “Hearings” open the wrong pages).','L-40']];

export const method = `
<p><b>Scope.</b> Every route, tab, drawer, dialog, popover and link of the Notices &amp; Litigation module (dashboard, work queue, all-notices list, notice drawer, company list and profile, case folder, Notice Summary, GSTIN-wise count, refunds, DRC-03, litigation matters, matter detail, MIS), the Chrome extension and its popup, the Playwright agent, the alert e-mails, and the database objects behind them.</p>
<p><b>How.</b> The production build was run in Chromium and every screen was captured at desktop (1440 px) and phone (390 px) width. The backend was replaced by an in-memory mock filled with <b>fictional</b> clients, notices, case folders, refunds, DRC-03 payments and matters, so no real client data appears anywhere in this report and nothing touched the live database or the GST portal. Four specialist reviews then read the code behind each screen: the extension and sync pipeline, the logic and data layer, the reply workflow, and the screens themselves. Severe findings were re-checked by hand against the code and the TypeScript compiler before inclusion.</p>
<p><b>Limits.</b> Because the data is mocked, a screen can look healthy here and still fail live where its query names a missing column — such cases are called out from the code. Counts quoted from the live database (for example “reply_date logged on 0 rows”) come from the 13 September 2026 live check recorded in <code>docs/notices-roadmap/review-record.json</code>. Statements of law are marked <b>verify</b> wherever the current text should be confirmed before it is encoded.</p>
<p><b>Reading the IDs.</b> S- = extension and sync, L- = logic and data, R- = reply workflow and per-notice, U- = a finding on a specific screen. Severity: <span class="sev Critical">Critical</span> data loss, security exposure or a core feature that cannot work; <span class="sev High">High</span> wrong numbers or a large time cost; <span class="sev Medium">Medium</span> friction or inconsistency; <span class="sev Low">Low</span> polish.</p>`;
