import {runLinkPass} from "./_linkpass.mjs";
let fail=0; const eq=(a,b,n)=>{const A=JSON.stringify(a),B=JSON.stringify(b); if(A!==B){console.log('FAIL',n,'\n  got ',A,'\n  want',B);fail++}else console.log('ok  ',n)};
const WEEK=7*24*3600*1000;
const mkStore=()=>({saved:null, set(o){this.saved=o; return Promise.resolve()}});

// ---- Scenario 1: the exact case from the app — DRC-01 whose PDF sits in the
// case folder but was never linked ("PDF not captured yet").
{
  const rows=[{portal_key:'ZD240524095047C', reference_number:'ZD240524095047C',
    notice_type:'DRC-01', due_date:null, issued_by:null, pdf_url:null}];
  const detailByRef=new Map([['ZD240524095047C',{section:'NOTCS',
    attachments:[{label:'SHREEJIKRUPA LIMITE SEC 74.pdf',url:'/s/a.pdf'},
                 {label:'DOT_NOTICE_ZD240524095047C_20240528033335.pdf',url:'/s/b.pdf'}],
    raw:{crn:'ZD240524095047C', dueDt:'27/06/2024', issuedBy:'GHANSHYAM DAMODARBHAI PARMAR',
         designation:'State Tax Officer', din:'202405120ABCD1'}}]]);
  const store=mkStore();
  const r=await runLinkPass({rows, detailByRef, storedAttachByRef:new Map(), fillTried:{}, triedKey:'k', store, FULL_FOLDER_PASS_MS:WEEK});
  eq(rows[0].pdf_url,'/s/b.pdf','S1 notice PDF linked (picks the generated form)');
  eq(rows[0].due_date,'2024-06-27','S1 reply date filled');
  eq(rows[0].issued_by,'GHANSHYAM DAMODARBHAI PARMAR, State Tax Officer','S1 officer filled');
  eq(r.dinByKey,[{portal_key:'ZD240524095047C',din:'202405120ABCD1'}],'S1 DIN queued separately, not on the row');
  eq('din' in rows[0], false, 'S1 DIN never put on the notices row');
  eq([r.linkedPdf,r.linkedDue,r.linkedOfficer,r.linkedDin],[1,1,1,1],'S1 counters');
  eq('ZD240524095047C' in store.saved.k, false, 'S1 fully-filled ref not marked as tried');
}

// ---- Scenario 2: a notice synced before 0.8.0, folder NOT refetched. The
// attachments already in the database must be enough to link its PDF.
{
  const rows=[{portal_key:'ZD241124073627F', reference_number:'ZD241124073627F',
    due_date:'2024-12-27', issued_by:'X, STO', pdf_url:null}];
  const stored=new Map([['ZD241124073627F',[{label:'ADJDT_DRPRC_ZD241124073627F_20241127013428.pdf',url:'/s/old.pdf'}]]]);
  const store=mkStore();
  const r=await runLinkPass({rows, detailByRef:new Map(), storedAttachByRef:stored, fillTried:{}, triedKey:'k', store, FULL_FOLDER_PASS_MS:WEEK});
  eq(rows[0].pdf_url,'/s/old.pdf','S2 links from already-stored attachments, no download');
  eq(r.linkedPdf,1,'S2 counted');
}

// ---- Scenario 3: nothing is ever overwritten.
{
  const rows=[{portal_key:'R3', reference_number:'R3', due_date:'2024-01-01',
    issued_by:'PORTAL LIST OFFICER', pdf_url:'/s/already.pdf'}];
  const detailByRef=new Map([['R3',{attachments:[{label:'DOT_NOTICE_R3.pdf',url:'/s/other.pdf'}],
    raw:{dueDt:'31/12/2025', issuedBy:'FOLDER OFFICER'}}]]);
  const store=mkStore();
  const r=await runLinkPass({rows, detailByRef, storedAttachByRef:new Map(), fillTried:{}, triedKey:'k', store, FULL_FOLDER_PASS_MS:WEEK});
  eq([rows[0].pdf_url,rows[0].due_date,rows[0].issued_by],['/s/already.pdf','2024-01-01','PORTAL LIST OFFICER'],'S3 existing values untouched');
  eq([r.linkedPdf,r.linkedDue,r.linkedOfficer],[0,0,0],'S3 nothing counted as linked');
}

// ---- Scenario 4: a notice with no folder item is left alone and remembered,
// so its folder is not forced open again next run.
{
  const rows=[{portal_key:'R4', reference_number:'R4', due_date:null, issued_by:null, pdf_url:null}];
  const store=mkStore();
  const r=await runLinkPass({rows, detailByRef:new Map(), storedAttachByRef:new Map(), fillTried:{}, triedKey:'tk', store, FULL_FOLDER_PASS_MS:WEEK});
  eq(rows[0].pdf_url,null,'S4 untouched');
  eq(typeof store.saved.tk.R4,'number','S4 remembered as tried');
  eq([r.linkedPdf,r.linkedDue],[0,0],'S4 nothing linked');
}

// ---- Scenario 5: a ref remembered as tried, now filled -> the memo is cleared.
{
  const rows=[{portal_key:'R5', reference_number:'R5', due_date:null, issued_by:null, pdf_url:null}];
  const detailByRef=new Map([['R5',{attachments:[{label:'DOT_NOTICE_R5.pdf',url:'/s/r5.pdf'}],
    raw:{dueDt:'01/02/2025', issuedBy:'A B', designation:'STO'}}]]);
  const store=mkStore();
  await runLinkPass({rows, detailByRef, storedAttachByRef:new Map(), fillTried:{R5:Date.now()-1000}, triedKey:'tk', store, FULL_FOLDER_PASS_MS:WEEK});
  eq('R5' in store.saved.tk, false, 'S5 memo cleared once the notice is complete');
}

// ---- Scenario 6: rows with no reference number (a GSTR-3A hash key, a
// case-only task row) must be skipped without error.
{
  const rows=[{portal_key:'hash:abc', reference_number:null, due_date:null, issued_by:null, pdf_url:null},
              {portal_key:'case:AD1', reference_number:null, due_date:null, issued_by:null, pdf_url:null}];
  const store=mkStore();
  const r=await runLinkPass({rows, detailByRef:new Map(), storedAttachByRef:new Map(), fillTried:{}, triedKey:'tk', store, FULL_FOLDER_PASS_MS:WEEK});
  eq([r.linkedPdf,r.linkedDue,r.linkedOfficer,r.linkedDin],[0,0,0,0],'S6 refless rows skipped');
  eq(store.saved.tk,{}, 'S6 nothing remembered for refless rows');
}

// ---- Scenario 7: a garbage date in the folder must not reach the row.
{
  const rows=[{portal_key:'R7', reference_number:'R7', due_date:null, issued_by:null, pdf_url:null}];
  const detailByRef=new Map([['R7',{attachments:[],raw:{dueDt:'31/02/2024', issuedBy:'NA'}}]]);
  const store=mkStore();
  const r=await runLinkPass({rows, detailByRef, storedAttachByRef:new Map(), fillTried:{}, triedKey:'tk', store, FULL_FOLDER_PASS_MS:WEEK});
  eq(rows[0].due_date,null,'S7 impossible date rejected (Postgres would refuse the whole save)');
  eq(rows[0].issued_by,null,'S7 placeholder officer rejected');
}

// ---- Scenario 8: this run's folder detail wins over stale stored attachments.
{
  const rows=[{portal_key:'R8', reference_number:'R8', due_date:'2024-05-05', issued_by:'O', pdf_url:null}];
  const detailByRef=new Map([['R8',{attachments:[{label:'DOT_NOTICE_R8.pdf',url:'/s/fresh.pdf'}],raw:{}}]]);
  const stored=new Map([['R8',[{label:'old.pdf',url:'/s/stale.pdf'}]]]);
  const store=mkStore();
  await runLinkPass({rows, detailByRef, storedAttachByRef:stored, fillTried:{}, triedKey:'tk', store, FULL_FOLDER_PASS_MS:WEEK});
  eq(rows[0].pdf_url,'/s/fresh.pdf','S8 this run wins over stored');
}

// ---- Scenario 9: a failing store.set must not break the pass.
{
  const rows=[{portal_key:'R9', reference_number:'R9', due_date:null, issued_by:null, pdf_url:null}];
  const detailByRef=new Map([['R9',{attachments:[{label:'DOT_NOTICE_R9.pdf',url:'/s/r9.pdf'}],raw:{}}]]);
  const store={set(){return Promise.reject(new Error('quota'))}};
  const r=await runLinkPass({rows, detailByRef, storedAttachByRef:new Map(), fillTried:{}, triedKey:'tk', store, FULL_FOLDER_PASS_MS:WEEK});
  eq(rows[0].pdf_url,'/s/r9.pdf','S9 link survives a storage failure');
  eq(r.linkedPdf,1,'S9 counted');
}

console.log(fail? '\n'+fail+' FAILED':'\nall passed');
process.exit(fail?1:0);
