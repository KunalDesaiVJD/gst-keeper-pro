// The agent runs the same GST Keeper extension the staff use, copied fresh
// from the repo's extension folder at every start (so a `git pull` updates
// both), with config.js written from the agent's database settings.
import fs from 'node:fs';
import path from 'node:path';
import type { AgentConfig } from './config.js';

export const MIN_EXTENSION = '0.6.0';

export function versionAtLeast(v: string, min: string): boolean {
  const a = v.split('.').map(Number);
  const b = min.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return true;
}

export function stageExtension(cfg: AgentConfig): { dir: string; version: string } {
  const src = cfg.extensionDir;
  const manifestPath = path.join(src, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`No extension at ${src} (EXTENSION_DIR).`);
  const dest = path.join(cfg.dataDir, 'extension');
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true, filter: (p) => !/[\\/](test|node_modules)([\\/]|$)/.test(p.slice(src.length)) });

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!versionAtLeast(manifest.version, MIN_EXTENSION)) {
    throw new Error(`The extension in ${src} is ${manifest.version}; the agent needs ${MIN_EXTENSION} or later. Update the repo (git pull).`);
  }
  // The database the agent was pointed at must be reachable from the
  // extension's background worker too.
  const origin = new URL(cfg.supabaseUrl).origin + '/*';
  if (!manifest.host_permissions.includes(origin)) manifest.host_permissions.push(origin);
  fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(dest, 'config.js'),
    '// Written by the office agent from agent/.env (see agent/src/extension.ts).\n' +
    `globalThis.GSTK_CONFIG = ${JSON.stringify({ SUPABASE_URL: cfg.supabaseUrl, SUPABASE_ANON_KEY: cfg.anonKey })};\n`);
  return { dir: dest, version: manifest.version };
}
