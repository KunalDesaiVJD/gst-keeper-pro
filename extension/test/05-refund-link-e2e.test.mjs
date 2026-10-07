// Scenario 3: nothing else in the sync may change shape. Drives the real
// content.js through the refunds step and the refund-documents step and checks
// that the refund rows and the refund folder rows are exactly as 0.7.1 wrote
// them, and that an RFD-08's notice gets patched (the new link pass).
import fs from 'node:fs'; import vm from 'node:vm';
const src = fs.readFileSync(new URL('../content.js', import.meta.url),'utf8');
const GSTIN='24AADCS9204N1Z4', CLIENT='c1', ARN='AA240125000123A', RFD08='ZD241125035681P';
const J=(o)=>({ok:true,status:200,json:async()=>o,arrayBuffer:async()=>new Uint8Array(Buffer.from('%PDF'+'y'.repeat(500))).buffer});
const portal={
  'profile/detail':()=>J({gstin:GSTIN}),
  'api/case/search':()=>J([{arn:ARN,caseId:'RC1',statusDesc:'Pending for order',caseCreationDate:'10/11/2025',
     appItem:{itemJson:JSON.stringify({refundRsn:'Refund of ITC on export',ttlRfdAmt:250000})}}]),
  'case/folder/items':()=>J([{refId:RFD08,itemJson:JSON.stringify({crn:RFD08,replyDueDt:'26/11/2025',
     officerName:'K M PATEL',officerDesg:'Asst. Commissioner',din:'20251125000987',
     dcupdtls:{id:'DOC_RFD08',docName:'RFD08_SCN_'+RFD08+'.pdf'}})}]),
  'case/folder':()=>J([{caseFolderId:'RF1',caseFolderTypeCd:'NOTAC',caseFolderTypeName:'NOTICE/ ACKNOWLEDGEMENT'}]),
  'getEncrypDocIds':()=>J({DOC_RFD08:'EH9'}),
  'downloadhb/download/new':()=>J({}),
};
const el=()=>({style:{},setAttribute(){},getAttribute(){return null},appendChild(){},remove(){},addEventListener(){},removeEventListener(){},querySelector(){return null},querySelectorAll(){return []},classList:{add(){},remove(){}},textContent:'',innerText:'',value:'',offsetParent:null,children:[],dataset:{}});
const seen={ingest:[],patch:[],refundDocs:[],folderItems:[]};
const store={};
const sandbox={console,setTimeout,clearTimeout,setInterval,clearInterval,Promise,JSON,Math,Date,Number,String,Object,Array,Map,Set,RegExp,Error,isFinite,parseInt,parseFloat,
 atob:(s)=>Buffer.from(s,'base64').toString('binary'),btoa:(s)=>Buffer.from(s,'binary').toString('base64'),
 Uint8Array,ArrayBuffer,Blob:class{},FileReader:class{},URL,encodeURIComponent,
 fetch:async(u)=>{const k=Object.keys(portal).sort((a,b)=>b.length-a.length).find(k=>String(u).includes(k)); if(!k) throw new Error('no route '+u); return portal[k]();},
 document:{readyState:'complete',body:el(),documentElement:el(),querySelector(){return null},querySelectorAll(){return []},createElement:el,addEventListener(){},getElementById(){return null}},
 location:{href:'https://services.gst.gov.in/litserv/auth/case/search',pathname:'/litserv/auth/case/search'},
 chrome:{runtime:{getManifest:()=>({version:'0.8.0'}),sendMessage(){},lastError:null,id:'t'},
  storage:{local:{get:async(k)=>(typeof k==='string'&&k in store?{[k]:store[k]}:{}),set:async(o)=>{Object.assign(store,o)},remove:async(k)=>{delete store[k]},onChanged:{addListener(){},removeListener(){}}}}},
 jspdf:{jsPDF:class{text(){}setFont(){}setFontSize(){}splitTextToSize(){return[]}addPage(){}output(){return'data:application/pdf;base64,AAA'}}},
};
store.gstk_active_job={mode:'notices_bundle',step:'refund_docs',idx:0,periods:[''],periodIdx:0,runId:'r1',logSync:true,
  startedAt:Date.now(),lastActivityAt:Date.now(),
  clients:[{clientId:CLIENT,creds:{user:'u',name:'N',gstin:GSTIN,selectedReturns:[]}}]};
sandbox.GSTKdb={
  knownDocs:async()=>({noticePdf:{},openCases:[],knownCases:[],itemDocs:{},drc03Pdf:{},refundDocs:{}}),
  uploadPdf:async(p)=>'https://store/'+p,
  ingest:async(c,r,step,rows)=>{seen.ingest.push({step,rows});return{status:'ok',new:1,changed:0,removed:0}},
  replaceCaseFolderItems:async(c,arn,rows)=>{seen.folderItems.push({arn,rows:JSON.parse(JSON.stringify(rows))});return true},
  patchRefundDocument:async(c,arn,p)=>{seen.refundDocs.push({arn,p:JSON.parse(JSON.stringify(p))});return true},
  patchNoticeFields:async(c,k,p)=>{seen.patch.push({k,p:JSON.parse(JSON.stringify(p))});return true},
  // The RFD-08 is in the app as a notice with nothing but its reference.
  noticesNeedingDetail:async()=>[{portal_key:RFD08,reference_number:RFD08,pdf_url:null,due_date:null,issued_by:null}],
  noticeDetails:async()=>1,logStep:async()=>null,logClientSync:async()=>null,logEvent(){},
  focusTab:async()=>true,backgroundTab:async()=>true,fetchCrossOriginAsBase64:async()=>{throw new Error('n/a')},
  runSweep:async()=>null,runFinish:async()=>null,getClients:async()=>[],
};
sandbox.window=sandbox; sandbox.globalThis=sandbox; sandbox.self=sandbox;
vm.runInNewContext(src, vm.createContext(sandbox), {filename:'content.js',timeout:20000});
await new Promise(r=>setTimeout(r,2500));
let fail=0; const ok=(c,n)=>{console.log((c?'ok   ':'FAIL ')+n); if(!c)fail++};

// 0.7.1 behaviour, unchanged:
ok(seen.refundDocs.length===1 && Array.isArray(seen.refundDocs[0].p.documents) && seen.refundDocs[0].p.documents.length===1,
  'refund documents still written per ARN, {tab,label,url} as before');
if (seen.refundDocs[0]) console.log('   documents =', JSON.stringify(seen.refundDocs[0].p.documents));
ok(seen.folderItems.length===1 && seen.folderItems[0].arn===ARN && seen.folderItems[0].rows[0].folder_section==='NOTAC',
  'refund folder items still written under the ARN (Refund Notice Folder)');
ok(seen.folderItems[0] && seen.folderItems[0].rows[0].raw_json && seen.folderItems[0].rows[0].pulled_at,
  'refund folder rows still carry raw_json and pulled_at (the 0.7.1 fix)');

// 0.8.0 addition:
const p = seen.patch.find(x=>x.k===RFD08 && x.p.pdf_url);
ok(!!p, 'the RFD-08 notice was patched with what the refund folder knows');
if (p) console.log('   patch =', JSON.stringify(p.p));
ok(p && p.due_date===undefined ? true : !!(p && p.p.due_date==='2025-11-26'), 'RFD-08 reply date from the refund folder');
ok(!!(p && /K M PATEL, Asst\. Commissioner/.test(p.p.issued_by||'')), 'RFD-08 officer from the refund folder');
ok(seen.patch.some(x=>x.k===RFD08 && x.p.din==='20251125000987'), 'RFD-08 DIN patched separately');
ok(!seen.patch.some(x=>x.p.pdf_url && x.p.din), 'the DIN is never in the same write as the rest');
console.log(fail?'\n'+fail+' FAILED':'\nall passed'); process.exit(fail?1:0);
