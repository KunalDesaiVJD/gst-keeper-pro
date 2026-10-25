// 0.18.5: an appeal with no notice gets its files from its own case folder on
// the applications step. Runs the shipped appealFolderPass, cut from content.js,
// against a fake portal and a fake GSTKdb.
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../content.js', import.meta.url), 'utf8');
const cut = (head) => {
  const s = src.indexOf(head);
  const e = src.indexOf('\n  }\n', s);
  if (s < 0 || e < 0) { console.log('FAIL not found: ' + head); process.exit(1); }
  return src.slice(s, e + 4);
};
const body = cut('  function findDocDescriptors(node, seen, out) {') + cut('  async function appealFolderPass(cur, rows, job) {');
let fail = 0;
const ok = (c, n, x) => { if (c) console.log('ok   ' + n); else { console.log('FAIL ' + n, x === undefined ? '' : JSON.stringify(x)); fail++; } };

function world({ stored = {}, checked = {} } = {}) {
  const calls = { folder: [], items: [], downloads: [], uploads: [], ingests: [] };
  const mem = { ['gstk_appeal_checked_c1']: checked };
  const json = (v) => ({ ok: true, json: async () => v });
  const fetch = async (url, opts) => {
    const b = opts && opts.body ? JSON.parse(opts.body) : null;
    if (url.endsWith('/case/folder')) { calls.folder.push(b); return json(b.caseId === '14356779' ? [{ caseFolderId: 'F1', caseFolderTypeCd: 'APLCN' }] : []); }
    if (url.endsWith('/case/folder/items')) {
      calls.items.push(b);
      return json([{ refId: 'AD241225010791I', itemJson: JSON.stringify({ arn: 'AD241225010791I',
        docappeal: { id: '111', docname: 'GST APL-01.pdf' }, docothers: [{ id: '222', name: 'EXHIBIT A', docname: 'a.pdf' }] }) }]);
    }
    if (url.includes('downloadhb')) { calls.downloads.push(url); return { ok: true, arrayBuffer: async () => new Uint8Array(500).buffer }; }
    return { ok: false };
  };
  const GSTKdb = {
    knownDocs: async () => ({ itemDocs: stored }),
    uploadPdf: async (path) => { calls.uploads.push(path); return 'https://x/' + path; },
    ingest: async (...a) => { calls.ingests.push(a); },
  };
  const store = { get: async (k) => ({ [k]: mem[k] }), set: async (o) => Object.assign(mem, o) };
  const fn = new Function('fetch', 'GSTKdb', 'store', 'withTimeout', 'fetchEncrypDocEh', 'arrayBufferToBase64', 'simpleHash', 'OPEN_CASE_RECHECK_MS',
    body + '\nreturn appealFolderPass;')(fetch, GSTKdb, store, (p) => p, async () => 'EH', () => 'QUJD', (s) => 'h' + s.length, 7 * 864e5);
  return { fn, calls, mem };
}
const cur = { clientId: 'c1', creds: { gstin: '24AAAAA0000A1Z5' } };
const rows = [
  { case_type_cd: 'APPEL', arn: 'AD241225010791I', case_id: '14356779', status: 'Appeal Submitted' },
  { case_type_cd: 'ADJWS', arn: 'AD0000WAIVER', case_id: '9', status: 'x' },
  { case_type_cd: 'APPEL', arn: 'AD0000NOCASE', case_id: null, status: 'x' },
];

{
  const w = world();
  const r = await w.fn(cur, rows, { runId: 'r1' });
  ok(w.calls.folder.length === 1 && w.calls.folder[0].caseTypeCd === 'APPEL' && w.calls.folder[0].caseId === '14356779', 'opens only the appeal\'s own folder', w.calls.folder);
  ok(r.folders === 1 && r.files === 2, 'downloads both files', r);
  ok(w.calls.uploads.join('|') === 'notices/c1/case-folder/AD241225010791I/111.pdf|notices/c1/case-folder/AD241225010791I/222.pdf', 'stored under the appeal\'s ARN', w.calls.uploads);
  const ing = w.calls.ingests[0];
  ok(ing && ing[2] === 'case_folder' && ing[5] === 'AD241225010791I' && ing[4].complete === true, 'ingested as case folder items of the appeal', ing && ing.slice(2));
  ok(ing && ing[3][0].portal_key === 'APLCN:AD241225010791I' && ing[3][0].attachments.map((a) => a.label).join('|') === 'GST APL-01.pdf|EXHIBIT A · a.pdf', 'item key and labels', ing && ing[3]);
  ok(w.mem.gstk_appeal_checked_c1.AD241225010791I.status === 'Appeal Submitted', 'the check is remembered');
}
{
  // Checked yesterday, same status, files stored: nothing is fetched.
  const stored = { 'AD241225010791I|APLCN:AD241225010791I': [{ label: 'x', url: 'https://x/111.pdf' }] };
  const w = world({ stored, checked: { AD241225010791I: { at: Date.now() - 864e5, status: 'Appeal Submitted' } } });
  await w.fn(cur, rows, { runId: 'r2' });
  ok(w.calls.folder.length === 0, 'a fresh appeal is not reopened', w.calls.folder);
}
{
  // Status changed: reopened; the stored file is kept, only the new one is downloaded.
  const stored = { 'AD241225010791I|APLCN:AD241225010791I': [{ label: 'GST APL-01.pdf', url: 'https://x/notices/c1/case-folder/AD241225010791I/111.pdf' }] };
  const w = world({ stored, checked: { AD241225010791I: { at: Date.now(), status: 'Appeal Submitted' } } });
  const r = await w.fn(cur, [{ ...rows[0], status: 'Hearing Notice Issued' }], { runId: 'r3' });
  ok(w.calls.folder.length === 1 && r.files === 1 && w.calls.downloads.length === 1, 'a changed status reopens it, the stored file is not downloaded again', { r, d: w.calls.downloads });
}
console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed'); process.exit(fail ? 1 : 0);
