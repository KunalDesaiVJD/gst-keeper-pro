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
    const t = Date.now();
    while (Date.now() - t < timeout) {
      for (const s of $$('select')) {
        if (s.disabled || s.offsetParent === null) continue;
        const opt = [...s.options].find((o) => {
          const txt = norm(o.textContent);
          return txt && (startsWith ? txt.startsWith(target) : txt === target);
        });
        if (opt && !opt.disabled) {
          s.value = opt.value;
          opt.selected = true;
          s.dispatchEvent(new Event('input', { bubbles: true }));
          s.dispatchEvent(new Event('change', { bubbles: true }));
          return s;
        }
      }
      await sleep(250);
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
  const me = await GSTKdb.whoami().catch(() => null);
  if (job.tabId != null && me && me.tabId != null && me.tabId !== job.tabId) return;

  // Support the single-client shape AND the multi-client queue shape.
  if (!job.clients) job.clients = [{ clientId: job.clientId, creds: job.creds }];
  if (job.idx == null) job.idx = 0;
  const cur = job.clients[job.idx];
  const progress = job.clients.length > 1 ? ' (client ' + (job.idx + 1) + '/' + job.clients.length + ')' : '';

  // Loop guard: if the session died mid-sync (Access Denied / bounced to login)
  // while we expected to be logged in, DON'T keep navigating. Re-login a couple of
  // times, then give up on this client — never loop forever.
  const bounced = /services\/error|accessdenied/.test(url) || /services\/login/.test(url);
  if ((job.step === 'ledger' || job.step === 'reversal' || job.step === 'efiledpdf' || job.step === 'twob' || job.step === 'twobdwld') && bounced) {
    job.retries = (job.retries || 0) + 1;
    if (job.retries > 2) {
      banner('Session kept dropping for ' + cur.creds.name + ' — moving on.', '#dc2626');
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
    else if (job.step === 'efiledpdf') await handleReturnPdf(job, cur, progress);
    else if (job.step === 'twob') await handleTwob(job, cur, progress);
    else if (job.step === 'twobdwld') await handleTwobDownload(job, cur, progress);
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
    if (!(await selectWhereOption(freq))) { banner('Could not set the filing period (' + freq + ').', '#dc2626'); await clearJob(); return; }
    if (freq === 'Quarterly') {
      // GST FY quarters: Q1 Apr-Jun, Q2 Jul-Sep, Q3 Oct-Dec, Q4 Jan-Mar.
      const q = mm >= 4 ? Math.ceil((mm - 3) / 3) : 4;
      await selectWhereOption('Quarter' + q, { alnum: true, startsWith: true, timeout: 6000 });
    }
    // Month dropdown only renders after the period is chosen — selectWhereOption
    // polls, so it waits for it to appear. (Quarterly views may not have one.)
    const monthSel = await selectWhereOption(monthName, { timeout: freq === 'Monthly' ? 12000 : 6000 });
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
    // The last cell holds the download control. Prefer a real DOWNLOAD link/icon;
    // deliberately do NOT fall back to a "View" link (it navigates → would loop).
    const dl = tr.querySelector('a[title="download" i], a[download], a[href$=".pdf" i], a[href*="pdf" i]')
      || (tr.querySelector('i.fa-download') && tr.querySelector('i.fa-download').closest('a, button'))
      || [...tr.querySelectorAll('a, button')].find((a) => /download/i.test((a.textContent || '') + ' ' + (a.getAttribute('title') || '') + ' ' + (a.className || '')));
    if (!dl) { banner('Found ' + ret.return_type + ' (ARN ' + arn + ') but no direct PDF-download link in the row (only View?) — tell me and I\'ll wire the View→download step.', '#f59e0b'); await clearJob(); return; }

    banner('Downloading the ' + ret.return_type + ' PDF…');
    job.pdfClicked = true;
    await setJob(job);
    const dataUrl = await new Promise((resolve) => {
      const h = (e) => { if (e.data && e.data.__gstkPdf) { window.removeEventListener('message', h); resolve(e.data.__gstkPdf); } };
      window.addEventListener('message', h);
      setTimeout(() => { window.removeEventListener('message', h); resolve(null); }, 20000);
      dl.click();
    });
    if (!dataUrl) { banner('Found ' + ret.return_type + ' (ARN ' + arn + ') but could not capture the PDF — tell me what happens when you click View/Download in that row.', '#dc2626'); await clearJob(); return; }

    try {
      const path = cur.clientId + '/' + ret.period_month.replace('/', '-') + '/' + ret.return_type + '-' + arn + '.pdf';
      const pdfUrl = await GSTKdb.uploadPdf(path, dataUrl);
      await GSTKdb.markFiled({
        client_id: cur.clientId, return_type: ret.return_type, period_month: ret.period_month,
        status: 'Filed', arn, filed_date: filedDate, return_pdf_url: pdfUrl, updated_at: new Date().toISOString(),
      });
      banner(ret.return_type + ' ' + ret.period_month + ' — Filed + PDF saved ✓. Close this tab.', '#16a34a');
    } catch (e) {
      banner('Save failed: ' + (e && e.message), '#dc2626');
    }
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
    await selectWhereOption('Quarter ' + q, { startsWith: true, timeout: 8000 });
    if (!(await selectWhereOption(monthName, { timeout: 10000 }))) { banner('Could not set the month on the dashboard.', '#dc2626'); await clearJob(); return; }
    await sleep(300);
    const search = $('button.srchbtn') || $$('button').find((b) => /^search$/i.test((b.textContent || '').trim()));
    if (!search) { banner('Could not find the dashboard Search button.', '#dc2626'); await clearJob(); return; }
    search.click();

    // Wait for the GSTR-2B tile to render, then find its Download control.
    let dlBtn = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 14000 && !dlBtn) {
      await sleep(400);
      const tiles = $$('div.col-md-4, div.col-sm-4, div.dash-tiles, div.card, div.panel');
      const tile = tiles.find((t) => /gstr[\s-]*2b/i.test(t.textContent || ''));
      if (tile) dlBtn = [...tile.querySelectorAll('button, a')].find((b) => /download/i.test(b.textContent || ''));
    }
    if (!dlBtn) { banner('Could not find the GSTR-2B tile / Download after Search.', '#dc2626'); await clearJob(); return; }
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
    if (!/gstr2b/.test(url)) { banner('Did not reach the GSTR-2B download page.', '#f59e0b'); await clearJob(); return; }
    banner('Generating the GSTR-2B Excel…' + progress);
    let genBtn = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 15000 && !genBtn) {
      genBtn = $$('button, a').find((x) => /generate\s+excel/i.test(x.textContent || ''));
      if (!genBtn) await sleep(400);
    }
    if (!genBtn) { banner('Could not find "Generate Excel" on the GSTR-2B download page.', '#dc2626'); await clearJob(); return; }

    const captured = new Promise((resolve) => {
      const h = (e) => { if (e.data && e.data.__gstkPdf) { window.removeEventListener('message', h); resolve(e.data); } };
      window.addEventListener('message', h);
      setTimeout(() => { window.removeEventListener('message', h); resolve(null); }, 60000);
    });
    genBtn.click();
    banner('Waiting for the GSTR-2B file (this can take a moment)…' + progress);
    const data = await captured;
    if (!data || !data.__gstkPdf) { banner('GSTR-2B did not download as a file I can capture — tell me what happens after "Generate Excel".', '#dc2626'); await clearJob(); return; }

    const fileName = 'GSTR2B_' + cur.clientId + '_' + String(job.period).replace('/', '-') + '.xlsx';
    await store.set({ gstk_twob_result: {
      ok: true, clientId: cur.clientId, gstin: (cur.creds && cur.creds.gstin) || '', period: job.period,
      fileB64: data.__gstkPdf, fileName, at: Date.now(),
    } });
    banner('GSTR-2B captured ✓ — importing into GST Keeper. You can close this tab.', '#16a34a');
    await clearJob();
  }

  async function handleLedger(job, cur, progress) {
    if (!/detailedledger/.test(url)) { location.href = 'https://return.gst.gov.in/returns/auth/ledger/detailedledger'; return; }
    banner('Reading credit-ledger opening balance…' + progress);
    if (!(await waitFor('#sumlg_frdt'))) { banner('Ledger form did not load — moving on.' + progress, '#f59e0b'); await advance(job); return; }
    const [mm, yyyy] = job.period.split('/').map((n) => parseInt(n, 10));
    const last = new Date(yyyy, mm, 0).getDate();
    const p2 = (n) => String(n).padStart(2, '0');
    setVal($('#sumlg_frdt'), '01/' + p2(mm) + '/' + yyyy);
    setVal($('#sumlg_todt'), p2(last) + '/' + p2(mm) + '/' + yyyy);
    const go = $('button.btn-primary.mar-0') || $$('button').find((b) => /^go$/i.test((b.textContent || '').trim()));
    if (go) go.click();
    await sleep(2500);
    const trs = $('table') ? [...$('table').querySelectorAll('tbody tr')] : [];
    const row = trs.find((tr) => /opening balance/i.test(tr.textContent || ''));
    if (row) {
      const cells = [...row.children].map((td) => parseFloat((td.textContent || '').replace(/[,\s₹]/g, '')) || 0);
      const n = cells.length;
      const opening = {
        opening_igst: cells[n - 5], opening_cgst: cells[n - 4], opening_sgst: cells[n - 3],
        opening_source: 'portal', opening_portal_pulled_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      // Credit-ledger opening -> GST Receivable Reco.
      await GSTKdb.upsertReco('gst_receivable_reco', cur.clientId, job.period, opening);
      banner('Credit-ledger opening saved — now the reversal ledger…' + progress, '#16a34a');
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
    if (!(await waitFor('#sumlg_frdt'))) { banner('Reversal ledger form did not load — moving on.' + progress, '#f59e0b'); await advance(job); return; }
    const [mm, yyyy] = job.period.split('/').map((n) => parseInt(n, 10));
    const last = new Date(yyyy, mm, 0).getDate();
    const p2 = (n) => String(n).padStart(2, '0');
    setVal($('#sumlg_frdt'), '01/' + p2(mm) + '/' + yyyy);
    setVal($('#sumlg_todt'), p2(last) + '/' + p2(mm) + '/' + yyyy);
    const go = $('button.btn-primary.mar-0') || $$('button').find((b) => /^go$/i.test((b.textContent || '').trim()));
    if (go) go.click();
    await sleep(2500);
    const trs = $('table') ? [...$('table').querySelectorAll('tbody tr')] : [];
    const row = trs.find((tr) => /opening balance/i.test(tr.textContent || ''));
    if (row) {
      const cells = [...row.children].map((td) => parseFloat((td.textContent || '').replace(/[,\s₹]/g, '')) || 0);
      const n = cells.length;
      const opening = {
        opening_igst: cells[n - 4], opening_cgst: cells[n - 3], opening_sgst: cells[n - 2],
        opening_source: 'portal', opening_portal_pulled_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      await GSTKdb.upsertReco('suspended_reco', cur.clientId, job.period, opening);
      banner('Reversal-ledger opening saved.' + progress, '#16a34a');
    } else {
      banner('No reversal opening-balance row found.' + progress, '#f59e0b');
    }
    await advance(job);
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
