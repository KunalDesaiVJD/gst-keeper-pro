// Drives the REAL content.js through a whole notices pull against a fake
// portal, and checks what reaches the ingest door. Reproduces the pre-0.8.0
// gap: a DRC-01 from get/notices whose PDF exists only in its case folder.
import fs from 'node:fs'; import vm from 'node:vm';
const src = fs.readFileSync(new URL('../content.js', import.meta.url),'utf8');
const GSTIN='24AADCS9204N1Z4', CLIENT='c1', REF='ZD240524095047C', ARN='AD2404240326278';

const J = (o) => ({ ok:true, status:200, json: async()=>o, arrayBuffer: async()=>new Uint8Array(Buffer.from('%PDF-1.4'+'x'.repeat(400))).buffer });
const portal = {
  'profile/detail': () => J({ gstin: GSTIN }),
  'api/get/notices': () => J([
    // The DRC-01 the app reports as "PDF not captured yet": no docId/applnId.
    { noticeOrderId: REF, type:'DRC-01', descr:'Show cause notice and summary thereof in form GST DRC-01',
      dtOfIssue:'28/05/2024', dueDate:'', status:'Issued', issuedBy:'' },
  ]),
  'case/task/get': () => J([
    { refId: REF, arn: ARN, caseId:'CID1', caseTypeName:'DEMAND', caseTpeCd:'ADJDT',
      taskDesc:'SCN u/s 73/74 and GST DRC-01', assignmentDt: 1716854400000 },
  ]),
  'case/folder': () => J([{ caseFolderId:'F_NOT', caseFolderTypeCd:'NOTCS' }, { caseFolderId:'F_ORD', caseFolderTypeCd:'ORDRS' }]),
  'case/folder/items': (body) => {
    if (JSON.parse(body).caseFolderId === 'F_NOT') {
      return J([{ refId: REF, itemJson: JSON.stringify({ crn: REF, dueDt:'27/06/2024',
        issuedBy:'GHANSHYAM DAMODARBHAI PARMAR', designation:'State Tax Officer',
        din:'202405280012345', secCd:'74', fy:'2019-20',
        docupdtl:[{ id:'DOC_NOTICE', docName:'DOT_NOTICE_'+REF+'_20240528033335.pdf' }] }) }]);
    }
    return J([]);
  },
  'getEncrypDocIds': () => J({ DOC_NOTICE:'EH1' }),
  'downloadhb/download/new': () => J({}),
};
const seen = { ingest: [], patch: [], uploads: [] };
const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  Promise, JSON, Math, Date, Number, String, Object, Array, Map, Set, RegExp, Error, isFinite, parseInt, parseFloat,
  atob:(s)=>Buffer.from(s,'base64').toString('binary'), btoa:(s)=>Buffer.from(s,'binary').toString('base64'),
  Uint8Array, ArrayBuffer, Blob:class{}, FileReader:class{}, URL, encodeURIComponent,
  fetch: async (u, opts) => {
    // Longest key first: '.../case/folder/items' also contains '.../case/folder'.
    const key = Object.keys(portal).sort((a,b)=>b.length-a.length).find(k => String(u).includes(k));
    if (!key) throw new Error('fake portal has no route for '+u);
    return portal[key](opts && opts.body);
  },
};
const el = () => ({ style:{}, setAttribute(){}, getAttribute(){return null}, appendChild(){}, remove(){},
  addEventListener(){}, removeEventListener(){}, querySelector(){return null}, querySelectorAll(){return []},
  classList:{add(){},remove(){}}, textContent:'', innerText:'', value:'', offsetParent:null, children:[], dataset:{} });
sandbox.document = { readyState:'complete', body: el(), documentElement: el(), querySelector(){return null},
  querySelectorAll(){return []}, createElement: el, addEventListener(){}, getElementById(){return null} };
sandbox.location = { href:'https://services.gst.gov.in/services/auth/notices', pathname:'/services/auth/notices' };
const store = {};
sandbox.chrome = {
  runtime:{ getManifest:()=>({version:'0.8.0'}), sendMessage(){}, lastError:null, id:'t' },
  storage:{ local:{
    get: async (k)=> (typeof k==='string' ? (k in store ? {[k]:store[k]} : {}) : {}),
    set: async (o)=>{ Object.assign(store,o); }, remove: async(k)=>{ delete store[k]; },
    onChanged:{ addListener(){}, removeListener(){} } } },
};
store.gstk_active_job = { mode:'notices_bundle', step:'notices', idx:0, periods:[''], periodIdx:0,
  runId:'r1', logSync:true, startedAt:Date.now(), lastActivityAt:Date.now(),
  clients:[{ clientId:CLIENT, creds:{ user:'u', name:'SHREEJIKRUPA BUILDCON LIMITED-GJ', gstin:GSTIN, selectedReturns:[] } }] };
sandbox.GSTKdb = {
  knownDocs: async()=>({ noticePdf:{}, openCases:[ARN], knownCases:[ARN], itemDocs:{}, drc03Pdf:{}, refundDocs:{} }),
  uploadPdf: async(path)=>{ seen.uploads.push(path); return 'https://store/'+path; },
  ingest: async(cid, rid, step, rows)=>{ seen.ingest.push({step, rows: JSON.parse(JSON.stringify(rows))}); return {status:'ok', new:rows.length, changed:0, removed:0}; },
  patchNoticeFields: async(cid, key, p)=>{ seen.patch.push({key, p}); return true; },
  noticeDetails: async()=>1, logStep: async()=>null, logClientSync: async()=>null,
  logEvent(){}, focusTab: async()=>true, backgroundTab: async()=>true,
  noticesNeedingDetail: async()=>[], fetchCrossOriginAsBase64: async()=>{ throw new Error('n/a'); },
  runSweep: async()=>null, runFinish: async()=>null, getClients: async()=>[],
};
sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
sandbox.jspdf = { jsPDF: class { constructor(){} text(){} setFont(){} setFontSize(){} splitTextToSize(){return[]} addPage(){} output(){return 'data:application/pdf;base64,AAA'} } };

vm.runInNewContext(src, vm.createContext(sandbox), { filename:'content.js', timeout: 20000 });
await new Promise(r=>setTimeout(r, 2500));

let fail=0; const ok=(c,n)=>{ console.log((c?'ok   ':'FAIL ')+n); if(!c) fail++; };
const noticeIngest = seen.ingest.find(i=>i.step==='notices');
ok(!!noticeIngest, 'the notices step reached the ingest door');
const row = noticeIngest && noticeIngest.rows.find(r=>r.reference_number===REF);
ok(!!row, 'the DRC-01 row was built');
if (row) {
  console.log('   row =', JSON.stringify({pdf_url:row.pdf_url, due_date:row.due_date, issued_by:row.issued_by, case_id:row.case_id}));
  ok(!!row.pdf_url, 'E2E the notice now carries a PDF (was null before 0.8.0)');
  ok(/DOC_NOTICE/.test(row.pdf_url||''), 'E2E and it is the folder document for this reference');
  ok(row.due_date==='2024-06-27', 'E2E reply date came from the case folder');
  ok(/GHANSHYAM DAMODARBHAI PARMAR, State Tax Officer/.test(row.issued_by||''), 'E2E officer + designation');
  ok(row.case_id===ARN, 'E2E case linked');
  ok(!('din' in row), 'E2E the DIN is NOT in the notices save body');
}
ok(seen.patch.some(p=>p.key===REF && p.p.din==='202405280012345'), 'E2E the DIN went out as its own patch');
ok(seen.ingest.some(i=>i.step==='case_folder'), 'E2E case-folder items still saved as before');
const cf = seen.ingest.find(i=>i.step==='case_folder');
console.log('   case_folder rows =', JSON.stringify(cf && cf.rows, null, 1));
console.log('   uploads =', JSON.stringify(seen.uploads));
console.log(fail? '\n'+fail+' FAILED' : '\nall passed');
process.exit(fail?1:0);
