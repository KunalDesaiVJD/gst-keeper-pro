// Scheduled syncs in this Chrome (extension 0.7.0; the firm's decision of
// 2026-10-06, docs/PORTAL_AUTOPILOT_POSITIONS.md). Loaded by background.js
// (importScripts), so API, rpc, sel, post, jobSlot, armWatchdog and EXT_VERSION
// are background.js's own.
//
// "Run scheduled syncs in this Chrome" (popup; off by default) makes this
// browser a runner of the autopilot queue, agent 'chrome:<id>'. About once a
// minute (chrome.alarms) it reports itself (autopilot_heartbeat) and, when
// nothing else runs in this browser, claims one job (portal_job_claim) and runs
// it the way a person's sync runs: the same steps in content.js, the same
// sync_ingest, the same run ledger. The CAPTCHA is filled by the CAPTCHA
// extension the firm keeps in this Chrome; this extension never reads, copies,
// sends or solves it. content.js only waits for the box to be filled and then
// presses Login. A box not filled within captcha_wait_secs fails the client with
// captcha_timeout, which the queue retries. The job is finished from the run
// ledger exactly as the office agent does it (agent/src/outcome.ts), the portal
// is logged out, the window closed, and the next job claimed.
//
// A person comes first: a sync a person starts in this browser takes the job
// slot (the runner gives its client back to the queue, no try counted), and the
// runner does not start while a person's sync runs, or while someone using this
// PC has a GST portal tab open (their portal session would change under them).
//
// Where it runs: each client in a window of its own, never minimised, opened
// without taking the focus while someone uses the PC. The deadlines are kept here
// from timestamps, not by the page's timers. CHANGELOG 0.7.0 says why.
(() => {
  const CONFIG_KEY = 'gstk_runner';          // { enabled, id, label }: this Chrome's switch and name
  const STATE_KEY = 'gstk_runner_state';     // what the popup shows; what survives a worker restart
  const RESULT_KEY = 'gstk_runner_result';   // an end content.js reports (CAPTCHA not filled, no login page)
  const JOB_KEY = 'gstk_active_job';         // the job slot (background.js jobSlot)
  const SESSION_KEY = 'gstk_runner_session'; // chrome.storage.session: empty after a browser restart
  const ALARM = 'gstk-runner';
  const LOGOUT_URL = 'https://services.gst.gov.in/services/logout';
  const PORTAL_TABS = 'https://*.gst.gov.in/*';
  const JOB_BUDGET_MS = 40 * 60 * 1000;      // as the office agent (JOB_BUDGET_MIN)
  const LOGIN_PAGE_MS = 3 * 60 * 1000;       // the login page never became ready
  const CAPTCHA_GRACE_MS = 45 * 1000;        // the page's own timer normally ends the wait first
  const CLOSED_PAUSE_MS = 2 * 60 * 1000;     // after someone closed the runner's window
  const PERSON_IDLE_SECS = 300;              // someone used this PC in the last 5 minutes
  // Failures worth another try later (agent/src/outcome.ts).
  const TRANSIENT = new Set(['portal_error', 'timeout', 'stalled', 'save_failed', 'other']);
  const local = chrome.storage.local;
  const EMPTY = { status: 'off', why: null, job: null, beat: null, last: null, error: null, pause_until: null };

  const errText = (e) => String((e && e.message) || e || 'unknown error').slice(0, 300);
  const read = async (key) => (await local.get(key))[key];
  const clampWait = (v) => Math.min(900, Math.max(30, Number(v) || 120));
  const captchaWords = (secs) => 'The CAPTCHA was not filled within ' + secs + ' seconds.';
  const agentOf = (c) => 'chrome:' + c.id;

  async function config() {
    const c = (await read(CONFIG_KEY)) || {};
    return { enabled: !!c.enabled, id: typeof c.id === 'string' ? c.id : null, label: typeof c.label === 'string' ? c.label : '' };
  }
  async function state() { return { ...EMPTY, ...((await read(STATE_KEY)) || {}) }; }
  async function save(st) { st.updated_at = Date.now(); await local.set({ [STATE_KEY]: st }); return st; }

  // One tick at a time; a tick never rejects.
  let chain = Promise.resolve();
  function tick(why) {
    const run = chain.then(() => tickNow(why)).catch(async (e) => {
      try { const st = await state(); st.error = errText(e); await save(st); } catch (e2) { /* storage gone */ }
      return null;
    });
    chain = run;
    return run;
  }

  async function tickNow(why) {
    const c = await config();
    const st = await state();
    await recover(c, st, why);
    if (!c.enabled || !c.id) {
      if (st.job) await giveBack(c, st, 'Scheduled syncs were switched off in this Chrome; the client went back to the queue.');
      st.status = 'off';
      st.why = null;
      await save(st);
      try { await chrome.alarms.clear(ALARM); } catch (e) { /* no alarm */ }
      return st;
    }
    await armAlarm();
    let hb = await beat(c, st);
    if (st.job) {
      await watch(c, st, hb);
      if (st.job) return save(st);
      hb = await beat(c, st); // idle at once, then the next client
    }
    await claimNext(c, st, hb);
    return save(st);
  }

  // ── A new browser session: Chrome restarted, or this extension was reloaded ─
  async function recover(c, st, why) {
    if (!chrome.storage.session) return;
    let first = false;
    try {
      first = !(await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY];
      if (first) await chrome.storage.session.set({ [SESSION_KEY]: Date.now() });
    } catch (e) { return; }
    if (!first) return;
    // Whatever this runner held cannot go on: its page scripts are gone.
    await jobSlot(async () => { const aj = await read(JOB_KEY); if (aj && aj.runner) await local.remove(JOB_KEY); });
    await local.remove(RESULT_KEY);
    if (c.id) { try { await rpc('portal_jobs_release', { p_agent: agentOf(c) }); } catch (e) { /* claimNext releases leftovers */ } }
    if (st.job) {
      const rj = st.job;
      // After a reload the tab ids still hold; after a restart they may belong to a person's tabs now.
      if (why === 'installed' && rj.tab_id != null) {
        try {
          const t = await chrome.tabs.get(rj.tab_id);
          if (t && t.windowId === rj.window_id) await chrome.tabs.remove(rj.tab_id);
        } catch (e) { /* gone */ }
      }
      const words = why === 'installed'
        ? 'The extension was reloaded while this client was running; it went back to the queue.'
        : 'Chrome restarted while this client was running; it went back to the queue.';
      if (c.id) await event(rj.id, 'warn', 'release', words);
      st.last = { at: new Date().toISOString(), job_id: rj.id, client_name: rj.client_name, outcome: 'released', status: 'queued', reason: null, error: words };
      st.job = null;
      st.status = 'idle';
    }
    await save(st);
  }

  // ── Heartbeat: this Chrome as GST Keeper sees it, and the switches back ────
  async function beat(c, st) {
    const aj = st.job ? await read(JOB_KEY) : null;
    const ours = !!(aj && aj.runner && st.job && aj.runner.jobId === st.job.id);
    const info = {
      kind: 'chrome', label: c.label || 'Chrome', version: EXT_VERSION, busy: !!st.job,
      job_id: st.job ? st.job.id : null, client_name: st.job ? st.job.client_name : null,
      step: st.job ? (ours ? aj.step || null : 'starting') : null,
      waiting: st.job ? null : st.why || null,
    };
    const t0 = Date.now();
    try {
      const s = (await rpc('autopilot_heartbeat', { p_agent: agentOf(c), p_info: info })) || {};
      const t1 = Date.now();
      st.beat = {
        ok: true, at: t1, enabled: !!s.enabled, paused: !!s.paused, paused_until: s.paused_until || null,
        runner: s.runner || null, serves: s.serves === undefined ? s.runner === 'chrome' : !!s.serves,
        captcha_wait_secs: clampWait(s.captcha_wait_secs), max_attempts: Number(s.max_attempts) || 3,
        schedule: { enabled: !!s.schedule_enabled, morning_at: s.morning_at || null, afternoon_at: s.afternoon_at || null,
                    afternoon_scope: s.afternoon_scope || null },
        // The server's clock, so the run ledger is read from the job's own start.
        offset_ms: s.server_time ? Date.parse(s.server_time) - Math.round((t0 + t1) / 2) : 0,
      };
    } catch (e) {
      st.beat = { ...(st.beat || {}), ok: false, error: errText(e), failed_at: Date.now() };
    }
    await save(st);
    return st.beat;
  }

  // ── Idle: why not, or the next client ──────────────────────────────────────
  async function waitReason(st, hb) {
    if (!hb || !hb.ok) return 'offline';
    if (!hb.runner) return 'old_database';
    if (!hb.serves) return 'office_agent';
    if (!hb.enabled) return 'autopilot_off';
    if (hb.paused) return 'paused';
    if (st.pause_until && Date.now() < st.pause_until) return 'window_closed';
    if (await read(JOB_KEY)) return 'person_sync';
    if ((await foreignPortalTabs(null)).length && (await personState()) === 'active') return 'portal_in_use';
    return null;
  }

  async function claimNext(c, st, hb) {
    st.status = 'idle';
    st.why = await waitReason(st, hb);
    if (st.why) return;
    // Nothing of this runner's is running, so anything the queue still lists as
    // its own is left over (a give-back that did not reach the database).
    try { await rpc('portal_jobs_release', { p_agent: agentOf(c) }); } catch (e) { /* the claim below tells */ }
    let claimed = null;
    try { claimed = await rpc('portal_job_claim', { p_agent: agentOf(c), p_wall_open: false }); }
    catch (e) { st.why = 'offline'; st.error = errText(e); return; }
    if (!claimed || !claimed.id) return;
    await start(c, st, claimed, hb);
  }

  async function start(c, st, claimed, hb) {
    const payload = claimed.payload && typeof claimed.payload === 'object' ? claimed.payload : {};
    const mode = payload.mode || 'notices_bundle';
    const periods = Array.isArray(payload.periods) && payload.periods.length ? payload.periods : [''];
    const waitSecs = clampWait(hb.captcha_wait_secs);
    st.status = 'busy';
    st.why = null;
    st.error = null;
    st.job = {
      id: claimed.id, client_id: claimed.client_id, client_name: claimed.client_name || 'Client', gstin: claimed.gstin || null,
      run_id: claimed.run_id || null, job_type: claimed.job_type || 'PULL_NOTICES_BUNDLE', mode, try: (Number(claimed.attempts) || 0) + 1,
      started_at: Date.now(), since: new Date(Date.now() + (hb.offset_ms || 0) - 5000).toISOString(),
      wait_secs: waitSecs, tab_id: null, window_id: null, known_tabs: [], phase: 'starting',
    };
    await save(st);
    let client = null;
    try { client = await API.getClient(claimed.client_id); }
    catch (e) { return finish(c, st, { outcome: 'retry', reason: 'agent_error', error: 'Could not read the client: ' + errText(e) }); }
    if (!client || !client.gst_user_id) {
      return finish(c, st, { outcome: 'retry', reason: 'agent_error', error: 'This client has no saved GST credentials.' });
    }
    let started = false;
    try { started = await rpc('portal_job_start', { p_job_id: claimed.id, p_agent: agentOf(c), p_session_reused: false }); }
    catch (e) { return finish(c, st, { outcome: 'retry', reason: 'agent_error', error: errText(e) }); }
    if (!started) { st.job = null; st.status = 'idle'; return; } // cancelled meanwhile, or no longer this runner's

    // Portal tabs already open here belong to nobody at the PC (else the claim
    // would have waited): they are left alone, and only a new one counts.
    st.job.known_tabs = (await portalTabs()).map((t) => t.id);
    let win = null;
    try {
      win = await chrome.windows.create({ url: 'about:blank', type: 'normal', focused: (await personState()) !== 'active', width: 1280, height: 900 });
    } catch (e) { return finish(c, st, { outcome: 'retry', reason: 'agent_error', error: 'Could not open a window: ' + errText(e) }); }
    const tab = win && win.tabs && win.tabs[0];
    if (!tab) return finish(c, st, { outcome: 'retry', reason: 'agent_error', error: 'Could not open a window.' });
    st.job.tab_id = tab.id;
    st.job.window_id = win.id;
    st.job.phase = 'running';
    await save(st);
    try { await chrome.tabs.update(tab.id, { autoDiscardable: false }); } catch (e) { /* older Chrome */ }

    const job = {
      mode, period: periods[0], periods, periodIdx: 0, idx: 0,
      // Logged out first, so a client never starts inside another one's portal session.
      step: 'logout',
      startedAt: Date.now(), lastActivityAt: Date.now(), runId: claimed.run_id || null,
      logSync: mode === 'notices' || mode === 'notices_bundle',
      runner: { jobId: claimed.id, agentId: agentOf(c), captchaWaitSecs: waitSecs },
      clients: [{ clientId: client.id, creds: { user: client.gst_user_id, name: client.name, gstin: client.gstin, selectedReturns: client.selected_returns || [] } }],
      tabId: tab.id,
    };
    const placed = await jobSlot(async () => {
      if (await read(JOB_KEY)) return false;
      await local.set({ [JOB_KEY]: job });
      return true;
    });
    if (!placed) return giveBack(c, st, 'A sync started by a person in this Chrome came first; the client went back to the queue.');
    armWatchdog();
    await event(claimed.id, 'info', 'start', 'Started in the scheduled Chrome "' + (c.label || 'Chrome') + '"; the CAPTCHA extension there fills the CAPTCHA (wait up to ' + waitSecs + ' s).');
    try { await chrome.tabs.update(tab.id, { url: LOGOUT_URL }); }
    catch (e) { return endJob(c, st, { outcome: 'retry', reason: 'agent_error', error: 'Could not open the portal: ' + errText(e) }); }
    await beat(c, st);
  }

  // ── Busy: watch the client to its end ──────────────────────────────────────
  async function watch(c, st, hb) {
    const rj = st.job;
    if (rj.phase === 'finishing') return finish(c, st, rj.result || { outcome: 'retry', reason: 'agent_error', error: 'The scheduled sync stopped while finishing.' });
    if (rj.phase === 'giving_back') return giveBack(c, st, rj.why || 'The client went back to the queue.');
    if (rj.phase !== 'running' || rj.tab_id == null) {
      return giveBack(c, st, 'The scheduled sync was interrupted before it opened the portal; the client went back to the queue.');
    }
    const aj = await read(JOB_KEY);
    const ours = !!(aj && aj.runner && aj.runner.jobId === rj.id);
    if (!ours) {
      if (aj) return giveBack(c, st, 'A sync started by a person in this Chrome took over; the client went back to the queue.');
      return finish(c, st, (await takeResult(rj.id)) || (await readOutcome(rj)));
    }
    let row = null;
    try { row = (await sel('portal_jobs?id=eq.' + rj.id + '&select=status,claimed_by'))[0] || null; } catch (e) { /* the next tick looks again */ }
    if (row && (['cancelled', 'succeeded', 'failed'].includes(row.status) || row.claimed_by !== agentOf(c))) {
      return endJob(c, st, row.status === 'cancelled'
        ? { outcome: 'none', reason: 'cancelled', error: 'Cancelled in GST Keeper.' }
        : { outcome: 'none', reason: null, error: 'The queue took this client back.' });
    }
    if (!(await tabAlive(rj.tab_id))) {
      st.pause_until = Date.now() + CLOSED_PAUSE_MS;
      return endJob(c, st, { outcome: 'retry', reason: 'stalled', error: 'The scheduled sync window was closed before this client finished.' });
    }
    if ((await foreignPortalTabs(rj)).length) {
      return giveBack(c, st, 'Someone opened the GST portal in this Chrome; the scheduled client went back to the queue and the portal was logged out.');
    }
    const atLogin = aj.step === 'login' || aj.step === 'logout';
    if (atLogin && hb && hb.ok && (!hb.enabled || hb.paused || !hb.serves)) {
      return giveBack(c, st, !hb.enabled ? 'The autopilot was switched off before this client logged in; it went back to the queue.'
        : hb.paused ? 'The autopilot was paused before this client logged in; it went back to the queue.'
        : 'The autopilot was set to the office agent before this client logged in; it went back to the queue.');
    }
    const now = Date.now();
    if (aj.step === 'login' && aj.captchaWaitSince && now - aj.captchaWaitSince > rj.wait_secs * 1000 + CAPTCHA_GRACE_MS) {
      return endJob(c, st, { outcome: 'retry', reason: 'captcha_timeout', error: captchaWords(rj.wait_secs) });
    }
    if (atLogin && !aj.captchaWaitSince && now - (aj.lastActivityAt || rj.started_at) > LOGIN_PAGE_MS) {
      return endJob(c, st, { outcome: 'retry', reason: 'portal_error', error: 'The portal login page did not load.' });
    }
    if (now - rj.started_at > JOB_BUDGET_MS) {
      return endJob(c, st, { outcome: 'retry', reason: 'stalled', error: 'The job ran past its 40-minute budget.' });
    }
    return null;
  }

  // How the client went, from the run ledger rows this client's sync wrote since
  // the job started: the office agent's own mapping (agent/src/outcome.ts).
  async function readOutcome(rj) {
    let items = [];
    if (rj.run_id) {
      try {
        items = await sel('sync_run_items?run_id=eq.' + rj.run_id + '&client_id=eq.' + rj.client_id
          + '&created_at=gte.' + encodeURIComponent(rj.since) + '&select=step,status,reason_class,message&order=created_at');
      } catch (e) {
        return { outcome: 'retry', reason: 'agent_error', error: 'Could not read the run ledger: ' + errText(e), result: { runner: 'chrome' } };
      }
    }
    const steps = {};
    for (const i of items) steps[i.step] = i.status === 'failed' ? 'failed: ' + (i.reason_class || 'other') : i.status;
    const result = { steps, runner: 'chrome' };
    const login = items.find((i) => i.step === 'login' && i.status === 'failed');
    if (login) return { outcome: 'failed', reason: login.reason_class || 'login_failed', error: login.message, result };
    if (rj.job_type !== 'PULL_NOTICES_BUNDLE') {
      const failed = items.find((i) => i.status === 'failed');
      return failed
        ? { outcome: TRANSIENT.has(failed.reason_class || 'other') ? 'retry' : 'failed', reason: failed.reason_class, error: failed.message, result }
        : { outcome: 'succeeded', reason: null, error: null, result };
    }
    const notices = items.filter((i) => i.step === 'notices');
    if (notices.some((i) => i.status === 'ok' || i.status === 'held')) return { outcome: 'succeeded', reason: null, error: null, result };
    const failed = notices.find((i) => i.status === 'failed');
    if (failed) {
      const reason = failed.reason_class || 'other';
      return { outcome: TRANSIENT.has(reason) || reason === 'session_mismatch' ? 'retry' : 'failed', reason, error: failed.message, result };
    }
    return { outcome: 'retry', reason: 'agent_error', error: 'The sync ended without reading the notices.', result };
  }

  async function takeResult(jobId) {
    const r = await read(RESULT_KEY);
    if (!r) return null;
    await local.remove(RESULT_KEY);
    if (r.jobId !== jobId) return null;
    return { outcome: r.outcome === 'failed' ? 'failed' : 'retry', reason: r.reason || 'other', error: r.error || null,
             result: { runner: 'chrome', ended_by: 'page' } };
  }

  const clearSlotIfOurs = (jobId) => jobSlot(async () => {
    const aj = await read(JOB_KEY);
    if (aj && aj.runner && aj.runner.jobId === jobId) await local.remove(JOB_KEY);
  });

  // The runner ends the client itself (a deadline, a cancel, a closed window).
  async function endJob(c, st, result) {
    await clearSlotIfOurs(st.job.id);
    return finish(c, st, result);
  }

  // Records the end on the queue (portal_job_finish; retries back off 5, 10, 20 …
  // minutes up to max_attempts), logs the portal out, closes the window.
  async function finish(c, st, result) {
    const rj = st.job;
    rj.phase = 'finishing';
    rj.result = result;
    await save(st);
    await clearSlotIfOurs(rj.id);
    let status = null;
    if (result.outcome !== 'none') {
      try {
        const r = await rpc('portal_job_finish', {
          p_job_id: rj.id, p_agent: agentOf(c), p_outcome: result.outcome, p_reason_class: result.reason || null,
          p_error: result.error || null, p_result: result.result || null,
        });
        status = (r && r.status) || null;
      } catch (e) {
        st.error = 'Could not record the result in GST Keeper (' + errText(e) + '); trying again at the next check.';
        await save(st);
        return;
      }
      await event(rj.id, result.outcome === 'succeeded' ? 'info' : 'warn', 'finish',
        (status || result.outcome) + (result.reason ? ' · ' + result.reason : '') + (result.error ? ' · ' + String(result.error).slice(0, 300) : ''));
    }
    await closeTab(rj);
    st.last = { at: new Date().toISOString(), job_id: rj.id, client_name: rj.client_name, outcome: result.outcome, status,
                reason: result.reason || null, error: result.error || null };
    st.job = null;
    st.status = 'idle';
    st.error = null;
    await save(st);
  }

  // Back to the queue untouched (no try counted): a person came first, the
  // switch went off, or the runner could not start.
  async function giveBack(c, st, why) {
    const rj = st.job;
    rj.phase = 'giving_back';
    rj.why = why;
    await save(st);
    await clearSlotIfOurs(rj.id);
    const closing = closeTab(rj); // logs the portal out at once
    try { await rpc('portal_jobs_release', { p_agent: agentOf(c) }); } catch (e) { /* claimNext releases leftovers */ }
    await event(rj.id, 'info', 'release', why);
    await closing;
    st.last = { at: new Date().toISOString(), job_id: rj.id, client_name: rj.client_name, outcome: 'released', status: 'queued', reason: null, error: why };
    st.job = null;
    st.status = 'idle';
    await save(st);
  }

  // ── Tabs and the person at the PC ──────────────────────────────────────────
  async function closeTab(rj) {
    const id = rj.tab_id;
    if (id == null || !(await tabAlive(id))) return;
    try {
      const loaded = tabLoaded(id, 15000);
      await chrome.tabs.update(id, { url: LOGOUT_URL }); // the person's way out; the cookies go with it
      await loaded;
    } catch (e) { /* closing the tab still ends the visit */ }
    try {
      for (const t of await chrome.tabs.query({})) if (t.openerTabId === id && t.id !== id) await chrome.tabs.remove(t.id).catch(() => {});
    } catch (e) { /* none */ }
    try { await chrome.tabs.remove(id); } catch (e) { /* already closed */ }
  }

  function tabLoaded(id, ms) {
    return new Promise((resolve) => {
      let loading = false;
      let done = false;
      const end = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdate);
        chrome.tabs.onRemoved.removeListener(onRemove);
        resolve();
      };
      const onUpdate = (tabId, info) => {
        if (tabId !== id) return;
        if (info.status === 'loading') loading = true;
        else if (info.status === 'complete' && loading) end();
      };
      const onRemove = (tabId) => { if (tabId === id) end(); };
      const timer = setTimeout(end, ms);
      chrome.tabs.onUpdated.addListener(onUpdate);
      chrome.tabs.onRemoved.addListener(onRemove);
    });
  }

  const tabAlive = (id) => chrome.tabs.get(id).then(() => true, () => false);
  async function portalTabs() {
    try { return await chrome.tabs.query({ url: PORTAL_TABS }); } catch (e) { return []; }
  }
  // GST portal tabs that are not the runner's: not its tab, its window, or a tab its page opened.
  async function foreignPortalTabs(rj) {
    const tabs = await portalTabs();
    if (!rj) return tabs;
    const known = new Set(rj.known_tabs || []);
    return tabs.filter((t) => t.id !== rj.tab_id && t.windowId !== rj.window_id && t.openerTabId !== rj.tab_id && !known.has(t.id));
  }
  // 'active' when someone used this PC in the last 5 minutes ('idle', 'locked' otherwise).
  async function personState() {
    try { return await chrome.idle.queryState(PERSON_IDLE_SECS); } catch (e) { return 'active'; }
  }

  async function event(jobId, level, step, message) {
    try { await post('portal_job_events', [{ job_id: jobId, level, step, message: String(message).slice(0, 1000) }]); }
    catch (e) { /* diagnostic only */ }
  }

  async function armAlarm() {
    try { if (!(await chrome.alarms.get(ALARM))) await chrome.alarms.create(ALARM, { delayInMinutes: 1, periodInMinutes: 1 }); }
    catch (e) { /* alarms unavailable */ }
  }

  // ── What the popup and content.js call (background.js routes messages to API) ─
  API.runnerGet = async () => ({ config: await config(), state: await state(), job: (await read(JOB_KEY)) || null, version: EXT_VERSION });
  API.runnerSet = async (patch) => {
    const c = await config();
    const next = { ...c };
    if (patch && typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
    if (patch && typeof patch.label === 'string') next.label = patch.label.replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!next.id) next.id = crypto.randomUUID();
    await local.set({ [CONFIG_KEY]: next });
    tick('settings');
    return { config: next };
  };
  API.runnerNow = async () => { await tick('asked'); return true; };
  // From content.js: the client ended on the page (CAPTCHA not filled in time, no login page).
  API.runnerEndJob = async (info) => {
    if (!info || !info.jobId) return false;
    await local.set({ [RESULT_KEY]: {
      jobId: info.jobId, outcome: info.outcome === 'failed' ? 'failed' : 'retry', reason: String(info.reason || 'other'),
      error: info.error ? String(info.error).slice(0, 500) : null, at: Date.now(),
    } });
    await clearSlotIfOurs(info.jobId);
    return true;
  };

  // ── Wake-ups ────────────────────────────────────────────────────────────────
  if (chrome.alarms && chrome.alarms.onAlarm) chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARM) tick('alarm'); });
  if (chrome.runtime.onStartup) chrome.runtime.onStartup.addListener(() => { tick('startup'); });
  if (chrome.runtime.onInstalled) chrome.runtime.onInstalled.addListener(() => { tick('installed'); });
  // The slot changed: a scheduled client ended or a person took over, or a person's sync ended.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[JOB_KEY]) return;
    const was = changes[JOB_KEY].oldValue || null;
    const now = changes[JOB_KEY].newValue || null;
    const runnerJob = (j) => (j && j.runner ? j.runner.jobId : null);
    if ((runnerJob(was) && runnerJob(was) !== runnerJob(now)) || (was && !now)) tick('slot');
  });
  // Someone opened the GST portal while a scheduled client runs: the runner steps aside.
  if (chrome.tabs && chrome.tabs.onUpdated) {
    const onPortal = (tabId) => { state().then((st) => { if (st.job && st.job.tab_id !== tabId) tick('portal_tab'); }).catch(() => {}); };
    try { chrome.tabs.onUpdated.addListener(onPortal, { urls: [PORTAL_TABS], properties: ['url'] }); }
    catch (e) { chrome.tabs.onUpdated.addListener((tabId, info) => { if (info.url && /^https:\/\/[^/]*\.gst\.gov\.in\//.test(info.url)) onPortal(tabId); }); }
  }
  config().then((c) => { if (c.enabled && c.id) armAlarm(); }).catch(() => {});

  // Tests (agent/test/chrome-runner.e2e.test.ts) and the popup's "Check now".
  globalThis.GSTK_RUNNER = { tick, state, config };
})();
