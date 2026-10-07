// A stand-in for the GST portal, served to the agent's browser through
// Playwright routing (no network): the login page with its CAPTCHA, the pages
// the extension visits and the JSON calls it makes, for a few made-up
// taxpayers. Never used outside tests.
import zlib from 'node:zlib';
import type { BrowserContext, Route } from 'playwright';

export interface FakeAccount {
  password: string;
  gstin: string;
  notices: Record<string, unknown>[];
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
// A plain 120×40 grey PNG: what matters to the agent is that it is an image.
function captchaPng(shade: number): Buffer {
  const w = 120, h = 40;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) raw.fill(((x + y) % 7 === 0 ? 60 : shade), y * (w * 3 + 1) + 1 + x * 3, y * (w * 3 + 1) + 4 + x * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const LOGIN_HTML = `<!doctype html><html><head><title>GST Portal (test)</title></head><body>
<h1>Login</h1>
<div class="alert-danger" id="err"></div>
<input id="username" name="user_name"><input id="user_pass" type="password">
<img id="imgCaptcha" class="captcha" width="120" height="40" src="/services/captcha?t=${'${T}'}">
<input id="captcha" placeholder="Enter Characters shown below">
<button type="button" class="btn btn-primary" id="login">Login</button>
<script>
const shownErr = new URLSearchParams(location.search).get('e');
if (shownErr) document.getElementById('err').textContent = shownErr;
document.getElementById('login').addEventListener('click', async () => {
  const r = await fetch('/services/api/authenticate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: document.getElementById('username').value, pass: document.getElementById('user_pass').value,
                           captcha: document.getElementById('captcha').value }) });
  const j = await r.json();
  if (j.ok) { document.cookie = 'fsess=' + j.session + '; path=/; domain=.gst.gov.in'; location.href = '/services/auth/dashboard'; return; }
  // Some portals answer with a fresh login page carrying the message (RunnerPortal.freshPage).
  if (j.reload) { location.href = '/services/login?e=' + encodeURIComponent(j.error); return; }
  document.getElementById('err').textContent = j.error;
  document.getElementById('captcha').value = '';
  document.getElementById('imgCaptcha').src = '/services/captcha?t=' + Date.now();
});
</script></body></html>`;

const shell = (title: string) => `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1><a href="/services/logout">Logout</a></body></html>`;

export class FakePortal {
  accounts: Record<string, FakeAccount> = {};
  expected = '';                // the answer to the CAPTCHA shown last
  captchasServed = 0;
  requests = 0;                 // every portal request the browser made
  log: string[] = [];

  async route(context: BrowserContext) {
    await context.route(/^https:\/\/[a-z]+\.gst\.gov\.in\//, (route) => this.handle(route));
  }

  private session(route: Route): string | null {
    const cookie = route.request().headers()['cookie'] || '';
    const m = /(?:^|;\s*)fsess=([^;]+)/.exec(cookie);
    return m && this.accounts[m[1]] ? m[1] : null;
  }

  private async handle(route: Route) {
    this.requests++;
    const req = route.request();
    const u = new URL(req.url());
    const p = u.pathname;
    const html = (body: string) => route.fulfill({ status: 200, contentType: 'text/html', body });
    const json = (o: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
    this.log.push(`${req.method()} ${p}`);

    if (p === '/services/login') return html(LOGIN_HTML.replace('${T}', String(Date.now())));
    if (p === '/services/captcha') {
      this.expected = String(100000 + Math.floor(Math.random() * 900000));
      this.captchasServed++;
      return route.fulfill({ status: 200, contentType: 'image/png', body: captchaPng(150 + (this.captchasServed % 80)) });
    }
    if (p === '/services/api/authenticate') {
      const b = JSON.parse(req.postData() || '{}');
      if (String(b.captcha) !== this.expected) return json({ ok: false, error: 'Enter valid Letters shown.' });
      const acc = this.accounts[b.user];
      if (!acc || acc.password !== b.pass) return json({ ok: false, error: 'Invalid Username or Password. Please try again.' });
      return json({ ok: true, session: b.user });
    }
    if (p === '/services/logout') {
      return html('<!doctype html><html><body>Logged out<script>document.cookie = "fsess=; path=/; domain=.gst.gov.in; expires=Thu, 01 Jan 1970 00:00:00 GMT";</script></body></html>');
    }

    const user = this.session(route);
    const isPage = req.resourceType() === 'document';
    if (!user) {
      if (isPage) return route.fulfill({ status: 302, headers: { location: 'https://services.gst.gov.in/services/login' } });
      return json({ status: 0, error: 'session expired' }, 401);
    }
    const acc = this.accounts[user];

    if (isPage) return html(shell(p));
    const body = req.postData() ? JSON.parse(req.postData() || '{}') : {};
    if (p === '/services/auth/profile/detail') return json({ gstin: acc.gstin, lgnm: user.toUpperCase() + ' TRADERS', sts: 'Active', rgdt: '01/07/2017' });
    if (p === '/services/auth/api/get/notices') return json(acc.notices);
    if (p === '/litserv/auth/api/case/task/get') return json([]);
    if (p === '/litserv/auth/api/case/search') return json(body.caseTypeCd === 'APPEL' ? [{ arn: 'AD' + acc.gstin.slice(0, 2) + 'APL' + user, caseId: 'C' + user, caseName: 'Appeal to Appellate Authority', statusDesc: 'Submitted', caseCreationDate: '02/05/2026', caseJson: null }] : []);
    if (p.startsWith('/document/')) return route.fulfill({ status: 200, contentType: 'application/pdf', body: Buffer.from('%PDF-1.4 test') });
    return json({ status: 0, error: 'not simulated: ' + p }, 404);
  }
}
