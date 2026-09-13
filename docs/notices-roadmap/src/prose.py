"""Prose for the roadmap/blueprint. render(ctx) returns the <body> inner HTML."""
import html


def esc(s):
    return html.escape(str(s if s is not None else ''))


def toc_titles(ctx):
    return [t for _, t in _toc(ctx)]

def _toc(ctx):
    n_broken, n_gaps = ctx['n_broken'], ctx['n_gaps']
    return [
        ('1', 'Executive summary'), ('2', 'Scope and how this review was done'),
        ('3', 'The dashboard today, annotated'), ('4', f'What is broken today ({n_broken} verified defects)'),
        ('5', 'Look and feel: from counts to action'), ('6', 'Emailing the GST team about every important matter'),
        ('7', 'The litigation module: lifecycles, stages and pages'), ('8', 'Data model'),
        ('9', 'Portal sync: making the data fresh and safe'), ('10', 'Implementation roadmap'),
        ('11', 'Acceptance criteria, KPIs, risks and decisions'),
        ('A', f'Appendix A · Gaps and improvements catalogue ({n_gaps} items)'), ('B', 'Appendix B · Competitive benchmark'),
        ('C', 'Appendix C · GST forms referenced'), ('D', 'Appendix D · Remaining medium and low defects'),
    ]

def render(ctx):
    a = ctx['audit']
    bench = next((x for x in a.get('audits', []) if x['key'] == 'benchmark'), None)
    gap_dims = a.get('gap_audits', [])
    judges = a.get('judges', [])
    drafts = a.get('roadmap_drafts', [])
    n_broken, n_gaps, n_refuted = ctx['n_broken'], ctx['n_gaps'], ctx['n_refuted']
    crit = [f for f in ctx['broken'] if ((f.get('verification') or {}).get('corrected_severity') or f.get('severity')) == 'critical']
    high = [f for f in ctx['broken'] if ((f.get('verification') or {}).get('corrected_severity') or f.get('severity')) == 'high']

    parts = []
    P = parts.append

    # ---------------- Cover ----------------
    P(f'''
<div class="cover page">
  <div class="stripe"></div><div class="stripe2"></div>
  <div>
    <div class="brand"><i></i>V J Desai &amp; Co. LLP · GST Keeper</div>
    <div class="kicker" style="margin-top:28mm">Product review · Roadmap · Blueprint</div>
    <h1 style="margin-top:6mm">Notices Dashboard and<br>Litigation Management</h1>
    <div class="sub">A UX and engineering review of the Notices Dashboard, what is broken and missing today, and a phased plan to rebuild it as a litigation ERP that emails the GST team about every matter that needs attention.</div>
  </div>
  <div>
    <div class="meta">
      <div><b>Prepared for</b>The Partners, V. J. Desai &amp; Co. LLP</div>
      <div><b>Prepared by</b>Claude Code (product design and engineering review)</div>
      <div><b>Date</b>13 September 2026</div>
      <div><b>Status</b>Draft v1.0 for partner discussion</div>
      <div><b>Scope</b>gst.vjdesai.com › Notices Dashboard family, portal sync, email pipeline</div>
      <div><b>Codebase</b>kunaldesaivjd/gst-keeper-pro @ d554f80</div>
    </div>
  </div>
</div>''')

    # ---------------- Contents ----------------
    toc = _toc(ctx)
    tp = ctx.get('toc_pages', {})
    P('<div class="page"><h2>Contents</h2><div class="toc">' + ''.join(
        f'<div class="row"><span><b>{n}</b>&nbsp;&nbsp;{esc(t)}</span><span class="muted">{tp.get(t, "")}</span></div>' for n, t in toc) + '</div>'
      '<p class="small" style="margin-top:14pt">Figures: 1 current dashboard (annotated recreation) · 2 redesigned dashboard · 3 matter drawer · 4 daily digest email. All mock-ups are rendered with the app\'s own design tokens (navy primary, coral accent, Inter/Poppins) and realistic sample data; client names in the mock-ups are illustrative.</p></div>')

    # ---------------- 1 Executive summary ----------------
    P(f'''
<div class="page np">
<h2><span class="num">1</span>Executive summary</h2>
<p class="lead">The Notices Dashboard looks the part but cannot yet be trusted or acted on. It was built as a faithful copy of a competitor's layout; the numbers on it are undermined by one defect in the portal sync, and nothing in the system tells the GST team about a notice unless someone opens the page. This document sets out what is broken, what a litigation ERP for the firm needs, a redesigned dashboard built around a daily work queue, an email alerting layer on the pipeline the firm already runs, and an 18-week phased roadmap.</p>

<div class="stats">
  <div class="stat"><div class="v">{n_broken}</div><div class="l">Verified defects</div><div class="d">{len(crit)} critical · {len(high)} high; every claim survived two adversarial verifiers</div></div>
  <div class="stat"><div class="v">{ctx['n_followup']}</div><div class="l">Further defects</div><div class="d">From the follow-up reviews; the severe ones hand-checked (§4.2)</div></div>
  <div class="stat"><div class="v">{n_gaps}</div><div class="l">Gaps and improvements</div><div class="d">UX, data model, alerting, litigation, sync, security, retention</div></div>
  <div class="stat"><div class="v">~130</div><div class="l">Person-days</div><div class="d">6 phases · 20 weeks with one developer, ~12 with two</div></div>
</div>

<h3>The seven findings that matter most</h3>
<ol>
<li><strong>Every Sync All erases the team's work.</strong> The extension deletes all of a client's notice rows and re-inserts what the portal returns (<code>extension/background.js:102–105</code>). Status, priority, owner, reply and order details entered by staff are wiped each time. This is why the live page shows Open = Total = 1,060 and a Replied column of dashes. A failed pull is worse: it replaces the client's entire history with one "PULL FAILED" row, which is then counted as a notice.</li>
<li><strong>The KPI tiles do not mean what they say.</strong> "Last 24 Hours" counts rows re-written by the last sync, not new notices; "Over Due" counts closed and replied items, ignores extended due dates and turns a notice overdue from 05:30 IST on its own due date; DRC-01, ASMT-10 and other case rows are written without any due date, so the items with the most at stake can never appear as due or overdue; three reports use three different definitions of "a notice" and cannot reconcile.</li>
<li><strong>Nothing emails anyone about a notice.</strong> The firm has a working email pipeline (Graph sender, outbox, editable templates, cron) used only for return-data reminders. There is no event for a new notice, no due-date ladder, no digest, no hearing or appeal-limitation reminder, no failed-login alert, and the outbox schema physically blocks team-level alerts (single recipient, client required, fixed kinds).</li>
<li><strong>There is no litigation model.</strong> A dispute that runs from DRC-01A to DRC-01 to reply to hearing to DRC-07 to APL-01 is stored as unrelated flat rows with free-text status and free-text assignee. No stages, statutory deadlines, hearings, demand breakdown, pre-deposit tracking, documents repository, activity log or client view exist.</li>
<li><strong>The page is a set of counts, not a place to work.</strong> Eight tiles, a client-onboarding card and a month calendar sit above a right-hand table of dashes, all in 10–11 px text, with no list of notices, no owner, ageing, amount at stake or "what needs attention today". Below the tiles the screen is empty at 1920 × 1080.</li>
<li><strong>Sync is manual, browser-bound, blind, and not wired to the production domain.</strong> Fresh data depends on a person in Chrome clicking Sync All and typing a CAPTCHA per client; the extension bridge is injected only on <code>*.vercel.app</code>, so on gst.vjdesai.com the button reports "Extension not detected" (as in the screenshot); nothing records what changed; the Windows agent runner exists but has no notices handler and no schedule.</li>
<li><strong>Litigation documents and credentials are not protected.</strong> Every scanned notice and order PDF sits in a public storage bucket at a guessable path and is fetchable without a login; storage policies let anyone with the public key delete or overwrite them; a client-role login can open the Clients page and read every portal password unmasked; the session role is restored from the browser's localStorage copy rather than the database, so a client user can promote itself; and the extension bridge accepts commands from any web page. These were found by the follow-up review and hand-checked by the author. They are not notice-dashboard bugs in the narrow sense, but no alerting layer should email links to those PDFs until they are closed, so they sit in Phase 0.</li>
</ol>

<h3>What we propose</h3>
<div class="cols">
<div>
<p><strong>Phase 0 (3 weeks) makes the numbers true and closes the holes.</strong> Replace delete-then-insert with an upsert that preserves staff columns, stop failures from writing notice rows, define every tile once, auto-close the acknowledgement rows that inflate "open" today, fix the production-domain and security defects, and write the module's positions down.</p>
<p><strong>Phase 1 (3 weeks) emails the GST team</strong> on thirteen events (new notice, due ladder, hearing, appeal limitation, critical recovery / detention notices, assignment, closure, sync failure, daily digest, weekly MIS, unassigned items, and two client-facing messages), all through the existing outbox and sender (figure 4), with a named owner and early statutory clocks so the ladder reaches a person.</p>
<p><strong>Phase 2 (4 weeks) rebuilds the page around a work queue</strong> (figure 2): a needs-attention strip, a sortable queue with bulk actions, ageing and exposure charts, a 14-day deadline strip, a sync-and-alerts card, refunds and DRC-03 with real rupee figures, and a matter drawer behind every row (figure 3).</p>
</div>
<div>
<p><strong>Phase 3 (5 weeks) adds the litigation layer</strong>: matters with stages, statutory deadline and pre-deposit engine, hearings, demand and payments linked to DRC-03, documents and a reply workspace, partner review, outcomes and a read-only client view.</p>
<p><strong>Phase 4 (3 weeks) keeps it running</strong>: unattended sync through the existing agent runner with session reuse (no CAPTCHA auto-solving), a 06:00 IST schedule, run summaries, a CAPTCHA queue, and retention and recovery so a click or a cascade cannot lose litigation records.</p>
<p><strong>Phase 5 (2 weeks) delivers MIS and client reporting</strong>: exposure, ageing, outcomes and per-staff load, a client litigation status PDF on the letterhead, and an in-app notification bell.</p>
</div>
</div>
<div class="box amber"><h4>Decisions the partners need to make first (detail in §11.4)</h4><p>(1) Confirm the legal posture for unattended portal access stays "human-typed CAPTCHA, session reuse, written client authorisation". (2) Name the team distribution list and who counts as "partner" for escalations. (3) Confirm the auto-close rules for LUT and DRC-03 acknowledgements. (4) Confirm the statutory defaults in §7.1 as the firm's positions. (5) Approve the Phase 0 security stop-gaps and a separate project-wide security track (credential encryption, Supabase Auth for staff) so RLS can become real.</p></div>
</div>''')

    # ---------------- 2 Scope & method ----------------
    dims = a.get('audits', [])
    P(f'''
<div class="page">
<h2><span class="num">2</span>Scope and how this review was done</h2>
<h3>2.1 What was reviewed</h3>
<div class="cols">
<div>
<ul>
<li>The live page as screenshotted on 13 Sep 2026 (1,060 notices, 92 GSTINs) and its source: <code>src/pages/NoticesDashboardPage.tsx</code> and the seven sibling pages of the Notices family (all-clients list, company list and profile, case folder, summary and GSTIN-wise reports, refunds and DRC-03 lists).</li>
<li>Shared helpers: <code>noticeSummaryReport.ts</code>, <code>noticeCategoryClassifier.ts</code>, <code>NoticeWorkflowListView.tsx</code>, <code>AddNoticeDialog.tsx</code>, <code>fetchAllRows.ts</code>.</li>
<li>Schema: every migration touching <code>gst_notices</code>, refunds, DRC-03, case folders, sync log, portal agent, reminders and email.</li>
<li>Portal sync: the Chrome extension (<code>background.js</code>, <code>content.js</code>) and the Windows agent runner (<code>agent/</code>).</li>
<li>Email pipeline: <code>send-gst-email</code>, <code>queue-gst-reminders</code>, the corporate email shell, cron jobs and the Reminders page.</li>
<li>Design system rules in <code>docs/UI-UX-REDESIGN.md</code>, tokens in <code>src/index.css</code> and <code>tailwind.config.ts</code>.</li>
</ul>
</div>
<div>
<h4>Not done, and why</h4>
<ul>
<li>No query was run against the live Supabase project; counts quoted are from the screenshot and from comments in the code that record live checks. Phase 0 starts with the live measurements listed in §11.1.</li>
<li>No change was made to the application. Mock-ups are static renders, not the app.</li>
<li>Competitor features (Appendix B) come from public web sources and are labelled as such.</li>
</ul>
</div>
</div>
<h3>2.2 Method</h3>
<p>The review ran as a structured, multi-reviewer process. {len(dims)} independent reviewers each read the code through one lens; every claim that something is <em>broken</em> was then handed to two adversarial verifiers whose brief was to refute it from the code (one tracing the actual data flow, one testing realistic data shapes and the soundness of the proposed fix). A claim survived only if it was not refuted by both. A completeness critic then named what the first pass had not covered, and {len(gap_dims)} targeted follow-up reviews closed those gaps. Three competing roadmap drafts (fix-first, user-first, platform-first) were scored by two judges, a partner persona and a lead-engineer persona, and the roadmap in §10 is the merge they recommended. The author separately re-read the decisive files (<code>background.js</code>, <code>content.js</code>, <code>fetchAllRows.ts</code>, the GSTIN-wise report) to confirm the headline defects by hand.</p>
<table class="compact"><thead><tr><th style="width:22%">Review lens</th><th>What it examined</th></tr></thead><tbody>
<tr><td>Look and feel</td><td>Hierarchy, density, tokens and type sizes, width use at 1920/1366/phone, tile semantics, affordances, empty/error states, accessibility.</td></tr>
<tr><td>Correctness</td><td>Every computation and drill-down link on the page, date handling, dedupe, paging, error handling, sibling-page consistency.</td></tr>
<tr><td>Data model</td><td>Tables, keys, constraints, RLS, what a litigation lifecycle needs and has no home.</td></tr>
<tr><td>Email and alerting</td><td>Existing outbox, templates, cron, sender; every missing notice event and the schema that blocks it.</td></tr>
<tr><td>Litigation ERP</td><td>The CGST lifecycles (scrutiny, audit, demand, appeal, tribunal, recovery, refund, registration, e-way bill, summons, amnesty) against what the app captures.</td></tr>
<tr><td>Portal sync</td><td>Extension and agent write paths, failure handling, idempotency, scheduling, observability.</td></tr>
<tr><td>Benchmark</td><td>What Indian notice- and litigation-management products offer that this app does not.</td></tr>
<tr><td>Staff workflow</td><td>The click path from "a notice landed" to "partner reviewed the reply", across all pages.</td></tr>
</tbody></table>
</div>''')

    # ---------------- 3 Today, annotated ----------------
    P(f'''
<div class="page np">
<h2><span class="num">3</span>The dashboard today, annotated</h2>
<p>Figure 1 recreates the live page from its source at 1600 px and marks the twelve observations that drive the redesign. The layout is a close copy of the Notice Alert product the firm pointed to when the page was built; that parity was a reasonable first target, but it imported the competitor's weaknesses (count tiles, a permanent table of placeholder rows, a month calendar with no counts) and added one of its own: onboarding buttons on a dashboard that should be about notices.</p>
<figure><img src="{ctx['img_current']}" alt="Current Notices Dashboard, annotated"><figcaption><b>Figure 1.</b> Current Notices Dashboard, recreated from source and annotated. Numbers on the tiles are those in the 13 Sep 2026 screenshot.</figcaption></figure>
<div class="cols">
<div>
<p><strong>What a partner sees.</strong> Total 1,060 and Open 1,060 say the firm has never closed a notice. Over Due 473 next to "7 Days Due 0" says nearly half the portfolio is late and nothing is coming up, which no litigation practice would believe. Last 24 Hours 64 against Last 15 Days 3 says more arrived today than in the last fortnight. Each of these is an artefact of how the data is written, not a fact about the practice (§4).</p>
<p><strong>What a staff member cannot do here.</strong> See a single notice; see who owns anything; see money at stake; sort by deadline; assign, prioritise or close in bulk; search; or learn when the data was last refreshed.</p>
</div>
<div>
<p><strong>What the visual system does.</strong> Twenty-three uses of 10–11 px text, muted-on-muted tints, icon-only buttons without labels, a fixed 380 × 620 px scroll box holding the main content, and dead space under the second row. The app's own design rules (semantic tokens, 8-point rhythm, <code>PageHeader</code>, <code>TableEmptyState</code>, aria-labels on icon buttons) are documented in <code>docs/UI-UX-REDESIGN.md</code> and are not followed on this page.</p>
<p><strong>What is good and stays.</strong> The category taxonomy (Appeal, ASMT 10, DRC 01, DRC 03, LUT, Refund…), the drill-down idea behind every number, the per-client profile and case-folder pages, and the portal PDF capture are sound and are reused throughout the redesign.</p>
</div>
</div>
<div class="box blue"><h4>Live-data check (read-only, public key, 13 Sep 2026)</h4><p>The follow-up review reproduced every tile from the live tables with the page's own formulas, so the arithmetic is faithful and the semantics are the problem. Of the 1,060 rows, 587 have no due date and 473 have one; every one of those 473 is in the past (latest 7 Sep 2026), which is why "Over Due" is 473 and "7 Days Due" is structurally zero. All 403 case/task rows (DRC-01, ASMT-10, LUT, enforcement…) were written with no due date although the case-folder JSON already stored holds 159 due dates and 35 hearing dates. "Last 24 Hours" = 64 is the six clients synced on 12 Sep; the newest issue date in that batch is 17 Jul. Of the 167 "open" DRC-03 cases, 131 are portal acknowledgements of accepted payments; of the 41 "open" refunds, 22 already ended in an RFD-06 / PMT-03 order. No row has a staff status, priority or owner set, which is consistent with the sync wiping them or with nobody having entered them; either way, no staff work currently survives a sync. No "PULL FAILED" rows exist today.</p></div>
</div>''')

    # ---------------- 4 Broken ----------------
    refuted = a.get('refuted_broken', [])
    P(f'''
<div class="page">
<h2><span class="num">4</span>What is broken today ({n_broken} verified defects)</h2>
<h3>4.1 Critical and high defects ({ctx['n_broken_main']})</h3>
<p>Each item below was raised by at least one reviewer and survived two adversarial verification passes; file references point at the current <code>main</code>. Severity: <span class="sev critical"></span>critical = wrong data or data loss in production; <span class="sev high"></span>high = a number or link a partner would rely on is wrong; <span class="sev medium"></span>medium = incorrect in edge cases or hides errors; <span class="sev low"></span>low = polish. Effort is S (hours), M (days), L (a week or more). All of these are scheduled in Phase 0 except where the fix column names a later phase. The {ctx['n_broken_rest']} medium and low defects are listed in Appendix D.</p>
{ctx['broken_table']}
<div class="box"><h4>Verification record</h4><p>{'None of the first-pass "broken" claims was refuted: ' if not refuted else str(n_refuted) + ' claims were refuted and dropped: '}{'two verifiers per review lens traced each claim from the data source to the rendered value and tested it against realistic row shapes; several corrected a line number or sharpened the fix, and those corrections are reflected above.' if not refuted else '; '.join(esc(r['title']) for r in refuted[:8])}</p></div>

<h3>4.2 Further defects from the follow-up reviews ({ctx['n_followup_main']} critical and high; {ctx['n_followup_rest']} more in Appendix D)</h3>
<p>The completeness critic named six areas the first pass had not covered (live-data reconciliation, the trust boundary between app, extension and storage, deletion and retention, role-by-role permissions, institutional knowledge, and the refund / DRC-03 surfaces). These reviews ran after the adversarial pass, so their items were not independently refuted. The author hand-checked the most severe: the production-domain manifest gap, the bridge's missing origin check, the public bucket and its "anyone can delete" policies, the role restored from localStorage, and the unguarded Clients route are all confirmed in the current code. Rows below are numbered on from the table above.</p>
{ctx['followup_table']}
</div>''')

    # ---------------- 5 Design ----------------
    P(f'''
<div class="page np">
<h2><span class="num">5</span>Look and feel: from counts to action</h2>
{ctx['sec_design']}
</div>
<div class="page np">
<figure><img src="{ctx['img_dash']}" alt="Redesigned dashboard"><figcaption><b>Figure 2.</b> Redesigned Notices &amp; Litigation dashboard at 1600 px. Needs-attention strip, work queue with bulk actions, ageing and exposure, category bars, 14-day deadline strip, sync and alerts. Sample data.</figcaption></figure>
<figure><img src="{ctx['img_drawer']}" alt="Matter drawer"><figcaption><b>Figure 3.</b> The matter drawer behind every row: stage stepper, demand and payments, statutory deadline with its basis, activity, documents, emails and key dates. Sample data.</figcaption></figure>
</div>''')

    # ---------------- 6 Email ----------------
    P(f'''
<div class="page np">
<h2><span class="num">6</span>Emailing the GST team about every important matter</h2>
{ctx['sec_email']}
<figure style="max-width:120mm;margin-left:auto;margin-right:auto"><img src="{ctx['img_email']}" alt="Daily digest email"><figcaption><b>Figure 4.</b> The daily digest (event E2) as it would arrive at gst@vjdesai.com at 09:30 IST: act-today items with demand, this week's deadlines and hearings, new captures, failed logins. Sample data.</figcaption></figure>
</div>''')

    # ---------------- 7 Litigation module ----------------
    P(f'''
<div class="page np">
<h2><span class="num">7</span>The litigation module: lifecycles, stages and pages</h2>
<h3>7.0 Module map</h3>
<table class="compact"><thead><tr><th style="width:22%">Page / surface</th><th style="width:48%">Purpose</th><th style="width:30%">Builds on</th></tr></thead><tbody>
<tr><td><b>Dashboard</b></td><td>Needs-attention strip, work queue, ageing and exposure, category bars, 14-day strip, sync and alerts (figure 2).</td><td>Replaces <code>NoticesDashboardPage</code>; keeps its route.</td></tr>
<tr><td><b>Work Queue</b></td><td>Full firm-wide list with saved filters (overdue, due 7d, unassigned, high priority, new, hearings), bulk actions, export.</td><td>Evolves <code>AllClientsNoticesPage</code> and <code>NoticeWorkflowListView</code>.</td></tr>
<tr><td><b>Matters</b></td><td>List and board (by stage) of litigation matters; create from any notice; filters by lifecycle, client, owner, officer, FY.</td><td>New page on <code>litigation_matters</code>.</td></tr>
<tr><td><b>Matter drawer / page</b></td><td>Everything about one dispute (figure 3): stepper, deadlines, demand and payments, hearings, documents, reply workspace, review, emails, notes.</td><td>Replaces the edit dialog; absorbs <code>AdditionalNoticeFolderPage</code>.</td></tr>
<tr><td><b>Hearings</b></td><td>Calendar and list of hearings and statutory dates; ICS export; adjournment logging; documents-to-carry checklist.</td><td>New page on <code>matter_hearings</code>.</td></tr>
<tr><td><b>Client profile › Notices</b></td><td>Per-client view: open matters, exposure, sync health, documents requested, one-click client status report.</td><td>Evolves <code>CompanyProfilePage</code>.</td></tr>
<tr><td><b>Reports</b></td><td>Notice summary and GSTIN-wise count (corrected), exposure by client/stage/officer/section, ageing, outcomes and time-to-close, per-staff load, client litigation status PDF.</td><td>Existing report kit and letterhead PDFs.</td></tr>
<tr><td><b>Settings › Notice alerts</b></td><td>Rules (events, offsets, recipients, escalation, quiet hours), templates, distribution list, per-person preferences.</td><td>Extends <code>RemindersPage</code>.</td></tr>
<tr><td><b>Client portal › Notices &amp; litigation</b></td><td>Read-only stage, next date, documents requested, filed replies.</td><td>New tab in the client portal.</td></tr>
<tr><td><b>Permissions</b></td><td><code>manage_notices</code> (edit, assign, stage), <code>close_matters</code>, <code>partner_review</code>, <code>view_exposure</code>; superadmin and gst_manager implicit as today.</td><td><code>user_permissions</code> keys and the <code>can*()</code> helpers.</td></tr>
</tbody></table>
{ctx['sec_lifecycle']}
</div>''')

    # ---------------- 8 Data model ----------------
    P(f'''
<div class="page np">
<h2><span class="num">8</span>Data model</h2>
{ctx['sec_datamodel']}
</div>''')

    # ---------------- 9 Sync ----------------
    P(f'''
<div class="page np">
<h2><span class="num">9</span>Portal sync: making the data fresh and safe</h2>
{ctx['sec_sync']}
</div>''')

    # ---------------- 10 Roadmap ----------------
    judge_html = ''
    if judges:
        rows = []
        for j in judges:
            for s in j.get('scores', []):
                rows.append(f'<tr><td>{esc(j["role"])}</td><td>{esc(s["draft"])}</td><td class="c">{s["completeness"]}</td><td class="c">{s["sequencing"]}</td><td class="c">{s["feasibility_in_this_codebase"]}</td><td class="c">{s["value_to_ca_firm"]}</td><td class="c"><b>{s["total"]}</b></td></tr>')
        merges = ('<p><strong>What the judges agreed on.</strong> The partner judge preferred the fix-first draft as the spine (stabilise, email the team, rebuild the screen, litigation core, durability); the engineer judge preferred the user-first draft (stabilise plus security, the 08:30 inbox, the screen with owners, litigation core, refunds and MIS, keep-it-running). Both orders put the inbox before the redesign and both judges made the same four corrections: give Phase 0 three weeks rather than two, seed a minimal deadlines table from existing rows so limitation reminders fire in the email phase, roll alerts out digest-first with a preview week and caps, and pull the refund / DRC-03 rupee back-fill forward so the redesigned dashboard never shows ₹ 0 for a paid DRC-03. The engineer judge added the job-lifecycle items (idle-based expiry, login-failure logging, version handshake, acting user on every bridge message) to Phase 0 and asked for sensitive writes to move behind SECURITY DEFINER RPCs; the partner judge asked for Phase 3 to be split into 3a and 3b and for a week of slack per phase. Section 10.2 is that merge. The judges\' full notes are in the review record.</p>')
        judge_html = f'''<h3>10.3 How the sequencing was chosen</h3>
<p>Three drafts were written from different starting points and scored by two judges (1–10 per criterion).</p>
<table class="compact"><thead><tr><th>Judge</th><th>Draft</th><th class="c">Complete</th><th class="c">Sequencing</th><th class="c">Feasible here</th><th class="c">Value to firm</th><th class="c">Total</th></tr></thead><tbody>{''.join(rows)}</tbody></table>
{merges}'''
    P(f'''
<div class="page np">
<h2><span class="num">10</span>Implementation roadmap</h2>
{ctx['sec_roadmap']}
{judge_html}
</div>''')

    # ---------------- 11 Acceptance, KPIs, risks, decisions ----------------
    P('''
<div class="page np">
<h2><span class="num">11</span>Acceptance criteria, KPIs, risks and decisions</h2>
<h3>11.1 Day-one measurements (before any change)</h3>
<p>Run once against the live project and record in the Phase 0 ticket, so the "after" can be proven: count of gst_notices rows; rows with description starting "PULL FAILED"; rows with a non-null staff_status, priority, assign_to, reply_date; duplicate (client_id, reference_number) pairs; case rows with null due_date; clients with a failed latest sync; clients whose latest sync is older than 7 days; email_outbox rows by kind and status in the last 30 days.</p>
<h3>11.2 Acceptance criteria by phase</h3>
<table class="compact"><thead><tr><th style="width:12%">Phase</th><th>Done means</th></tr></thead><tbody>
<tr><td>0</td><td>Two consecutive syncs of one client leave every staff column unchanged; no sentinel rows; tile counts equal their drill-down counts and the GSTIN-wise report; Sync All starts on gst.vjdesai.com; a client-role login cannot read portal passwords or fetch a PDF without a session; positions document merged; build green; no route removed.</td></tr>
<tr><td>1</td><td>E1–E11 live on corrected data; a new DRC-01 reaches the team inbox within 15 minutes with the PDF; re-running the cron sends nothing twice; digest daily at 09:30 IST; Monday MIS to partners; templates editable by staff; an order with no appeal filed produces a T-30 limitation email.</td></tr>
<tr><td>2</td><td>Partner can, from the dashboard alone, find today's overdue items with demand, assign them, set priority and close with a reason; DRC-03 and refund rows show real amounts; Lighthouse accessibility ≥ 95; no text under 12 px; page usable at 1024 px and on a phone.</td></tr>
<tr><td>3</td><td>All open notices attached to a matter or listed as exceptions; DRC-07 capture creates an appeal clock and pre-deposit figure automatically; hearings on the calendar with reminders; client view live for one pilot client.</td></tr>
<tr><td>4</td><td>Ten consecutive days with every active client synced within 24 h or a named failure reason; CAPTCHA queue cleared in-app; run summaries on the dashboard; a deleted client restorable with all records; backup / recovery procedure tested once.</td></tr>
<tr><td>5</td><td>Exposure, ageing, outcome and load reports match the dashboard; client status PDF in one click; first paint under 1.5 s with 5,000 notices.</td></tr>
</tbody></table>
<h3>11.3 KPIs the partners should watch monthly</h3>
<div class="cols">
<ul>
<li>Missed statutory deadlines (target: zero; every miss gets a written cause).</li>
<li>Replies filed at least 3 days before the due date (target: 90%).</li>
<li>Notices assigned within 24 hours of capture (target: 100%).</li>
<li>Median time from capture to first action (target: under 2 working days).</li>
</ul>
<ul>
<li>Sync freshness: active clients synced in the last 24 h (target: 100%).</li>
<li>Staff-data-loss incidents (target: zero, verified by the Phase 0 test).</li>
<li>Exposure under dispute and pre-deposits outstanding, by client and stage.</li>
<li>Outcomes: matters dropped / reduced / confirmed, and time-to-close by lifecycle.</li>
</ul>
</div>
<h3>11.4 Risks and mitigations</h3>
<table class="compact"><thead><tr><th style="width:28%">Risk</th><th style="width:42%">Mitigation</th><th style="width:30%">Owner / phase</th></tr></thead><tbody>
<tr><td>Portal API or DOM changes break capture silently</td><td>Zero-row and shape anomalies raise E9; extension/agent version handshake; a "shadow" run mode before switching writers.</td><td>Phase 4; reviewed each portal release</td></tr>
<tr><td>GSTN terms on automated access</td><td>No CAPTCHA solving; session reuse with a human in the loop; written client authorisation; agent machine office-local; credentials encrypted at rest.</td><td>Partner decision before Phase 4</td></tr>
<tr><td>Client credentials, notice PDFs and every litigation row readable and writable with the public anon key (open RLS by project rule; public storage bucket; role trusted from localStorage)</td><td>Phase 0 stop-gaps (private bucket and signed URLs, storage policies, route guards, role from the database, bridge origin check, password masking); then a project-wide track: credentials behind an edge function with the service role, encryption at rest, Supabase Auth for staff so RLS can be real, sensitive writes through SECURITY DEFINER RPCs.</td><td>Phase 0 now; security track decision</td></tr>
<tr><td>Migrating 1,060 rows into matters mis-groups disputes</td><td>Suggested-matters review page; grouping by case ARN first; nothing auto-merged without a staff confirmation.</td><td>Phase 3a</td></tr>
<tr><td>Records lost by a client delete or a cascade; no backup procedure documented</td><td>Soft delete on litigation tables, archive-with-audit instead of delete, PDF cleanup, tested point-in-time recovery, legal-hold flag.</td><td>Phase 4</td></tr>
<tr><td>Institutional knowledge lives in code comments; git history was squashed</td><td>Positions document, CLAUDE.md section, staff SOP and runbook in Phase 0; every later position change edits the document first.</td><td>Phase 0</td></tr>
<tr><td>Alert fatigue</td><td>Digest-only preview week, team list plus roles, dedupe keys, per-client batching, overdue repeat cap, quiet hours, critical-only immediate sends outside hours; rules editable by staff.</td><td>Phase 1</td></tr>
<tr><td>Statutory defaults drift with Finance Acts</td><td><code>litigation_rules</code> table with effective dates; computed vs overriding deadlines; every alert names its basis.</td><td>Phase 3; annual review</td></tr>
<tr><td>No automated tests in the project</td><td>Phase 0 adds a small Vitest suite for the tile definitions, date handling and the upsert contract; every phase adds tests for its engine code.</td><td>Phase 0 onward</td></tr>
</tbody></table>
<h3>11.5 Decisions requested from the partners</h3>
<ol>
<li>Approve the legal posture for unattended sync (§9.1 box) or restrict Phase 4 to extension-only runs.</li>
<li>Name the distribution list for team alerts and the partner recipients for escalations and the Monday MIS.</li>
<li>Confirm auto-close rules: LUT acknowledgements, DRC-03 acknowledgements, case rows with a closure item.</li>
<li>Confirm the statutory defaults in §7.1 as the firm's positions, in the same way the Builder and Advance positions are documented today.</li>
<li>Approve the Phase 0 security stop-gaps now, and decide on the project-wide security track in §11.4 (credential encryption, Supabase Auth for staff, RPC-guarded writes).</li>
<li>Confirm that alerting (Phase 1) precedes the redesign (Phase 2), as both judges recommended, or reverse it if the visual change is the more urgent need this quarter.</li>
<li>Staffing: one developer for 20 weeks or two for about 12.</li>
</ol>
</div>''')

    # ---------------- Appendix A ----------------
    P(f'''
<div class="page np">
<h2><span class="num">A</span>Appendix A · Gaps and improvements catalogue ({n_gaps} items)</h2>
<p>Everything the review found missing or improvable, ordered by priority. These are design judgements rather than defects; each names the proposal and the effort. The roadmap in §10 schedules the critical and high items; medium and low items ride along with the phase that touches their area.</p>
{ctx['gap_table']}
</div>''')

    # ---------------- Appendix B ----------------
    bench_html = '<p>The benchmark review did not return a result; see the review record.</p>'
    if bench:
        bench_html = f'<p>{esc(bench["summary"])}</p>'
    bench_items = [g for g in ctx['gaps'] if g.get('dimension') == 'benchmark']
    if bench_items:
        bench_html += '<table class="compact"><thead><tr><th style="width:30%">Feature seen in the market</th><th style="width:40%">Evidence</th><th style="width:30%">How it fits this app</th></tr></thead><tbody>' + ''.join(
            f'<tr><td><b>{esc(g["title"])}</b></td><td class="small">{esc(g.get("evidence",""))}</td><td>{esc(g.get("proposed_fix",""))}</td></tr>' for g in bench_items) + '</tbody></table>'
    P(f'''
<div class="page np">
<h2><span class="num">B</span>Appendix B · Competitive benchmark</h2>
{bench_html}
</div>''')

    # ---------------- Appendix C ----------------
    forms = [
        ('ASMT-10 / 11 / 12', 'Scrutiny notice, reply, acceptance'), ('ADT-01 / 02', 'Audit notice, audit findings'),
        ('DRC-01A / 01 / 02 / 06 / 07 / 08', 'Pre-SCN intimation, show cause notice, statement, reply, order summary, rectified order'),
        ('DRC-01B / 01C / 01D', 'Liability mismatch, ITC mismatch intimations, recovery intimation'),
        ('DRC-03 / 03A / 04', 'Voluntary payment, adjustment against demand, acknowledgement'),
        ('DRC-09 / 13 / 16 / 20 / 22', 'Recovery: deduction, garnishee, attachment, instalments, provisional attachment'),
        ('APL-01 / 02 / 04 / 05', 'First appeal, acknowledgement, appellate order summary, tribunal appeal'),
        ('RFD-01 … 09, PMT-03', 'Refund application through order, and re-credit'),
        ('REG-17 … 24', 'Registration cancellation SCN, reply, orders, revocation'),
        ('GSTR-3A', 'Notice to return defaulter'), ('MOV-01 … 11', 'E-way bill inspection, detention, penalty, confiscation'),
        ('SPL-01 / 02 / 05 / 07', 'Amnesty (s.128A) applications and orders'), ('s.70 summons', 'Appearance before the officer'),
    ]
    P('<div class="np"><h2><span class="num">C</span>Appendix C · GST forms referenced</h2><table class="compact"><thead><tr><th style="width:32%">Form(s)</th><th>Meaning</th></tr></thead><tbody>' +
      ''.join(f'<tr><td class="mono">{esc(f)}</td><td>{esc(m)}</td></tr>' for f, m in forms) + '</tbody></table>'
      '<p class="small">This document is a planning draft. Statutory references are to the CGST Act 2017 and CGST Rules 2017 as generally applied in 2026 and must be confirmed against the current text and notifications before being encoded as firm positions.</p></div>')

    # ---------------- Appendix D ----------------
    P(f'''
<div class="np">
<h2><span class="num">D</span>Appendix D · Remaining medium and low defects</h2>
<p>Verified defects of medium and low severity ({ctx['n_broken_rest']}), continuing the numbering of §4.1, followed by the medium and low items from the follow-up reviews ({ctx['n_followup_rest']}). All are scheduled with the phase that touches their area, most in Phase 0.6.</p>
<h3>D.1 Verified, medium and low</h3>
{ctx['broken_table_rest']}
<h3>D.2 Follow-up reviews, medium and low</h3>
{ctx['followup_table_rest']}
</div>''')

    return ''.join(parts)
