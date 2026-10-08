import {anyDateToIso, noticeFieldsFromItem, pickNoticeAttachment} from "./_helpers.mjs";
let fail=0; const eq=(a,b,n)=>{const A=JSON.stringify(a),B=JSON.stringify(b); if(A!==B){console.log('FAIL',n,'got',A,'want',B);fail++}else console.log('ok  ',n)};

eq(anyDateToIso('28/04/2024'),'2024-04-28','dd/mm/yyyy');
eq(anyDateToIso('28-04-2024'),'2024-04-28','dd-mm-yyyy');
eq(anyDateToIso('2024-04-28'),'2024-04-28','iso');
eq(anyDateToIso('28/04/2024 11:30:00'),'2024-04-28','dd/mm/yyyy with time');
eq(anyDateToIso('NA'),null,'junk date');
eq(anyDateToIso(''),null,'empty date');
eq(anyDateToIso('31/02/2024'),null,'rejects impossible day');
eq(anyDateToIso('00/00/0000'),null,'rejects zeros');
eq(anyDateToIso('15/13/2024'),null,'rejects month 13');
eq(anyDateToIso('29/02/2024'),'2024-02-29','accepts leap day');
eq(anyDateToIso('29/02/2023'),null,'rejects non-leap 29 Feb');
eq(anyDateToIso('01/01/1999'),null,'rejects pre-GST year');

// A DRC-01 notice folder item, shaped like the portal's DOT itemJson.
const drc01={crn:'ZD240524095047C', dueDt:'27/06/2024', issuedBy:'GHANSHYAM DAMODARBHAI PARMAR',
  designation:'State Tax Officer', secCd:'74', fy:'2019-20',
  docupdtl:[{id:'abc123', docName:'SHREEJIKRUPA SEC 74.pdf'}]};
eq(noticeFieldsFromItem(drc01),{due_date:'2024-06-27',issued_by:'GHANSHYAM DAMODARBHAI PARMAR, State Tax Officer',din:null},'DRC-01 item');

// DIN nested, officer under a different spelling, date under replyDueDt.
const nested={hdr:{DIN:'20240512ABC123'},off:{officerName:'A B SHAH',officerDesg:'Supt.'},rply:{replyDueDt:'05/07/2024'}};
eq(noticeFieldsFromItem(nested),{due_date:'2024-07-05',issued_by:'A B SHAH, Supt.',din:'20240512ABC123'},'nested + alt spellings');

// Placeholders must not win over a real value deeper in.
eq(noticeFieldsFromItem({issuedBy:'NA', inner:{officerName:'REAL OFFICER'}}).issued_by,'REAL OFFICER','skips NA officer');
eq(noticeFieldsFromItem({dueDt:'', inner:{dueDate:'01/01/2025'}}).due_date,'2025-01-01','skips empty date');
eq(noticeFieldsFromItem({din:'-'}).din,null,'rejects dash DIN');
eq(noticeFieldsFromItem({din:'123'}).din,null,'rejects too-short DIN');
eq(noticeFieldsFromItem(null),{},'null item');
eq(noticeFieldsFromItem('a string'),{},'string item');
// A self-referencing object must not hang the walk.
const cyc={a:{}}; cyc.a.back=cyc; cyc.a.dueDt='09/09/2024';
eq(noticeFieldsFromItem(cyc).due_date,'2024-09-09','cycle safe');

// Attachment picking.
const atts=[{label:'Doc1.pdf',url:'/s/x/aaa.pdf'},{label:'DOT_NOTICE_ZD240524095047C_20240528033335.pdf',url:'/s/x/bbb.pdf'}];
eq(pickNoticeAttachment(atts,'ZD240524095047C'),'/s/x/bbb.pdf','by reference number');
eq(pickNoticeAttachment(atts,'NOPE'),'/s/x/bbb.pdf','falls back to generated form name');
eq(pickNoticeAttachment([{label:'random.pdf',url:'/s/x/ccc.pdf'}],'R1'),'/s/x/ccc.pdf','falls back to first');
eq(pickNoticeAttachment([],'R1'),null,'no attachments');
eq(pickNoticeAttachment(null,'R1'),null,'null attachments');
eq(pickNoticeAttachment([{label:'a'},{label:'b',url:''}],'R1'),null,'attachments with no url');
eq(pickNoticeAttachment(atts,null),'/s/x/bbb.pdf','null ref still picks generated');

console.log(fail? '\n'+fail+' FAILED':'\nall passed');
process.exit(fail?1:0);
