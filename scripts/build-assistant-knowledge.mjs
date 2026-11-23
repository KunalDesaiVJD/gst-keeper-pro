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

  // A JSX opening tag whose attributes may hold {…} groups (arrow functions included).
  const OPEN = (tag) => new RegExp(`<${tag}\\b(?:[^>{]|\\{(?:[^{}]|\\{(?:[^{}]|\\{[^{}]*\\})*\\})*\\})*>([\\s\\S]*?)<\\/${tag}>`, 'g');
  const SHARED = new Set(['Clear', 'Save reason']);
  const label = (t) => !SHARED.has(t) && /[A-Za-z]{2}/.test(t) && t.length > 1 && t.length < 45 && !/[(){}=<>;]/.test(t);
  // The app's own components a file imports (not the ui kit or the shell).
  const localImports = (s, from) => {
    const out = new Map();
    for (const m of s.matchAll(/import\s+(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s+['"]((?:\.{1,2}|@)\/[^'"]+)['"]/g)) {
      const spec = m[3];
      if (/\/ui\/|\/layout\/|\/integrations\/|\/contexts\/|\/hooks\/|\/lib\/|\/utils\//.test(spec)) continue;
      const base = spec.startsWith('@/') ? path.join('src', spec.slice(2)) : path.join(path.dirname(from), spec);
      const file = [`${base}.tsx`, `${base}/index.tsx`, `${base}.ts`].find(exists);
      if (!file) continue;
      const names = [m[1], ...(m[2] ? m[2].split(',').map((x) => x.trim().split(/\s+as\s+/).pop()) : [])].filter((n) => n && /^[A-Z]/.test(n));
      for (const n of names) out.set(n, file);
    }
    return out;
  };
  const ownFacts = (file) => {
    const s = read(file);
    const title = s.match(/<(?:PageHeader|NoticesShell|BuilderSectionHeader)[\s\S]{0,400}?title=["']([^"']+)["']/)?.[1]
      ?? s.match(/<h1[^>]*>([^<{]+)<\/h1>/)?.[1]?.trim() ?? null;
    const subtitle = s.match(/<(?:PageHeader|BuilderSectionHeader)[\s\S]{0,600}?(?:subtitle|description)=["']([^"']+)["']/)?.[1] ?? null;
    const trig = [...s.matchAll(OPEN('TabsTrigger'))].map((m) => clean(m[1]));
    // Tabs drawn from a list ({ id, label }) and rendered with role="tab".
    const listed = /role="tab"|TabsTrigger/.test(s) ? [...s.matchAll(/\{\s*(?:id|value|key):\s*'([^']+)',\s*label:\s*'([^']+)'/g)].map((m) => m[2]) : [];
    const tabs = uniq([...trig, ...listed].filter(label));
    const buttons = uniq([...s.matchAll(OPEN('Button'))].map((m) => clean(m[1])).filter(label)).slice(0, 40);
    // Which component each tab shows: value / id → label, then → <Component.
    const keyLabel = new Map();
    for (const m of s.matchAll(/<TabsTrigger\b[^>]*?value=["']([^"']+)["'][^>]*>([\s\S]*?)<\/TabsTrigger>/g)) keyLabel.set(m[1], clean(m[2]));
    for (const m of s.matchAll(/\{\s*(?:id|value|key):\s*'([^']+)',\s*label:\s*'([^']+)'/g)) if (!keyLabel.has(m[1])) keyLabel.set(m[1], m[2]);
    const tabComp = new Map();
    for (const m of s.matchAll(/<TabsContent\b[^>]*?value=["']([^"']+)["'][^>]*>\s*(?:\{[^}]*\}\s*)?<([A-Z]\w+)/g)) tabComp.set(m[1], m[2]);
    for (const m of s.matchAll(/===\s*'([^']+)'\s*&&\s*(?:\(\s*)?<([A-Z]\w+)/g)) if (!tabComp.has(m[1])) tabComp.set(m[1], m[2]);
    return { s, title, subtitle, tabs, buttons, keyLabel, tabComp };
  };
  const pageFacts = (file) => {
    if (!file || !exists(file)) return { title: null, subtitle: null, tabs: [], buttons: [], sections: [] };
    const own = ownFacts(file);
    const imports = localImports(own.s, file);
    const sections = [];
    const seen = new Set([file]);
    const sectionOf = (tab, comp, depth) => {
      const f = imports.get(comp);
      if (!f || seen.has(f)) return null;
      seen.add(f);
      const c = ownFacts(f);
      // One level further: a tab's own tabs and the buttons of what it shows.
      const more = depth > 0 ? [...localImports(c.s, f).values()].filter((x) => !seen.has(x)).slice(0, 12).flatMap((x) => { seen.add(x); return ownFacts(x).buttons; }) : [];
      return { tab, component: comp, title: c.title, tabs: c.tabs, buttons: uniq([...c.buttons, ...more]).slice(0, 30) };
    };
    for (const [key, comp] of own.tabComp) {
      // Only a tab the screen names; a mode or status value is no tab.
      const tab = own.keyLabel.get(key);
      if (!tab || !label(tab)) continue;
      const sec = sectionOf(tab, comp, 1);
      if (sec) sections.push(sec);
    }
    // Parts shown without a tab (a page built from panels): their buttons count as the page's.
    const extra = [...imports.entries()].filter(([, f]) => !seen.has(f)).slice(0, 15).flatMap(([, f]) => { seen.add(f); return ownFacts(f).buttons; });
    return { title: own.title, subtitle: own.subtitle, tabs: own.tabs, buttons: uniq([...own.buttons, ...extra]).slice(0, 40), sections };
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
export interface AssistantScreen { route: string; menu: string | null; component: string | null; staffOnly: boolean; redirectsTo: string | null; title: string | null; subtitle: string | null; tabs: string[]; buttons: string[]; sections: AssistantSection[] }
export interface AssistantSection { tab: string; component: string; title: string | null; tabs: string[]; buttons: string[] }
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
