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
  if ((job.step === 'ledger' || job.step === 'reversal' || job.step === 'efiledpdf' || job.step === 'efiledview' || job.step === 'twob' || job.step === 'twobdwld' || job.step === 'filing') && bounced) {
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
    else if (job.step === 'efiledview') await handleReturnView(job, cur, progress);
    else if (job.step === 'twob') await handleTwob(job, cur, progress);
    else if (job.step === 'twobdwld') await handleTwobDownload(job, cur, progress);
    else if (job.step === 'filing') await handleFiling(job, cur, progress);
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
      } else if (job.mode === 'filing') {
        banner('Logged in — opening the filing page…' + progress);
        job.step = 'filing';
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
    const ret = job.ret || {};
    const arn = (ret.arn || '').toUpperCase();
    if (!/^[A-Z0-9]{15}$/.test(arn)) { banner('Lost the ARN — please retry the pull.', '#dc2626'); await clearJob(); return; }
    // Already clicked download and bounced back → it opened a viewer we can't
    // capture; stop instead of looping.
    if (job.viewClicked) { banner('The ' + ret.return_type + ' download did not produce a capturable file — tell me the exact button label on the view page.', '#dc2626'); await clearJob(); return; }

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
    if (!dl) { banner('On the filed ' + ret.return_type + ' page but found no PDF-download button — tell me the button label you see.', '#f59e0b'); await clearJob(); return; }

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
    if (!(await waitFor('#sumlg_frdt', 20000))) { banner('Ledger form did not load — moving on.' + progress, '#f59e0b'); await advance(job); return; }
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
    if (!(await waitFor('input', 20000))) { banner('Reversal ledger form did not load — moving on.' + progress, '#f59e0b'); await advance(job); return; }
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
      await advance(job);
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
