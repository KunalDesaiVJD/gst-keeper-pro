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

  try {
    if (job.step === 'login') await handleLogin(job);
    else if (job.step === 'filing') await handleFiling(job);
    else if (job.step === 'ledger') await handleLedger(job);
    else if (job.step === 'done') { banner('All done — you can close this tab.', '#16a34a'); await clearJob(); }
  } catch (e) {
    if (e && e.message === 'cancelled') { banner('Cancelled.', '#6b7280'); await clearJob(); }
    else banner('Error: ' + (e && e.message), '#dc2626');
  }

  async function handleLogin(job) {
    if (isLoggedIn()) {
      banner('Logged in — reading filed returns…');
      job.step = 'filing';
      await setJob(job);
      location.href = 'https://return.gst.gov.in/returns/auth/trackreturnstatus';
      return;
    }
    if (!/services\/login/.test(url)) { location.href = 'https://services.gst.gov.in/services/login'; return; }
    banner('Logging in ' + job.creds.name + '…');
    if (!(await waitFor('#username'))) { banner('Login form did not load — reload the page.', '#dc2626'); return; }
    setVal($('#username'), job.creds.user);
    setVal($('#user_pass'), job.creds.pass);
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

  async function handleFiling(job) {
    if (!/trackreturnstatus/.test(url)) { location.href = 'https://return.gst.gov.in/returns/auth/trackreturnstatus'; return; }
    banner('Reading filed returns…');
    await waitFor('input[name="aaa"]');
    const radio = $$('input[name="aaa"]').find((r) => r.value === 'retFilePer');
    if (radio) radio.click();
    await sleep(500);
    selectByText('select[name="fin"]', job.fyStart + '-' + (job.fyStart + 1));
    await sleep(300);
    const search = $('button.srchbtn') || $$('button').find((b) => /search/i.test(b.textContent || ''));
    if (search) search.click();

    let rows = [];
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) {
      const trs = $('table') ? [...$('table').querySelectorAll('tbody tr')] : [];
      if (trs.length) { rows = trs.map((tr) => [...tr.children].map((td) => (td.textContent || '').replace(/\s+/g, ' ').trim())); break; }
      await sleep(500);
    }
    const written = [];
    const nowIso = new Date().toISOString();
    for (const cells of rows) {
      if (cells.length < 6) continue;
      const [arnRaw, typeLabel, fyText, taxPeriod, dateFiled, status] = cells;
      if (!/^filed$/i.test((status || '').trim())) continue;
      const arn = (arnRaw || '').toUpperCase();
      if (!/^[A-Z0-9]{15}$/.test(arn)) continue;
      const return_type = resolveReturnType(typeLabel, job.creds.selectedReturns || []);
      const period_month = resolvePeriodMonth(fyText, taxPeriod);
      if (!return_type || !period_month) continue;
      written.push({ client_id: job.clientId, return_type, period_month, status: 'Filed', arn, filed_date: ddmmyyyyToIso(dateFiled), updated_at: nowIso });
    }
    if (written.length) await GSTKdb.upsertFilingStatus(written);
    banner('Filing status: wrote ' + written.length + ' ARN(s). Now the ledger…', '#16a34a');
    job.step = 'ledger';
    await setJob(job);
    location.href = 'https://return.gst.gov.in/returns/auth/ledger/detailedledger';
  }

  async function handleLedger(job) {
    if (!/detailedledger/.test(url)) { location.href = 'https://return.gst.gov.in/returns/auth/ledger/detailedledger'; return; }
    banner('Reading credit-ledger opening balance…');
    if (!(await waitFor('#sumlg_frdt'))) { banner('Ledger form did not load — done anyway.', '#f59e0b'); job.step = 'done'; await setJob(job); location.reload(); return; }
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
      await GSTKdb.upsertReco('suspended_reco', job.clientId, job.period, opening);
      await GSTKdb.upsertReco('gst_receivable_reco', job.clientId, job.period, opening);
      banner('Opening balance saved. Sync complete — close this tab.', '#16a34a');
    } else {
      banner('No opening-balance row found — filing status was still saved. Done.', '#f59e0b');
    }
    await clearJob();
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
