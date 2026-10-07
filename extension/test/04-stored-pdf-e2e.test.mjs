// Scenario 2: a notice synced before 0.8.0 whose case folder is NOT re-opened
// this run (closed case, already tried this week). Its PDF must still be
// linked, from the attachments already in the database, with no portal call
// for that folder at all.
import fs from 'node:fs'; import vm from 'node:vm';
const src = fs.readFileSync(new URL('../content.js', import.meta.url),'utf8');
const GSTIN='24AADCS9204N1Z4', CLIENT='c1', REF='ZD240524095047C', ARN='AD2404240326278';
const J=(o)=>({ok:true,status:200,json:async()=>o,arrayBuffer:async()=>new Uint8Array(8).buffer});
let folderCalls=0;
const portal={
  'profile/detail':()=>J({gstin:GSTIN}),
  'api/get/notices':()=>J([{noticeOrderId:REF,type:'DRC-01',descr:'SCN',dtOfIssue:'28/05/2024',dueDate:'27/06/2024',status:'Closed',issuedBy:'STO'}]),
  'case/task/get':()=>J([{refId:REF,arn:ARN,caseId:'CID1',caseTypeName:'DEMAND',caseTpeCd:'ADJDT',taskDesc:'SCN',assignmentDt:1716854400000}]),
  'case/folder/items':()=>{folderCalls++; return J([]);},
  'case/folder':()=>{folderCalls++; return J([]);},
};
const el=()=>({style:{},setAttribute(){},getAttribute(){return null},appendChild(){},remove(){},addEventListener(){},removeEventListener(){},querySelector(){return null},querySelectorAll(){return []},classList:{add(){},remove(){}},textContent:'',innerText:'',value:'',offsetParent:null,children:[],dataset:{}});
const seen={ingest:[],patch:[]};
const store={};
const sandbox={console,setTimeout,clearTimeout,setInterval,clearInterval,Promise,JSON,Math,Date,Number,String,Object,Array,Map,Set,RegExp,Error,isFinite,parseInt,parseFloat,
 atob:(s)=>Buffer.from(s,'base64').toString('binary'),btoa:(s)=>Buffer.from(s,'binary').toString('base64'),
 Uint8Array,ArrayBuffer,Blob:class{},FileReader:class{},URL,encodeURIComponent,
 fetch:async(u)=>{const k=Object.keys(portal).sort((a,b)=>b.length-a.length).find(k=>String(u).includes(k)); if(!k) throw new Error('no route '+u); return portal[k]();},
 document:{readyState:'complete',body:el(),documentElement:el(),querySelector(){return null},querySelectorAll(){return []},createElement:el,addEventListener(){},getElementById(){return null}},
 location:{href:'https://services.gst.gov.in/services/auth/notices',pathname:'/services/auth/notices'},
 chrome:{runtime:{getManifest:()=>({version:'0.8.0'}),sendMessage(){},lastError:null,id:'t'},
  storage:{local:{get:async(k)=>(typeof k==='string'&&k in store?{[k]:store[k]}:{}),set:async(o)=>{Object.assign(store,o)},remove:async(k)=>{delete store[k]},onChanged:{addListener(){},removeListener(){}}}}},
 jspdf:{jsPDF:class{text(){}setFont(){}setFontSize(){}splitTextToSize(){return[]}addPage(){}output(){return'data:application/pdf;base64,AAA'}}},
};
store.gstk_active_job={mode:'notices_bundle',step:'notices',idx:0,periods:[''],periodIdx:0,runId:'r1',logSync:true,
  startedAt:Date.now(),lastActivityAt:Date.now(),
  clients:[{clientId:CLIENT,creds:{user:'u',name:'N',gstin:GSTIN,selectedReturns:[]}}]};
// Already tried this week -> the gap-fill must NOT force the folder open.
store['gstk_fill_tried_'+CLIENT]={[REF]:Date.now()-1000};
// A full pass happened recently, so the weekly pass does not fire either.
store['gstk_folder_full_'+CLIENT]=Date.now()-1000;
sandbox.GSTKdb={
  knownDocs:async()=>({noticePdf:{},openCases:[],knownCases:[ARN],
    itemDocs:{[ARN+'|NOTCS:'+REF]:[{label:'DOT_NOTICE_'+REF+'_20240528033335.pdf',url:'https://store/old/DOC_NOTICE.pdf'}]},
    drc03Pdf:{},refundDocs:{}}),
  uploadPdf:async(p)=>'https://store/'+p,
  ingest:async(c,r,step,rows)=>{seen.ingest.push({step,rows:JSON.parse(JSON.stringify(rows))});return{status:'ok',new:0,changed:1,removed:0}},
  patchNoticeFields:async(c,k,p)=>{seen.patch.push({k,p});return true},
  noticeDetails:async()=>1,logStep:async()=>null,logClientSync:async()=>null,logEvent(){},
  focusTab:async()=>true,backgroundTab:async()=>true,noticesNeedingDetail:async()=>[],
  fetchCrossOriginAsBase64:async()=>{throw new Error('n/a')},runSweep:async()=>null,runFinish:async()=>null,getClients:async()=>[],
};
sandbox.window=sandbox; sandbox.globalThis=sandbox; sandbox.self=sandbox;
vm.runInNewContext(src, vm.createContext(sandbox), {filename:'content.js',timeout:20000});
await new Promise(r=>setTimeout(r,2000));
let fail=0; const ok=(c,n)=>{console.log((c?'ok   ':'FAIL ')+n); if(!c)fail++};
const row=(seen.ingest.find(i=>i.step==='notices')||{rows:[]}).rows.find(r=>r.reference_number===REF);
ok(!!row,'row built');
if(row) console.log('   pdf_url =', row.pdf_url);
ok(row && row.pdf_url==='https://store/old/DOC_NOTICE.pdf','links the PDF already in the database');
ok(folderCalls===0,'and asks the portal for no case folder at all (calls: '+folderCalls+')');
console.log(fail?'\n'+fail+' FAILED':'\nall passed'); process.exit(fail?1:0);
