// Builds schema.json from the repo's declared schema (read-only):
//   1. src/integrations/supabase/types.ts  (public Tables + Views: Row columns,
//      Insert-required columns, Relationships)
//   2. supabase/migrations/*.sql           (CREATE TABLE / ADD COLUMN / DROP COLUMN /
//      REFERENCES) — unioned in, so a column a migration adds but types.ts lacks
//      still "exists", and FKs that hand-written types omit are still embeddable.
// The mock PostgREST uses this to answer exactly like production would when a
// page selects / filters / writes a column the database does not have.
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), 'schema.json');

// ---------- types.ts ----------
const typesSrc = fs.readFileSync(path.join(REPO, 'src/integrations/supabase/types.ts'), 'utf8').split('\n');
const tables = {};
let inPublic = false, section = null, cur = null, block = null, relBuf = null;
for (let i = 0; i < typesSrc.length; i++) {
  const line = typesSrc[i];
  if (/^  public: \{$/.test(line)) { inPublic = true; continue; }
  if (/^  graphql_public: \{$/.test(line)) { inPublic = false; continue; }
  if (!inPublic) continue;
  const sec = line.match(/^    (Tables|Views|Functions|Enums|CompositeTypes): \{$/);
  if (sec) { section = sec[1]; continue; }
  if (section !== 'Tables' && section !== 'Views') continue;
  const t = line.match(/^      (\w+): \{$/);
  if (t) { cur = { name: t[1], kind: section === 'Tables' ? 'table' : 'view', columns: [], required: [], fks: [] }; tables[t[1]] = cur; block = null; continue; }
  if (!cur) continue;
  const b = line.match(/^        (Row|Insert|Update): \{$/);
  if (b) { block = b[1]; continue; }
  if (/^        Relationships: \[/.test(line)) { block = 'Rel'; relBuf = ''; if (/\[\]$/.test(line.trim())) block = null; continue; }
  if (block === 'Rel') {
    if (/^        \]$/.test(line)) {
      const objs = relBuf.split('},').map((s) => s.trim()).filter(Boolean);
      for (const o of objs) {
        const cols = (o.match(/columns: \[([^\]]*)\]/) || [])[1];
        const ref = (o.match(/referencedRelation: "(\w+)"/) || [])[1];
        const rcols = (o.match(/referencedColumns: \[([^\]]*)\]/) || [])[1];
        const one = /isOneToOne: true/.test(o);
        if (cols && ref && rcols) {
          cur.fks.push({ col: cols.replace(/["\s]/g, '').split(',')[0], refTable: ref, refCol: rcols.replace(/["\s]/g, '').split(',')[0], oneToOne: one, source: 'types.ts' });
        }
      }
      block = null;
      continue;
    }
    relBuf += line + '\n';
    continue;
  }
  if (/^        \}$/.test(line)) { block = null; continue; }
  const c = line.match(/^          (\w+)(\??): /);
  if (c && block === 'Row') cur.columns.push(c[1]);
  if (c && block === 'Insert' && !c[2]) cur.required.push(c[1]);
}

// ---------- migrations ----------
const migDir = path.join(REPO, 'supabase/migrations');
const migFiles = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
const mig = {}; // table -> { cols:Set, dropped:Set, fks:[] }
const ensure = (t) => (mig[t] ||= { cols: new Set(), dropped: new Set(), fks: [] });
const stripComments = (s) => s.replace(/--[^\n]*/g, '');
for (const f of migFiles) {
  const sql = stripComments(fs.readFileSync(path.join(migDir, f), 'utf8'));
  const lower = sql.toLowerCase();
  // CREATE TABLE blocks (balanced parens)
  const reCreate = /create table (?:if not exists )?(?:public\.)?"?(\w+)"?\s*\(/g;
  let m;
  while ((m = reCreate.exec(lower))) {
    const t = m[1];
    let depth = 1, j = reCreate.lastIndex;
    for (; j < lower.length && depth > 0; j++) { if (lower[j] === '(') depth++; else if (lower[j] === ')') depth--; }
    const body = lower.slice(reCreate.lastIndex, j - 1);
    // split on top-level commas
    const parts = []; let d = 0, start = 0;
    for (let k = 0; k < body.length; k++) {
      if (body[k] === '(') d++; else if (body[k] === ')') d--; else if (body[k] === ',' && d === 0) { parts.push(body.slice(start, k)); start = k + 1; }
    }
    parts.push(body.slice(start));
    const tm = ensure(t);
    for (const p of parts) {
      const s = p.trim();
      if (!s) continue;
      if (/^(primary key|unique|constraint|check|foreign key|exclude)\b/.test(s)) continue;
      const cm = s.match(/^"?(\w+)"?\s+\w/);
      if (!cm) continue;
      tm.cols.add(cm[1]); tm.dropped.delete(cm[1]);
      const fk = s.match(/references (?:public\.)?"?(\w+)"?\s*\(\s*"?(\w+)"?\s*\)/);
      if (fk) tm.fks.push({ col: cm[1], refTable: fk[1], refCol: fk[2], source: f });
    }
  }
  // ALTER TABLE statements
  const reAlter = /alter table (?:only )?(?:if exists )?(?:public\.)?"?(\w+)"?\s+([\s\S]*?);/g;
  while ((m = reAlter.exec(lower))) {
    const t = m[1], body = m[2];
    const tm = ensure(t);
    const reAdd = /add column (?:if not exists )?"?(\w+)"?\s+([^,]*?)(?=,\s*(?:add|drop|alter)\b|$)/g;
    let a;
    while ((a = reAdd.exec(body))) {
      tm.cols.add(a[1]); tm.dropped.delete(a[1]);
      const fk = a[2].match(/references (?:public\.)?"?(\w+)"?\s*\(\s*"?(\w+)"?\s*\)/);
      if (fk) tm.fks.push({ col: a[1], refTable: fk[1], refCol: fk[2], source: f });
    }
    const reDrop = /drop column (?:if exists )?"?(\w+)"?/g;
    while ((a = reDrop.exec(body))) { tm.dropped.add(a[1]); tm.cols.delete(a[1]); }
    const reRen = /rename column "?(\w+)"? to "?(\w+)"?/g;
    while ((a = reRen.exec(body))) { tm.cols.delete(a[1]); tm.cols.add(a[2]); }
  }
}

// ---------- union ----------
const report = { onlyInMigrations: {}, onlyInTypes: {} };
for (const [t, tm] of Object.entries(mig)) {
  const tt = tables[t];
  if (!tt) {
    // table only declared in migrations — include it
    tables[t] = { name: t, kind: 'table', columns: [...tm.cols], required: [], fks: [], source: 'migrations-only' };
    report.onlyInMigrations[t] = ['(whole table)'];
    continue;
  }
  const extra = [...tm.cols].filter((c) => !tt.columns.includes(c));
  if (extra.length) { report.onlyInMigrations[t] = extra; tt.columns.push(...extra); }
  for (const fk of tm.fks) {
    if (!tt.fks.some((x) => x.col === fk.col && x.refTable === fk.refTable)) tt.fks.push(fk);
  }
}
for (const [t, tt] of Object.entries(tables)) {
  const tm = mig[t];
  if (!tm || tt.kind !== 'table') continue;
  const only = tt.columns.filter((c) => !tm.cols.has(c));
  if (only.length) report.onlyInTypes[t] = only;
}

fs.writeFileSync(OUT, JSON.stringify({ generatedFrom: ['src/integrations/supabase/types.ts', 'supabase/migrations/*.sql'], tables, report }, null, 1));
const focus = ['gst_notices', 'gst_case_folder_items', 'profiles', 'clients', 'notice_events', 'litigation_matters', 'matter_deadlines', 'email_outbox'];
for (const t of focus) console.log(t, tables[t]?.columns.length, 'cols; fks:', (tables[t]?.fks || []).map((f) => f.col + '->' + f.refTable).join(', '));
console.log('only in migrations:', JSON.stringify(report.onlyInMigrations).slice(0, 1500));
console.log('only in types (not seen in migrations):', JSON.stringify(Object.fromEntries(Object.entries(report.onlyInTypes).filter(([t]) => focus.includes(t)))).slice(0, 1500));
console.log('wrote', OUT, Object.keys(tables).length, 'relations');
