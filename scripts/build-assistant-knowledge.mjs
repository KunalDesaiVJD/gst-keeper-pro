#!/usr/bin/env node
// The GST Assistant's knowledge of the app (23 Nov 2026), rebuilt from the code.
//
//   node scripts/build-assistant-knowledge.mjs
//     writes src/lib/assistant/screens.generated.ts: every route of App.tsx with
//     its menu label, page title, tabs and buttons, and the permission keys.
//     `npm run build` and `npm run typecheck` run it first, so every deploy
//     carries the screens as they are in that deploy. It holds only what the
//     app's own bundle already shows (labels on screens), nothing private.
//
//   node scripts/build-assistant-knowledge.mjs --sql <file>
//     writes one SQL statement that replaces the private knowledge rows
//     (assistant_knowledge: the firm's docs split by heading, and the GST tables
//     with their columns). Run by .github/workflows/assistant-knowledge.yml on
//     every push to main, so the assistant reads the docs as they are on main.
//     These rows are never published with the app: RLS on, no policies, read
//     only by the Edge Function gst-assistant with the service role.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const SCREENS_OUT = 'src/lib/assistant/screens.generated.ts';

const clean = (s) => s
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')
  .replace(/<[^>]*>/g, ' ')
  .replace(/\{[^}]*\}/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();
const uniq = (xs) => [...new Set(xs.filter(Boolean))];

let commit = null;
try { commit = execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* no git */ }
commit = commit || process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || null;

function buildScreens() {
  const app = read('src/App.tsx');
  const importOf = new Map();
  for (const m of app.matchAll(/(?:import\s+(\w+)\s+from\s+['"](?:\.|@)\/pages\/([\w/]+)['"])|(?:const\s+(\w+)\s*=\s*lazy\w*\(\s*\(\)\s*=>\s*import\(\s*['"](?:\.|@)\/pages\/([\w/]+)['"]\s*\)\s*\))/g)) {
    importOf.set(m[1] || m[3], `src/pages/${m[2] || m[4]}.tsx`);
  }
  const sidebar = exists('src/components/layout/Sidebar.tsx') ? read('src/components/layout/Sidebar.tsx') : '';
  const navLabel = new Map();
  for (const m of sidebar.matchAll(/label:\s*'([^']+)',\s*\n?\s*path:\s*'([^']+)'/g)) if (!navLabel.has(m[2])) navLabel.set(m[2], m[1]);

  const pageFacts = (file) => {
    if (!file || !exists(file)) return { title: null, subtitle: null, tabs: [], buttons: [] };
    const s = read(file);
    const title = s.match(/<PageHeader[\s\S]{0,400}?title=["']([^"']+)["']/)?.[1]
      ?? s.match(/<NoticesShell[\s\S]{0,400}?title=["']([^"']+)["']/)?.[1] ?? null;
    const subtitle = s.match(/<PageHeader[\s\S]{0,600}?subtitle=["']([^"']+)["']/)?.[1] ?? null;
    const tabs = uniq([...s.matchAll(/<TabsTrigger[^>]*>([\s\S]*?)<\/TabsTrigger>/g)].map((m) => clean(m[1])).filter((t) => t.length > 1 && t.length < 50));
    const buttons = uniq([...s.matchAll(/<Button\b[^>]*>([\s\S]*?)<\/Button>/g)].map((m) => clean(m[1])).filter((t) => /[A-Za-z]{2}/.test(t) && t.length < 45 && !/[(){}=<>]/.test(t))).slice(0, 40);
    return { title, subtitle, tabs, buttons };
  };

  const screens = [];
  for (const m of app.matchAll(/<Route\s+path="([^"]+)"\s+element=\{([\s\S]*?)\}\s*\/>/g)) {
    const route = m[1];
    if (route === '*' || route === '/' || route === '/login') continue;
    const comps = [...m[2].matchAll(/<(\w+)/g)].map((x) => x[1]).filter((c) => !['StaffGuard', 'Navigate'].includes(c));
    const redirectsTo = /<Navigate\s+to="([^"]+)"/.exec(m[2])?.[1] ?? null;
    const component = comps[0] ?? null;
    screens.push({ route, menu: navLabel.get(route) ?? null, component, staffOnly: /StaffGuard/.test(m[2]), redirectsTo, ...pageFacts(component ? importOf.get(component) : null) });
  }

  const permissions = [];
  if (exists('src/lib/permissionCatalog.ts')) {
    for (const m of read('src/lib/permissionCatalog.ts').matchAll(/\{\s*key:\s*'([^']+)',\s*group:\s*'([^']+)',\s*label:\s*(['"])(.*?)\3,\s*description:\s*(['"])(.*?)\5/g)) {
      permissions.push({ key: m[1], group: m[2], label: m[4], description: m[6] });
    }
  }
  if (screens.length < 20) throw new Error(`only ${screens.length} screens found in src/App.tsx`);
  return { screens, permissions };
}

function buildPrivate() {
  // Docs: CLAUDE.md and docs/*.md, split at ## and ### headings, long sections in parts.
  const MAX_PART = 3500;
  const docs = [];
  const files = ['CLAUDE.md', ...(exists('docs') ? fs.readdirSync(path.join(ROOT, 'docs')).filter((f) => f.endsWith('.md') && !/^archive_/.test(f)).sort().map((f) => `docs/${f}`) : [])];
  for (const file of files.filter(exists)) {
    const text = read(file);
    const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? file;
    let heading = title;
    let buf = [];
    const flush = () => {
      const body = buf.join('\n').replace(/\n{3,}/g, '\n\n').trim();
      buf = [];
      if (body.length < 40) return;
      for (let i = 0, part = 1; i < body.length; i += MAX_PART, part += 1) {
        docs.push({ doc: file, title, heading: body.length > MAX_PART ? `${heading} (part ${part})` : heading, text: body.slice(i, i + MAX_PART) });
      }
    };
    for (const line of text.split('\n')) {
      const h = line.match(/^(#{2,3})\s+(.+)$/);
      if (h) { flush(); heading = h[2].trim(); continue; }
      buf.push(line);
    }
    flush();
  }
  // Tables and views with their columns, from the generated DB types. The
  // Edge Function applies its own allow list (gst-assistant/readRules.ts).
  const tables = [];
  const t = read('src/integrations/supabase/types.ts');
  const pub = t.slice(t.indexOf('  public: {'));
  for (const kind of ['Tables', 'Views']) {
    const start = pub.indexOf(`    ${kind}: {`);
    if (start < 0) continue;
    const block = pub.slice(start, pub.indexOf('\n    }', start));
    for (const m of block.matchAll(/\n {6}(\w+): \{\n {8}Row: \{([\s\S]*?)\n {8}\}/g)) {
      const cols = [...m[2].matchAll(/\n {10}(\w+)\??: ([^\n]+)/g)].map((c) => `${c[1]}:${c[2].replace(/\s*\|\s*null/, '?').replace(/Database\["public"\]\["Enums"\]\["(\w+)"\]/, 'enum $1').trim()}`);
      tables.push({ name: m[1], kind: kind === 'Views' ? 'view' : 'table', columns: cols });
    }
  }
  if (docs.length < 20) throw new Error(`only ${docs.length} doc sections found`);
  return { docs, tables };
}

const sqlIdx = process.argv.indexOf('--sql');
try {
  if (sqlIdx > 0) {
    const out = process.argv[sqlIdx + 1];
    if (!out) throw new Error('--sql needs a file');
    const { docs, tables } = buildPrivate();
    const payload = JSON.stringify({ commit, builtAt: new Date().toISOString(), docs, tables });
    let tag = 'gstk';
    while (payload.includes(`$${tag}$`)) tag += 'x';
    const sql = `SELECT public.assistant_knowledge_replace($${tag}$${payload}$${tag}$::jsonb);\n`;
    fs.writeFileSync(out, sql);
    console.log(`assistant knowledge (private): ${docs.length} doc sections, ${tables.length} tables, ${Math.round(sql.length / 1024)} KB → ${out}`);
  } else {
    const { screens, permissions } = buildScreens();
    const body = `// Generated by scripts/build-assistant-knowledge.mjs from src/App.tsx, the
// pages and src/lib/permissionCatalog.ts. Do not edit: \`npm run build\` and
// \`npm run typecheck\` write it again, so the GST Assistant knows every screen
// as it is in the deploy.
export interface AssistantScreen { route: string; menu: string | null; component: string | null; staffOnly: boolean; redirectsTo: string | null; title: string | null; subtitle: string | null; tabs: string[]; buttons: string[] }
export interface AssistantPermission { key: string; group: string; label: string; description: string }
export const ASSISTANT_SCREENS: AssistantScreen[] = ${JSON.stringify(screens, null, 1)};
export const ASSISTANT_PERMISSIONS: AssistantPermission[] = ${JSON.stringify(permissions, null, 1)};
`;
    fs.mkdirSync(path.dirname(path.join(ROOT, SCREENS_OUT)), { recursive: true });
    const prev = exists(SCREENS_OUT) ? read(SCREENS_OUT) : '';
    if (prev !== body) fs.writeFileSync(path.join(ROOT, SCREENS_OUT), body);
    console.log(`assistant knowledge: ${screens.length} screens, ${permissions.length} keys${prev === body ? ' (unchanged)' : ` → ${SCREENS_OUT}`}`);
  }
} catch (e) {
  console.error(`build-assistant-knowledge: ${e.message}`);
  process.exit(1);
}
