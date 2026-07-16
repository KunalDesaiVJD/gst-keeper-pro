(async () => {
  const clientSel = document.getElementById('client');
  const periodEl = document.getElementById('period');
  const goBtn = document.getElementById('go');

  // Default to the previous month (the return period), like the app.
  const now = new Date();
  const pm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  periodEl.value = String(pm.getMonth() + 1).padStart(2, '0') + '/' + pm.getFullYear();

  let clients = [];
  let err = null;
  try { clients = await GSTKdb.getClients(); } catch (e) { err = (e && e.message) || String(e); }
  const withCreds = clients.filter((c) => c.gst_user_id);

  clientSel.innerHTML = '';
  if (err) {
    clientSel.innerHTML = '<option>Error: ' + err.slice(0, 60) + '</option>';
    goBtn.disabled = true;
  } else if (!clients.length) {
    clientSel.innerHTML = '<option>(no clients found)</option>';
    goBtn.disabled = true;
  } else {
    const all = document.createElement('option');
    all.value = '__ALL__';
    all.textContent = 'All clients with credentials (' + withCreds.length + ')';
    clientSel.appendChild(all);
    for (const c of clients) {
      const o = document.createElement('option');
      o.value = c.id;
      o.textContent = c.name + (c.gst_user_id ? '' : ' — no credentials');
      o.disabled = !c.gst_user_id;
      clientSel.appendChild(o);
    }
  }

  const toCred = (c) => ({
    user: c.gst_user_id, pass: c.gst_password, name: c.name, gstin: c.gstin,
    selectedReturns: c.selected_returns || [],
  });

  goBtn.onclick = async () => {
    const period = periodEl.value.trim();
    if (!/^\d{2}\/\d{4}$/.test(period)) { alert('Period must be MM/YYYY, e.g. 06/2026'); return; }

    let list;
    if (clientSel.value === '__ALL__') {
      list = withCreds;
    } else {
      const c = clients.find((x) => x.id === clientSel.value);
      if (!c || !c.gst_user_id) { alert('This client has no saved GST username/password.'); return; }
      list = [c];
    }
    if (!list.length) { alert('No clients with saved credentials.'); return; }
    if (list.length > 1 &&
        !confirm('Sync ' + list.length + ' clients one after another? You type a CAPTCHA for each; keep the tab open until it says all done.')) {
      return;
    }

    const [mm, yyyy] = period.split('/').map((n) => parseInt(n, 10));
    const fyStart = mm >= 4 ? yyyy : yyyy - 1;
    const job = {
      period, fyStart, idx: 0, step: 'login',
      clients: list.map((c) => ({ clientId: c.id, creds: toCred(c) })),
      startedAt: Date.now(),
    };
    await chrome.storage.local.set({ gstk_active_job: job });
    await chrome.tabs.create({ url: 'https://services.gst.gov.in/services/login' });
    window.close();
  };
})();
