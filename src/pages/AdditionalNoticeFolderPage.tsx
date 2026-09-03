// AdditionalNoticeFolderPage — Notice Alert parity: clicking a case-linked
// row's Reference No. opens the full case folder (Intimations/Notices/
// Replies/Orders/Closure, each with its own attachments), not just the
// notice row itself. Backed by gst_case_folder_items, populated by the
// extension's Additional Notices capture (content.js's handleNotices
// task-list loop).
//
// Per-section columns below (Type/Issue Date/Due Date/Section Number for
// Intimations; Reply Type/Filed By/Option for Personal Hearing for Replies;
// etc) use field paths CONFIRMED live 2026-08-27 against a real synced case
// (SHREEJIKRUPA BUILDCON) — sdtls.<dtscn|srscn|remnd|dtorder> for
// Intimations/Notices/Orders (the wrapper key differs by notice sub-type,
// so subDetail() below picks whichever is present), a top-level `reply`
// object for Replies. CLOSURE and any other section this app hasn't
// captured a real example of yet (DRC7A, APLCN, ...) fall back to a generic
// field dump instead of guessed columns.
import React, { useEffect, useState } from 'react';
import { Navigate, Link, useParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { PageHeader } from '@/components/layout/PageHeader';
import { NoticesTopNav } from '@/components/notices/NoticesTopNav';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Bell, Loader2, FileText, ArrowLeft } from 'lucide-react';

interface NoticeHeaderRow {
  case_id: string | null;
  notice_type: string | null;
  issue_date: string | null;
  staff_status: string | null;
  clients: { name: string | null; gstin: string | null } | null;
}

interface FolderItemRow {
  id: string;
  folder_section: string | null;
  reference_number: string | null;
  attachments: { label: string; url: string }[] | null;
  raw_json: Record<string, unknown> | null;
  pulled_at: string;
}

// Mapping of the portal's own caseFolderTypeCd to Notice Alert's section
// labels — confirmed live 2026-08-27: INTIM/NOTCE/REPLY/ORDRS all appeared
// exactly as coded here. 'CLOSURE' has no confirmed portal code yet — kept
// as a guess. DRC7A/APLCN (recovery and appeal proceedings, also seen live)
// aren't among Notice Alert's 5 fixed sections, so they get their own
// section labeled with the raw code rather than being dropped or
// mis-bucketed — same fallback for any other still-unseen folder type.
// APPLICATIONS/NOTICE-ACKNOWLEDGEMENT lead for a refund case (Notice Alert's
// own "Refund Notice Folder" order: Application → Notice/Acknowledgement →
// Replies → Orders) — confirmed live 2026-09-03 against a real refund case.
// They're harmless no-ops for non-refund cases (just render as an empty
// section, same as every other canonical section already does).
const SECTION_ORDER = ['APPLICATIONS', 'NOTICE/ACKNOWLEDGEMENT', 'INTIMATIONS', 'NOTICES', 'REPLIES', 'ORDERS', 'CLOSURE'];
const SECTION_CODE_MAP: Record<string, string> = {
  INTIM: 'INTIMATIONS', INTIMATIONS: 'INTIMATIONS',
  NOTCE: 'NOTICES', NOTICE: 'NOTICES', NOTICES: 'NOTICES',
  REPLY: 'REPLIES', REPLIES: 'REPLIES',
  ORDRS: 'ORDERS', ORDER: 'ORDERS', ORDERS: 'ORDERS',
  CLSR: 'CLOSURE', CLOSR: 'CLOSURE', CLOSURE: 'CLOSURE',
  // Refund-case-only codes, confirmed live 2026-09-03 against a real refund
  // case (M J SURGICAL, AA2407261761073) — previously fell through to the
  // raw-code fallback section (literally titled "APLCN"/"NOTAC"), which is
  // exactly what the user's comparison doc flagged as unclear/inconsistent
  // with Notice Alert's own labeling.
  APLCN: 'APPLICATIONS',
  NOTAC: 'NOTICE/ACKNOWLEDGEMENT',
};
const sectionLabel = (code: string | null) => {
  if (!code) return 'OTHERS';
  return SECTION_CODE_MAP[code.toUpperCase()] || code.toUpperCase();
};

// The portal's own date fields come as DD/MM/YYYY; our DB columns (e.g.
// gst_notices.issue_date) are ISO YYYY-MM-DD. Notice Alert displays
// DD-MM-YYYY throughout, so both shapes are normalized to that.
const toDisplayDate = (v: unknown): string => {
  if (typeof v !== 'string' || !v) return '—';
  const slash = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (slash) return `${slash[1]}-${slash[2]}-${slash[3]}`;
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`;
  return v;
};
const str = (v: unknown): string => (v === null || v === undefined || v === '' ? '—' : String(v));

// DD/MM/YYYY or DD-MM-YYYY -> a comparable timestamp, for picking the most
// recent of several dates. Refund-case items (APLCN/NOTAC/ORDRS) return
// their own refdt dash-separated ("13-08-2026") rather than the slash format
// every other case type uses — confirmed live 2026-09-03: this only
// matching slash-separated dates meant a refund case's "most recent event"
// silently found nothing, falling back to the parent gst_notices row's own
// issue_date (11-08-2026) instead of the real latest item date (13-08-2026,
// matching Notice Alert's own header for this exact case).
const parseDMY = (v: unknown): number | null => {
  if (typeof v !== 'string') return null;
  const m = v.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime();
};

// Intimations/Notices/Orders each nest their real fields one level under
// `sdtls`, but under a DIFFERENT key depending on the notice's own sub-type
// (a plain SCN uses `dtscn`, a system-generated notice uses `srscn`, a
// reminder uses `remnd`, an order uses `dtorder`) — only one is ever present
// per item, so this just returns whichever one is.
const SDTLS_SUBKEYS = ['dtscn', 'srscn', 'remnd', 'dtorder'] as const;
const subDetail = (raw: Record<string, unknown> | null): Record<string, unknown> | null => {
  const sdtls = raw && (raw as Record<string, unknown>).sdtls;
  if (!sdtls || typeof sdtls !== 'object') return null;
  for (const k of SDTLS_SUBKEYS) {
    const v = (sdtls as Record<string, unknown>)[k];
    if (v && typeof v === 'object') return v as Record<string, unknown>;
  }
  return null;
};
const replyOf = (raw: Record<string, unknown> | null): Record<string, unknown> | null => {
  const r = raw && (raw as Record<string, unknown>).reply;
  return r && typeof r === 'object' ? (r as Record<string, unknown>) : null;
};

interface ColumnDef {
  label: string;
  render: (raw: Record<string, unknown> | null, referenceNumber: string | null) => string;
}

const INTIMATIONS_COLUMNS: ColumnDef[] = [
  { label: 'Type', render: (raw) => str(subDetail(raw)?.type) },
  { label: 'Reference Number', render: (_raw, ref) => str(ref) },
  { label: 'Issue Date', render: (raw) => toDisplayDate(raw?.refdt) },
  { label: 'Due Date to Reply', render: (raw) => toDisplayDate(raw?.duedt ?? subDetail(raw)?.replyDuedt) },
  { label: 'Section Number', render: (raw) => str(subDetail(raw)?.sec) },
];

const NOTICES_COLUMNS: ColumnDef[] = [
  { label: 'Type', render: (raw) => str(subDetail(raw)?.type) },
  { label: 'Reference Number', render: (_raw, ref) => str(ref) },
  { label: 'Issue Date', render: (raw) => toDisplayDate(raw?.refdt) },
  { label: 'Due Date to Reply', render: (raw) => toDisplayDate(subDetail(raw)?.duedt) },
  // Notice Alert's own live example showed a state name (e.g. "GUJARAT")
  // here — we only have the issuing officer's designation confirmed
  // (todtls.dg), not a GST state-code-to-name lookup, so this may read
  // differently until that mapping is added.
  { label: 'Notice Issued By', render: (raw) => str(raw?.todtls && (raw.todtls as Record<string, unknown>).dg) },
  { label: 'Personal Hearing', render: (raw) => str(subDetail(raw)?.pershrng) },
  { label: 'Section Number', render: (raw) => str(subDetail(raw)?.sec) },
  { label: 'Financial Year', render: (raw) => str(subDetail(raw)?.fy) },
  { label: 'Subject', render: (raw) => str(subDetail(raw)?.facts ?? subDetail(raw)?.reason ?? subDetail(raw)?.grounds) },
];

// Confirmed live 2026-08-29 against SHREEJIKRUPA BUILDCON's case
// AD2406250264365: Notice Alert's "Type/Reply No." column reads the reply's
// own type text (replyty), not its reference number, and "Reply filed
// Against" shows blank rather than falling back to the intimation ref when
// there's no underlying notice (ntcno). "Reply Date/Ph" is the date of the
// notice/intimation being replied to (ntcdt, falling back to intdt for a
// reply against an Intimation) — not the reply's own filing date
// (decdtls.dt), confirmed against both this case (21-06-2025 = intdt) and
// the earlier NAVRATNA case (02-09-2025 = ntcdt, not decdtls.dt's
// 02-10-2025). "Reply Type" itself has no confirmed source field yet — left
// blank, matching Notice Alert's own (also blank) column in both examples.
const REPLIES_COLUMNS: ColumnDef[] = [
  { label: 'Type/Reply No.', render: (raw) => str(replyOf(raw)?.replyty) },
  { label: 'Reply Type', render: () => '—' },
  { label: 'Reply filed Against', render: (raw) => str(replyOf(raw)?.ntcno) },
  { label: 'Reply Date/Ph', render: (raw) => toDisplayDate(replyOf(raw)?.ntcdt ?? replyOf(raw)?.intdt) },
  // Not present in any case confirmed live yet — left blank rather than guessed.
  { label: 'Original Due Date', render: () => '—' },
  { label: 'Filed By', render: (raw) => str(replyOf(raw)?.decdtls && (replyOf(raw)?.decdtls as Record<string, unknown>).asnm) },
  { label: 'Option for Personal Hearing', render: (raw) => str(replyOf(raw)?.pershrng) },
];

const ORDERS_COLUMNS: ColumnDef[] = [
  { label: 'Type', render: (raw) => str(subDetail(raw)?.type) },
  { label: 'Order Number', render: (_raw, ref) => str(ref) },
  { label: 'Order Date', render: (raw) => toDisplayDate(raw?.refdt) },
  { label: 'Passed By', render: (raw) => str(raw?.todtls && (raw.todtls as Record<string, unknown>).nm) },
];

// CLOSR-coded items (e.g. "Acceptance of response to DRC-01A") nest their
// real fields directly under sdtls (no dtscn/dtorder wrapper, unlike the
// other sections) — confirmed live 2026-08-29 against the same SHREEJIKRUPA
// case. Notice Alert's own Closure table showed no rows for this same data,
// but the fields are genuinely present on the portal response, so they're
// rendered here with real columns rather than dropped.
const CLOSURE_COLUMNS: ColumnDef[] = [
  { label: 'Type', render: (raw) => str(raw?.sdtls && (raw.sdtls as Record<string, unknown>).type) },
  { label: 'Reference Number', render: (_raw, ref) => str(ref) },
  { label: 'Date', render: (raw) => toDisplayDate(raw?.refdt) },
  { label: 'Passed By', render: (raw) => str(raw?.todtls && (raw.todtls as Record<string, unknown>).nm) },
];

// APLCN (refund Application, GST RFD-01) — confirmed live 2026-09-03: fields
// sit flat on raw_json (no sdtls wrapper), and the ARN date carries a time
// suffix ("31/07/2026 20:51:30") the shared DD/MM/YYYY parser doesn't expect,
// so it's stripped before formatting. Notice Alert's own ARN column reads
// blank on `refundRsn` in the one case checked live — shown here anyway
// since the portal genuinely returns it and dropping real data to match a
// blank cell isn't the goal.
const APPLICATIONS_COLUMNS: ColumnDef[] = [
  { label: 'ARN', render: (raw, ref) => str(ref ?? raw?.applnAckNum) },
  { label: 'ARN Date', render: (raw) => toDisplayDate(typeof raw?.rfdSubDt === 'string' ? (raw.rfdSubDt as string).split(' ')[0] : null) },
  { label: 'Reason of Refund', render: (raw) => str(raw?.refundRsn) },
];

// NOTAC (Notice/Acknowledgement — GST RFD-02 acknowledgement or RFD-08
// rejection notice, confirmed live 2026-09-03 against the same refund case).
// Unlike Intimations/Notices/Orders, its own sub-detail sits directly under
// sdtls (no dtscn/dtorder wrapper) — same shape as CLOSURE's. `duedate` and
// `rsnnoticeother` only exist on the RFD-08 variant; RFD-02 (a plain
// acknowledgement) has neither, rendering as '—'.
const NOTICE_ACKNOWLEDGEMENT_COLUMNS: ColumnDef[] = [
  { label: 'Type of Notice', render: (raw) => str(raw?.sdtls && (raw.sdtls as Record<string, unknown>).tynotice) },
  { label: 'Date of Notice', render: (raw) => toDisplayDate(raw?.refdt) },
  { label: 'Reference No.', render: (_raw, ref) => str(ref) },
  { label: 'Reason of Notice', render: (raw) => str(raw?.sdtls && (raw.sdtls as Record<string, unknown>).rsnnoticeother) },
  { label: 'Due Date of Reply', render: (raw) => toDisplayDate(raw?.sdtls && (raw.sdtls as Record<string, unknown>).duedate) },
];

const SECTION_COLUMNS: Record<string, ColumnDef[]> = {
  APPLICATIONS: APPLICATIONS_COLUMNS,
  'NOTICE/ACKNOWLEDGEMENT': NOTICE_ACKNOWLEDGEMENT_COLUMNS,
  INTIMATIONS: INTIMATIONS_COLUMNS,
  NOTICES: NOTICES_COLUMNS,
  REPLIES: REPLIES_COLUMNS,
  ORDERS: ORDERS_COLUMNS,
  CLOSURE: CLOSURE_COLUMNS,
};

// Fallback for sections with no confirmed live example yet (CLOSURE) or no
// Notice Alert reference layout at all (DRC7A, APLCN, ...) — dumps every
// field the portal actually returned instead of guessing at columns.
const HIDDEN_KEYS = new Set(['docupdtl', 'dcupdtls', 'maindocs', 'suppdocs', 'docmodel', 'crn', 'state_cd']);
const HIDDEN_ARRAY_KEYS = new Set(['dmddtls', 'pymtdtls', 'gdssvcdtls']);
const humanizeKey = (k: string) => k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
const fieldsOf = (raw: Record<string, unknown> | null, prefix = '', depth = 0): { key: string; value: string }[] => {
  if (!raw || typeof raw !== 'object' || depth > 2) return [];
  const out: { key: string; value: string }[] = [];
  Object.entries(raw).forEach(([k, v]) => {
    const lk = k.toLowerCase();
    if (HIDDEN_KEYS.has(lk) || v === null || v === undefined || v === '') return;
    const label = prefix ? `${prefix} — ${humanizeKey(k)}` : humanizeKey(k);
    if (Array.isArray(v)) {
      if (HIDDEN_ARRAY_KEYS.has(lk) || v.length === 0) return;
      if (v.every((item) => item === null || typeof item !== 'object')) {
        out.push({ key: label, value: v.join(', ') });
      }
      return;
    }
    if (typeof v === 'object') {
      out.push(...fieldsOf(v as Record<string, unknown>, label, depth + 1));
      return;
    }
    out.push({ key: label, value: String(v) });
  });
  return out;
};

const AdditionalNoticeFolderPage: React.FC = () => {
  const { isStaffRole } = useAuth();
  const { clientId, caseId } = useParams<{ clientId: string; caseId: string }>();
  const [header, setHeader] = useState<NoticeHeaderRow | null>(null);
  const [items, setItems] = useState<FolderItemRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!clientId || !caseId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [headerRes, itemsRes] = await Promise.all([
        supabase.from('gst_notices').select('case_id, notice_type, issue_date, staff_status, clients(name, gstin)').eq('client_id', clientId).eq('case_id', caseId).limit(1).maybeSingle(),
        supabase.from('gst_case_folder_items').select('id, folder_section, reference_number, attachments, raw_json, pulled_at').eq('client_id', clientId).eq('case_id', caseId),
      ]);
      if (!cancelled) {
        setHeader((headerRes.data || null) as unknown as NoticeHeaderRow | null);
        setItems((itemsRes.data || []) as unknown as FolderItemRow[]);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clientId, caseId]);

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;
  if (!clientId || !caseId) return <Navigate to="/notices-all" replace />;

  const bySection = new Map<string, FolderItemRow[]>();
  items.forEach((it) => {
    const label = sectionLabel(it.folder_section);
    const list = bySection.get(label) || [];
    list.push(it);
    bySection.set(label, list);
  });
  const extraSections = Array.from(bySection.keys()).filter((s) => !SECTION_ORDER.includes(s));
  const allSections = [...SECTION_ORDER, ...extraSections];

  // Despite the "Date Of Application/Case Creation" label (kept for Notice
  // Alert parity), both apps actually show the date of the MOST RECENT event
  // on the case — confirmed 2026-08-29 against a live case where Notice
  // Alert showed the order date (18-12-2025), not the case's own arndt
  // (07-07-2025). Each item's own event date is whichever field its section
  // column already uses (refdt for Intimations/Notices/Orders, the reply's
  // decdtls.dt for Replies); the case's static arndt is the fallback when no
  // item has one, and the parent gst_notices row's issue_date after that.
  const itemEventDate = (it: FolderItemRow): unknown =>
    it.raw_json?.refdt ?? (replyOf(it.raw_json)?.decdtls as Record<string, unknown> | undefined)?.dt;
  const latestEventDate = items
    .map((it) => itemEventDate(it))
    .filter((v): v is string => typeof v === 'string' && parseDMY(v) !== null)
    .reduce<string | null>((latest, v) => (latest === null || parseDMY(v)! > parseDMY(latest)! ? v : latest), null);
  const caseArndt = items.map((it) => it.raw_json?.arndt).find((v) => typeof v === 'string');
  const applicationDate = toDisplayDate(latestEventDate ?? caseArndt ?? header?.issue_date ?? null);

  // Notice Alert shows CLOSE for a case once it has a closure item (e.g. an
  // "Acceptance of response" record) — confirmed live 2026-08-29 against the
  // SHREEJIKRUPA BUILDCON case above. staff_status, when set, still wins
  // (a human override of the portal-derived default).
  const hasClosureItem = items.some((it) => sectionLabel(it.folder_section) === 'CLOSURE');
  // Refund cases have no CLOSURE-coded item at all — they close via an Order
  // (Sanction/Rejection) instead. Confirmed live 2026-09-03: a real refund
  // case whose audit trail ends "Refund disbursed" had an ORDRS item but no
  // CLOSURE one, and our Status still showed OPEN — the header rule above
  // simply never fired for this case type.
  const isRefundCase = items.some((it) => sectionLabel(it.folder_section) === 'APPLICATIONS');
  const hasOrderItem = items.some((it) => sectionLabel(it.folder_section) === 'ORDERS');
  const displayStatus = header?.staff_status || (hasClosureItem || (isRefundCase && hasOrderItem) ? 'Closed' : 'Open');

  return (
    <div className="space-y-2.5 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageHeader title="Notices Dashboard" icon={<Bell className="h-5 w-5" />} embedded />
        <NoticesTopNav />
      </div>

      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Link to="/notices-dashboard" className="text-primary hover:underline">GST Dashboard</Link>
        <span>›</span>
        <Link to="/notices-all" className="text-primary hover:underline">Notices and Orders</Link>
        <span>›</span>
        <span>Notice Folder</span>
      </div>

      <Card>
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="text-base">{isRefundCase ? 'Refund Notice Folder' : 'Additional Notice Folder'}</CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          {loading ? (
            <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 rounded-md border p-3 text-xs sm:grid-cols-4">
                <div>
                  <p className="text-muted-foreground">Case ID</p>
                  <p className="font-medium">{caseId}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">GSTIN/UIN/Temporary ID</p>
                  <p className="font-medium">{header?.clients?.gstin || '—'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Date Of Application/Case Creation</p>
                  <p className="font-medium">{applicationDate}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Status</p>
                  <p className="font-semibold">{displayStatus.toUpperCase()}</p>
                </div>
              </div>

              <div className="mt-3 space-y-3">
                {allSections.map((section) => {
                  const sectionItems = bySection.get(section) || [];
                  const columns = SECTION_COLUMNS[section];
                  return (
                    <div key={section} className="overflow-x-auto rounded-md border">
                      <div className="bg-muted/60 px-3 py-1.5 text-xs font-semibold">{section}</div>
                      {sectionItems.length === 0 ? (
                        <p className="py-4 text-center text-xs text-muted-foreground">There are no records to display</p>
                      ) : columns ? (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              {columns.map((c) => <TableHead key={c.label} className="whitespace-nowrap text-[11px]">{c.label}</TableHead>)}
                              <TableHead className="text-[11px]">Attachments</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {sectionItems.map((it) => (
                              <TableRow key={it.id}>
                                {columns.map((c) => (
                                  <TableCell key={c.label} className="align-top whitespace-nowrap text-xs">
                                    {c.render(it.raw_json, it.reference_number)}
                                  </TableCell>
                                ))}
                                <TableCell className="align-top text-xs">
                                  {(it.attachments || []).length === 0 ? (
                                    <span className="text-muted-foreground">—</span>
                                  ) : (
                                    <div className="space-y-0.5">
                                      {(it.attachments || []).map((a, i) => (
                                        <a key={i} href={a.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 whitespace-nowrap text-primary hover:underline">
                                          <FileText className="h-3 w-3 shrink-0" /> {a.label}
                                        </a>
                                      ))}
                                    </div>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-[11px]">Reference Number</TableHead>
                              <TableHead className="text-[11px]">Details</TableHead>
                              <TableHead className="text-[11px]">Attachments</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {sectionItems.map((it) => (
                              <TableRow key={it.id}>
                                <TableCell className="align-top text-xs">{it.reference_number || '—'}</TableCell>
                                <TableCell className="align-top text-xs">
                                  {fieldsOf(it.raw_json).length === 0 ? (
                                    <span className="text-muted-foreground">—</span>
                                  ) : (
                                    <div className="space-y-0.5">
                                      {fieldsOf(it.raw_json).map((f) => (
                                        <div key={f.key}><span className="text-muted-foreground">{f.key}:</span> {f.value}</div>
                                      ))}
                                    </div>
                                  )}
                                </TableCell>
                                <TableCell className="align-top text-xs">
                                  {(it.attachments || []).length === 0 ? (
                                    <span className="text-muted-foreground">—</span>
                                  ) : (
                                    <div className="space-y-0.5">
                                      {(it.attachments || []).map((a, i) => (
                                        <a key={i} href={a.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-primary hover:underline">
                                          <FileText className="h-3 w-3 shrink-0" /> {a.label}
                                        </a>
                                      ))}
                                    </div>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="mt-3 flex justify-end">
                <Button variant="outline" size="sm" asChild>
                  <Link to="/notices-all"><ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Back to List</Link>
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AdditionalNoticeFolderPage;
