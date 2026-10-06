import fs from 'fs';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { merged, sync, logic, reply } from './merge.mjs';
import { phases, later, decisions } from './roadmap.mjs';
import { pillars, execSummary, outcomes, firstTen, method } from './content.mjs';
const D = new URL('.', import.meta.url).pathname;
const OUT = process.argv[2] || D + 'report.pdf';
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const md = s => esc(s).replace(/`([^`]+)`/g,'<code>$1</code>');           // backticks → code
const ids = s => String(s).split(/,\s*/).map(x=>`<span style="white-space:nowrap">${x}</span>`).join(', ');
const sev = s => `<span class="sev ${esc(s)}">${esc(s)}</span>`;
const stt = s => `<span class="st ${String(s).startsWith('Not')?'Not':esc(s)}">${esc(s)}</span>`;
const exists = p => fs.existsSync(D + p);
const img = p => 'file://' + D + p;
const F = merged();
const M = id => (JSON.parse(fs.existsSync(D+'manifest.json')?fs.readFileSync(D+'manifest.json','utf8'):'[]')).find(m => m.id === id);
const FB = Object.fromEntries([...sync.findings, ...logic.findings, ...reply.findings].map(f => [f.id, f]));
const manifest = exists('manifest.json') ? JSON.parse(fs.readFileSync(D + 'manifest.json','utf8')) : [];
const ui = ['ui-a','ui-b','ui-c'].filter(f => exists(`findings/${f}.json`)).map(f => JSON.parse(fs.readFileSync(D + `findings/${f}.json`,'utf8')));
const uiScreens = Object.fromEntries(ui.flatMap(u => u.screens || []).map(s => [s.id, s]));
const uiCross = ui.flatMap(u => u.crossCutting || []);
const uiCross2 = exists('findings/ui-cross.json') ? JSON.parse(fs.readFileSync(D+'findings/ui-cross.json','utf8')) : [];
const uiFindings = ui.flatMap(u => (u.screens||[]).flatMap(s => (s.findings||[]).map(f => ({...f, screen:s.id}))));
const cnt = a => a.reduce((m,f)=>(m[f.severity]=(m[f.severity]||0)+1,m),{});
const cD = cnt(F), cU = cnt(uiFindings);
const rs = logic.roadmapStatus; const rsC = cnt(rs.map(r=>({severity:r.status.startsWith('Not')?'Not':r.status})));
const totalPd = phases.reduce((a,p)=>a+p.pd,0);

const findingsTable = (list, opts={}) => list.length ? `<table><thead><tr><th style="width:44px">ID</th><th style="width:52px">Severity</th><th>Issue and evidence</th><th style="width:36%">Fix</th>${opts.effort?'<th style="width:30px">Size</th>':''}</tr></thead><tbody>${
  list.map(f=>`<tr><td><b>${esc(f.id)}</b>${f.alsoFoundAs?.length?`<div class="ref" style="word-break:normal">= ${ids(esc(f.alsoFoundAs.join(', ')))}</div>`:''}</td><td>${sev(f.severity)}</td><td>${md(f.issue)}${f.impact?`<div class="small" style="margin-top:2px"><b>Impact:</b> ${md(f.impact)}</div>`:''}<div class="ref">${esc(f.evidence||f.ref||'')}</div></td><td>${md(f.fix)}</td>${opts.effort?`<td class="c">${esc(f.effort||'')}</td>`:''}</tr>`).join('')}</tbody></table>` : '<p class="sub">No findings in this group.</p>';
const byPillar = (p, sevs=['Critical','High']) => F.filter(f => f.pillar===p && sevs.includes(f.severity));
const jpg = f => { const j = 'shots-jpg/' + f.split('/').pop().replace(/\.png$/,'.jpg'); return exists(j) ? j : f; };
const shotFig = (file, cap, cls='') => file && exists(file) ? `<figure class="shot ${cls}"><img src="${img(jpg(file))}"><figcaption>${esc(cap)}</figcaption></figure>` : '';
const mock = (file, cap) => exists('mocks/'+file) ? `<div class="mock avoid"><img src="${img(exists('mocks-jpg/'+file.replace('.png','.jpg'))?'mocks-jpg/'+file.replace('.png','.jpg'):'mocks/'+file)}"><div class="sub small" style="margin-top:3px">${cap}</div></div>` : '';

// ---------- sections ----------
const cover = `<section class="cover"><div><div class="band"><div style="font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:#c7d2fe">GST Keeper Pro · Notices &amp; Litigation</div><h1 style="margin-top:6px">Mission audit and build roadmap</h1><div class="sub">Every screen, tab, drawer, dialog and link of the Notices module, the Chrome extension and portal sync, the reply workflow — and a phased plan for minimum human intervention, the easiest portal fetching, the fastest reply and a dashboard you can read at a glance.</div></div>
<div class="kpis" style="margin-top:16px"><div class="kpi"><b>${manifest.length || '—'}</b><span>screens captured (desktop + phone)</span></div><div class="kpi r"><b>${(cD.Critical||0)+(cD.High||0)}</b><span>critical / high findings (of ${F.length + uiFindings.length})</span></div><div class="kpi a"><b>0 / 35</b><span>September roadmap items complete (${rsC.Partial||0} partial)</span></div><div class="kpi g"><b>${phases.length} phases</b><span>≈ 20 weeks · ≈ ${Math.round(totalPd*1.2)} person-days</span></div></div>
<div class="box violet" style="margin:4px 0 8px"><b>The mission, in the words of the brief:</b> minimum human intervention · the easiest fetching of reports and data from the portal through the extension · minimum time to furnish a notice reply · the highest level of UI/UX, with a dashboard to see everything at a glance and a view for every notice.</div>
<div class="kpis"><div class="kpi a"><b>≈ 3 h → 20 min</b><span>daily human time to keep portal data fresh</span></div><div class="kpi a"><b>≈ 10 h → 1¾ h</b><span>staff time per ASMT-10 / DRC-01A reply</span></div><div class="kpi v"><b>≤ 1 day</b><span>target: portal issue to first draft</span></div><div class="kpi g"><b>100%</b><span>target: dashboard numbers that match their lists</span></div></div>${mock('target-dashboard.png','Target: the Notices Command centre (mock-up, fictional data) — §8')}</div>
<div class="sub" style="font-size:9.5px">Prepared ${new Date('2026-10-05').toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'})} · branch <code>claude/kind-cerf-jbqu8m</code> (main @ 100b5b1) · all client names, GSTINs and figures in screenshots and mock-ups are fictional · statements of law marked “verify” must be confirmed against current text before they are encoded.</div></section>`;

const toc = `<section class="brk"><h2>Contents</h2><ol class="toc">
<li>Executive summary</li><li>Mission scorecard</li><li>Method and how to read this report</li><li>Where the September roadmap stands</li>
<li>Pillar 1 — Minimum human intervention</li><li>Pillar 2 — Easiest fetching from the portal (target: Portal Autopilot)</li><li>Pillar 3 — Minimum time to furnish a reply (target: Reply Factory and Notice workspace)</li><li>Pillar 4 — Dashboard at a glance (target: Command centre)</li><li>Pillar 5 — Per-notice view</li><li>Foundations — data trust and security</li>
<li>Screen-by-screen audit with suggested fixes</li><li>Build roadmap — phases, tasks, acceptance tests, Gantt, decisions, KPIs</li><li>Appendix — full findings register</li></ol>
<div class="box blue" style="margin-top:14px"><b>If you read one page:</b> §1. <b>If you are building it:</b> §12, then the findings each task cites. <b>If you are reviewing a screen:</b> §11.</div></section>`;

const s1 = `<section class="brk"><h2>1 · Executive summary</h2>${execSummary}
<h3>What changes for the team</h3><table class="lite"><thead><tr><th>Measure</th><th>Today</th><th>Target</th><th>Delivered by</th></tr></thead><tbody>${outcomes.map(o=>`<tr><td><b>${o[0]}</b></td><td>${o[1]}</td><td>${o[2]}</td><td>${o[3]}</td></tr>`).join('')}</tbody></table>
<h3>Do these in the first ten working days</h3><table class="lite"><thead><tr><th style="width:18px">#</th><th>Action</th><th style="width:90px">Findings</th></tr></thead><tbody>${firstTen.map((x,i)=>`<tr><td>${i+1}</td><td>${x[0]}</td><td class="mono">${ids(x[1])}</td></tr>`).join('')}</tbody></table></section>`;

const s2 = `<section class="brk"><h2>2 · Mission scorecard</h2><p class="sub">Maturity on a 1–5 scale: 1 = not working or absent, 3 = works with manual effort, 5 = automatic, reliable and measured. Bars: today (colour) against target (outline).</p>
${pillars.map(p=>`<div class="box avoid"><div style="display:flex;justify-content:space-between;align-items:baseline"><h4 style="margin:0">${esc(p.name)}</h4><span class="small">today <b>${p.today}</b> / target <b>${p.target}</b> · ${F.filter(f=>f.pillar===p.key).length} findings</span></div>
<div class="meter" style="margin:5px 0 6px;outline:1px dashed #94a3b8;outline-offset:1px;width:${p.target*20}%"><span style="width:${p.today/p.target*100}%;background:${p.today<=1?'#dc2626':p.today==2?'#f59e0b':'#16a34a'}"></span></div>
<div class="two"><div><b class="small">Today</b><div>${p.now}</div></div><div><b class="small">Next</b><div>${p.next}</div></div></div></div>`).join('')}</section>`;

const s3 = `<section class="brk"><h2>3 · Method and how to read this report</h2>${method}
<h3>Findings at a glance</h3><table class="lite"><thead><tr><th>Source</th><th class="c">Critical</th><th class="c">High</th><th class="c">Medium</th><th class="c">Low</th><th class="c">Total</th></tr></thead><tbody>
<tr><td>Domain reviews (sync, logic, reply), duplicates merged</td>${['Critical','High','Medium','Low'].map(s=>`<td class="c">${cD[s]||0}</td>`).join('')}<td class="c"><b>${F.length}</b></td></tr>
<tr><td>Screen reviews (U-)</td>${['Critical','High','Medium','Low'].map(s=>`<td class="c">${cU[s]||0}</td>`).join('')}<td class="c"><b>${uiFindings.length}</b></td></tr></tbody></table>
<h3>Findings by mission pillar</h3><table class="lite"><thead><tr><th>Pillar</th><th class="c">Critical</th><th class="c">High</th><th class="c">Medium</th><th class="c">Low</th></tr></thead><tbody>${pillars.map(p=>{const c=cnt(F.filter(f=>f.pillar===p.key));return `<tr><td>${esc(p.name)}</td>${['Critical','High','Medium','Low'].map(s=>`<td class="c">${c[s]||0}</td>`).join('')}</tr>`}).join('')}</tbody></table></section>`;

const syncRs = Object.fromEntries(sync.roadmapStatus.map(r=>[r.item.split(' ')[0], r]));
const s4 = `<section class="brk"><h2>4 · Where the September roadmap stands</h2><p>The September 2026 roadmap (<code>docs/NOTICES_LITIGATION_ROADMAP.pdf</code>) planned 35 items in Phases 0–5. Much of it has been started — the redesigned dashboard components, alert tables, litigation schema and upsert sync all exist — but <b>no item is finished</b>, and several “done-looking” pieces fail at runtime. ${rsC.Partial||0} items are partial and ${rsC.Not||0} have not started.</p>
<table><thead><tr><th style="width:150px">Item</th><th style="width:58px">Status</th><th>What remains</th></tr></thead><tbody>${rs.map(r=>`<tr><td><b>${esc(r.item)}</b></td><td>${stt(r.status)}</td><td>${md(r.remaining)}${syncRs[r.item.split(' ')[0]]?`<div class="small" style="margin-top:2px"><b>Sync review:</b> ${md(syncRs[r.item.split(' ')[0]].remaining)}</div>`:''}<div class="ref">${esc(r.evidence)}</div></td></tr>`).join('')}</tbody></table></section>`;

// Pillar 1
const tp = sync.humanTouchpoints; const tpSum = tp.reduce((a,t)=>a+(+t.minutesPerDay||0),0);
const s5 = `<section class="brk"><h2>5 · Pillar 1 — Minimum human intervention</h2>
<p><b>What good looks like.</b> Portal data arrives on a schedule; every new notice, due date, hearing or order becomes an owner, a clock and an alert by itself; staff spend their time deciding and signing, not clicking, re-keying or chasing.</p>
<p><b>Where it stands.</b> Every step from “a notice appears on the portal” to “it is correct in the app” needs a person. The review counted ${tp.length} recurring human touchpoints adding up to about <b>${tpSum} minutes a day</b> for a ~90-client practice — before any reply work starts.</p>
<table><thead><tr><th>Human step today</th><th style="width:70px">Who</th><th style="width:60px">How often</th><th class="rgt" style="width:40px">Min/day</th><th style="width:48px">Automatable</th><th>How</th></tr></thead><tbody>${tp.map(t=>`<tr><td>${md(t.step)}</td><td>${md(t.who)}</td><td>${md(t.frequency)}</td><td class="rgt"><b>${esc(t.minutesPerDay)}</b></td><td>${esc(t.automatable)}</td><td>${md(t.how)}</td></tr>`).join('')}<tr><td colspan="3"><b>Total</b></td><td class="rgt"><b>${tpSum}</b></td><td colspan="2">Target after Phase 3: ≈ 20 min / day (CAPTCHA wall + exceptions only)</td></tr></tbody></table>
${M('08-dashboard-closing-sweep')?`<div class="avoid" style="margin:6px 0">${shotFig(M('08-dashboard-closing-sweep').desktop,'Evidence (fictional data, same code as production): clicking “run the closing sweep” returns “column gst_case_folder_items.notice_id does not exist”; the Sync card shows a hard-coded “Next scheduled unattended sync: 06:00 IST” and “Emails sent today 0”; every owner is “?” because the assignee query names profiles.last_name, which does not exist.')}</div>`:''}
<h3>Critical and high findings</h3>${findingsTable(byPillar('Zero-touch'))}</section>`;

// Pillar 2
const s6 = `<section class="brk"><h2>6 · Pillar 2 — Easiest fetching from the portal</h2>
<p><b>What good looks like.</b> One schedule fetches every data set the firm needs for every active GSTIN; only new or changed documents are downloaded; each run proves which GSTIN it is in, never deletes on a failed pull, and records what it did; any report can be fetched for any set of clients from one screen; the portal’s own notice e-mails trigger a targeted refresh.</p>
<p><b>Where it stands.</b> The extension calls the portal’s own JSON endpoints — a strong, fast base that most firms do not have. Its weaknesses are operational: a single serial run per PC, one CAPTCHA per client, full re-download every time, silent drops after 10 minutes idle or 3 hours, no identity check, and an agent that was built for unattended runs but never finished.</p>
${M('110-extension-popup')?`<div class="avoid" style="display:grid;grid-template-columns:52mm 1fr;gap:8px;margin:6px 0">${shotFig(M('110-extension-popup').desktop,'Today: the extension popup — starts a filing-status / ledger pull; notices are synced from the app instead')}${M('51-company-list-failed')?shotFig(M('51-company-list-failed').desktop,'Today: Company List after a run with failures (fictional data)'):''}</div>`:''}
<h3>Coverage — what is fetched today</h3><table><thead><tr><th style="width:120px">Portal data set</th><th style="width:40px">Fetched</th><th>Captured / stored</th><th>Gap</th></tr></thead><tbody>${sync.coverage.map(c=>`<tr><td><b>${md(c.portalSection)}</b></td><td>${stt(c.fetched==='Yes'?'Done':c.fetched==='No'?'Not':'Partial').replace('>Done<','>Yes<').replace('>Not<','>No<')}</td><td>${md(c.captured)}${c.storedIn?`<div class="ref">${esc(c.storedIn)}</div>`:''}</td><td>${md(c.gap)}</td></tr>`).join('')}</tbody></table>
<h3>Target design — Portal Autopilot</h3>${mock('target-sync.png','Target mock-up (fictional data). An office agent runs at 05:30 and 13:00 IST; the CAPTCHA wall collects every login that needs a person onto one screen; failures carry a reason and a one-click fix; every data set has an on/off and a schedule; any report can be queued for any clients.')}
<h3>Staged path to zero-touch fetching</h3><table><thead><tr><th style="width:130px">Stage</th><th>What</th><th style="width:30px" class="c">Days</th><th style="width:28%">Risks</th></tr></thead><tbody>${sync.zeroTouchDesign.map(s=>`<tr><td><b>${md(s.stage)}</b><div class="small">${md(s.dependencies)}</div></td><td>${md(s.what)}<div class="small" style="margin-top:2px"><b>Why:</b> ${md(s.why)}</div></td><td class="c"><b>${esc(s.effortDays)}</b></td><td>${md(s.risks)}</td></tr>`).join('')}</tbody></table>
<div class="box amber"><b>CAPTCHA posture.</b> The agent’s code deliberately leaves the CAPTCHA solver unimplemented, citing GSTN’s terms and the IT Act. This report keeps that position: people type CAPTCHAs, but all of them at once on one screen, and session reuse means most days only a handful are needed. Automating CAPTCHAs is listed as a decision-gated option that should not be built without written legal sign-off and client authorisations.</div>
<h3>Critical and high findings</h3>${findingsTable(byPillar('Fetch',['Critical','High','Medium']))}</section>`;

// Pillar 3
const cj = reply.currentJourney; const cjSum = cj.reduce((a,s)=>a+(+s.minutes||0),0);
const s7 = `<section class="brk"><h2>7 · Pillar 3 — Minimum time to furnish a reply</h2>
<p><b>What good looks like.</b> By the time a person first looks at a notice, the system has read it, split it into issues with amounts, started the statutory clocks, computed the firm’s position on each issue from the client’s own returns and reconciliations, asked the client only for what is genuinely missing, and prepared a first draft whose every figure traces to a row of evidence. The person reviews, the partner approves, the extension files, the ARN comes back by itself.</p>
<h3>The reply journey today</h3><table><thead><tr><th style="width:20%">Step</th><th style="width:12%">Who</th><th style="width:17%">Where</th><th class="rgt" style="width:30px">Min</th><th>Pain</th></tr></thead><tbody>${cj.map(s=>`<tr><td>${md(s.step)}</td><td>${md(s.who)}</td><td>${md(s.where)}</td><td class="rgt"><b>${esc(s.minutes)}</b></td><td>${md(s.pain)}</td></tr>`).join('')}<tr><td colspan="3"><b>Total staff minutes (a notice with a hearing)</b></td><td class="rgt"><b>${cjSum}</b></td><td>≈ ${(cjSum/60).toFixed(1)} h; ≈ 520 min without the hearing and order steps. Target: ≈ 105 min for an ASMT-10.</td></tr></tbody></table>
<h3>Target design — the Notice workspace with the Reply Factory</h3>${mock('target-notice.png','Target mock-up (fictional data). Issues read from the notice PDF, each with the system’s computed position and its annexure; an AI first draft in which every figure is traced; assisted filing that stops before EVC / DSC and records the ARN automatically.')}
<h3>The evidence the app already holds</h3><table><thead><tr><th style="width:24%">Module</th><th style="width:30%">Tables</th><th>Notice issues it answers</th></tr></thead><tbody>${reply.evidenceSources.map(e=>`<tr><td><b>${md(e.module)}</b></td><td class="small">${md(e.tables)}</td><td>${md(e.answers)}</td></tr>`).join('')}</tbody></table>
<h3>Notice taxonomy — what can be automated</h3><table><thead><tr><th style="width:62px">Form</th><th style="width:16%">Basis · reply</th><th style="width:15%">Window</th><th>Typical issues → automatic source</th><th style="width:44px">Level</th><th class="rgt" style="width:34px">Min saved</th></tr></thead><tbody>${reply.taxonomy.map(t=>`<tr><td><b>${md(t.form)}</b></td><td class="small">${md(t.basis)}<br><i>${md(t.replyForm)}</i></td><td class="small">${md(t.window)}</td><td class="small">${md(t.typicalIssues)}<br><b>→</b> ${md(t.autoSource)}${t.verify?`<div class="small" style="color:#92400e"><b>Verify:</b> ${md(t.verify)}</div>`:''}</td><td>${stt(t.automation==='Full'?'Done':t.automation==='Manual'?'Not':'Partial').replace('>Done<','>Full<').replace('>Not<','>Manual<').replace('>Partial<','>Assisted<')}</td><td class="rgt"><b>${esc(t.minutesSaved)}</b></td></tr>`).join('')}</tbody></table>
<h3>Auto-computation recipes</h3><table><thead><tr><th style="width:18%">Issue</th><th style="width:24%">Inputs</th><th>Computation</th><th style="width:22%">Annexure produced</th></tr></thead><tbody>${reply.recipes.map(r=>`<tr><td><b>${md(r.issue)}</b></td><td class="small">${md(r.inputs)}</td><td class="small">${md(r.computation)}${r.paragraph?`<div class="small" style="margin-top:2px"><b>Paragraph pattern:</b> ${md(r.paragraph)}</div>`:''}</td><td class="small">${md(r.annexure)}</td></tr>`).join('')}</tbody></table>
<h3>AI-assisted drafting pipeline</h3><table><thead><tr><th style="width:15%">Stage</th><th>What</th><th style="width:17%">Where in the code</th><th style="width:13%">Model</th><th style="width:22%">Guardrails</th></tr></thead><tbody>${reply.aiPipeline.map(a=>`<tr><td><b>${md(a.stage)}</b></td><td class="small">${md(a.what)}</td><td class="small mono">${md(a.where)}</td><td class="small">${md(a.model)}</td><td class="small">${md(a.guardrails)}</td></tr>`).join('')}</tbody></table>
<h3>Filing assist through the extension</h3><table><thead><tr><th style="width:24%">Step</th><th>Automation</th><th style="width:30%">Risk</th></tr></thead><tbody>${reply.filingAssist.map(a=>`<tr><td><b>${md(a.step)}</b></td><td class="small">${md(a.automation)}</td><td class="small">${md(a.risk)}</td></tr>`).join('')}</tbody></table>
<h3>Critical and high findings</h3>${findingsTable(byPillar('Reply speed'))}</section>`;

// Pillar 4
const dashShot = manifest.find(m=>/dashboard$/.test(m.id) || m.id==='01-dashboard');
const s8 = `<section class="brk"><h2>8 · Pillar 4 — Dashboard at a glance</h2>
<p><b>What good looks like.</b> In ten seconds a partner knows what is overdue, what is due this week, what is new, what is waiting for review or filing, what money is at stake and whether the data is fresh. Every number is a saved filter whose list has the same count. One row per piece of work, with the next action as a button.</p>
<div class="two avoid"><div>${dashShot?shotFig(dashShot.desktop,'Today: the Notices Dashboard (fictional data)'):''}</div><div>${mock('target-dashboard.png','Target: the Command centre (mock-up, fictional data)')}</div></div>
<h3>One definition per number — today</h3><table><thead><tr><th style="width:100px">Metric</th><th style="width:52px">Consistent?</th><th>Where computed and how they differ</th></tr></thead><tbody>${logic.metricDefinitions.map(m=>`<tr><td><b>${esc(m.metric)}</b></td><td>${m.consistent?'<span class="st Done">Yes</span>':'<span class="st Not">No</span>'}</td><td>${md(m.note)}<div class="ref">${esc((m.whereComputed||[]).join(' · '))}</div></td></tr>`).join('')}</tbody></table>
<h3>Critical and high findings</h3>${findingsTable(byPillar('At-a-glance'))}</section>`;

// Pillar 5
const drawerShot = M('40-drawer-notice-not-found') || manifest.find(m=>/drawer/.test(m.id));
const s9 = `<section class="brk"><h2>9 · Pillar 5 — Per-notice view</h2>
<p><b>What good looks like.</b> One page per notice, reachable by URL from every e-mail and list, showing who owns it, when it is due, what it claims issue by issue, what the firm’s position is, which documents exist and which are awaited, what was filed and when, and the next action — with the action one click away.</p>
${drawerShot?`<div class="two avoid"><div>${shotFig(drawerShot.desktop,'Today: clicking any notice opens the drawer, which shows “Notice not found” because its query names gst_notices.hearing_date, a column that does not exist (L-03). §11 shows the drawer rendered with the mock tolerating the column.')}</div><div>${mock('target-notice.png','Target: the Notice workspace')}</div></div>`:''}
<h3>Specification — what the page needs and what exists today</h3><table><thead><tr><th style="width:110px">Section</th><th>Contents</th><th style="width:48px">Today</th><th style="width:30%">Gap</th></tr></thead><tbody>${reply.perNoticeSpec.map(s=>`<tr><td><b>${md(s.section)}</b></td><td class="small">${md(s.contents)}</td><td>${stt(s.existsToday==='Yes'?'Done':s.existsToday==='No'?'Not':'Partial').replace('>Done<','>Yes<').replace('>Not<','>No<').replace('>Partial<','>Partly<')}</td><td class="small">${md(s.gap)}</td></tr>`).join('')}</tbody></table>
<h3>Critical and high findings</h3>${findingsTable(byPillar('Per-notice',['Critical','High','Medium']))}</section>`;

const s10 = `<section class="brk"><h2>10 · Foundations — data trust and security</h2><p>Nothing in the mission works if the data is wrong or exposed. These findings are the reason Phase 0 comes first.</p>
<h3>Data trust — critical and high</h3>${findingsTable(byPillar('Data trust'))}
<h3>Security — all findings</h3>${findingsTable(F.filter(f=>f.pillar==='Security'))}</section>`;

// Screens
const groups = [...new Set(manifest.map(m=>m.group))];
const screenBlock = (m, i, arr) => { const u = uiScreens[m.id] || {}; const fs_ = u.findings || [];
  const newGroup = i === 0 || arr[i-1].group !== m.group;
  return `${newGroup ? `<div class="grp"><h3 style="margin-top:0">${esc(m.group)}</h3></div>` : ''}<div style="margin-bottom:12px"><div class="keep"><div class="screen-head"><div><div class="small" style="color:#6b7280;text-transform:uppercase;letter-spacing:.05em">${esc(m.group)} · screen ${i+1} of ${arr.length}</div><div class="t">${esc(m.title)}</div><code>${esc(m.route)}</code> <span class="small">· ${esc(m.steps||'')}</span></div>${u.score?`<div style="font:600 20px Poppins;color:${u.score>=7?'#166534':u.score>=5?'#92400e':'#991b1b'}">${u.score}<span style="font-size:10px;color:#6b7280">/10</span></div>`:''}</div>
  ${u.verdict?`<p style="font-size:10px;margin:2px 0 5px">${md(u.verdict)}</p>`:`<p class="small sub">${md(m.shows||'')}</p>`}
  <div class="shots">${shotFig(m.desktop,'Desktop 1440 px','dk')}${m.mobile?shotFig(m.mobile,'Phone 390 px','mb'):''}</div></div>
  ${fs_.length?`<table><thead><tr><th style="width:44px">ID</th><th style="width:50px">Severity</th><th style="width:62px">Area</th><th>Issue</th><th style="width:38%">Suggested fix</th></tr></thead><tbody>${fs_.map(f=>`<tr><td><b>${esc(f.id)}</b>${f.links?`<div class="ref" style="word-break:normal">${ids(esc(f.links))}</div>`:''}</td><td>${sev(f.severity)}</td><td>${esc(f.area)}</td><td>${md(f.issue)}<div class="ref">${esc(f.ref||'')}</div></td><td>${md(f.fix)}</td></tr>`).join('')}</tbody></table>`:''}</div>`; };
const s11 = `<section class="brk"><h2>11 · Screen-by-screen audit with suggested fixes</h2><p>Every screen, tab, drawer, dialog and link target of the module, in the order a user meets them. Each shows the desktop capture (and the phone capture for page-level screens), a verdict and score out of 10, and the findings for that screen with a suggested fix. Findings that share a root cause with a domain finding cite it (for example “L-04”).</p>
${uiCross2.length?`<h3>Patterns seen across many screens — fix once, improve every screen</h3><table><thead><tr><th style="width:22%">Pattern</th><th>What the screens show</th><th style="width:36%">Fix</th></tr></thead><tbody>${uiCross2.map(c=>`<tr><td><b>${c[0]}</b></td><td>${c[1]}</td><td>${c[2]}</td></tr>`).join('')}</tbody></table><p class="small sub">Condensed from the ${uiCross.length} patterns reported by the three screen reviews.</p>`:''}
<h3>Screens in this section</h3><table class="lite"><thead><tr><th>#</th><th>Screen</th><th>Group</th><th class="c">Score</th><th class="c">Findings</th></tr></thead><tbody>${manifest.map((m,i)=>`<tr><td>${i+1}</td><td>${esc(m.title)}</td><td>${esc(m.group)}</td><td class="c">${uiScreens[m.id]?.score??'—'}</td><td class="c">${uiScreens[m.id]?.findings?.length??0}</td></tr>`).join('')}</tbody></table></section>
<section>${manifest.map(screenBlock).join('')}</section>`;

// Roadmap
const W = 20;
const gantt = `<div class="gantt avoid"><div class="wk" style="text-align:left">Phase</div>${Array.from({length:W},(_, i)=>`<div class="wk">${i+1}</div>`).join('')}${phases.map(p=>`<div class="lbl">${p.id} · ${esc(p.name.split(' — ')[0])}</div>${Array.from({length:W},(_, i)=>{const on=i+1>=p.weeks[0]&&i+1<=p.weeks[1];return `<div class="bar" style="padding:2px 0;border-left:0">${on?`<div class="on" style="${i+1===p.weeks[0]?'border-top-left-radius:6px;border-bottom-left-radius:6px;':''}${i+1===p.weeks[1]?'border-top-right-radius:6px;border-bottom-right-radius:6px;':''}background:${['#7f1d1d','#1a3366','#2563eb','#0f766e','#7c5cd6','#6d28d9','#334155'][+p.id]}"></div>`:''}</div>`}).join('')}`).join('')}</div>`;
const s12 = `<section class="brk"><h2>12 · Build roadmap</h2>
<p>Seven phases, sequenced so each one is shippable on its own and makes the next one possible: first stop data loss and make the existing features run (Phase 0); then let the database turn every change into work (Phase 1); then give people the Command centre and a Notice workspace (Phase 2); then put fetching on autopilot (Phase 3); then build the Reply Factory (Phases 4–5); and finally complete the litigation lifecycle and reporting (Phase 6). Effort: <b>${totalPd} person-days of build</b>, about ${Math.round(totalPd*1.2)} with 20% slack — roughly <b>20 weeks with two developers</b> working with Claude Code and half a day a week of partner review, or about nine months with one developer. Estimates are planning grade (±30%).</p>
${gantt}
<table class="lite" style="margin-top:8px"><thead><tr><th>Milestone</th><th>Week</th><th>What is true</th></tr></thead><tbody>${phases.map(p=>`<tr><td><b>${esc(p.milestone.split(' · ')[0])}</b></td><td>${p.weeks[1]}</td><td>${esc(p.milestone.split(' · ')[1])}</td></tr>`).join('')}</tbody></table>
<div class="box blue"><b>Working rules for every phase</b> (from the repository’s CLAUDE.md): migrations go in <code>supabase/migrations/</code> <i>and</i> are applied to project <code>gcquafqxbykxkbexcdpy</code> only — never to the project named in <code>SUPABASE_PROJECT_REF</code>; RLS policies stay open to <code>public</code> (the app has no Supabase Auth session); writes are verified with the anon key, not the management API; <code>npm run build</code> — and, from Phase 0, the type-check — must be green before every commit; positions are written down in <code>docs/</code> before they are encoded.</div>
${phases.map(p=>`<div class="phase"><div class="ph"><b>Phase ${p.id} — ${esc(p.name)}</b><span class="small">weeks ${p.weeks[0]}–${p.weeks[1]} · ≈ ${p.pd} person-days · ${esc(p.pillars.join(' · '))}</span></div><div class="pb"><p><b>Goal.</b> ${p.goal}</p>
<table><thead><tr><th style="width:120px">Workstream</th><th>Tasks</th><th style="width:80px">Fixes</th></tr></thead><tbody>${p.tasks.map(t=>`<tr><td><b>${t[0]}</b></td><td>${t[1]}</td><td class="mono">${ids(t[2])}</td></tr>`).join('')}</tbody></table>
<b>Done when</b><ul>${p.accept.map(a=>`<li>${a}</li>`).join('')}</ul><div class="small"><b>Milestone:</b> ${esc(p.milestone)}</div></div></div>`).join('')}
<h3>After week 20 — decision-gated options</h3><table class="lite"><tbody>${later.map(l=>`<tr><td style="width:150px"><b>${l[0]}</b></td><td>${l[1]}</td></tr>`).join('')}</tbody></table>
<h3>Decisions needed from the partner</h3><table class="lite"><thead><tr><th>Decision</th><th>What to decide</th><th>Needed by</th></tr></thead><tbody>${decisions.map(d=>`<tr><td><b>${d[0]}</b></td><td>${d[1]}</td><td>${d[2]}</td></tr>`).join('')}</tbody></table>
<h3>How success is measured</h3><table><thead><tr><th style="width:24%">KPI</th><th style="width:22%">Baseline</th><th style="width:26%">Target</th><th>How measured</th></tr></thead><tbody>${reply.kpis.map(k=>`<tr><td><b>${md(k.kpi)}</b></td><td class="small">${md(k.baseline)}</td><td class="small">${md(k.target)}</td><td class="small">${md(k.howMeasured)}</td></tr>`).join('')}<tr><td><b>GSTINs with fresh data (&lt; 24 h)</b></td><td class="small">Not measured; refreshes depend on someone running Sync All</td><td class="small">≥ 95% every working day, or a named failure reason</td><td class="small">client_sync_status view (Phase 1)</td></tr><tr><td><b>Human minutes per day on fetching</b></td><td class="small">≈ ${tpSum} (§5)</td><td class="small">≤ 20</td><td class="small">CAPTCHA-wall and exception handling time from the run ledger</td></tr></tbody></table>
<h3>Main risks</h3><table class="lite"><tbody>
<tr><td style="width:150px"><b>Portal changes</b></td><td>Endpoints and screens change without notice. Mitigation: shape-change detection on every response (raises E9), a versioned route map for filing assist, raw JSON kept for re-parsing.</td></tr>
<tr><td><b>Automated-access exposure</b></td><td>GSTN terms and the IT Act. Mitigation: human-typed CAPTCHAs, client authorisations on file, rate limits, an audit log of every portal action.</td></tr>
<tr><td><b>Wrong figures in a reply</b></td><td>Mitigation: figures only from code-built annexures; a hard gate blocks any untraced rupee figure or non-whitelisted authority; partner approval before filing.</td></tr>
<tr><td><b>Client data and AI</b></td><td>Mitigation: consent per client, redaction, no passwords ever sent, audit log, a processor agreement; AI never files or signs.</td></tr>
<tr><td><b>Alert fatigue</b></td><td>Mitigation: a preview week, per-client batching, quiet hours, reminders that stop once a reply is logged.</td></tr></tbody></table></section>`;

const sA = `<section class="brk"><h2>Appendix — full findings register</h2><p>All ${F.length} domain findings after duplicates were merged (the “=” line lists the IDs folded into each). Screen findings (U-) are in §11.</p>${findingsTable(F,{effort:true})}</section>`;

const uiScored = Object.values(uiScreens).filter(s => s.score);
const uiAvg = uiScored.length ? (uiScored.reduce((a,s)=>a+s.score,0)/uiScored.length).toFixed(1) : '—';
const html0 = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="file://${D}report.css"></head><body>${cover}${toc}${s1}${s2}${s3}${s4}${s5}${s6}${s7}${s8}${s9}${s10}${manifest.length?s11:''}${s12}${sA}</body></html>`;
const html = html0.replaceAll('{{UI_AVG}}', uiAvg).replaceAll('{{UI_N}}', String(manifest.length));
fs.writeFileSync(D + 'report.html', html);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pg = await b.newPage();
await pg.goto('file://' + D + 'report.html', { waitUntil: 'networkidle' });
await pg.evaluate(() => document.fonts.ready);
await pg.pdf({ path: OUT, format: 'A4', printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>',
  footerTemplate: '<div style="font-family:Inter,sans-serif;font-size:7.5px;color:#9ca3af;width:100%;padding:0 12mm;display:flex;justify-content:space-between"><span>Notices &amp; Litigation — mission audit and build roadmap · fictional data in all screenshots</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>',
  margin: { top: '13mm', bottom: '15mm', left: '12mm', right: '12mm' } });
await b.close();
console.log('ok', OUT, 'screens', manifest.length, 'domain', F.length, cD, 'ui', uiFindings.length);
