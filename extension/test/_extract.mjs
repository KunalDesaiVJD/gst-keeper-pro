// Regenerates test/_helpers.mjs and test/_linkpass.mjs from content.js, so the
// tests always run the shipped code rather than a copy of it that can drift.
//   node test/_extract.mjs
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../content.js', import.meta.url), 'utf8');
const lines = src.split('\n');
const i0 = lines.findIndex((l) => l.startsWith('  const NOTICE_FIELD_KEYS'));
const i1 = lines.findIndex((l) => l.startsWith('  const isRealText'));
if (i0 < 0 || i1 < 0) throw new Error('constants block not found in content.js');
const consts = lines.slice(i0, i1 + 1).join('\n');
const fstart = src.indexOf('  function findByKeys(node, keys, accept, seen) {');
const fend = src.indexOf('  function extractDocId(el) {');
if (fstart < 0 || fend < 0) throw new Error('helper block not found in content.js');
const funcs = src.slice(fstart, fend);
fs.writeFileSync(new URL('./_helpers.mjs', import.meta.url),
  consts + '\n' + funcs + '\nexport {findByKeys, anyDateToIso, noticeFieldsFromItem, pickNoticeAttachment, normKey};\n');
const lp = src.slice(src.indexOf('    // \u2500\u2500 The link pass (0.8.0) '),
  src.indexOf('    // Folder items first (a new reply / order on a known case is logged'));
if (!lp) throw new Error('link pass not found in content.js');
fs.writeFileSync(new URL('./_linkpass.mjs', import.meta.url),
  consts + '\n' + funcs + '\n'
  + 'export async function runLinkPass(ctx){\n'
  + '  const {rows, detailByRef, storedAttachByRef, fillTried, triedKey, store, FULL_FOLDER_PASS_MS} = ctx;\n'
  + '  let linkedPdf=0, linkedDue=0, linkedOfficer=0, linkedDin=0;\n'
  + '  const needsFill = (row) => !!row && (!row.pdf_url || !row.due_date || !row.issued_by);\n'
  + lp + '  return {linkedPdf, linkedDue, linkedOfficer, linkedDin, dinByKey};\n}\n');
console.log('regenerated test/_helpers.mjs and test/_linkpass.mjs from content.js');
