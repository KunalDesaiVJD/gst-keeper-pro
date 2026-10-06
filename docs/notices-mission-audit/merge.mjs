// Merge the three domain registers into one, folding duplicates into a primary finding.
import fs from 'fs';
const D = new URL('.', import.meta.url).pathname;
const load = f => JSON.parse(fs.readFileSync(D + 'findings/' + f, 'utf8'));
export const sync = load('sync.json'), logic = load('logic.json'), reply = load('reply.json');
const dupes = { // primary: [duplicates]
  'L-01':['S-02'], 'L-03':['R-03'], 'L-02':['S-06','R-04'], 'L-05':['S-07'], 'L-07':['S-15'],
  'R-01':['L-15','S-11'], 'R-02':['S-27'], 'S-03':['R-16'], 'S-13':['L-17'], 'L-18':['R-12'],
  'L-09':['R-07'], 'L-25':['R-13'], 'L-28':['R-14'], 'L-10':['R-05','S-18'], 'S-01':['S-23','R-26'],
  'L-30':['R-27'], 'L-34':['R-22'], 'L-08':['R-20'] };
const sevRank = { Critical:0, High:1, Medium:2, Low:3 };
export function merged() {
  const all = [...sync.findings, ...logic.findings, ...reply.findings].map(f => ({ ...f }));
  const byId = Object.fromEntries(all.map(f => [f.id, f]));
  const folded = new Set();
  for (const [p, ds] of Object.entries(dupes)) {
    const prim = byId[p]; if (!prim) continue;
    prim.alsoFoundAs = ds.filter(d => byId[d]);
    for (const d of ds) { if (!byId[d]) continue; folded.add(d);
      if (sevRank[byId[d].severity] < sevRank[prim.severity]) prim.severity = byId[d].severity; }
  }
  return all.filter(f => !folded.has(f.id)).sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || a.id.localeCompare(b.id, 'en', { numeric: true }));
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const m = merged(); const c = {}; m.forEach(f => c[f.severity] = (c[f.severity] || 0) + 1);
  const p = {}; m.forEach(f => p[f.pillar] = (p[f.pillar] || 0) + 1);
  console.log(m.length, c, p);
}
