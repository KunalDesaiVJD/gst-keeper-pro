// Runs on *.gst.gov.in pages. Driven by a small state machine kept in
// chrome.storage (survives navigations). Steps: login -> filing -> ledger -> done.
// Because this executes in the user's OWN browser on their normal IP, the portal
// treats it as a normal user (no datacenter firewall block). CAPTCHA stays human.
(async () => {
  const JOB_KEY = 'gstk_active_job';
  const store = chrome.storage.local;
  const getJob = async () => (await store.get(JOB_KEY))[JOB_KEY] || null;
  // A scheduled job (job.runner, 0.7.0) only ever writes or clears itself: a
  // sync a person starts in this Chrome takes the slot, and this tab is closed.
  const stillMine = async (j) => {
    if (!j || !j.runner) return true;
    const cur = await getJob();
    return !!(cur && cur.runner && cur.runner.jobId === j.runner.jobId);
  };
  const setJob = async (j) => { j.lastActivityAt = Date.now(); if (!(await stillMine(j))) return; return store.set({ [JOB_KEY]: j }); };
  const clearJob = async () => { if (!(await stillMine(job))) return; return store.remove(JOB_KEY); };
  const EXT_VERSION = chrome.runtime.getManifest().version;
  // While a long step works (hundreds of PDFs on a first run), keep the job's
  // lastActivityAt fresh so the background watchdog does not take it for a
  // stalled client. Never runs during the CAPTCHA wait, so that still times out.
  function startHeartbeat() {
    const t = setInterval(async () => {
      try {
        const j = (await store.get(JOB_KEY))[JOB_KEY];
        if (j && (!job.runner || (j.runner && j.runner.jobId === job.runner.jobId))) { j.lastActivityAt = Date.now(); await store.set({ [JOB_KEY]: j }); }
      } catch (e) { /* the next tick retries */ }
    }, 30000);
    return () => clearInterval(t);
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const url = location.href;
  // Used by parseDrc03Case(), called from the job dispatcher below — must be
  // initialized before that point in the script's top-to-bottom execution,
  // not down near where it's textually used, or it's a TDZ ReferenceError.
  const MONTH_ABBR = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
  // Same rule for every constant below: the dispatcher awaits the step handlers
  // inside this IIFE, so a const declared further down is still uninitialized
  // when a handler reads it ("Cannot access … before initialization").
  // A notices run re-reads everything the portal lists, but only DOWNLOADS what
  // is new: PDFs and folder attachments already stored are skipped, and a case's
  // folder is fetched only when the case is new or still open — plus one full
  // pass per client every 7 days, so a change in a closed case is still caught.
  const FULL_FOLDER_PASS_MS = 7 * 24 * 60 * 60 * 1000;
  const REFUND_FOLDER_LABELS = { APLCN: 'Applications', NOTAC: 'Notice/Acknowledgement', REPLY: 'Replies', ORDRS: 'Orders', AUDIT: 'Audit History' };
  // 0.8.0: the officer, the DIN and the reply date a notice row takes from its
  // case-folder item (noticeFieldsFromItem, further down). Declared up here
  // with every other constant a step handler reads, for the same reason: the
  // dispatcher awaits those handlers inside this IIFE, so a const sitting next
  // to its own function further down is still in its temporal dead zone when
  // pullNotices runs ("Cannot access ... before initialization", CHANGELOG 0.5.0).
  // The portal spells the same field differently from one folder section to the
  // next, so each entry is a list of candidate key names, compared with
  // separators stripped and case ignored (dueDt == due_dt == DUEDT).
  const NOTICE_FIELD_KEYS = {
    due: ['replyduedt', 'replyduedate', 'duedt', 'duedate', 'dtofreply', 'replydt', 'replybydt', 'lastdtofreply', 'dtofsubmission'],
    officer: ['issuedby', 'officername', 'issuedbyname', 'empname', 'officerfullname', 'issuername', 'issuer'],
    designation: ['designation', 'issuedbydesignation', 'officerdesignation', 'desgn', 'dsgn', 'desig', 'officerdesg'],
    din: ['din', 'dinno', 'dinnumber', 'docdin', 'dinnum', 'dinid'],
  };
  const normKey = (k) => String(k || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const isRealText = (s) => s.length > 1 && !/^(na|n\/a|null|none|-+|0)$/i.test(s);
  // 0.8.1: how the portal answers a Login press, read off the login form (it
  // shows its refusal in place). A refused user ID or password, or a locked or
  // expired account, ends that client for the run and is remembered, so the
  // same password is never offered again (background.js, pwRefusal*); a
  // CAPTCHA typo is tried again; anything else gets one more try. Every
  // refusal needs a negative word next to a credential noun, so the form's own
  // labels ("Password", "Forgot Password") can never read as one. Declared up
  // here for the reason NOTICE_FIELD_KEYS is.
  const LOGIN_ERR_SEL = '.alert-danger, .toast-error, .toast-message, .error-msg, .err, .text-danger, .help-block, .invalid-feedback, '
    + '[role="alert"], .modal.in .modal-body, .modal.show .modal-body';
  const LOGIN_REFUSALS = [
    { reason: 'account_locked', rx: /\b(account|user\s*id|user\s*name|username|user|login)\b\W+(?:\w+\W+){0,5}?(locked|blocked|suspended|disabled|deactivated|frozen)\b/i },
    { reason: 'account_locked', rx: /\b(maximum|exceeded|too\s+many)\b\W+(?:\w+\W+){0,4}?(attempts?|tries|logins?)\b/i },
    { reason: 'password_expired', rx: /\bpassword\b\W+(?:\w+\W+){0,4}?(has\s+)?expired\b|\bexpired\b\W+(?:\w+\W+){0,3}?password\b/i },
    { reason: 'wrong_password', rx: /\b(invalid|incorrect|wrong|not\s+valid|does\s*n[o']?t\s+match|did\s*n[o']?t\s+match|mismatch(?:ed)?)\b\W+(?:\w+\W+){0,4}?(user\s*name|username|user\s*id|userid|password|credentials?)\b/i },
    { reason: 'wrong_password', rx: /\b(user\s*name|username|user\s*id|userid|password|credentials?)\b\W+(?:\w+\W+){0,5}?(invalid|incorrect|wrong|not\s+valid|not\s+match|mismatch(?:ed)?)\b/i },
    { reason: 'wrong_password', rx: /\b(user\s*name|username|user\s*id|userid)\b\W+(?:\w+\W+){0,3}?(does\s*n[o']?t\s+exist|not\s+(found|registered|exist))\b/i },
  ];
  const LOGIN_CAPTCHA_RX = /captcha|letters\s+shown|characters\s+(shown|displayed|in\s+the\s+image)|image\s+text|verification\s+code|security\s+code/i;
  const REFUSAL_WORDS = {
    wrong_password: 'Wrong user ID or password',
    password_expired: 'The portal password has expired',
    account_locked: 'The portal account is locked',
  };
  // "My Applications" types the notices bundle reads (handleApplications, 0.6.0).
  const APPLICATION_TYPES = {
    APPEL: { form: 'GST APL-01', label: 'Appeal to Appellate Authority' },
    ADJRO: { form: null, label: 'Application for rectification of order' },
    ADJAT: { form: null, label: 'Objection against provisional attachment' },
    ADJWS: { form: null, label: 'Waiver scheme under section 128A' },
    COMPD: { form: null, label: 'Compounding application' },
    ADJPA: { form: 'GST ASMT-01', label: 'Provisional assessment' },
  };
  // rtnprd from the reversal / RCM liability APIs is 'YYYYMM' (e.g. '202603') —
  // this app's own convention is 'MM/YYYY'.
  const rtnPrdToPeriod = (rtnprd) => {
    const s = String(rtnprd || '');
    return s.length === 6 ? (s.slice(4) + '/' + s.slice(0, 4)) : null;
  };
  const numOr0 = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);

  function simpleHash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  async function waitFor(sel, ms = 20000) {
    const t = Date.now();
    while (Date.now() - t < ms) {
      const el = $(sel);
      if (el && el.offsetParent !== null) return el;
      await sleep(300);
    }
    return null;
  }
  // AngularJS ng-model updates on input/change — set value AND dispatch events.
  function setVal(el, val) {
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function selectByText(sel, textStart) {
    const s = $(sel);
    if (!s) return false;
    const opt = [...s.options].find((o) => (o.textContent || '').trim().startsWith(textStart));
    if (!opt) return false;
    setVal(s, opt.value);
    return true;
  }
  // Robustly select an <option> by its VISIBLE text across ALL selects on the
  // page — no reliance on element IDs. Polls until the option exists, because on
  // the AngularJS portal the option lists load asynchronously and cascading
  // dropdowns (e.g. Month) only render AFTER a prior select changes. Setting
  // .value + .selected and firing input+change is what makes ng-model register it.
  async function selectWhereOption(desired, opts = {}) {
    const { startsWith = false, alnum = false, timeout = 12000 } = opts;
    const norm = alnum
      ? (s) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
      : (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const target = norm(desired);
    if (!target) return null;
    const matches = (o) => { const txt = norm(o && o.textContent); return !!txt && (startsWith ? txt.startsWith(target) : txt === target); };
    // Apply a selection the way AngularJS registers it: set value AND selectedIndex,
    // then fire input/change/blur so ng-model + ng-change both run.
    const apply = (s, opt) => {
      try { s.focus(); } catch (e) { /* noop */ }
      s.value = opt.value;
      s.selectedIndex = opt.index;
      opt.selected = true;
      s.dispatchEvent(new Event('input', { bubbles: true }));
      s.dispatchEvent(new Event('change', { bubbles: true }));
      s.dispatchEvent(new Event('blur', { bubbles: true }));
    };
    const t = Date.now();
    while (Date.now() - t < timeout) {
      for (const s of $$('select')) {
        if (s.disabled || s.offsetParent === null) continue;
        const opt = [...s.options].find(matches);
        if (opt && !opt.disabled) {
          apply(s, opt);
          // AngularJS can revert a programmatic set on its next digest (especially a
          // cascade parent). Verify it stuck; if it reverted, re-apply, then keep
          // polling — once the form settles the selection holds.
          await sleep(300);
          if (matches(s.options[s.selectedIndex])) return s;
          apply(s, opt);
          await sleep(300);
          if (matches(s.options[s.selectedIndex])) return s;
        }
      }
      await sleep(200);
    }
    return null;
  }
  // Wait for a real DATA row (>=4 cells) in the first table — filters out the
  // "no records"/placeholder single-cell row while results are still loading.
  async function waitForRow(ms = 12000) {
    const t = Date.now();
    while (Date.now() - t < ms) {
      const tbl = $('table');
      const tr = tbl && tbl.querySelector('tbody tr');
      if (tr && tr.children.length >= 4 && (tr.textContent || '').replace(/\s+/g, '').length > 0) return tr;
      await sleep(300);
    }
    return null;
  }
  function banner(msg, color = '#2563eb') {
    let b = document.getElementById('gstk-banner');
    if (!b) {
      b = document.createElement('div');
      b.id = 'gstk-banner';
      b.style.cssText =
        'position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:8px 14px;font:14px system-ui,sans-serif;color:#fff;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.3)';
      document.documentElement.appendChild(b);
    }
    b.style.background = color;
    b.textContent = 'GST Keeper Sync — ' + msg;
  }
  function askCaptcha() {
    return new Promise((resolve, reject) => {
      const wrap = document.createElement('div');
      wrap.style.cssText =
        'position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;font:14px system-ui,sans-serif';
      const imgSrc = ($('#imgCaptcha') || {}).src || '';
      wrap.innerHTML =
        '<div style="background:#fff;border-radius:10px;padding:18px;max-width:340px;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,.4)">' +
        '<div style="font-weight:600;margin-bottom:8px">Enter the CAPTCHA to log in</div>' +
        (imgSrc ? '<img src="' + imgSrc + '" style="border:1px solid #ddd;border-radius:6px;margin:6px 0;max-width:100%"/>' : '<div style="color:#888">(look at the CAPTCHA on the page)</div>') +
        '<input id="gstk-cap" placeholder="Type the characters" autocomplete="off" style="width:90%;padding:8px;text-align:center;letter-spacing:3px;border:1px solid #ccc;border-radius:6px;margin:8px 0"/>' +
        '<div><button id="gstk-cap-ok" style="background:#2563eb;color:#fff;border:0;border-radius:6px;padding:8px 16px;cursor:pointer">Log in</button>' +
        '<button id="gstk-cap-cancel" style="background:#eee;border:0;border-radius:6px;padding:8px 16px;margin-left:6px;cursor:pointer">Cancel</button></div></div>';
      document.documentElement.appendChild(wrap);
      const inp = wrap.querySelector('#gstk-cap');
      setTimeout(() => inp.focus(), 50);
      wrap.querySelector('#gstk-cap-ok').onclick = () => {
        const v = inp.value.trim();
        if (v) { wrap.remove(); resolve(v); }
      };
      inp.onkeydown = (e) => { if (e.key === 'Enter') wrap.querySelector('#gstk-cap-ok').click(); };
      wrap.querySelector('#gstk-cap-cancel').onclick = () => { wrap.remove(); reject(new Error('cancelled')); };
    });
  }
  function isLoggedIn() {
    if (/services\/login/.test(url)) return false;
    if ($$('a,button').some((a) => /logout/i.test(a.textContent || ''))) return true;
    return /\/auth\//.test(url);
  }

  const job = await getJob();
  if (!job) return;

  // Only act in the sync tab we opened, and drop stale jobs — so the extension
  // NEVER prompts a CAPTCHA during normal portal browsing (the "harassment" bug).
  // A notices run (job.runId) is watched by the background watchdog, which
  // records a stuck client in the run ledger and moves on; other jobs keep the
  // old rule and are dropped after 10 idle minutes or 3 hours.
  const now = Date.now();
  const idleMs = now - (job.lastActivityAt || job.startedAt || now);
  const totalMs = now - (job.startedAt || now);
  if (!job.runId && (idleMs > 10 * 60 * 1000 || totalMs > 3 * 60 * 60 * 1000)) { await clearJob(); return; }
  // Right after the extension is reloaded, any ALREADY-OPEN gst.gov.in tab's
  // content script becomes orphaned — its chrome.runtime.sendMessage calls
  // reject ("Extension context invalidated"). whoami() then resolves to null
  // via the .catch below, which used to be treated as "can't disprove a
  // match, so proceed" — letting an orphaned script on a totally unrelated
  // tab (confirmed: a leftover GSTR-2B download tab) run the CURRENT job's
  // step regardless of which page it was actually on, producing a "JSON
  // upload input not found" banner on the GSTR-2B page while the real GSTR-1
  // tab was still working correctly. Fail CLOSED instead — if job.tabId is
  // set but we can't positively confirm this IS that tab, don't act.
  if (job.tabId != null) {
    const me = await GSTKdb.whoami().catch(() => null);
    if (!me || me.tabId == null || me.tabId !== job.tabId) return;
  }

  // Support the single-client shape AND the multi-client queue shape.
  if (!job.clients) job.clients = [{ clientId: job.clientId, creds: job.creds }];
  if (job.idx == null) job.idx = 0;
  const cur = job.clients[job.idx];
  // Same shape for periods: a section-pull job may carry a queue of periods
  // for the current client (see advance() below), one at a time, without
  // logging out between them — the tab is already authenticated.
  if (!job.periods) job.periods = job.period ? [job.period] : [''];
  if (job.periodIdx == null) job.periodIdx = 0;
  job.period = job.periods[job.periodIdx];
  const progressParts = [];
  if (job.clients.length > 1) progressParts.push('client ' + (job.idx + 1) + '/' + job.clients.length);
  if (job.periods.length > 1) progressParts.push('period ' + (job.periodIdx + 1) + '/' + job.periods.length);
  const progress = progressParts.length ? ' (' + progressParts.join(', ') + ')' : '';

  // Loop guard: if the session died mid-sync (Access Denied / bounced to login)
  // while we expected to be logged in, DON'T keep navigating. Re-login a couple of
  // times, then give up on this client — never loop forever.
  const bounced = /services\/error|accessdenied/.test(url) || /services\/login/.test(url);
  const uploadSteps = ['gstr1_dash', 'gstr1_upload', 'gstr3b_dash', 'gstr3b_fill31', 'gstr3b_fill4'];
  if ((job.step === 'ledger' || job.step === 'reversal' || job.step === 'liabilityledger' || job.step === 'cashledger' || job.step === 'notices' || job.step === 'refunds_reg_check' || job.step === 'refunds_warmup' || job.step === 'refunds' || job.step === 'refund_docs' || job.step === 'drc03' || job.step === 'applications' || job.step === 'taxpayerprofile' || job.step === 'challans' || job.step === 'efiledpdf' || job.step === 'efiledview' || job.step === 'twob' || job.step === 'twobdwld' || job.step === 'twoa' || job.step === 'twoadwld' || job.step === 'filing' || job.step === 'gstr3b_pull' || job.step === 'gstr9_pull' || job.step === 'gstr1_pull' || job.step === 'gstr2a_pull' || job.step === 'gstr2b_pull_dash' || job.step === 'gstr2b_pull' || job.step === 'creditledgertxn' || job.step === 'gstr1_json_pull' || job.step === 'revrclm_pull' || job.step === 'rcmliab_pull' || uploadSteps.includes(job.step)) && bounced) {
    job.retries = (job.retries || 0) + 1;
    if (job.retries > 2) {
      // 'filing' jobs run on a backgrounded tab (see startFilingOpen in
      // background.js) — this give-up banner is meaningless if nobody can
      // see it. Every other mode's tab was already foreground, so this is
      // scoped to 'filing' only, not a behavior change for the rest.
      if (job.mode === 'filing') { try { await GSTKdb.focusTab(); } catch (e) { /* non-fatal */ } }
      banner('Session kept dropping for ' + cur.creds.name + ' — moving on.', '#dc2626');
      // Leave a trace in the table itself (delete-then-insert, so a later
      // successful pull overwrites it) — this job's tab is usually not being
      // watched live, so a silent give-up here would look identical to "ran
      // fine, portal just had nothing to report."
      if (job.step === 'liabilityledger') await writeLedgerFailureRow(GSTKdb.replaceLiabilityLedgerEntries, cur, job, 'session kept dropping (bounced to login/error page 3x) while reading the Liability Register');
      else if (job.step === 'cashledger') await writeLedgerFailureRow(GSTKdb.replaceCashLedgerEntries, cur, job, 'session kept dropping (bounced to login/error page 3x) while reading the Cash Ledger');
      else if (job.step === 'notices') {
        try { await GSTKdb.logClientSync(cur.clientId, 'notices', 'failed', 'PULL FAILED: session kept dropping (bounced to login/error page 3x)'); } catch (e2) { /* diagnostic only */ }
        try { await GSTKdb.logStep(job.runId, cur.clientId, 'notices', 'failed', 'portal_error', 'Session kept dropping (bounced to login/error page 3x).'); } catch (e2) { /* diagnostic only */ }
        await logSyncAttempt(job, cur, 'failed', 'Session kept dropping (bounced to login/error page 3x) while reading Notices & Orders.');
      } else if (job.step === 'refunds') {
        try { await GSTKdb.logClientSync(cur.clientId, 'refunds', 'failed', 'PULL FAILED: session kept dropping (bounced to login/error page 3x)'); } catch (e2) { /* diagnostic only */ }
      } else if (job.step === 'drc03') {
        try { await GSTKdb.logClientSync(cur.clientId, 'drc03', 'failed', 'PULL FAILED: session kept dropping (bounced to login/error page 3x)'); } catch (e2) { /* diagnostic only */ }
      } else if (job.step === 'challans') {
        try { await GSTKdb.replaceChallans(cur.clientId, [{ client_id: cur.clientId, status: 'PULL FAILED: session kept dropping (bounced to login/error page 3x) while reading Challan Summary' }]); } catch (e2) { /* diagnostic only */ }
      } else if (job.step === 'gstr3b_pull') {
        try { await GSTKdb.upsertFiledReturn(cur.clientId, job.period, 'GSTR3B', { status: 'PULL FAILED: session kept dropping (bounced to login/error page 3x) while reading GSTR-3B' }); } catch (e2) { /* diagnostic only */ }
      } else if (job.step === 'gstr9_pull') {
        // updated_at too: the Annual Return page polls for a row newer than its click.
        try { await GSTKdb.upsertFiledReturn(cur.clientId, job.period, 'GSTR9_CALC', { status: 'PULL FAILED: session kept dropping (bounced to login/error page 3x) while reading GSTR-9', updated_at: new Date().toISOString() }); } catch (e2) { /* diagnostic only */ }
      } else if (job.step === 'gstr1_pull') {
        try { await GSTKdb.upsertFiledReturn(cur.clientId, job.period, 'GSTR1', { status: 'PULL FAILED: session kept dropping (bounced to login/error page 3x) while reading GSTR-1' }); } catch (e2) { /* diagnostic only */ }
      } else if (job.step === 'gstr2a_pull') {
        try { await GSTKdb.upsertFiledReturn(cur.clientId, job.period, 'GSTR2A', { status: 'PULL FAILED: session kept dropping (bounced to login/error page 3x) while reading GSTR-2A' }); } catch (e2) { /* diagnostic only */ }
      } else if (job.step === 'gstr2b_pull_dash' || job.step === 'gstr2b_pull') {
        try { await GSTKdb.upsertFiledReturn(cur.clientId, job.period, 'GSTR2B', { status: 'PULL FAILED: session kept dropping (bounced to login/error page 3x) while reading GSTR-2B' }); } catch (e2) { /* diagnostic only */ }
      } else if (job.step === 'creditledgertxn') {
        try { await GSTKdb.replaceCreditLedgerTxns(cur.clientId, job.period, [{ client_id: cur.clientId, period_month: job.period, is_debit: false, description: 'PULL FAILED: session kept dropping (bounced to login/error page 3x) while reading Credit Ledger' }]); } catch (e2) { /* diagnostic only */ }
      } else if (job.step === 'gstr1_json_pull') {
        try { await GSTKdb.upsertFiledReturn(cur.clientId, job.period, 'GSTR1', { status: 'PULL FAILED: session kept dropping (bounced to login/error page 3x) while reading the filed GSTR-1 JSON' }); } catch (e2) { /* diagnostic only */ }
      } else if (job.step === 'revrclm_pull') {
        const fy = (fyRangeForPull(job.period) || {}).fy || job.period;
        try { await GSTKdb.replaceCreditReversalReclaimEntries(cur.clientId, fy, [{ client_id: cur.clientId, financial_year: fy, description: 'PULL FAILED: session kept dropping (bounced to login/error page 3x) while reading the Credit Reversal and Re-claimed Statement' }]); } catch (e2) { /* diagnostic only */ }
      } else if (job.step === 'rcmliab_pull') {
        const fy = (fyRangeForPull(job.period) || {}).fy || job.period;
        try { await GSTKdb.replaceRcmLiabilityItcEntries(cur.clientId, fy, [{ client_id: cur.clientId, financial_year: fy, description: 'PULL FAILED: session kept dropping (bounced to login/error page 3x) while reading the RCM Liability/ITC Statement' }]); } catch (e2) { /* diagnostic only */ }
      }
      // 'taxpayerprofile' has no diagnostic row: it's a single-row upsert
      // per client, so a failed pull just leaves any prior good data as-is
      // rather than needing a "pull failed" marker.
      await advance(job);
      return;
    }
    job.step = 'login';
    delete job.captchaWaitSince;
    await setJob(job);
    banner('Session expired — signing in again…', '#f59e0b');
    location.href = 'https://services.gst.gov.in/services/login';
    return;
  }

  try {
    if (job.step === 'login') await handleLogin(job, cur, progress);
    else if (job.step === 'ledger') await handleLedger(job, cur, progress);
    else if (job.step === 'reversal') await handleReversal(job, cur, progress);
    else if (job.step === 'liabilityledger') await handleLiabilityLedger(job, cur, progress);
    else if (job.step === 'cashledger') await handleCashLedger(job, cur, progress);
    else if (job.step === 'notices') await handleNotices(job, cur, progress);
    else if (job.step === 'refunds') await handleRefunds(job, cur, progress);
    else if (job.step === 'refund_docs') await handleRefundDocs(job, cur, progress);
    else if (job.step === 'drc03') await handleDrc03(job, cur, progress);
    else if (job.step === 'applications') await handleApplications(job, cur, progress);
    else if (job.step === 'taxpayerprofile') await handleTaxpayerProfile(job, cur, progress);
    else if (job.step === 'challans') await handleChallans(job, cur, progress);
    else if (job.step === 'gstr3b_pull') await handleGstr3bPull(job, cur, progress);
    else if (job.step === 'gstr9_pull') await handleGstr9Pull(job, cur, progress);
    else if (job.step === 'gstr1_pull') await handleGstr1Pull(job, cur, progress);
    else if (job.step === 'gstr2a_pull') await handleGstr2aPull(job, cur, progress);
    else if (job.step === 'creditledgertxn') await handleCreditLedgerTxnOnly(job, cur, progress);
    else if (job.step === 'gstr1_json_pull') await handleGstr1JsonPull(job, cur, progress);
    else if (job.step === 'revrclm_pull') await handleRevRclmPull(job, cur, progress);
    else if (job.step === 'rcmliab_pull') await handleRcmLiabPull(job, cur, progress);
    else if (job.step === 'gstr2b_pull_dash') await handleGstr2bPullDash(job, cur, progress);
    else if (job.step === 'gstr2b_pull') await handleGstr2bPull(job, cur, progress);
    else if (job.step === 'efiledpdf') await handleReturnPdf(job, cur, progress);
    else if (job.step === 'efiledview') await handleReturnView(job, cur, progress);
    else if (job.step === 'twob') await handleTwob(job, cur, progress);
    else if (job.step === 'twobdwld') await handleTwobDownload(job, cur, progress);
    else if (job.step === 'twoa') await handleTwoA(job, cur, progress);
    else if (job.step === 'twoadwld') await handleTwoADownload(job, cur, progress);
    else if (job.step === 'filing') await handleFiling(job, cur, progress);
    else if (job.step === 'gstr1_dash') await handleGstr1UploadDashboard(job, cur, progress);
    else if (job.step === 'gstr1_upload') await handleGstr1Upload(job, cur, progress);
    else if (job.step === 'gstr3b_dash') await handleGstr3bDashboard(job, cur, progress);
    else if (job.step === 'gstr3b_fill31') await handleGstr3bFill31(job, cur, progress);
    else if (job.step === 'gstr3b_fill4') await handleGstr3bFill4(job, cur, progress);
    else if (job.step === 'logout') await handleLogout(job);
    else if (job.step === 'done') { await clearJob(); }
  } catch (e) {
    if (e && e.message === 'cancelled') { banner('Cancelled.', '#6b7280'); await clearJob(); }
    else {
      const reason = (e && e.message) || 'unknown error';
      banner('Error on ' + (job.step || '?') + ': ' + reason + ' — moving on.', '#dc2626');
      try { await GSTKdb.logClientSync(cur.clientId, job.step || 'unknown', 'failed', 'Unhandled: ' + reason + ' [ext ' + EXT_VERSION + ']'); } catch (_) {}
      if (ledgerJob(job)) { try { await GSTKdb.logStep(job.runId, cur.clientId, job.step || 'unknown', 'failed', /timed out/.test(reason) ? 'timeout' : 'other', reason); } catch (_) {} }
      await advance(job);
    }
  }

  // Move to the next period for the SAME client first (no logout — the tab
  // is already authenticated, so this just re-runs the same job.step against
  // the dashboard for the next period). Only once every period is done does
  // this fall through to the next client (log out first), or finish.
  async function advance(job) {
    if (job.periodIdx + 1 < job.periods.length) {
      job.periodIdx++;
      job.period = job.periods[job.periodIdx];
      await setJob(job);
      banner('Period done — moving to ' + job.period + '…', '#2563eb');
      location.href = 'https://return.gst.gov.in/returns/auth/dashboard';
      return;
    }
    job.idx++;
    if (job.idx < job.clients.length) {
      job.periodIdx = 0;
      job.period = job.periods[0];
      job.step = 'logout';
      // Confirmed live 2026-09-13: this counter was never reset per client —
      // a client that genuinely exhausted all 3 auto-retries left
      // job.captchaRetry at 3, so the VERY NEXT client in the queue would
      // skip straight to "retries exhausted" on its own first bounce-back,
      // even for a plain one-off CAPTCHA typo unrelated to their password.
      delete job.captchaRetry;
      await setJob(job);
      banner('Client done — switching to the next…', '#2563eb');
      location.href = 'https://services.gst.gov.in/services/logout';
    } else {
      // 0.8.1: say which clients were left out for a refused password.
      const refused = job.loginRefused || [];
      banner('All ' + job.clients.length + ' client(s) done ✓'
        + (refused.length ? ' · not logged in (password refused): ' + refused.map((r) => r.name).join(', ') + ' — change them in Edit Client' : '')
        + ' — you can close this tab.', refused.length ? '#d97706' : '#16a34a');
      // An agent or scheduled job's run belongs to the queue (portal_job_finish closes it).
      if (job.runId && !job.agent && !job.runner) { try { await GSTKdb.runFinish(job.runId, 'done'); } catch (e) { /* ledger is diagnostic */ } }
      await clearJob();
    }
  }
  // Records one Sync All attempt for the Notices Dashboard's Company List
  // page — only when job.logSync is set (see background.js's
  // startAllClientsSectionPull: only the 'notices' Sync All sets it). Every
  // other job/mode never sets this flag, so this is a no-op for them, and a
  // failure here is diagnostic-only — it must never block the job itself.
  async function logSyncAttempt(job, cur, status, message) {
    if (!job.logSync) return;
    try { await GSTKdb.logClientSync(cur.clientId, 'notices', status, message || null); } catch (e) { /* diagnostic only */ }
  }

  // Unlike logSyncAttempt above, NOT gated on job.logSync — a login failure
  // means we never even reached this client's actual pull step, for ANY job
  // mode (Sync All, Fetch Company, a single Reports Hub pull, ...), so it's
  // worth recording regardless of which flow triggered it. Read by Company
  // List's Status/Status Message columns exactly like every other
  // client_sync_log row — surfaces as a real, distinguishable failure
  // instead of looking identical to "never synced".
  async function logLoginFailure(job, cur, message) {
    try { await GSTKdb.logClientSync(cur.clientId, 'login_failed', 'failed', message || null); } catch (e) { /* diagnostic only */ }
    if (ledgerJob(job)) { try { await GSTKdb.logStep(job.runId, cur.clientId, 'login', 'failed', 'login_failed', message || null); } catch (e) { /* diagnostic only */ } }
  }

  // ── 0.8.1: a refused password ends the client, once ──────────────────────
  // Before 0.8.1 a wrong or changed password kept the run on that client: a
  // person typing the CAPTCHAs was asked for one after another for the same
  // client (the portal's answer was read only after an automatic fill), and an
  // automatic fill tried three more times when it could not read the answer.
  // Now the answer is read after every Login press, whoever pressed it; a
  // refusal is logged once, remembered, and the run moves to the next client.

  // A bulk or scheduled run: never offers a password the portal refused. One
  // client logged in by a person's own click is still tried (and clears the
  // mark when it works), so the firm can always check a password by hand.
  // Function declarations, not consts: the dispatcher runs a step before the
  // lines of this file below it have run (CHANGELOG 0.5.0, "before initialization").
  function bulkJob(job) { return !!(job.runner || job.agent || (Array.isArray(job.clients) && job.clients.length > 1)); }

  function shown(el) { return !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'; }
  function oneLine(t) { return String(t || '').replace(/\s+/g, ' ').trim(); }

  // What the login form says now: the portal's message elements that are on
  // screen, and any line of the form that reads as a refusal.
  function loginMessages() {
    const out = [];
    const add = (t) => { t = oneLine(t); if (t && t.length <= 300 && !out.includes(t)) out.push(t); };
    for (const el of $$(LOGIN_ERR_SEL)) if (shown(el) && !el.closest('#gstk-banner')) add(el.innerText || el.textContent);
    const user = $('#username');
    const form = user && user.closest('form');
    if (form) for (const line of String(form.innerText || '').split('\n')) if (LOGIN_REFUSALS.some((r) => r.rx.test(line))) add(line);
    return out;
  }

  // 'refused' (with why), 'captcha', 'other', or 'none' when nothing is shown.
  function classifyLogin(msgs) {
    const refusal = (m) => LOGIN_REFUSALS.find((r) => r.rx.test(m));
    for (const m of msgs) {
      const hit = !LOGIN_CAPTCHA_RX.test(m) && refusal(m);
      if (hit) return { kind: 'refused', reason: hit.reason, message: m };
    }
    const cap = msgs.find((m) => LOGIN_CAPTCHA_RX.test(m) && !refusal(m));
    if (cap) return { kind: 'captcha', message: cap };
    if (msgs.length) return { kind: 'other', message: msgs[0] };
    return { kind: 'none', message: '' };
  }

  function whenText(iso) {
    const d = new Date(iso);
    return isNaN(d) ? 'an earlier run' : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function noteRefused(job, cur, skipped) {
    job.loginRefused = [...(job.loginRefused || []), { name: (cur.creds && cur.creds.name) || 'Client', skipped: !!skipped }];
  }

  // The portal refused this client's saved password: remember it, log it once,
  // and move to the next client. Never tried again until the password changes.
  async function refuseClient(job, cur, progress, pass, verdict) {
    const words = REFUSAL_WORDS[verdict.reason] || 'The portal refused the saved password';
    try { await GSTKdb.pwRefusalMark(cur.clientId, cur.creds.user, pass, { reason: verdict.reason, message: verdict.message, name: cur.creds.name }); }
    catch (e) { /* the sync log below still says it */ }
    noteRefused(job, cur, false);
    banner(cur.creds.name + ': ' + words.toLowerCase() + ' — logged; moving to the next client.' + progress, '#dc2626');
    await logLoginFailure(job, cur, words + ' (the portal said: "' + verdict.message.slice(0, 200) + '"). '
      + 'Not tried again until the password is changed in Edit Client.');
    await sleep(1500); // long enough to read the banner
    await advance(job);
  }

  // A Login press, noted in the tab's sessionStorage (it survives a page load),
  // so a refusal the portal answers with a fresh login page rather than in
  // place is still read as this press's answer on the next load.
  function notePress(cur) {
    try { sessionStorage.setItem('gstk_login_pressed', JSON.stringify({ client: cur.clientId, at: Date.now() })); } catch (e) { /* in-place answers are read anyway */ }
  }
  function takePress(cur) {
    try {
      const p = JSON.parse(sessionStorage.getItem('gstk_login_pressed') || 'null');
      sessionStorage.removeItem('gstk_login_pressed');
      return !!p && p.client === cur.clientId && Date.now() - p.at < 90000;
    } catch (e) { return false; }
  }

  // After an automatic Login press: wait for the portal's answer (a new page,
  // or a new message on the form) and act on it. `before` are the messages the
  // form already showed, which say nothing about this press.
  async function settleAutoLogin(job, cur, progress, pass, before, guard) {
    // A refusal is acted on the moment it shows; any other message only once
    // the page has had 2.5 s to settle (a "please wait" is not an answer).
    let msgs = [];
    const t0 = Date.now();
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      if (!/services\/login/.test(location.href)) { if (isLoggedIn()) return; continue; }
      msgs = loginMessages().filter((m) => !before.includes(m));
      if (classifyLogin(msgs).kind === 'refused' || (msgs.length && Date.now() - t0 >= 2500)) break;
    }
    if (!/services\/login/.test(location.href)) {
      if (isLoggedIn() || guard.done) return; // genuinely logged in: the dispatcher carries on
      guard.done = true;
      const heading = (($('h1,h2,h3') || {}).textContent || '').trim().slice(0, 160);
      const reason = 'Landed on an unrecognized page after login (' + location.pathname + (heading ? ': "' + heading + '"' : '') + ') — not the login form, but no logged-in signal either.';
      banner('Could not log in ' + cur.creds.name + ' — unexpected page after login. Moving on.' + progress, '#dc2626');
      await logLoginFailure(job, cur, reason);
      await advance(job);
      return;
    }
    if (guard.done) return; // the person watcher already acted on this answer
    guard.done = true;
    const verdict = classifyLogin(msgs);
    if (verdict.kind === 'refused') { await refuseClient(job, cur, progress, pass, verdict); return; }
    const tries = Number(job.captchaRetry || 0);
    // An answer that is neither a refusal nor a CAPTCHA gets one more try with
    // the same password, never three; the same answer again ends the client.
    if (verdict.kind === 'other') {
      if (job.loginOther) {
        banner('Could not log in ' + cur.creds.name + ' (' + verdict.message.slice(0, 120) + ') — logged; moving on.' + progress, '#dc2626');
        await logLoginFailure(job, cur, 'The portal did not log in: "' + verdict.message.slice(0, 200) + '"');
        await advance(job);
        return;
      }
      job.loginOther = verdict.message;
    }
    if ($('#captcha') && tries < 3) {
      job.captchaRetry = tries + 1;
      delete job.captchaWaitSince;
      await setJob(job);
      location.reload();
      return;
    }
    banner('Could not log in ' + cur.creds.name + ' after 3 attempts — moving on.' + progress, '#dc2626');
    await logLoginFailure(job, cur, verdict.message || 'Login did not succeed after 3 automatic retries.');
    await advance(job);
  }

  // A person types the CAPTCHA and presses Login: the portal's answer is read
  // the same way, so a refused password moves the run on instead of asking
  // for another CAPTCHA for the same client. Only a refusal is acted on; a
  // CAPTCHA typo is left to the person, as on the portal itself.
  function watchPersonLogin(job, cur, progress, pass, guard) {
    const before = loginMessages();
    const pressed = (e) => {
      const t = e.target && e.target.closest ? e.target : null;
      if (e.type === 'keydown' ? (e.key === 'Enter' && t && t.closest('form, #username, #user_pass, #captcha'))
        : (t && /log\s*in/i.test(((t.closest('button, input[type=submit]') || {}).textContent || '') + ((t.closest('input[type=submit]') || {}).value || '')))) notePress(cur);
    };
    document.addEventListener('click', pressed, true);
    document.addEventListener('keydown', pressed, true);
    const timer = setInterval(async () => {
      if (guard.done) { clearInterval(timer); return; }
      if (!/services\/login/.test(location.href)) return;
      const verdict = classifyLogin(loginMessages().filter((m) => !before.includes(m)));
      if (verdict.kind !== 'refused') return;
      guard.done = true;
      clearInterval(timer);
      await refuseClient(job, cur, progress, pass, verdict);
    }, 750);
  }

  // The run ledger (sync_run_items) records the notices module's syncs only;
  // a GSTR-3B or ledger pull keeps writing client_sync_log as before.
  function ledgerJob(job) {
    return !!job.runId || ['notices', 'notices_bundle', 'refunds', 'drc03'].includes(job.mode);
  }

  // A scheduled job (runner.js) waits captcha_wait_secs for the CAPTCHA box.
  function runnerWaitMs(job) {
    return Math.min(900, Math.max(30, Number(job.runner && job.runner.captchaWaitSecs) || 120)) * 1000;
  }
  // A scheduled job that ends on this page (CAPTCHA not filled in time, no login
  // form): the runner records it on the queue, which tries the client again later.
  async function runnerEnd(job, outcome, reason, error) {
    try { await GSTKdb.runnerEndJob({ jobId: job.runner.jobId, outcome, reason, error }); } catch (e) { /* the runner's own deadline ends it */ }
  }

  async function handleLogout(job) {
    // On the logout page now — let the previous client's session fully clear, then
    // start the next client's login.
    await sleep(2000);
    job.step = 'login';
    delete job.captchaWaitSince;
    await setJob(job);
    location.href = 'https://services.gst.gov.in/services/login';
  }

  async function handleLogin(job, cur, progress) {
    if (isLoggedIn()) {
      job.retries = 0;
      delete job.captchaRetry;
      delete job.captchaWaitSince;
      delete job.loginOther;
      try { sessionStorage.removeItem('gstk_login_pressed'); } catch (e) { /* none noted */ }
      // 0.8.1: the portal took this password: any earlier refusal is over.
      try { await GSTKdb.pwRefusalClear(cur.clientId); } catch (e) { /* only a later skip would notice */ }
      try { await GSTKdb.clearCaptchaNotice(); } catch (e) { /* optional */ }
      if (job.mode === 'returnpdf') {
        banner('Logged in — fetching the return + PDF…' + progress);
        job.step = 'efiledpdf';
        await setJob(job);
        location.href = 'https://return.gst.gov.in/returns/auth/efiledReturns';
      } else if (job.mode === 'twob') {
        banner('Logged in — opening the returns dashboard…' + progress);
        job.step = 'twob';
        await setJob(job);
        location.href = 'https://return.gst.gov.in/returns/auth/dashboard';
      } else if (job.mode === 'twoa') {
        banner('Logged in — opening the returns dashboard…' + progress);
        job.step = 'twoa';
        await setJob(job);
        location.href = 'https://return.gst.gov.in/returns/auth/dashboard';
      } else if (job.mode === 'filing') {
        banner('Logged in — opening the filing page…' + progress);
        job.step = 'filing';
        await setJob(job);
        // The tab was foregrounded for the CAPTCHA step below — send it
        // back to the background for the automated dashboard navigation
        // (FY/Quarter/Month/Search/tile-finding in handleFiling); it comes
        // back to the foreground right before the final "Prepare Online"
        // click. Best-effort: a failure here just leaves the tab visible,
        // it never blocks the actual job.
        try { await GSTKdb.backgroundTab(); } catch (e) { /* non-fatal */ }
        location.href = 'https://return.gst.gov.in/returns/auth/dashboard';
      } else if (job.mode === 'gstr1_upload') {
        banner('Logged in — opening the returns dashboard for the GSTR-1 upload…' + progress);
        job.step = 'gstr1_dash';
        await setJob(job);
        location.href = 'https://return.gst.gov.in/returns/auth/dashboard';
      } else if (job.mode === 'gstr1_refresh') {
        banner('Logged in — checking the portal for the latest error report…' + progress);
        job.step = 'gstr1_dash';
        await setJob(job);
        location.href = 'https://return.gst.gov.in/returns/auth/dashboard';
      } else if (job.mode === 'gstr3b_push') {
        banner('Logged in — opening the returns dashboard for GSTR-3B…' + progress);
        job.step = 'gstr3b_dash';
        await setJob(job);
        location.href = 'https://return.gst.gov.in/returns/auth/dashboard';
      } else if (job.mode === 'liabilityledger') {
        banner('Logged in — reading the Liability Register…' + progress);
        job.step = 'liabilityledger';
        await setJob(job);
        location.href = 'https://return.gst.gov.in/returns/auth/ledger/taxdetailedledger';
      } else if (job.mode === 'cashledger') {
        banner('Logged in — reading the Cash Ledger…' + progress);
        job.step = 'cashledger';
        await setJob(job);
        location.href = 'https://payment.gst.gov.in/payment/auth/ledger/detailedledger';
      } else if (job.mode === 'notices' || job.mode === 'notices_bundle') {
        // 'notices_bundle' is the Notices Dashboard's "Sync All" — starts the
        // same place as a standalone Notices pull, but (via chainOrStop
        // below) continues on through Refunds and DRC-03 for the same
        // client instead of stopping, since a human clicking one "Sync All"
        // button expects all three, not just the first.
        banner('Logged in — reading Notices & Orders…' + progress);
        job.step = 'notices';
        await setJob(job);
        location.href = 'https://services.gst.gov.in/services/auth/notices';
      } else if (job.mode === 'refunds') {
        // Reads the case list straight from the same JSON API DRC-03 already
        // uses (litserv/auth/api/case/search, caseTypeCd 'RFUND' instead of
        // 'ADJVP') — confirmed live 2026-09-07 directly from the portal's
        // own public casesearchctrl.js source, not guessed. No registration-
        // date lookup needed for this (DRC-03 doesn't need one either — that
        // was only ever a Filing-Year-form workaround, now moot since the
        // whole DOM form is gone). 'refund_docs' (the document harvest,
        // below) is now the exact same story — see handleRefundDocs — so it
        // shares this same direct routing rather than its old separate
        // reg-date/window-walk detour. 'notices_bundle' never reaches here —
        // it's matched earlier in this same if-chain (starts at Notices,
        // chains into 'refunds' afterward, see chainOrStop).
        banner('Logged in — reading Refund applications…' + progress);
        job.step = 'refunds';
        await setJob(job);
        location.href = 'https://services.gst.gov.in/litserv/auth/case/search';
      } else if (job.mode === 'refund_docs') {
        banner('Logged in — reading Refund documents…' + progress);
        job.step = 'refund_docs';
        await setJob(job);
        location.href = 'https://services.gst.gov.in/litserv/auth/case/search';
      } else if (job.mode === 'drc03') {
        banner('Logged in — reading DRC-03 filings…' + progress);
        job.step = 'drc03';
        await setJob(job);
        location.href = 'https://services.gst.gov.in/litserv/auth/case/search';
      } else if (job.mode === 'taxpayerprofile') {
        banner('Logged in — reading Taxpayer Profile…' + progress);
        job.step = 'taxpayerprofile';
        await setJob(job);
        location.href = 'https://services.gst.gov.in/services/auth/myprofile';
      } else if (job.mode === 'challans') {
        banner('Logged in — reading Challan Summary…' + progress);
        job.step = 'challans';
        await setJob(job);
        location.href = 'https://payment.gst.gov.in/payment/auth/challanhistory';
      } else if (job.mode === 'gstr3b_pull') {
        banner('Logged in — reading filed GSTR-3B…' + progress);
        job.step = 'gstr3b_pull';
        await setJob(job);
        location.href = 'https://return.gst.gov.in/returns/auth/dashboard';
      } else if (job.mode === 'gstr9_pull') {
        banner('Logged in — reading the GSTR-9 system-computed figures…' + progress);
        job.step = 'gstr9_pull';
        await setJob(job);
        location.href = 'https://return.gst.gov.in/returns/auth/dashboard';
      } else if (job.mode === 'gstr1_pull') {
        banner('Logged in — reading filed GSTR-1…' + progress);
        job.step = 'gstr1_pull';
        await setJob(job);
        location.href = 'https://return.gst.gov.in/returns/auth/dashboard';
      } else if (job.mode === 'gstr1_json_pull') {
        banner('Logged in — requesting the filed GSTR-1 JSON…' + progress);
        job.step = 'gstr1_json_pull';
        await setJob(job);
        location.href = 'https://return.gst.gov.in/returns/auth/dashboard';
      } else if (job.mode === 'revrclm_pull') {
        banner('Logged in — reading the Credit Reversal and Re-claimed Statement…' + progress);
        job.step = 'revrclm_pull';
        await setJob(job);
        location.href = 'https://return.gst.gov.in/returns/auth/dashboard';
      } else if (job.mode === 'rcmliab_pull') {
        banner('Logged in — reading the RCM Liability/ITC Statement…' + progress);
        job.step = 'rcmliab_pull';
        await setJob(job);
        location.href = 'https://return.gst.gov.in/returns/auth/dashboard';
      } else if (job.mode === 'creditledgertxn') {
        banner('Logged in — reading Credit Ledger (transaction detail)…' + progress);
        job.step = 'creditledgertxn';
        await setJob(job);
        location.href = 'https://return.gst.gov.in/returns/auth/ledger/detailedledger';
      } else if (job.mode === 'gstr2a_pull') {
        banner('Logged in — reading GSTR-2A (B2B)…' + progress);
        job.step = 'gstr2a_pull';
        await setJob(job);
        location.href = 'https://return.gst.gov.in/returns/auth/dashboard';
      } else if (job.mode === 'gstr2b_pull') {
        banner('Logged in — opening the returns dashboard for GSTR-2B…' + progress);
        job.step = 'gstr2b_pull_dash';
        await setJob(job);
        location.href = 'https://return.gst.gov.in/returns/auth/dashboard';
      } else if (job.mode === 'login') {
        // Simple login from the Clients → Credentials "Login" button: log in and
        // stop on the portal, no return/ledger navigation.
        banner('Logged in ✓ — ' + cur.creds.name + '. You are on the GST portal; this tab is yours now.', '#16a34a');
        await clearJob();
      } else if (job.mode === 'noticeopen') {
        // From a Notices Dashboard row's "Portal" icon: log in and land on
        // Notices & Orders, then stop — the specific notice's own view/reply
        // flow varies by notice type (see background.js's startNoticeOpen),
        // so we get the human to the right list logged in as the right
        // client and let them take it from there (search by ref no.).
        const ref = job.referenceNumber ? ' — search for "' + job.referenceNumber + '" in the list.' : '';
        banner('Logged in ✓ — ' + cur.creds.name + '. Opening Notices & Orders' + ref, '#16a34a');
        await clearJob();
        location.href = 'https://services.gst.gov.in/services/auth/notices';
      } else {
        banner('Logged in — reading ledgers…' + progress);
        job.step = 'ledger';
        await setJob(job);
        location.href = 'https://return.gst.gov.in/returns/auth/ledger/detailedledger';
      }
      return;
    }
    if (!/services\/login/.test(url)) { location.href = 'https://services.gst.gov.in/services/login'; return; }
    // 'filing' jobs open this tab in the background (see startFilingOpen in
    // background.js) so the automated Returns-Dashboard navigation doesn't
    // play out on screen — but everything from here through the CAPTCHA is
    // either shown to a human (the login form itself) or could fail in a
    // way only a human can act on ("Login form did not load"), so bring it
    // forward now rather than right before the CAPTCHA wait specifically.
    // Every other job mode's tab was already foreground from creation, so
    // this is a no-op for them either way.
    if (job.mode === 'filing') { try { await GSTKdb.focusTab(); } catch (e) { /* non-fatal */ } }
    banner('Logging in ' + cur.creds.name + '…' + progress);
    if (!(await waitFor('#username'))) {
      banner('Login form did not load — reload the page.', '#dc2626');
      if (job.runner) await runnerEnd(job, 'retry', 'portal_error', 'The portal login page did not load.');
      return;
    }
    let portalPass = cur.creds.pass || null; // jobs saved by extension < 0.4.0 still carry it
    if (!portalPass) { try { portalPass = await GSTKdb.getPortalPassword(cur.clientId); } catch (e) { portalPass = null; } }
    // 0.8.1: this page may itself be the portal's answer to this client's Login
    // press (a refusal sent back as a fresh page): read it before filling again.
    if (takePress(cur)) {
      await sleep(600);
      const answer = classifyLogin(loginMessages());
      if (answer.kind === 'refused') { await refuseClient(job, cur, progress, portalPass, answer); return; }
    }
    setVal($('#username'), cur.creds.user);
    if (!portalPass) {
      banner('No saved GST portal password for ' + cur.creds.name + ' — update it in Edit Client.', '#dc2626');
      // Nobody is at a scheduled sync to read the banner: it goes in the run ledger, and the client fails with it.
      if (job.runner) { await logLoginFailure(job, cur, 'No saved GST portal password for this client.'); await advance(job); }
      return;
    }
    // 0.8.1: a password the portal already refused is not offered again in a
    // bulk or scheduled run: the client is logged and the run moves on, until
    // the password saved in GST Keeper changes.
    if (bulkJob(job)) {
      let refused = null;
      try { refused = await GSTKdb.pwRefusalCheck(cur.clientId, cur.creds.user, portalPass); } catch (e) { refused = null; }
      if (refused) {
        banner('Skipping ' + cur.creds.name + ' — the portal refused this password on ' + whenText(refused.at) + '; logged.' + progress, '#dc2626');
        noteRefused(job, cur, true);
        await logLoginFailure(job, cur, 'Not tried: the portal refused this saved password on ' + whenText(refused.at)
          + (refused.message ? ' ("' + String(refused.message).slice(0, 160) + '")' : '')
          + '. Change it in Edit Client, or log the client in once from GST Keeper, and the next sync tries it again.');
        await sleep(1200);
        await advance(job);
        return;
      }
    }
    setVal($('#user_pass'), portalPass);
    // One answer to a Login press is acted on, whoever pressed it. A person may
    // type this CAPTCHA (any sync but a scheduled or agent one): their Login is
    // watched from now, since the wait below only ends for an automatic fill.
    const guard = { done: false };
    if (!job.runner && !job.agent) watchPersonLogin(job, cur, progress, portalPass, guard);
    await waitFor('#imgCaptcha', 8000);
    // A notices sync tab is often behind other windows: say so on the desktop.
    // An agent job's CAPTCHA goes to the app's CAPTCHA wall instead, a
    // scheduled job's is filled by the CAPTCHA extension in this Chrome, and
    // every other pull (2B, GSTR-1, 3B, ledgers…) logs in as it always did.
    if (!job.agent && !job.runner && ledgerJob(job)) { try { await GSTKdb.notifyCaptcha(cur.creds.name, progress); } catch (e) { /* optional */ } }
    // No custom popup — the CAPTCHA is typed straight into the portal's own
    // native #captcha field. The field has no maxlength/expected-length we
    // can read (confirmed live: only a numeric-only ng-pattern), so "is it
    // done yet" can't be answered by length. Instead we tell a HUMAN typing
    // it from an AUTOMATED fill (an OCR result, or any other script setting
    // .value in one shot) by how the value changes: a real keystroke grows
    // the value by exactly one character at a time, while a programmatic
    // fill jumps the value by more than one character in a single 'input'
    // event (the field also blocks a real clipboard paste via
    // data-ng-paste, so a multi-character jump can only mean a script wrote
    // it, never a person). Only an automated jump auto-submits; a human
    // typing one character at a time is left alone entirely — they press
    // Enter or click Login themselves, same as using the portal directly.
    // This replaces the old "click the instant the box is non-empty" logic,
    // which fired on literally the first keystroke and submitted a
    // guaranteed-wrong, half-typed CAPTCHA.
    const cap = $('#captcha');
    let autoFilled = false;
    if (cap) {
      if (job.runner) {
        // The runner (background) ends a wait this page's timer misses, e.g. in a throttled tab.
        job.captchaWaitSince = Date.now();
        await setJob(job);
        banner('Waiting for the CAPTCHA extension in this Chrome to fill the CAPTCHA…' + progress);
      }
      autoFilled = await new Promise((resolve) => {
        let prevLen = (cap.value || '').length;
        let keyed = false;
        let settled = false;
        let poll = null;
        const done = (filled) => {
          if (settled) return;
          settled = true;
          cap.removeEventListener('input', onInput);
          cap.removeEventListener('keydown', onKey);
          clearTimeout(giveUp);
          if (poll) clearInterval(poll);
          resolve(filled);
        };
        const onInput = () => {
          const newLen = (cap.value || '').length;
          const delta = newLen - prevLen;
          prevLen = newLen;
          if (delta > 1 && newLen > 0) done(true);
          // A one-character-at-a-time change (typing or backspacing) never
          // resolves here — the human submits manually, and this promise
          // is left to time out below.
        };
        const onKey = (e) => { if (e.isTrusted) keyed = true; };
        cap.addEventListener('input', onInput);
        cap.addEventListener('keydown', onKey);
        // The office agent waits for this before it shows the CAPTCHA on the wall.
        if (job.agent) document.documentElement.setAttribute('data-gstk-captcha', 'ready');
        // A scheduled job also takes a box the CAPTCHA extension filled before
        // this script was listening, or filled in steps with no key pressed:
        // once it holds still for 1.5 s. Only the box's value is looked at,
        // never the CAPTCHA image; a person's keys leave it to them.
        if (job.runner) {
          let last = cap.value || '';
          let since = Date.now();
          poll = setInterval(() => {
            const v = cap.value || '';
            if (v !== last) { last = v; since = Date.now(); return; }
            if (!keyed && v.length >= 4 && Date.now() - since >= 1500) done(true);
          }, 500);
        }
        // A person types within a minute; the agent relays a CAPTCHA typed on
        // the wall, which may take longer (it reloads a stale one itself); a
        // scheduled job waits captcha_wait_secs (Autopilot settings).
        const giveUp = setTimeout(() => done(false), job.agent ? 30 * 60000 : job.runner ? runnerWaitMs(job) : 60000);
      });
    }
    if (!autoFilled && job.runner) {
      const secs = Math.round(runnerWaitMs(job) / 1000);
      banner('The CAPTCHA was not filled within ' + secs + ' seconds — this client is tried again later.' + progress, '#dc2626');
      await runnerEnd(job, 'retry', 'captcha_timeout', 'The CAPTCHA was not filled within ' + secs + ' seconds.');
      return;
    }
    if (!autoFilled) {
      banner('Type the CAPTCHA and press Login yourself — auto-submit only kicks in for a scripted/OCR fill.' + progress, '#2563eb');
      return; // Human takes it from here; their own click navigates the page and re-runs this script.
    }
    const btn =
      $$('button').find((b) => /login/i.test(b.textContent || '') && /btn-primary/.test(b.className || '')) ||
      $('button[type=submit]');
    if (btn) {
      // A wrong CAPTCHA and a wrong saved password bring back the same login
      // form; only the portal's own message tells them apart, so it is read
      // (settleAutoLogin) rather than every bounce being taken for a CAPTCHA
      // typo. Confirmed live before 0.4: a WRONG PASSWORD was retried with a
      // fresh CAPTCHA, pointlessly, and stalled the run behind it. 0.8.1 reads
      // the answer as soon as it appears, from more of the page, and never
      // offers a refused password again.
      const before = loginMessages();
      notePress(cur);
      btn.click();
      settleAutoLogin(job, cur, progress, portalPass, before, guard).catch(() => { /* the watchdog ends a stuck client */ });
    }
    // Page navigates; next content-script load (step still 'login') re-checks isLoggedIn().
  }

  // "One return" mode — triggered by the app's Filing Status button. Opens View
  // e-Filed Returns for job.ret, reads its ARN + filed date, downloads its PDF
  // (MAIN-world hook captures the blob), uploads it, and marks the return Filed.
  async function handleReturnPdf(job, cur) {
    if (!/efiledReturns/.test(url)) { location.href = 'https://return.gst.gov.in/returns/auth/efiledReturns'; return; }
    // If we already clicked the download once and bounced back here, the link
    // opened a viewer/page instead of downloading a file — stop, don't loop.
    if (job.pdfClicked) { banner('The download opened a page instead of a file — tell me what you saw when clicking View/Download and I\'ll adjust.', '#dc2626'); await clearJob(); return; }
    if (!(await waitFor('select', 20000))) { banner('e-Filed Returns page did not load.', '#dc2626'); await clearJob(); return; }
    const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const ret = job.ret || {};
    const [mm, yyyy] = String(ret.period_month || '').split('/').map((n) => parseInt(n, 10));
    if (!mm || !yyyy) { banner('Bad return period.', '#dc2626'); await clearJob(); return; }
    const fyStart = mm >= 4 ? yyyy : yyyy - 1;
    const fyShort = fyStart + '-' + String((fyStart + 1) % 100).padStart(2, '0');
    const monthName = MONTHS_FULL[mm - 1];
    const freq = /\(Q\)|IFF/.test(ret.return_type || '') ? 'Quarterly' : 'Monthly';
    // Portal Return Type option labels are alnum, e.g. "GSTR3B", "GSTR1".
    const retAlnum = /GSTR-1/.test(ret.return_type || '') ? 'GSTR1'
      : /GSTR-3B/.test(ret.return_type || '') ? 'GSTR3B'
      : String(ret.return_type || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

    // Fill the cascading form in order, waiting for each option list to render.
    banner('Finding ' + ret.return_type + ' ' + ret.period_month + '…');
    if (!(await selectWhereOption(fyShort))) { banner('Could not set financial year ' + fyShort + ' (page layout may differ).', '#dc2626'); await clearJob(); return; }
    await sleep(700); // let the FY change settle before the cascading period select
    if (!(await selectWhereOption(freq))) { banner('Could not set the filing period (' + freq + ').', '#dc2626'); await clearJob(); return; }
    await sleep(700); // selecting the period reveals the Month dropdown — give it a beat
    if (freq === 'Quarterly') {
      // GST FY quarters: Q1 Apr-Jun, Q2 Jul-Sep, Q3 Oct-Dec, Q4 Jan-Mar.
      const q = mm >= 4 ? Math.ceil((mm - 3) / 3) : 4;
      await selectWhereOption('Quarter' + q, { alnum: true, startsWith: true, timeout: 6000 });
      await sleep(500);
    }
    // Month dropdown only renders after the period is chosen — selectWhereOption
    // polls, so it waits for it to appear. (Quarterly views may not have one.)
    const monthSel = await selectWhereOption(monthName, { timeout: freq === 'Monthly' ? 15000 : 6000 });
    if (freq === 'Monthly' && !monthSel) { banner('Could not set the month (' + monthName + ').', '#dc2626'); await clearJob(); return; }
    await selectWhereOption(retAlnum, { alnum: true, startsWith: true, timeout: 6000 });
    await sleep(300);
    const search = $$('button, input[type=submit], input[type=button]').find((b) => /search/i.test((b.textContent || '') + ' ' + (b.value || ''))) || $('button.btn-primary.pull-right');
    if (!search) { banner('Could not find the Search button.', '#dc2626'); await clearJob(); return; }
    search.click();

    const tr = await waitForRow(12000);
    if (!tr) { banner('No filed ' + ret.return_type + ' found for ' + ret.period_month + ' — check the period.', '#f59e0b'); await clearJob(); return; }
    const cells = [...tr.children].map((td) => (td.textContent || '').replace(/\s+/g, ' ').trim());
    // Columns: Return Type, FY, Tax Period, Acknowledgement Number, Date of filing, ...
    const arn = (cells[3] || '').toUpperCase();
    const filedDate = ddmmyyyyToIso(cells[4] || '');
    if (!/^[A-Z0-9]{15}$/.test(arn)) { banner('Found a row but could not read a valid ARN for ' + ret.return_type + '.', '#f59e0b'); await clearJob(); return; }
    // Prefer the "View" page: it has a dedicated Download-PDF button that yields
    // a capturable file. The row's inline download icon tends to open a PDF
    // VIEWER page instead of saving a file, so only use it when there's NO View.
    const viewLink = tr.querySelector('a.btn-edit') || [...tr.querySelectorAll('a, button')].find((a) => /^\s*view\s*$/i.test(a.textContent || ''));
    if (viewLink) {
      job.ret = Object.assign({}, ret, { arn, filedDate });
      job.step = 'efiledview';
      job.viewClicked = false;
      await setJob(job);
      banner('Opening the filed ' + ret.return_type + ' to download its PDF…');
      viewLink.click();
      return;
    }

    // No View link → try an inline direct download control in the row.
    const directDl = tr.querySelector('a[title="download" i], a[download], a[href$=".pdf" i], a[href*="pdf" i]')
      || (tr.querySelector('i.fa-download') && tr.querySelector('i.fa-download').closest('a, button'))
      || [...tr.querySelectorAll('a, button')].find((a) => /download/i.test((a.textContent || '') + ' ' + (a.getAttribute('title') || '') + ' ' + (a.className || '')) && !/view/i.test(a.textContent || ''));
    if (!directDl) { banner('Found ' + ret.return_type + ' (ARN ' + arn + ') but no View/Download control in the row.', '#f59e0b'); await clearJob(); return; }
    banner('Downloading the ' + ret.return_type + ' PDF…');
    job.pdfClicked = true;
    await setJob(job);
    const dataUrl = await new Promise((resolve) => {
      const h = (e) => { if (e.data && e.data.__gstkPdf) { window.removeEventListener('message', h); resolve(e.data.__gstkPdf); } };
      window.addEventListener('message', h);
      setTimeout(() => { window.removeEventListener('message', h); resolve(null); }, 20000);
      directDl.click();
    });
    if (!dataUrl) { banner('Found ' + ret.return_type + ' (ARN ' + arn + ') but could not capture the PDF.', '#dc2626'); await clearJob(); return; }
    try { await saveReturnPdf(cur, ret, arn, filedDate, dataUrl); banner(ret.return_type + ' ' + ret.period_month + ' — Filed + PDF saved ✓. Close this tab.', '#16a34a'); }
    catch (e) { banner('Save failed: ' + (e && e.message), '#dc2626'); }
    await clearJob();
  }

  // Upload a captured PDF data-URL to the bucket and mark the return Filed.
  async function saveReturnPdf(cur, ret, arn, filedDate, dataUrl) {
    const path = cur.clientId + '/' + ret.period_month.replace('/', '-') + '/' + ret.return_type + '-' + arn + '.pdf';
    const pdfUrl = await GSTKdb.uploadPdf(path, dataUrl);
    await GSTKdb.markFiled({
      client_id: cur.clientId, return_type: ret.return_type, period_month: ret.period_month,
      status: 'Filed', arn, filed_date: filedDate, return_pdf_url: pdfUrl, updated_at: new Date().toISOString(),
    });
  }

  // The return-view page reached by clicking "View" on View e-Filed Returns.
  // Find the PDF-download button (e.g. "DOWNLOAD FILED GSTR-3B"), capture the blob
  // (inject.js hook), upload it, and mark Filed. Runs when step === 'efiledview'.
  async function handleReturnView(job, cur) {
    // DIAGNOSTIC MARKER v3 — bumped from v2 specifically so this tag proves
    // THIS revision (substring match for "VIEW SUMMARY", not the earlier
    // exact-match version) is what's running. If you still see "[v2]" or no
    // tag at all instead of "[v3]", the reload isn't taking effect — check
    // chrome://extensions for the exact folder path it's loaded from and
    // confirm it matches C:\Users\Admin\OneDrive\Desktop\extension.
    banner('[v3] handleReturnView starting…', '#7c3aed');
    await sleep(400);
    const ret = job.ret || {};
    const arn = (ret.arn || '').toUpperCase();
    if (!/^[A-Z0-9]{15}$/.test(arn)) { banner('Lost the ARN — please retry the pull.', '#dc2626'); await clearJob(); return; }
    // Already clicked download and bounced back → it opened a viewer we can't
    // capture; stop instead of looping.
    if (job.viewClicked) { banner('The ' + ret.return_type + ' download did not produce a capturable file — tell me the exact button label on the view page.', '#dc2626'); await clearJob(); return; }

    // For GSTR-1 the "View" link lands on the itemized table-by-table page
    // (…/returns/auth/gstr1), which has NO download control at all — the
    // actual "DOWNLOAD (PDF)" button only exists one click deeper, on the
    // summary sub-page (…/returns/auth/gstr1/gstr1sum) reached via its own
    // "VIEW SUMMARY" button. Confirmed live. Click through once if we're not
    // there yet before searching for the download control. This page is
    // Angular-rendered like the rest of the portal, so — same as everywhere
    // else in this file — POLL for the button rather than checking once; a
    // single synchronous find() right as the page loads can easily run
    // before Angular has rendered it, and silently find nothing.
    if (/GSTR-?1\b/i.test(ret.return_type || '') && !/gstr1sum/i.test(url) && !job.summaryClicked) {
      banner('Opening the GSTR-1 summary page for the PDF download…');
      let summaryBtn = null;
      const ts0 = Date.now();
      while (Date.now() - ts0 < 12000 && !summaryBtn) {
        // Confirmed live (DevTools): this is one <button> with TWO <span>
        // children toggled by ng-show/ng-hide ("PROCEED FILE/SUMMARY" for
        // unfiled, "VIEW SUMMARY" for filed) — .textContent concatenates
        // BOTH regardless of which is CSS-hidden, so an exact/anchored match
        // against the whole button's text can never succeed. Match the
        // phrase as a substring instead.
        summaryBtn = $$('a, button').find((x) => x.offsetParent !== null && /\bview\s+summary\b/i.test(x.textContent || ''));
        if (!summaryBtn) await sleep(400);
      }
      if (summaryBtn) {
        job.summaryClicked = true;
        await setJob(job);
        summaryBtn.click();
        await sleep(2000);
      }
      // If summaryBtn was never found, fall through to the search below as-is
      // — it'll report the real "no PDF-download button" state honestly
      // rather than silently pretending nothing was tried.
    }

    let dl = null;

    // For GSTR-3B the portal auto-shows a "System generated summary" popup
    // (#statustable) on every load of this page — confirmed live, same
    // popup closeGstr3bModal() already handles for the Push-to-Portal flow,
    // just never wired into this ARN/PDF-pull flow. It sits on top of the
    // real download button, and the generic text-based search below isn't
    // reliable here anyway: the page also has a DIFFERENT red "SYSTEM
    // GENERATED GSTR-3B" button that downloads a different file and would
    // happily match a loose "download"+"pdf" guess. Target the real button
    // by its exact ng-click attribute instead, closing the popup first.
    if (/GSTR-?3B/i.test(ret.return_type || '')) {
      banner('Closing the system-generated-summary popup, if it\'s open…');
      const popup = $('#statustable');
      if (popup && getComputedStyle(popup).display === 'block') {
        const closeBtn = popup.querySelector('button[data-dismiss="modal"]');
        if (closeBtn) closeBtn.click();
        const pt0 = Date.now();
        while (Date.now() - pt0 < 5000 && getComputedStyle(popup).display === 'block') await sleep(200);
      }
      const blueBtn = await waitFor('button[data-ng-click="downloadPrePdf()"]', 15000);
      if (blueBtn) {
        blueBtn.scrollIntoView({ block: 'center' });
        await sleep(300); // let the scroll settle before the click below
        dl = blueBtn;
      }
      // If not found (e.g. an unfiled period has no such button), fall
      // through to the generic search — it'll report honestly if that also
      // finds nothing, rather than silently giving up here.
    }

    if (!dl) banner('Looking for the ' + ret.return_type + ' PDF download…');
    const t = (x) => (x.textContent || '') + ' ' + (x.getAttribute('title') || '');
    const t0 = Date.now();
    while (Date.now() - t0 < 20000 && !dl) {
      // Only content controls — exclude the portal's top-nav "Downloads" menu.
      const cands = $$('a, button').filter((x) => x.offsetParent !== null &&
        !x.closest('nav, header, .navbar, .nav, .navbar-nav, .dropdown-menu, .top-nav, .mega-menu, ul.nav'));
      dl = cands.find((x) => /download/i.test(t(x)) && /pdf/i.test(t(x)))
        || cands.find((x) => /download/i.test(t(x)) && /(gstr|filed|return)/i.test(t(x)))
        || cands.find((x) => /^\s*download\s*$/i.test((x.textContent || '').trim()))
        || cands.find((x) => x.querySelector && x.querySelector('i.fa-download'));
      if (!dl) await sleep(500);
    }
    if (!dl) {
      banner(
        '[v3] found no PDF-download button on ' + location.pathname +
        ' — summary click: ' + (job.summaryClicked ? 'attempted' : 'button never found') +
        '. Tell me the button label you see.',
        '#f59e0b'
      );
      await clearJob();
      return;
    }

    banner('Downloading the ' + ret.return_type + ' PDF…');
    job.viewClicked = true;
    await setJob(job);
    const dataUrl = await new Promise((resolve) => {
      const h = (e) => { if (e.data && e.data.__gstkPdf) { window.removeEventListener('message', h); resolve(e.data.__gstkPdf); } };
      window.addEventListener('message', h);
      setTimeout(() => { window.removeEventListener('message', h); resolve(null); }, 25000);
      dl.click();
    });
    if (!dataUrl) { banner('Clicked download on the ' + ret.return_type + ' page but could not capture the PDF — tell me what happened.', '#dc2626'); await clearJob(); return; }
    try { await saveReturnPdf(cur, ret, arn, ret.filedDate, dataUrl); banner(ret.return_type + ' ' + ret.period_month + ' — Filed + PDF saved ✓. Close this tab.', '#16a34a'); }
    catch (e) { banner('Save failed: ' + (e && e.message), '#dc2626'); }
    await clearJob();
  }

  // Find an action button inside the dashboard tile that names `returnRe`, and is
  // NOT a wrapper that also names any of `excludeRes` (all the dashboard action
  // buttons share the text "Download"/"View", so a wrapper of several tiles would
  // otherwise yield the wrong return's button). Picks the SMALLEST element that
  // contains BOTH the return name and a matching button (= the tile card itself).
  function findTileButton(returnRe, btnRe, excludeRes) {
    const cands = $$('div[class*="col-"]').filter((t) => {
      const txt = t.textContent || '';
      if (!returnRe.test(txt)) return false;
      if (excludeRes.some((re) => re.test(txt))) return false;
      return [...t.querySelectorAll('button, a')].some((b) => btnRe.test((b.textContent || '').trim()));
    });
    cands.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
    const tile = cands[0];
    return tile ? ([...tile.querySelectorAll('button, a')].find((b) => btnRe.test((b.textContent || '').trim())) || null) : null;
  }

  // Map an app return_type to its dashboard tile + filing button. `excl` rejects
  // wrapper/other-return tiles (see findTileButton).
  function filingTileFor(returnType) {
    const rt = String(returnType || '').toUpperCase();
    if (/GSTR-?3B/.test(rt)) return { re: /gstr[\s-]*3b/i, label: 'GSTR-3B', excl: [/gstr[\s-]*1\b/i, /gstr[\s-]*2/i] };
    if (/GSTR-?1/.test(rt)) return { re: /gstr[\s-]*1\b/i, label: 'GSTR-1', excl: [/gstr[\s-]*1a/i, /gstr[\s-]*2/i, /gstr[\s-]*3/i, /gstr[\s-]*6/i, /gstr[\s-]*7/i] };
    if (/ITC-?0?4/.test(rt)) return { re: /itc[\s-]*0?4/i, label: 'ITC-04', excl: [] };
    if (/GSTR-?6/.test(rt)) return { re: /gstr[\s-]*6\b/i, label: 'GSTR-6', excl: [/gstr[\s-]*1/i, /gstr[\s-]*2/i, /gstr[\s-]*3/i] };
    if (/GSTR-?7/.test(rt)) return { re: /gstr[\s-]*7\b/i, label: 'GSTR-7', excl: [/gstr[\s-]*1/i, /gstr[\s-]*2/i, /gstr[\s-]*3/i] };
    if (/CMP-?0?8/.test(rt)) return { re: /cmp[\s-]*0?8/i, label: 'CMP-08', excl: [] };
    return null;
  }

  // "Open filing page" mode — from the Filing Status login icon. Log in (done),
  // then on the dashboard pick FY + quarter + month, Search, and click the
  // return's "Prepare Online" so the human lands on the filing page. We DO NOT
  // submit — CAPTCHA and the final OTP/DSC submission stay with the human.
  // This whole function runs on a BACKGROUNDED tab (see startFilingOpen in
  // background.js) — any banner it shows on its way to failing is invisible
  // until the tab is foregrounded again, so every exit that leaves a banner
  // for a human to read goes through this instead of a bare banner() call.
  // (The very first check below, a plain redirect with no banner, is the
  // one exception — it's not a terminal state, just internal navigation.)
  async function failFiling(job, msg, color) {
    try { await GSTKdb.focusTab(); } catch (e) { /* non-fatal */ }
    banner(msg, color);
    await clearJob();
  }

  async function handleFiling(job, cur, progress) {
    if (!/returns\/auth\/dashboard/.test(url)) { location.href = 'https://return.gst.gov.in/returns/auth/dashboard'; return; }
    if (!(await waitFor('select', 20000))) { await failFiling(job, 'Returns dashboard did not load.', '#dc2626'); return; }
    const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const ret = job.ret || {};
    const map = filingTileFor(ret.return_type);
    if (!map) { await failFiling(job, 'This return type is not supported for one-click filing: ' + ret.return_type, '#dc2626'); return; }
    const [mm, yyyy] = String(ret.period_month || '').split('/').map((n) => parseInt(n, 10));
    if (!mm || !yyyy) { await failFiling(job, 'Bad filing period.', '#dc2626'); return; }
    const fyStart = mm >= 4 ? yyyy : yyyy - 1;
    const fyShort = fyStart + '-' + String((fyStart + 1) % 100).padStart(2, '0');
    const monthName = MONTHS_FULL[mm - 1];
    const q = mm >= 4 ? Math.ceil((mm - 3) / 3) : 4;

    banner('Opening ' + map.label + ' for ' + monthName + ' ' + yyyy + '…' + progress);
    if (!(await selectWhereOption(fyShort))) { await failFiling(job, 'Could not set the financial year on the dashboard.', '#dc2626'); return; }
    await sleep(700);
    await selectWhereOption('Quarter ' + q, { startsWith: true, timeout: 8000 });
    await sleep(700);
    if (!(await selectWhereOption(monthName, { timeout: 12000 }))) { await failFiling(job, 'Could not set the month on the dashboard.', '#dc2626'); return; }
    await sleep(300);
    const search = $('button.srchbtn') || $$('button').find((b) => /^search$/i.test((b.textContent || '').trim()));
    if (!search) { await failFiling(job, 'Could not find the dashboard Search button.', '#dc2626'); return; }
    search.click();

    // Find the return tile's filing button ("Prepare Online" for unfiled returns).
    let btn = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 15000 && !btn) {
      await sleep(400);
      btn = findTileButton(map.re, /prepare\s*online/i, map.excl) || findTileButton(map.re, /prepare|proceed|file\b/i, map.excl);
    }
    if (!btn) {
      await failFiling(job, 'Logged in — but no "Prepare Online" for ' + map.label + ' (already filed, or a different button). You are on the dashboard for ' + monthName + ' — open it yourself.', '#f59e0b');
      return;
    }
    // Back to the foreground for the actual destination — the one page this
    // whole flow exists to reach. Foregrounded right before the click (not
    // after) so the visible transition is the real filing page loading, not
    // a jump-cut from an already-loaded dashboard.
    try { await GSTKdb.focusTab(); } catch (e) { /* non-fatal */ }
    banner('Opening the ' + map.label + ' filing page — review and submit with OTP/DSC yourself.', '#16a34a');
    await clearJob(); // stop acting; a reload here won't re-trigger. The human takes over.
    btn.click();
  }

  // ── GSTR-3B "Push to Portal" mode ───────────────────────────────────────
  // Triggered by the GSTR-3B page's "Push to GST Portal" button. Unlike
  // GSTR-1, GSTR-3B has no offline-JSON upload path — it's a live web form —
  // so this fills the form's Table 3.1 and Table 4 inputs directly with the
  // app's already-computed draft numbers (job.gstr3b.json, same GSTN-schema
  // shape gstr1's assembleGstr1Json produces, built by the app's own
  // buildGstr3bJson()). It deliberately never touches Table 5 (inward exempt/
  // nil/non-GST — the app doesn't compute it, and NEVER clicks Confirm /
  // Offset Liability / File — the human reviews the whole form and submits.
  // Table 4(D)(1) — ITC reclaimed which was reversed under 4(B)(2) in an
  // earlier period — IS computed by the app (auto-linked from this period's
  // reclaim bills, same source as 4(B)(2)(i)) and is now filled from
  // job.gstr3b.json.itc_elg.itc_rclmd (see the app's buildGstr3bJson.ts). It
  // used to be skipped here on the wrong assumption that it was always 0 —
  // that field simply didn't exist in the JSON yet, so there was nothing to
  // read; it does now.
  //
  // Portal flow:
  //   gstr3b_dash   → Returns Dashboard, pick FY + Quarter + Month, Search,
  //                   click GSTR-3B tile's "Prepare Online".
  //   gstr3b_fill31 → On the tile dashboard, open the "3.1 Tax on outward…"
  //                   tile, fill it, Save, then navigate back to the
  //                   dashboard (a real reload — see goBackToGstr3bTiles).
  //   gstr3b_fill4  → Fresh load of the dashboard; open "4. Eligible ITC",
  //                   fill it, Save, report the combined result, done.
  // Split into two steps because returning from a tile's sub-form requires a
  // real navigation, which ends the current script's execution — a single
  // function spanning both tiles would silently never reach the second one.

  // Mirrors failUpload() but reports under the gstr3b_push result key — every
  // early-exit path in handleGstr3bDashboard / handleGstr3bFill31 /
  // handleGstr3bFill4 must go through this (not a bare banner()+clearJob()),
  // otherwise the app's "pushing…" state on the GSTR-3B page has nothing to
  // resolve it and hangs
  // forever waiting for a __gstkPushGstr3bResult that never arrives.
  async function failGstr3b(job, error) {
    banner('GSTR-3B push failed: ' + error, '#dc2626');
    await chrome.storage.local.set({ gstk_gstr3b_push_result: {
      ok: false, summary: error, error, filled: 0, skipped: [], at: Date.now(),
    } });
    await clearJob();
  }

  async function handleGstr3bDashboard(job, cur, progress) {
    if (!/returns\/auth\/dashboard/.test(url)) { location.href = 'https://return.gst.gov.in/returns/auth/dashboard'; return; }
    if (!(await waitFor('select', 20000))) { await failGstr3b(job, 'Returns dashboard did not load.'); return; }
    const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const [mm, yyyy] = String(job.period || '').split('/').map((n) => parseInt(n, 10));
    if (!mm || !yyyy) { await failGstr3b(job, 'Bad period.'); return; }
    const fyStart = mm >= 4 ? yyyy : yyyy - 1;
    const fyShort = fyStart + '-' + String((fyStart + 1) % 100).padStart(2, '0');
    const monthName = MONTHS_FULL[mm - 1];
    const q = mm >= 4 ? Math.ceil((mm - 3) / 3) : 4;

    banner('Opening GSTR-3B for ' + monthName + ' ' + yyyy + '…' + progress);
    if (!(await selectWhereOption(fyShort))) { await failGstr3b(job, 'Could not set the financial year on the dashboard.'); return; }
    await sleep(700);
    await selectWhereOption('Quarter ' + q, { startsWith: true, timeout: 8000 });
    await sleep(700);
    if (!(await selectWhereOption(monthName, { timeout: 12000 }))) { await failGstr3b(job, 'Could not set the month on the dashboard.'); return; }
    await sleep(300);
    const search = $('button.srchbtn') || $$('button').find((b) => /^search$/i.test((b.textContent || '').trim()));
    if (!search) { await failGstr3b(job, 'Could not find the dashboard Search button.'); return; }
    search.click();

    const excl = [/gstr[\s-]*1\b/i, /gstr[\s-]*2/i];
    let btn = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 15000 && !btn) {
      await sleep(400);
      btn = findTileButton(/gstr[\s-]*3b/i, /prepare\s*online/i, excl);
    }
    if (!btn) { await failGstr3b(job, 'No "Prepare Online" for GSTR-3B — already filed, or a different button. Open the GSTR-3B tile yourself.'); return; }

    // Re-entrant: this function runs a SECOND time to reach Table 4, after
    // Table 3.1 is filled and saved. Confirmed live: navigating straight to
    // the GSTR-3B URL (bypassing this dashboard's own FY/Quarter/Month
    // selection + Search) produced the portal's own "Oops! System seems to
    // have encountered an error" page, consistently, even after a retry —
    // the return-period selection is very plausibly server-side session
    // state that only gets set by actually going through this flow, not
    // just landing on the URL. So the second pass re-does the whole real
    // sequence rather than shortcutting to a URL that's proven unreliable.
    const nextStep = (job.gstr3b && job.gstr3b.filled31) ? 'gstr3b_fill4' : 'gstr3b_fill31';
    job.step = nextStep;
    await setJob(job);
    banner('Opening GSTR-3B…');
    btn.click();

    // Same in-place-Angular-navigation pattern as GSTR-1's upload dashboard —
    // wait for the URL to actually move off the dashboard before handing off.
    // Confirmed live: this tile lands on …/returns/auth/gstr3b.
    const navDeadline = Date.now() + 15000;
    while (Date.now() < navDeadline && /returns\/auth\/dashboard/.test(location.href)) {
      await sleep(300);
    }
    if (nextStep === 'gstr3b_fill4') await handleGstr3bFill4(job, cur, progress);
    else await handleGstr3bFill31(job, cur, progress);
  }

  // Shared GSTR-3B fill helpers. Split across TWO job steps (gstr3b_fill31,
  // gstr3b_fill4) because returning from a tile's sub-form to the dashboard
  // requires a REAL navigation (location.href = the known-good dashboard
  // URL — clicking a "Back" button by text match turned out to be unreliable
  // here, see goBackToGstr3bTiles below), and a real navigation destroys the
  // current script's execution context. A single function spanning both
  // tiles would have silently stopped after the first tile's navigate —
  // Table 4 would never even be attempted, and no result would ever be
  // reported. Each step persists its own filled/skipped into job.gstr3b so
  // the SECOND step's final report covers both tiles' outcomes.
  // All hoisted `function` declarations (not `const name = () => {}`) —
  // deliberately, not stylistically: these are called from
  // handleGstr3bDashboard / handleGstr3bFill31 / handleGstr3bFill4, which
  // are themselves invoked from the top-level dispatcher earlier in this
  // file. A `const` arrow function positioned here is in the temporal dead
  // zone at that call time — the outer script's linear execution never
  // reaches this line before the dispatcher's call chain needs it, so
  // referencing it throws "Cannot access before initialization" (confirmed
  // live). Function declarations are hoisted in full regardless of position,
  // same as findTileButton/filingTileFor elsewhere in this file — matching
  // that existing, working pattern instead of introducing a new one.
  function gstr3bNum(v) { return v == null ? null : String(v); }
  // Scoped to VISIBLE rows only. Confirmed live: 3.1(d)'s fill silently
  // landed on the wrong row — most likely Table 4's very similarly-worded
  // "(3) Inward supplies liable to reverse charge…" row, matched instead
  // because this portal toggles sections with ng-show/ng-if (confirmed via
  // data-ng-show="showtiles" seen earlier) rather than removing inactive
  // views from the DOM, and the unscoped search had no way to prefer the
  // genuinely visible row over a hidden one elsewhere on the page.
  function findGstr3bRow(labelRe) { return $$('tr').find((tr) => tr.offsetParent !== null && labelRe.test(tr.textContent || '')); }
  // Confirmed live (screenshot of the actual "4. Eligible ITC" sub-form):
  // rows have FOUR columns — Integrated / Central / State-UT / CESS — and
  // for rows like "Import of goods"/"Import of services" (which never carry
  // CGST/SGST under GST law), the middle two are correctly disabled by the
  // portal. Pre-filtering out disabled inputs before mapping our 3 values
  // (igst/cgst/sgst — we never compute cess) shifted everything: on a row
  // with cols 2-3 disabled, the filtered list became [col1, col4], so
  // values[1] (cgst) landed in the CESS box instead of being skipped. Map by
  // FIXED column index against ALL inputs (not a pre-filtered list) instead,
  // so a locked column is skipped in place rather than shifting the rest.
  async function setGstr3bNumericVal(el, val) {
    // Confirmed live (definitive test: manually set a DIFFERENT value, 99000,
    // then pushed — it stayed at 99000, proving this field was never touched
    // at all). The previous version dispatched keydown/keyup with NO actual
    // key info (no `key`/`keyCode`) — a numeric-only validator checking
    // "is this keypress a real digit?" would see that as invalid and could
    // reject/reset the field, which may be actively working against us here
    // even though it didn't visibly hurt Table 4's simpler fields. Simulate
    // REAL character-by-character typing instead — clear the field, then for
    // each digit dispatch keydown/keypress/input/keyup WITH that digit's
    // actual key data, building the value up incrementally the way a human
    // typing would, which is the closest a content script can get to
    // satisfying a strict per-keystroke numeric validator.
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    const setRaw = (s) => { if (setter) setter.call(el, s); else el.value = s; };
    try { el.focus(); } catch (e) {}
    setRaw('');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    const str = String(val);
    let acc = '';
    for (const ch of str) {
      acc += ch;
      const opts = { bubbles: true, key: ch, code: /\d/.test(ch) ? 'Digit' + ch : undefined, charCode: ch.charCodeAt(0), keyCode: ch.charCodeAt(0), which: ch.charCodeAt(0) };
      el.dispatchEvent(new KeyboardEvent('keydown', opts));
      el.dispatchEvent(new KeyboardEvent('keypress', opts));
      setRaw(acc);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', opts));
      await sleep(60);
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    try { el.blur(); } catch (e) {}
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }
  // Async and paced deliberately. Confirmed live (DevTools): the input
  // carries Angular's own ng-valid/ng-not-empty/ng-dirty classes after our
  // script sets it, meaning the model IS registering the change — but the
  // final saved tile summary still totalled ₹0. AngularJS commits an
  // ng-model change via a synchronous $digest triggered off the input event
  // — firing that across many fields back-to-back with zero gap, then
  // clicking Save immediately after, is a known way to either collide with
  // a digest still in progress or click Save before the last field's digest
  // has actually settled. Give each field, and the Save click after them,
  // real time to land.
  async function fillGstr3bRow(filled, skipped, name, labelRe, values) {
    const row = findGstr3bRow(labelRe);
    if (!row) { skipped.push(name + ' — row not found'); return; }
    const inputs = [...row.querySelectorAll('input')];
    if (!inputs.length) { skipped.push(name + ' — no input elements in the row at all'); return; }
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v == null) continue; // this row has no value for this column — leave it alone
      const el = inputs[i];
      if (!el) { skipped.push(name + ' col ' + (i + 1) + ' — no input at that position'); continue; }
      if (el.disabled || el.readOnly) { skipped.push(name + ' col ' + (i + 1) + ' — portal-locked (e.g. CGST/SGST on an import row)'); continue; }
      await setGstr3bNumericVal(el, v);
      // Confirmed live: this alone still wasn't enough for 3.1(d) — the one
      // row with a "Total Taxable value" column in addition to tax amounts
      // (Table 4's rows are tax-amount-only). A real human keystroke sticks
      // there, so the field is genuinely editable; very likely there's a
      // watcher on taxable value that recalculates/re-validates the tax
      // columns, and 300ms wasn't long enough for that to settle before
      // moving on to the next field. Give it real room.
      await sleep(1500);
      filled.push(name + ' col ' + (i + 1));
    }
  }
  // The "System generated summary" modal covers the tile dashboard on every
  // fresh load of the GSTR-3B dashboard URL (confirmed: it reappeared on the
  // second load too, not just the first) — close it before searching tiles.
  async function closeGstr3bModal() {
    for (let i = 0; i < 3; i++) {
      const closeBtn = $$('button, a, .close, [aria-label="Close" i]').find((x) =>
        x.offsetParent !== null && (/^\s*close\s*$/i.test((x.textContent || '').trim()) || /^close$/i.test(x.getAttribute('aria-label') || ''))
      );
      if (!closeBtn) break;
      try { closeBtn.click(); } catch (e) {}
      await sleep(500);
    }
  }
  // Click a dashboard tile by its heading text. Confirmed live (DevTools
  // breadcrumb): div.col-sm-4.col-xs-12 > a > div.hd > p.inv — the tile is
  // wrapped in a real <a> link, and ".hd" is the specific title-bar class
  // (not a generic Bootstrap grid class like div[class*="col-"], which is
  // too broad — every layout wrapper on this page matches "col-"). Poll for
  // it — same lesson as GSTR-1's "VIEW SUMMARY" button: this Angular portal
  // renders the tile grid asynchronously, and a single synchronous find()
  // right after the modal closes can run straight into that render race.
  async function openGstr3bTile(headingRe) {
    let hd = null;
    const tt0 = Date.now();
    while (Date.now() - tt0 < 10000 && !hd) {
      hd = $$('.hd').find((x) => x.offsetParent !== null && headingRe.test((x.textContent || '').trim().slice(0, 100)));
      if (!hd) await sleep(400);
    }
    if (!hd) return false;
    const tile = hd.closest('a') || hd;
    const before = location.href;
    try { tile.click(); } catch (e) { return false; }
    const t0 = Date.now();
    while (Date.now() - t0 < 8000 && location.href === before) await sleep(300);
    await sleep(1000);
    return location.href !== before;
  }
  async function saveGstr3bIfPresent() {
    // Extra settle time before even looking for Save — on top of the pacing
    // now built into fillGstr3bRow between fields, give the LAST field's
    // digest cycle a moment to fully land before Save reads the model.
    await sleep(500);
    const save = $$('button').find((x) => x.offsetParent !== null && /^\s*(save|confirm)\s*$/i.test((x.textContent || '').trim()));
    // Confirmed live: force-navigating away too soon after Save produced a
    // genuine portal-side "Oops! System seems to have encountered an error"
    // page on the next load — plausibly the save request was still in
    // flight when the hard navigation in goBackToGstr3bTiles cut it off.
    // 1.2s wasn't enough; be generously patient instead of guessing again.
    if (save) { try { save.click(); } catch (e) {} await sleep(3000); }
  }
  // Confirmed live: clicking a tile's own "Confirm" only STAGES that tile's
  // changes locally — it does NOT persist them. Persisting requires a
  // SEPARATE "SAVE GSTR3B" button back on the tile dashboard (the same
  // dashboard page saveGstr3bIfPresent's Confirm click returns to). This was
  // being called only once, at the very end after Table 4 — meaning Table
  // 3.1's staged changes were being discarded the moment
  // goBackToGstr3bTiles hard-navigated all the way out to the OUTER Returns
  // Dashboard without ever persisting them. Must be called after EVERY
  // tile's Confirm, not just the last one.
  async function saveAllGstr3b() {
    const saveAll = $$('button').find((x) => x.offsetParent !== null && /save\s*gstr\s*3b/i.test((x.textContent || '').trim()));
    if (saveAll) { try { saveAll.click(); } catch (e) {} await sleep(1500); }
  }
  // True if the current page is the portal's own generic error page
  // ("Oops! System seems to have encountered an error…") rather than real
  // content — confirmed live as the result of navigating back to the
  // dashboard too soon after a Save. Check for this explicitly so a failure
  // here is reported honestly instead of a misleading "could not open tile".
  function isGstr3bErrorPage() {
    return /system seems to have encountered an error/i.test(document.body.innerText || '');
  }
  // Confirmed live: clicking a "Back" button by text match is NOT reliable
  // here — after saving Table 3.1 it led into an unrelated "Do you want to
  // file Nil return?" wizard step instead of the tile dashboard (a
  // genuinely consequential screen this automation must never wander into).
  // Also confirmed live: jumping straight to the GSTR-3B URL (instead of
  // going through the Returns Dashboard's own FY/Quarter/Month + Search
  // flow) hit the portal's own "Oops!" error page consistently — the period
  // selection is very plausibly server-side session state that only gets
  // set by actually running that flow. So go back to the DASHBOARD and let
  // handleGstr3bDashboard redo the real sequence, not a URL shortcut. This
  // ends the CURRENT script's execution — callers must not run anything
  // after it (setJob must be awaited first, which is why this takes job).
  async function goBackToGstr3bTiles(job) {
    job.step = 'gstr3b_dash';
    await setJob(job);
    location.href = 'https://return.gst.gov.in/returns/auth/dashboard';
  }

  async function handleGstr3bFill31(job, cur, progress) {
    const j = (job.gstr3b && job.gstr3b.json) || {};
    banner('Filling GSTR-3B Table 3.1 from the computed draft…' + progress);
    await sleep(1200);
    await closeGstr3bModal();

    // Confirmed live: unlike GSTR-1's Prepare Offline, GSTR-3B's landing page
    // ("Please click on a box (tile) and enter relevant details therein")
    // shows read-only TILE SUMMARIES for every table — the actual editable
    // per-row form for each table lives one click deeper, behind its own
    // tile. Also confirmed: for a client whose GSTR-1 is Filed, 3.1's fields
    // are portal-locked (source return already filed) — fillGstr3bRow's
    // disabled/readonly filter reports that honestly rather than silently
    // skipping it.
    const filled = [];
    const skipped = [];
    const det = j.sup_details?.osup_det || {};
    const zero = j.sup_details?.osup_zero || {};
    const nilx = j.sup_details?.osup_nil_exmp || {};
    const rev = j.sup_details?.isup_rev || {};
    const nongst = j.sup_details?.osup_nongst || {};
    if (await openGstr3bTile(/3\.1\s+tax on outward/i)) {
      await fillGstr3bRow(filled, skipped, '3.1(a) Outward taxable supplies', /outward taxable supplies\s*\(other than zero rated/i, [gstr3bNum(det.txval), gstr3bNum(det.iamt), gstr3bNum(det.camt), gstr3bNum(det.samt)]);
      await fillGstr3bRow(filled, skipped, '3.1(b) Zero rated', /outward taxable supplies\s*\(zero rated\)/i, [gstr3bNum(zero.txval), gstr3bNum(zero.iamt)]);
      await fillGstr3bRow(filled, skipped, '3.1(c) Nil/exempt', /other outward supplies/i, [gstr3bNum(nilx.txval)]);
      // Confirmed live: the loose wildcard here was ambiguous with Table
      // 4(A)(3)'s near-identical "Inward supplies liable to reverse charge"
      // wording, and the fill silently landed on the wrong (Table 4) row —
      // 3.1(d) stayed at 0 with no error reported. Require the real "(d)"
      // prefix this row actually carries, which 4(A)(3) — labeled "(3)" —
      // can never match.
      await fillGstr3bRow(filled, skipped, '3.1(d) Inward RCM', /\(d\)\s*inward supplies/i, [gstr3bNum(rev.txval), gstr3bNum(rev.iamt), gstr3bNum(rev.camt), gstr3bNum(rev.samt)]);
      await fillGstr3bRow(filled, skipped, '3.1(e) Non-GST outward', /non-gst outward/i, [gstr3bNum(nongst.txval)]);
      await saveGstr3bIfPresent();
      // Confirmed live: without this, 3.1's changes were being discarded —
      // Confirm only stages them, this is what actually persists them,
      // BEFORE goBackToGstr3bTiles hard-navigates away to the outer
      // dashboard below.
      await saveAllGstr3b();
    } else {
      skipped.push('3.1(a)-(e) — could not open the "3.1 Tax on outward…" tile');
    }

    // job.step is set inside goBackToGstr3bTiles (to 'gstr3b_dash', not
    // 'gstr3b_fill4' directly) — the dashboard needs to run again for Table
    // 4, see handleGstr3bDashboard's re-entrant comment.
    job.gstr3b = job.gstr3b || {};
    job.gstr3b.filled31 = filled;
    job.gstr3b.skipped31 = skipped;
    banner(`Table 3.1: filled ${filled.length}, skipped ${skipped.length}. Returning to the dashboard for Table 4…` + progress);
    await goBackToGstr3bTiles(job);
  }

  async function handleGstr3bFill4(job, cur, progress) {
    const j = (job.gstr3b && job.gstr3b.json) || {};
    banner('Filling GSTR-3B Table 4 from the computed draft…' + progress);
    await sleep(1200);

    // Defensive only — we now arrive here via the real Dashboard → Search →
    // click-tile flow (handleGstr3bDashboard is re-entrant, see its
    // comment), the same flow that's worked reliably every time, not a URL
    // shortcut. If the portal's error page still shows up here, don't retry
    // with a direct URL nav — that's the exact approach already proven
    // unreliable. Just fail cleanly.
    if (isGstr3bErrorPage()) {
      await failGstr3b(job, 'Table 3.1 was filled and saved, but the portal returned its own error page ("System seems to have encountered an error") when reaching Table 4. Table 3.1\'s Save should still have gone through — check it on the portal, then push again to pick up Table 4, or fill it manually.');
      return;
    }
    await closeGstr3bModal();

    const filled = [];
    const skipped = [];
    const avl = (ty) => (j.itc_elg?.itc_avl || []).find((r) => r.ty === ty) || {};
    const rvs = (ty) => (j.itc_elg?.itc_rev || []).find((r) => r.ty === ty) || {};
    const rclmd = (ty) => (j.itc_elg?.itc_rclmd || []).find((r) => r.ty === ty) || {};
    const inelg = (ty) => (j.itc_elg?.itc_inelg || []).find((r) => r.ty === ty) || {};
    if (await openGstr3bTile(/4\.\s*eligible itc/i)) {
      await fillGstr3bRow(filled, skipped, '4A(1) Import of goods', /import of goods/i, [gstr3bNum(avl('IMPG').igst), gstr3bNum(avl('IMPG').cgst), gstr3bNum(avl('IMPG').sgst)]);
      await fillGstr3bRow(filled, skipped, '4A(2) Import of services', /import of services/i, [gstr3bNum(avl('IMPS').igst), gstr3bNum(avl('IMPS').cgst), gstr3bNum(avl('IMPS').sgst)]);
      await fillGstr3bRow(filled, skipped, '4A(3) Inward RCM ITC', /inward supplies liable to reverse charge/i, [gstr3bNum(avl('ISRC').igst), gstr3bNum(avl('ISRC').cgst), gstr3bNum(avl('ISRC').sgst)]);
      await fillGstr3bRow(filled, skipped, '4A(4) ISD', /inward supplies from isd/i, [gstr3bNum(avl('ISD').igst), gstr3bNum(avl('ISD').cgst), gstr3bNum(avl('ISD').sgst)]);
      await fillGstr3bRow(filled, skipped, '4A(5) All other ITC', /all other itc/i, [gstr3bNum(avl('OTH').igst), gstr3bNum(avl('OTH').cgst), gstr3bNum(avl('OTH').sgst)]);
      await fillGstr3bRow(filled, skipped, '4B(1) Reversed — rules 38/42/43 & 17(5)', /as per rules?\s*38[\s\S]{0,30}42[\s\S]{0,30}43/i, [gstr3bNum(rvs('RUL').igst), gstr3bNum(rvs('RUL').cgst), gstr3bNum(rvs('RUL').sgst)]);
      await fillGstr3bRow(filled, skipped, '4B(2) Reversed — others', /\(2\)\s*others/i, [gstr3bNum(rvs('OTH').igst), gstr3bNum(rvs('OTH').cgst), gstr3bNum(rvs('OTH').sgst)]);
      // 4D(1) — reclaim of ITC reversed under 4(B)(2) in an earlier period.
      // Computed by the app (job.itc_elg.itc_rclmd, see buildGstr3bJson.ts) —
      // was skipped here before that field existed; not the case anymore.
      await fillGstr3bRow(filled, skipped, '4D(1) ITC reclaimed — reversed under 4(B)(2)', /itc reclaimed which was reversed under table 4\(b\)\(2\)/i, [gstr3bNum(rclmd('OTH').igst), gstr3bNum(rclmd('OTH').cgst), gstr3bNum(rclmd('OTH').sgst)]);
      await fillGstr3bRow(filled, skipped, '4D(2) Ineligible — 16(4) & PoS', /ineligible itc under section 16\(4\)|itc restricted due to (pos|place of supply)/i, [gstr3bNum(inelg('OTH').igst), gstr3bNum(inelg('OTH').cgst), gstr3bNum(inelg('OTH').sgst)]);
      await saveGstr3bIfPresent();
    } else {
      skipped.push('Table 4 — could not open the "4. Eligible ITC" tile');
    }

    await saveAllGstr3b();

    const allFilled = [...(job.gstr3b?.filled31 || []), ...filled];
    const allSkipped = [...(job.gstr3b?.skipped31 || []), ...skipped];
    const resultSummary =
      `Filled ${allFilled.length} field(s).` +
      (allSkipped.length ? ` Could not set ${allSkipped.length}: ${allSkipped.slice(0, 6).join('; ')}${allSkipped.length > 6 ? '…' : ''}.` : '') +
      ' Table 5 was left untouched by design (not computed by the app) — review that (and everything else, including both tiles\' Save) before Confirm / Offset Liability / File.';
    banner(resultSummary, allSkipped.length ? '#f59e0b' : '#16a34a');

    await chrome.storage.local.set({ gstk_gstr3b_push_result: {
      ok: true, summary: resultSummary, filled: allFilled.length, skipped: allSkipped, at: Date.now(),
    } });
    await clearJob(); // stop acting — the human reviews and files.
  }

  // ── GSTR-1 Upload mode ──────────────────────────────────────────────────
  // Triggered by the GSTR-1 "Upload to GST Portal" button. Filing / signing
  // stays manual by design; this mode only populates the return draft on the
  // portal and captures any per-invoice validation errors so the operator can
  // fix them in the source books.
  //
  // Portal flow (short):
  //   gstr1_dash   → Returns Dashboard, pick FY + Quarter + Month, Search,
  //                  click GSTR-1 tile's "Prepare Online".
  //   gstr1_prep   → On the GSTR-1 preparation page, find the JSON file input
  //                  (may live under a top-right "Upload" / "Import Excel/JSON"
  //                  toolbar action) and inject the stored JSON as a File.
  //   gstr1_wait   → Poll for "Processed" / "Processed with Errors" / "Failed"
  //                  after the portal queues the upload for processing.
  //   gstr1_result → Read the counts, download the Error Report JSON if any,
  //                  write the outcome to Supabase, broadcast to the app.
  //
  // Selectors here are best-effort against a moving target; refine when the
  // portal changes them. Errors are surfaced back to the app so nothing fails
  // silently.

  // Build a File object from the stored raw JSON so we can dispatch it to the
  // portal's file input the same way a real drag/drop or picker would.
  function buildGstr1File(job) {
    const name = 'GSTR1_' + (job.clients[job.idx].creds.gstin || 'client') + '_' + (job.gstr1.periodShort || 'period') + '.json';
    const blob = new Blob([JSON.stringify(job.gstr1.json)], { type: 'application/json' });
    return new File([blob], name, { type: 'application/json' });
  }

  // Set a file input's `files` via DataTransfer and fire the `change` event —
  // Chrome's supported way to script an <input type="file"> from a content
  // script without a user gesture.
  function setFileOn(input, file) {
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    } catch (e) {
      return false;
    }
  }

  async function handleGstr1UploadDashboard(job, cur, progress) {
    if (!/returns\/auth\/dashboard/.test(url)) { location.href = 'https://return.gst.gov.in/returns/auth/dashboard'; return; }
    if (!(await waitFor('select', 20000))) { await failUpload(job, 'Dashboard did not load'); return; }
    const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const [mm, yyyy] = String(job.period || '').split('/').map((n) => parseInt(n, 10));
    if (!mm || !yyyy) { await failUpload(job, 'Bad period'); return; }
    const fyStart = mm >= 4 ? yyyy : yyyy - 1;
    const fyShort = fyStart + '-' + String((fyStart + 1) % 100).padStart(2, '0');
    const monthName = MONTHS_FULL[mm - 1];
    const q = mm >= 4 ? Math.ceil((mm - 3) / 3) : 4;

    banner('Selecting ' + monthName + ' ' + yyyy + ' on the dashboard…' + progress);
    if (!(await selectWhereOption(fyShort))) { await failUpload(job, 'Could not set financial year'); return; }
    await sleep(700);
    await selectWhereOption('Quarter ' + q, { startsWith: true, timeout: 8000 });
    await sleep(700);
    if (!(await selectWhereOption(monthName, { timeout: 12000 }))) { await failUpload(job, 'Could not set month'); return; }
    await sleep(300);
    const search = $('button.srchbtn') || $$('button').find((b) => /^search$/i.test((b.textContent || '').trim()));
    if (!search) { await failUpload(job, 'Search button missing'); return; }
    search.click();

    // JSON upload lives on the "Prepare Offline" path (or a plain "Upload"
    // button on some tenants). "Prepare Online" opens the manual-entry tiles
    // interface, which has NO file input — clicking it lands the operator on
    // the wrong page. Try Offline / Upload first; only fall back to Online if
    // neither exists (some very old tenants still bundle upload inside it).
    const excludeOthers = [/gstr[\s-]*1a/i, /gstr[\s-]*2/i, /gstr[\s-]*3/i, /gstr[\s-]*6/i, /gstr[\s-]*7/i];
    let btn = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 15000 && !btn) {
      await sleep(400);
      btn = findTileButton(/gstr[\s-]*1\b/i, /prepare\s*offline/i, excludeOthers)
         || findTileButton(/gstr[\s-]*1\b/i, /^upload$/i, excludeOthers)
         || findTileButton(/gstr[\s-]*1\b/i, /prepare\s*online/i, excludeOthers);
    }
    if (!btn) { await failUpload(job, 'GSTR-1 "Prepare Offline" / "Upload" button not found — return may already be filed or the tile changed'); return; }
    banner('Opening GSTR-1 offline upload page…');
    job.step = 'gstr1_upload';
    await setJob(job);
    btn.click();

    // The portal is an AngularJS SPA, so clicking Prepare Offline changes the
    // route in place — the content script does NOT re-run and the dispatcher
    // never gets a second chance to hit handleGstr1Upload. Wait for the SPA to
    // navigate to the upload page, then continue in this same execution
    // context. If a full reload happens instead (rare), setJob above means the
    // next dispatch on the new page also reaches handleGstr1Upload.
    const navDeadline = Date.now() + 15000;
    while (Date.now() < navDeadline && !/offlineupload/i.test(location.href)) {
      await sleep(300);
    }
    if (!/offlineupload/i.test(location.href)) {
      await failUpload(job, 'Clicked "Prepare Offline" but the upload page did not open');
      return;
    }
    if (job.mode === 'gstr1_refresh') {
      await handleGstr1RefreshErrors(job, cur, progress);
    } else {
      await handleGstr1Upload(job, cur, progress);
    }
  }

  // "Refresh errors" mode. Same portal page as Upload, but instead of sending
  // a JSON we go to the Download tab and read the (by now hopefully-ready)
  // per-invoice Error Report. GSTN generates it asynchronously up to 20 min
  // after the original "Processed with Error" upload — this handler is what
  // the operator clicks when they come back to check.
  async function handleGstr1RefreshErrors(job, cur, progress) {
    banner('Checking the portal for the error report…' + progress);
    // Click the Download tab (adjacent to Upload). Both tabs live on the same
    // /offlineupload route in an AngularJS SPA — no navigation, just tab
    // switch — so we don't need to wait for a URL change.
    const downloadTab = $$('a, button, li, span').find((el) => {
      const t = (el.textContent || '').trim();
      return /^download$/i.test(t) && el.offsetParent !== null;
    });
    if (downloadTab) { try { downloadTab.click(); } catch (e) {} }
    await sleep(1500);

    // The Download tab shows a list of previously-generated error reports for
    // this return period, with columns like Date / Reference id / Type /
    // Status / Download link. Look for a row whose Status looks ready
    // ("Generated"/"Ready") and grab the link.
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    let downloadUrl = null;
    let statusText = '';
    const rows = $$('table tr').filter((r) => r.querySelector('td'));
    for (const row of rows) {
      const cells = [...row.querySelectorAll('td')].map((td) => norm(td.textContent));
      const st = cells.find((c) => /generated|ready|error|in\s*progress|processed|available/i.test(c));
      const link = row.querySelector('a[href], button');
      if (st && link && !/in\s*progress|generating|pending|requested/i.test(st)) {
        statusText = st;
        downloadUrl = link.getAttribute('href') || '';
        break;
      }
    }

    if (!downloadUrl) {
      // No ready report yet — surface a specific message so the operator
      // knows to come back in a few more minutes.
      const summary = 'No error report is ready on the portal yet. GSTN can take up to 20 minutes to generate it after an upload. Try Refresh again in a few minutes.';
      banner(summary, '#f59e0b');
      try {
        chrome.runtime.sendMessage({ gstk: true, fn: 'saveGstr1UploadResult', args: [{
          rowId: job.gstr1.rowId, status: 'partial', summary, errors: null, actorId: job.actorId, actionType: 'REFRESH_ERRORS',
        }] });
      } catch (e) {}
      await chrome.storage.local.set({ gstk_gstr1_upload_result: {
        ok: false, status: 'partial', summary, errors: [], at: Date.now(),
      } });
      await clearJob();
      return;
    }

    // Try to fetch the error-report JSON directly using the logged-in session.
    // host_permissions covers *.gst.gov.in so credentials go along.
    let errors = [];
    try {
      const fullUrl = downloadUrl.startsWith('http') ? downloadUrl : (location.origin + downloadUrl);
      const resp = await fetch(fullUrl, { credentials: 'include' });
      const txt = await resp.text();
      // The error report is JSON; be defensive about wrappers.
      let obj = null;
      try { obj = JSON.parse(txt); } catch (e) { /* not JSON, fall through to click */ }
      if (obj) errors = extractErrorsFromReport(obj);
    } catch (e) { /* fall through to click-based download */ }

    if (!errors.length) {
      // Fallback: click the link and let chrome.downloads capture — same
      // mechanism already used for GSTR-2B. We can't await the download
      // result here, so just report best-effort.
      const link = rows.map((r) => r.querySelector('a[href], button')).find(Boolean);
      if (link) { try { link.click(); } catch (e) {} }
    }

    const summary = errors.length
      ? `Fetched ${errors.length} per-invoice validation error(s) from the portal error report.`
      : 'Error report link found on the portal but no per-invoice rows could be parsed. Download it manually from the Download tab.';
    banner(summary, errors.length ? '#dc2626' : '#f59e0b');

    try {
      chrome.runtime.sendMessage({ gstk: true, fn: 'saveGstr1UploadResult', args: [{
        rowId: job.gstr1.rowId, status: 'partial', summary, errors, actorId: job.actorId, actionType: 'REFRESH_ERRORS',
      }] });
    } catch (e) {}
    await chrome.storage.local.set({ gstk_gstr1_upload_result: {
      ok: false, status: 'partial', summary, errors, at: Date.now(),
    } });
    await clearJob();
  }

  // GSTN's actual error-report JSON shape (verified against a real download):
  //   {
  //     form_typ: "R1", fp: "072026", gstin: "...",
  //     error_report: {
  //       b2b: [ { ctin, error_cd, error_msg, inv: [ { inum, idt, val, ... } ] }, ... ],
  //       b2cl: [...], cdnr: [...], cdnur: [...], ...
  //     }
  //   }
  // error_msg + error_cd live at the PARTY level; the party's inv[] lists
  // every invoice affected by that error. One party-level error → one output
  // row per affected invoice, all sharing the same reason string.
  function extractErrorsFromReport(obj) {
    const out = [];
    const root = obj && obj.error_report ? obj.error_report : obj;
    if (!root || typeof root !== 'object') return out;

    const pushInvoice = (inv, reason, partyGstin) => {
      const invoiceNo = String(inv?.inum || inv?.nt_num || inv?.doc_num || '');
      if (!invoiceNo) return;
      out.push({ invoiceNo, gstin: partyGstin || '', reason });
    };

    for (const sectionKey of Object.keys(root)) {
      const section = root[sectionKey];
      if (!Array.isArray(section)) continue;
      for (const party of section) {
        const partyGstin = party?.ctin || party?.gstin || '';
        const errMsgRaw = party?.error_msg || party?.err_msg || party?.error || party?.errors;
        const errCd = party?.error_cd ? ' [' + party.error_cd + ']' : '';
        const partyReason = errMsgRaw
          ? (Array.isArray(errMsgRaw) ? errMsgRaw.join('; ') : String(errMsgRaw)) + errCd
          : '';

        // Party has an inv[] or nt[] (notes) array — attribute the party
        // reason to each entry.
        const list = Array.isArray(party?.inv) ? party.inv
                   : Array.isArray(party?.nt) ? party.nt
                   : [];
        if (list.length && partyReason) {
          for (const inv of list) pushInvoice(inv, partyReason, partyGstin);
          continue;
        }

        // Some sections (b2cs, hsn, at, nil, doc_issue) don't have inv[] —
        // they carry a per-row error directly. Include as a single row.
        if (partyReason) {
          out.push({
            invoiceNo: `[${sectionKey}] ${party?.pos ? 'POS ' + party.pos : ''}`.trim(),
            gstin: partyGstin,
            reason: partyReason,
          });
        }
      }
    }
    return out;
  }

  // The upload page. This handler runs to completion (attaches the file,
  // waits for the portal to finish processing, reads the result, reports back)
  // without another page navigation, so we can poll inside it with sleep().
  async function handleGstr1Upload(job, cur, progress) {
    // handleGstr1UploadDashboard marks job.step = 'gstr1_upload' and persists
    // it BEFORE confirming the tile click it just fired actually landed on
    // the offline-upload page — it can't do that check first because the
    // click itself causes the navigation. When that click hits the wrong
    // element (confirmed live: it landed on GSTR-2B's download page instead
    // of GSTR-1's offline-upload page — the two share the gst.gov.in domain
    // family, so the tile-matching regex picked the wrong tile/button), the
    // cross-origin navigation kills the dashboard script's own verification
    // loop before it can catch the mistake, and a fresh script starts on the
    // wrong page already believing it's on the right one. Verify the URL
    // here too, and self-correct by going back to the dashboard to retry
    // rather than searching for a file input on whatever page this is.
    // MUST read location.href live here, not the frozen `url` const (captured
    // once at script injection, line ~15) — handleGstr1UploadDashboard calls
    // this function via a plain await in the SAME script execution, straight
    // after an in-place Angular SPA route change (no fresh page load, so no
    // fresh script injection, so `url` never updates). Checking the stale
    // `url` here made this guard see "not on offlineupload yet" on literally
    // every real invocation — even ones that had already landed correctly —
    // which is what was actually causing "kept landing on the wrong page"
    // even when the live URL shown in that same failure message was right.
    if (!/return\.gst\.gov\.in/i.test(location.href) || !/offlineupload/i.test(location.href)) {
      job.wrongPageRetries = (job.wrongPageRetries || 0) + 1;
      if (job.wrongPageRetries > 3) {
        await failUpload(job, `Kept landing on the wrong page instead of the GSTR-1 offline-upload page (currently: ${location.hostname}${location.pathname}). The dashboard tile click is picking the wrong element — needs a look at the actual dashboard markup.`);
        return;
      }
      job.step = 'gstr1_dash';
      await setJob(job);
      banner('Landed on the wrong page — retrying from the dashboard…' + progress, '#f59e0b');
      location.href = 'https://return.gst.gov.in/returns/auth/dashboard';
      return;
    }
    banner('Looking for the JSON upload control…' + progress);

    // The Prepare Offline page has tabs like "Upload" / "Initiate Filing" /
    // "Generate Summary" / "Download Error Report". The file input lives under
    // "Upload". Click it explicitly if we can find it — some tenants land on a
    // different default tab.
    for (let i = 0; i < 3; i++) {
      const uploadTab = $$('a, button, li, span').find((el) => {
        const t = (el.textContent || '').trim();
        return /^upload$/i.test(t) && el.offsetParent !== null;
      });
      if (uploadTab) { try { uploadTab.click(); } catch (e) {} await sleep(500); }
      if ($('input[type=file]')) break;
      await sleep(600);
    }

    let fileInput = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 25000 && !fileInput) {
      await sleep(500);
      // Prefer inputs that explicitly accept .json or all files. Some portal
      // pages have both an Excel and a JSON input in the DOM at once.
      const inputs = $$('input[type=file]');
      fileInput = inputs.find((el) => {
        const acc = (el.accept || '').toLowerCase();
        return !acc || /json/.test(acc) || /\*/.test(acc);
      }) || inputs[0];
      if (!fileInput) {
        // Not visible yet — try any "Upload" / "Import" / "Choose File" action.
        const upBtn = $$('button, a, label').find((el) => /^(upload|import\s*(excel|json)?|choose\s*file|select\s*file)$/i.test((el.textContent || '').trim()));
        if (upBtn) { try { upBtn.click(); } catch (e) {} }
      }
    }
    if (!fileInput) { await failUpload(job, 'JSON upload input not found on the GSTR-1 offline page. If you see an "Upload" tab, click it once and re-run.'); return; }

    // Normalize whitespace — portal often wraps "Error Occurred" onto two
    // lines inside a narrow Status column, which comes back with a newline.
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    // Angular Material often renders the same message twice in one cell (a
    // visible label plus a hidden tooltip/ARIA-live copy) — .textContent
    // picks up both, giving "message message" (or x3). Collapse an exact
    // whitespace-separated repeat back to a single copy.
    const dedupeRepeated = (s) => {
      const t = norm(s);
      const m = t.match(/^(.{6,}?)(?: \1)+$/);
      return m ? m[1] : t;
    };
    const rowKey = (row) => row ? [...row.querySelectorAll('td')].map((td) => norm(td.textContent)).join('|') : '';
    // Snapshot the Upload History table's current top row BEFORE this file is
    // attached. The poll loop below waits for that key to change — otherwise,
    // if the portal hasn't rendered the new row yet at the first poll tick,
    // rows[0] would still be an OLDER, already-terminal row (e.g. "Processed
    // with Error" from a prior attempt) and get misreported as THIS upload's
    // result.
    const prevTopRowKey = rowKey($$('table tr').filter((r) => r.querySelector('td'))[0]);

    const file = buildGstr1File(job);
    if (!setFileOn(fileInput, file)) { await failUpload(job, 'Could not attach the JSON to the portal file input'); return; }
    banner('Uploading the GSTR-1 JSON…', '#2563eb');

    // Some portal pages want an explicit "Upload" / "Proceed" click AFTER the
    // file is attached. Fire it if we can find one — harmless otherwise.
    await sleep(500);
    const proceedBtn = $$('button').find((b) => /^(upload|proceed|initiate\s+file|submit)$/i.test((b.textContent || '').trim()));
    if (proceedBtn) proceedBtn.click();

    // Immediate synchronous rejection: red toast / error banner on the same page.
    await sleep(1200);
    const errBanner = $$('.alert-danger, .toast-error, .error-msg')
      .map((el) => (el.textContent || '').trim()).filter(Boolean)[0];
    if (errBanner && /invalid|reject|error/i.test(errBanner)) {
      await failUpload(job, errBanner);
      return;
    }

    banner('Waiting for the portal to process the upload…');
    // Poll for one of the terminal states in the Upload History table on the
    // Offline Upload page. Each attempt appears as a row with a Status column
    // — "Error Occurred", "Processed", "Processed with Error", or "In
    // Progress"/"Pending" (transient). If the table isn't present yet, fall
    // back to body-text pattern matching (some flows land on a different
    // response page). Also scrape the row's Error Report cell so the app can
    // show the portal's own reason string verbatim.
    // Confirmed live (Sarkhej Motor Transport, 47 invoices): 2 consecutive
    // timeouts at the old 3-min cap before a 3rd attempt got a real terminal
    // status ~13-19 min after the first was started. Schema-level rejection
    // is still effectively instant, but per-invoice validation on a
    // real-sized file genuinely runs longer than 3 min sometimes — GSTN's
    // own note says up to 15 min. Widened to 6 min as a middle ground: cuts
    // spurious timeouts on moderate files without holding the tab the full
    // 15 — a return that's still slower than that falls back to "Refresh
    // errors" (fetched later, doesn't need the tab held open at all).
    const pollDeadline = Date.now() + 6 * 60 * 1000;
    let terminal = null;
    let portalReason = '';
    const classifyStatus = (raw) => {
      const s = (raw || '').toLowerCase();
      if (/error\s*occurred/.test(s)) return 'failed';
      if (/processed\s+with\s+error/.test(s)) return 'partial';
      if (/^processed$/.test(s.trim()) || /processed(?!\s+with)/.test(s)) return 'accepted';
      if (/\bfailed\b/.test(s)) return 'failed';
      if (/in\s*progress|pending|received/.test(s)) return null; // keep polling
      return null;
    };
    while (Date.now() < pollDeadline && !terminal) {
      // Only ever look at the CURRENT top row of the Upload History table,
      // and only once it differs from the pre-upload snapshot. Scanning every
      // row for the first status match (the old approach) meant that once the
      // real new row was in place but still "In-Progress" (correctly
      // non-terminal), the loop fell through to the NEXT row down — an OLDER,
      // already-resolved attempt from a prior upload — and reported ITS
      // status/reason as this attempt's result. Confirmed against a live
      // upload: the portal showed the new row as "In-Progress" while our
      // extension reported "partial" with a stale prior attempt's text.
      const rows = $$('table tr').filter((r) => r.querySelector('td'));
      const topRow = rows[0];
      const topKey = rowKey(topRow);
      if (topRow && topKey !== prevTopRowKey) {
        const cells = [...topRow.querySelectorAll('td')].map((td) => norm(td.textContent));
        const statusCell = cells.find((c) => /error\s*occurred|processed|failed|in\s*progress|pending|received/i.test(c));
        if (statusCell) {
          const t = classifyStatus(statusCell);
          if (t) {
            terminal = t;
            // Error Report cell is usually the last non-empty cell after the status.
            portalReason = cells[cells.length - 1] && cells[cells.length - 1] !== statusCell
              ? dedupeRepeated(cells[cells.length - 1])
              : '';
          }
        }
      }
      // Fallback text scan — ONLY when there's no Upload History table at all
      // (some flows land on a different response page). This must not run
      // just because the row-based check above hasn't found a NEW row yet:
      // scanning document.body.innerText is unscoped to any particular row,
      // and this page always has several OLDER "Processed with Error" rows
      // sitting in the table — so with the table present, this fallback was
      // matching on stale historical text and declaring "partial" on the
      // very first poll tick, before the real new row (which turned out to
      // be plain "Processed" — fully accepted) had even rendered yet.
      if (!terminal && rows.length === 0) {
        const text = norm(document.body.innerText);
        if (/processed\s+with\s+error/i.test(text)) terminal = 'partial';
        else if (/\berror\s*occurred\b/i.test(text)) terminal = 'failed';
        else if (/file\s+could\s+not\s+be\s+uploaded/i.test(text)) terminal = 'failed';
        else if (/\bfailed\b/i.test(text) && !/processed/i.test(text)) terminal = 'failed';
        else if (/\bprocessed\b/i.test(text) && !/validation\s+process/i.test(text)) terminal = 'accepted';
      }
      if (!terminal) await sleep(3000);
    }
    if (!terminal) { await failUpload(job, 'Timed out waiting for the portal to finish processing (6 min). Check the Upload History on the portal manually, or click "Refresh errors" once it shows a result.'); return; }

    // Try to lift a summary count out of the page ("Total records: X | Errored: Y").
    const bodyText = document.body.innerText || '';
    const totalMatch = bodyText.match(/total\s+records?\s*[:\-]?\s*(\d+)/i);
    const errMatch = bodyText.match(/(?:errored|error\s+records?|failed\s+records?)\s*[:\-]?\s*(\d+)/i);
    const total = totalMatch ? parseInt(totalMatch[1], 10) : null;
    const errored = errMatch ? parseInt(errMatch[1], 10) : (terminal === 'accepted' ? 0 : null);

    // Capture per-invoice errors when the portal exposes them.
    //
    // Neither terminal state has a genuine per-invoice error table available
    // inline on this page. 'failed' (schema-level "Error Occurred") rejects
    // the whole file with a single reason string in the Error Report cell —
    // there is no per-invoice breakdown to show. 'partial' (Processed with
    // Error) DOES eventually get one, but only via the portal's async error
    // report (generated after the fact, fetched by handleGstr1RefreshErrors
    // from the Download tab's actual error-report JSON) — not anything
    // present on the upload page right after the file lands.
    //
    // We used to blindly scrape $$('table tr') here for both states, which
    // — since no real per-invoice table exists yet — kept re-reading the
    // Upload History table itself: its Date column as "invoice number", its
    // Status/Error-Report column (sometimes just an action link like
    // "Generate error report" or "Download error report", sometimes the
    // literal text "NA") as "reason". Confirmed against two real uploads
    // (Vishvas Polypack, State Examination Board - NO ITC): every row it
    // produced was one of those UI artifacts, not a GSTN validation message.
    // Report just the single deduped portalReason instead — real per-invoice
    // detail comes from "Refresh errors", which reads the portal's actual
    // error-report JSON via extractErrorsFromReport().
    //
    // Confirmed AGAIN live (Sarkhej Motor Transport): even that single
    // portalReason isn't always a real message — for a fresh 'partial' row,
    // the last cell (the "Error Report" column) is frequently just the
    // ACTION LINK'S OWN LABEL, "Generate error report" or "Download error
    // report" — the real report hasn't been generated yet at the moment we
    // read it. Reporting that label as if it were the portal's reason is
    // exactly the same class of bug as the earlier table-scrape one, just
    // one level more subtle. Treat those labels as "no real reason yet"
    // (same as reportPending below), not a genuine error entry.
    const isActionLinkLabel = /^(generate|download)\s+error\s+report$/i.test((portalReason || '').trim());
    const errors = (portalReason && !isActionLinkLabel) ? [{ invoiceNo: '', gstin: '', reason: portalReason }] : [];

    // The portal's "File could not be uploaded! Download the latest offline
    // tool…" is a catch-all message it uses for at least three distinct causes.
    // Surface a useful hint in the app's summary line so the operator doesn't
    // chase the (misleading) "download offline tool" instruction.
    const looksGeneric = /file\s+could\s+not\s+be\s+uploaded.*offline\s+tool/i.test(portalReason || '');
    const genericHint = looksGeneric
      ? ' (usually means: the return for this period is already filed on the portal, or the return period selected on the dashboard doesn\'t match the JSON\'s fp. Less commonly: the JSON schema is outdated.)'
      : '';
    // "Processed with Error" flows through Error Report generation, which the
    // portal does asynchronously (its own note says up to 20 min). We can't
    // hold the tab that long — report the deferral clearly instead of the
    // vague "Review the error list" that leaves the operator wondering where.
    const reportPending = isActionLinkLabel || /error\s+report\s+generation\s+requested|request\s+for\s+error\s+report\s+has\s+been\s+acknowledged/i
      .test(portalReason || norm(bodyText));
    const summary =
      terminal === 'accepted'
        ? `Uploaded${total != null ? ' ' + total : ''} record(s) — all accepted.`
        : terminal === 'partial'
          ? (reportPending
              ? `Uploaded — some records failed portal validation. GSTN is generating the detailed error report (may take up to 20 min). Come back later and click "Refresh errors" to view per-invoice reasons.`
              : `Uploaded${total != null ? ' ' + total : ''} record(s) — ${errored != null ? errored : 'some'} rejected. Review the error list.`)
          : `Portal rejected the upload${portalReason ? ': ' + portalReason.slice(0, 300) : '.'}${genericHint}`;

    banner(summary, terminal === 'accepted' ? '#16a34a' : '#dc2626');

    // Persist to Supabase, then post the result back to the app for its dialog.
    try {
      chrome.runtime.sendMessage({ gstk: true, fn: 'saveGstr1UploadResult', args: [{
        rowId: job.gstr1.rowId, status: terminal, summary, errors, actorId: job.actorId,
      }] });
    } catch (e) { /* the app still hears the message below */ }

    await chrome.storage.local.set({ gstk_gstr1_upload_result: {
      ok: terminal !== 'failed', status: terminal, summary, errors, at: Date.now(),
    } });
    await clearJob();
  }

  // Common failure exit: broadcast a structured error back to the app so the
  // UI doesn't sit spinning forever, then clear the job.
  async function failUpload(job, error) {
    banner('Upload failed: ' + error, '#dc2626');
    try {
      if (job && job.gstr1 && job.gstr1.rowId) {
        chrome.runtime.sendMessage({ gstk: true, fn: 'saveGstr1UploadResult', args: [{
          rowId: job.gstr1.rowId, status: 'failed', summary: error, errors: null, actorId: job.actorId,
        }] });
      }
    } catch (e) { /* ignore */ }
    await chrome.storage.local.set({ gstk_gstr1_upload_result: {
      ok: false, status: 'failed', summary: error, error, errors: [], at: Date.now(),
    } });
    await clearJob();
  }

  // "Pull GSTR-2B" mode — triggered by the app's Import 2B "Pull from portal"
  // button. On the Returns Dashboard: pick FY + quarter + month, Search, then
  // click the GSTR-2B tile's Download (which navigates to the GSTR-2B download
  // page). The actual file is captured on the next page (handleTwobDownload).
  async function handleTwob(job, cur, progress) {
    if (!/returns\/auth\/dashboard/.test(url)) { location.href = 'https://return.gst.gov.in/returns/auth/dashboard'; return; }
    if (!(await waitFor('select', 20000))) { banner('Returns dashboard did not load.', '#dc2626'); await clearJob(); return; }
    const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const [mm, yyyy] = String(job.period || '').split('/').map((n) => parseInt(n, 10));
    if (!mm || !yyyy) { banner('Bad 2B period.', '#dc2626'); await clearJob(); return; }
    const fyStart = mm >= 4 ? yyyy : yyyy - 1;
    const fyShort = fyStart + '-' + String((fyStart + 1) % 100).padStart(2, '0');
    const monthName = MONTHS_FULL[mm - 1];
    const q = mm >= 4 ? Math.ceil((mm - 3) / 3) : 4; // FY quarters: Q1 Apr-Jun … Q4 Jan-Mar

    banner('Selecting ' + monthName + ' ' + yyyy + ' on the dashboard…' + progress);
    if (!(await selectWhereOption(fyShort))) { banner('Could not set the financial year on the dashboard.', '#dc2626'); await clearJob(); return; }
    await sleep(700);
    await selectWhereOption('Quarter ' + q, { startsWith: true, timeout: 8000 });
    await sleep(700); // quarter cascades the month options
    if (!(await selectWhereOption(monthName, { timeout: 12000 }))) { banner('Could not set the month on the dashboard.', '#dc2626'); await clearJob(); return; }
    await sleep(300);
    const search = $('button.srchbtn') || $$('button').find((b) => /^search$/i.test((b.textContent || '').trim()));
    if (!search) { banner('Could not find the dashboard Search button.', '#dc2626'); await clearJob(); return; }
    search.click();

    // Wait for the tiles to render, then find the GSTR-2B tile's OWN Download
    // button (never a wrapper's — that was clicking GSTR-1 by mistake). The
    // excludes reject any element that also names another return (= a wrapper).
    let dlBtn = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 15000 && !dlBtn) {
      await sleep(400);
      dlBtn = findTileButton(/gstr[\s-]*2b/i, /^download$/i, [/gstr[\s-]*1\b/i, /gstr[\s-]*2a/i, /gstr[\s-]*3b/i]);
    }
    if (!dlBtn) { banner('Could not find the GSTR-2B tile / Download after Search — is GSTR-2B generated for ' + monthName + ' ' + yyyy + '?', '#dc2626'); await clearJob(); return; }
    job.step = 'twobdwld';
    await setJob(job);
    banner('Opening the GSTR-2B download page…' + progress);
    dlBtn.click();
    // Navigates to gstr2b.gst.gov.in/gstr2b/auth/gstr2bdwld — handled on next load.
  }

  // On the GSTR-2B download page: click "GENERATE EXCEL FILE TO DOWNLOAD"; when the
  // portal builds the .xlsx blob, inject.js (MAIN world) captures it and posts it
  // here. We stash the file in chrome.storage for the app tab to import via its
  // own parser (appbridge picks it up through chrome.storage.onChanged).
  async function handleTwobDownload(job, cur, progress) {
    const pageText = (document.body && document.body.innerText) || '';
    // Wrong-tile safety: the GSTR-1 offline page reads "Offline Download for GSTR-1".
    if (/offline download for gstr-?1\b/i.test(pageText)) {
      banner('Landed on the GSTR-1 download page (wrong tile). Reload the extension and retry.', '#dc2626'); await clearJob(); return;
    }
    if (!(/gstr2b/.test(url) || /gstr-?2b/i.test(pageText))) { banner('Did not reach the GSTR-2B download page (at ' + location.pathname + ').', '#f59e0b'); await clearJob(); return; }

    banner('Generating the GSTR-2B Excel…' + progress);
    let genBtn = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 15000 && !genBtn) {
      genBtn = $$('button, a').find((x) => /generate\s+excel/i.test(x.textContent || ''));
      if (!genBtn) await sleep(400);
    }
    if (!genBtn) { banner('No "Generate Excel" button on the GSTR-2B download page — tell me what buttons you see.', '#dc2626'); await clearJob(); return; }

    // Two capture paths BOTH write chrome.storage 'gstk_twob_result':
    //  (A) if the portal builds a blob (createObjectURL), inject.js posts __gstkPdf → we store it;
    //  (B) the usual case — the Excel downloads to disk via a direct URL — the
    //      background re-fetches it with the logged-in session and stores it
    //      (see the chrome.downloads hook in background.js).
    // Wait for whichever writes the result first (up to 90s; generation is slow).
    const resultWritten = new Promise((resolve) => {
      const onChg = (changes, area) => {
        if (area === 'local' && changes.gstk_twob_result && changes.gstk_twob_result.newValue) {
          chrome.storage.onChanged.removeListener(onChg);
          resolve(true);
        }
      };
      chrome.storage.onChanged.addListener(onChg);
      setTimeout(() => { chrome.storage.onChanged.removeListener(onChg); resolve(false); }, 90000);
    });
    const onPdf = (e) => { if (e.data && e.data.__gstkPdf) { window.removeEventListener('message', onPdf); storeTwobResult(cur, job.period, e.data.__gstkPdf); } };
    window.addEventListener('message', onPdf);

    genBtn.click();
    banner('Waiting for the GSTR-2B file (generation can take a moment)…' + progress);
    // Some flows reveal a "click here to download" link once the file is ready.
    let done = false;
    const clicked = new Set();
    (async () => {
      while (!done) {
        await sleep(2000);
        const link = $$('a, button').filter((x) => x.offsetParent !== null &&
          !x.closest('nav, header, .navbar, .nav, .dropdown-menu')).find((x) => /click here/i.test((x.textContent || '').trim()) && !clicked.has(x));
        if (link) { clicked.add(link); try { link.click(); } catch (e) { /* noop */ } }
      }
    })();

    const ok = await resultWritten;
    done = true;
    window.removeEventListener('message', onPdf);
    if (!ok) { banner('GSTR-2B downloaded but I could not capture its data to import — tell me and I\'ll adjust.', '#dc2626'); await clearJob(); return; }
    banner('GSTR-2B captured ✓ — importing into GST Keeper. Your downloaded file is untouched — save it to the client folder if you like. You can close this tab.', '#16a34a');
    await clearJob();
  }

  // Stash a captured GSTR-2B file (blob path) for the app to import via its parser.
  async function storeTwobResult(cur, period, dataUrl) {
    const fileName = 'GSTR2B_' + cur.clientId + '_' + String(period).replace('/', '-') + '.xlsx';
    await store.set({ gstk_twob_result: {
      ok: true, clientId: cur.clientId, gstin: (cur.creds && cur.creds.gstin) || '', period,
      fileB64: dataUrl, fileName, at: Date.now(),
    } });
  }

  // GSTR-2A pull — same returns-dashboard tile pattern as handleTwob, adjacent
  // tile. UNVERIFIED: the tile-finding + cascading-dropdown steps reuse code
  // already proven working for the GSTR-2B tile on this exact dashboard, so
  // those are high-confidence; the download page itself (handleTwoADownload)
  // has NOT been tested against a real GSTR-2A download — it mirrors
  // handleTwobDownload's structure on the assumption GSTR-2A offers the same
  // "Generate Excel" flow. If the button text or page shape differs, this
  // will fail loudly (a clear banner + no import) rather than silently
  // importing the wrong file — see the guard at the top of
  // handleTwoADownload. Confirm against a real pull and adjust the selectors
  // below if needed.
  async function handleTwoA(job, cur, progress) {
    if (!/returns\/auth\/dashboard/.test(url)) { location.href = 'https://return.gst.gov.in/returns/auth/dashboard'; return; }
    if (!(await waitFor('select', 20000))) { banner('Returns dashboard did not load.', '#dc2626'); await clearJob(); return; }
    const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const [mm, yyyy] = String(job.period || '').split('/').map((n) => parseInt(n, 10));
    if (!mm || !yyyy) { banner('Bad 2A period.', '#dc2626'); await clearJob(); return; }
    const fyStart = mm >= 4 ? yyyy : yyyy - 1;
    const fyShort = fyStart + '-' + String((fyStart + 1) % 100).padStart(2, '0');
    const monthName = MONTHS_FULL[mm - 1];
    const q = mm >= 4 ? Math.ceil((mm - 3) / 3) : 4;

    banner('Selecting ' + monthName + ' ' + yyyy + ' on the dashboard…' + progress);
    if (!(await selectWhereOption(fyShort))) { banner('Could not set the financial year on the dashboard.', '#dc2626'); await clearJob(); return; }
    await sleep(700);
    await selectWhereOption('Quarter ' + q, { startsWith: true, timeout: 8000 });
    await sleep(700);
    if (!(await selectWhereOption(monthName, { timeout: 12000 }))) { banner('Could not set the month on the dashboard.', '#dc2626'); await clearJob(); return; }
    await sleep(300);
    const search = $('button.srchbtn') || $$('button').find((b) => /^search$/i.test((b.textContent || '').trim()));
    if (!search) { banner('Could not find the dashboard Search button.', '#dc2626'); await clearJob(); return; }
    search.click();

    // GSTR-2A tile's OWN View/Download button — never a wrapper's. Excludes
    // reject any element that also names another return (a wrapper), same
    // guard as the GSTR-2B tile-finder.
    let dlBtn = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 15000 && !dlBtn) {
      await sleep(400);
      dlBtn = findTileButton(/gstr[\s-]*2a/i, /^(view|download)$/i, [/gstr[\s-]*1\b/i, /gstr[\s-]*2b/i, /gstr[\s-]*3b/i]);
    }
    if (!dlBtn) { banner('Could not find the GSTR-2A tile / View-Download after Search — is GSTR-2A available for ' + monthName + ' ' + yyyy + '?', '#dc2626'); await clearJob(); return; }
    job.step = 'twoadwld';
    await setJob(job);
    banner('Opening the GSTR-2A page…' + progress);
    dlBtn.click();
  }

  async function handleTwoADownload(job, cur, progress) {
    const pageText = (document.body && document.body.innerText) || '';
    if (!(/gstr2a/.test(url) || /gstr-?2a/i.test(pageText))) { banner('Did not reach the GSTR-2A page (at ' + location.pathname + '). This page/flow is unverified — tell me what you see and I\'ll adjust the selectors.', '#dc2626'); await clearJob(); return; }

    banner('Generating the GSTR-2A Excel…' + progress);
    let genBtn = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 15000 && !genBtn) {
      genBtn = $$('button, a').find((x) => /generate\s+excel/i.test(x.textContent || ''));
      if (!genBtn) await sleep(400);
    }
    if (!genBtn) { banner('No "Generate Excel" button on the GSTR-2A page — this flow is unverified against the real portal; tell me what buttons you see and I\'ll adjust.', '#dc2626'); await clearJob(); return; }

    const resultWritten = new Promise((resolve) => {
      const onChg = (changes, area) => {
        if (area === 'local' && changes.gstk_twoa_result && changes.gstk_twoa_result.newValue) {
          chrome.storage.onChanged.removeListener(onChg);
          resolve(true);
        }
      };
      chrome.storage.onChanged.addListener(onChg);
      setTimeout(() => { chrome.storage.onChanged.removeListener(onChg); resolve(false); }, 90000);
    });
    const onPdf = (e) => { if (e.data && e.data.__gstkPdf) { window.removeEventListener('message', onPdf); storeTwoAResult(cur, job.period, e.data.__gstkPdf); } };
    window.addEventListener('message', onPdf);

    genBtn.click();
    banner('Waiting for the GSTR-2A file (generation can take a moment)…' + progress);
    let done = false;
    const clicked = new Set();
    (async () => {
      while (!done) {
        await sleep(2000);
        const link = $$('a, button').filter((x) => x.offsetParent !== null &&
          !x.closest('nav, header, .navbar, .nav, .dropdown-menu')).find((x) => /click here/i.test((x.textContent || '').trim()) && !clicked.has(x));
        if (link) { clicked.add(link); try { link.click(); } catch (e) { /* noop */ } }
      }
    })();

    const ok = await resultWritten;
    done = true;
    window.removeEventListener('message', onPdf);
    if (!ok) { banner('GSTR-2A downloaded but I could not capture its data to import — tell me and I\'ll adjust.', '#dc2626'); await clearJob(); return; }
    banner('GSTR-2A captured ✓ — importing into GST Keeper. Your downloaded file is untouched. You can close this tab.', '#16a34a');
    await clearJob();
  }

  async function storeTwoAResult(cur, period, dataUrl) {
    const fileName = 'GSTR2A_' + cur.clientId + '_' + String(period).replace('/', '-') + '.xlsx';
    await store.set({ gstk_twoa_result: {
      ok: true, clientId: cur.clientId, gstin: (cur.creds && cur.creds.gstin) || '', period,
      fileB64: dataUrl, fileName, at: Date.now(),
    } });
  }

  // Read the "Opening Balance" row from whichever ledger table actually has it.
  //
  // The balance figures are the TRAILING run of numeric cells: [IGST, CGST, SGST, Cess],
  // and some ledgers append a Total column after it. We DETECT that total (last value
  // ~= sum of the previous four) instead of assuming a fixed column count — assuming it
  // silently shifted every figure by one column when the portal rendered differently.
  // Polls, so a slow grid isn't read stale/empty.
  // Returns { igst, cgst, sgst, cess } or null.
  // A persistent, selectable diagnostic box. The normal banner is one line and is
  // easy to miss, so ledger pulls also dump exactly what they saw here.
  function debugPanel(lines) {
    let el = document.getElementById('gstk-debug');
    if (!el) {
      el = document.createElement('div');
      el.id = 'gstk-debug';
      el.style.cssText = 'position:fixed;top:36px;left:0;right:0;z-index:2147483647;background:#0b0b0b;color:#7CFC7C;' +
        'font:12px/1.55 ui-monospace,Consolas,monospace;padding:10px 14px;max-height:46vh;overflow:auto;' +
        'white-space:pre-wrap;word-break:break-word;user-select:text;border-bottom:2px solid #7CFC7C';
      document.documentElement.appendChild(el);
    }
    el.textContent = '⬇ GST Keeper diagnostic — please screenshot this whole box ⬇\n' + lines.join('\n');
  }

  // The "…details from DD/MM/YYYY To DD/MM/YYYY" line the portal prints.
  function shownPeriod() {
    const m = (document.body.innerText || '').replace(/\s+/g, ' ').match(/from\s+(\d{2}\/\d{2}\/\d{4})\s+to\s+(\d{2}\/\d{2}\/\d{4})/i);
    return m ? m[1] + ' – ' + m[2] : null;
  }

  // The ledger date inputs. Prefer the known ids; fall back to any visible input
  // already holding a dd/mm/yyyy value (the reversal ledger can differ).
  function findDateInputs() {
    const f = $('#sumlg_frdt');
    const t = $('#sumlg_todt');
    if (f && t) return [f, t];
    const dated = $$('input').filter((i) => i.offsetParent !== null && /^\d{2}\/\d{2}\/\d{4}$/.test((i.value || '').trim()));
    return [f || dated[0] || null, t || dated[1] || null];
  }

  // Set From/To, hit GO, and WAIT until the page confirms it is showing that exact
  // range ("Viewing ... details from 01/06/2026 To 30/06/2026").
  //
  // This is the fix for opening balances coming from the WRONG MONTH: AngularJS was
  // reverting the programmatic date set, the portal kept its default period, and we
  // happily parsed that period's opening balance. Now we verify the dates stuck AND
  // that the grid reloaded for them — otherwise we refuse to save anything.
  async function loadLedgerPeriod(period) {
    const [mm, yyyy] = String(period).split('/').map((n) => parseInt(n, 10));
    const lastDay = new Date(yyyy, mm, 0).getDate();
    const p2 = (n) => String(n).padStart(2, '0');
    const from = '01/' + p2(mm) + '/' + yyyy;
    const to = p2(lastDay) + '/' + p2(mm) + '/' + yyyy;

    const [fEl, tEl] = findDateInputs();
    if (!fEl || !tEl) return { ok: false, from, to, why: 'date fields not found' };

    const stuck = (el, v) => (el.value || '').trim() === v;
    for (let i = 0; i < 5 && !(stuck(fEl, from) && stuck(tEl, to)); i++) {
      setDateInput(fEl, from);
      setDateInput(tEl, to);
      await sleep(350);
    }
    if (!(stuck(fEl, from) && stuck(tEl, to))) {
      return { ok: false, from, to, why: 'dates would not take (From now reads "' + (fEl.value || '') + '", To "' + (tEl.value || '') + '")' };
    }

    const go = $('button.btn-primary.mar-0') || $$('button').find((b) => /^go$/i.test((b.textContent || '').trim()));
    if (!go) return { ok: false, from, to, why: 'GO button not found' };
    go.click();

    // The page prints "…details from DD/MM/YYYY To DD/MM/YYYY" — wait for OUR range.
    const shown = () => {
      const m = (document.body.innerText || '').replace(/\s+/g, ' ').match(/from\s+(\d{2}\/\d{2}\/\d{4})\s+to\s+(\d{2}\/\d{2}\/\d{4})/i);
      return m ? { from: m[1], to: m[2] } : null;
    };
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) {
      const s = shown();
      if (s && s.from === from && s.to === to) return { ok: true, from, to };
      await sleep(400);
    }
    const s = shown();
    return { ok: false, from, to, why: s ? ('page is still showing ' + s.from + ' – ' + s.to) : 'the page never confirmed the period' };
  }

  // GST date fields are datepicker inputs and are often readonly, so a plain value
  // assignment is ignored by AngularJS. Drop readonly, use the NATIVE value setter
  // (bypasses the framework's cached value), and fire the full event set including
  // keyup, which the portal's datepicker listens to.
  function setDateInput(el, value) {
    const wasReadonly = el.hasAttribute('readonly');
    if (wasReadonly) el.removeAttribute('readonly');
    try { el.focus(); } catch (e) { /* noop */ }
    const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    if (desc && desc.set) desc.set.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    try { el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: '0' })); } catch (e) { /* noop */ }
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    if (wasReadonly) el.setAttribute('readonly', 'readonly');
  }

  // Read the ledger's "Opening Balance" or "Closing Balance" row for the loaded period.
  //
  // CRITICAL: only DATA rows are considered. The reversal ledger's HEADER cell reads
  // "Closing Balance (₹) (Opening Balance + Reversal (4B(2)) - Reclaimed (4D(1)))", so a
  // naive text match hit the header — which has no numbers — and silently returned all
  // zeros. That was the "everything comes through as 0" bug.
  async function readLedgerBalance(which, timeout = 25000) {
    const re = which === 'closing' ? /closing\s*balance/i : /opening\s*balance/i;
    const clean = (el) => (el.textContent || '').replace(/[,\s₹]/g, '');
    // The portal prints "-" for a nil figure, so a dash is NOT a number.
    const isNum = (raw) => raw !== '' && raw !== '-' && Number.isFinite(Number(raw));
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      for (const table of $$('table')) {
        const dataRows = [...table.querySelectorAll('tr')].filter(
          (tr) => !tr.closest('thead') && tr.querySelectorAll('th').length === 0 && tr.querySelectorAll('td').length > 0
        );
        const row = dataRows.find((tr) => re.test(tr.textContent || ''));
        if (!row) continue;

        const tds = [...row.children];
        const vals = [];
        for (let i = tds.length - 1; i >= 0 && vals.length < 6; i--) {
          const raw = clean(tds[i]);
          if (!isNum(raw)) { if (vals.length) break; else continue; } // skip trailing blanks
          vals.unshift(Number(raw));
        }

        if (vals.length < 4) {
          // Row rendered but every figure is "-"/blank => a genuine NIL opening balance
          // (common, e.g. a client with no carried-forward credit). Record zeros rather
          // than reporting a failure.
          if (!tds.some((td) => isNum(clean(td)))) return { igst: 0, cgst: 0, sgst: 0, cess: 0, raw: tds.map((td) => (td.textContent || '').trim()) };
          continue;
        }

        let group = vals.slice(-4);
        if (vals.length >= 5) {
          const last = vals[vals.length - 1];
          const four = vals.slice(-5, -1);
          const sum = four.reduce((a, b) => a + b, 0);
          if (Math.abs(sum - last) < 1) group = four; // trailing Total column detected
        }
        return { igst: group[0], cgst: group[1], sgst: group[2], cess: group[3], raw: tds.map((td) => (td.textContent || '').trim()) };
      }
      await sleep(500);
    }
    return null;
  }

  // NOTE: a function declaration (hoisted) — as a `const` arrow it sat in the temporal
  // dead zone and threw "Cannot access 'inr' before initialization" when a handler ran.
  function inr(n) {
    return Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }

  // Read EVERY data row of the loaded credit-ledger table (not just the Opening
  // Balance row), so a Pull can capture the ITC utilised and DRC-03 / other
  // debits the same way the manual CSV upload does. A month's return set-off is
  // DATED in the following month (e.g. the May return debits post on 20-Jun), so
  // the reco month's date range already contains M-1's Debit rows. Returns
  // [{ isDebit, text, igst, cgst, sgst }] for each Credit/Debit data row.
  function readLedgerRows() {
    const clean = (el) => (el.textContent || '').replace(/[,\s₹]/g, '');
    const isNum = (raw) => raw !== '' && raw !== '-' && /^-?\d+(\.\d+)?$/.test(raw);
    for (const table of $$('table')) {
      const dataRows = [...table.querySelectorAll('tr')].filter(
        (tr) => !tr.closest('thead') && tr.querySelectorAll('th').length === 0 && tr.querySelectorAll('td').length > 0
      );
      // The ledger grid is the one whose rows carry a Debit/Credit transaction type.
      if (!dataRows.some((tr) => /\b(debit|credit)\b/i.test(tr.textContent || ''))) continue;
      const out = [];
      for (const tr of dataRows) {
        const text = tr.textContent || '';
        if (/opening\s*balance|closing\s*balance/i.test(text)) continue;
        const isDebit = /\bdebit\b/i.test(text);
        if (!isDebit && !/\bcredit\b/i.test(text)) continue;
        // The transaction amounts and running balance are the TRAILING contiguous
        // run of numeric cells: [amount block | balance block]. The leading S.No is
        // a separate numeric run and is cut off by the non-numeric gap before it.
        const tds = [...tr.children];
        const run = [];
        for (let i = tds.length - 1; i >= 0; i--) {
          const raw = clean(tds[i]);
          if (isNum(raw)) run.unshift(Number(raw));
          else if (run.length) break;
        }
        if (run.length < 6 || run.length % 2 !== 0) continue; // need equal amount + balance blocks
        const amt = run.slice(0, run.length / 2); // [IGST, CGST, SGST, Cess, (Total)]
        out.push({ isDebit, text, igst: amt[0] || 0, cgst: amt[1] || 0, sgst: amt[2] || 0 });
      }
      return out;
    }
    return [];
  }

  // Classify the scraped rows into ITC utilised (the "Other than reverse charge"
  // return set-off Debit) and DRC-03 / other debits (any other Debit that isn't a
  // reverse-charge set-off) — mirrors the app's CSV-upload detection. `utilised`
  // is null when no return set-off Debit is present, so the app keeps its estimate.
  function classifyLedgerRows(rows) {
    let utilised = { igst: 0, cgst: 0, sgst: 0 }, sawReturnDebit = false;
    const drc = { igst: 0, cgst: 0, sgst: 0 };
    for (const r of rows) {
      if (!r.isDebit) continue;
      if (/other than reverse charge/i.test(r.text)) {
        sawReturnDebit = true;
        utilised.igst += r.igst; utilised.cgst += r.cgst; utilised.sgst += r.sgst;
      } else if (!/reverse charge/i.test(r.text)) {
        drc.igst += r.igst; drc.cgst += r.cgst; drc.sgst += r.sgst;
      }
    }
    if (!sawReturnDebit) utilised = null;
    return { utilised, drc };
  }

  async function handleLedger(job, cur, progress) {
    if (!/detailedledger/.test(url)) { location.href = 'https://return.gst.gov.in/returns/auth/ledger/detailedledger'; return; }
    banner('Reading credit-ledger opening balance…' + progress);
    if (!(await waitFor('#sumlg_frdt', 20000))) {
      banner('Ledger form did not load — moving on.' + progress, '#f59e0b');
      job.step = 'reversal';
      await setJob(job);
      location.href = 'https://return.gst.gov.in/returns/auth/ledger/revreclaimdetledger';
      return;
    }
    const per = await loadLedgerPeriod(job.period);
    if (!per.ok) {
      banner('Credit ledger: could not load ' + per.from + ' – ' + per.to + ' (' + per.why + '). Skipped so a wrong period is not saved.', '#dc2626');
      await sleep(2000);
      job.step = 'reversal';
      await setJob(job);
      location.href = 'https://return.gst.gov.in/returns/auth/ledger/revreclaimdetledger';
      return;
    }
    // GST Receivable Reco keeps the OPENING balance: its own closing is computed as
    // Opening + Net ITC available - ITC utilised, so this must be the start-of-period
    // figure or that formula double-counts.
    const bal = await readLedgerBalance('opening');
    // Also scrape the Debit rows to capture ITC utilised + DRC-03 (the month's
    // return set-off posts in the following month, so it's already in this range).
    const ledgerRows = readLedgerRows();
    const { utilised, drc } = classifyLedgerRows(ledgerRows);
    // Persist every row (not just the utilised/DRC-03 totals above) for the
    // "Credit Ledger" full-detail report. Best-effort — a failure here must
    // not block the GST Receivable Reco write below, which the rest of this
    // handler already depends on.
    try {
      await GSTKdb.replaceCreditLedgerTxns(cur.clientId, job.period, ledgerRows.map((r) => ({
        client_id: cur.clientId, period_month: job.period,
        is_debit: r.isDebit, description: r.text, igst: r.igst, cgst: r.cgst, sgst: r.sgst,
      })));
    } catch (e) { /* non-fatal — the reco write below is what actually matters */ }
    debugPanel([
      'STEP: Electronic Credit ledger  (' + location.pathname + ')',
      'requested period : ' + per.from + ' – ' + per.to,
      'page is showing  : ' + (shownPeriod() || '(none)'),
      'OPENING row cells: ' + (bal && bal.raw ? JSON.stringify(bal.raw) : '(NO Opening Balance data row found)'),
      'parsed opening   : IGST=' + (bal ? bal.igst : '?') + '  CGST=' + (bal ? bal.cgst : '?') + '  SGST=' + (bal ? bal.sgst : '?') + '  Cess=' + (bal ? bal.cess : '?'),
      'ledger rows read : ' + ledgerRows.length,
      'ITC utilised     : ' + (utilised ? ('IGST=' + utilised.igst + '  CGST=' + utilised.cgst + '  SGST=' + utilised.sgst) : '(no return set-off Debit found — app keeps its estimate)'),
      'DRC-03 / other   : IGST=' + drc.igst + '  CGST=' + drc.cgst + '  SGST=' + drc.sgst,
      '-> GST Receivable Reco gets Opening + ITC utilised + DRC-03 above.',
    ]);
    if (bal) {
      const patch = {
        opening_igst: bal.igst, opening_cgst: bal.cgst, opening_sgst: bal.sgst,
        opening_source: 'portal', opening_portal_pulled_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        drc_igst: drc.igst, drc_cgst: drc.cgst, drc_sgst: drc.sgst,
      };
      // Only set utilised when a return set-off Debit was actually seen; otherwise
      // leave it null so the app falls back to its GSTR-3B estimate.
      if (utilised) {
        patch.utilized_igst = utilised.igst;
        patch.utilized_cgst = utilised.cgst;
        patch.utilized_sgst = utilised.sgst;
      }
      // Credit-ledger opening + utilised + DRC -> GST Receivable Reco.
      await GSTKdb.upsertReco('gst_receivable_reco', cur.clientId, job.period, patch);
      // Echo the figures so they can be checked against the portal at a glance.
      const utilNote = utilised ? (' · utilised CGST ' + inr(utilised.cgst)) : '';
      const drcNote = (drc.cgst || drc.sgst || drc.igst) ? (' · DRC-03 CGST ' + inr(drc.cgst)) : '';
      banner('Credit ledger → opening CGST ' + inr(bal.cgst) + utilNote + drcNote + ' — saved. Now the reversal ledger…' + progress, '#16a34a');
      await sleep(1200);
    } else {
      banner('No credit-ledger opening row — now the reversal ledger…' + progress, '#f59e0b');
    }
    job.step = 'reversal';
    await setJob(job);
    location.href = 'https://return.gst.gov.in/returns/auth/ledger/revreclaimdetledger';
  }

  // ITC-reversal (Electronic Credit Reversal & Re-claimed Statement) opening ->
  // Suspended Reco. Same date form as the credit ledger; the "Opening Balance" row's
  // last 4 cells are the balance group [IGST, CGST, SGST, Cess] (no Total column).
  async function handleReversal(job, cur, progress) {
    if (!/revreclaimdetledger/.test(url)) { location.href = 'https://return.gst.gov.in/returns/auth/ledger/revreclaimdetledger'; return; }
    banner('Reading ITC-reversal ledger opening…' + progress);
    if (!(await waitFor('input', 20000))) { banner('Reversal ledger form did not load — moving on.' + progress, '#f59e0b'); await chainOrStop(job, 'ledgers', proceedToLiabilityLedger); return; }
    const per = await loadLedgerPeriod(job.period);
    if (!per.ok) {
      debugPanel([
        'STEP: ITC-Reversal ledger  (' + location.pathname + ')',
        'requested period : ' + per.from + ' – ' + per.to,
        'page is showing  : ' + (shownPeriod() || '(no "from … To …" text found)'),
        'FAILED because   : ' + per.why,
        'Nothing was saved (so a wrong period cannot overwrite your figures).',
      ]);
      banner('Reversal ledger: could not load ' + per.from + ' – ' + per.to + ' (' + per.why + '). Nothing saved — see the diagnostic box.', '#dc2626');
      await sleep(4000);
      await chainOrStop(job, 'ledgers', proceedToLiabilityLedger);
      return;
    }
    // Suspended Reco takes the CLOSING balance of the month's range (the balance
    // after the previous month's return was filed) — confirmed by the user.
    const bal = await readLedgerBalance('closing');
    debugPanel([
      'STEP: ITC-Reversal ledger  (' + location.pathname + ')',
      'requested period : ' + per.from + ' – ' + per.to,
      'page is showing  : ' + (shownPeriod() || '(none)'),
      'CLOSING row cells: ' + (bal && bal.raw ? JSON.stringify(bal.raw) : '(NO Closing Balance data row found)'),
      'parsed           : IGST=' + (bal ? bal.igst : '?') + '  CGST=' + (bal ? bal.cgst : '?') + '  SGST=' + (bal ? bal.sgst : '?') + '  Cess=' + (bal ? bal.cess : '?'),
      '-> Suspended Reco gets CGST/SGST/IGST above.',
    ]);
    if (bal) {
      const opening = {
        opening_igst: bal.igst, opening_cgst: bal.cgst, opening_sgst: bal.sgst,
        opening_source: 'portal', opening_portal_pulled_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      await GSTKdb.upsertReco('suspended_reco', cur.clientId, job.period, opening);
      banner('Reversal ledger → IGST ' + inr(bal.igst) + ' · CGST ' + inr(bal.cgst) + ' · SGST ' + inr(bal.sgst) + ' — saved.' + progress, '#16a34a');
      await sleep(1500);
    } else {
      banner('No reversal opening-balance row found.' + progress, '#f59e0b');
    }
    // mode 'ledgers' (the reco pages' own Pull button) stops right here —
    // credit ledger + reversal ledger is exactly what it's for. No mode
    // (the true comprehensive sync) falls through to Liability/Cash Ledger,
    // Notices, Refunds, DRC-03, ... as before.
    await chainOrStop(job, 'ledgers', proceedToLiabilityLedger);
  }

  // Best-effort diagnostic breadcrumb for the two new ledger pulls: on any
  // failure, write ONE row saying so instead of leaving the table silently
  // empty (which is indistinguishable from "portal genuinely had nothing").
  // A later successful pull naturally overwrites it (delete-then-insert).
  async function writeLedgerFailureRow(replaceFn, cur, job, reason) {
    try {
      await replaceFn(cur.clientId, job.period, [{
        client_id: cur.clientId, period_month: job.period,
        description: 'PULL FAILED: ' + reason, is_debit: null,
        igst: 0, cgst: 0, sgst: 0, cess: 0, balance: 0,
      }]);
    } catch (e) { /* diagnostic only — nothing else to do if even this fails */ }
  }

  // A standalone Reports Hub "Pull" (job.mode one of the 7 section modes
  // below) must stop right after its own section instead of continuing the
  // full ledger->reversal->...->challans chain that GST Receivable Reco's
  // "Pull" runs. Every handler below calls this instead of calling its
  // proceedToNext function directly (on every exit path — success, skip, AND
  // failure — since a standalone DRC-03 pull that hit a portal error still
  // has no business going on to pull Taxpayer Profile). When job.mode isn't
  // this step's own mode (the full-chain case, where job.mode is undefined),
  // it behaves exactly as before: call proceedFn to continue the chain.
  // myMode may also be an array of modes that should all stop here — used by
  // the Notices/Refunds/DRC-03 bundle ('notices_bundle'), which needs to
  // fall through notices->refunds normally but then stop after DRC-03
  // instead of continuing into Taxpayer Profile and the rest of the full
  // chain.
  async function chainOrStop(job, myMode, proceedFn) {
    const stopModes = Array.isArray(myMode) ? myMode : [myMode];
    if (stopModes.includes(job.mode)) { await advance(job); return; }
    await proceedFn(job);
  }

  async function proceedToLiabilityLedger(job) {
    job.step = 'liabilityledger';
    await setJob(job);
    location.href = 'https://return.gst.gov.in/returns/auth/ledger/taxdetailedledger';
  }

  // Electronic Liability Register (Part-I, return-related liabilities) -> the
  // "Liability Ledger" report. The page (taxdetailedledger) is Angular over a
  // plain JSON API (retdtl) — confirmed live via DevTools network tab — so this
  // reads that API directly rather than scraping the rendered table, the way
  // the credit/reversal ledgers above have to (those pages have no such API).
  async function handleLiabilityLedger(job, cur, progress) {
    if (!/taxdetailedledger/.test(url)) { location.href = 'https://return.gst.gov.in/returns/auth/ledger/taxdetailedledger'; return; }
    banner('Reading Electronic Liability Register…' + progress);
    const [mm, yyyy] = String(job.period).split('/').map((n) => parseInt(n, 10));
    if (!mm || !yyyy) { banner('Bad period for Liability Register — skipped.' + progress, '#f59e0b'); await chainOrStop(job, 'liabilityledger', proceedToCashLedger); return; }
    const mmyyyy = String(mm).padStart(2, '0') + yyyy;
    let rows = [];
    try {
      const r = await fetch('https://return.gst.gov.in/returns/auth/api/retdtl?fdate=' + mmyyyy + '&to_dt=' + mmyyyy + '&gstin=' + encodeURIComponent(cur.creds.gstin || ''), { credentials: 'include' });
      if (!r.ok) throw new Error('HTTP ' + r.status + ' from retdtl');
      const j = await r.json();
      rows = parseLedgerTxns(j, 'dt').map((row) => Object.assign({ client_id: cur.clientId, period_month: job.period }, row));
    } catch (e) {
      debugPanel(['STEP: Electronic Liability Register  (' + location.pathname + ')', 'fetch failed: ' + (e && e.message)]);
      banner('Liability Register: could not read the portal API (' + (e && e.message) + ') — skipped.' + progress, '#dc2626');
      await writeLedgerFailureRow(GSTKdb.replaceLiabilityLedgerEntries, cur, job, (e && e.message) || 'unknown error');
      await sleep(1500);
      await chainOrStop(job, 'liabilityledger', proceedToCashLedger);
      return;
    }
    try { await GSTKdb.replaceLiabilityLedgerEntries(cur.clientId, job.period, rows); } catch (e) { /* non-fatal — still move on to the cash ledger */ }
    debugPanel([
      'STEP: Electronic Liability Register  (' + location.pathname + ')',
      'period            : ' + job.period + '  (fdate=to_dt=' + mmyyyy + ')',
      'rows read         : ' + rows.length,
    ]);
    banner('Liability Register → ' + rows.length + ' entries saved. Now the cash ledger…' + progress, '#16a34a');
    await sleep(1000);
    await chainOrStop(job, 'liabilityledger', proceedToCashLedger);
  }

  async function proceedToCashLedger(job) {
    job.step = 'cashledger';
    await setJob(job);
    location.href = 'https://payment.gst.gov.in/payment/auth/ledger/detailedledger';
  }

  // Electronic Cash Ledger -> the "Cash Ledger" report. Same JSON-API approach
  // as the Liability Register, on payment.gst.gov.in's own API (cashdetls). A
  // NEW domain crossing for this extension's automation (everything else stays
  // on return.gst.gov.in) — the shared *.gst.gov.in session cookie carries
  // over, matching how the portal's own "Check Cash Balance" quick link works.
  async function handleCashLedger(job, cur, progress) {
    if (!/payment\.gst\.gov\.in/.test(location.hostname) || !/detailedledger/.test(url)) {
      location.href = 'https://payment.gst.gov.in/payment/auth/ledger/detailedledger';
      return;
    }
    banner('Reading Electronic Cash Ledger…' + progress);
    const [mm, yyyy] = String(job.period).split('/').map((n) => parseInt(n, 10));
    if (!mm || !yyyy) { banner('Bad period for Cash Ledger — skipped.' + progress, '#f59e0b'); await chainOrStop(job, 'cashledger', proceedToNotices); return; }
    const lastDay = new Date(yyyy, mm, 0).getDate();
    const p2 = (n) => String(n).padStart(2, '0');
    const from = '01/' + p2(mm) + '/' + yyyy;
    const to = p2(lastDay) + '/' + p2(mm) + '/' + yyyy;
    let rows = [];
    try {
      const r = await fetch('https://payment.gst.gov.in/payment/auth/api/cashdetls?fdate=' + from + '&tdate=' + to, { credentials: 'include' });
      if (!r.ok) throw new Error('HTTP ' + r.status + ' from cashdetls');
      const j = await r.json();
      rows = parseLedgerTxns(j, 'dpt_dt').map((row) => Object.assign({ client_id: cur.clientId, period_month: job.period }, row));
    } catch (e) {
      debugPanel(['STEP: Electronic Cash Ledger  (' + location.pathname + ')', 'fetch failed: ' + (e && e.message)]);
      banner('Cash Ledger: could not read the portal API (' + (e && e.message) + ') — skipped.' + progress, '#dc2626');
      await writeLedgerFailureRow(GSTKdb.replaceCashLedgerEntries, cur, job, (e && e.message) || 'unknown error');
      await sleep(1500);
      await chainOrStop(job, 'cashledger', proceedToNotices);
      return;
    }
    try { await GSTKdb.replaceCashLedgerEntries(cur.clientId, job.period, rows); } catch (e) { /* non-fatal */ }
    debugPanel([
      'STEP: Electronic Cash Ledger  (' + location.pathname + ')',
      'period            : ' + from + ' – ' + to,
      'rows read         : ' + rows.length,
    ]);
    banner('Cash Ledger → ' + rows.length + ' entries saved. Now Notices & Orders…' + progress, '#16a34a');
    await sleep(1000);
    await chainOrStop(job, 'cashledger', proceedToNotices);
  }

  // Standalone Credit Ledger (Transaction Detail) pull — same detailedledger
  // page and readLedgerRows() scrape handleLedger already uses for GST
  // Receivable Reco, but stops after saving instead of chaining into the
  // reversal/reco chain. Carved out so the Reports Hub can offer a one-click
  // Pull on this report directly, the way Liability/Cash Ledger already do,
  // instead of only being reachable via GST Receivable Reco's full pull.
  async function handleCreditLedgerTxnOnly(job, cur, progress) {
    if (!/return\.gst\.gov\.in/.test(location.hostname) || !/detailedledger/.test(url)) {
      location.href = 'https://return.gst.gov.in/returns/auth/ledger/detailedledger';
      return;
    }
    banner('Reading Credit Ledger (transaction detail)…' + progress);
    if (!(await waitFor('#sumlg_frdt', 20000))) { banner('Ledger form did not load — skipped.' + progress, '#dc2626'); await advance(job); return; }
    const per = await loadLedgerPeriod(job.period);
    if (!per.ok) {
      banner('Credit Ledger: could not load ' + per.from + ' – ' + per.to + ' (' + per.why + ') — skipped.' + progress, '#dc2626');
      await advance(job);
      return;
    }
    const ledgerRows = readLedgerRows();
    try {
      await GSTKdb.replaceCreditLedgerTxns(cur.clientId, job.period, ledgerRows.map((r) => ({
        client_id: cur.clientId, period_month: job.period,
        is_debit: r.isDebit, description: r.text, igst: r.igst, cgst: r.cgst, sgst: r.sgst,
      })));
    } catch (e) { /* non-fatal */ }
    debugPanel([
      'STEP: Credit Ledger (Transaction Detail)  (' + location.pathname + ')',
      'period            : ' + per.from + ' – ' + per.to,
      'rows read         : ' + ledgerRows.length,
    ]);
    banner('Credit Ledger (Transaction Detail) → ' + ledgerRows.length + ' entries saved.' + progress, '#16a34a');
    await sleep(800);
    await advance(job);
  }

  async function proceedToNotices(job) {
    job.step = 'notices';
    await setJob(job);
    location.href = 'https://services.gst.gov.in/services/auth/notices';
  }

  // View Notices and Orders. Not period-scoped — pulls FULL history every
  // time (the portal itself merged "Additional Notices and Orders" into this
  // single feed: confirmed live, the page shows a banner saying so — so
  // that second report in the Hub has no separate data source anymore).
  // services.gst.gov.in's own JSON API (get/notices), confirmed live via
  // DevTools network tab, same story as the ledger APIs above.
  // Never save one client's portal data under another client's id. The portal
  // session is shared by the whole Chrome profile, so a second tab logged into
  // a different GSTIN would otherwise be read and saved as this client's.
  // Returns a message when the session clearly belongs to someone else;
  // null when it matches or cannot be checked (never blocks on uncertainty).
  async function sessionGstinMismatch(cur) {
    const expected = String((cur.creds && cur.creds.gstin) || '').trim().toUpperCase();
    if (!expected) return null;
    try {
      const r = await withTimeout(fetch('https://services.gst.gov.in/services/auth/profile/detail', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}',
      }), 10000, 'profile/detail');
      if (!r.ok) return null;
      const j = await r.json();
      const found = String((j && (j.gstin || j.gstIn || j.gstinId)) || '').trim().toUpperCase();
      if (/^[0-9A-Z]{15}$/.test(found) && found !== expected) {
        return 'Portal session belongs to ' + found + ', not ' + expected + ' — nothing was saved for this client.';
      }
    } catch (e) { /* cannot verify — do not block */ }
    return null;
  }

  // Skip the rest of this client's steps (all periods) and move to the next.
  async function skipClient(job) {
    if (Array.isArray(job.periods) && job.periods.length) job.periodIdx = job.periods.length - 1;
    await advance(job);
  }

  async function handleNotices(job, cur, progress) {
    if (!/\/services\/auth\/notices/.test(url)) { location.href = 'https://services.gst.gov.in/services/auth/notices'; return; }
    const stopHeartbeat = startHeartbeat();
    try {
      await pullNotices(job, cur, progress);
    } finally {
      stopHeartbeat();
    }
    await sleep(1000);
    await chainOrStop(job, 'notices', proceedToRefunds);
  }

  async function pullNotices(job, cur, progress) {
    banner('Checking the portal session…' + progress);
    const mismatch = await sessionGstinMismatch(cur);
    if (mismatch) {
      banner(mismatch + progress, '#dc2626');
      await logSyncAttempt(job, cur, 'failed', mismatch);
      try { await GSTKdb.logStep(job.runId, cur.clientId, 'notices', 'failed', 'session_mismatch', mismatch); } catch (e) { /* ledger is diagnostic */ }
      await sleep(2500);
      await skipClient(job);
      return;
    }
    banner('Reading Notices & Orders…' + progress);
    const pullTs = new Date().toISOString();
    let list = [];
    try {
      const r = await withTimeout(fetch('https://services.gst.gov.in/services/auth/api/get/notices', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onLoad: true, type: '', from: '01/01/2017', to: shownTodayDdMmYyyy() }),
      }), 45000, 'get/notices');
      if (!r.ok) throw new Error('HTTP ' + r.status + ' from get/notices');
      const j = await r.json();
      list = Array.isArray(j) ? j : Object.keys(j || {}).filter((k) => /^\d+$/.test(k)).map((k) => j[k]);
      // An error envelope ({status: 0, error: …}) is a failed read, never an empty list.
      if (!Array.isArray(j) && list.length === 0 && j && typeof j === 'object' && (j.status === 0 || j.error || j.errorCode || j.errCd)) {
        throw new Error('portal returned an error instead of a notice list: ' + JSON.stringify(j).slice(0, 160));
      }
    } catch (e) {
      const msg = (e && e.message) || 'unknown error';
      debugPanel(['STEP: View Notices and Orders  (' + location.pathname + ')', 'fetch failed: ' + msg]);
      banner('Notices & Orders: could not read the portal API (' + msg + ') — skipped.' + progress, '#dc2626');
      await logSyncAttempt(job, cur, 'failed', 'Could not read the portal API: ' + msg);
      try { await GSTKdb.logStep(job.runId, cur.clientId, 'notices', 'failed', /timed out/.test(msg) ? 'timeout' : 'portal_error', msg); } catch (e2) { /* diagnostic */ }
      await sleep(1500);
      return;
    }

    // The portal's own page merges get/notices with litserv's case/task/get
    // (LUT and DRC-03 acknowledgements, case summaries). Best-effort: a failure
    // here keeps the get/notices rows and marks the pull partial.
    let taskList = [];
    let tasksComplete = false;
    try {
      const tr = await withTimeout(fetch('https://services.gst.gov.in/litserv/auth/api/case/task/get', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gstIn: cur.creds.gstin || '', type: '', fmdt: '01/01/2017', todt: shownTodayDdMmYyyy(), onLoad: true }),
      }), 45000, 'case/task/get');
      if (tr.ok) {
        const tj = await tr.json();
        taskList = Array.isArray(tj) ? tj : Object.keys(tj || {}).filter((k) => /^\d+$/.test(k)).map((k) => tj[k]);
        tasksComplete = Array.isArray(tj) || taskList.length > 0 || !(tj && typeof tj === 'object' && (tj.status === 0 || tj.error || tj.errorCode || tj.errCd));
      }
    } catch (e) { /* non-fatal — get/notices rows above still get saved */ }

    // What is already stored: skip those downloads.
    let known = null;
    try { known = await GSTKdb.knownDocs(cur.clientId); } catch (e) { known = null; }
    const knownCases = new Set((known && known.knownCases) || []);
    const openCases = new Set((known && known.openCases) || []);
    const fullKey = 'gstk_folder_full_' + cur.clientId;
    const lastFull = ((await store.get(fullKey))[fullKey]) || 0;
    const fullFolderPass = !known || Date.now() - lastFull > FULL_FOLDER_PASS_MS;

    // 0.8.0 — the link pass. A notice read from get/notices arrives with no
    // PDF of its own (the portal only gives docId/applnId for some forms), no
    // officer and, for a DRC-01 / RFD-03 / RFD-08, often no reply date. All of
    // it is in the matching case-folder item, which this run already reads —
    // and before 0.8.0 the notice's own PDF was the one document in that
    // folder nothing ever linked, so the app showed "PDF not captured yet"
    // beside a notice whose PDF was in fact already in storage.
    //
    // Folder items are keyed (client, case_id, '<SECTION>:<refId>'), so a
    // notice's reference number finds its item by that key's suffix —
    // including a refund notice, whose folder the refunds step saves under the
    // refund ARN. This maps every attachment list already stored, so a notice
    // synced before 0.8.0 gets its PDF linked on the next run with no
    // download at all.
    const storedAttachByRef = new Map();
    for (const key of Object.keys((known && known.itemDocs) || {})) {
      const ref = key.slice(key.lastIndexOf(':') + 1);
      const list = known.itemDocs[key];
      if (ref && Array.isArray(list) && list.length && !storedAttachByRef.has(ref)) storedAttachByRef.set(ref, list);
    }
    // This run's folder items, by reference number: attachments to link and
    // the parsed itemJson to read the officer, DIN and reply date out of.
    const detailByRef = new Map();
    // A case whose notice still has no PDF, date or officer is opened even when
    // the case is closed and its folder would otherwise wait for the weekly
    // pass. Bounded: a reference that yields nothing is not forced again for a
    // week, so a notice the portal simply has no folder detail for cannot turn
    // into an extra folder fetch on every run, for ever.
    const triedKey = 'gstk_fill_tried_' + cur.clientId;
    const fillTried = ((await store.get(triedKey))[triedKey]) || {};
    const needsFill = (row) => !!row && (!row.pdf_url || !row.due_date || !row.issued_by);
    const mayForceFill = (ref) => !!ref && !(fillTried[ref] && Date.now() - fillTried[ref] < FULL_FOLDER_PASS_MS);

    let pdfOk = 0, pdfFail = 0, pdfSkipped = 0, foldersFetched = 0, foldersSkipped = 0, attachSkipped = 0;
    let foldersForFill = 0, linkedPdf = 0, linkedDue = 0, linkedOfficer = 0, linkedDin = 0;
    let folderPassOk = true;
    const gstr3aErrors = [];
    const gstr3aDetails = [];
    const rows = [];
    for (const n of list) {
      const refNo = n.noticeOrderId || null;
      const row = {
        client_id: cur.clientId, source: 'notices',
        portal_key: refNo || ('hash:' + simpleHash((n.descr || '') + '|' + (n.dtOfIssue || ''))),
        reference_number: refNo, notice_type: n.type || null,
        description: n.descr || null, issue_date: ddmmyyyyToIso(n.dtOfIssue || ''),
        due_date: /^\d{2}\/\d{2}\/\d{4}$/.test(n.dueDate || '') ? ddmmyyyyToIso(n.dueDate) : null,
        status: n.status || null, issued_by: n.issuedBy || null, case_id: null, pdf_url: null,
      };
      const havePdf = !!(known && known.noticePdf && known.noticePdf[row.portal_key]);
      // 0.8.0: carry the stored URL on the row rather than leaving it null.
      // The row is upserted, so a null here is written over a PDF that is
      // already in storage whenever the ingest RPC is unavailable and the
      // legacy REST path runs (background.js's LEGACY_REPLACE). It also lets
      // the link pass below tell "has a PDF" from "needs one".
      if (havePdf) row.pdf_url = known.noticePdf[row.portal_key];
      if (havePdf && (n.docId || n.pdfDownloadURL)) {
        pdfSkipped++;
      } else if (n.docId && n.applnId) {
        try {
          const pdfR = await withTimeout(fetch('https://services.gst.gov.in/document/' + n.docId + '/' + n.applnId, { credentials: 'include' }), 30000, 'notice pdf');
          if (pdfR.ok) {
            const buf = await withTimeout(pdfR.arrayBuffer(), 30000, 'pdf arrayBuffer');
            const dataUrl = 'data:application/pdf;base64,' + arrayBufferToBase64(buf);
            const path = 'notices/' + cur.clientId + '/' + (row.reference_number || n.docId) + '.pdf';
            row.pdf_url = await withTimeout(GSTKdb.uploadPdf(path, dataUrl), 30000, 'uploadPdf');
            pdfOk++;
          } else pdfFail++;
        } catch (e) { pdfFail++; }
      } else if (n.pdfDownloadURL && n.noticeOrderId && n.appDefId) {
        // GSTR-3A: the portal builds this PDF client-side from a small summary
        // JSON; fetch that summary and rebuild the same template (no Save-As dialog).
        try {
          const summaryUrl = 'https://return.gst.gov.in/returns/auth/api/gstr3a/summary?defaulter_id=' +
            encodeURIComponent(n.appDefId) + '&order_id=' + encodeURIComponent(n.noticeOrderId);
          // 0.8.0: one retry. A client with hundreds of GSTR-3A notices (326
          // open on this firm's own books) makes this call hundreds of times
          // in a row and the portal drops some of them — the "no PDF captured"
          // rows in All notices. A single failure used to be final for that
          // notice until the portal changed something, because a notice with
          // no PDF was never retried. Two seconds between tries, and a notice
          // that still fails is retried by the gap-fill pass on a later run.
          // The portal answers this one with a 200 "Access Denied" HTML page
          // when it dislikes the request, so a failed read is not only a
          // failed fetch — an HTML body counts too, and both are worth one
          // retry. Parsing therefore sits inside the loop.
          let summary = null;
          let lastErr = null;
          for (let attempt = 0; attempt < 2 && summary == null; attempt++) {
            if (attempt) await sleep(2000);
            try {
              const { base64 } = await withTimeout(GSTKdb.fetchCrossOriginAsBase64(summaryUrl), 15000, 'gstr3a summary');
              let raw;
              try { raw = atob(base64); } catch (e) { throw new Error('base64 decode failed: ' + (e && e.message)); }
              if (/^\s*</.test(raw)) throw new Error('portal answered with an HTML page, not JSON (' + raw.length + ' chars)');
              try { summary = JSON.parse(raw); } catch (e) { throw new Error('not JSON (' + raw.length + ' chars): ' + raw.slice(0, 120)); }
            } catch (e) { lastErr = e; summary = null; }
          }
          if (summary == null) throw (lastErr || new Error('gstr3a summary did not answer'));
          if (summary && summary.data) {
            gstr3aDetails.push({ portal_key: row.portal_key, detail: { gstr3a: {
              retTyp: summary.data.retTyp || null, ret_period: summary.data.ret_period || null,
              orderId: summary.data.orderId || n.noticeOrderId } } });
            const pdfDataUrl = buildGstr3aNoticePdf(summary.data, n.dtOfIssue, n.noticeOrderId);
            const path = 'notices/' + cur.clientId + '/' + n.noticeOrderId + '.pdf';
            row.pdf_url = await withTimeout(GSTKdb.uploadPdf(path, pdfDataUrl), 20000, 'uploadPdf');
            pdfOk++;
          } else {
            pdfFail++;
            gstr3aErrors.push(n.noticeOrderId + ': no .data in response — ' + JSON.stringify(summary).slice(0, 150));
          }
        } catch (e) {
          pdfFail++;
          gstr3aErrors.push(n.noticeOrderId + ': ' + ((e && e.message) || String(e)));
        }
      }
      rows.push(row);
    }

    // Fold in the case/task rows. A task whose refId get/notices already
    // returned is the same notice: link its case (so its folder shows on the
    // notice) instead of dropping the link with the duplicate.
    const rowByRef = new Map(rows.filter((r) => r.reference_number).map((r) => [r.reference_number, r]));
    const titleCase = (s) => (s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
    const epochMsToIsoDate = (ms) => {
      if (!ms) return null;
      const d = new Date(ms);
      return isNaN(d.getTime()) ? null : d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    };
    let taskRows = 0;
    const folderBatches = [];
    for (const t of taskList) {
      const refId = t.refId || null;
      let row = refId ? rowByRef.get(refId) : null;
      const isDuplicate = !!row;
      if (isDuplicate) {
        if (t.arn && !row.case_id) row.case_id = t.arn;
      } else {
        row = {
          client_id: cur.clientId, source: 'notices',
          portal_key: refId || ('case:' + (t.arn || simpleHash((t.taskDesc || '') + '|' + (t.assignmentDt || '')))),
          reference_number: refId, notice_type: titleCase(t.caseTypeName),
          description: t.taskDesc || null, issue_date: epochMsToIsoDate(t.assignmentDt),
          due_date: null, status: null, issued_by: null, case_id: t.arn || null, pdf_url: null,
        };
        if (refId) rowByRef.set(refId, row);
        rows.push(row);
        taskRows++;
      }
      if (!t.caseId || !t.arn) continue;

      // Folders: new or open cases every run; every case on the weekly full
      // pass; and (0.8.0) a case whose notice still has no PDF, reply date or
      // officer, so the gap is closed on the next run instead of waiting for
      // that weekly pass — once, then not again for a week (mayForceFill).
      const fillThis = needsFill(row) && mayForceFill(refId);
      const needFolders = fullFolderPass || !knownCases.has(t.arn) || openCases.has(t.arn) || fillThis;
      if (!needFolders) { foldersSkipped++; continue; }
      if (fillThis) foldersForFill++;
      let folders = [];
      try {
        const fr = await withTimeout(fetch('https://services.gst.gov.in/litserv/auth/api/case/folder', {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ caseId: t.caseId, gstid: cur.creds.gstin || '', caseTypeCd: t.caseTpeCd || '' }),
        }), 20000, 'case/folder');
        folders = fr.ok ? await fr.json() : [];
        if (!fr.ok) folderPassOk = false;
      } catch (e) { folders = []; folderPassOk = false; }
      if (!Array.isArray(folders) || !folders.length) continue;
      foldersFetched++;

      // The task row's own PDF (e.g. an LUT's RFD-11A order) — only when not stored yet.
      const haveTaskPdf = isDuplicate || !!(known && known.noticePdf && known.noticePdf[row.portal_key]);
      const ordersFolder = folders.find((f) => f.caseFolderTypeCd === 'ORDRS');
      if (!haveTaskPdf && ordersFolder) {
        try {
          const ir = await withTimeout(fetch('https://services.gst.gov.in/litserv/auth/api/case/folder/items', {
            method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ caseFolderId: ordersFolder.caseFolderId }),
          }), 15000, 'case/folder/items');
          const items = ir.ok ? await ir.json() : [];
          const item = Array.isArray(items) ? (items.find((it) => it.refId === refId) || items[0]) : null;
          const parsed = item && item.itemJson ? JSON.parse(item.itemJson) : null;
          const docId = parsed && parsed.docupdtl && parsed.docupdtl[0] ? parsed.docupdtl[0].id : null;
          const docArn = (parsed && parsed.crn) || t.arn;
          if (docId) {
            const eh = await withTimeout(fetchEncrypDocEh(docId, docArn), 15000, 'getEncrypDocIds');
            if (eh) {
              const pdfR = await withTimeout(fetch('https://services.gst.gov.in/downloadhb/download/new?docId=' + encodeURIComponent(docId) + '&arn=' + encodeURIComponent(docArn) + '&eh=' + encodeURIComponent(eh), { credentials: 'include' }), 20000, 'downloadhb');
              const buf = pdfR.ok ? await withTimeout(pdfR.arrayBuffer(), 15000, 'pdf arrayBuffer') : null;
              if (buf && buf.byteLength > 200) {
                const dataUrl = 'data:application/pdf;base64,' + arrayBufferToBase64(buf);
                const path = 'notices/' + cur.clientId + '/' + (refId || docId) + '.pdf';
                row.pdf_url = await withTimeout(GSTKdb.uploadPdf(path, dataUrl), 20000, 'uploadPdf');
                pdfOk++;
              } else pdfFail++;
            } else pdfFail++;
          } else pdfFail++;
        } catch (e) { pdfFail++; }
      } else if (haveTaskPdf && ordersFolder) {
        pdfSkipped++;
      }

      // Every folder's items, with attachments not stored yet.
      const folderItems = [];
      let folderFailures = 0;
      for (const folder of folders) {
        try {
          const fir = await withTimeout(fetch('https://services.gst.gov.in/litserv/auth/api/case/folder/items', {
            method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ caseFolderId: folder.caseFolderId }),
          }), 15000, 'case/folder/items');
          if (!fir.ok) { folderFailures++; continue; }
          const fItems = await fir.json();
          if (!Array.isArray(fItems)) { folderFailures++; continue; }
          for (const fi of fItems) {
            let fParsed = null;
            try { fParsed = fi.itemJson ? JSON.parse(fi.itemJson) : null; } catch (e) { /* keep raw_json as the unparsed string below */ }
            const fiRef = fi.refId || (fParsed && fParsed.crn) || null;
            const itemKey = (folder.caseFolderTypeCd || '_') + ':' + (fiRef || simpleHash(JSON.stringify(fParsed || fi.itemJson || '')));
            const stored = (known && known.itemDocs && known.itemDocs[t.arn + '|' + itemKey]) || [];
            const rawDocs = [];
            findDocDescriptors(fParsed, new Set(), rawDocs);
            const seenDocIds = new Set();
            const attachments = [];
            for (const doc of rawDocs) {
              if (seenDocIds.has(doc.id)) continue;
              seenDocIds.add(doc.id);
              const already = stored.find((a) => a && typeof a.url === 'string' && a.url.indexOf('/' + doc.id + '.pdf') !== -1);
              if (already) { attachments.push(already); attachSkipped++; continue; }
              try {
                const docArn = (fParsed && fParsed.crn) || t.arn;
                const eh = await withTimeout(fetchEncrypDocEh(doc.id, docArn), 15000, 'getEncrypDocIds');
                if (!eh) continue;
                const pdfR = await withTimeout(fetch('https://services.gst.gov.in/downloadhb/download/new?docId=' + encodeURIComponent(doc.id) + '&arn=' + encodeURIComponent(docArn) + '&eh=' + encodeURIComponent(eh), { credentials: 'include' }), 20000, 'downloadhb');
                if (!pdfR.ok) continue;
                const buf = await withTimeout(pdfR.arrayBuffer(), 15000, 'pdf arrayBuffer');
                if (!buf || buf.byteLength <= 200) continue;
                const dataUrl = 'data:application/pdf;base64,' + arrayBufferToBase64(buf);
                const path = 'notices/' + cur.clientId + '/case-folder/' + t.arn + '/' + doc.id + '.pdf';
                const urlOut = await withTimeout(GSTKdb.uploadPdf(path, dataUrl), 20000, 'uploadPdf');
                attachments.push({ label: doc.docName || doc.docttl || (doc.id + '.pdf'), url: urlOut });
              } catch (e) { /* best-effort per attachment */ }
            }
            folderItems.push({
              portal_key: itemKey,
              folder_section: folder.caseFolderTypeCd || null,
              reference_number: fiRef,
              attachments,
              raw_json: fParsed !== null ? fParsed : (fi.itemJson || null),
            });
            // 0.8.0: this item, for the link pass below. Keep the first one a
            // reference has — the portal lists an item once per case, and a
            // reply or order filed against the same reference must not take
            // the notice's own place.
            if (fiRef && !detailByRef.has(fiRef)) detailByRef.set(fiRef, { attachments, raw: fParsed, section: folder.caseFolderTypeCd || null });
          }
        } catch (e) { folderFailures++; }
      }
      if (folderFailures) folderPassOk = false;
      if (folderItems.length) folderBatches.push({ caseId: t.arn, items: folderItems, complete: folderFailures === 0 });
    }

    // ── The link pass (0.8.0) ───────────────────────────────────────────
    // Every notice row now takes from its case-folder item what get/notices
    // did not give it: the notice's own PDF, the reply date, the officer and
    // the DIN. Nothing already on the row is overwritten — a date the portal
    // put in the notice list stays the authority — and a reference with no
    // folder item is left exactly as it was.
    const dinByKey = [];
    for (const row of rows) {
      const ref = row.reference_number;
      if (!ref) continue;
      const detail = detailByRef.get(ref);
      const attachments = (detail && detail.attachments && detail.attachments.length)
        ? detail.attachments : storedAttachByRef.get(ref);
      if (!row.pdf_url) {
        const url = pickNoticeAttachment(attachments, ref);
        if (url) { row.pdf_url = url; linkedPdf++; }
      }
      const f = noticeFieldsFromItem(detail && detail.raw);
      if (!row.due_date && f.due_date) { row.due_date = f.due_date; linkedDue++; }
      if (!row.issued_by && f.issued_by) { row.issued_by = f.issued_by; linkedOfficer++; }
      // The DIN goes in its own small PATCH after the save, never on the row:
      // this extension cannot migrate the database, and one unknown column in
      // the upsert body would fail the whole notices save for the client. The
      // same reasoning background.js's patchRefundDocument is built on.
      if (f.din) { dinByKey.push({ portal_key: row.portal_key, din: f.din }); linkedDin++; }
      // Remember a reference that yielded nothing, so forcing its folder open
      // is not repeated on every run (mayForceFill above).
      if (needsFill(row)) fillTried[ref] = Date.now(); else if (fillTried[ref]) delete fillTried[ref];
    }
    try { await store.set({ [triedKey]: fillTried }); } catch (e) { /* only costs a repeat folder fetch */ }

    // Folder items first (a new reply / order on a known case is logged
    // against its notice), then the notice list, then the server-side sweep.
    let foldersSaved = 0;
    for (const b of folderBatches) {
      try { await GSTKdb.ingest(cur.clientId, job.runId, 'case_folder', b.items, { complete: b.complete }, b.caseId); foldersSaved++; } catch (e) { /* diagnostic: the notice list below still saves */ }
    }
    try {
      const saved = await GSTKdb.ingest(cur.clientId, job.runId, 'notices', rows, { complete: tasksComplete });
      if (saved && saved.status === 'held') {
        try { await GSTKdb.logClientSync(cur.clientId, 'notices_guard', 'success', 'Soft-delete held back: ' + (saved.held_reason || 'held')); } catch (e) { /* diagnostic only */ }
      }
      if (fullFolderPass && folderPassOk) { try { await store.set({ [fullKey]: Date.now() }); } catch (e) { /* next run retries the full pass */ } }
      // GSTR-3A return type and period: the notice closes itself once that return is filed.
      if (gstr3aDetails.length) { try { await GSTKdb.noticeDetails(cur.clientId, gstr3aDetails); } catch (e) { /* the notices are saved; detail retries next run */ } }
      // DINs, one best-effort PATCH per notice, after the save and never part
      // of it (see the link pass above). A database without the column fails
      // these harmlessly and the notices stay saved.
      // Three failures with nothing saved means the column is not there, not
      // that three notices were unlucky: stop, rather than spend a client with
      // 326 notices on 326 writes the database will refuse one at a time.
      let dinSaved = 0, dinFailed = 0, dinGaveUp = false;
      for (const d of dinByKey) {
        try { await GSTKdb.patchNoticeFields(cur.clientId, d.portal_key, { din: d.din }); dinSaved++; }
        catch (e) { dinFailed++; if (dinFailed >= 3 && !dinSaved) { dinGaveUp = true; break; } }
      }
      const counts = saved && !saved.legacy
        ? ' — ' + saved.new + ' new, ' + saved.changed + ' changed, ' + saved.removed + ' removed' + (saved.status === 'held' ? ' (removal held back)' : '')
        : '';
      debugPanel([
        'STEP: View Notices and Orders  (' + location.pathname + ')',
        'rows read         : ' + rows.length + ' (' + (rows.length - taskRows) + ' notices, ' + taskRows + ' case/task)' + counts,
        'PDFs              : ' + pdfOk + ' downloaded, ' + pdfSkipped + ' already stored, ' + pdfFail + ' failed/not applicable',
        'case folders      : ' + foldersFetched + ' fetched (' + (fullFolderPass ? 'weekly full pass' : 'new or open cases') + (foldersForFill ? ', ' + foldersForFill + ' to fill a gap' : '') + '), ' + foldersSkipped + ' skipped, ' + foldersSaved + ' saved',
        'attachments       : ' + attachSkipped + ' already stored',
        'linked from folder: ' + linkedPdf + ' notice PDFs, ' + linkedDue + ' reply dates, ' + linkedOfficer + ' officers, ' + linkedDin + ' DINs'
          + (dinFailed ? ' (' + dinFailed + ' DIN writes failed' + (dinGaveUp ? ', gave up — no din column in this database?' : '') + ')' : ''),
        ...(gstr3aErrors.length ? ['GSTR-3A errors    :', ...gstr3aErrors.map((m) => '  - ' + m)] : []),
      ]);
      banner('Notices & Orders → ' + rows.length + ' entries' + counts + ' (' + pdfOk + ' new PDFs, ' + pdfSkipped + ' already stored). Now Refund applications…' + progress, '#16a34a');
      await logSyncAttempt(job, cur, 'success', rows.length + ' entries found' + counts + ' (' + pdfOk + ' PDFs captured, ' + pdfSkipped + ' already stored' + (pdfFail ? ', ' + pdfFail + ' failed' : '')
        + (linkedPdf || linkedDue || linkedOfficer || linkedDin ? '; linked from the case folder: ' + linkedPdf + ' PDFs, ' + linkedDue + ' reply dates, ' + linkedOfficer + ' officers, ' + dinSaved + ' DINs' : '') + ').');
      if (gstr3aErrors.length) {
        const realFailures = gstr3aErrors.some((m) => !m.startsWith('DNR rules') && !m.startsWith('DNR debug call failed'));
        try { await GSTKdb.logClientSync(cur.clientId, 'notices_gstr3a_debug', realFailures ? 'failed' : 'success', gstr3aErrors.join(' | ').slice(0, 2000)); } catch (e) { /* diagnostic only */ }
      }
    } catch (e) {
      const msg = (e && e.message) || 'unknown error';
      debugPanel(['STEP: View Notices and Orders  (' + location.pathname + ')', 'DB write failed: ' + msg]);
      banner('Notices & Orders: read ' + rows.length + ' rows but the save failed (' + msg + ') — skipped.' + progress, '#dc2626');
      await logSyncAttempt(job, cur, 'failed', 'Read ' + rows.length + ' rows but the save failed: ' + msg);
      try { await GSTKdb.logStep(job.runId, cur.clientId, 'notices', 'failed', 'save_failed', msg); } catch (e2) { /* diagnostic */ }
    }
  }

  // Rebuilds the exact GSTR-3A "Notice to return defaulter" PDF the portal's
  // own gstr3actrl.js generates client-side via pdfMake — reverse engineered
  // live 2026-08-29 from returnstatic.gst.gov.in/uiassets/js/returns/gstr3actrl.js
  // (a public, unauthenticated static file). `details` is the summary API's
  // response.data (gstin/name/address/ret_period/orderId/retTyp/and, for a
  // cancellation notice, canellationOrderId/cancellationDate/cancelArn/
  // arnDate). All three notice variants (normal / annual retTyp '9' /
  // cancellation retTyp '10') use their ORIGINAL legal wording verbatim —
  // this only reflows it with jsPDF instead of pdfMake, so the sentence text
  // itself must never be edited here independent of the source controller.
  function buildGstr3aNoticePdf(details, dtOfIssue, noticeOrderId) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 40;
    let y = 56;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
    doc.text('Form GSTR-3A', pageWidth / 2, y, { align: 'center' }); y += 22;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
    doc.text('[See rule 68]', pageWidth / 2, y, { align: 'center' }); y += 28;

    doc.setFontSize(10);
    doc.text('Reference No: ' + (details.orderId || noticeOrderId || '-'), margin, y);
    doc.text('Date: ' + (dtOfIssue || '-'), pageWidth - margin, y, { align: 'right' });
    y += 24;

    doc.text('To', margin, y); y += 14;
    doc.text(details.gstin || '-', margin, y); y += 14;
    doc.text(details.name || '-', margin, y); y += 14;
    const addrLines = doc.splitTextToSize(details.address || '-', pageWidth - margin * 2);
    doc.text(addrLines, margin, y); y += addrLines.length * 14 + 12;

    const retTyp = details.retTyp;
    const heading = retTyp === '10'
      ? 'Notice to return defaulter u/s 46 for not filing final return upon cancellation of registration'
      : retTyp === '9'
      ? 'Notice to return defaulter u/s 46 for not filing annual return'
      : 'Notice to return defaulter u/s 46 for not filing return';
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    const headingLines = doc.splitTextToSize(heading, pageWidth - margin * 2);
    doc.text(headingLines, pageWidth / 2, y, { align: 'center' }); y += headingLines.length * 16 + 12;

    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    if (retTyp === '10') {
      doc.text('Cancellation order No.: ' + (details.canellationOrderId || '-'), margin, y);
      doc.text('Date: ' + (details.cancellationDate || '-'), pageWidth - margin, y, { align: 'right' });
      y += 16;
      doc.text('Application Reference Number, if any: ' + (details.cancelArn || '-'), margin, y);
      doc.text('Date: ' + (details.arnDate || '-'), pageWidth - margin, y, { align: 'right' });
      y += 16;
    } else {
      const isAnnual = retTyp === '4X' || retTyp === '9';
      const periodLabel = isAnnual ? 'Financial Year: ' : 'Tax Period: ';
      const periodValue = isAnnual ? (details.ret_period || '-').split(', ')[1] || '-' : (details.ret_period || '-');
      doc.text(periodLabel + periodValue, margin, y);
      doc.text('Type of Return: GSTR-' + (retTyp === '4X' ? '4 (Annual)' : (retTyp || '-')), pageWidth - margin, y, { align: 'right' });
      y += 16;
    }
    y += 16;

    const paragraphs = retTyp === '9' ? [
      'Being a registered taxpayer, you are required to furnish annual return for the supplies made or received and/or to include self-certified reconciliation statement for the aforesaid financial year by due date. The due date specified for filing annual return for the said financial year is over and it has been noticed that you have not filed the said return till date.',
      'You are, therefore, requested to furnish the said return within 15 days failing which appropriate action including imposition of penalty as per law will be taken.',
      'This notice shall be deemed to have been withdrawn in case the return referred above, is filed by you before issue of the show cause notice of penalty proceeding.',
      'This is a system generated notice and does not require signature.',
    ] : retTyp === '10' ? [
      'Consequent upon applying for surrender of registration or cancellation of your registration for the reasons specified in the order, you were required to submit a final return in form GSTR-10 as required under section 45 of the Act.',
      'It has been noticed that you have not filed the final return by the due date.',
      'You are, therefore, requested to furnish the final return as specified under section 45 of the Act within 15 days failing which your tax liability for the aforesaid tax period may be determined in accordance with the provisions of the Act based on the relevant material available with or gathered by this office. Please note that in addition to tax so assessed, you will also be liable to pay interest as per provisions of the Act.',
      'This notice shall be deemed to be withdrawn in case the return is filed by you before issue of the assessment order.',
      'This is a system generated notice and does not require signature.',
    ] : [
      'Being a registered taxpayer, you are required to furnish return for the supplies made or received and to discharge resultant tax liability for the aforesaid tax period by due date. It has been noticed that you have not filed the said return till date.',
      'You are, therefore, requested to furnish the said return within 15 days failing which the tax liability may be assessed u/s 62 of the Act, based on the relevant material available with this office. Please note that in addition to tax so assessed, you will also be liable to pay interest and penalty as per provisions of the Act.',
      'Please note that no further communication will be issued for assessing the liability.',
      'The notice shall be deemed to have been withdrawn in case the return referred above, is filed by you before issue of the assessment order.',
      'This is a system generated notice and will not require signature.',
    ];
    // Said on the PDF itself (audit S-31): this is the portal's text, rebuilt.
    paragraphs.push('Rebuilt by GST Keeper from the GST portal\u2019s GSTR-3A data for ' + (noticeOrderId || 'this notice') + '; the wording is the portal\u2019s own.');
    paragraphs.forEach((p, i) => {
      const lines = doc.splitTextToSize((i + 1) + '. ' + p, pageWidth - margin * 2);
      if (y + lines.length * 14 > pageHeight - margin) { doc.addPage(); y = margin; }
      doc.text(lines, margin, y);
      y += lines.length * 14 + 8;
    });

    return doc.output('datauristring');
  }

  // DD/MM/YYYY for "today" — the notices API wants an explicit upper bound,
  // not an open-ended range.
  function shownTodayDdMmYyyy() {
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    return p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + d.getFullYear();
  }

  async function proceedToRefunds(job) {
    // No registration-date lookup needed here anymore — that only ever
    // existed to work around the old Filing-Year DOM form's empty-list bug,
    // which is moot now that Refunds reads straight from the same JSON API
    // DRC-03 already uses (see handleRefunds). Matches proceedToDrc03's own
    // equally direct routing just below.
    job.step = 'refunds';
    await setJob(job);
    location.href = 'https://services.gst.gov.in/litserv/auth/case/search';
  }

  // Refund applications -> the 3 Refund reports. Every prior approach here
  // (a "Filing Year" DOM form on Track Application Status, scraped various
  // ways over 2026-09-03 through 09-07) was reliably reading the newest
  // financial year as 0 rows even when real data was confirmed present on
  // the portal by hand — never fully explained despite extensive live
  // instrumentation (radio state, settle timing, retries, per-year fresh
  // page loads all ruled out as the cause in turn). Replaced entirely
  // 2026-09-07 with the same JSON API DRC-03 already reads its own case
  // list from (litserv/auth/api/case/search), which has never shown any of
  // that flakiness — confirmed directly from the portal's own public
  // casesearchctrl.js (static.gst.gov.in/uiassets/js/litigation/
  // casesearchctrl.js, no auth needed to fetch): its own "REFUNDS"
  // Application Type branch calls
  //   POST auth/api/case/search {"caseTypeCd": "RFUND", "startDate": fromDate, "endDate": toDate}
  // — the exact same endpoint and shape as DRC-03's 'ADJVP', just a
  // different code. Each result row's actual fields (ARN, amount, refund
  // reason, filing date) sit inside two JSON-encoded strings on the row
  // (appItem.itemJson and caseJson), per that same controller's response
  // handling — not flat top-level fields.
  async function handleRefunds(job, cur, progress) {
    if (!/litserv\/auth\/case\/search/.test(url)) { location.href = 'https://services.gst.gov.in/litserv/auth/case/search'; return; }
    banner('Reading Refund applications…' + progress);
    const pullTs = new Date().toISOString();
    let cases = [];
    let refundsComplete = true;
    try {
      const r = await withTimeout(fetch('https://services.gst.gov.in/litserv/auth/api/case/search', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseTypeCd: 'RFUND', startDate: '01/07/2017', endDate: shownTodayDdMmYyyy() }),
      }), 45000, 'case/search RFUND');
      if (!r.ok) throw new Error('HTTP ' + r.status + ' from case/search');
      cases = await r.json();
      // An error envelope is not "no refunds": nothing is marked missing.
      if (!Array.isArray(cases)) { cases = []; refundsComplete = false; }
    } catch (e) {
      try { await GSTKdb.logStep(job.runId, cur.clientId, 'refunds', 'failed', /timed out/.test(String(e && e.message)) ? 'timeout' : 'portal_error', (e && e.message) || 'unknown error'); } catch (e2) { /* diagnostic */ }
      debugPanel(['STEP: Refund Applications  (' + location.pathname + ')', 'fetch failed: ' + (e && e.message)]);
      banner('Refund applications: could not read the portal API (' + (e && e.message) + ') — skipped.' + progress, '#dc2626');
      try { await GSTKdb.logClientSync(cur.clientId, 'refunds', 'failed', 'PULL FAILED: ' + ((e && e.message) || 'unknown error')); } catch (e2) { /* diagnostic only */ }
      await chainOrStop(job, 'refunds', proceedToDrc03);
      return;
    }

    const allRows = [];
    for (const c of cases) {
      let itemJson = {};
      try { itemJson = JSON.parse((c.appItem && c.appItem.itemJson) || '{}'); } catch (e) { /* leave empty */ }
      // caseJson is parsed by the portal's own controller too (for
      // caseJson.autoFiling) but nothing we save needs it.
      const category = itemJson.refundRsn || null;
      allRows.push({
        client_id: cur.clientId,
        portal_key: c.arn || ('legacy:' + simpleHash(JSON.stringify(c))),
        arn: c.arn || null,
        refund_type: category,
        source_ledger: category && /\bITC\b/i.test(category) ? 'ITC' : null,
        filed_date: ddmmyyyyToIso(String(c.caseCreationDate || '').split(' ')[0]),
        claimed_amount: Number(itemJson.ttlRfdAmt) || 0,
        sanctioned_amount: null,
        status: c.statusDesc || null,
        pulled_at: pullTs, last_seen_at: pullTs, deleted_at: null,
      });
    }

    try { await GSTKdb.ingest(cur.clientId, job.runId, 'refunds', allRows, { complete: refundsComplete }); }
    catch (e) { try { await GSTKdb.logStep(job.runId, cur.clientId, 'refunds', 'failed', 'save_failed', (e && e.message) || 'save failed'); } catch (e2) { /* diagnostic */ } }
    debugPanel([
      'STEP: Refund Applications  (' + location.pathname + ')',
      'rows read         : ' + allRows.length,
    ]);
    // Same durable-logging pattern as before (see git history for why) —
    // keeps a queryable trail in client_sync_log even though this step no
    // longer has a fragile multi-stage DOM flow to diagnose.
    try { await GSTKdb.logClientSync(cur.clientId, 'refunds_debug', 'success', 'build=0.2.0 (JSON API) | rows: ' + allRows.length + ' | arns: ' + allRows.map((r) => r.arn).filter(Boolean).join(',')); } catch (e) { /* diagnostic only */ }
    banner('Refund applications → ' + allRows.length + ' entries saved. Now Refund documents…' + progress, '#16a34a');
    await sleep(500);
    // Document capture (My Applications — ARN-by-ARN, a full page reload
    // per application) used to always run right after this, chained
    // automatically. That made every Refund pull take as long as the
    // slowest, least-verified part of the whole feature even when all
    // that was wanted was an updated application list — confirmed by the
    // user as "going and going and going" with no way to just get the fast
    // part. It's a separate, explicitly-triggered pull now (job.mode
    // 'refund_docs', wired from the Documents page) — this just proceeds
    // straight to DRC-03 (full chain) or stops (standalone pull), the same
    // as every other section pull. The notices bundle (0.7.1) goes on to the
    // documents of new or changed refunds only, then DRC-03.
    if (job.mode === 'notices_bundle') { await proceedToRefundDocs(job); return; }
    await chainOrStop(job, 'refunds', proceedToDrc03);
  }

  async function proceedToRefundDocs(job) {
    job.step = 'refund_docs';
    await setJob(job);
    location.href = 'https://services.gst.gov.in/litserv/auth/case/search';
  }

  // Friendly label per folder-tab code, for the UI's "documents[].tab"
  // column — falls back to the raw code for any section not seen yet rather
  // than silently dropping documents from an unrecognized folder.
  // Confirmed live 2026-09-07 against a real Refund case (see handleRefunds'
  // caseId): the portal's own caseFolderTypeName is already a perfectly
  // good display label ("APPLICATIONS", "NOTICE/ ACKNOWLEDGEMENT", "ORDERS",
  // etc.) — no need to guess codes and maintain a translation table, unlike
  // the Notices capture above (which only had caseFolderTypeCd to go on,
  // hence its own hardcoded map). Kept as a thin fallback only for the rare
  // folder whose typeName the API omits.

  // Document harvest for every refund case the portal has for this client —
  // rewritten 2026-09-07 the same way handleRefunds above was: no DOM
  // interaction at all (no My Applications form, no ARN links, no sidebar
  // tab clicks, no PDF-icon scraping). Every prior version of this function
  // (never confirmed working against a live account) walked "My
  // Applications" by hand; this instead reuses the exact case/folder ->
  // case/folder/items -> getEncrypDocIds -> downloadhb API chain the
  // Notices step's LUT/Additional-Notice-Folder capture already uses
  // successfully (confirmed live 2026-08-24/08-27, see handleNotices above)
  // — that flow already proved every one of these calls works for a
  // litserv/auth/case-family case (LUT is the same "case" concept as Refund
  // and DRC-03, just a different caseTypeCd), so applying it to RFUND here
  // is a much smaller leap than the original from-screenshots DOM approach
  // ever was.
  //
  // For each RFUND case (from case/search, the same call handleRefunds
  // makes):
  //   1. POST case/folder {caseId, gstid, caseTypeCd: 'RFUND'} -> every
  //      folder tab this case has (Applications/Notice/Replies/Orders/…).
  //   2. Per folder: POST case/folder/items {caseFolderId} -> that folder's
  //      items, each carrying an itemJson STRING to parse.
  //   3. Recursively find every doc descriptor ({id, docName}, with or
  //      without a dcupdtls wrapper) anywhere in the parsed JSON — the exact
  //      same findDocDescriptors approach the Notices capture uses, since
  //      where a doc sits inside itemJson varies by section there too.
  //   4. fetchEncrypDocEh(docId, arn) + downloadhb/download/new turns each
  //      into a real PDF; GSTKdb.patchRefundDocument saves the per-ARN list.
  //
  // All within ONE page load — no per-ARN or per-window page reload needed,
  // since none of this touches the DOM. A single case's own folder/document
  // fetches failing never drops another case's documents (best-effort, same
  // contract as the old version); the debug panel reports exactly what was
  // found so a partial run is diagnosable, not silent.
  async function handleRefundDocs(job, cur, progress) {
    if (!/litserv\/auth\/case\/search/.test(url)) { location.href = 'https://services.gst.gov.in/litserv/auth/case/search'; return; }
    banner('Reading Refund documents…' + progress);
    // The Refund Notice Folder rows below carry this run's time (0.7.1: it was
    // never declared here, so those rows were never saved).
    const pullTs = new Date().toISOString();
    let cases = [];
    try {
      const r = await withTimeout(fetch('https://services.gst.gov.in/litserv/auth/api/case/search', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseTypeCd: 'RFUND', startDate: '01/07/2017', endDate: shownTodayDdMmYyyy() }),
      }), 45000, 'case/search RFUND');
      if (!r.ok) throw new Error('HTTP ' + r.status + ' from case/search');
      cases = await r.json();
      if (!Array.isArray(cases)) cases = [];
    } catch (e) {
      if (ledgerJob(job)) { try { await GSTKdb.logStep(job.runId, cur.clientId, 'refund_docs', 'failed', /timed out/.test(String(e && e.message)) ? 'timeout' : 'portal_error', (e && e.message) || 'unknown error'); } catch (e2) { /* diagnostic */ } }
      debugPanel(['STEP: Refund Application Documents  (' + location.pathname + ')', 'fetch failed: ' + (e && e.message)]);
      banner('Refund documents: could not read the portal API (' + (e && e.message) + ') — skipped.' + progress, '#dc2626');
      try { await GSTKdb.logClientSync(cur.clientId, 'refund_docs_debug', 'failed', 'build=' + chrome.runtime.getManifest().version + ' | fetch failed: ' + ((e && e.message) || 'unknown error')); } catch (e2) { /* diagnostic only */ }
      await chainOrStop(job, 'refund_docs', proceedToDrc03);
      return;
    }

    // What is stored already (0.7.1): a document saved once is not downloaded
    // again. In the notices bundle (the scheduled sync) a refund is opened
    // only when this Chrome has not read it in full yet or its status changed
    // since, plus every refund once a week; the Refunds page's own "fetch
    // documents" still opens every refund.
    let known = null;
    try { known = await GSTKdb.knownDocs(cur.clientId); } catch (e) { known = null; }
    const storedByArn = (known && known.refundDocs) || {};
    const storedItems = (known && known.itemDocs) || {};
    const inBundle = job.mode === 'notices_bundle';
    const statusKey = 'gstk_refund_status_' + cur.clientId;
    const fullKey = 'gstk_refund_full_' + cur.clientId;
    const readStatus = ((await store.get(statusKey))[statusKey]) || {};
    const lastFull = ((await store.get(fullKey))[fullKey]) || 0;
    const everyRefund = !inBundle || !known || Date.now() - lastFull > FULL_FOLDER_PASS_MS;
    const stopHeartbeat = startHeartbeat();
    // 0.8.0: refund folder items by reference number, for the link pass that
    // closes this step (refund notices in View Notices and Orders).
    const refundItemByRef = new Map();
    let arnsWithDocs = 0, docsOk = 0, docsFail = 0, casesFailed = 0, casesWithFolderItems = 0, casesSkipped = 0, docsSkipped = 0, casesNoArn = 0;
    for (const c of cases) {
      const arn = c.arn;
      if (!c.caseId || !arn) { casesNoArn++; continue; }
      const stored = Array.isArray(storedByArn[arn]) ? storedByArn[arn] : [];
      const status = c.statusDesc || '';
      if (!everyRefund && readStatus[arn] === status) { casesSkipped++; continue; }
      const arnDocs = [];
      let caseComplete = true;  // every folder and item list read
      let docsMissing = 0;       // documents that failed to download
      // One row per case/folder/items entry, mirroring exactly what the
      // Additional Notice Folder capture (handleNotices above) already
      // writes for LUT/DRC-03 case tasks — this is the ONLY thing feeding
      // AdditionalNoticeFolderPage.tsx's "Refund Notice Folder" view (case
      // header + Applications/Notice-Acknowledgement/Replies/Orders/Audit
      // History sections), which was built and live-verified 2026-09-03 but
      // had no writer for cases outside that separate case/task/get task
      // list. arnDocs above (the flat {tab,label,url} list) stays for
      // gst_refund_applications.documents — AllClientsRefundsPage's own
      // "Documents" column reads that shape specifically, so both writes
      // are needed, not a replacement of one by the other.
      const folderItems = [];
      try {
        const fr = await withTimeout(fetch('https://services.gst.gov.in/litserv/auth/api/case/folder', {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ caseId: c.caseId, gstid: (cur.creds && cur.creds.gstin) || '', caseTypeCd: 'RFUND' }),
        }), 15000, 'case/folder');
        const folders = fr.ok ? await fr.json() : [];
        if (!Array.isArray(folders) || !folders.length) { casesFailed++; continue; }

        const seenDocIds = new Set();
        for (const folder of folders) {
          try {
            const ir = await withTimeout(fetch('https://services.gst.gov.in/litserv/auth/api/case/folder/items', {
              method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ caseFolderId: folder.caseFolderId }),
            }), 15000, 'case/folder/items');
            const items = ir.ok ? await ir.json() : [];
            if (!Array.isArray(items)) { caseComplete = false; continue; }
            const folderLabel = folder.caseFolderTypeName || REFUND_FOLDER_LABELS[folder.caseFolderTypeCd] || folder.caseFolderTypeCd || 'Documents';
            for (const item of items) {
              let parsed = null;
              try { parsed = item.itemJson ? JSON.parse(item.itemJson) : null; } catch (e) { /* skip unparseable item */ }
              const rawDocs = [];
              findDocDescriptors(parsed, new Set(), rawDocs);
              const docArn = (parsed && parsed.crn) || arn;
              const itemRef = item.refId || (parsed && parsed.crn) || null;
              const itemKey = (folder.caseFolderTypeCd || '_') + ':' + (itemRef || simpleHash(JSON.stringify(parsed || item.itemJson || '')));
              const storedAttachments = storedItems[arn + '|' + itemKey] || [];
              const itemAttachments = [];
              for (const doc of rawDocs) {
                if (seenDocIds.has(doc.id)) continue;
                seenDocIds.add(doc.id);
                const mark = '/' + doc.id + '.pdf';
                const had = stored.find((a) => a && typeof a.url === 'string' && a.url.indexOf(mark) !== -1)
                  || storedAttachments.find((a) => a && typeof a.url === 'string' && a.url.indexOf(mark) !== -1);
                if (had) {
                  const label = had.label || doc.docName || doc.docttl || (doc.id + '.pdf');
                  arnDocs.push({ tab: folderLabel, label, url: had.url });
                  itemAttachments.push({ label, url: had.url });
                  docsSkipped++;
                  continue;
                }
                try {
                  const eh = await withTimeout(fetchEncrypDocEh(doc.id, docArn), 15000, 'getEncrypDocIds');
                  if (!eh) { docsFail++; docsMissing++; continue; }
                  const pdfR = await withTimeout(fetch('https://services.gst.gov.in/downloadhb/download/new?docId=' + encodeURIComponent(doc.id) + '&arn=' + encodeURIComponent(docArn) + '&eh=' + encodeURIComponent(eh), { credentials: 'include' }), 20000, 'downloadhb');
                  if (!pdfR.ok) { docsFail++; docsMissing++; continue; }
                  const buf = await withTimeout(pdfR.arrayBuffer(), 15000, 'pdf arrayBuffer');
                  if (!buf || buf.byteLength <= 200) { docsFail++; docsMissing++; continue; } // guard against an HTML error page, not a real PDF
                  const dataUrl = 'data:application/pdf;base64,' + arrayBufferToBase64(buf);
                  const path = 'refund/' + cur.clientId + '/' + arn.replace(/[^A-Za-z0-9]/g, '_') + '/' + doc.id + '.pdf';
                  const url = await withTimeout(GSTKdb.uploadPdf(path, dataUrl), 20000, 'uploadPdf');
                  const label = doc.docName || doc.docttl || (doc.id + '.pdf');
                  arnDocs.push({ tab: folderLabel, label, url });
                  itemAttachments.push({ label, url });
                  docsOk++;
                } catch (e) { docsFail++; docsMissing++; }
              }
              folderItems.push({
                client_id: cur.clientId,
                case_id: arn,
                portal_key: itemKey,
                folder_section: folder.caseFolderTypeCd || null,
                reference_number: itemRef,
                attachments: itemAttachments,
                raw_json: parsed !== null ? parsed : (item.itemJson || null),
                pulled_at: pullTs, last_seen_at: pullTs, deleted_at: null,
              });
              // 0.8.0: an RFD-03 deficiency memo or an RFD-08 show cause
              // notice is listed in View Notices and Orders too, but its PDF
              // and its reply date are here, in the refund case's folder —
              // and the notices step ran before this one, so it had nothing
              // to link. Kept for the link pass at the end of this step.
              if (itemRef && !refundItemByRef.has(itemRef)) {
                refundItemByRef.set(itemRef, { attachments: itemAttachments, raw: parsed });
              }
            }
          } catch (e) { caseComplete = false; /* best-effort per folder */ }
        }
      } catch (e) { casesFailed++; continue; }

      if (arnDocs.length) {
        try { await GSTKdb.patchRefundDocument(cur.clientId, arn, { documents: arnDocs }); arnsWithDocs++; } catch (e) { /* non-fatal */ }
      }
      if (folderItems.length) {
        // A folder that failed to read removes nothing (the same guard as the notices folders).
        try { await GSTKdb.replaceCaseFolderItems(cur.clientId, arn, folderItems, pullTs, { complete: caseComplete }); casesWithFolderItems++; } catch (e) { /* non-fatal */ }
      }
      // Read again next run unless every list and document came through.
      if (caseComplete && !docsMissing) readStatus[arn] = status;
    }
    stopHeartbeat();
    try {
      await store.set({ [statusKey]: readStatus });
      if (inBundle && everyRefund && !casesFailed) await store.set({ [fullKey]: Date.now() });
    } catch (e) { /* the next run reads these refunds again */ }
    if (inBundle && casesFailed && ledgerJob(job)) {
      try { await GSTKdb.logStep(job.runId, cur.clientId, 'refund_docs', 'failed', 'partial', casesFailed + ' refund case folder(s) could not be read.'); } catch (e) { /* diagnostic */ }
    }

    // ── The refund link pass (0.8.0) ────────────────────────────────────
    // RFD-03 and RFD-08 are notices in View Notices and Orders, but their PDF
    // and reply date only exist in the refund case's folder, which this step
    // reads after the notices are already saved. So each one is patched on its
    // own notice row here. Only what is missing is written: the fields a
    // notice already carries are left alone, which is why every patch is read
    // back against the notice list first.
    let refundNoticesLinked = 0, refundLinkFailed = 0, dinWrites = 0, dinRefused = 0, dinGaveUp = false;
    if (refundItemByRef.size) {
      let openNotices = [];
      try { openNotices = await GSTKdb.noticesNeedingDetail(cur.clientId); } catch (e) { openNotices = []; }
      for (const nrow of openNotices) {
        const ref = nrow.reference_number;
        const item = ref ? refundItemByRef.get(ref) : null;
        if (!item) continue;
        const f = noticeFieldsFromItem(item.raw);
        const p = {};
        if (!nrow.pdf_url) { const u = pickNoticeAttachment(item.attachments, ref); if (u) p.pdf_url = u; }
        if (!nrow.due_date && f.due_date) p.due_date = f.due_date;
        if (!nrow.issued_by && f.issued_by) p.issued_by = f.issued_by;
        if (Object.keys(p).length) {
          try { await GSTKdb.patchNoticeFields(cur.clientId, nrow.portal_key, p); refundNoticesLinked++; }
          catch (e) { refundLinkFailed++; }
        }
        // The DIN on its own, as in the notices step: an unknown column must
        // not cost this notice its PDF and date. Three refusals in a row and
        // this run stops offering it.
        if (f.din && !dinGaveUp) {
          try { await GSTKdb.patchNoticeFields(cur.clientId, nrow.portal_key, { din: f.din }); dinWrites++; }
          catch (e) { dinRefused++; if (dinRefused >= 3 && !dinWrites) dinGaveUp = true; }
        }
      }
    }

    debugPanel([
      'STEP: Refund Application Documents  (' + location.pathname + ')',
      'cases read        : ' + cases.length + ' (' + casesFailed + ' folder-fetch failed, ' + casesSkipped + ' unchanged and skipped' + (casesNoArn ? ', ' + casesNoArn + ' without an ARN' : '') + ')',
      'documents captured: ' + docsOk + ' ok, ' + docsSkipped + ' already stored, ' + docsFail + ' failed',
      'applications w/docs: ' + arnsWithDocs,
      'cases w/folder items: ' + casesWithFolderItems + ' (feeds the Refund Notice Folder page)',
      'refund notices linked: ' + refundNoticesLinked + ' (RFD-03 / RFD-08 PDF, reply date, officer)' + (refundLinkFailed ? ', ' + refundLinkFailed + ' failed' : '')
        + (dinWrites ? ', ' + dinWrites + ' DINs' : '') + (dinGaveUp ? ' (DIN writes refused — no din column in this database?)' : ''),
    ]);
    // Same durable-logging gap handleRefunds already learned from (the
    // in-page debug panel above navigates away with the page, leaving no
    // trace to diagnose a failed run from afterward) — this was missed on
    // the first pass of this rewrite, confirmed live 2026-09-07 when a
    // stale-build run left literally no record anywhere that anything had
    // even attempted to run.
    try { await GSTKdb.logClientSync(cur.clientId, 'refund_docs_debug', 'success', 'build=' + chrome.runtime.getManifest().version + ' | cases: ' + cases.length + ' (' + casesFailed + ' folder-fetch failed) | docs: ' + docsOk + ' ok, ' + docsFail + ' failed | applications w/docs: ' + arnsWithDocs + ' | cases w/folder items: ' + casesWithFolderItems); } catch (e) { /* diagnostic only */ }
    banner('Refund documents → ' + docsOk + ' captured, ' + docsSkipped + ' already stored, across ' + arnsWithDocs + ' application(s).' + progress, '#16a34a');
    await sleep(1000);
    await chainOrStop(job, 'refund_docs', proceedToDrc03);
  }

  async function proceedToDrc03(job) {
    job.step = 'drc03';
    await setJob(job);
    location.href = 'https://services.gst.gov.in/litserv/auth/case/search';
  }

  // DRC-03 voluntary payments -> the 3 DRC-03 reports, with full per-head
  // detail and a saved copy of each filing's PDF. services.gst.gov.in's own
  // JSON APIs — case/search (caseTypeCd=ADJVP), usr/getEncrypDocIds, and the
  // downloadhb/download/new PDF endpoint — all same-origin, all confirmed
  // live (the eh token in the PDF url was found by walking the live
  // AngularJS $rootScope tree for a scope exposing getEncrypDocIdMap, since
  // this app disables Angular's DOM debug info — element.scope() doesn't
  // work here, but the $$childHead/$$nextSibling scope-tree pointers aren't
  // disabled by that setting). The portal UI limits a search to a 3-month
  // window, but that's a FRONTEND validation only; case/search itself
  // accepts the full history in one call, confirmed live back to 2022.
  //
  // Per case (filing), the liability-detail lines (one per head x period)
  // are SUMMED into filing-level totals: igst/cgst/sgst/cess_amount,
  // taxable_value, interest_amount, late_fee_amount (portal's "fees"),
  // penalty_amount. cash_amount/credit_amount: a line's ldgrut is "Cash",
  // "Credit", or "Cash/Credit" for a split payment with NO further
  // breakdown available in this data — a "Cash/Credit" line's full amount
  // is attributed to cash_amount (its debit-number field lists the Cash
  // debit first) so the portal's own total keeps reconciling. This means
  // the "Voluntary Payment of Credit Ledger" report can UNDERSTATE
  // credit-ledger DRC-03s that were part of a split payment — a real data
  // limitation, not a bug.
  async function handleDrc03(job, cur, progress) {
    if (!/litserv\/auth\/case\/search/.test(url)) { location.href = 'https://services.gst.gov.in/litserv/auth/case/search'; return; }
    banner('Reading DRC-03 filings…' + progress);
    const pullTs = new Date().toISOString();
    let cases = [];
    let drc03Complete = true;
    try {
      const r = await withTimeout(fetch('https://services.gst.gov.in/litserv/auth/api/case/search', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseTypeCd: 'ADJVP', startDate: '01/07/2017', endDate: shownTodayDdMmYyyy() }),
      }), 45000, 'case/search ADJVP');
      if (!r.ok) throw new Error('HTTP ' + r.status + ' from case/search');
      cases = await r.json();
      if (!Array.isArray(cases)) { cases = []; drc03Complete = false; }
    } catch (e) {
      try { await GSTKdb.logStep(job.runId, cur.clientId, 'drc03', 'failed', /timed out/.test(String(e && e.message)) ? 'timeout' : 'portal_error', (e && e.message) || 'unknown error'); } catch (e2) { /* diagnostic */ }
      debugPanel(['STEP: DRC-03 Filings  (' + location.pathname + ')', 'fetch failed: ' + (e && e.message)]);
      banner('DRC-03: could not read the portal API (' + (e && e.message) + ') — skipped.' + progress, '#dc2626');
      try { await GSTKdb.logClientSync(cur.clientId, 'drc03', 'failed', 'PULL FAILED: ' + ((e && e.message) || 'unknown error')); } catch (e2) { /* diagnostic only */ }
      await sleep(1500);
      if (job.mode === 'notices_bundle') { await proceedToApplications(job); return; }
      await chainOrStop(job, 'drc03', proceedToTaxpayerProfile);
      return;
    }

    const rows = [];
    let pdfOk = 0, pdfFail = 0, pdfSkipped = 0;
    let knownDrc = {};
    try { knownDrc = ((await GSTKdb.knownDocs(cur.clientId)) || {}).drc03Pdf || {}; } catch (e) { knownDrc = {}; }
    const stopHeartbeat = startHeartbeat();
    for (const c of cases) {
      const row = parseDrc03Case(c, cur.clientId);
      if (!row) continue;
      row.portal_key = row.arn || ('legacy:' + simpleHash(JSON.stringify(c)));
      row.pulled_at = pullTs; row.last_seen_at = pullTs; row.deleted_at = null;
      // Best-effort PDF capture — one document per filing (the DRC-03 form
      // itself), skipped when that PDF is already stored. A failure here
      // must not drop the filing's own figures.
      try {
        const docId = row.__docId;
        if (docId && row.arn && knownDrc[row.arn]) {
          pdfSkipped++;
        } else if (docId) {
          const eh = await fetchEncrypDocEh(docId, row.arn);
          if (eh) {
            const pdfR = await fetch('https://services.gst.gov.in/downloadhb/download/new?docId=' + encodeURIComponent(docId) + '&arn=' + encodeURIComponent(row.arn) + '&eh=' + encodeURIComponent(eh), { credentials: 'include' });
            if (pdfR.ok) {
              const buf = await pdfR.arrayBuffer();
              const dataUrl = 'data:application/pdf;base64,' + arrayBufferToBase64(buf);
              const path = 'drc03/' + cur.clientId + '/' + (row.arn || docId) + '.pdf';
              row.pdf_url = await GSTKdb.uploadPdf(path, dataUrl);
              pdfOk++;
            } else pdfFail++;
          } else pdfFail++;
        }
      } catch (e) { pdfFail++; }
      delete row.__docId;
      rows.push(row);
    }

    stopHeartbeat();
    // The ingest also runs the closing sweep (acknowledged DRC-03 payments
    // close their voluntary-payment case rows).
    try { await GSTKdb.ingest(cur.clientId, job.runId, 'drc03', rows, { complete: drc03Complete }); }
    catch (e) { try { await GSTKdb.logStep(job.runId, cur.clientId, 'drc03', 'failed', 'save_failed', (e && e.message) || 'save failed'); } catch (e2) { /* diagnostic */ } }
    debugPanel([
      'STEP: DRC-03 Filings  (' + location.pathname + ')',
      'cases read        : ' + cases.length,
      'rows saved        : ' + rows.length,
      'PDFs              : ' + pdfOk + ' downloaded, ' + pdfSkipped + ' already stored, ' + pdfFail + ' failed',
    ]);
    banner('DRC-03 filings → ' + rows.length + ' entries saved (' + pdfOk + ' new PDFs, ' + pdfSkipped + ' already stored).' + progress, '#16a34a');
    await sleep(1000);
    if (job.mode === 'notices_bundle') { await proceedToApplications(job); return; }
    await chainOrStop(job, 'drc03', proceedToTaxpayerProfile);
  }

  // Applications on the portal (0.6.0, audit S-22): the portal's own "My
  // Applications" types read with the same case search refunds and DRC-03
  // use (codes from the portal's public casesearchctrl.js): appeals (APL-01),
  // rectification, objection to a provisional attachment, the s.128A waiver,
  // compounding and provisional assessment. A type that fails or comes back
  // empty removes nothing (sync_ingest_applications).
  async function proceedToApplications(job) {
    job.step = 'applications';
    await setJob(job);
    location.href = 'https://services.gst.gov.in/litserv/auth/case/search';
  }
  function parseApplication(c, code) {
    let cj = c && c.caseJson;
    if (typeof cj === 'string') { try { cj = JSON.parse(cj); } catch (e) { cj = null; } }
    const arn = (c && c.arn) || (cj && cj.arn) || null;
    const caseId = (c && c.caseId) || null;
    const key = arn || caseId;
    if (!key) return null;
    const t = APPLICATION_TYPES[code];
    return {
      case_type_cd: code, portal_key: String(key), arn, case_id: caseId,
      form_number: (cj && (cj.formNo || cj.formNumber)) || t.form,
      form_description: (cj && (cj.formDesc || cj.formDescription)) || c.caseName || t.label,
      status: c.statusDesc || (cj && cj.status) || c.status || null,
      filed_date: ddmmyyyyToIso(String(c.caseCreationDate || '').slice(0, 10)) || null,
      raw_json: Object.assign({}, c, { caseJson: cj }),
    };
  }
  async function handleApplications(job, cur, progress) {
    if (!/litserv\/auth\/case\/search/.test(url)) { location.href = 'https://services.gst.gov.in/litserv/auth/case/search'; return; }
    banner('Reading applications on the portal (appeals, rectification…)' + progress);
    const rows = [];
    const typesRead = [];
    const failed = [];
    for (const code of Object.keys(APPLICATION_TYPES)) {
      try {
        const r = await withTimeout(fetch('https://services.gst.gov.in/litserv/auth/api/case/search', {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ caseTypeCd: code, startDate: '01/07/2017', endDate: shownTodayDdMmYyyy() }),
        }), 30000, 'case/search ' + code);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const list = await r.json();
        if (!Array.isArray(list)) throw new Error('not a list');
        typesRead.push(code);
        for (const c of list) { const row = parseApplication(c, code); if (row) rows.push(row); }
      } catch (e) { failed.push(code + ': ' + ((e && e.message) || 'failed')); }
      await sleep(300);
    }
    let saved = null;
    if (typesRead.length) {
      try { saved = await GSTKdb.ingestApplications(cur.clientId, job.runId, rows, typesRead, true); }
      catch (e) { failed.push('save: ' + ((e && e.message) || 'failed')); }
    }
    if (failed.length && ledgerJob(job)) {
      try { await GSTKdb.logStep(job.runId, cur.clientId, 'applications', 'failed', 'portal_error', failed.join(' | ').slice(0, 500)); } catch (e) { /* diagnostic */ }
    }
    debugPanel([
      'STEP: Applications on the portal  (' + location.pathname + ')',
      'types read        : ' + (typesRead.join(', ') || 'none'),
      'applications      : ' + rows.length + (saved && saved.status === 'ok' ? ' (' + saved.new + ' new, ' + saved.changed + ' changed)' : ''),
      ...(failed.length ? ['failed            : ' + failed.join(' | ')] : []),
    ]);
    banner('Applications → ' + rows.length + ' read. Now the taxpayer profile…' + progress, '#16a34a');
    await sleep(800);
    await proceedToTaxpayerProfile(job);
  }

  async function proceedToTaxpayerProfile(job) {
    job.step = 'taxpayerprofile';
    await setJob(job);
    location.href = 'https://services.gst.gov.in/services/auth/myprofile';
  }

  // Taxpayer Information + Registration Certificate. services.gst.gov.in's
  // own JSON API (profile/detail), confirmed live — exact match against the
  // rendered "My Profile" page. The Registration Certificate PDF is a much
  // simpler flow than DRC-03's: GET api/get/regcert returns {docid,
  // applnId}, then GET /document/{docid}/{applnId} serves the PDF directly —
  // no hash token needed, confirmed live with real PDF bytes.
  async function handleTaxpayerProfile(job, cur, progress) {
    if (!/\/services\/auth\/myprofile/.test(url)) { location.href = 'https://services.gst.gov.in/services/auth/myprofile'; return; }
    banner('Reading Taxpayer Profile…' + progress);
    let patchObj = null;
    try {
      const r = await fetch('https://services.gst.gov.in/services/auth/profile/detail', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      if (!r.ok) throw new Error('HTTP ' + r.status + ' from profile/detail');
      const j = await r.json();
      patchObj = {
        // 0.6.0: registration status (Active / Cancelled / Suspended) and the raw profile.
        gstin_status: j.sts || j.gstinStatus || j.status || null,
        cancellation_date: ddmmyyyyToIso(j.cxdt || ''),
        profile_json: j,
        legal_name: j.lgnm || null, trade_name: j.tradeNam || null, constitution_of_business: j.ctb || null,
        registration_date: ddmmyyyyToIso(j.rgdt || ''), jurisdiction_state: j.stj || null, jurisdiction_centre: j.ctj || null,
        principal_place_address: (j.pradr && j.pradr.adr) || null, aadhaar_authentication_status: j.adhrVFlag || null,
        updated_at: new Date().toISOString(),
      };
    } catch (e) {
      debugPanel(['STEP: Taxpayer Profile  (' + location.pathname + ')', 'fetch failed: ' + (e && e.message)]);
      banner('Taxpayer Profile: could not read the portal API (' + (e && e.message) + ') — skipped.' + progress, '#dc2626');
      await sleep(1500);
      await chainOrStop(job, ['taxpayerprofile', 'notices_bundle'], proceedToChallans);
      return;
    }

    // Registration certificate PDF — best-effort, must not drop the profile
    // fields above if it fails. The notices bundle reads only the profile.
    if (job.mode !== 'notices_bundle') try {
      const cr = await fetch('https://services.gst.gov.in/services/auth/api/get/regcert', { credentials: 'include' });
      if (cr.ok) {
        const cj = await cr.json();
        if (cj && cj.docid && cj.applnId) {
          const pdfR = await fetch('https://services.gst.gov.in/document/' + cj.docid + '/' + cj.applnId, { credentials: 'include' });
          if (pdfR.ok) {
            const buf = await pdfR.arrayBuffer();
            const dataUrl = 'data:application/pdf;base64,' + arrayBufferToBase64(buf);
            const path = 'regcert/' + cur.clientId + '.pdf';
            patchObj.registration_certificate_url = await GSTKdb.uploadPdf(path, dataUrl);
          }
        }
      }
    } catch (e) { /* non-fatal */ }

    try { await GSTKdb.upsertTaxpayerProfile(cur.clientId, patchObj); } catch (e) { /* non-fatal */ }
    debugPanel([
      'STEP: Taxpayer Profile  (' + location.pathname + ')',
      'legal name        : ' + (patchObj.legal_name || '(none)'),
      'registration cert : ' + (patchObj.registration_certificate_url ? 'saved' : 'not captured'),
    ]);
    banner('Taxpayer Profile → saved.' + progress, '#16a34a');
    await sleep(1000);
    await chainOrStop(job, ['taxpayerprofile', 'notices_bundle'], proceedToChallans);
  }

  async function proceedToChallans(job) {
    job.step = 'challans';
    await setJob(job);
    location.href = 'https://payment.gst.gov.in/payment/auth/challanhistory';
  }

  // Challan Summary. payment.gst.gov.in's own JSON API
  // (payment/auth/challan/getlist?fm_dt=..&to_dt=..&gstin=..), confirmed
  // live — already includes the full CGST/SGST/IGST/Cess breakdown, no need
  // to open each challan individually. The portal enforces a real
  // server-side date-range cap per call (confirmed live: ~5.5 months works,
  // 6 months fails with error PMT9071 "Invalid Search Limit"), so this walks
  // history in fixed 150-day windows back to GST inception (01/07/2017).
  async function handleChallans(job, cur, progress) {
    if (!/payment\.gst\.gov\.in/.test(location.hostname) || !/challanhistory/.test(url)) {
      location.href = 'https://payment.gst.gov.in/payment/auth/challanhistory';
      return;
    }
    banner('Reading Challan Summary…' + progress);
    const gstin = cur.creds && cur.creds.gstin;
    if (!gstin) { banner('No GSTIN on record for Challan Summary — skipped.' + progress, '#f59e0b'); await advance(job); return; }

    const p2 = (n) => String(n).padStart(2, '0');
    const fmt = (d) => p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + d.getFullYear();
    const windows = [];
    let winStart = new Date(2017, 6, 1); // 01 Jul 2017 — GST inception
    const today = new Date();
    while (winStart <= today) {
      const winEnd = new Date(winStart.getTime() + 149 * 24 * 60 * 60 * 1000);
      windows.push([fmt(winStart), fmt(winEnd > today ? today : winEnd)]);
      winStart = new Date(winEnd.getTime() + 24 * 60 * 60 * 1000);
    }

    const seen = new Map();
    let windowsFailed = 0;
    for (const [fm, to] of windows) {
      try {
        const r = await fetch('https://payment.gst.gov.in/payment/auth/challan/getlist?fm_dt=' + fm + '&to_dt=' + to + '&gstin=' + encodeURIComponent(gstin), { credentials: 'include' });
        if (!r.ok) { windowsFailed++; continue; }
        const list = await r.json();
        if (!Array.isArray(list)) { windowsFailed++; continue; }
        for (const c of list) {
          if (!c.cpin || seen.has(c.cpin)) continue;
          seen.set(c.cpin, {
            client_id: cur.clientId, cpin: c.cpin,
            challan_date: ddmmyyyyToIso((c.chln_cre_dt || '').split(' ')[0]),
            payment_mode: c.payment_mod || null,
            total_amount: Number(c.total_amt) || 0,
            cgst_amount: Number(c.cgst_tot_amt) || 0, sgst_amount: Number(c.sgst_tot_amt) || 0,
            igst_amount: Number(c.igst_tot_amt) || 0, cess_amount: Number(c.cess_tot_amt) || 0,
            status: c.status === 'S' ? 'PAID' : c.status === 'F' ? 'FAILED' : (c.status || null),
          });
        }
      } catch (e) { windowsFailed++; }
    }

    const rows = [...seen.values()];
    try { await GSTKdb.replaceChallans(cur.clientId, rows); } catch (e) { /* non-fatal */ }
    debugPanel([
      'STEP: Challan Summary  (' + location.pathname + ')',
      'windows checked   : ' + windows.length + ' (150-day steps back to 01/07/2017)',
      'windows failed    : ' + windowsFailed,
      'rows saved        : ' + rows.length,
    ]);
    banner('Challan Summary → ' + rows.length + ' entries saved.' + progress, '#16a34a');
    await sleep(1000);
    await advance(job);
  }

  // GSTR-3B (filed) — as-filed figures pulled directly from the portal's own
  // JSON API instead of the app's computed/manual draft. Confirmed live
  // (2026-08-21, real filed July 2026-27 return): return.gst.gov.in's
  // api/gstr3b/summary?rtn_prd=MMYYYY returns every table (3.1, 3.1.1, 3.2, 4,
  // 5, 5.1, 6.1) as clean numeric JSON, and api/formdetails?rtn_prd=MMYYYY&
  // rtn_typ=GSTR3B gives the ARN/filed date/status — both same-origin GETs,
  // no dashboard tile clicks or Excel download needed. Confirmed working from
  // the GSTR-3B page itself (reached via View e-Filed Returns); calling it
  // straight from the Returns Dashboard is inferred (session cookies are
  // origin-scoped and rtn_prd is explicit in the query, so no reason it
  // shouldn't), not separately re-confirmed — if it ever 403s/returns empty
  // from here, fall back to searching View e-Filed Returns and clicking
  // through to the gstr3b page first, the way handleReturnPdf already does.
  // Single period per pull (job.period), not a full-history walk like
  // Challans/DRC-03 — this is what the Reports Hub / Documents "Pull" button
  // asks for.
  async function handleGstr3bPull(job, cur, progress) {
    if (!/return\.gst\.gov\.in/.test(location.hostname)) { location.href = 'https://return.gst.gov.in/returns/auth/dashboard'; return; }
    const [mm, yyyy] = String(job.period || '').split('/').map((n) => parseInt(n, 10));
    if (!mm || !yyyy) { banner('Bad GSTR-3B period.', '#dc2626'); await clearJob(); return; }
    const rtnPrd = String(mm).padStart(2, '0') + yyyy;
    banner('Reading filed GSTR-3B for ' + job.period + '…' + progress);

    let summary = null, form = null;
    try {
      const [sr, fr] = await Promise.all([
        fetch('https://return.gst.gov.in/returns/auth/api/gstr3b/summary?rtn_prd=' + rtnPrd, { credentials: 'include' }),
        fetch('https://return.gst.gov.in/returns/auth/api/formdetails?rtn_prd=' + rtnPrd + '&rtn_typ=GSTR3B', { credentials: 'include' }),
      ]);
      if (sr.ok) { const sj = await sr.json(); if (sj && sj.status === 1) summary = sj.data; }
      if (fr.ok) { const fj = await fr.json(); if (fj && fj.status === 1) form = fj.data; }
    } catch (e) {
      banner('GSTR-3B: could not read the portal API (' + (e && e.message) + ') — skipped.' + progress, '#dc2626');
      try { await GSTKdb.upsertFiledReturn(cur.clientId, job.period, 'GSTR3B', { status: 'PULL FAILED: ' + ((e && e.message) || 'unknown error') }); } catch (e2) { /* diagnostic only */ }
      await sleep(1200);
      await advance(job);
      return;
    }

    if (!summary && !form) {
      banner('GSTR-3B not found on the portal for ' + job.period + ' — has it been filed?' + progress, '#f59e0b');
      try { await GSTKdb.upsertFiledReturn(cur.clientId, job.period, 'GSTR3B', { status: 'NOT FILED / NOT FOUND' }); } catch (e2) { /* diagnostic only */ }
      await sleep(1200);
      await advance(job);
      return;
    }

    const patchObj = {
      arn: (form && form.arn) || null,
      filed_date: form && form.fil_dt ? ddmmyyyyToIso(form.fil_dt.replace(/-/g, '/')) : null,
      status: form && form.status === 'FIL' ? 'Filed' : ((form && form.status) || null),
      summary: summary || {},
      updated_at: new Date().toISOString(),
    };
    try { await GSTKdb.upsertFiledReturn(cur.clientId, job.period, 'GSTR3B', patchObj); } catch (e) { /* non-fatal */ }
    debugPanel([
      'STEP: GSTR-3B (filed)  (' + location.pathname + ')',
      'ARN               : ' + (patchObj.arn || '(none)'),
      'status            : ' + (patchObj.status || '(unknown)'),
    ]);
    banner('GSTR-3B ' + job.period + ' → saved ✓.' + progress, '#16a34a');
    await sleep(800);
    await advance(job);
  }

  // GSTR-9 system-computed (annual) — for the Annual Return workspace's
  // "Portal data" step (mode 'gstr9_pull', started with __gstkPullSection,
  // period '03/YYYY' = the FY's closing March). The endpoint is the one the
  // portal's own GSTR-9 page calls — gstr9ctrl.js getSumData():
  //   ajax.get("/returns2/auth/api/gstr9/details/calc", { ret_period, gstin })
  // answering { status: 1, data: { table4, table5, table6, table8, table9, … } }.
  // It was read from that script, NOT yet exercised live. formdetails
  // (rtn_typ=GSTR9) gives the ARN / filed date / status, same as GSTR-3B.
  // GET only — this never calls any save / submit / compute / file endpoint.
  // On a cold session the returns2 app can answer with HTML / 403 until its
  // own page has been opened once, so the first failure opens the Annual
  // Return page (guarded by job.gstr9Warmed, so only once) and retries on
  // that page's load; a second failure is recorded as 'PULL FAILED: …' so the
  // app stops waiting and offers Upload instead. The raw JSON is kept as-is
  // (return_type 'GSTR9_CALC'); the app parses and previews it before use.
  async function handleGstr9Pull(job, cur, progress) {
    if (!/return\.gst\.gov\.in/.test(location.hostname)) { location.href = 'https://return.gst.gov.in/returns/auth/dashboard'; return; }
    const failGstr9 = async (reason) => {
      try { await GSTKdb.upsertFiledReturn(cur.clientId, job.period, 'GSTR9_CALC', { status: 'PULL FAILED: ' + reason, updated_at: new Date().toISOString() }); } catch (e2) { /* diagnostic only */ }
    };
    const [mm, yyyy] = String(job.period || '').split('/').map((n) => parseInt(n, 10));
    if (mm !== 3 || !yyyy) {
      banner('Bad GSTR-9 period "' + job.period + '" (expected 03/YYYY).', '#dc2626');
      await sleep(1500);
      await advance(job);
      return;
    }
    const retPeriod = '03' + yyyy;
    const fyLabel = (yyyy - 1) + '-' + String(yyyy).slice(-2);
    const gstin = cur.creds && cur.creds.gstin;
    if (!gstin) {
      banner('No GSTIN on record for ' + cur.creds.name + ' — GSTR-9 skipped.' + progress, '#dc2626');
      await failGstr9('no GSTIN on record for this client');
      await sleep(1500);
      await advance(job);
      return;
    }
    // Second attempt, on the Annual Return page: let its own scripts set the session up first.
    if (job.gstr9Warmed) await sleep(3000);
    banner('Reading GSTR-9 system-computed figures for FY ' + fyLabel + '…' + progress);

    let calc = null;
    let calcErr = '';
    try {
      const r = await fetch('https://return.gst.gov.in/returns2/auth/api/gstr9/details/calc?ret_period=' + retPeriod + '&gstin=' + encodeURIComponent(gstin), { credentials: 'include', headers: { Accept: 'application/json' } });
      const text = await r.text();
      let j = null;
      try { j = JSON.parse(text); } catch (e) { /* HTML (login / error page) */ }
      if (r.ok && j && j.status === 1 && j.data && typeof j.data === 'object') calc = j.data;
      else if (j && j.error) calcErr = String(j.error.message || j.error.errorCode || JSON.stringify(j.error)).slice(0, 200);
      else calcErr = 'HTTP ' + r.status + (j ? ' (status ' + j.status + ')' : ', not JSON');
    } catch (e) {
      calcErr = (e && e.message) || 'network error';
    }

    if (!calc) {
      if (!job.gstr9Warmed) {
        job.gstr9Warmed = true;
        await setJob(job);
        banner('GSTR-9 not ready on this session yet (' + calcErr + ') — opening the Annual Return page once and retrying…' + progress, '#f59e0b');
        location.href = 'https://return.gst.gov.in/returns2/auth/annualreturn';
        return;
      }
      delete job.gstr9Warmed;
      await setJob(job);
      banner('GSTR-9: could not read the system-computed figures (' + calcErr + ') — use Upload in GST Keeper instead.' + progress, '#dc2626');
      await failGstr9(calcErr);
      await sleep(1500);
      await advance(job);
      return;
    }

    let form = null;
    try {
      const fr = await fetch('https://return.gst.gov.in/returns/auth/api/formdetails?rtn_prd=' + retPeriod + '&rtn_typ=GSTR9', { credentials: 'include' });
      if (fr.ok) { const fj = await fr.json(); if (fj && fj.status === 1) form = fj.data; }
    } catch (e) { /* non-fatal: only ARN / filed date / status come from here */ }

    const arn = (form && form.arn) || (typeof calc.arn === 'string' && calc.arn) || null;
    const filedOn = (form && form.fil_dt) || (typeof calc.arn_dt === 'string' && calc.arn_dt) || null;
    const patchObj = {
      summary: calc,
      arn,
      filed_date: filedOn ? ddmmyyyyToIso(String(filedOn).replace(/-/g, '/')) : null,
      status: form ? (form.status === 'FIL' ? 'Filed' : (form.status ? String(form.status) : 'Not filed')) : (arn ? 'Filed' : 'Not filed'),
      updated_at: new Date().toISOString(),
    };
    delete job.gstr9Warmed;
    await setJob(job);
    try {
      await GSTKdb.upsertFiledReturn(cur.clientId, job.period, 'GSTR9_CALC', patchObj);
    } catch (e) {
      banner('GSTR-9: read from the portal but could not be saved (' + ((e && e.message) || 'unknown error') + ').' + progress, '#dc2626');
      await sleep(2000);
      await advance(job);
      return;
    }
    debugPanel([
      'STEP: GSTR-9 system computed  (' + location.pathname + ')',
      'ret_period        : ' + retPeriod,
      'tables            : ' + ['table4', 'table5', 'table6', 'table8', 'table9'].filter((k) => calc[k]).join(', '),
      'ARN               : ' + (patchObj.arn || '(none)'),
      'status            : ' + patchObj.status,
    ]);
    banner('GSTR-9 FY ' + fyLabel + ' → saved ✓. Review and apply it in GST Keeper (Annual Return → Portal data).' + progress, '#16a34a');
    await sleep(800);
    await advance(job);
  }

  // GSTR-1 (filed) — same idea as GSTR-3B above. api/gstr1/summary?
  // rtn_prd=MMYYYY returns the full section-wise breakdown (B2B, B2CL, B2CS,
  // EXP, CDNR, HSN, NIL, DOC_ISSUE, TTL_LIAB…) with tax values per section,
  // confirmed live matching GSTR-3B's own outward-supply figures exactly.
  // formdetails?rtn_typ=GSTR1 for the ARN/filed date is INFERRED from the
  // GSTR-3B pattern, not separately confirmed live — a failure there is
  // caught and treated as non-fatal (the summary figures still save) rather
  // than dropping the whole pull.
  async function handleGstr1Pull(job, cur, progress) {
    if (!/return\.gst\.gov\.in/.test(location.hostname)) { location.href = 'https://return.gst.gov.in/returns/auth/dashboard'; return; }
    const [mm, yyyy] = String(job.period || '').split('/').map((n) => parseInt(n, 10));
    if (!mm || !yyyy) { banner('Bad GSTR-1 period.', '#dc2626'); await clearJob(); return; }
    const rtnPrd = String(mm).padStart(2, '0') + yyyy;
    banner('Reading filed GSTR-1 for ' + job.period + '…' + progress);

    let summary = null, form = null;
    try {
      const sr = await fetch('https://return.gst.gov.in/returns/auth/api/gstr1/summary?rtn_prd=' + rtnPrd, { credentials: 'include' });
      if (sr.ok) { const sj = await sr.json(); if (sj && sj.status === 1) summary = sj.data; }
    } catch (e) {
      banner('GSTR-1: could not read the portal API (' + (e && e.message) + ') — skipped.' + progress, '#dc2626');
      try { await GSTKdb.upsertFiledReturn(cur.clientId, job.period, 'GSTR1', { status: 'PULL FAILED: ' + ((e && e.message) || 'unknown error') }); } catch (e2) { /* diagnostic only */ }
      await sleep(1200);
      await advance(job);
      return;
    }
    // Best-effort ARN/filed-date — non-fatal if this endpoint differs from
    // the GSTR-3B one (unverified, see comment above).
    try {
      const fr = await fetch('https://return.gst.gov.in/returns/auth/api/formdetails?rtn_prd=' + rtnPrd + '&rtn_typ=GSTR1', { credentials: 'include' });
      if (fr.ok) { const fj = await fr.json(); if (fj && fj.status === 1) form = fj.data; }
    } catch (e) { /* non-fatal, see comment above */ }

    if (!summary) {
      banner('GSTR-1 not found on the portal for ' + job.period + ' — has it been filed?' + progress, '#f59e0b');
      try { await GSTKdb.upsertFiledReturn(cur.clientId, job.period, 'GSTR1', { status: 'NOT FILED / NOT FOUND' }); } catch (e2) { /* diagnostic only */ }
      await sleep(1200);
      await advance(job);
      return;
    }

    const patchObj = {
      arn: (form && form.arn) || null,
      filed_date: form && form.fil_dt ? ddmmyyyyToIso(form.fil_dt.replace(/-/g, '/')) : null,
      status: form && form.status === 'FIL' ? 'Filed' : ((form && form.status) || 'Filed'),
      summary: summary || {},
      updated_at: new Date().toISOString(),
    };
    try { await GSTKdb.upsertFiledReturn(cur.clientId, job.period, 'GSTR1', patchObj); } catch (e) { /* non-fatal */ }
    debugPanel([
      'STEP: GSTR-1 (filed)  (' + location.pathname + ')',
      'ARN               : ' + (patchObj.arn || '(none — formdetails rtn_typ=GSTR1 unverified)'),
      'status            : ' + (patchObj.status || '(unknown)'),
    ]);
    banner('GSTR-1 ' + job.period + ' → saved ✓.' + progress, '#16a34a');
    await sleep(800);
    await advance(job);
  }

  // GSTR-2A (B2B only) — same return.gst.gov.in origin as GSTR-3B/1, no tile
  // click needed. Confirmed live: api/gstr2a/ctin?rtn_prd=MMYYYY&section_name=B2B
  // returns the counterparty list (stin/cname/filing status), then
  // api/gstr2a/b2b?rtn_prd=MMYYYY&ctin=<gstin> per counterparty returns its
  // invoices with item-level tax split + IRN. This is a real N+1 fetch loop
  // (one call per counterparty) run synchronously in-page — no navigation
  // between them, so no job-state chaining needed, but a real client with
  // many suppliers means many sequential GETs; the small sleep between them
  // is deliberate, not a bug. Only the B2B section is covered — CDNR/ISD/TDS/
  // TCS use the same ctin+section_name pattern per the page's own tabs but
  // were not separately confirmed live.
  async function handleGstr2aPull(job, cur, progress) {
    if (!/return\.gst\.gov\.in/.test(location.hostname)) { location.href = 'https://return.gst.gov.in/returns/auth/dashboard'; return; }
    const [mm, yyyy] = String(job.period || '').split('/').map((n) => parseInt(n, 10));
    if (!mm || !yyyy) { banner('Bad GSTR-2A period.', '#dc2626'); await clearJob(); return; }
    const rtnPrd = String(mm).padStart(2, '0') + yyyy;
    banner('Reading GSTR-2A (B2B) for ' + job.period + '…' + progress);

    let ctinList = [];
    try {
      const cr = await fetch('https://return.gst.gov.in/returns/auth/api/gstr2a/ctin?rtn_prd=' + rtnPrd + '&section_name=B2B', { credentials: 'include' });
      if (cr.ok) { const cj = await cr.json(); if (Array.isArray(cj.cpty)) ctinList = cj.cpty; }
    } catch (e) {
      banner('GSTR-2A: could not read the portal API (' + (e && e.message) + ') — skipped.' + progress, '#dc2626');
      try { await GSTKdb.upsertFiledReturn(cur.clientId, job.period, 'GSTR2A', { status: 'PULL FAILED: ' + ((e && e.message) || 'unknown error') }); } catch (e2) { /* diagnostic only */ }
      await sleep(1200);
      await advance(job);
      return;
    }

    if (ctinList.length === 0) {
      banner('No GSTR-2A B2B counterparties for ' + job.period + '.' + progress, '#f59e0b');
      try { await GSTKdb.upsertFiledReturn(cur.clientId, job.period, 'GSTR2A', { status: 'NO DATA / NOT FOUND', summary: { b2b: [] } }); } catch (e2) { /* diagnostic only */ }
      await sleep(1200);
      await advance(job);
      return;
    }

    const nameByCtin = new Map(ctinList.map((c) => [c.stin, c.cname]));
    const docs = [];
    let failed = 0;
    for (const c of ctinList) {
      try {
        const r = await fetch('https://return.gst.gov.in/returns/auth/api/gstr2a/b2b?rtn_prd=' + rtnPrd + '&ctin=' + encodeURIComponent(c.stin), { credentials: 'include' });
        if (r.ok) {
          const j = await r.json();
          if (Array.isArray(j.b2b)) {
            for (const d of j.b2b) docs.push({ ctin: d.ctin, trdnm: nameByCtin.get(d.ctin) || null, supfildt: d.fldtr1 || null, inv: d.inv });
          } else failed++;
        } else failed++;
      } catch (e) { failed++; }
      await sleep(150); // deliberate throttle — a real client can have dozens of suppliers
    }

    const patchObj = { status: 'Pulled', summary: { b2b: docs }, updated_at: new Date().toISOString() };
    try { await GSTKdb.upsertFiledReturn(cur.clientId, job.period, 'GSTR2A', patchObj); } catch (e) { /* non-fatal */ }
    debugPanel([
      'STEP: GSTR-2A (B2B)  (' + location.pathname + ')',
      'counterparties     : ' + ctinList.length + ' (' + failed + ' failed)',
    ]);
    banner('GSTR-2A ' + job.period + ' → saved ✓ (' + ctinList.length + ' counterparties).' + progress, '#16a34a');
    await sleep(800);
    await advance(job);
  }

  // Shared by the two statement pulls below: given the job's period, the
  // financial-year key ('2026-2027') and the DD/MM/YYYY date-range bounds to
  // fetch (Apr 1 of the FY through today, or FY-end if the FY has already
  // closed) — both portal APIs accept an arbitrary range in one call, so
  // there's no need to loop month-by-month the way Liability/Cash Ledger do.
  function fyRangeForPull(period) {
    const [mm, yyyy] = String(period || '').split('/').map((n) => parseInt(n, 10));
    if (!mm || !yyyy) return null;
    const startYear = mm >= 4 ? yyyy : yyyy - 1;
    const fy = startYear + '-' + (startYear + 1);
    const p2 = (n) => String(n).padStart(2, '0');
    const fyEnd = new Date(startYear + 1, 2, 31);
    const today = new Date();
    const tdateObj = today < fyEnd ? today : fyEnd;
    return {
      fy,
      fdate: '01/04/' + startYear,
      tdate: p2(tdateObj.getDate()) + '/' + p2(tdateObj.getMonth() + 1) + '/' + tdateObj.getFullYear(),
    };
  }


  // Electronic Credit Reversal and Re-claimed Statement — a REAL Dashboard
  // Quick Link (Services > Ledger > "Electronic Credit Reversal and
  // Re-claimed Statement"), confirmed live 2026-08-22:
  // internalapi/getRevRclmDetls?fdate=&tdate= returns every GSTR-3B filing's
  // Table 4A(5)/4B(2)/4D(1) ITC movement plus a running closing balance, for
  // the WHOLE requested date range in one call. Replaces this app's earlier
  // reconciliation-derived estimate — see gst_credit_reversal_reclaim_entries.
  async function handleRevRclmPull(job, cur, progress) {
    if (!/return\.gst\.gov\.in/.test(location.hostname)) { location.href = 'https://return.gst.gov.in/returns/auth/dashboard'; return; }
    const range = fyRangeForPull(job.period);
    if (!range) { banner('Bad period for Credit Reversal and Re-claimed Statement.', '#dc2626'); await clearJob(); return; }
    banner('Reading Electronic Credit Reversal and Re-claimed Statement for FY ' + range.fy + '…' + progress);

    let data = null;
    try {
      const r = await fetch('https://return.gst.gov.in/returns/auth/internalapi/getRevRclmDetls?fdate=' + range.fdate + '&tdate=' + range.tdate, { credentials: 'include' });
      if (!r.ok) throw new Error('HTTP ' + r.status + ' from getRevRclmDetls');
      data = await r.json();
    } catch (e) {
      banner('Credit Reversal and Re-claimed Statement: could not read the portal API (' + (e && e.message) + ') — skipped.' + progress, '#dc2626');
      try { await GSTKdb.replaceCreditReversalReclaimEntries(cur.clientId, range.fy, [{ client_id: cur.clientId, financial_year: range.fy, description: 'PULL FAILED: ' + ((e && e.message) || 'unknown error') }]); } catch (e2) { /* diagnostic only */ }
      await sleep(1200);
      await advance(job);
      return;
    }

    const rows = [];
    if (data && data.opnbal) {
      const ob = data.opnbal;
      rows.push({
        client_id: cur.clientId, financial_year: range.fy, is_opening_balance: true,
        closing_balance_igst: numOr0(ob.igst), closing_balance_cgst: numOr0(ob.cgst),
        closing_balance_sgst: numOr0(ob.sgst), closing_balance_cess: numOr0(ob.cess),
      });
    }
    (data && Array.isArray(data.tr) ? data.tr : []).forEach((t) => {
      const a5 = t.itc4a5 || {}, b2 = t.itc4b2 || {}, d1 = t.itc4d1 || {}, cb = t.clsbal || {};
      rows.push({
        client_id: cur.clientId, financial_year: range.fy, is_opening_balance: false,
        return_period: rtnPrdToPeriod(t.rtnprd),
        transaction_date: t.trandt || null, reference_no: t.refno || null, description: t.desc || null,
        itc_claimed_igst: numOr0(a5.igst), itc_claimed_cgst: numOr0(a5.cgst), itc_claimed_sgst: numOr0(a5.sgst), itc_claimed_cess: numOr0(a5.cess),
        itc_reversed_igst: numOr0(b2.igst), itc_reversed_cgst: numOr0(b2.cgst), itc_reversed_sgst: numOr0(b2.sgst), itc_reversed_cess: numOr0(b2.cess),
        itc_reclaimed_igst: numOr0(d1.igst), itc_reclaimed_cgst: numOr0(d1.cgst), itc_reclaimed_sgst: numOr0(d1.sgst), itc_reclaimed_cess: numOr0(d1.cess),
        closing_balance_igst: numOr0(cb.igst), closing_balance_cgst: numOr0(cb.cgst), closing_balance_sgst: numOr0(cb.sgst), closing_balance_cess: numOr0(cb.cess),
      });
    });

    try { await GSTKdb.replaceCreditReversalReclaimEntries(cur.clientId, range.fy, rows); } catch (e) { /* non-fatal */ }
    debugPanel([
      'STEP: Electronic Credit Reversal and Re-claimed Statement  (' + location.pathname + ')',
      'FY                : ' + range.fy + '  (' + range.fdate + ' – ' + range.tdate + ')',
      'rows read         : ' + rows.length,
    ]);
    banner('Credit Reversal and Re-claimed Statement (FY ' + range.fy + ') → ' + rows.length + ' rows saved.' + progress, '#16a34a');
    await sleep(800);
    await advance(job);
  }

  // RCM Liability/ITC Statement — same story, another REAL Dashboard Quick
  // Link, confirmed live 2026-08-22: internalapi/getRcmDetls returns every
  // GSTR-3B filing's Table 3.1(d) RCM liability paid vs Table 4A(2)/4A(3) RCM
  // ITC claimed, plus a running closing balance. Table 4A(2) (import of
  // services) legally carries only IGST/Cess — RCM on imports is always
  // IGST under the IGST Act — and the portal's own response reflects that:
  // itc4a2 has no cgst/sgst keys at all, not zeros.
  async function handleRcmLiabPull(job, cur, progress) {
    if (!/return\.gst\.gov\.in/.test(location.hostname)) { location.href = 'https://return.gst.gov.in/returns/auth/dashboard'; return; }
    const range = fyRangeForPull(job.period);
    if (!range) { banner('Bad period for RCM Liability/ITC Statement.', '#dc2626'); await clearJob(); return; }
    banner('Reading RCM Liability/ITC Statement for FY ' + range.fy + '…' + progress);

    let data = null;
    try {
      const r = await fetch('https://return.gst.gov.in/returns/auth/internalapi/getRcmDetls?fdate=' + range.fdate + '&tdate=' + range.tdate, { credentials: 'include' });
      if (!r.ok) throw new Error('HTTP ' + r.status + ' from getRcmDetls');
      data = await r.json();
    } catch (e) {
      banner('RCM Liability/ITC Statement: could not read the portal API (' + (e && e.message) + ') — skipped.' + progress, '#dc2626');
      try { await GSTKdb.replaceRcmLiabilityItcEntries(cur.clientId, range.fy, [{ client_id: cur.clientId, financial_year: range.fy, description: 'PULL FAILED: ' + ((e && e.message) || 'unknown error') }]); } catch (e2) { /* diagnostic only */ }
      await sleep(1200);
      await advance(job);
      return;
    }

    const rows = [];
    if (data && data.opnbal) {
      const ob = data.opnbal;
      rows.push({
        client_id: cur.clientId, financial_year: range.fy, is_opening_balance: true,
        closing_balance_igst: numOr0(ob.igst), closing_balance_cgst: numOr0(ob.cgst),
        closing_balance_sgst: numOr0(ob.sgst), closing_balance_cess: numOr0(ob.cess),
      });
    }
    (data && Array.isArray(data.tr) ? data.tr : []).forEach((t) => {
      const l31d = t.inwardsup_3_1d || {}, a2 = t.itc4a2 || {}, a3 = t.itc4a3 || {}, cb = t.clsbal || {};
      rows.push({
        client_id: cur.clientId, financial_year: range.fy, is_opening_balance: false,
        return_period: rtnPrdToPeriod(t.rtnprd),
        transaction_date: t.trandt || null, reference_no: t.refno || null, description: t.desc || null,
        liability_3_1d_igst: numOr0(l31d.igst), liability_3_1d_cgst: numOr0(l31d.cgst), liability_3_1d_sgst: numOr0(l31d.sgst), liability_3_1d_cess: numOr0(l31d.cess),
        itc_4a2_igst: numOr0(a2.igst), itc_4a2_cess: numOr0(a2.cess),
        itc_4a3_igst: numOr0(a3.igst), itc_4a3_cgst: numOr0(a3.cgst), itc_4a3_sgst: numOr0(a3.sgst), itc_4a3_cess: numOr0(a3.cess),
        closing_balance_igst: numOr0(cb.igst), closing_balance_cgst: numOr0(cb.cgst), closing_balance_sgst: numOr0(cb.sgst), closing_balance_cess: numOr0(cb.cess),
      });
    });

    try { await GSTKdb.replaceRcmLiabilityItcEntries(cur.clientId, range.fy, rows); } catch (e) { /* non-fatal */ }
    debugPanel([
      'STEP: RCM Liability/ITC Statement  (' + location.pathname + ')',
      'FY                : ' + range.fy + '  (' + range.fdate + ' – ' + range.tdate + ')',
      'rows read         : ' + rows.length,
    ]);
    banner('RCM Liability/ITC Statement (FY ' + range.fy + ') → ' + rows.length + ' rows saved.' + progress, '#16a34a');
    await sleep(800);
    await advance(job);
  }

  // GSTR-2B — full document-level pull. gstr2b.gst.gov.in is a SEPARATE
  // domain from return.gst.gov.in; a cold direct location.href to it 403s
  // (confirmed live — same "Access Denied" pattern as every other authenticated
  // deep-link in this app) — the SSO hand-off only happens via the returns
  // dashboard tile's own click, so this reuses handleTwob's cascading FY/
  // quarter/month select + Search + tile-find, clicking the tile's View
  // (not Download — that triggers the slow Excel-generation flow this
  // replaces) to land on gstr2b/auth/gstr2b/summary with a valid session.
  // getdata?rtnprd=MMYYYY there returns the FULL document-level 2B — every
  // counterparty invoice with item-level tax split, ITC eligibility (Y/N)
  // and IMS status — confirmed live against a real invoice (Google India,
  // July 2026-27). This is everything the Import 2B tab currently needs a
  // manual Excel import for, in one JSON call.
  async function handleGstr2bPullDash(job, cur, progress) {
    if (!/returns\/auth\/dashboard/.test(url)) { location.href = 'https://return.gst.gov.in/returns/auth/dashboard'; return; }
    if (!(await waitFor('select', 20000))) { banner('Returns dashboard did not load.', '#dc2626'); await clearJob(); return; }
    const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const [mm, yyyy] = String(job.period || '').split('/').map((n) => parseInt(n, 10));
    if (!mm || !yyyy) { banner('Bad GSTR-2B period.', '#dc2626'); await clearJob(); return; }
    const fyStart = mm >= 4 ? yyyy : yyyy - 1;
    const fyShort = fyStart + '-' + String((fyStart + 1) % 100).padStart(2, '0');
    const monthName = MONTHS_FULL[mm - 1];
    const q = mm >= 4 ? Math.ceil((mm - 3) / 3) : 4;

    banner('Selecting ' + monthName + ' ' + yyyy + ' on the dashboard…' + progress);
    if (!(await selectWhereOption(fyShort))) { banner('Could not set the financial year on the dashboard.', '#dc2626'); await clearJob(); return; }
    await sleep(700);
    await selectWhereOption('Quarter ' + q, { startsWith: true, timeout: 8000 });
    await sleep(700);
    if (!(await selectWhereOption(monthName, { timeout: 12000 }))) { banner('Could not set the month on the dashboard.', '#dc2626'); await clearJob(); return; }
    await sleep(300);
    const search = $('button.srchbtn') || $$('button').find((b) => /^search$/i.test((b.textContent || '').trim()));
    if (!search) { banner('Could not find the dashboard Search button.', '#dc2626'); await clearJob(); return; }
    search.click();

    let viewBtn = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 15000 && !viewBtn) {
      await sleep(400);
      viewBtn = findTileButton(/gstr[\s-]*2b/i, /^view$/i, [/gstr[\s-]*1\b/i, /gstr[\s-]*2a/i, /gstr[\s-]*3b/i]);
    }
    if (!viewBtn) { banner('Could not find the GSTR-2B tile / View after Search — is GSTR-2B generated for ' + monthName + ' ' + yyyy + '?', '#dc2626'); await clearJob(); return; }
    job.step = 'gstr2b_pull';
    await setJob(job);
    banner('Opening the GSTR-2B summary page…' + progress);
    viewBtn.click();
  }

  async function handleGstr2bPull(job, cur, progress) {
    if (!/gstr2b\.gst\.gov\.in/.test(location.hostname)) { banner('Did not reach the GSTR-2B summary page (at ' + location.hostname + location.pathname + ').', '#f59e0b'); await clearJob(); return; }
    const [mm, yyyy] = String(job.period || '').split('/').map((n) => parseInt(n, 10));
    if (!mm || !yyyy) { banner('Bad GSTR-2B period.', '#dc2626'); await clearJob(); return; }
    const rtnPrd = String(mm).padStart(2, '0') + yyyy;
    banner('Reading GSTR-2B for ' + job.period + '…' + progress);

    let data = null;
    try {
      const r = await fetch('https://gstr2b.gst.gov.in/gstr2b/auth/api/gstr2b/getdata?rtnprd=' + rtnPrd, { credentials: 'include' });
      if (r.ok) { const j = await r.json(); if (j && j.data) data = j.data; }
    } catch (e) {
      banner('GSTR-2B: could not read the portal API (' + (e && e.message) + ') — skipped.' + progress, '#dc2626');
      try { await GSTKdb.upsertFiledReturn(cur.clientId, job.period, 'GSTR2B', { status: 'PULL FAILED: ' + ((e && e.message) || 'unknown error') }); } catch (e2) { /* diagnostic only */ }
      await sleep(1200);
      await advance(job);
      return;
    }

    if (!data) {
      banner('GSTR-2B not generated on the portal for ' + job.period + '.' + progress, '#f59e0b');
      try { await GSTKdb.upsertFiledReturn(cur.clientId, job.period, 'GSTR2B', { status: 'NOT GENERATED / NOT FOUND' }); } catch (e2) { /* diagnostic only */ }
      await sleep(1200);
      await advance(job);
      return;
    }

    const patchObj = { status: 'Generated', summary: data, updated_at: new Date().toISOString() };
    try { await GSTKdb.upsertFiledReturn(cur.clientId, job.period, 'GSTR2B', patchObj); } catch (e) { /* non-fatal */ }
    const docCount = (data.docdata && data.docdata.b2b && data.docdata.b2b.length) || 0;
    debugPanel([
      'STEP: GSTR-2B  (' + location.pathname + ')',
      'B2B counterparties: ' + docCount,
    ]);
    banner('GSTR-2B ' + job.period + ' → saved ✓ (' + docCount + ' B2B counterparties).' + progress, '#16a34a');
    await sleep(800);
    await advance(job);
  }

  // GSTR-1 filed JSON — the SAME invoice-level JSON schema this app already
  // uses for its own pre-filing draft (gstr1_data.raw_json), but pulled
  // straight from the portal's "Offline Download for GSTR-1" feature
  // instead. Confirmed live (2026-08-21): GET api/offline/download/generate?
  // flag=0&rtn_prd=MMYYYY&rtn_typ=GSTR1 (no page navigation/button-click
  // needed — the API takes rtn_prd directly) returns {status:1,
  // data:{url}} once ready, pointing to a ZIP on files.gst.gov.in containing
  // exactly one .json file. Generation is async and can take up to 20
  // minutes for a period never generated before (confirmed via the portal's
  // own banner text) — this polls a bounded number of times within one page
  // load and saves a PENDING status (not a failure) if it's still cooking,
  // rather than blocking indefinitely; re-running Pull later picks up the
  // now-cached file (confirmed: a previously-generated period returns
  // status:1 near-instantly on a later call).
  async function handleGstr1JsonPull(job, cur, progress) {
    if (!/return\.gst\.gov\.in/.test(location.hostname)) { location.href = 'https://return.gst.gov.in/returns/auth/dashboard'; return; }
    const [mm, yyyy] = String(job.period || '').split('/').map((n) => parseInt(n, 10));
    if (!mm || !yyyy) { banner('Bad GSTR-1 JSON period.', '#dc2626'); await clearJob(); return; }
    const rtnPrd = String(mm).padStart(2, '0') + yyyy;
    banner('Requesting the filed GSTR-1 JSON for ' + job.period + '…' + progress);

    let downloadUrl = null;
    const MAX_ATTEMPTS = 6; // ~90s of polling in this page load
    try {
      for (let attempt = 0; attempt < MAX_ATTEMPTS && !downloadUrl; attempt++) {
        const r = await fetch('https://return.gst.gov.in/returns/auth/api/offline/download/generate?flag=0&rtn_prd=' + rtnPrd + '&rtn_typ=GSTR1', { credentials: 'include' });
        if (!r.ok) throw new Error('HTTP ' + r.status + ' from offline/download/generate');
        const j = await r.json();
        if (j && j.status === 1 && j.data && j.data.url) { downloadUrl = j.data.url; break; }
        if (attempt < MAX_ATTEMPTS - 1) { banner('GSTR-1 JSON still generating on the portal (attempt ' + (attempt + 1) + '/' + MAX_ATTEMPTS + ')…' + progress); await sleep(15000); }
      }
    } catch (e) {
      banner('GSTR-1 JSON: could not read the portal API (' + (e && e.message) + ') — skipped.' + progress, '#dc2626');
      try { await GSTKdb.upsertFiledReturn(cur.clientId, job.period, 'GSTR1', { status: 'PULL FAILED: ' + ((e && e.message) || 'unknown error') }); } catch (e2) { /* diagnostic only */ }
      await sleep(1200);
      await advance(job);
      return;
    }

    if (!downloadUrl) {
      banner('GSTR-1 JSON is still generating on the portal (can take up to 20 min) — run Pull again shortly.' + progress, '#f59e0b');
      try { await GSTKdb.upsertFiledReturn(cur.clientId, job.period, 'GSTR1', { status: 'PENDING: filed JSON still generating on the portal — retry Pull in ~20 minutes' }); } catch (e2) { /* diagnostic only */ }
      await sleep(1500);
      await advance(job);
      return;
    }

    let fullJson = null;
    try {
      const { base64 } = await GSTKdb.fetchCrossOriginAsBase64(downloadUrl);
      fullJson = await extractJsonFromZip(base64ToArrayBuffer(base64));
    } catch (e) {
      banner('GSTR-1 JSON: downloaded but could not unzip/parse it (' + (e && e.message) + ') — skipped.' + progress, '#dc2626');
      await sleep(1500);
      await advance(job);
      return;
    }

    try {
      await GSTKdb.upsertFiledReturn(cur.clientId, job.period, 'GSTR1', { full_json: fullJson, full_json_pulled_at: new Date().toISOString() });
    } catch (e) { /* non-fatal */ }
    const invCount = Array.isArray(fullJson && fullJson.b2b) ? fullJson.b2b.reduce((a, s) => a + (Array.isArray(s.inv) ? s.inv.length : 0), 0) : null;
    debugPanel([
      'STEP: GSTR-1 filed JSON  (' + location.pathname + ')',
      'B2B invoices found : ' + (invCount == null ? '(shape not recognized — saved raw for inspection)' : invCount),
    ]);
    banner('GSTR-1 filed JSON → saved ✓.' + progress, '#16a34a');
    await sleep(800);
    await advance(job);
  }

  // Minimal ZIP reader — extracts and parses the first entry whose name ends
  // in .json, using only built-in browser APIs (DecompressionStream for the
  // 'deflate' method almost all zips use) — no external library, since a
  // content script has no bundler to pull one in. The GST portal's own
  // "Offline Download" ZIPs contain exactly one JSON file, so this doesn't
  // need to handle multi-entry archives or nested folders.
  async function extractJsonFromZip(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    const bytes = new Uint8Array(arrayBuffer);
    let eocdOffset = -1;
    const maxScan = Math.min(bytes.length, 65557); // EOCD record + max comment length
    for (let i = bytes.length - 22; i >= bytes.length - maxScan && i >= 0; i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocdOffset = i; break; }
    }
    if (eocdOffset < 0) throw new Error('not a valid ZIP (no End Of Central Directory record found)');
    const cdOffset = view.getUint32(eocdOffset + 16, true);
    const cdEntryCount = view.getUint16(eocdOffset + 10, true);

    let ptr = cdOffset;
    for (let i = 0; i < cdEntryCount; i++) {
      if (view.getUint32(ptr, true) !== 0x02014b50) break;
      const compressionMethod = view.getUint16(ptr + 10, true);
      const compressedSize = view.getUint32(ptr + 20, true);
      const fileNameLen = view.getUint16(ptr + 28, true);
      const extraLen = view.getUint16(ptr + 30, true);
      const commentLen = view.getUint16(ptr + 32, true);
      const localHeaderOffset = view.getUint32(ptr + 42, true);
      const fileName = new TextDecoder().decode(bytes.subarray(ptr + 46, ptr + 46 + fileNameLen));
      if (/\.json$/i.test(fileName)) {
        const lh = localHeaderOffset;
        if (view.getUint32(lh, true) !== 0x04034b50) throw new Error('bad local file header for ' + fileName);
        const lNameLen = view.getUint16(lh + 26, true);
        const lExtraLen = view.getUint16(lh + 28, true);
        const dataStart = lh + 30 + lNameLen + lExtraLen;
        const compressedBytes = bytes.subarray(dataStart, dataStart + compressedSize);
        let jsonText;
        if (compressionMethod === 0) {
          jsonText = new TextDecoder().decode(compressedBytes);
        } else if (compressionMethod === 8) {
          const decompressedStream = new Blob([compressedBytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
          jsonText = await new Response(decompressedStream).text();
        } else {
          throw new Error('unsupported ZIP compression method ' + compressionMethod + ' for ' + fileName);
        }
        return JSON.parse(jsonText);
      }
      ptr += 46 + fileNameLen + extraLen + commentLen;
    }
    throw new Error('no .json entry found inside the ZIP');
  }

  function base64ToArrayBuffer(base64) {
    const bin = atob(base64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }

  // Best-effort scan for a docId hiding in an element's attributes — common
  // data-attribute names first, then falling back to pulling a quoted
  // token out of an onclick/ng-click handler's literal attribute text
  // (AngularJS directives like ng-click="dl('abc123')" stay in the DOM as
  // plain strings even though this app disables Angular's DOM debug info).
  // Document descriptors are nested differently by section — confirmed
  // live: sdtls.<srscn|remnd|dtscn|dtorder>.maindocs[]/.suppdocs[] wrap each
  // doc under a `dcupdtls` key, but INTIM's own `docModel[]` entries are the
  // bare descriptor with no wrapper, and REPLY/DRC7A nest under different
  // top-level keys (reply./draftdrc7.) entirely — Refund's own APLCN folder
  // nests supporting docs under `suppdocs[].dcupdtls` too. Rather than
  // hardcode a path per section (fragile — a new one would silently capture
  // nothing), this recursively finds every object shaped like a doc
  // descriptor ({id, docName}, with or without a dcupdtls wrapper) anywhere
  // in the parsed JSON. Shared by handleNotices' Additional Notice Folder
  // capture and handleRefundDocs' case/folder document harvest.
  function findDocDescriptors(node, seen, out) {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) { node.forEach((n) => findDocDescriptors(n, seen, out)); return; }
    const candidate = (node.dcupdtls && typeof node.dcupdtls === 'object') ? node.dcupdtls : node;
    if (candidate.id && candidate.docName) out.push(candidate);
    Object.keys(node).forEach((k) => { if (k !== 'dcupdtls') findDocDescriptors(node[k], seen, out); });
  }

  // ── 0.8.0: what a case-folder item says about its notice ────────────────
  // The notice list (get/notices) carries a reference number, a type and an
  // issue date and little else: no officer, no DIN, and — for a DRC-01, an
  // RFD-03 or an RFD-08 — often no reply date either, which is why 31 open
  // notices had no date to run on. All of it sits in the matching case-folder
  // item's itemJson, which this extension already reads and saves whole
  // (gst_case_folder_items.raw_json). These helpers lift the few fields the
  // notice row itself needs out of that JSON, so the notice carries them too.
  //
  // The portal spells the same thing differently from one folder section to
  // the next (dueDt / replyDueDt / dtOfReply …, and the officer sits under
  // issuedBy, officerName or a nested jurisdiction object), and a section not
  // seen yet would silently yield nothing if a single path were hardcoded —
  // the same reasoning findDocDescriptors() above is built on. So each field
  // is found by walking the parsed JSON for any key in its candidate list,
  // depth-first, taking the first usable value. Keys are compared
  // case-insensitively with separators stripped, so dueDt, due_dt and DUEDT
  // all match one candidate.
  // First scalar value under any of `keys`, anywhere in `node`. `accept`
  // decides whether a value counts, so a date search skips an empty string or
  // a placeholder like 'NA' instead of stopping at it.
  function findByKeys(node, keys, accept, seen) {
    if (!node || typeof node !== 'object') return null;
    seen = seen || new Set();
    if (seen.has(node)) return null;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const n of node) { const v = findByKeys(n, keys, accept, seen); if (v != null) return v; }
      return null;
    }
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (v != null && typeof v !== 'object' && keys.indexOf(normKey(k)) !== -1) {
        const s = String(v).trim();
        if (s && accept(s)) return s;
      }
    }
    for (const k of Object.keys(node)) {
      const v = findByKeys(node[k], keys, accept, seen); if (v != null) return v;
    }
    return null;
  }
  // dd/mm/yyyy (the portal's own format everywhere else in this file), plus
  // the ISO and dd-mm-yyyy spellings a few folder sections use.
  function anyDateToIso(s) {
    const t = String(s || '').trim().slice(0, 10);
    const m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/) ? [t, t.slice(8, 10), t.slice(5, 7), t.slice(0, 4)]
      : t.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
    if (!m) return null;
    const [dd, mm, yyyy] = [Number(m[1]), Number(m[2]), Number(m[3])];
    // An impossible day (31/02, 00/00, month 13) must not reach the row:
    // Postgres rejects it and the whole notices upsert fails with it, so the
    // run would lose every notice over one bad folder field. Date() alone is
    // no guard — V8 rolls 2024-02-31 over into March rather than failing —
    // so the parts are checked back against what Date() made of them.
    if (!(yyyy >= 2017 && yyyy <= 2100) || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    const d = new Date(Date.UTC(yyyy, mm - 1, dd));
    if (d.getUTCFullYear() !== yyyy || d.getUTCMonth() !== mm - 1 || d.getUTCDate() !== dd) return null;
    return yyyy + '-' + String(mm).padStart(2, '0') + '-' + String(dd).padStart(2, '0');
  }
  // What the notice row can take from its folder item. `raw` is the parsed
  // itemJson; everything here is best-effort and null when the item has no
  // such field — a notice never loses a value it already has (see the link
  // pass in pullNotices).
  function noticeFieldsFromItem(raw) {
    if (!raw || typeof raw !== 'object') return {};
    const due = findByKeys(raw, NOTICE_FIELD_KEYS.due, (s) => !!anyDateToIso(s));
    const officer = findByKeys(raw, NOTICE_FIELD_KEYS.officer, isRealText);
    const desig = findByKeys(raw, NOTICE_FIELD_KEYS.designation, isRealText);
    const din = findByKeys(raw, NOTICE_FIELD_KEYS.din, (s) => /^[A-Za-z0-9/-]{8,}$/.test(s));
    return {
      due_date: due ? anyDateToIso(due) : null,
      issued_by: officer ? (desig ? officer + ', ' + desig : officer) : null,
      din: din || null,
    };
  }
  // Which of a folder item's attachments IS the notice (rather than a
  // supporting document the officer attached). The portal names the generated
  // form after the reference number — DOT_NOTICE_<ref>_<ts>.pdf,
  // ADJDT_DRPRC_<ref>_<ts>.pdf, DOT_INTIMATION_SEC74_<ref>_<ts>.pdf — so a
  // label or URL carrying the reference wins; failing that, one whose name
  // looks like the portal's own generated form; failing that, the first.
  function pickNoticeAttachment(attachments, refNo) {
    const list = (attachments || []).filter((a) => a && typeof a.url === 'string' && a.url);
    if (!list.length) return null;
    const ref = String(refNo || '').trim().toUpperCase();
    if (ref) {
      const byRef = list.find((a) => ((a.label || '') + ' ' + a.url).toUpperCase().indexOf(ref) !== -1);
      if (byRef) return byRef.url;
    }
    const generated = list.find((a) => /^(DOT|ADJDT|ADJ|REG|RFD|ASMT|DRC)_/i.test(String(a.label || '')));
    return (generated || list[0]).url;
  }

  function extractDocId(el) {
    if (!el) return null;
    const direct = el.getAttribute('data-doc-id') || el.getAttribute('data-docid')
      || el.getAttribute('data-id') || el.getAttribute('docid') || el.id;
    if (direct) return direct;
    const scripty = (el.getAttribute('onclick') || '') + ' ' + (el.getAttribute('ng-click') || '');
    const m = scripty.match(/['"]([\w-]{6,})['"]/);
    return m ? m[1] : null;
  }

  // A hung fetch (no response ever arrives) neither resolves nor rejects,
  // so `await` blocks forever and no surrounding try/catch ever fires —
  // confirmed live 2026-08-27: the Additional Notice Folder capture's
  // per-attachment loop (potentially dozens of calls per case, across many
  // cases) stalled a real sync indefinitely with no error, no timeout, and
  // no visible sign it wasn't just "still working." Every fetch in that
  // capture is now wrapped in this so one bad request can't hang everything
  // downstream of it — it just fails that one attachment and moves on.
  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error((label || 'request') + ' timed out after ' + ms + 'ms')), ms)),
    ]);
  }

  async function fetchEncrypDocEh(docId, arn) {
    try {
      const r = await fetch('https://services.gst.gov.in/litserv/auth/api/usr/getEncrypDocIds', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docIdList: [docId], arn: arn }),
      });
      if (!r.ok) return null;
      const j = await r.json();
      return (j && j[docId]) || null;
    } catch (e) { return null; }
  }

  function arrayBufferToBase64(buf) {
    let binary = '';
    const bytes = new Uint8Array(buf);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function parseDrc03Case(c, clientId) {
    let item;
    try { item = JSON.parse(c.appItem && c.appItem.itemJson); } catch (e) { return null; }
    const pysum = item && item.vp && item.vp.pysum;
    if (!pysum) return null;
    const acts = (pysum.lbltydtls && pysum.lbltydtls.act) || [];
    let cash = 0, credit = 0, taxable = 0, igst = 0, cgst = 0, sgst = 0, cess = 0, interest = 0, lateFee = 0, penalty = 0;
    let minFrom = null, maxTo = null;
    for (const a of acts) {
      const total = Number(a.total) || 0;
      const tx = Number(a.tx) || 0;
      const intr = Number(a.intr) || 0;
      const fees = Number(a.fees) || 0;
      const pnlty = Number(a.pnlty) || 0;
      if (a.ldgrut === 'Credit') credit += total; else cash += total; // 'Cash' or unsplittable 'Cash/Credit'
      taxable += tx; interest += intr; lateFee += fees; penalty += pnlty;
      const head = (a.acttyp || '').toUpperCase();
      if (head === 'IGST') igst += tx;
      else if (head === 'CGST') cgst += tx;
      else if (head === 'SGST' || head === 'UTGST') sgst += tx;
      else if (head === 'CESS') cess += tx;
      const fm = MONTH_ABBR[((a.tp && a.tp.fromm) || '').toUpperCase()];
      const fy2 = parseInt((a.tp && a.tp.fromy) || '', 10);
      const tm = MONTH_ABBR[((a.tp && a.tp.tom) || '').toUpperCase()];
      const ty = parseInt((a.tp && a.tp.toy) || '', 10);
      if (fm && fy2) { const d = fy2 + '-' + String(fm).padStart(2, '0') + '-01'; if (!minFrom || d < minFrom) minFrom = d; }
      if (tm && ty) { const d = ty + '-' + String(tm).padStart(2, '0') + '-01'; if (!maxTo || d > maxTo) maxTo = d; }
    }
    const sections = Array.isArray(pysum.sec) ? pysum.sec.filter(Boolean).join(', ') : (pysum.sec || null);
    const doc = (pysum.dcupdtls || [])[0];
    return {
      client_id: clientId, arn: c.arn || null,
      cause_of_payment: pysum.rsn || pysum.cs || null,
      filed_date: ddmmyyyyToIso(pysum.paymentdate || c.caseCreationDate || ''),
      period_from: minFrom, period_to: maxTo,
      cash_amount: cash, credit_amount: credit,
      status: c.statusDesc || c.status || null,
      financial_year: pysum.fy || c.finYear || null,
      section: sections || null,
      taxable_value: taxable,
      igst_amount: igst, cgst_amount: cgst, sgst_amount: sgst, cess_amount: cess,
      interest_amount: interest, late_fee_amount: lateFee, penalty_amount: penalty,
      pdf_url: null,
      __docId: doc ? doc.id : null,
    };
  }

  // Shared parser for the retdtl / cashdetls portal JSON APIs — both return
  // { tr: [...] } with an identical per-transaction shape apart from the date
  // field name (dt for Liability, dpt_dt for Cash): desc/tr_typ/ref_no, plus
  // igst/cgst/sgst/cess sub-objects whose .tx is this transaction's figure,
  // and tot_rng_bal as the running balance after the row. The lead "Opening
  // Balance" row carries no tr_typ — kept (is_debit: null) rather than
  // dropped, so the report shows the same starting point the portal does.
  function parseLedgerTxns(json, dateField) {
    const rows = Array.isArray(json && json.tr) ? json.tr : [];
    return rows.map((r) => ({
      entry_date: ddmmyyyyToIso(r[dateField] || ''),
      description: r.desc || '',
      is_debit: r.tr_typ === 'Dr' ? true : r.tr_typ === 'Cr' ? false : null,
      igst: (r.igst && r.igst.tx) || 0,
      cgst: (r.cgst && r.cgst.tx) || 0,
      sgst: (r.sgst && r.sgst.tx) || 0,
      cess: (r.cess && r.cess.tx) || 0,
      balance: r.tot_rng_bal || 0,
    }));
  }

  // --- mapping helpers (mirror the agent) ---
  function resolveReturnType(portalLabel, selectedReturns) {
    const has = (t) => selectedReturns.includes(t);
    const L = (portalLabel || '').toUpperCase().replace(/\s/g, '');
    if (L.includes('IFF') || L.includes('GSTR-1') || L.includes('GSTR1')) return has('GSTR-1 (IFF)') ? 'GSTR-1 (IFF)' : 'GSTR-1';
    if (L.includes('GSTR-3B') || L.includes('GSTR3B')) return has('GSTR-3B (Q)') ? 'GSTR-3B (Q)' : 'GSTR-3B';
    if (L.includes('GSTR-7') || L.includes('GSTR7')) return 'GSTR-7';
    if (L.includes('GSTR-6') || L.includes('GSTR6')) return 'GSTR-6';
    if (L.includes('CMP-08') || L.includes('CMP08')) return 'CMP-08';
    if (L.includes('ITC-04') || L.includes('ITC04')) return 'ITC-04';
    return null;
  }
  function resolvePeriodMonth(fyText, taxPeriod) {
    const M = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const mi = M.findIndex((m) => (taxPeriod || '').trim().toLowerCase().startsWith(m));
    const fy = (fyText || '').match(/(\d{4})/);
    if (mi < 0 || !fy) return null;
    const fyStart = parseInt(fy[1], 10);
    const monthNum = mi + 1;
    const year = monthNum >= 4 ? fyStart : fyStart + 1;
    return String(monthNum).padStart(2, '0') + '/' + year;
  }
  function ddmmyyyyToIso(s) {
    const m = (s || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    return m ? m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0') : null;
  }
})();
