// 0.10.0, fresh only: a run fetches a notice's PDF and a case's folder only when
// something is new (a notice not stored yet, or one whose portal status moved);
// an open case with nothing new is looked at once a week, not on every run.
import fs from 'node:fs'; import vm from 'node:vm';
const src = fs.readFileSync(new URL('../content.js', import.meta.url),'utf8');
const GSTIN='24AADCS9204N1Z4', CLIENT='c1', REF='ZD2405240950OLD', ARN='AD2404240326278';
const J=(o)=>({ok:true,status:200,json:async()=>o,arrayBuffer:async()=>new Uint8Array(400).buffer});
const DAY=86400000;
const el=()=>({style:{},setAttribute(){},getAttribute(){return null},appendChild(){},remove(){},addEventListener(){},removeEventListener(){},querySelector(){return null},querySelectorAll(){return []},classList:{add(){},remove(){}},textContent:'',innerText:'',value:'',offsetParent:null,children:[],dataset:{}});

async function run({ seen, portalStatus = 'Open', caseCheckedAgo = 2 * DAY, ref = REF }) {
  const calls = { pdf: 0, folder: 0 };
  const portal = {
    'profile/detail': () => J({ gstin: GSTIN }),
    'api/get/notices': () => J([{ noticeOrderId: ref, type: 'DRC-01', descr: 'SCN', dtOfIssue: '28/05/2024', dueDate: '27/06/2024', status: portalStatus, issuedBy: 'STO', docId: 'D1', applnId: 'A1' }]),
    'case/task/get': () => J([{ refId: ref, arn: ARN, caseId: 'CID1', caseTypeName: 'DEMAND', caseTpeCd: 'ADJDT', taskDesc: 'SCN', assignmentDt: 1716854400000 }]),
    'case/folder/items': () => { calls.folder++; return J([]); },
    'case/folder': () => { calls.folder++; return J([]); },
    'services.gst.gov.in/document/': () => { calls.pdf++; return J({}); },
  };
  const store = {};
  const sandbox = {console:{log(){},warn(){},error(){}},setTimeout,clearTimeout,setInterval,clearInterval,Promise,JSON,Math,Date,Number,String,Object,Array,Map,Set,RegExp,Error,isFinite,parseInt,parseFloat,
    atob:(s)=>Buffer.from(s,'base64').toString('binary'),btoa:(s)=>Buffer.from(s,'binary').toString('base64'),
    Uint8Array,ArrayBuffer,Blob:class{},FileReader:class{},URL,encodeURIComponent,
    fetch:async(u)=>{const k=Object.keys(portal).sort((a,b)=>b.length-a.length).find(k=>String(u).includes(k)); if(!k) throw new Error('no route '+u); return portal[k]();},
    document:{readyState:'complete',body:el(),documentElement:el(),querySelector(){return null},querySelectorAll(){return []},createElement:el,addEventListener(){},getElementById(){return null}},
    location:{href:'https://services.gst.gov.in/services/auth/notices',pathname:'/services/auth/notices'},
    chrome:{runtime:{getManifest:()=>({version:'0.10.0'}),sendMessage(){},lastError:null,id:'t'},
      storage:{local:{get:async(k)=>(typeof k==='string'&&k in store?{[k]:store[k]}:{}),set:async(o)=>{Object.assign(store,o)},remove:async(k)=>{delete store[k]},onChanged:{addListener(){},removeListener(){}}}}},
    jspdf:{jsPDF:class{text(){}setFont(){}setFontSize(){}splitTextToSize(){return[]}addPage(){}output(){return'data:application/pdf;base64,AAA'}}},
  };
  store.gstk_active_job={mode:'notices_bundle',step:'notices',idx:0,periods:[''],periodIdx:0,runId:'r1',logSync:true,
    startedAt:Date.now(),lastActivityAt:Date.now(),clients:[{clientId:CLIENT,creds:{user:'u',name:'N',gstin:GSTIN,selectedReturns:[]}}]};
  store['gstk_folder_full_'+CLIENT]=Date.now()-DAY;            // the monthly full pass is not due
  store['gstk_fill_tried_'+CLIENT]={[ref]:Date.now()-DAY};      // nor the weekly gap fill
  store['gstk_case_checked_'+CLIENT]={[ARN]:Date.now()-caseCheckedAgo};
  sandbox.GSTKdb={
    knownDocs:async()=>({noticePdf:{},openCases:[ARN],knownCases:[ARN],itemDocs:{},drc03Pdf:{},refundDocs:{},seen}),
    uploadPdf:async(p)=>'https://store/'+p,
    ingest:async()=>({status:'ok',new:0,changed:0,removed:0}),patchNoticeFields:async()=>true,
    noticeDetails:async()=>1,logStep:async()=>null,logClientSync:async()=>null,logEvent(){},
    focusTab:async()=>true,backgroundTab:async()=>true,noticesNeedingDetail:async()=>[],
    fetchCrossOriginAsBase64:async()=>{throw new Error('n/a')},runSweep:async()=>null,runFinish:async()=>null,getClients:async()=>[],
  };
  sandbox.window=sandbox; sandbox.globalThis=sandbox; sandbox.self=sandbox;
  vm.runInNewContext(src, vm.createContext(sandbox), {filename:'content.js',timeout:20000});
  await new Promise(r=>setTimeout(r,2000));
  return { calls, store };
}

let fail=0; const ok=(c,n)=>{console.log((c?'ok   ':'FAIL ')+n); if(!c)fail++};

let r = await run({ seen: { [REF]: 'Open' } });
ok(r.calls.pdf === 0, 'old notice, unchanged: its PDF is not fetched again (calls: ' + r.calls.pdf + ')');
ok(r.calls.folder === 0, 'old open case checked 2 days ago: no folder fetched (calls: ' + r.calls.folder + ')');

r = await run({ seen: { [REF]: 'Open' }, caseCheckedAgo: 8 * DAY });
ok(r.calls.folder > 0, 'open case not checked for 8 days: the weekly check fetches its folder');
ok(r.calls.pdf === 0, 'still no PDF fetch for the old notice');

r = await run({ seen: {}, ref: 'ZD2610120000NEW' });
ok(r.calls.pdf === 1, 'a new notice: its PDF is fetched');
ok(r.calls.folder > 0, 'and its case folder');

r = await run({ seen: { [REF]: 'Open' }, portalStatus: 'Replied' });
ok(r.calls.folder > 0, 'status moved on the portal: the case folder is fetched');

console.log(fail?'\n'+fail+' FAILED':'\nall passed'); process.exit(fail?1:0);
