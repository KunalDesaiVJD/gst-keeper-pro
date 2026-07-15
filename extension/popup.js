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
  clientSel.innerHTML = '';
  if (err) {
    clientSel.innerHTML = '<option>Error: ' + err.slice(0, 60) + '</option>';
    goBtn.disabled = true;
  } else if (!clients.length) {
    clientSel.innerHTML = '<option>(no clients found)</option>';
    goBtn.disabled = true;
  } else {
    for (const c of clients) {
      const o = document.createElement('option');
      o.value = c.id;
      o.textContent = c.name + (c.gst_user_id ? '' : ' — no credentials');
      o.disabled = !c.gst_user_id;
      clientSel.appendChild(o);
    }
  }

  goBtn.onclick = async () => {
    const clientId = clientSel.value;
    const period = periodEl.value.trim();
    if (!/^\d{2}\/\d{4}$/.test(period)) { alert('Period must be MM/YYYY, e.g. 06/2026'); return; }
    const c = await GSTKdb.getClient(clientId);
    if (!c || !c.gst_user_id) { alert('This client has no saved GST username/password.'); return; }

    const [mm, yyyy] = period.split('/').map((n) => parseInt(n, 10));
    const fyStart = mm >= 4 ? yyyy : yyyy - 1;
    const job = {
      clientId: c.id, period, fyStart, step: 'login',
      creds: { user: c.gst_user_id, pass: c.gst_password, name: c.name, gstin: c.gstin, selectedReturns: c.selected_returns || [] },
      startedAt: Date.now(),
    };
    await chrome.storage.local.set({ gstk_active_job: job });
    await chrome.tabs.create({ url: 'https://services.gst.gov.in/services/login' });
    window.close();
  };
})();
