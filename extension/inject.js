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
