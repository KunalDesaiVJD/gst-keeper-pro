// 0.18.4: an appeal's own application (APLCN) names its files `docname`, so
// findDocDescriptors must find them too. Runs the shipped function, cut from content.js.
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../content.js', import.meta.url), 'utf8');
const start = src.indexOf('  function findDocDescriptors(node, seen, out) {');
const end = src.indexOf('\n  }\n', start);
if (start < 0 || end < 0) { console.log('FAIL findDocDescriptors not found'); process.exit(1); }
const findDocDescriptors = new Function(src.slice(start, end + 4) + '\nreturn findDocDescriptors;')();
let fail = 0;
const ok = (c, n, x) => { if (c) console.log('ok   ' + n); else { console.log('FAIL ' + n, x === undefined ? '' : JSON.stringify(x)); fail++; } };
const find = (node) => { const out = []; findDocDescriptors(node, new Set(), out); return out; };

// Shaped like Tamnna-GJ's APL-01 item (AD240925016271B's appeal).
const apl = {
  arn: 'AD2406260000APL', orddtl: { ordnum: 'ZD240326000004D' },
  docappeal: { id: '20260624101907', docname: 'GST APL-01.pdf' },
  docannexure: { id: '20260624101888', docname: 'Grounds.pdf' },
  docothers: [{ id: '20260624101871', name: 'EXHIBIT A', docname: 'Binder1.pdf' },
              { id: '20260624101872', name: 'Binder2.pdf', docname: 'Binder2.pdf' }],
};
const docs = find(apl);
ok(docs.length === 4, 'every file of the APL-01 is found', docs);
ok(docs.map((d) => d.docName).join('|') === 'GST APL-01.pdf|Grounds.pdf|EXHIBIT A · Binder1.pdf|Binder2.pdf', 'labelled with the portal names', docs.map((d) => d.docName));
ok(docs[0].id === '20260624101907', 'the id is kept for the download');
ok(apl.docappeal.docName === undefined, 'the item JSON itself is not changed');

// The spellings that worked before still do, once each.
const notice = { docupdtl: [{ id: 'abc', docName: 'SCN.pdf' }], suppdocs: [{ dcupdtls: { id: 'def', docName: 'Annexure.pdf' } }] };
ok(find(notice).map((d) => d.id + ':' + d.docName).join('|') === 'abc:SCN.pdf|def:Annexure.pdf', 'docName and dcupdtls as before', find(notice));
ok(find({ id: 'x', docname: '  ' }).length === 0, 'a blank docname is no file');
ok(find({ id: '', docname: 'a.pdf' }).length === 0, 'no id, no file');
const cyc = { a: { id: 'c1', docname: 'c.pdf' } }; cyc.a.back = cyc;
ok(find(cyc).length === 1, 'cycle safe');
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed'); process.exit(fail ? 1 : 0);
