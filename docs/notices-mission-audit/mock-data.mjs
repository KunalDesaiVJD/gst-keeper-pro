// Fictional dataset for the Notices & Litigation audit capture.
// Every company, person, GSTIN/PAN, ARN and amount here is invented.
// "Today" is fixed at Monday 2026-10-05 11:15 IST (the capture fixes the
// browser clock to the same instant, so relative dates stay meaningful).
//
// Shapes follow what the app's own writers produce (extension/content.js,
// NoticeWorkflowListView, litigationData.ts, LitigationMatterDetailPage):
//   * get/notices rows: notice_type 'Notice' | 'Order', description = portal text
//   * case/task rows:   notice_type = titleCase(caseTypeName), case_id = case ARN
//   * notice_events written by the app carry actor_id but actor_name = null
//     (NoticeWorkflowListView passes `user?.name`, which AppUser does not have)
//   * no 'captured' events (nothing in the codebase writes them)

export const NOW_ISO = '2026-10-05T05:45:00.000Z'; // 11:15 IST
export const NOW_MS = Date.parse(NOW_ISO);
export const TODAY = '2026-10-05';
const SUPA = 'https://gcquafqxbykxkbexcdpy.supabase.co'; // never contacted — every request is answered by the mock

// ───────────────────────── helpers ─────────────────────────
const DAY = 86400000;
const pad = (n, w) => String(n).padStart(w, '0');
const uid = (prefix, n) => `${prefix}-0000-4000-8000-${pad(n, 12)}`;
export const d = (off) => new Date(Date.parse(TODAY + 'T00:00:00Z') + off * DAY).toISOString().slice(0, 10); // IST calendar date + off days
// IST wall-clock time on day `off` → ISO UTC string
export const ist = (off, hh = 10, mm = 0) => new Date(Date.parse(d(off) + 'T00:00:00Z') + (hh * 60 + mm - 330) * 60000).toISOString();
const hoursAgo = (h) => new Date(NOW_MS - h * 3600000).toISOString();
const ddmmyyyy = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const ddmmyyyyDash = (iso) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
const fyOf = (iso) => { const y = +iso.slice(0, 4), m = +iso.slice(5, 7); const s = m >= 4 ? y : y - 1; return `${s}-${String(s + 1).slice(2)}`; };

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// GSTIN check character (mod-36 Luhn variant used by GSTN)
const B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function gstinCheck(g14) {
  let sum = 0;
  for (let i = 0; i < 14; i++) { const p = B36.indexOf(g14[i]) * (i % 2 ? 2 : 1); sum += Math.floor(p / 36) + (p % 36); }
  return B36[(36 - (sum % 36)) % 36];
}
const gstin = (st, n) => { const g = `${st}AAAAA${pad(n, 4)}A1Z`; return g + gstinCheck(g); };

// ───────────────────────── staff ─────────────────────────
export const STAFF = {
  P: { id: '11111111-1111-4111-8111-000000000001', name: 'Partner Demo', email: 'partner.demo@example.com', role: 'superadmin' },
  M: { id: '11111111-1111-4111-8111-000000000002', name: 'Demo Manager', email: 'demo.manager@example.com', role: 'gst_manager' },
  A1: { id: '11111111-1111-4111-8111-000000000003', name: 'Associate One', email: 'associate.one@example.com', role: 'employee' },
  A2: { id: '11111111-1111-4111-8111-000000000004', name: 'Associate Two', email: 'associate.two@example.com', role: 'employee' },
};
export const LOGIN_USER = STAFF.P;

// ───────────────────────── clients ─────────────────────────
const CLIENT_DEFS = [
  // name, state code, city, gst user id, extra
  ['Demo Textiles Pvt Ltd', '24', 'Surat', 'demotex_gst01', {}],
  ['Sample Pharma LLP', '27', 'Pune', 'samplepharma.gst', {}],
  ['Example Foods Pvt Ltd', '29', 'Bengaluru', 'examplefoods_gst', {}],
  ['Test Engineering Works', '33', 'Coimbatore', 'testengg.gst', {}],
  ['Placeholder Logistics Pvt Ltd', '07', 'New Delhi', 'placeholderlog', {}],
  ['Mock Builders LLP', '24', 'Ahmedabad', 'mockbuilders.gst', { regular_sub_type: 'Builder' }],
  ['Fictional Exports Pvt Ltd', '27', 'Mumbai', 'fictexports_gst', {}],
  ['Specimen Chemicals Ltd', '24', 'Vadodara', 'specimenchem', {}],
  ['Dummy Retail Traders', '09', 'Lucknow', 'dummyretail09', { inactive_at_hand: true }],
  ['Illustrative Software Services Pvt Ltd', '36', 'Hyderabad', 'illusoft.gst', {}],
  ['Sandbox Auto Components Pvt Ltd', '06', 'Gurugram', 'sandboxauto', {}],
  ['Trial Hospitality LLP', '32', 'Kochi', null, { notices_sync_excluded: true }],
];
const STATE_NAMES = { '24': 'Gujarat', '27': 'Maharashtra', '29': 'Karnataka', '33': 'Tamil Nadu', '07': 'Delhi', '09': 'Uttar Pradesh', '36': 'Telangana', '06': 'Haryana', '32': 'Kerala' };

export function buildData() {
  const T = {};
  const rnd = mulberry32(20261005);

  const clients = CLIENT_DEFS.map(([name, st, city, user, extra], i) => ({
    id: uid('c1000000', i + 1),
    name,
    gstin: gstin(st, i + 1),
    client_user_id: `DEMO${pad(i + 1, 3)}`,
    registration_type: 'Regular',
    regular_sub_type: extra.regular_sub_type ?? null,
    registration_date: ['2017-07-01', '2018-03-12', '2017-07-01', '2019-11-04', '2020-02-17', '2021-06-30', '2017-07-01', '2017-09-25', '2018-08-08', '2022-01-10', '2019-04-01', '2023-05-15'][i],
    email: `accounts@${name.toLowerCase().replace(/[^a-z]+/g, '-').replace(/-(pvt-ltd|llp|ltd)?-?$/, '')}.example.com`,
    mobile: `90000000${pad(i + 1, 2)}`,
    gst_user_id: user,
    gst_password: user ? '(stored)' : null,
    client_password: null,
    inactive_at_hand: !!extra.inactive_at_hand,
    notices_sync_excluded: !!extra.notices_sync_excluded,
    is_first_login: false,
    liberal_2b_reconciliation: false,
    gstr1_import_mode: 'portal',
    selected_returns: ['GSTR-1', 'GSTR-3B'],
    assigned_accountant: null,
    builder_itc_type: null,
    cancellation_date: null,
    registration_cancellation_date: null,
    commercial_area: null,
    residential_area: null,
    target_date_group1: null,
    target_date_group2: null,
    created_at: '2025-04-01T04:30:00.000Z',
    created_by: STAFF.P.id,
    updated_at: '2026-09-01T04:30:00.000Z',
    _st: st, _city: city,
  }));
  const C = clients; // index 0..11
  T.clients = clients;

  T.profiles = Object.values(STAFF).map((s, i) => ({ id: uid('5f000000', i + 1), user_id: s.id, first_name: s.name, email: s.email, password: null, created_at: '2025-04-01T04:30:00.000Z', updated_at: '2026-06-01T04:30:00.000Z' }));
  T.user_roles = Object.values(STAFF).map((s, i) => ({ id: uid('5e000000', i + 1), user_id: s.id, role: s.role, is_first_login: false }));
  T.user_permissions = [
    { id: uid('5d000000', 1), user_id: STAFF.A1.id, permission_key: 'edit_notice_status', granted_at: '2026-09-15T04:30:00.000Z', granted_by: STAFF.P.id },
  ];

  // last successful 'notices' pull per client (drives gst_notices.pulled_at)
  // C5 was last pulled by a single-client Reports Hub "Pull" (that path never writes client_sync_log)
  const lastPull = [ist(0, 7, 42), ist(0, 7, 48), ist(-3, 18, 20), ist(-2, 19, 5), ist(-1, 12, 40), ist(-1, 18, 10), ist(0, 7, 55), ist(-2, 8, 30), ist(-19, 9, 15), ist(-1, 15, 5), ist(-6, 17, 45), ist(-20, 11, 0)];

  // ───────────── gst_notices ─────────────
  const notices = [];
  let nseq = 0;
  const refSeq = { ZD: 1200, ZA: 3400 };
  const noticeRef = (prefix, st, iso) => { refSeq[prefix] = (refSeq[prefix] || 1000) + 37; return `${prefix}${st}${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(2, 4)}${pad(refSeq[prefix] % 100000, 5)}`; };
  let arnSeq = 1;
  const caseArn = (st, iso, p = 'AD') => `${p}${st}${iso.slice(5, 7)}${iso.slice(2, 4)}${pad(52000 + 913 * arnSeq++, 7)}`;
  const pdfUrl = (cid, ref) => `${SUPA}/storage/v1/object/public/return-pdfs/notices/${cid}/${ref}.pdf`;

  const KIND = {
    ASMT10: { type: 'Notice', desc: 'Notice for intimating discrepancies in the return after scrutiny (ASMT-10)', by: 'Range-III, Division-II (Central Tax)', pfx: 'ZD' },
    DRC01B: { type: 'Notice', desc: 'Intimation of difference in liability reported in GSTR-1 and GSTR-3B (DRC-01B) – liability mismatch', by: 'System Generated', pfx: 'ZD' },
    DRC01C: { type: 'Notice', desc: 'Intimation of difference in ITC available in GSTR-2B and ITC availed in GSTR-3B (DRC-01C) – ITC mismatch', by: 'System Generated', pfx: 'ZD' },
    GSTR3A: { type: 'Notice', desc: 'Notice to return defaulter u/s 46 for not filing return (GSTR-3A)', by: 'System Generated', pfx: 'ZA' },
    REG03: { type: 'Notice', desc: 'Notice for seeking additional information / clarification / documents relating to application for amendment of registration (REG-03)', by: 'Ghatak 14, Surat (State Tax)', pfx: 'ZA' },
    REG17: { type: 'Notice', desc: 'Show cause notice for cancellation of registration (REG-17)', by: 'Ward 52, Zone 7 (State Tax)', pfx: 'ZA' },
    REG19: { type: 'Order', desc: 'Order for cancellation of registration (REG-19) – revoked on filing of pending returns', by: 'Ward 52, Zone 7 (State Tax)', pfx: 'ZA' },
    RFD08: { type: 'Notice', desc: 'Notice for rejection of application for refund (RFD-08)', by: 'Range-I, Refund Cell (Central Tax)', pfx: 'ZD' },
    ADT01: { type: 'Notice', desc: 'Intimation of audit under section 65 (ADT-01)', by: 'Audit Circle-4 (Central Tax)', pfx: 'ZD' },
    DRC07: { type: 'Order', desc: 'Summary of the order issued under section 73(9) (DRC-07)', by: 'Assistant Commissioner, Division-V', pfx: 'ZD' },
    DRC01A: { type: 'Notice', desc: 'Intimation of tax ascertained as being payable under section 73(5) (DRC-01A)', by: 'Superintendent, Range-II (Central Tax)', pfx: 'ZD' },
    ASMT12: { type: 'Order', desc: 'Order of acceptance of reply against the notice issued under section 61 (ASMT-12)', by: 'Range-III, Division-II (Central Tax)', pfx: 'ZD' },
    REMIND: { type: 'Notice', desc: 'Reminder for submission of reply to notice already issued', by: 'System Generated', pfx: 'ZD' },
    LUTORD: { type: 'Order', desc: 'Acknowledgement for Letter of Undertaking (RFD-11) – deemed accepted', by: 'System Generated', pfx: 'ZA' },
    // case / task rows (notice_type = titleCase(caseTypeName))
    CASE_DRC01: { type: 'Determination Of Tax', desc: 'Show Cause Notice under section 73 (DRC-01)', case: true },
    CASE_DRC01_74: { type: 'Determination Of Tax', desc: 'Show Cause Notice under section 74 (DRC-01) – availment of ITC on invoices without supply', case: true },
    CASE_LUT: { type: 'Letter Of Undertaking', desc: 'Furnishing of Letter of Undertaking (RFD-11) for export without payment of IGST', case: true },
    CASE_SCRUT: { type: 'Scrutiny Of Returns', desc: 'Scrutiny of returns under section 61 (ASMT-10)', case: true },
    CASE_REFUND: { type: 'Refunds', desc: 'Refund of accumulated ITC on export of goods/services without payment of tax', case: true },
    CASE_VP: { type: 'Voluntary Payment', desc: 'Voluntary payment through DRC-03 under section 73(5)', case: true },
    CASE_ENF: { type: 'Enforcement Case', desc: 'Inspection / search under section 67 – summons under section 70', case: true },
    CASE_RECT: { type: 'Rectification Of Orders', desc: 'Application for rectification of order under section 161', case: true },
    CASE_WAIVER: { type: 'Waiver Scheme U/S 128a', desc: 'Application for waiver of interest and penalty under section 128A (SPL-02)', case: true },
    CASE_AUDIT: { type: 'Audit', desc: 'Audit under section 65 – communication of discrepancies (ADT-01)', case: true },
    CASE_APPEAL: { type: 'Appeal', desc: 'Appeal to Appellate Authority (APL-01) against order in DRC-07', case: true },
  };

  // o: { c, k, issue, due, ext, st, pr, asg, asgText, reply, replyRef, orderDate, orderNo, subArn, subDate, amt, rem, fy, cr, pdf, firstSeen, case_id, matter, deleted, desc, by, ref }
  function N(o) {
    const id = uid('a1000000', ++nseq);
    const k = KIND[o.k];
    const c = C[o.c];
    const issue = d(o.issue);
    const isCase = !!k.case;
    const case_id = isCase ? (o.case_id || caseArn(c._st, issue, o.k === 'CASE_REFUND' ? 'AA' : 'AD')) : null;
    const ref = o.ref !== undefined ? o.ref : noticeRef(k.pfx || 'ZD', c._st, issue);
    const pulled = o.pulled || lastPull[o.c];
    const firstSeen = o.firstSeen || (Date.parse(issue) < Date.parse('2026-09-14') ? '2026-09-14T10:12:00.000Z' : new Date(Math.min(Date.parse(issue) + DAY + 3 * 3600000, Date.parse(pulled))).toISOString());
    const row = {
      id, client_id: c.id, source: 'notices',
      portal_key: ref || ('case:' + case_id),
      reference_number: ref, notice_type: k.type, description: o.desc || k.desc,
      issue_date: issue, due_date: o.due === undefined || o.due === null ? null : d(o.due), extended_due_date: o.ext === undefined ? null : d(o.ext),
      status: null, staff_status: o.st ?? null, priority: o.pr ?? null,
      assign_to: o.asg ? STAFF[o.asg].name : (o.asgText ?? null), assign_to_user_id: o.asg ? STAFF[o.asg].id : null,
      reply_date: o.reply === undefined ? null : d(o.reply), reply_ref_number: o.replyRef ?? null,
      order_date: o.orderDate === undefined ? null : d(o.orderDate), order_number: o.orderNo ?? null,
      submission_arn: o.subArn ?? null, submission_date: o.subDate === undefined ? null : d(o.subDate),
      amount_of_demand: o.amt ?? null, remarks: o.rem ?? null, issued_by: isCase ? null : (o.by || k.by || null),
      financial_year: o.fy ?? null, close_reason: o.cr ?? null,
      pdf_url: o.pdf === false || (isCase && !o.pdf) ? null : pdfUrl(c.id, ref || case_id),
      pulled_at: pulled, pulled_by: null, first_seen_at: firstSeen, last_seen_at: pulled,
      deleted_at: o.deleted ? hoursAgo(o.deleted) : null,
      case_id, matter_id: o.matter ?? null,
      created_at: firstSeen, updated_at: pulled,
    };
    notices.push(row);
    return row;
  }

  // ── matters (ids needed by notices) ──
  const MID = (n) => uid('9a000000', n);

  // ─── story rows: overdue (open, no reply, effective due < today) ───
  const S = {};
  S.c1_drc01b = N({ c: 0, k: 'DRC01B', issue: -20, due: -13, amt: 184500, pr: 'High', asg: 'A1', st: 'Awaiting data', fy: '2025-26', rem: 'Client to share GSTR-1 amendment workings for Jun–Aug 2025' });
  S.c2_asmt10 = N({ c: 1, k: 'ASMT10', issue: -45, due: -15, amt: 326400, pr: 'High', asg: 'A2', st: 'Reply drafted', fy: '2022-23', matter: MID(2) });
  S.c3_drc01c = N({ c: 2, k: 'DRC01C', issue: -12, due: -5, amt: 92300, pr: 'Medium', fy: '2025-26' });
  S.c4_gstr3a = N({ c: 3, k: 'GSTR3A', issue: -25, due: -10, desc: 'Notice to return defaulter u/s 46 for not filing return (GSTR-3A) – GSTR-3B for August 2026', fy: '2026-27' });
  S.c5_reg03 = N({ c: 4, k: 'REG03', issue: -14, due: -7, fy: '2026-27', pdf: false, by: 'Ward 12, Delhi (State Tax)' });
  S.c7_rfd08 = N({ c: 6, k: 'RFD08', issue: -18, due: -3, asg: 'A1', pr: 'Medium', st: 'Partner review', fy: '2025-26', amt: 1185000, matter: MID(7) });
  S.c8_drc01a = N({ c: 7, k: 'DRC01A', issue: -40, due: -10, amt: 1245000, pr: 'High', asg: 'A2', st: 'Awaiting data', fy: '2021-22', matter: MID(8), desc: 'Intimation of tax ascertained as being payable under section 74(5) (DRC-01A)' });
  S.c8_old_asmt = N({ c: 7, k: 'ASMT10', issue: -442, due: -412, fy: '2019-20' });
  S.c10_drc01b = N({ c: 9, k: 'DRC01B', issue: -60, due: -53, amt: 46800, st: 'Open', fy: '2025-26' });
  S.c11_adt01 = N({ c: 10, k: 'ADT01', issue: -35, due: -5, pr: 'Medium', asg: 'M', st: 'Awaiting data', fy: '2022-23', matter: MID(4) });
  S.c9_gstr3a = N({ c: 8, k: 'GSTR3A', issue: -150, due: -135, desc: 'Notice to return defaulter u/s 46 for not filing return (GSTR-3A) – GSTR-3B for April 2026', fy: '2026-27' });
  S.c6_drc01c = N({ c: 5, k: 'DRC01C', issue: -9, due: -2, amt: 15400, fy: '2025-26', matter: MID(6) });
  S.c2_gstr3a = N({ c: 1, k: 'GSTR3A', issue: -30, due: -15, desc: 'Notice to return defaulter u/s 46 for not filing return (GSTR-3A) – GSTR-1 for July 2026', fy: '2026-27' });
  S.c12_drc01b = N({ c: 11, k: 'DRC01B', issue: -28, due: -21, amt: 61200, fy: '2025-26' }); // client excluded from sync, still counted
  // overdue per drill-down only: extended / replied / due today
  S.c3_asmt_ext = N({ c: 2, k: 'ASMT10', issue: -50, due: -20, ext: 6, asg: 'A2', st: 'Awaiting data', fy: '2022-23', amt: 512000, rem: 'Extension of 26 days granted by Range officer vide letter dated 25/09/2026' });
  S.c7_drc01b_replied = N({ c: 6, k: 'DRC01B', issue: -30, due: -23, reply: -24, replyRef: 'RPL/FEPL/0925', st: 'Filed', asg: 'A1', fy: '2025-26', amt: 0, subArn: 'AD270926' + '0071234', subDate: -24 });
  S.c4_drc01c_today = N({ c: 3, k: 'DRC01C', issue: -7, due: 0, amt: 38900, pr: 'High', asg: 'A1', st: 'Reply drafted', fy: '2025-26' });

  // ─── due in next 7 days ───
  S.c1_case_drc01 = N({ c: 0, k: 'CASE_DRC01', issue: -26, due: 4, amt: 1860000, pr: 'High', asg: 'A1', st: 'Reply drafted', fy: '2021-22', matter: MID(1), ref: noticeRef('ZD', '24', d(-26)), desc: 'Show Cause Notice under section 73 for FY 2021-22 (DRC-01) – ITC availed on invoices of suppliers whose registration was cancelled' });
  S.c2_gstr3a_due1 = N({ c: 1, k: 'GSTR3A', issue: -14, due: 1, desc: 'Notice to return defaulter u/s 46 for not filing return (GSTR-3A) – GSTR-3B for August 2026', fy: '2026-27' });
  S.c5_reg17 = N({ c: 4, k: 'REG17', issue: -2, due: 5, pr: 'High', asg: 'M', st: 'Hearing', fy: '2026-27', matter: MID(5), by: 'Ward 12, Delhi (State Tax)' });
  S.c3_case_appeal = N({ c: 2, k: 'CASE_APPEAL', issue: -80, due: 6, amt: 4424000, pr: 'High', asg: 'M', st: 'Appeal', fy: '2020-21', matter: MID(3), ref: noticeRef('ZD', '29', d(-80)), subArn: 'AD2907260098765', subDate: -80, desc: 'Appeal to Appellate Authority (APL-01) against order in DRC-07 dated 10/07/2026' });
  S.c6_asmt10 = N({ c: 5, k: 'ASMT10', issue: -24, due: 2, asg: 'A2', st: 'Partner review', fy: '2023-24', amt: 274000 });
  S.c11_case_audit = N({ c: 10, k: 'CASE_AUDIT', issue: -20, due: 3, asg: 'M', st: 'Awaiting data', fy: '2022-23', matter: MID(4), ref: noticeRef('ZD', '06', d(-20)) });
  S.c8_drc01a_due5 = N({ c: 7, k: 'DRC01A', issue: -25, due: 5, amt: 856000, fy: '2022-23' });

  // ─── new since last sync (first_seen within 24 h) ───
  S.new_c1_asmt = N({ c: 0, k: 'ASMT10', issue: -1, due: 29, fy: '2023-24', firstSeen: hoursAgo(3.5) });
  S.new_c2_drc01b = N({ c: 1, k: 'DRC01B', issue: -2, due: 5, amt: 67200, fy: '2025-26', firstSeen: hoursAgo(3.4) });
  S.new_c7_order = N({ c: 6, k: 'LUTORD', issue: -1, fy: '2026-27', firstSeen: hoursAgo(3.3), st: null });
  S.new_c7_gstr3a = N({ c: 6, k: 'GSTR3A', issue: 0, due: 14, desc: 'Notice to return defaulter u/s 46 for not filing return (GSTR-3A) – GSTR-1 for August 2026', fy: '2026-27', firstSeen: hoursAgo(3.3) });
  S.new_c10_drc01c = N({ c: 9, k: 'DRC01C', issue: -1, due: 6, amt: 27300, fy: '2025-26', firstSeen: ist(-1, 15, 5) });
  S.new_c3_lut = N({ c: 2, k: 'CASE_LUT', issue: -1, fy: '2026-27', firstSeen: hoursAgo(14), ref: null, desc: 'Furnishing of Letter of Undertaking (RFD-11) for FY 2026-27' });

  // ─── other open rows (no due / hearing / enforcement / waiver / misc) ───
  S.c8_case_enf = N({ c: 7, k: 'CASE_ENF', issue: -95, st: 'Hearing', asg: 'P', pr: 'High', fy: '2023-24', ref: noticeRef('ZD', '24', d(-95)) });
  S.c3_case_rect = N({ c: 2, k: 'CASE_RECT', issue: -33, fy: '2020-21', ref: null });
  S.c5_case_waiver = N({ c: 4, k: 'CASE_WAIVER', issue: -70, fy: '2019-20', ref: null, asgText: 'Associate Two' });
  S.c2_case_scrut = N({ c: 1, k: 'CASE_SCRUT', issue: -64, fy: '2022-23', st: 'Filed', asg: 'A2', reply: -36, replyRef: 'ASMT-11/SPL/0826', subArn: 'AD2708260045678', subDate: -36, ref: noticeRef('ZD', '27', d(-64)) });
  S.c2_case_refund_open = N({ c: 1, k: 'CASE_REFUND', issue: -22, fy: '2025-26', ref: null });
  S.c11_case_vp = N({ c: 10, k: 'CASE_VP', issue: -48, fy: '2023-24', ref: noticeRef('ZD', '06', d(-48)) });
  S.c1_case_vp = N({ c: 0, k: 'CASE_VP', issue: -130, fy: '2021-22', ref: noticeRef('ZD', '24', d(-130)) });
  S.c4_case_vp_x = N({ c: 3, k: 'CASE_VP', issue: -15, fy: '2025-26', ref: noticeRef('ZD', '33', d(-15)) });
  S.c8_case_drc01_order = N({ c: 7, k: 'CASE_DRC01_74', issue: -120, due: -90, reply: -92, replyRef: 'DRC-06/SCL/0626', orderDate: -25, orderNo: 'ZD2410092600213', st: 'Order', pr: 'High', asg: 'P', amt: 28500000, fy: '2019-20', matter: MID(8), ref: noticeRef('ZD', '24', d(-120)) });
  S.c1_remind = N({ c: 0, k: 'REMIND', issue: -6, fy: '2021-22', matter: MID(1), desc: 'Reminder for submission of reply to show cause notice (DRC-01) already issued' });
  S.c11_reg03_open = N({ c: 10, k: 'REG03', issue: -3, due: 4, asgText: 'Associate One', fy: '2026-27', by: 'Ward 3, Gurugram (State Tax)', desc: 'Notice for seeking additional information / clarification / documents relating to application for registration of additional place of business (REG-03)' });

  // ─── closed rows (manual + auto + other terminal statuses) ───
  S.c4_case_drc01_closed = N({ c: 3, k: 'CASE_DRC01', issue: -150, fy: '2020-21', st: 'Closed', cr: 'auto:closure', ref: noticeRef('ZD', '33', d(-150)), reply: -132, replyRef: 'DRC-01A-B/TEW/0526' });
  S.c7_case_refund_closed = N({ c: 6, k: 'CASE_REFUND', issue: -66, fy: '2025-26', st: 'Closed', cr: 'auto:refund_order', ref: null });
  S.c10_case_refund_closed = N({ c: 9, k: 'CASE_REFUND', issue: -180, fy: '2024-25', st: 'Closed', cr: 'auto:refund_order', ref: null });
  S.c1_case_lut = N({ c: 0, k: 'CASE_LUT', issue: -185, fy: '2026-27', st: 'Closed', cr: 'auto:lut_approval', ref: noticeRef('ZA', '24', d(-185)) });
  S.c2_case_lut = N({ c: 1, k: 'CASE_LUT', issue: -182, fy: '2026-27', st: 'Closed', cr: 'auto:lut_approval', ref: noticeRef('ZA', '27', d(-182)) });
  S.c7_case_lut = N({ c: 6, k: 'CASE_LUT', issue: -186, fy: '2026-27', st: 'Closed', cr: 'auto:lut_approval', ref: noticeRef('ZA', '27', d(-186)) });
  S.c10_case_lut = N({ c: 9, k: 'CASE_LUT', issue: -179, fy: '2026-27', st: 'Closed', cr: 'auto:lut_approval', ref: noticeRef('ZA', '36', d(-179)) });
  S.c6_case_scrut_closed = N({ c: 5, k: 'CASE_SCRUT', issue: -210, fy: '2021-22', st: 'Closed', cr: 'ASMT-12 issued – reply accepted', asg: 'A2', reply: -185, replyRef: 'ASMT-11/MBL/0326', ref: noticeRef('ZD', '24', d(-210)) });
  S.c3_drc07_adjudged = N({ c: 2, k: 'DRC07', issue: -87, orderDate: -87, orderNo: 'ZD2910072600877', st: 'Adjudged', amt: 4424000, fy: '2020-21', matter: MID(3), asg: 'M' });
  S.c9_gstr3a_closed = N({ c: 8, k: 'GSTR3A', issue: -300, due: -285, st: 'Closed', cr: 'Return filed with late fee', fy: '2025-26', matter: MID(9), reply: -290, desc: 'Notice to return defaulter u/s 46 for not filing return (GSTR-3A) – GSTR-3B for October 2025' });
  S.c10_case_vp_closed = N({ c: 9, k: 'CASE_VP', issue: -100, fy: '2023-24', st: 'Closed', cr: 'DRC-03 acknowledged', matter: MID(10), ref: noticeRef('ZD', '36', d(-100)) });
  S.c5_reg17_withdrawn = N({ c: 4, k: 'REG17', issue: -240, due: -233, st: 'Withdrawn', reply: -236, replyRef: 'REG-18/PLPL/0226', fy: '2025-26', by: 'Ward 12, Delhi (State Tax)' });
  S.c2_drc01a_dropped = N({ c: 1, k: 'DRC01A', issue: -260, due: -230, st: 'Dropped', reply: -240, amt: 141000, fy: '2020-21' });
  S.c11_asmt12 = N({ c: 10, k: 'ASMT12', issue: -120, st: 'Closed', fy: '2021-22', asg: 'M' });

  // soft-deleted rows (must never show up anywhere)
  N({ c: 0, k: 'DRC01C', issue: -90, due: -83, amt: 22000, fy: '2025-26', deleted: 72 });
  N({ c: 6, k: 'GSTR3A', issue: -200, due: -185, fy: '2025-26', deleted: 300 });

  // ─── filler: older history, mostly closed ───
  const fillKinds = ['DRC01B', 'DRC01B', 'DRC01C', 'DRC01C', 'DRC01C', 'GSTR3A', 'GSTR3A', 'GSTR3A', 'GSTR3A', 'ASMT10', 'ASMT10', 'REG03', 'REG03', 'REG17', 'REG19', 'RFD08', 'DRC07', 'DRC01A', 'ASMT12', 'ASMT12', 'REMIND', 'LUTORD', 'LUTORD'];
  const closeReasons = [null, null, null, 'Reply filed – no further communication', 'Return filed', 'Duplicate of portal notice', 'Liability paid via DRC-03', null];
  const fillerClients = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0, 1, 2, 6, 7];
  for (let i = 0; i < 86; i++) {
    const k = fillKinds[Math.floor(rnd() * fillKinds.length)];
    const c = fillerClients[Math.floor(rnd() * fillerClients.length)];
    const issue = -(60 + Math.floor(rnd() * 560));
    const hasDue = !['REG19', 'DRC07', 'ASMT12', 'LUTORD'].includes(k) && rnd() < 0.85;
    const dueOff = hasDue ? issue + (k === 'GSTR3A' || k === 'RFD08' ? 15 : k.startsWith('DRC01B') || k.startsWith('DRC01C') || k.startsWith('REG') ? 7 : 30) : null;
    const r = rnd();
    let st = 'Closed', cr = closeReasons[Math.floor(rnd() * closeReasons.length)], reply;
    if (r < 0.08) { st = 'Disposed'; cr = null; }
    else if (r < 0.13) { st = 'Withdrawn'; cr = null; }
    if (['GSTR3A', 'DRC01B', 'DRC01C', 'ASMT10', 'REG03', 'REG17', 'RFD08', 'DRC01A'].includes(k) && rnd() < 0.6 && dueOff !== null) reply = dueOff - 1 - Math.floor(rnd() * 5);
    // a handful stay open without a due date (portal gave none) — these feed "need closing"
    let open = false;
    if (i % 9 === 4) { st = null; cr = null; open = true; }
    const amt = ['DRC01B', 'DRC01C', 'DRC07', 'DRC01A', 'ASMT10'].includes(k) ? Math.round((5000 + rnd() * 900000) / 100) * 100 : null;
    N({
      c, k, issue, due: open ? null : dueOff, st, cr: open ? null : cr, reply: open ? undefined : reply,
      replyRef: reply !== undefined && !open ? `RPL/${pad(i + 1, 3)}/${d(reply).slice(2, 4)}` : undefined,
      amt, fy: fyOf(d(issue)), pr: rnd() < 0.2 ? ['Low', 'Medium', 'High'][Math.floor(rnd() * 3)] : null,
      asg: rnd() < 0.3 ? ['M', 'A1', 'A2'][Math.floor(rnd() * 3)] : undefined,
      pdf: rnd() < 0.15 ? false : undefined,
      orderDate: k === 'DRC07' || k === 'ASMT12' ? issue : undefined,
      desc: k === 'GSTR3A' ? `Notice to return defaulter u/s 46 for not filing return (GSTR-3A) – ${['GSTR-1', 'GSTR-3B'][i % 2]} for ${new Date(Date.parse(d(issue)) - 20 * DAY).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}` : undefined,
    });
  }
  T.gst_notices = notices;

  // ───────────── case folder items ─────────────
  const items = [];
  let fiSeq = 0;
  const att = (cid, label) => [{ label, url: `${SUPA}/storage/v1/object/public/return-pdfs/case-folder/${cid}/${label.replace(/\s+/g, '_')}.pdf` }];
  function FI(n, section, ref, raw, label, opts = {}) {
    const pulled = n.pulled_at;
    items.push({
      id: uid('b1000000', ++fiSeq), client_id: n.client_id, case_id: opts.case_id || n.case_id, folder_section: section,
      reference_number: ref, attachments: label ? att(n.client_id, label) : [], raw_json: raw,
      portal_key: `${section}:${ref || 'x' + fiSeq}`, pulled_at: pulled, first_seen_at: n.first_seen_at, last_seen_at: pulled, deleted_at: null,
    });
  }
  const officer = { dg: 'Superintendent', nm: 'Range Officer (Demo)' };
  // C1 DRC-01 (open, reply drafted): INTIM → REPLY (Part B) → NOTCE
  {
    const n = S.c1_case_drc01;
    FI(n, 'INTIM', 'ZD2407082600411', { refdt: ddmmyyyy(d(-88)), duedt: ddmmyyyy(d(-58)), arndt: ddmmyyyy(d(-88)), sdtls: { dtscn: { type: 'Intimation of tax ascertained as being payable under section 73(5) (DRC-01A)', sec: '73(5)', replyDuedt: ddmmyyyy(d(-58)) } }, todtls: officer }, 'DRC-01A Intimation');
    FI(n, 'REPLY', 'ZD2408082600612', { reply: { replyty: 'Reply to intimation in Part B of DRC-01A', ntcno: 'ZD2407082600411', intdt: ddmmyyyy(d(-88)), pershrng: 'N', decdtls: { asnm: 'Authorised Signatory (Demo)', dt: ddmmyyyy(d(-60)) } } }, 'DRC-01A Part B Reply');
    FI(n, 'NOTCE', n.reference_number, { refdt: ddmmyyyy(d(-26)), sdtls: { dtscn: { type: 'Show Cause Notice (DRC-01)', duedt: ddmmyyyy(d(4)), pershrng: 'Yes – ' + ddmmyyyy(d(9)), sec: '73', fy: '2021-22', facts: 'ITC of ₹ 12,40,000 availed on invoices of suppliers whose registration stood cancelled retrospectively' } }, todtls: { dg: 'Assistant Commissioner', nm: 'Adjudicating Officer (Demo)' } }, 'DRC-01 SCN');
  }
  // C8 DRC-01 s.74 (order received): INTIM → NOTCE → REPLY → ORDRS
  {
    const n = S.c8_case_drc01_order;
    FI(n, 'INTIM', 'ZD2404052600118', { refdt: ddmmyyyy(d(-160)), duedt: ddmmyyyy(d(-130)), sdtls: { dtscn: { type: 'Intimation of tax ascertained as being payable under section 74(5) (DRC-01A)', sec: '74(5)' } }, todtls: officer }, 'DRC-01A Intimation');
    FI(n, 'NOTCE', n.reference_number, { refdt: ddmmyyyy(d(-120)), sdtls: { dtscn: { type: 'Show Cause Notice (DRC-01)', duedt: ddmmyyyy(d(-90)), pershrng: 'Yes', sec: '74', fy: '2019-20', facts: 'Availment of ITC on invoices issued without underlying supply of goods' } }, todtls: { dg: 'Joint Commissioner', nm: 'Adjudicating Officer (Demo)' } }, 'DRC-01 SCN');
    FI(n, 'REPLY', 'ZD2407062600955', { reply: { replyty: 'Reply to Show Cause Notice (DRC-06)', ntcno: n.reference_number, ntcdt: ddmmyyyy(d(-120)), pershrng: 'Y', decdtls: { asnm: 'Authorised Signatory (Demo)', dt: ddmmyyyy(d(-92)) } } }, 'DRC-06 Reply');
    FI(n, 'ORDRS', 'ZD2410092600213', { refdt: ddmmyyyy(d(-25)), sdtls: { dtorder: { type: 'Order under section 74(9) (DRC-07)' } }, todtls: { nm: 'Adjudicating Officer (Demo)' } }, 'DRC-07 Order');
  }
  // C4 DRC-01 closed via CLSR
  {
    const n = S.c4_case_drc01_closed;
    FI(n, 'INTIM', 'ZD3305052600771', { refdt: ddmmyyyy(d(-150)), duedt: ddmmyyyy(d(-120)), sdtls: { dtscn: { type: 'Intimation of tax ascertained as being payable under section 73(5) (DRC-01A)', sec: '73(5)' } }, todtls: officer }, 'DRC-01A Intimation');
    FI(n, 'REPLY', 'ZD3305232600802', { reply: { replyty: 'Reply to intimation in Part B of DRC-01A', ntcno: null, intdt: ddmmyyyy(d(-150)), pershrng: 'N', decdtls: { asnm: 'Authorised Signatory (Demo)', dt: ddmmyyyy(d(-132)) } } }, 'Part B Reply');
    FI(n, 'CLSR', 'ZD3306182600914', { refdt: ddmmyyyy(d(-110)), sdtls: { type: 'Acceptance of response to DRC-01A (DRC-01A Part C)' }, todtls: { nm: 'Superintendent (Demo)' } }, 'Acceptance Order');
  }
  // C7 refund case (closed by order): APLCN → NOTAC (RFD-02) → NOTAC (RFD-08) → REPLY (RFD-09) → ORDRS (RFD-06)
  {
    const n = S.c7_case_refund_closed;
    FI(n, 'APLCN', n.case_id, { applnAckNum: n.case_id, rfdSubDt: ddmmyyyy(d(-66)) + ' 20:51:30', refundRsn: 'Export of services without payment of tax (accumulated ITC)', formNo: 'GST RFD-01' }, 'GST RFD-01');
    FI(n, 'NOTAC', 'ZA270826' + '0004411', { refdt: ddmmyyyyDash(d(-60)), sdtls: { tynotice: 'GST RFD-02 – Acknowledgement' } }, 'RFD-02');
    FI(n, 'NOTAC', 'ZA270826' + '0004532', { refdt: ddmmyyyyDash(d(-45)), sdtls: { tynotice: 'GST RFD-08 – Notice for rejection of application for refund', rsnnoticeother: 'Shipping bills for Feb–Mar 2026 not matched with ICEGATE data', duedate: ddmmyyyy(d(-30)) } }, 'RFD-08');
    FI(n, 'REPLY', 'ZA270926' + '0004610', { tyreply: 'GST RFD-09 – Reply to show cause notice', ntcno: 'ZA2708260004532', replydt: ddmmyyyyDash(d(-35)), sigfn: 'Authorised', sigln: 'Signatory (Demo)' }, 'RFD-09');
    FI(n, 'ORDRS', 'ZA270926' + '0004777', { refdt: ddmmyyyyDash(d(-20)), sdtls: { sancordervo: { ordertype: 'GST RFD-06 – Refund Sanction Order' } }, todtls: { nm: 'Refund Officer (Demo)' } }, 'RFD-06');
  }
  // C2 refund case (open): APLCN + RFD-02
  {
    const n = S.c2_case_refund_open;
    FI(n, 'APLCN', n.case_id, { applnAckNum: n.case_id, rfdSubDt: ddmmyyyy(d(-22)) + ' 11:05:12', refundRsn: 'Refund on account of inverted tax structure', formNo: 'GST RFD-01' }, 'GST RFD-01');
    FI(n, 'NOTAC', 'ZA270926' + '0005120', { refdt: ddmmyyyyDash(d(-15)), sdtls: { tynotice: 'GST RFD-02 – Acknowledgement' } }, 'RFD-02');
  }
  // C10 refund (closed, older)
  {
    const n = S.c10_case_refund_closed;
    FI(n, 'APLCN', n.case_id, { applnAckNum: n.case_id, rfdSubDt: ddmmyyyy(d(-180)) + ' 16:40:02', refundRsn: 'Excess balance in electronic cash ledger', formNo: 'GST RFD-01' }, 'GST RFD-01');
    FI(n, 'ORDRS', 'ZA360426' + '0001903', { refdt: ddmmyyyyDash(d(-150)), sdtls: { payadviceordervo: { ordertype: 'GST RFD-05 – Payment Advice' } }, todtls: { nm: 'Refund Officer (Demo)' } }, 'RFD-05');
  }
  // LUT cases — acknowledgement order (deemed accepted)
  for (const key of ['c1_case_lut', 'c2_case_lut', 'c7_case_lut', 'c10_case_lut']) {
    const n = S[key];
    FI(n, 'ORDRS', n.reference_number, { refdt: ddmmyyyy(d(-178)), sdtls: { dtorder: { type: 'Acknowledgement of Letter of Undertaking (RFD-11) – deemed accepted' } }, todtls: { nm: 'System Generated' } }, 'RFD-11 Acknowledgement');
  }
  // C2 scrutiny (filed): NOTCE ASMT-10 + REPLY ASMT-11
  {
    const n = S.c2_case_scrut;
    FI(n, 'NOTCE', n.reference_number, { refdt: ddmmyyyy(d(-64)), sdtls: { dtscn: { type: 'Notice for intimating discrepancies in the return after scrutiny (ASMT-10)', duedt: ddmmyyyy(d(-34)), pershrng: 'No', sec: '61', fy: '2022-23', reason: 'Mismatch between ITC in GSTR-3B and GSTR-2A for FY 2022-23' } }, todtls: { dg: 'Superintendent', nm: 'Proper Officer (Demo)' } }, 'ASMT-10');
    FI(n, 'REPLY', 'ZD2708262200178', { reply: { replyty: 'Reply to the notice for scrutiny of returns (ASMT-11)', ntcno: n.reference_number, ntcdt: ddmmyyyy(d(-64)), pershrng: 'N', decdtls: { asnm: 'Authorised Signatory (Demo)', dt: ddmmyyyy(d(-36)) } } }, 'ASMT-11');
  }
  // C6 scrutiny closed: NOTCE + REPLY + ORDRS (ASMT-12)
  {
    const n = S.c6_case_scrut_closed;
    FI(n, 'NOTCE', n.reference_number, { refdt: ddmmyyyy(d(-210)), sdtls: { dtscn: { type: 'Notice for intimating discrepancies in the return after scrutiny (ASMT-10)', duedt: ddmmyyyy(d(-180)), sec: '61', fy: '2021-22', reason: 'Turnover mismatch GSTR-1 vs GSTR-3B' } }, todtls: officer }, 'ASMT-10');
    FI(n, 'REPLY', 'ZD2403262600066', { reply: { replyty: 'Reply to the notice for scrutiny of returns (ASMT-11)', ntcno: n.reference_number, ntcdt: ddmmyyyy(d(-210)), pershrng: 'N', decdtls: { asnm: 'Authorised Signatory (Demo)', dt: ddmmyyyy(d(-185)) } } }, 'ASMT-11');
    FI(n, 'ORDRS', 'ZD2405262600101', { refdt: ddmmyyyy(d(-150)), sdtls: { dtorder: { type: 'Order of acceptance of reply (ASMT-12)' } }, todtls: { nm: 'Proper Officer (Demo)' } }, 'ASMT-12');
  }
  // C3 appeal — APLCN (APL-01) makes the page treat it as a refund case
  {
    const n = S.c3_case_appeal;
    FI(n, 'APLCN', 'AD2907260098765', { applnAckNum: 'AD2907260098765', arndt: ddmmyyyy(d(-80)), formNo: 'GST APL-01', disputedTax: 2800000, predeposit: 280000 }, 'APL-01 Memorandum');
    FI(n, 'NOTCE', 'ZD2909262600345', { refdt: ddmmyyyy(d(-20)), sdtls: { dtscn: { type: 'Notice for personal hearing in appeal', duedt: ddmmyyyy(d(16)), pershrng: ddmmyyyy(d(16)) + ' 10:30', sec: '107', fy: '2020-21' } }, todtls: { dg: 'Appellate Authority', nm: 'Commissioner (Appeals) (Demo)' } }, 'Hearing Notice');
  }
  // C8 enforcement — NOTCE + DRC7A (section the page has no layout for → generic field dump)
  {
    const n = S.c8_case_enf;
    FI(n, 'NOTCE', n.reference_number, { refdt: ddmmyyyy(d(-95)), sdtls: { srscn: { type: 'Summons under section 70 to give evidence / produce documents', duedt: ddmmyyyy(d(-80)), sec: '70', fy: '2023-24' } }, todtls: { dg: 'Senior Intelligence Officer', nm: 'Enforcement Officer (Demo)' } }, 'Summons');
    FI(n, 'DRC7A', 'ZD2409262600999', { refdt: ddmmyyyy(d(-30)), demandId: 'DM2409260001234', taxPeriod: 'Apr 2023 – Mar 2024', sdtls: { dmdtype: 'Pre-GST / Recovery demand', amount: '1,12,400', status: 'Outstanding' }, todtls: { nm: 'Recovery Officer (Demo)' } }, 'DRC-07A Summary');
  }
  // C11 audit — INTIM ADT-01
  {
    const n = S.c11_case_audit;
    FI(n, 'INTIM', n.reference_number, { refdt: ddmmyyyy(d(-20)), duedt: ddmmyyyy(d(3)), sdtls: { dtscn: { type: 'Intimation of audit under section 65 (ADT-01)', sec: '65', replyDuedt: ddmmyyyy(d(3)) } }, todtls: { dg: 'Audit Circle-4', nm: 'Audit Officer (Demo)' } }, 'ADT-01');
  }
  // C10 VP closed — ORDRS acknowledgement (DRC-04)
  {
    const n = S.c10_case_vp_closed;
    FI(n, 'ORDRS', 'ZD3606262600044', { refdt: ddmmyyyy(d(-98)), sdtls: { dtorder: { type: 'Acknowledgement of acceptance of payment made voluntarily (DRC-04)' } }, todtls: { nm: 'Proper Officer (Demo)' } }, 'DRC-04');
  }
  T.gst_case_folder_items = items;

  // ───────────── refunds (dedicated table) ─────────────
  const refunds = [];
  const RF = (c, filed, type, claimed, sanctioned, status, opts = {}) => {
    const cl = C[c];
    const arn = opts.arn || caseArn(cl._st, d(filed), 'AA');
    const docs = opts.docs === false ? [] : [{ tab: 'Applications', label: 'GST RFD-01', url: `${SUPA}/storage/v1/object/public/return-pdfs/refunds/${cl.id}/${arn}_RFD-01.pdf` }];
    if (opts.order) docs.push({ tab: 'Orders', label: opts.order, url: `${SUPA}/storage/v1/object/public/return-pdfs/refunds/${cl.id}/${arn}_${opts.order}.pdf` });
    refunds.push({ id: uid('f1000000', refunds.length + 1), client_id: cl.id, arn, portal_key: arn, refund_type: type, source_ledger: /ITC/.test(type) ? 'ITC' : null, filed_date: d(filed), claimed_amount: claimed, sanctioned_amount: sanctioned, status, documents: docs, pulled_at: lastPull[c], pulled_by: null, first_seen_at: '2026-09-14T10:12:00.000Z', last_seen_at: lastPull[c], deleted_at: null, created_at: '2026-09-14T10:12:00.000Z', updated_at: lastPull[c] });
    return arn;
  };
  // share ARNs with the case rows above (dedupe evidence)
  RF(6, -66, 'Export of services without payment of tax (accumulated ITC)', 1840000, 1735000, 'Refund Sanctioned', { arn: S.c7_case_refund_closed.case_id, order: 'RFD-06' });
  RF(1, -22, 'Refund on account of inverted tax structure (ITC)', 642000, null, 'Acknowledgement Issued', { arn: S.c2_case_refund_open.case_id });
  RF(6, -150, 'Export of goods without payment of tax (accumulated ITC)', 2210000, 2210000, 'Refund Disbursed', { order: 'RFD-06' });
  RF(6, -240, 'Export of goods without payment of tax (accumulated ITC)', 1975000, 1890000, 'Refund Disbursed', { order: 'RFD-06' });
  RF(6, -18, 'Export of services without payment of tax (accumulated ITC)', 1185000, null, 'Show Cause Notice Issued (RFD-08)');
  RF(0, -40, 'Excess balance in electronic cash ledger', 86500, null, 'Refund Application Filed', { docs: false });
  RF(0, -310, 'Excess payment of tax', 48200, 48200, 'Refund Disbursed', { order: 'RFD-05' });
  RF(2, -95, 'Supplies to SEZ unit/developer without payment of tax (accumulated ITC)', 734000, 0, 'Refund Rejected', { order: 'RFD-06' });
  RF(2, -12, 'Supplies to SEZ unit/developer without payment of tax (accumulated ITC)', 512000, null, 'Deficiency Memo Issued (RFD-03)');
  RF(3, -200, 'On account of assessment/provisional assessment/appeal/any other order', 156000, 156000, 'Re-credit of ITC', { order: 'PMT-03' });
  RF(4, -75, 'Excess balance in electronic cash ledger', 23500, null, 'Withdrawn');
  RF(5, -55, 'Refund on account of inverted tax structure (ITC)', 381000, 342900, 'Provisional Refund Order Issued (RFD-04)', { order: 'RFD-04' });
  RF(7, -130, 'Export of goods with payment of tax', 4120000, 4120000, 'Refund Disbursed', { order: 'RFD-05' });
  RF(7, -8, 'Export of goods with payment of tax', 2760000, null, 'Refund Application Filed');
  RF(9, -90, 'Export of services without payment of tax (accumulated ITC)', 958000, 958000, 'Refund Sanctioned', { order: 'RFD-06' });
  RF(9, -35, 'Export of services without payment of tax (accumulated ITC)', 1012000, null, 'Acknowledgement Issued');
  RF(10, -160, 'Excess payment of tax', 71400, 71400, 'Refund Disbursed', { order: 'RFD-05' });
  RF(1, -280, 'Refund on account of inverted tax structure (ITC)', 598000, 552000, 'Refund Disbursed', { order: 'RFD-06' });
  RF(8, -400, 'Excess balance in electronic cash ledger', 12800, null, 'Refund Application Filed', { docs: false });
  RF(11, -60, 'Excess payment of tax', 34600, null, 'Acknowledgement Issued');
  T.gst_refund_applications = refunds;

  // ───────────── DRC-03 filings ─────────────
  const drc = [];
  const DR = (c, filed, cause, section, fy, igst, cgst, sgst, interest, penalty, status, opts = {}) => {
    const cl = C[c];
    const arn = opts.arn || caseArn(cl._st, d(filed), 'AD');
    const cess = opts.cess || 0, late = opts.late || 0;
    const total = igst + cgst + sgst + cess + interest + penalty + late;
    const credit = opts.credit ? Math.min(total, opts.credit) : 0;
    drc.push({ id: uid('d1000000', drc.length + 1), client_id: cl.id, arn, portal_key: arn, cause_of_payment: cause, section, financial_year: fy, filed_date: d(filed), period_from: opts.from || `${fy.slice(0, 4)}-04-01`, period_to: opts.to || `20${fy.slice(5, 7)}-03-31`, taxable_value: opts.tv ?? null, igst_amount: igst, cgst_amount: cgst, sgst_amount: sgst, cess_amount: cess, interest_amount: interest, late_fee_amount: late, penalty_amount: penalty, cash_amount: total - credit, credit_amount: credit, status, pdf_url: opts.pdf === false ? null : `${SUPA}/storage/v1/object/public/return-pdfs/drc03/${cl.id}/${arn}.pdf`, pulled_at: lastPull[c], pulled_by: null, first_seen_at: '2026-09-14T10:12:00.000Z', last_seen_at: lastPull[c], deleted_at: null, created_at: '2026-09-14T10:12:00.000Z', updated_at: lastPull[c] });
    return arn;
  };
  DR(9, -100, 'Voluntary', 'Section 73(5)', '2023-24', 0, 171000, 171000, 41040, 0, 'Acknowledged', { arn: S.c10_case_vp_closed.case_id, tv: 1900000 });
  DR(10, -48, 'SCN', 'Section 73(5)', '2023-24', 64800, 0, 0, 11920, 0, 'Pending for Action by Tax Officer', { arn: S.c11_case_vp.case_id });
  DR(0, -150, 'Audit', 'Section 73(5)', '2021-22', 0, 62000, 62000, 18440, 0, 'Acknowledged', { credit: 50000 });
  DR(0, -365, 'Annual Return', 'Others', '2022-23', 12400, 0, 0, 1870, 0, 'Acknowledged');
  DR(1, -45, 'Intimation of tax ascertained through form GST DRC-01A', 'Section 73(5)', '2020-21', 0, 70500, 70500, 33500, 0, 'Acknowledged');
  DR(1, -210, 'Liability mismatch – GSTR-1 to GSTR-3B', 'Others', '2024-25', 18300, 4100, 4100, 2210, 0, 'Acknowledged');
  DR(2, -80, 'Others', 'Section 107(6) pre-deposit', '2020-21', 280000, 0, 0, 0, 0, 'Acknowledged', { credit: 0 });
  DR(2, -400, 'Voluntary', 'Section 73(5)', '2019-20', 0, 15500, 15500, 9020, 0, 'Acknowledged');
  DR(3, -20, 'Voluntary', 'Section 73(5)', '2025-26', 0, 9800, 9800, 640, 0, 'Pending for Action by Tax Officer');
  DR(3, -230, 'Annual Return', 'Others', '2023-24', 0, 22600, 22600, 4100, 0, 'Acknowledged');
  DR(4, -70, 'Others', 'Others', '2024-25', 0, 0, 0, 0, 0, 'Acknowledged', { late: 10000 });
  DR(5, -130, 'Voluntary', 'Section 73(5)', '2022-23', 0, 48000, 48000, 21900, 0, 'Acknowledged');
  DR(5, -5, 'Intimation of tax ascertained through form GST DRC-01A', 'Section 73(5)', '2023-24', 0, 7700, 7700, 1950, 0, 'Pending for Action by Tax Officer');
  DR(6, -55, 'Voluntary', 'Section 73(5)', '2024-25', 22000, 0, 0, 3960, 0, 'Acknowledged');
  DR(6, -300, 'Audit', 'Section 73(5)', '2021-22', 41000, 0, 0, 17220, 0, 'Acknowledged');
  DR(7, -90, 'SCN', 'Section 74(5)', '2019-20', 0, 560000, 560000, 0, 168000, 'Acknowledged', { credit: 400000 });
  DR(7, -260, 'Voluntary', 'Section 73(5)', '2022-23', 0, 30400, 30400, 9800, 0, 'Acknowledged');
  DR(8, -320, 'Annual Return', 'Others', '2023-24', 0, 4100, 4100, 980, 0, 'Acknowledged');
  DR(9, -25, 'Liability mismatch – GSTR-1 to GSTR-3B', 'Others', '2025-26', 46800, 0, 0, 2100, 0, 'Pending for Action by Tax Officer');
  DR(9, -220, 'Voluntary', 'Section 73(5)', '2022-23', 0, 19000, 19000, 7300, 0, 'Acknowledged');
  DR(10, -140, 'Audit', 'Section 73(5)', '2022-23', 0, 33300, 33300, 12650, 0, 'Acknowledged');
  DR(10, -12, 'Voluntary', 'Section 73(5)', '2025-26', 8900, 0, 0, 210, 0, 'Submitted');
  DR(11, -95, 'Voluntary', 'Section 73(5)', '2024-25', 0, 5600, 5600, 1340, 0, 'Acknowledged');
  DR(0, -9, 'Voluntary', 'Section 73(5)', '2025-26', 0, 62000, 62000, 3300, 0, 'Pending for Action by Tax Officer', { arn: 'AD2409260071122' });
  DR(2, -600, 'Others', 'Others', '2018-19', 9100, 0, 0, 0, 0, 'Acknowledged', { pdf: false });
  T.gst_drc03_filings = drc;

  // ───────────── litigation ─────────────
  const matters = [];
  const M = (n, o) => { matters.push({
    id: MID(n), client_id: C[o.c].id, matter_no: o.no, lifecycle: o.lc, title: o.title, section_of_law: o.sec ?? null,
    financial_years: o.fys ?? null, authority: o.auth ?? 'CGST', officer: o.officer ?? null, jurisdiction: o.jur ?? null,
    stage: o.stage, status: o.status ?? 'Open', priority: o.pr ?? 'Medium', owner_user_id: o.owner ? STAFF[o.owner].id : null,
    reviewer_user_id: o.rev ? STAFF[o.rev].id : null,
    demand_tax: o.tax ?? 0, demand_interest: o.int ?? 0, demand_penalty: o.pen ?? 0, demand_cess: 0,
    paid_total: o.paid ?? 0, pre_deposit_total: o.pre ?? 0,
    computed_due_date: o.due === undefined ? null : d(o.due), override_due_date: o.odue === undefined ? null : d(o.odue),
    limitation_date: o.lim === undefined ? null : d(o.lim), hearing_at: o.hearing ?? null, next_action: o.next ?? null,
    closed_at: o.closedAt ?? null, closed_reason: o.closedReason ?? null,
    created_at: o.created, updated_at: o.updated ?? o.created,
  }); };
  M(1, { c: 0, no: 'M-2026-0001', lc: 'demand', title: 'DRC-01 SCN u/s 73 — FY 2021-22 ITC on cancelled suppliers', sec: 's.73', fys: ['2021-22'], officer: 'Assistant Commissioner, Division-II', jur: 'Surat CGST Commissionerate', stage: 'Reply drafting', pr: 'High', owner: 'A1', rev: 'P', tax: 1240000, int: 496000, pen: 124000, paid: 124000, due: 4, hearing: ist(9, 10, 30), next: 'Partner to review draft DRC-06 reply; file by 09/10', created: ist(-88, 12, 10), updated: ist(-1, 16, 40) });
  M(2, { c: 1, no: 'M-2026-0002', lc: 'scrutiny', title: 'ASMT-10 scrutiny — FY 2022-23 ITC mismatch (2A vs 3B)', sec: 's.61', fys: ['2022-23'], auth: 'SGST', officer: 'State Tax Officer, Pune-12', stage: 'Awaiting client data', pr: 'Medium', owner: 'A2', tax: 248000, int: 68400, pen: 10000, due: -15, next: 'Await vendor-wise 2A reconciliation from client', created: ist(-44, 11, 0), updated: ist(-6, 15, 5) });
  M(3, { c: 2, no: 'M-2026-0003', lc: 'appeal', title: 'First appeal against DRC-07 — FY 2020-21 (s.73 order)', sec: 's.107', fys: ['2020-21'], officer: 'Commissioner (Appeals)', jur: 'Bengaluru Appeals-II', stage: 'Appeal filed', pr: 'High', owner: 'M', rev: 'P', tax: 2800000, int: 1344000, pen: 280000, pre: 280000, lim: 46, hearing: ist(16, 10, 30), next: 'Prepare paper book for personal hearing', created: ist(-86, 10, 0), updated: ist(-20, 13, 0) });
  M(4, { c: 10, no: 'M-2026-0004', lc: 'audit', title: 'Departmental audit u/s 65 — FY 2022-23', sec: 's.65', fys: ['2022-23'], officer: 'Audit Circle-4', stage: 'Hearing', pr: 'Medium', owner: 'M', tax: 386000, int: 92000, due: 3, hearing: ist(2, 11, 0), created: ist(-34, 9, 30), updated: ist(-3, 18, 0) });
  M(5, { c: 4, no: 'M-2026-0005', lc: 'registration', title: 'REG-17 SCN — proposed cancellation of registration', sec: 's.29(2)', auth: 'SGST', officer: 'Ward 12, Delhi', stage: 'Filed/submitted', pr: 'High', owner: 'M', due: 5, hearing: ist(3, 15, 0), next: 'Attend PH with return filing proof', created: ist(-2, 12, 0), updated: ist(-1, 10, 0) });
  M(6, { c: 5, no: 'M-2026-0006', lc: 'demand', title: 'DRC-01C ITC mismatch — FY 2025-26 (Jun 2026)', sec: 'Rule 88D', stage: 'Triage', pr: 'Medium', tax: 15400, created: ist(-8, 16, 0) });
  M(7, { c: 6, no: 'M-2026-0007', lc: 'refund', title: 'RFD-08 SCN on export refund claim (Jul–Aug 2026)', sec: 's.54 r/w Rule 92(3)', officer: 'Refund Cell, Range-I', stage: 'Partner review', pr: 'Medium', owner: 'A1', rev: 'P', tax: 1185000, due: 1, created: ist(-17, 10, 0), updated: ist(-2, 17, 30) });
  M(8, { c: 7, no: 'M-2025-0012', lc: 'demand', title: 'DRC-01 u/s 74 — FY 2019-20 ITC without supply (order received)', sec: 's.74', fys: ['2019-20'], officer: 'Joint Commissioner, Vadodara-I', stage: 'Order received', pr: 'High', owner: 'P', rev: 'P', tax: 11200000, int: 6100000, pen: 11200000, paid: 0, lim: 66, next: 'Decide on first appeal; arrange 10% pre-deposit', created: '2025-12-02T06:00:00.000Z', updated: ist(-25, 18, 0) });
  M(9, { c: 8, no: 'M-2025-0009', lc: 'non_filer', title: 'GSTR-3A non-filer — Oct 2025', sec: 's.46', stage: 'Closed', status: 'Closed', pr: 'Low', owner: 'A2', tax: 18500, int: 2140, paid: 20640, closedAt: ist(-280, 12, 0), closedReason: 'paid', created: ist(-300, 10, 0), updated: ist(-280, 12, 0) });
  M(10, { c: 9, no: 'M-2026-0008', lc: 'voluntary_payment', title: 'DRC-03 voluntary payment against ASMT-10 — FY 2023-24', sec: 's.73(5)', stage: 'Closed', status: 'Closed', pr: 'Low', owner: 'A1', tax: 342000, int: 41040, paid: 383040, closedAt: ist(-95, 11, 0), closedReason: 'paid', created: ist(-104, 10, 0), updated: ist(-95, 11, 0) });
  // created through the "Create Matter" dialog, which writes status 'open' (lower-case)
  M(11, { c: 3, no: 'M-2026-0009', lc: 'enforcement', title: 'Inspection follow-up — stock verification at Coimbatore unit', stage: 'Captured', status: 'open', pr: 'Medium', owner: 'P', created: ist(-4, 15, 20) });
  T.litigation_matters = matters;

  const hearings = [];
  const H = (m, at, o = {}) => hearings.push({ id: uid('9b000000', hearings.length + 1), matter_id: MID(m), scheduled_at: at, mode: o.mode || 'physical', venue: o.venue ?? null, officer: o.officer ?? null, attended_by: o.att ? o.att.map((k) => STAFF[k].id) : null, outcome: o.outcome ?? null, adjourned: !!o.adj, next_date: o.next ?? null, notes: o.notes ?? null, created_at: o.created || at });
  H(1, ist(-13, 11, 0), { venue: 'Room 204, CGST Bhavan, Surat', officer: 'Assistant Commissioner', att: ['A1'], outcome: 'Adjourned', adj: true, next: ist(9, 10, 30), notes: 'Officer sought vendor-wise ledger; adjourned at our request', created: ist(-30, 10, 0) });
  H(1, ist(9, 10, 30), { venue: 'Room 204, CGST Bhavan, Surat', officer: 'Assistant Commissioner', created: ist(-13, 16, 0) });
  H(3, ist(-50, 10, 30), { mode: 'video', venue: 'Video conference', officer: 'Commissioner (Appeals)', att: ['M', 'P'], outcome: 'Part heard', notes: 'Written submissions to be filed within 15 days', created: ist(-70, 10, 0) });
  H(3, ist(16, 10, 30), { mode: 'video', venue: 'Video conference', officer: 'Commissioner (Appeals)', created: ist(-20, 13, 0) });
  H(4, ist(2, 11, 0), { mode: 'video', venue: 'Video conference', officer: 'Audit Officer', created: ist(-3, 18, 0) });
  H(5, ist(3, 15, 0), { venue: 'Ward 12, Vikas Bhawan (demo address)', officer: 'State Tax Officer', created: ist(-1, 10, 0) });
  H(8, ist(-45, 12, 0), { venue: 'Joint Commissioner chamber, Vadodara', officer: 'Joint Commissioner', att: ['P'], outcome: 'Order reserved', created: ist(-60, 12, 0) });
  T.matter_hearings = hearings;

  const payments = [];
  const PY = (m, kind, o) => payments.push({ id: uid('9c000000', payments.length + 1), matter_id: MID(m), kind, drc03_arn: o.arn ?? null, tax: o.tax ?? 0, interest: o.int ?? 0, penalty: o.pen ?? 0, cess: 0, paid_on: o.on ? d(o.on) : null, remarks: o.rem ?? null, created_at: ist(o.on ?? -1, 17, 0) });
  PY(1, 'voluntary', { tax: 124000, on: -9, arn: 'AD2409260071122', rem: 'Partial admission — ITC on 3 vendors reversed via DRC-03' });
  PY(3, 'pre_deposit', { tax: 280000, on: -80, arn: drc.find((r) => r.section === 'Section 107(6) pre-deposit').arn, rem: '10% mandatory pre-deposit u/s 107(6)' });
  PY(9, 'voluntary', { tax: 18500, int: 2140, on: -282, rem: 'Paid with GSTR-3B' });
  PY(10, 'voluntary', { tax: 342000, int: 41040, on: -100, arn: S.c10_case_vp_closed.case_id, rem: 'DRC-03 acknowledged in DRC-04' });
  T.matter_payments = payments;

  const docs = [];
  const DOC = (m, title, kind, source, created) => docs.push({ id: uid('9d000000', docs.length + 1), matter_id: MID(m), notice_id: null, kind, title, storage_path: null, mime: 'application/pdf', size_bytes: 180000 + docs.length * 7331, source, uploaded_by: STAFF.A1.id, created_at: created });
  DOC(1, 'DRC-01A intimation (Part A)', 'notice', 'portal', ist(-88, 12, 20));
  DOC(1, 'DRC-01 Show Cause Notice', 'notice', 'portal', ist(-26, 9, 0));
  DOC(1, 'Purchase register FY 2021-22 (vendor-wise)', 'evidence', 'client', ist(-10, 14, 0));
  DOC(1, 'Draft reply DRC-06 v2', 'reply', 'manual', ist(-1, 16, 30));
  DOC(2, 'ASMT-10 notice', 'notice', 'portal', ist(-44, 11, 10));
  DOC(3, 'DRC-07 summary of order', 'order', 'portal', ist(-86, 10, 10));
  DOC(3, 'APL-01 appeal memorandum', 'appeal', 'manual', ist(-80, 18, 0));
  DOC(3, 'Pre-deposit DRC-03 acknowledgement', 'evidence', 'portal', ist(-80, 18, 30));
  DOC(4, 'ADT-01 intimation', 'notice', 'portal', ist(-34, 9, 40));
  DOC(5, 'REG-17 show cause notice', 'notice', 'portal', ist(-2, 12, 5));
  DOC(5, 'REG-18 reply with return filing proof', 'submission', 'manual', ist(-1, 9, 50));
  DOC(7, 'RFD-08 notice', 'notice', 'portal', ist(-17, 10, 10));
  DOC(8, 'DRC-07 order u/s 74(9)', 'order', 'department', ist(-25, 18, 0));
  DOC(8, 'Hearing notes — 21/08', 'hearing_notes', 'manual', ist(-45, 16, 0));
  T.matter_documents = docs;

  const sh = [];
  const SH = (m, from, to, at, by, note) => sh.push({ id: uid('9e000000', sh.length + 1), matter_id: MID(m), from_stage: from, to_stage: to, changed_by: by ? STAFF[by].id : null, changed_at: at, note: note ?? null });
  SH(1, 'Captured', 'Triage', ist(-87, 10, 0), 'M'); SH(1, 'Triage', 'Awaiting client data', ist(-80, 11, 0), 'A1', 'Requested purchase register'); SH(1, 'Awaiting client data', 'Reply drafting', ist(-8, 15, 0), 'A1');
  SH(2, 'Captured', 'Awaiting client data', ist(-40, 10, 0), 'A2');
  SH(3, 'Order received', 'Appeal decision', ist(-85, 10, 0), 'P', 'Appeal on merits'); SH(3, 'Appeal decision', 'Appeal filed', ist(-80, 18, 10), 'M');
  SH(4, 'Captured', 'Triage', ist(-33, 10, 0), 'M'); SH(4, 'Triage', 'Hearing', ist(-3, 18, 0), 'M');
  SH(5, 'Captured', 'Reply drafting', ist(-2, 13, 0), 'M'); SH(5, 'Reply drafting', 'Filed/submitted', ist(-1, 10, 0), 'M');
  SH(7, 'Triage', 'Reply drafting', ist(-12, 10, 0), 'A1'); SH(7, 'Reply drafting', 'Partner review', ist(-2, 17, 30), 'A1');
  SH(8, 'Hearing', 'Order received', ist(-25, 18, 0), 'P');
  SH(9, 'Triage', 'Closed', ist(-280, 12, 0), 'A2', 'Return filed with late fee');
  SH(10, 'Filed/submitted', 'Closed', ist(-95, 11, 0), 'A1', 'DRC-04 received');
  T.matter_stage_history = sh;

  const mev = [];
  const ME = (m, type, actor, at, payload, noticeId = null) => mev.push({ id: uid('9f000000', mev.length + 1), matter_id: MID(m), notice_id: noticeId, event_type: type, actor_user_id: actor ? STAFF[actor].id : null, actor_name: actor ? STAFF[actor].name : null, payload, created_at: at });
  ME(1, 'created', null, ist(-88, 12, 10), { matter_no: 'M-2026-0001', lifecycle: 'demand', stage: 'Captured' });
  ME(1, 'notices_linked', null, ist(-26, 9, 5), { notice_ids: [S.c1_case_drc01.id], count: 1 });
  ME(1, 'hearing_outcome', 'A1', ist(-13, 14, 0), { outcome: 'Adjourned', adjourned: true });
  ME(1, 'payment_added', 'A1', ist(-9, 17, 0), { kind: 'voluntary', amount: 124000 });
  ME(1, 'stage_changed', 'A1', ist(-8, 15, 0), { from: 'Awaiting client data', to: 'Reply drafting', note: null });
  ME(1, 'document_added', 'A1', hoursAgo(18.8), { title: 'Draft reply DRC-06 v2', kind: 'reply' });
  ME(4, 'hearing_scheduled', 'M', hoursAgo(65), { date: ist(2, 11, 0), mode: 'video' });
  ME(4, 'stage_changed', 'M', hoursAgo(65), { from: 'Triage', to: 'Hearing', note: null });
  ME(5, 'stage_changed', 'M', hoursAgo(25), { from: 'Reply drafting', to: 'Filed/submitted', note: null });
  ME(7, 'stage_changed', 'A1', hoursAgo(41.75), { from: 'Reply drafting', to: 'Partner review', note: null });
  ME(7, 'reviewer_assigned', 'A1', hoursAgo(41.7), { reviewer: 'Partner Demo' });
  ME(3, 'hearing_scheduled', 'M', ist(-20, 13, 0), { date: ist(16, 10, 30), mode: 'video' });
  ME(8, 'stage_changed', 'P', ist(-25, 18, 0), { from: 'Hearing', to: 'Order received', note: null });
  ME(2, 'priority_changed', 'A2', hoursAgo(5.2), { priority: 'Medium' });
  ME(11, 'created', null, ist(-4, 15, 20), { matter_no: 'M-2026-0009', lifecycle: 'enforcement', stage: 'Captured' });
  ME(10, 'closed', 'A1', ist(-95, 11, 0), { reason: 'paid' });
  ME(9, 'closed', 'A2', ist(-280, 12, 0), { reason: 'paid' });
  T.matter_events = mev;

  // statutory deadlines (keyed to notices)
  const dls = [];
  const DL = (n, type, off, basis, met, notes) => dls.push({ id: uid('9a100000', dls.length + 1), notice_id: n.id, client_id: n.client_id, deadline_type: type, deadline_date: d(off), statutory_basis: basis, source: 'computed', is_met: !!met, met_at: met ? ist(typeof met === 'number' ? met : off - 1, 17, 0) : null, met_by: met ? 'Associate One' : null, notes: notes ?? null, created_at: n.first_seen_at, updated_at: n.first_seen_at });
  DL(S.c1_case_drc01, 'Reply to SCN (DRC-06)', 4, 's.73(8) r/w Rule 142(4) — 30 days from SCN');
  DL(S.c1_case_drc01, 'Reduced-penalty payment window', 4, 's.73(8) — tax + interest within 30 days of SCN', false, 'Penalty waived if paid with interest in window');
  DL(S.c1_case_drc01, 'Personal hearing', 9, 's.75(4)');
  DL(S.c1_case_drc01, 'DRC-01A Part B reply', -58, 'Rule 142(1A)', true);
  DL(S.c3_drc07_adjudged, 'First appeal (APL-01) limitation', -87 + 92, 's.107(1) — 3 months from order', -80, 'APL-01 filed 17/07/2026'); // met on 17/07/2026
  DL(S.c3_case_appeal, 'Personal hearing (appeal)', 16, 's.107(8)');
  DL(S.c2_asmt10, 'Reply to ASMT-10 (ASMT-11)', -15, 'Rule 99(2) — 30 days');
  DL(S.c8_drc01a, 'Reply to DRC-01A (Part B)', -10, 'Rule 142(1A)');
  DL(S.c7_rfd08, 'Reply in RFD-09', -3, 'Rule 92(3) — 15 days');
  DL(S.c5_reg17, 'Reply to REG-17 (REG-18)', 5, 'Rule 22(1) — 7 working days');
  DL(S.c8_case_drc01_order, 'First appeal (APL-01) limitation', 66, 's.107(1) — 3 months from order');
  DL(S.c8_case_drc01_order, 'Condonable appeal window ends', 96, 's.107(4) — further 1 month');
  DL(S.c11_case_audit, 'Reply to audit intimation', 3, 'Rule 101(4)');
  DL(S.c4_drc01c_today, 'Reply in DRC-01C Part B', 0, 'Rule 88D(2) — 7 days');
  T.matter_deadlines = dls;

  // litigation_rules seeded by the migration (subset)
  T.litigation_rules = [
    ['reply_days.drc01', 30, 'days', 'DRC-01 SCN reply period (s.73/74)'], ['reply_days.asmt10', 30, 'days', 'ASMT-10 scrutiny notice reply'], ['reply_days.drc01b', 7, 'days', 'DRC-01B ITC mismatch (Rule 88C)'], ['reply_days.drc01c', 7, 'days', 'DRC-01C 2B vs 3B mismatch (Rule 88D)'], ['reply_days.rfd08', 15, 'days', 'RFD-08 refund SCN reply'], ['appeal_months.s107', 3, 'months', 'First appeal u/s 107 — 3 months from order'], ['predeposit_pct.s107', 10, 'percent', 'Pre-deposit for first appeal — 10% of disputed tax'],
  ].map(([key, value, unit, note]) => ({ key, value, unit, note, effective_from: null, created_at: '2026-09-14T10:00:00.000Z' }));

  // ───────────── notice events (as the app's own writers would leave them) ─────────────
  const ev = [];
  const EV = (n, type, actor, at, oldV, newV, actorName) => ev.push({ id: uid('e1000000', ev.length + 1), notice_id: n.id, client_id: n.client_id, event_type: type, old_value: oldV ?? null, new_value: newV ?? null, actor_id: actor ? STAFF[actor].id : null, actor_name: actorName ?? null, created_at: at });
  EV(S.c4_drc01c_today, 'status_changed', 'A1', hoursAgo(2.1), { staff_status: '' }, { staff_status: 'Reply drafted' });
  EV(S.c2_asmt10, 'status_changed', 'A2', hoursAgo(5.1), { staff_status: 'Awaiting data' }, { staff_status: 'Reply drafted' });
  EV(S.c7_drc01b_replied, 'reply_logged', 'A1', hoursAgo(26), null, { reply_date: d(-24), reply_ref_number: 'RPL/FEPL/0925' });
  EV(S.c7_drc01b_replied, 'status_changed', 'A1', hoursAgo(26), { staff_status: 'Reply drafted' }, { staff_status: 'Filed' });
  EV(S.c11_asmt12, 'closed', 'M', hoursAgo(30), { staff_status: '' }, { staff_status: 'Closed', close_reason: null });
  EV(S.c1_drc01b, 'status_changed', 'A1', hoursAgo(50), { staff_status: '' }, { staff_status: 'Awaiting data' });
  EV(S.c5_reg17_withdrawn, 'closed', 'M', ist(-230, 12, 0), { staff_status: 'Open' }, { staff_status: 'Withdrawn', close_reason: null });
  EV(S.c2_drc01a_dropped, 'closed', 'P', ist(-225, 12, 0), { staff_status: '' }, { staff_status: 'Dropped', close_reason: null });
  EV(S.c10_drc01b, 'status_changed', 'P', ist(-50, 12, 0), { staff_status: '' }, { staff_status: 'Open' });
  EV(S.c8_case_drc01_order, 'order_logged', 'P', ist(-24, 10, 0), null, { order_date: d(-25), order_number: 'ZD2410092600213' });
  EV(S.c8_case_drc01_order, 'reply_logged', 'P', ist(-91, 10, 0), null, { reply_date: d(-92), reply_ref_number: 'DRC-06/SCL/0626' });
  EV(S.c3_drc07_adjudged, 'closed', 'M', ist(-80, 18, 30), { staff_status: '' }, { staff_status: 'Adjudged', close_reason: null });
  EV(S.c1_case_drc01, 'status_changed', 'A1', ist(-8, 15, 5), { staff_status: 'Awaiting data' }, { staff_status: 'Reply drafted' });
  EV(S.c6_case_scrut_closed, 'closed', 'A2', ist(-149, 11, 0), { staff_status: 'Filed' }, { staff_status: 'Closed', close_reason: 'ASMT-12 issued – reply accepted' });
  EV(S.c2_case_scrut, 'reply_logged', 'A2', ist(-36, 18, 0), null, { reply_date: d(-36), reply_ref_number: 'ASMT-11/SPL/0826' });
  // the seeded auto:* closures — as runAutoClose() would log them
  for (const key of ['c4_case_drc01_closed', 'c7_case_refund_closed', 'c10_case_refund_closed', 'c1_case_lut', 'c2_case_lut', 'c7_case_lut', 'c10_case_lut']) {
    EV(S[key], 'closed', null, '2026-09-30T05:10:00.000Z', { staff_status: null }, { staff_status: 'Closed', close_reason: S[key].close_reason }, 'Auto-close sweep');
  }
  EV(S.c9_gstr3a_closed, 'reply_logged', 'A2', ist(-290, 12, 0), null, { reply_date: d(-290), reply_ref_number: null });
  ev.sort((a, b) => b.created_at.localeCompare(a.created_at));
  T.notice_events = ev;

  // ───────────── alerts: rules, templates (as seeded by migration), outbox, log ─────────────
  const RULES = [
    ['E1_new_notice', 'New notice captured', 'Immediate alert when sync captures a new notice', 'captured', null, 'notice_new', 'team', 'critical', false, null, null],
    ['E2_overdue_digest', 'Daily overdue digest', 'Morning digest of all overdue notices', null, '0 4 * * *', 'notice_overdue_digest', 'team', 'normal', true, 1, 24],
    ['E3_due_in_7', 'Due in 7 days warning', 'Alert when a notice becomes due within 7 days', null, '0 4 * * *', 'notice_due_soon', 'assignee', 'normal', true, 1, 168],
    ['E4_hearing_reminder', 'Hearing date reminder', 'Reminder 7 days and 1 day before a hearing', null, '0 4 * * *', 'notice_hearing', 'assignee', 'critical', false, 2, 24],
    ['E5_limitation_alert', 'Limitation period warning', 'Appeal/tribunal deadline approaching (T-30, T-7)', null, '0 4 * * *', 'notice_limitation', 'partner', 'critical', false, 2, 168],
    ['E6_assigned', 'Notice assigned to you', 'Alert when a notice is assigned to a staff member', 'assigned', null, 'notice_assigned', 'assignee', 'normal', true, null, null],
    ['E7_status_changed', 'Status changed', 'Alert when notice status changes', 'status_changed', null, 'notice_status', 'team', 'low', true, null, null],
    ['E8_reply_logged', 'Reply logged', 'Confirmation when a reply is logged on a notice', 'reply_logged', null, 'notice_reply', 'assignee', 'normal', true, null, null],
    ['E9_sync_anomaly', 'Sync anomaly detected', 'Alert when sync detects unusual patterns', null, null, 'notice_sync_anomaly', 'partner', 'critical', false, null, 24],
    ['E10_weekly_mis', 'Weekly MIS summary', 'Monday morning MIS report for the partner', null, '30 4 * * 1', 'notice_weekly_mis', 'partner', 'normal', true, 1, 168],
    ['E11_unassigned', 'Unassigned notice reminder', 'Daily reminder for notices with no owner after 48h', null, '0 4 * * *', 'notice_unassigned', 'team', 'normal', true, null, 24],
    ['E12_client_docs', 'Request documents from client', 'Email client requesting documents for a notice', null, null, 'notice_client_docs', 'client', 'normal', true, 3, 72],
    ['E13_client_update', 'Client status update', 'Periodic update to client on their notice status', null, null, 'notice_client_update', 'client', 'normal', true, null, 168],
  ];
  T.notice_alert_rules = RULES.map(([alert_key, name, description, event_type, schedule, template_key, recipient, priority, quiet_hours, max_repeats, cooldown_hrs], i) => ({ id: uid('7a000000', i + 1), alert_key, name, description, event_type, schedule, template_key, recipient, is_active: true, priority, quiet_hours, max_repeats, cooldown_hrs, created_at: '2026-09-14T10:00:00.000Z', updated_at: '2026-09-14T10:00:00.000Z' }));
  T.email_templates = EMAIL_TEMPLATES.map((t, i) => ({ ...t, is_active: t.key !== 'notice_status' && t.key !== 'notice_reply', step: null, sort_order: 100 + i, updated_at: '2026-09-14T10:00:00.000Z', updated_by: null }));

  const outbox = [];
  const OB = (n, key, to, status, at, subject, extra = {}) => outbox.push({ id: uid('7b000000', outbox.length + 1), client_id: n ? n.client_id : null, notice_id: n ? n.id : null, matter_id: null, filing_status_id: null, kind: 'notice_alert', template_key: key, to_email: to, subject, body: '(rendered template body)', render_vars: null, status, sent_at: status === 'sent' ? at : null, error: extra.error ?? null, dedupe_key: extra.dk ?? null, created_at: at, created_by: null, period_month: null, reminder_step: null, return_type: null });
  OB(S.c1_drc01b, 'notice_overdue_digest', STAFF.M.email, 'sent', ist(-1, 9, 31), '13 overdue notices -- Daily Digest', { dk: `E2_overdue_digest:daily:${d(-1)}:${STAFF.M.email}` });
  OB(S.c1_drc01b, 'notice_overdue_digest', STAFF.A1.email, 'sent', ist(-1, 9, 31), '13 overdue notices -- Daily Digest', { dk: `E2_overdue_digest:daily:${d(-1)}:${STAFF.A1.email}` });
  OB(S.c6_asmt10, 'notice_due_soon', STAFF.A2.email, 'sent', ist(-1, 9, 32), 'Notice due in 3 days -- Mock Builders LLP', { dk: `E3_due_in_7:${S.c6_asmt10.id}:${d(-1)}:${STAFF.A2.email}` });
  OB(S.c2_asmt10, 'notice_status', STAFF.P.email, 'failed', hoursAgo(5), 'Notice status updated: Reply drafted -- Sample Pharma LLP (Notice)', { error: 'sendMail 400: {"error":{"code":"ErrorInvalidRecipients"}}' });
  OB(null, 'notice_unassigned', STAFF.P.email, 'pending', hoursAgo(1), '24 notices unassigned for 48+ hours', { dk: `E11_unassigned:daily:${d(0)}:${STAFF.P.email}` });
  T.email_outbox = outbox;
  T.notice_alert_log = outbox.map((o, i) => ({ id: uid('7c000000', i + 1), rule_id: T.notice_alert_rules[o.template_key === 'notice_overdue_digest' ? 1 : o.template_key === 'notice_due_soon' ? 2 : o.template_key === 'notice_status' ? 6 : 10].id, notice_id: o.notice_id, client_id: o.client_id, event_id: null, email_outbox_id: o.id, recipient_email: o.to_email, status: 'sent', suppress_reason: null, dedupe_key: o.dedupe_key, created_at: o.created_at }));
  T.staff_notification_prefs = [];

  // ───────────── client sync log (every action the extension writes) ─────────────
  const logs = [];
  const LG = (c, action, status, message, at) => logs.push({ id: uid('6a000000', logs.length + 1), client_id: C[c].id, action, status, message, created_at: at });
  LG(0, 'notices', 'success', '31 entries found (29 PDFs captured).', ist(0, 7, 42));
  LG(0, 'refunds_debug', 'success', 'build=0.2.0 (JSON API) | rows: 2 | arns: ' + refunds.filter((r) => r.client_id === C[0].id).map((r) => r.arn).join(','), ist(0, 7, 43));
  LG(1, 'notices', 'success', '24 entries found (22 PDFs captured, 1 failed).', ist(0, 7, 48));
  LG(2, 'notices', 'success', '19 entries found (19 PDFs captured).', ist(-3, 18, 20));
  LG(2, 'login_failed', 'failed', 'Invalid Username or Password. Please try again.', ist(0, 7, 51));
  LG(3, 'notices', 'success', '15 entries found (14 PDFs captured).', ist(-2, 19, 5));
  LG(3, 'notices', 'failed', 'Session kept dropping (bounced to login/error page 3x) while reading Notices & Orders.', ist(0, 8, 2));
  LG(5, 'notices', 'success', '11 entries found (11 PDFs captured).', ist(-1, 18, 10));
  LG(6, 'notices', 'success', '27 entries found (25 PDFs captured).', ist(0, 7, 55));
  LG(6, 'refunds', 'failed', 'PULL FAILED: HTTP 503 from case/search', ist(0, 7, 57));
  LG(7, 'notices', 'success', '22 entries found (21 PDFs captured).', ist(-2, 8, 30));
  LG(8, 'notices', 'success', '9 entries found (9 PDFs captured).', ist(-19, 9, 15));
  LG(9, 'notices', 'success', '15 entries found (15 PDFs captured).', ist(-1, 15, 5));
  LG(9, 'notices', 'failed', 'Read 15 rows but the save failed: duplicate key value violates unique constraint "uq_gst_notices_portal"', ist(0, 7, 58));
  LG(10, 'notices', 'success', '12 entries found (12 PDFs captured).', ist(-6, 17, 45));
  LG(10, 'login_failed', 'failed', 'CAPTCHA was not solved within 120 seconds — login abandoned.', ist(0, 8, 10));
  logs.sort((a, b) => b.created_at.localeCompare(a.created_at));
  T.client_sync_log = logs;

  // ───────────── taxpayer profile + filed returns ─────────────
  const CONST = ['Private Limited Company', 'Limited Liability Partnership', 'Private Limited Company', 'Proprietorship', 'Private Limited Company', 'Limited Liability Partnership', 'Private Limited Company', 'Public Limited Company', 'Partnership', 'Private Limited Company', 'Private Limited Company', 'Limited Liability Partnership'];
  T.gst_taxpayer_profile = C.slice(0, 11).map((c, i) => ({ id: uid('6b000000', i + 1), client_id: c.id, legal_name: c.name.toUpperCase(), trade_name: c.name, registration_date: c.registration_date, constitution_of_business: CONST[i], principal_place_address: `Unit ${10 + i}, Demo Industrial Estate, ${c._city}, ${STATE_NAMES[c._st]} (fictional address)`, jurisdiction_state: `${STATE_NAMES[c._st]} — Ward ${i + 3}`, jurisdiction_centre: `Range-${(i % 4) + 1}, Division-${(i % 3) + 1}`, aadhaar_authentication_status: 'Yes', registration_certificate_url: null, pulled_at: lastPull[i], pulled_by: null, created_at: '2026-09-02T05:00:00.000Z', updated_at: lastPull[i] }));
  const fr = [];
  for (const [ci, c] of C.entries()) {
    if (ci === 11) continue;
    for (let mback = 1; mback <= 14; mback++) {
      const dt = new Date(Date.UTC(2026, 9 - mback, 1));
      const mm = pad(dt.getUTCMonth() + 1, 2), yy = dt.getUTCFullYear();
      const period = `${mm}/${yy}`;
      const late = (ci === 8 && mback <= 2) || (ci === 3 && mback === 2);
      // Sep 2026 returns fall due on 11/20 Oct — not yet filed on "today" (05 Oct 2026)
      const pending = mback === 1;
      const pulled = lastPull[ci];
      const g1 = new Date(Date.UTC(yy, dt.getUTCMonth() + 1, 10 + ((ci + mback) % 2))).toISOString().slice(0, 10);
      const g3 = new Date(Date.UTC(yy, dt.getUTCMonth() + 1, 19 + ((ci * 3 + mback) % 3))).toISOString().slice(0, 10);
      const s1 = late ? 'NOT FILED / NOT FOUND' : pending ? 'To be filed' : 'Filed';
      const at1 = pending ? pulled : g1 + 'T10:00:00.000Z', at3 = pending ? pulled : g3 + 'T10:00:00.000Z';
      fr.push({ id: uid('6c000000', fr.length + 1), client_id: c.id, return_type: 'GSTR1', period_month: period, filed_date: late || pending ? null : g1, arn: late || pending ? null : `AA${c._st}${mm}${String(yy).slice(2)}${pad(fr.length * 13 + 7, 7)}`, status: s1, summary: {}, full_json: null, full_json_pulled_at: null, created_at: at1, updated_at: at1 });
      fr.push({ id: uid('6c000000', fr.length + 1), client_id: c.id, return_type: 'GSTR3B', period_month: period, filed_date: late || pending ? null : g3, arn: null, status: s1, summary: {}, full_json: null, full_json_pulled_at: null, created_at: at3, updated_at: at3 });
    }
  }
  T.gst_filed_returns = fr;

  // tables the shell / other widgets read — empty
  for (const t of ['chat_channels', 'chat_channel_members', 'chat_channel_messages', 'chat_channel_read_status', 'chat_messages', 'chat_read_status', 'filing_status', 'password_reset_requests']) T[t] = [];

  // strip helper fields
  for (const c of T.clients) { delete c._st; delete c._city; }
  return { tables: T, story: Object.fromEntries(Object.entries(S).map(([k, v]) => [k, { id: v.id, client_id: v.client_id, case_id: v.case_id }])) };
}

// Seeded by supabase/migrations/20260914140000_notice_alerts_phase1.sql (verbatim text)
const EMAIL_TEMPLATES = [
  { key: 'notice_new', kind: 'notice_alert', name: 'New Notice Captured', subject: 'New {{notice_type}} for {{client_name}} ({{gstin}})', body: 'A new {{notice_type}} has been captured from the GST portal.\n\nClient: {{client_name}}\nGSTIN: {{gstin}}\nReference: {{reference_number}}\nIssued: {{issue_date}}\nDue Date: {{due_date}}\nDescription: {{description}}\n\nPlease review and take action.\n\n-- {{firm_name}}' },
  { key: 'notice_overdue_digest', kind: 'notice_alert', name: 'Daily Overdue Digest', subject: '{{overdue_count}} overdue notices -- Daily Digest', body: 'The following notices are past their due date with no reply logged:\n\n{{notice_list}}\n\nPlease prioritise these for immediate action.\n\n-- {{firm_name}}' },
  { key: 'notice_due_soon', kind: 'notice_alert', name: 'Notice Due Soon', subject: '{{notice_type}} due in {{days_remaining}} days -- {{client_name}}', body: 'A notice is approaching its due date.\n\nClient: {{client_name}}\nGSTIN: {{gstin}}\nType: {{notice_type}}\nReference: {{reference_number}}\nDue Date: {{due_date}}\nDays Remaining: {{days_remaining}}\n\nPlease ensure a reply is filed before the deadline.\n\n-- {{firm_name}}' },
  { key: 'notice_hearing', kind: 'notice_alert', name: 'Hearing Reminder', subject: 'Hearing on {{hearing_date}} -- {{client_name}} ({{notice_type}})', body: 'A hearing is scheduled.\n\nClient: {{client_name}}\nGSTIN: {{gstin}}\nType: {{notice_type}}\nHearing Date: {{hearing_date}}\nOfficer: {{issued_by}}\n\nPlease prepare the required documents.\n\n-- {{firm_name}}' },
  { key: 'notice_limitation', kind: 'notice_alert', name: 'Limitation Period Warning', subject: '{{deadline_type}} deadline in {{days_remaining}} days -- {{client_name}}', body: 'A statutory limitation period is approaching.\n\nClient: {{client_name}}\nGSTIN: {{gstin}}\nDeadline Type: {{deadline_type}}\nDeadline Date: {{deadline_date}}\nStatutory Basis: {{statutory_basis}}\nDays Remaining: {{days_remaining}}\n\nAction is required before this date to preserve rights.\n\n-- {{firm_name}}' },
  { key: 'notice_assigned', kind: 'notice_alert', name: 'Notice Assigned', subject: '{{notice_type}} assigned to you -- {{client_name}}', body: 'A notice has been assigned to you.\n\nClient: {{client_name}}\nGSTIN: {{gstin}}\nType: {{notice_type}}\nReference: {{reference_number}}\nDue Date: {{due_date}}\nPriority: {{priority}}\n\nPlease review and update the status.\n\n-- {{firm_name}}' },
  { key: 'notice_status', kind: 'notice_alert', name: 'Status Changed', subject: 'Notice status updated: {{new_status}} -- {{client_name}} ({{notice_type}})', body: 'A notice status has been updated.\n\nClient: {{client_name}}\nGSTIN: {{gstin}}\nType: {{notice_type}}\nOld Status: {{old_status}}\nNew Status: {{new_status}}\nUpdated By: {{actor_name}}\n\n-- {{firm_name}}' },
  { key: 'notice_reply', kind: 'notice_alert', name: 'Reply Logged', subject: 'Reply logged for {{notice_type}} -- {{client_name}}', body: 'A reply has been logged for a notice.\n\nClient: {{client_name}}\nGSTIN: {{gstin}}\nType: {{notice_type}}\nReply Ref: {{reply_ref_number}}\nReply Date: {{reply_date}}\nLogged By: {{actor_name}}\n\n-- {{firm_name}}' },
  { key: 'notice_sync_anomaly', kind: 'notice_alert', name: 'Sync Anomaly', subject: 'Sync anomaly detected for {{client_name}}', body: 'The sync process detected an unusual pattern.\n\nClient: {{client_name}}\nGSTIN: {{gstin}}\nAnomaly: {{anomaly_description}}\n\nPlease investigate.\n\n-- {{firm_name}}' },
  { key: 'notice_weekly_mis', kind: 'notice_alert', name: 'Weekly MIS Summary', subject: 'Weekly Notices MIS -- {{report_date}}', body: 'Weekly Notices Management Information Summary\n\n{{mis_content}}\n\n-- {{firm_name}}' },
  { key: 'notice_unassigned', kind: 'notice_alert', name: 'Unassigned Notices', subject: '{{unassigned_count}} notices unassigned for 48+ hours', body: 'The following notices have no assigned owner and have been open for more than 48 hours:\n\n{{notice_list}}\n\nPlease assign these to a team member.\n\n-- {{firm_name}}' },
  { key: 'notice_client_docs', kind: 'notice_alert', name: 'Request Documents from Client', subject: 'Documents Required -- {{notice_type}} ({{reference_number}})', body: 'Dear {{contact_person}},\n\nWe are handling a {{notice_type}} (Ref: {{reference_number}}) for {{client_name}} (GSTIN: {{gstin}}).\n\nWe require the following documents:\n{{document_list}}\n\nPlease share these at your earliest convenience.\n\nRegards,\n{{staff_name}}\n{{firm_name}}\n{{firm_email}}' },
  { key: 'notice_client_update', kind: 'notice_alert', name: 'Client Status Update', subject: 'Status Update -- {{notice_type}} ({{reference_number}})', body: 'Dear {{contact_person}},\n\nHere is an update on the {{notice_type}} (Ref: {{reference_number}}) for {{client_name}} (GSTIN: {{gstin}}).\n\nCurrent Status: {{staff_status}}\nNext Step: {{next_step}}\n\nWe will keep you informed of any developments.\n\nRegards,\n{{staff_name}}\n{{firm_name}}\n{{firm_email}}' },
];
export { EMAIL_TEMPLATES };
