// Portal sessions kept between jobs, only when the Autopilot setting "Keep
// portal sessions" is on. Each client's portal cookies are saved encrypted
// (AES-256-GCM, key AGENT_SESSION_KEY from agent/.env) on the office PC only
// — never in the database — and used again while younger than
// SESSION_MAX_AGE_MIN. Without a key nothing is kept.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Cookie } from 'playwright';

export class SessionStore {
  private key: Buffer | null;
  constructor(private dir: string, secret: string | null, private maxAgeMin: number) {
    this.key = secret ? crypto.createHash('sha256').update(secret).digest() : null;
    if (this.key) fs.mkdirSync(dir, { recursive: true });
  }

  get enabled() { return this.key !== null; }

  private file(clientId: string) { return path.join(this.dir, clientId.replace(/[^0-9a-f-]/gi, '') + '.json'); }

  save(clientId: string, cookies: Cookie[]) {
    if (!this.key) return;
    const portal = cookies.filter((c) => /gst\.gov\.in$/i.test(c.domain.replace(/^\./, '')));
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([c.update(JSON.stringify(portal), 'utf8'), c.final()]);
    const out = { v: 1, savedAt: Date.now(), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
    const f = this.file(clientId);
    fs.writeFileSync(f + '.tmp', JSON.stringify(out), { mode: 0o600 });
    fs.renameSync(f + '.tmp', f);
  }

  load(clientId: string): Cookie[] | null {
    if (!this.key) return null;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file(clientId), 'utf8'));
      if (Date.now() - raw.savedAt > this.maxAgeMin * 60_000) { this.drop(clientId); return null; }
      const d = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(raw.iv, 'base64'));
      d.setAuthTag(Buffer.from(raw.tag, 'base64'));
      const json = Buffer.concat([d.update(Buffer.from(raw.data, 'base64')), d.final()]).toString('utf8');
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  drop(clientId: string) {
    try { fs.unlinkSync(this.file(clientId)); } catch { /* none */ }
  }
}
