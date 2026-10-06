(() => {
  // Same value as MIN_EXTENSION_VERSION / RECOMMENDED_EXTENSION_VERSION in
  // src/lib/extensionVersion.ts; keep them in step when the app raises them.
  const MIN_VERSION = '0.4.0';
  const RECOMMENDED_VERSION = '0.5.1';
  const APP_URL = 'https://gst.vjdesai.com';
  const DASHBOARD_URL = APP_URL + '/notices-dashboard';
  const LOGIN_URL = 'https://services.gst.gov.in/services/login';
  const MIN_PER_CLIENT = 2.5;
  const DAY_MS = 24 * 3600 * 1000;
  const CACHE_KEY = 'gstk_popup_status';

  const $ = (id) => document.getElementById(id);
  const VERSION = chrome.runtime.getManifest().version;

  const REASONS = {
    login_failed: 'login failed', captcha_timeout: 'CAPTCHA not typed', session_mismatch: 'wrong GSTIN session',
    portal_error: 'portal error', timeout: 'timed out', save_failed: 'save failed', stalled: 'stalled',
    guard_held: 'held back', partial: 'partial pull', empty: 'empty pull', other: 'other',
  };
  const STEPS = {
    login: 'Logging in', logout: 'Logging out', notices: 'Reading notices & orders',
    refunds_reg_check: 'Reading refund applications', refunds_warmup: 'Reading refund applications',
    refunds: 'Reading refund applications', refund_docs: 'Reading refund documents', drc03: 'Reading DRC-03 payments',
    ledger: 'Reading the credit ledger', reversal: 'Reading the credit reversal & re-claim ledger',
    liabilityledger: 'Reading the liability ledger', cashledger: 'Reading the cash ledger',
    taxpayerprofile: 'Reading the taxpayer profile', challans: 'Reading challans',
  };
  const MODES = {
    notices_bundle: 'Notices & orders, refunds and DRC-03', notices: 'Notices & orders', refunds: 'Refunds',
    drc03: 'DRC-03', taxpayerprofile: 'Taxpayer profile', challans: 'Challans', filing: 'Filing status',
  };

  const cmpVer = (a, b) => {
    const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d;
    }
    return 0;
  };
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const fmtWhen = (iso) => {
    if (!iso) return 'never';
    const t = new Date(iso).getTime();
    const mins = Math.round((Date.now() - t) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';
    if (mins < 24 * 60) return Math.round(mins / 60) + ' h ago';
    return new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  };
  const store = {
    get: (k) => new Promise((res) => { try { chrome.storage.local.get(k, (o) => res((o || {})[k])); } catch (e) { res(undefined); } }),
    set: (o) => new Promise((res) => { try { chrome.storage.local.set(o, () => res()); } catch (e) { res(); } }),
    remove: (k) => new Promise((res) => { try { chrome.storage.local.remove(k, () => res()); } catch (e) { res(); } }),
  };
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('no answer within ' + ms / 1000 + ' s')), ms))]);
  const msgBox = (el, kind, title, text) => {
    el.className = 'msg ' + kind;
    el.textContent = '';
    if (title) { const s = document.createElement('strong'); s.textContent = title; el.appendChild(s); }
    if (text) { const p = document.createElement('p'); p.textContent = text; el.appendChild(p); }
    el.hidden = false;
  };
  const openTab = (url) => { try { chrome.tabs.create({ url }); } catch (e) { /* ignore */ } };

  // ── State ────────────────────────────────────────────────────────────────
  let clients = [];       // every client (background getClients)
  let eligible = [];      // command-centre "eligible": credentials, active, not excluded
  let staleOrFailed = [];
  let pickable = [];      // single-client picker: credentials and not excluded
  let job = null;
  let loaded = false;
  const belowMin = cmpVer(VERSION, MIN_VERSION) < 0;

  // ── Header / version ─────────────────────────────────────────────────────
  $('ver').textContent = 'v' + VERSION;
  if (belowMin) {
    msgBox($('versionMsg'), 'bad', 'This extension is out of date (v' + VERSION + ')',
      'GST Keeper needs v' + MIN_VERSION + ' or later before it will accept a notices sync. Load the updated extension folder '
      + '(chrome://extensions → Reload) on this PC.');
  } else if (cmpVer(VERSION, RECOMMENDED_VERSION) < 0) {
    msgBox($('versionMsg'), 'warn', 'Update recommended',
      'v' + VERSION + ' still syncs; v' + RECOMMENDED_VERSION + ' is faster and fills the run ledger.');
  }

  $('openDash').onclick = () => openTab(DASHBOARD_URL);
  $('errReload').onclick = () => openTab('chrome://extensions/?id=' + chrome.runtime.id);
  $('errRetry').onclick = () => load(true);

  // ── Status: same definitions as the app's command centre ────────────────
  // (supabase/migrations/20261006122000_notice_command_centre.sql: eligible,
  // sync_state, failing).
  function computeStatus(rows, lastRun) {
    const byClient = new Map();
    for (const r of rows || []) {
      if (!byClient.has(r.client_id)) byClient.set(r.client_id, {});
      byClient.get(r.client_id)[r.step] = r;
    }
    const now = Date.now();
    let fresh = 0;
    const failing = {};
    const list = [];
    for (const c of eligible) {
      const s = byClient.get(c.id) || {};
      const n = s.notices || {}, l = s.login || {};
      const okAt = n.last_success_at ? new Date(n.last_success_at).getTime() : null;
      const isFresh = okAt != null && okAt > now - DAY_MS;
      let reason = null;
      if (l.last_status === 'failed' && l.last_attempt_at && (okAt == null || new Date(l.last_attempt_at).getTime() >= okAt)) {
        reason = l.last_reason_class || 'login_failed';
      } else if (n.last_status === 'failed') reason = n.last_reason_class || 'other';
      if (isFresh) fresh++;
      if (reason) failing[reason] = (failing[reason] || 0) + 1;
      if (!isFresh || reason) list.push(c.id);
    }
    return {
      at: new Date().toISOString(), eligible: eligible.length, fresh, failing, staleOrFailed: list,
      lastRun: lastRun ? { started_at: lastRun.started_at, finished_at: lastRun.finished_at, status: lastRun.status,
        mode: lastRun.mode, clients_total: lastRun.clients_total, clients_done: lastRun.clients_done } : null,
    };
  }

  function renderStatus(st, cachedNote) {
    const r = st.lastRun;
    $('stRun').textContent = r
      ? fmtWhen(r.started_at) + ' · ' + r.status + (r.clients_total ? ' ' + (r.clients_done || 0) + '/' + r.clients_total : '')
      : 'No run recorded yet';
    $('stFresh').textContent = st.fresh + ' of ' + plural(st.eligible, 'client');
    $('stFresh').className = st.eligible && st.fresh === st.eligible ? 'ok' : '';
    const reasons = Object.entries(st.failing || {});
    const nFail = reasons.reduce((a, [, n]) => a + n, 0);
    $('stFail').textContent = nFail ? plural(nFail, 'client') : 'None';
    $('stFail').className = nFail ? 'bad' : 'ok';
    $('stReasons').hidden = !nFail;
    $('stReasons').textContent = nFail ? 'Why: ' + reasons.map(([k, n]) => (REASONS[k] || k) + ' ' + n).join(' · ') : '';
    $('stNote').hidden = !cachedNote;
    $('stNote').textContent = cachedNote || '';
  }

  // ── Running job (gstk_active_job, advanced by content.js) ────────────────
  function renderJob() {
    const card = $('jobCard');
    if (!job) { card.hidden = true; $('formCard').hidden = !loaded; $('otherCard').hidden = !loaded; return; }
    card.hidden = false;
    $('formCard').hidden = true;
    $('otherCard').hidden = true;
    const list = job.clients || [];
    const idx = Math.min(job.idx || 0, Math.max(list.length - 1, 0));
    const cur = list[idx];
    const name = (cur && cur.creds && cur.creds.name) || 'client';
    const step = STEPS[job.step] || job.step || 'Starting';
    $('jobProgress').textContent = 'Client ' + (idx + 1) + ' of ' + list.length + ' · ' + name + ' · ' + step;
    $('jobBar').style.width = (list.length ? Math.round((idx / list.length) * 100) : 0) + '%';
    $('jobMode').textContent = (job.mode ? (MODES[job.mode] || job.mode) : 'Ledger pull') + (job.period && !job.runId ? ' · ' + job.period : '')
      + (job.startedAt ? ' · started ' + fmtWhen(new Date(job.startedAt).toISOString()) : '');
    const atLogin = job.step === 'login';
    $('captchaMsg').hidden = !atLogin;
    if (atLogin) $('captchaText').textContent = 'Type the CAPTCHA for ' + name + ' in the GST portal tab. A run moves on from a CAPTCHA nobody types after 10 minutes.';
  }

  $('openTab').onclick = async () => {
    if (!job || job.tabId == null) { msgBox($('flash'), 'warn', 'No portal tab is recorded for this sync.', ''); return; }
    try {
      const tab = await chrome.tabs.update(job.tabId, { active: true });
      if (tab && tab.windowId != null && chrome.windows) await chrome.windows.update(tab.windowId, { focused: true });
    } catch (e) {
      msgBox($('flash'), 'warn', 'The portal tab is closed.', 'Stop this sync and start it again, or open ' + LOGIN_URL + ' yourself.');
    }
  };

  $('stop').onclick = async () => {
    const btn = $('stop');
    btn.disabled = true;
    const active = await store.get('gstk_active_job');
    if (!active) { job = null; renderJob(); msgBox($('flash'), 'info', 'No sync was running.', ''); btn.disabled = false; return; }
    const list = active.clients || [];
    const idx = active.idx || 0;
    const cur = list[idx];
    let recorded = null;
    if (active.runId) {
      try { await withTimeout(GSTKdb.runFinish(active.runId, 'stopped', 'Stopped from the extension popup.'), 8000); recorded = true; }
      catch (e) { recorded = false; }
    }
    await store.remove('gstk_active_job');
    job = null;
    btn.disabled = false;
    renderJob();
    const what = (active.mode ? (MODES[active.mode] || active.mode) : 'Ledger pull') + ' for ' + plural(list.length, 'client');
    const where = cur ? ' at client ' + (idx + 1) + ' (' + ((cur.creds && cur.creds.name) || 'unnamed') + ')' : '';
    const left = Math.max(list.length - idx, 0);
    msgBox($('flash'), recorded === false ? 'warn' : 'ok', 'Stopped: ' + what + where + '.',
      plural(left, 'client') + ' not synced in this run. '
      + (recorded === true ? 'Recorded in the run ledger. ' : recorded === false ? 'The stop could not be recorded in the run ledger. ' : '')
      + 'You can close the GST portal tab.');
  };

  // ── Start form ───────────────────────────────────────────────────────────
  const scope = () => (document.querySelector('input[name=scope]:checked') || {}).value || 'stale';
  function targetIds() {
    const s = scope();
    if (s === 'stale') return staleOrFailed;
    if (s === 'all') return eligible.map((c) => c.id);
    const v = $('clientList').value;
    return v ? [v] : [];
  }
  function renderForm() {
    $('lblStale').textContent = 'Stale or failed (' + staleOrFailed.length + ')';
    $('lblAll').textContent = 'All active clients (' + eligible.length + ')';
    $('picker').hidden = scope() !== 'one';
    const n = targetIds().length;
    $('summary').textContent = n
      ? plural(n, 'client') + ' · about ' + plural(n, 'CAPTCHA') + ' · about ' + Math.max(1, Math.round(n * MIN_PER_CLIENT)) + ' min'
      : (scope() === 'one' ? 'Pick a client.' : scope() === 'stale' ? 'Every active client synced in the last 24 h.' : 'No active clients with portal credentials.');
    const s = scope();
    $('start').textContent = s === 'stale' ? 'Sync notices for stale & failed (' + n + ')'
      : s === 'all' ? 'Sync notices for all active clients (' + n + ')' : 'Sync notices for this client';
    $('start').disabled = !n || belowMin;
    if (belowMin) $('summary').textContent = 'Update the extension before syncing.';
  }
  function renderPicker() {
    const q = $('clientSearch').value.trim().toLowerCase();
    const sel = $('clientList');
    const keep = sel.value;
    sel.textContent = '';
    for (const c of pickable) {
      if (q && !(c.name || '').toLowerCase().includes(q) && !(c.gstin || '').toLowerCase().includes(q)) continue;
      const o = document.createElement('option');
      o.value = c.id;
      o.textContent = c.name + (c.inactive_at_hand ? ' (inactive)' : '');
      sel.appendChild(o);
    }
    if (keep && [...sel.options].some((o) => o.value === keep)) sel.value = keep;
    renderForm();
  }
  for (const r of document.querySelectorAll('input[name=scope]')) r.onchange = () => { renderForm(); if (scope() === 'one') $('clientSearch').focus(); };
  $('clientSearch').oninput = renderPicker;
  $('clientList').onchange = renderForm;

  $('start').onclick = async () => {
    const ids = targetIds();
    if (!ids.length) return;
    $('start').disabled = true;
    msgBox($('flash'), 'info', 'Starting…', 'Opening the GST portal in a new tab.');
    try {
      // Same call as the app's Sync now: unscoped "all" lets the background
      // apply its own active / excluded filter.
      const res = await GSTKdb.startSectionPull({ mode: 'notices_bundle', clientIds: scope() === 'all' ? undefined : ids });
      msgBox($('flash'), 'ok', 'Sync started for ' + plural((res && res.count) || ids.length, 'client') + '.',
        'Type each CAPTCHA in the portal tab as it comes up.');
    } catch (e) {
      msgBox($('flash'), 'bad', 'The sync did not start.', (e && e.message) || String(e));
      renderForm();
    }
  };

  // ── Other syncs: legacy return-period ledger pull ───────────────────────
  const now = new Date();
  const pm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  $('period').value = String(pm.getMonth() + 1).padStart(2, '0') + '/' + pm.getFullYear();
  $('legGo').onclick = async () => {
    const period = $('period').value.trim();
    if (!/^(0[1-9]|1[0-2])\/\d{4}$/.test(period)) { msgBox($('legMsg'), 'bad', 'Period must be MM/YYYY, e.g. 06/2026.', ''); $('period').focus(); return; }
    const c = clients.find((x) => x.id === $('legClient').value);
    if (!c || !c.gst_user_id) { msgBox($('legMsg'), 'bad', 'Pick a client with saved portal credentials.', ''); return; }
    const [mm, yyyy] = period.split('/').map((n) => parseInt(n, 10));
    const legacy = {
      period, fyStart: mm >= 4 ? yyyy : yyyy - 1, idx: 0, step: 'login', startedAt: Date.now(),
      clients: [{ clientId: c.id, creds: { user: c.gst_user_id, name: c.name, gstin: c.gstin, selectedReturns: c.selected_returns || [] } }],
    };
    const tab = await chrome.tabs.create({ url: LOGIN_URL });
    legacy.tabId = tab.id;
    await store.set({ gstk_active_job: legacy });
    window.close();
  };
  function renderLegacy() {
    const sel = $('legClient');
    sel.textContent = '';
    for (const c of clients.filter((x) => x.gst_user_id)) {
      const o = document.createElement('option');
      o.value = c.id;
      o.textContent = c.name;
      sel.appendChild(o);
    }
    $('legGo').disabled = !sel.options.length;
  }

  // ── Load (one automatic retry, then the error panel) ─────────────────────
  async function fetchAll() {
    let stage = 'background';
    try {
      const cl = await withTimeout(GSTKdb.getClients(), 10000);
      stage = 'database';
      const [rows, lastRun] = await withTimeout(Promise.all([GSTKdb.getSyncStatus(), GSTKdb.getLastRun()]), 10000);
      return { cl, rows, lastRun };
    } catch (e) {
      // getClients goes through the worker; a database error it relays is still a database error.
      const dead = /Receiving end does not exist|Could not establish connection|no response from background|no answer within|message port closed|Extension context invalidated/i;
      e.stage = stage === 'background' && !dead.test(String(e && e.message)) ? 'database' : stage;
      throw e;
    }
  }
  async function load(manual) {
    $('errRetry').disabled = true;
    let data = null, err = null;
    for (let attempt = 0; attempt < 2 && !data; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 1200));
      try { data = await fetchAll(); err = null; } catch (e) { err = e; }
    }
    $('errRetry').disabled = false;
    if (!data) return showError(err, manual);
    $('errorPanel').hidden = true;
    clients = data.cl || [];
    eligible = clients.filter((c) => (c.gst_user_id || '') !== '' && !c.inactive_at_hand && !c.notices_sync_excluded);
    pickable = clients.filter((c) => (c.gst_user_id || '') !== '' && !c.notices_sync_excluded);
    const st = computeStatus(data.rows, data.lastRun);
    staleOrFailed = st.staleOrFailed;
    await store.set({ [CACHE_KEY]: { ...st, staleOrFailed: undefined, staleOrFailedCount: st.staleOrFailed.length } });
    renderStatus(st);
    loaded = true;
    renderPicker();
    renderLegacy();
    renderJob();
  }
  async function showError(e, manual) {
    const raw = (e && e.message) || String(e);
    const db = e && e.stage === 'database';
    $('errTitle').textContent = db ? 'GST Keeper\'s database did not answer' : 'The extension\'s background service is not responding';
    $('errText').textContent = (db
      ? 'Sync status could not be read, so syncing is paused here. Check the internet connection and retry.'
      : 'Syncing from this popup is unavailable until it answers. Retry, or reload the extension.')
      + (manual ? ' (Retried just now.)' : '');
    $('errRaw').textContent = raw;
    $('errorPanel').hidden = false;
    loaded = false;
    $('formCard').hidden = true;
    $('otherCard').hidden = true;
    const cached = await store.get(CACHE_KEY);
    if (cached) renderStatus(cached, 'Last known status, as of ' + fmtWhen(cached.at) + '.');
    else {
      $('stRun').textContent = 'Unavailable';
      $('stFresh').textContent = '–';
      $('stFail').textContent = '–';
      $('stFail').className = '';
      $('stReasons').hidden = true;
    }
    renderJob();
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.gstk_active_job) return;
      const wasRunning = !!job;
      job = changes.gstk_active_job.newValue || null;
      renderJob();
      if (wasRunning && !job && loaded) load();
    });
  } catch (e) { /* storage events unavailable */ }

  store.get('gstk_active_job').then((j) => { job = j || null; renderJob(); });
  load(false);
})();
