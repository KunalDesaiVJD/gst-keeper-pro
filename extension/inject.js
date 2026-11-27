// Runs in the PAGE's own JS world (world: MAIN). The portal downloads a filed
// return by building a Blob and calling URL.createObjectURL(blob) + a hidden
// click. We hook createObjectURL to capture that Blob as a base64 data URL and
// hand it to our content script via postMessage. (Read-only capture; we still
// return the real object URL so the portal's own download proceeds normally.)
(() => {
  const orig = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function (obj) {
    try {
      if (obj instanceof Blob && obj.size > 0) {
        const fr = new FileReader();
        fr.onload = () => window.postMessage({ __gstkPdf: fr.result, size: obj.size, type: obj.type }, '*');
        fr.readAsDataURL(obj);
      }
    } catch (e) { /* ignore */ }
    return orig(obj);
  };
})();

// 0.11.0: GSTR-9 — keep a copy of the JSON the portal's own Annual Return /
// GSTR-9 pages load (the system-computed figures, the filed return with
// Table 7), so the extension reads exactly what the page shows instead of
// guessing API addresses (the filed-return address it guessed is refused).
// Read-only: the requests are the page's own; we only copy their answers.
// Kept in sessionStorage (same origin, survives the page's navigations; the
// content script reads it) under '__gstkG9', newest last, capped.
(() => {
  const KEY = '__gstkG9';
  const WANT = /gstr9|annualreturn|annual_return/i;
  const keep = (url, text) => {
    try {
      if (!WANT.test(String(url || ''))) return;
      let j = null;
      try { j = JSON.parse(text); } catch (e) { return; }
      if (!j || typeof j !== 'object') return;
      let list = [];
      try { list = JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch (e) { list = []; }
      list.push({ url: String(url), at: Date.now(), body: j });
      while (list.length > 40) list.shift();
      let s = JSON.stringify(list);
      while (s.length > 4_000_000 && list.length > 1) { list.shift(); s = JSON.stringify(list); }
      sessionStorage.setItem(KEY, s);
      window.postMessage({ __gstkG9: true, url: String(url) }, '*');
    } catch (e) { /* never disturb the page */ }
  };
  try {
    const open = XMLHttpRequest.prototype.open;
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) { this.__gstkUrl = url; return open.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function () {
      try {
        if (WANT.test(String(this.__gstkUrl || ''))) {
          this.addEventListener('load', () => {
            try {
              const t = this.responseType === '' || this.responseType === 'text' ? this.responseText
                : this.responseType === 'json' ? JSON.stringify(this.response) : null;
              if (t) keep(this.responseURL || this.__gstkUrl, t);
            } catch (e) { /* ignore */ }
          });
        }
      } catch (e) { /* ignore */ }
      return send.apply(this, arguments);
    };
  } catch (e) { /* ignore */ }
  try {
    const f = window.fetch;
    if (typeof f === 'function') {
      window.fetch = function (input) {
        const p = f.apply(this, arguments);
        try {
          const url = typeof input === 'string' ? input : (input && input.url) || '';
          if (WANT.test(url)) p.then((r) => r.clone().text().then((t) => keep(r.url || url, t))).catch(() => {});
        } catch (e) { /* ignore */ }
        return p;
      };
    }
  } catch (e) { /* ignore */ }
})();

// 0.19.2: the vendor GSTIN lookup (mode gstin_search) — keep a copy of what
// the portal's own Search Taxpayer page asks and gets back (address, method,
// request body and headers, status, the answer), so the extension reads the
// JSON the page itself loaded and fits its mapping to the request the page
// really makes, instead of guessing API addresses (the guessed ones were
// refused: "Request Rejected", HTTP 403). Read-only: the requests are the
// page's own; we only copy them. services.gst.gov.in only; kept in
// sessionStorage under '__gstkGS', newest last, capped.
(() => {
  try { if (location.hostname !== 'services.gst.gov.in') return; } catch (e) { return; }
  const KEY = '__gstkGS';
  const WANT = /search|taxpayer|returndetails|goodservice|filingstatus/i;
  const keep = (method, url, status, reqBody, reqHeaders, text) => {
    try {
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
      const isJson = !!json && typeof json === 'object';
      const entry = {
        at: Date.now(), method: String(method || 'GET').toUpperCase(), url: String(url || ''), status: status || 0,
        reqBody: typeof reqBody === 'string' ? reqBody.slice(0, 4000) : null, reqHeaders: reqHeaders || {},
        json: isJson ? json : null, text: isJson ? null : String(text == null ? '' : text).slice(0, 3000),
      };
      let list = [];
      try { list = JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch (e) { list = []; }
      if (!Array.isArray(list)) list = [];
      list.push(entry);
      while (list.length > 30) list.shift();
      let s = JSON.stringify(list);
      while (s.length > 2000000 && list.length > 1) { list.shift(); s = JSON.stringify(list); }
      sessionStorage.setItem(KEY, s);
    } catch (e) { /* never disturb the page */ }
  };
  try {
    const open = XMLHttpRequest.prototype.open;
    const send = XMLHttpRequest.prototype.send;
    const setHeader = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.open = function (method, url) {
      try { this.__gstkGs = { method, url, headers: {} }; } catch (e) { /* ignore */ }
      return open.apply(this, arguments);
    };
    XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
      try { if (this.__gstkGs) this.__gstkGs.headers[String(k)] = String(v); } catch (e) { /* ignore */ }
      return setHeader.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
      try {
        const m = this.__gstkGs;
        if (m && WANT.test(String(m.url || ''))) {
          this.addEventListener('load', () => {
            try {
              const t = this.responseType === '' || this.responseType === 'text' ? this.responseText
                : this.responseType === 'json' ? JSON.stringify(this.response) : null;
              keep(m.method, this.responseURL || m.url, this.status, typeof body === 'string' ? body : null, m.headers, t);
            } catch (e) { /* ignore */ }
          });
        }
      } catch (e) { /* ignore */ }
      return send.apply(this, arguments);
    };
  } catch (e) { /* ignore */ }
  try {
    const f = window.fetch;
    if (typeof f === 'function') {
      window.fetch = function (input, init) {
        const p = f.apply(this, arguments);
        try {
          const url = typeof input === 'string' ? input : (input && input.url) || '';
          if (WANT.test(url)) {
            const method = (init && init.method) || (input && typeof input === 'object' && input.method) || 'GET';
            const headers = {};
            try {
              const h = init && init.headers;
              if (h && typeof h.forEach === 'function') h.forEach((v, k) => { headers[k] = v; });
              else if (h && typeof h === 'object') for (const k of Object.keys(h)) headers[k] = String(h[k]);
            } catch (e) { /* ignore */ }
            const body = init && typeof init.body === 'string' ? init.body : null;
            p.then((r) => r.clone().text().then((t) => keep(method, r.url || url, r.status, body, headers, t))).catch(() => {});
          }
        } catch (e) { /* ignore */ }
        return p;
      };
    }
  } catch (e) { /* ignore */ }
})();
