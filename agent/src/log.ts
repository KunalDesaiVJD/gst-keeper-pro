// One line per event to the console and to a daily file under the data folder
// (kept 14 days). Never logs a password, a CAPTCHA image or a cookie.
import fs from 'node:fs';
import path from 'node:path';

type Level = 'info' | 'warn' | 'error';
let dir: string | null = null;

export function initLog(dataDir: string) {
  dir = path.join(dataDir, 'logs');
  fs.mkdirSync(dir, { recursive: true });
  const cutoff = Date.now() - 14 * 24 * 3600_000;
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    try { if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p); } catch { /* ignore */ }
  }
}

export function log(level: Level, msg: string) {
  const now = new Date();
  const line = `${now.toISOString()} ${level.toUpperCase().padEnd(5)} ${msg}`;
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
  if (dir) {
    try { fs.appendFileSync(path.join(dir, `agent-${now.toISOString().slice(0, 10)}.log`), line + '\n'); } catch { /* disk full: console only */ }
  }
}
