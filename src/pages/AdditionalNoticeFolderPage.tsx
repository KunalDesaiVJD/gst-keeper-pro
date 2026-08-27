// AdditionalNoticeFolderPage — Notice Alert parity: clicking a case-linked
// row's Reference No. opens the full case folder (Intimations/Notices/
// Replies/Orders/Closure, each with its own attachments), not just the
// notice row itself. Backed by gst_case_folder_items, populated by the
// extension's Additional Notices capture (content.js's handleNotices
// task-list loop — see that file's comment for what's proven vs best-effort).
//
// Notice Alert's own version has fixed, type-specific columns per section
// (Issue Date/Due Date/Section Number for Intimations; Reply Type/Filed By/
// Option for Personal Hearing for Replies; etc). This page can't safely
// replicate those column-by-column: only docupdtl/crn are confirmed GST
// portal field names (from the already-working ORDRS PDF capture) — every
// other field name inside a folder item's JSON is unverified without live-
// testing against a real client's case. So each row shows its Reference
// Number plus every other field the portal actually returned, labeled with
// its own key — accurate to whatever data exists, never a guessed column
// showing the wrong value with high confidence.
import React, { useEffect, useState } from 'react';
import { Navigate, Link, useParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { PageHeader } from '@/components/layout/PageHeader';
import { NoticesTopNav } from '@/components/notices/NoticesTopNav';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
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

// Best-effort mapping of the portal's own caseFolderTypeCd to Notice Alert's
// section labels — only 'ORDRS' is confirmed (the case this app already
// captures a PDF for); the rest are informed guesses at common GST portal
// abbreviations. An unmapped code still gets its own section, labeled with
// the raw code, rather than being silently dropped or mis-bucketed.
const SECTION_ORDER = ['INTIMATIONS', 'NOTICES', 'REPLIES', 'ORDERS', 'CLOSURE'];
const SECTION_CODE_MAP: Record<string, string> = {
  INTM: 'INTIMATIONS', INTIMATIONS: 'INTIMATIONS',
  NOTC: 'NOTICES', NOTICE: 'NOTICES', NOTICES: 'NOTICES',
  RPLY: 'REPLIES', REPLY: 'REPLIES', REPLIES: 'REPLIES',
  ORDRS: 'ORDERS', ORDER: 'ORDERS', ORDERS: 'ORDERS',
  CLSR: 'CLOSURE', CLOSURE: 'CLOSURE',
};
const sectionLabel = (code: string | null) => {
  if (!code) return 'OTHERS';
  return SECTION_CODE_MAP[code.toUpperCase()] || code.toUpperCase();
};

// Internal-only keys (doc metadata already surfaced via Attachments, or
// portal bookkeeping fields with no display value) filtered out of the
// generic field dump below.
const HIDDEN_KEYS = new Set(['docupdtl', 'crn']);
const humanizeKey = (k: string) => k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
const fieldsOf = (raw: Record<string, unknown> | null): { key: string; value: string }[] => {
  if (!raw || typeof raw !== 'object') return [];
  return Object.entries(raw)
    .filter(([k, v]) => !HIDDEN_KEYS.has(k) && v !== null && v !== undefined && v !== '')
    .map(([k, v]) => ({ key: humanizeKey(k), value: typeof v === 'object' ? JSON.stringify(v) : String(v) }));
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
        <CardHeader className="pb-2 pt-4"><CardTitle className="text-base">Additional Notice Folder</CardTitle></CardHeader>
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
                  <p className="font-medium">{header?.issue_date || '—'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Status</p>
                  <Badge variant="outline" className="text-xs">{header?.staff_status || 'Open'}</Badge>
                </div>
              </div>

              <div className="mt-3 space-y-3">
                {allSections.map((section) => {
                  const sectionItems = bySection.get(section) || [];
                  return (
                    <div key={section} className="rounded-md border">
                      <div className="bg-muted/60 px-3 py-1.5 text-xs font-semibold">{section}</div>
                      {sectionItems.length === 0 ? (
                        <p className="py-4 text-center text-xs text-muted-foreground">There are no records to display</p>
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
