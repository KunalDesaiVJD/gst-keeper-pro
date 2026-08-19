// Runs on *.gst.gov.in pages. Driven by a small state machine kept in
// chrome.storage (survives navigations). Steps: login -> filing -> ledger -> done.
// Because this executes in the user's OWN browser on their normal IP, the portal
// treats it as a normal user (no datacenter firewall block). CAPTCHA stays human.
(async () => {
  const JOB_KEY = 'gstk_active_job';
  const store = chrome.storage.local;
  const getJob = async () => (await store.get(JOB_KEY))[JOB_KEY] || null;
  const setJob = (j) => store.set({ [JOB_KEY]: j });
  const clearJob = () => store.remove(JOB_KEY);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const url = location.href;
  // Used by parseDrc03Case(), called from the job dispatcher below — must be
  // initialized before that point in the script's top-to-bottom execution,
  // not down near where it's textually used, or it's a TDZ ReferenceError.
  const MONTH_ABBR = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };

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
  if (job.startedAt && Date.now() - job.startedAt > 20 * 60 * 1000) { await clearJob(); return; }
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
  const progress = job.clients.length > 1 ? ' (client ' + (job.idx + 1) + '/' + job.clients.length + ')' : '';

  // Loop guard: if the session died mid-sync (Access Denied / bounced to login)
  // while we expected to be logged in, DON'T keep navigating. Re-login a couple of
  // times, then give up on this client — never loop forever.
  const bounced = /services\/error|accessdenied/.test(url) || /services\/login/.test(url);
  const uploadSteps = ['gstr1_dash', 'gstr1_upload', 'gstr3b_dash', 'gstr3b_fill31', 'gstr3b_fill4'];
  if ((job.step === 'ledger' || job.step === 'reversal' || job.step === 'liabilityledger' || job.step === 'cashledger' || job.step === 'notices' || job.step === 'refunds' || job.step === 'drc03' || job.step === 'taxpayerprofile' || job.step === 'challans' || job.step === 'efiledpdf' || job.step === 'efiledview' || job.step === 'twob' || job.step === 'twobdwld' || job.step === 'twoa' || job.step === 'twoadwld' || job.step === 'filing' || uploadSteps.includes(job.step)) && bounced) {
    job.retries = (job.retries || 0) + 1;
    if (job.retries > 2) {
      banner('Session kept dropping for ' + cur.creds.name + ' — moving on.', '#dc2626');
      // Leave a trace in the table itself (delete-then-insert, so a later
      // successful pull overwrites it) — this job's tab is usually not being
      // watched live, so a silent give-up here would look identical to "ran
      // fine, portal just had nothing to report."
      if (job.step === 'liabilityledger') await writeLedgerFailureRow(GSTKdb.replaceLiabilityLedgerEntries, cur, job, 'session kept dropping (bounced to login/error page 3x) while reading the Liability Register');
      else if (job.step === 'cashledger') await writeLedgerFailureRow(GSTKdb.replaceCashLedgerEntries, cur, job, 'session kept dropping (bounced to login/error page 3x) while reading the Cash Ledger');
      else if (job.step === 'notices') {
        try { await GSTKdb.replaceNotices(cur.clientId, [{ client_id: cur.clientId, source: 'notices', description: 'PULL FAILED: session kept dropping (bounced to login/error page 3x) while reading Notices & Orders' }]); } catch (e2) { /* diagnostic only */ }
      } else if (job.step === 'refunds') {
        try { await GSTKdb.replaceRefundApplications(cur.clientId, [{ client_id: cur.clientId, status: 'PULL FAILED: session kept dropping (bounced to login/error page 3x) while reading Refund applications' }]); } catch (e2) { /* diagnostic only */ }
      } else if (job.step === 'drc03') {
        try { await GSTKdb.replaceDrc03Filings(cur.clientId, [{ client_id: cur.clientId, status: 'PULL FAILED: session kept dropping (bounced to login/error page 3x) while reading DRC-03 filings' }]); } catch (e2) { /* diagnostic only */ }
      } else if (job.step === 'challans') {
        try { await GSTKdb.replaceChallans(cur.clientId, [{ client_id: cur.clientId, status: 'PULL FAILED: session kept dropping (bounced to login/error page 3x) while reading Challan Summary' }]); } catch (e2) { /* diagnostic only */ }
      }
      // 'taxpayerprofile' has no diagnostic row: it's a single-row upsert
      // per client, so a failed pull just leaves any prior good data as-is
      // rather than needing a "pull failed" marker.
      await advance(job);
      return;
    }
    job.step = 'login';
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
    else if (job.step === 'drc03') await handleDrc03(job, cur, progress);
    else if (job.step === 'taxpayerprofile') await handleTaxpayerProfile(job, cur, progress);
    else if (job.step === 'challans') await handleChallans(job, cur, progress);
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
    else banner('Error: ' + (e && e.message), '#dc2626');
  }

  // Move to the next client in the queue (log out first), or finish.
  async function advance(job) {
    job.idx++;
    if (job.idx < job.clients.length) {
      job.step = 'logout';
      await setJob(job);
      banner('Client done — switching to the next…', '#2563eb');
      location.href = 'https://services.gst.gov.in/services/logout';
    } else {
      banner('All ' + job.clients.length + ' client(s) done ✓ — you can close this tab.', '#16a34a');
      await clearJob();
    }
  }
  async function handleLogout(job) {
    // On the logout page now — let the previous client's session fully clear, then
    // start the next client's login.
    await sleep(2000);
    job.step = 'login';
    await setJob(job);
    location.href = 'https://services.gst.gov.in/services/login';
  }

  async function handleLogin(job, cur, progress) {
    if (isLoggedIn()) {
      job.retries = 0;
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
      } else if (job.mode === 'notices') {
        banner('Logged in — reading Notices & Orders…' + progress);
        job.step = 'notices';
        await setJob(job);
        location.href = 'https://services.gst.gov.in/services/auth/notices';
      } else if (job.mode === 'refunds') {
        banner('Logged in — reading Refund applications…' + progress);
        job.step = 'refunds';
        await setJob(job);
        location.href = 'https://services.gst.gov.in/services/auth/trackstatus';
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
      } else if (job.mode === 'login') {
        // Simple login from the Clients → Credentials "Login" button: log in and
        // stop on the portal, no return/ledger navigation.
        banner('Logged in ✓ — ' + cur.creds.name + '. You are on the GST portal; this tab is yours now.', '#16a34a');
        await clearJob();
      } else {
        banner('Logged in — reading ledgers…' + progress);
        job.step = 'ledger';
        await setJob(job);
        location.href = 'https://return.gst.gov.in/returns/auth/ledger/detailedledger';
      }
      return;
    }
    if (!/services\/login/.test(url)) { location.href = 'https://services.gst.gov.in/services/login'; return; }
    banner('Logging in ' + cur.creds.name + '…' + progress);
    if (!(await waitFor('#username'))) { banner('Login form did not load — reload the page.', '#dc2626'); return; }
    setVal($('#username'), cur.creds.user);
    setVal($('#user_pass'), cur.creds.pass);
    await waitFor('#imgCaptcha', 8000);
    const text = await askCaptcha();
    setVal($('#captcha'), text);
    banner('Submitting login…');
    const btn =
      $$('button').find((b) => /login/i.test(b.textContent || '') && /btn-primary/.test(b.className || '')) ||
      $('button[type=submit]');
    if (btn) btn.click();
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

    banner('Looking for the ' + ret.return_type + ' PDF download…');
    const t = (x) => (x.textContent || '') + ' ' + (x.getAttribute('title') || '');
    let dl = null;
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
  async function handleFiling(job, cur, progress) {
    if (!/returns\/auth\/dashboard/.test(url)) { location.href = 'https://return.gst.gov.in/returns/auth/dashboard'; return; }
    if (!(await waitFor('select', 20000))) { banner('Returns dashboard did not load.', '#dc2626'); await clearJob(); return; }
    const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const ret = job.ret || {};
    const map = filingTileFor(ret.return_type);
    if (!map) { banner('This return type is not supported for one-click filing: ' + ret.return_type, '#dc2626'); await clearJob(); return; }
    const [mm, yyyy] = String(ret.period_month || '').split('/').map((n) => parseInt(n, 10));
    if (!mm || !yyyy) { banner('Bad filing period.', '#dc2626'); await clearJob(); return; }
    const fyStart = mm >= 4 ? yyyy : yyyy - 1;
    const fyShort = fyStart + '-' + String((fyStart + 1) % 100).padStart(2, '0');
    const monthName = MONTHS_FULL[mm - 1];
    const q = mm >= 4 ? Math.ceil((mm - 3) / 3) : 4;

    banner('Opening ' + map.label + ' for ' + monthName + ' ' + yyyy + '…' + progress);
    if (!(await selectWhereOption(fyShort))) { banner('Could not set the financial year on the dashboard.', '#dc2626'); await clearJob(); return; }
    await sleep(700);
    await selectWhereOption('Quarter ' + q, { startsWith: true, timeout: 8000 });
    await sleep(700);
    if (!(await selectWhereOption(monthName, { timeout: 12000 }))) { banner('Could not set the month on the dashboard.', '#dc2626'); await clearJob(); return; }
    await sleep(300);
    const search = $('button.srchbtn') || $$('button').find((b) => /^search$/i.test((b.textContent || '').trim()));
    if (!search) { banner('Could not find the dashboard Search button.', '#dc2626'); await clearJob(); return; }
    search.click();

    // Find the return tile's filing button ("Prepare Online" for unfiled returns).
    let btn = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 15000 && !btn) {
      await sleep(400);
      btn = findTileButton(map.re, /prepare\s*online/i, map.excl) || findTileButton(map.re, /prepare|proceed|file\b/i, map.excl);
    }
    if (!btn) {
      banner('Logged in — but no "Prepare Online" for ' + map.label + ' (already filed, or a different button). You are on the dashboard for ' + monthName + ' — open it yourself.', '#f59e0b');
      await clearJob();
      return;
    }
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
    if (!(await waitFor('input', 20000))) { banner('Reversal ledger form did not load — moving on.' + progress, '#f59e0b'); await proceedToLiabilityLedger(job); return; }
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
      await proceedToLiabilityLedger(job);
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
    await proceedToLiabilityLedger(job);
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
  async function chainOrStop(job, myMode, proceedFn) {
    if (job.mode === myMode) { await advance(job); return; }
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
  async function handleNotices(job, cur, progress) {
    if (!/\/services\/auth\/notices/.test(url)) { location.href = 'https://services.gst.gov.in/services/auth/notices'; return; }
    banner('Reading Notices & Orders…' + progress);
    let rows = [];
    try {
      const r = await fetch('https://services.gst.gov.in/services/auth/api/get/notices', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onLoad: true, type: '', from: '01/01/2017', to: shownTodayDdMmYyyy() }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status + ' from get/notices');
      const j = await r.json();
      const list = Array.isArray(j) ? j : Object.keys(j || {}).filter((k) => /^\d+$/.test(k)).map((k) => j[k]);
      rows = list.map((n) => ({
        client_id: cur.clientId, source: 'notices',
        reference_number: n.noticeOrderId || null, notice_type: n.type || null,
        description: n.descr || null, issue_date: ddmmyyyyToIso(n.dtOfIssue || ''),
        due_date: /^\d{2}\/\d{2}\/\d{4}$/.test(n.dueDate || '') ? ddmmyyyyToIso(n.dueDate) : null,
        status: n.status || null,
      }));
    } catch (e) {
      debugPanel(['STEP: View Notices and Orders  (' + location.pathname + ')', 'fetch failed: ' + (e && e.message)]);
      banner('Notices & Orders: could not read the portal API (' + (e && e.message) + ') — skipped.' + progress, '#dc2626');
      try { await GSTKdb.replaceNotices(cur.clientId, [{ client_id: cur.clientId, source: 'notices', description: 'PULL FAILED: ' + ((e && e.message) || 'unknown error') }]); } catch (e2) { /* diagnostic only */ }
      await sleep(1500);
      await chainOrStop(job, 'notices', proceedToRefunds);
      return;
    }
    try { await GSTKdb.replaceNotices(cur.clientId, rows); } catch (e) { /* non-fatal */ }
    debugPanel([
      'STEP: View Notices and Orders  (' + location.pathname + ')',
      'rows read         : ' + rows.length,
    ]);
    banner('Notices & Orders → ' + rows.length + ' entries saved. Now Refund applications…' + progress, '#16a34a');
    await sleep(1000);
    await chainOrStop(job, 'notices', proceedToRefunds);
  }

  // DD/MM/YYYY for "today" — the notices API wants an explicit upper bound,
  // not an open-ended range.
  function shownTodayDdMmYyyy() {
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    return p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + d.getFullYear();
  }

  async function proceedToRefunds(job) {
    job.step = 'refunds';
    await setJob(job);
    location.href = 'https://services.gst.gov.in/services/auth/trackstatus';
  }

  // Refund applications (Track Application Status) -> the 3 Refund reports.
  // DOM-scraped, unlike the ledger/notices JSON APIs above: the underlying
  // postTrackARNFiling response can't be read via a page-context script (CORS
  // blocks it even though the portal's own Angular app can call it), so this
  // reads the rendered table instead, the same fallback the credit/reversal
  // ledgers already use. Confirmed live against a client with real refund
  // history: Module=Refunds, "Filing Year" radio, one search per year option
  // the portal actually offers, "«  1 2  »" pagination (5 rows/page, no
  // page-size control) walked until a click produces no change.
  async function handleRefunds(job, cur, progress) {
    if (!/trackstatus/.test(url)) { location.href = 'https://services.gst.gov.in/services/auth/trackstatus'; return; }
    banner('Reading Refund applications…' + progress);
    if (!(await waitFor('select', 15000))) { banner('Refund tracker did not load — skipped.' + progress, '#f59e0b'); await chainOrStop(job, 'refunds', proceedToDrc03); return; }
    const modSel = await selectWhereOption('Refunds', { timeout: 8000 });
    if (!modSel) { banner('Could not select the Refunds module — skipped.' + progress, '#f59e0b'); await chainOrStop(job, 'refunds', proceedToDrc03); return; }
    await sleep(700);

    // "Filing Year" is the first of the two radio buttons (Filing Year / ARN).
    const radios = $$('input[type=radio]');
    if (radios[0]) { radios[0].click(); radios[0].dispatchEvent(new Event('change', { bubbles: true })); }

    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const isRefundTable = (t) => /ARN/i.test(t.textContent || '') && /GSTIN/i.test(t.textContent || '');
    // Accepts both "2024-25" and "2024-2025" — confirmed live the option
    // text is 4-digit-dash-4-digit ("2024-2025"), not the 2-digit form used
    // by GSTR-1/3B period pickers elsewhere on the portal; the old regex
    // required exactly 2 trailing digits so it matched zero options here,
    // even though the <select> had real year options a manual click showed.
    const isYearOption = (t) => /^\d{4}-\d{2,4}$/.test(t);
    const findYearSelect = () => $$('select').find((s) => [...s.options].some((o) => isYearOption(clean(o.textContent))));

    // The Filing Year <select>'s options populate asynchronously after the
    // radio click (Angular re-fetches the offered years) — a fixed sleep
    // here used to read the DOM before that landed, finding only the
    // placeholder "Select" option and silently pulling zero years. Poll
    // instead of guessing a delay.
    let yearSelect = null;
    for (let i = 0; i < 20 && !yearSelect; i++) { await sleep(300); yearSelect = findYearSelect(); }
    const years = yearSelect ? [...yearSelect.options].map((o) => clean(o.textContent)).filter(isYearOption) : [];

    const allRows = [];
    for (const year of years) {
      const sel = await selectWhereOption(year, { timeout: 5000 });
      if (!sel) continue;
      await sleep(300);
      const searchBtn = $$('button').find((b) => /^search$/i.test(clean(b.textContent)));
      if (!searchBtn) continue;
      searchBtn.click();
      await sleep(1500);

      for (let page = 0; page < 20; page++) {
        const table = $$('table').find(isRefundTable);
        if (!table) break;
        const dataRows = [...table.querySelectorAll('tr')].filter((tr) => !tr.closest('thead') && tr.querySelectorAll('td').length >= 8);
        for (const tr of dataRows) {
          const tds = [...tr.children].map((td) => clean(td.textContent));
          const arn = tds[1];
          if (!arn) continue;
          // Columns: GSTIN, ARN, ARN Date, Category, Tax Period, Jurisdiction
          // Information, Refund Amount Claimed, Action/Status.
          const category = tds[3] || '';
          allRows.push({
            client_id: cur.clientId, arn,
            refund_type: category || null,
            source_ledger: /\bITC\b/i.test(category) ? 'ITC' : null,
            filed_date: ddmmyyyyToIso(tds[2] || ''),
            claimed_amount: Number((tds[6] || '').replace(/,/g, '')) || 0,
            sanctioned_amount: null,
            status: tds[7] || null,
          });
        }
        const next = $$('a, button').find((a) => clean(a.textContent) === '»');
        if (!next) break;
        const before = table.textContent;
        next.click();
        await sleep(1200);
        const tableAfter = $$('table').find(isRefundTable);
        if (!tableAfter || tableAfter.textContent === before) break; // no change -> no more pages
      }
    }

    try { await GSTKdb.replaceRefundApplications(cur.clientId, allRows); } catch (e) { /* non-fatal */ }
    debugPanel([
      'STEP: Refund Applications  (' + location.pathname + ')',
      'years checked     : ' + years.join(', '),
      'rows read         : ' + allRows.length,
    ]);
    banner('Refund applications → ' + allRows.length + ' entries saved. Now DRC-03 filings…' + progress, '#16a34a');
    await sleep(1000);
    await chainOrStop(job, 'refunds', proceedToDrc03);
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
    let cases = [];
    try {
      const r = await fetch('https://services.gst.gov.in/litserv/auth/api/case/search', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseTypeCd: 'ADJVP', startDate: '01/07/2017', endDate: shownTodayDdMmYyyy() }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status + ' from case/search');
      cases = await r.json();
      if (!Array.isArray(cases)) cases = [];
    } catch (e) {
      debugPanel(['STEP: DRC-03 Filings  (' + location.pathname + ')', 'fetch failed: ' + (e && e.message)]);
      banner('DRC-03: could not read the portal API (' + (e && e.message) + ') — skipped.' + progress, '#dc2626');
      try { await GSTKdb.replaceDrc03Filings(cur.clientId, [{ client_id: cur.clientId, status: 'PULL FAILED: ' + ((e && e.message) || 'unknown error') }]); } catch (e2) { /* diagnostic only */ }
      await sleep(1500);
      await chainOrStop(job, 'drc03', proceedToTaxpayerProfile);
      return;
    }

    const rows = [];
    let pdfOk = 0, pdfFail = 0;
    for (const c of cases) {
      const row = parseDrc03Case(c, cur.clientId);
      if (!row) continue;
      // Best-effort PDF capture — one document per filing (the DRC-03 form
      // itself). A failure here must not drop the filing's own figures.
      try {
        const docId = row.__docId;
        if (docId) {
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

    try { await GSTKdb.replaceDrc03Filings(cur.clientId, rows); } catch (e) { /* non-fatal */ }
    debugPanel([
      'STEP: DRC-03 Filings  (' + location.pathname + ')',
      'cases read        : ' + cases.length,
      'rows saved        : ' + rows.length,
      'PDFs captured     : ' + pdfOk + ' ok, ' + pdfFail + ' failed',
    ]);
    banner('DRC-03 filings → ' + rows.length + ' entries saved (' + pdfOk + ' PDFs). Now Taxpayer Profile…' + progress, '#16a34a');
    await sleep(1000);
    await chainOrStop(job, 'drc03', proceedToTaxpayerProfile);
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
        legal_name: j.lgnm || null, trade_name: j.tradeNam || null, constitution_of_business: j.ctb || null,
        registration_date: ddmmyyyyToIso(j.rgdt || ''), jurisdiction_state: j.stj || null, jurisdiction_centre: j.ctj || null,
        principal_place_address: (j.pradr && j.pradr.adr) || null, aadhaar_authentication_status: j.adhrVFlag || null,
        updated_at: new Date().toISOString(),
      };
    } catch (e) {
      debugPanel(['STEP: Taxpayer Profile  (' + location.pathname + ')', 'fetch failed: ' + (e && e.message)]);
      banner('Taxpayer Profile: could not read the portal API (' + (e && e.message) + ') — skipped.' + progress, '#dc2626');
      await sleep(1500);
      await chainOrStop(job, 'taxpayerprofile', proceedToChallans);
      return;
    }

    // Registration certificate PDF — best-effort, must not drop the profile
    // fields above if it fails.
    try {
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
    banner('Taxpayer Profile → saved. Now Challan Summary…' + progress, '#16a34a');
    await sleep(1000);
    await chainOrStop(job, 'taxpayerprofile', proceedToChallans);
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
