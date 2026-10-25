// Notices & Litigation · Refunds (/refunds-all): the one page for refunds (the
// firm's choice of 25 October 2026, after "four views of one refund" and a
// list that "looked very poor"). Four numbers first (claimed, sanctioned,
// rejected, still open) and what needs the firm; then, for one client, the
// quarter grid (a row per financial year, a column per quarter, a lane per
// type of refund: what was claimed for each quarter, what came back, and any
// quarter not filed) or, for all clients, one line per client; then the
// register by financial year with a total per year. Every refund opens its own
// page (/refunds/:clientId/:arn). Statuses come from the portal through one
// status map (components/notices/reports/ledgerStatus); amounts the portal
// leaves blank from the AI's reading of the refund's own orders. The client,
// filters and search live in the URL (?client, ?status, ?portal, ?type, ?q).
import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileSpreadsheet, FolderDown, Loader2, RefreshCw, Search } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Note } from '@/components/gstr9/ui';
import { SectionCard } from '@/components/notices/ui/Panel';
import { WS_BTN } from '@/components/workspace/theme';
import { NoticesShell } from '@/components/notices/NoticesShell';
import { FilterPill } from '@/components/notices/FilterPill';
import { useExtensionBridge } from '@/hooks/useExtensionBridge';
import { FilterChips, type Chip } from '@/components/notices/reports/ReportBits';
import { RefundGrid } from '@/components/notices/reports/RefundGrid';
import { RefundRegister } from '@/components/notices/reports/RefundRegister';
import { NeedsAction, RefundClients, RefundNumbers } from '@/components/notices/reports/RefundSummary';
import {
  TONE_CELL, TONE_LABEL, fyLabel, placeOf, refundHref, refundPeriod, toneOf, typeCode, typeLong, typeShort, type Tone,
} from '@/components/notices/reports/refundModel';
import { useRefundLedger, type RefundRow } from '@/components/notices/reports/ledgerData';
import { matchesRefundShow, parseRefundShow, refundShowLabel, REFUND_SHOW } from '@/components/notices/reports/ledgerStatus';
import { downloadZip } from '@/components/notices/reports/zip';
import { istToday } from '@/lib/noticeFacts';
import { fmtDate, plural } from '@/lib/noticeFormat';
import { stageLabel } from '@/lib/noticeStages';
import { cn } from '@/lib/utils';

const LEGEND: Tone[] = ['full', 'part', 'rejected', 'action', 'open', 'withdrawn'];

const AllClientsRefundsPage: React.FC = () => {
  const { isStaffRole, canExportData, canEditNoticeStatus } = useAuth();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const today = istToday();
  const clientId = sp.get('client') || undefined;
  const show = parseRefundShow(sp.get('status'));
  const portal = sp.get('portal') || '';
  const type = (sp.get('type') || '').toUpperCase();
  const qParam = sp.get('q') ?? '';
  const [q, setQ] = useState(qParam);
  const [zipping, setZipping] = useState(false);
  const bridge = useExtensionBridge();

  const set = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(sp);
    Object.entries(patch).forEach(([k, v]) => { if (v) next.set(k, v); else next.delete(k); });
    setSp(next, { replace: false });
  };
  useEffect(() => { setQ(qParam); }, [qParam]);
  useEffect(() => {
    if (q === qParam) return;
    const t = setTimeout(() => set({ q: q.trim() || undefined }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const ledger = useRefundLedger(clientId);
  const client = useQuery({
    queryKey: ['client-name', clientId],
    enabled: !!clientId,
    queryFn: async () => (await supabase.from('clients').select('name, gstin').eq('id', clientId as string).maybeSingle()).data,
  });

  // Everything but the status filter: the numbers, the grid and the client lines.
  const base = useMemo(() => {
    const term = qParam.trim().toLowerCase();
    return (ledger.data ?? []).filter((r) => {
      if (portal && (r.fact.status ?? '') !== portal) return false;
      if (type && typeCode(r) !== type) return false;
      if (!term) return true;
      return [r.fact.arn, r.fact.client_name, r.fact.client_gstin, r.fact.refund_type, typeShort(typeCode(r)), r.fact.status, r.state.label, refundPeriod(r)]
        .some((v) => (v ?? '').toLowerCase().includes(term));
    });
  }, [ledger.data, qParam, portal, type]);
  const rows = useMemo(() => base.filter((r) => matchesRefundShow(r.state, show)), [base, show]);
  const statuses = useMemo(() => [...new Set((ledger.data ?? []).map((r) => r.fact.status).filter((s): s is string => !!s && !!s.trim()))].sort(), [ledger.data]);
  const types = useMemo(() => [...new Set((ledger.data ?? []).map(typeCode).filter(Boolean))].sort(), [ledger.data]);

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  const clientName = clientId ? client.data?.name ?? ledger.data?.[0]?.fact.client_name ?? null : null;
  const open = (r: RefundRow) => { if (r.fact.client_id && r.fact.arn) navigate(refundHref(r.fact.client_id, r.fact.arn)); };
  const chips: Chip[] = [];
  if (clientId) chips.push({ key: 'client', label: `Client: ${clientName ?? 'one client'}`, onRemove: () => set({ client: undefined }) });
  if (show !== 'all') chips.push({ key: 'status', label: `Show: ${refundShowLabel(show)}`, onRemove: () => set({ status: undefined }) });
  if (portal) chips.push({ key: 'portal', label: `Portal status: ${portal}`, onRemove: () => set({ portal: undefined }) });
  if (type) chips.push({ key: 'type', label: `Type: ${typeShort(type)}`, onRemove: () => set({ type: undefined }) });
  if (qParam) chips.push({ key: 'q', label: `Search: ${qParam}`, onRemove: () => { setQ(''); set({ q: undefined }); } });
  const docs = rows.flatMap((r) => r.docs.map((d) => ({ url: d.url, name: `${r.fact.client_name ?? 'Client'} ${r.fact.arn ?? ''} ${d.label}` })));
  const canFetch = bridge.ready && canEditNoticeStatus();
  // Clients whose refunds have no case folder, or whose case has no application record, yet.
  const clientsOf = (list: RefundRow[]) => [...new Set(list.map((r) => r.fact.client_id).filter((v): v is string => !!v))];
  const noFolder = clientsOf(rows.filter((r) => r.fact.arn && !r.hasFolder && r.fact.origin !== 'case'));
  const noApplication = clientsOf(rows.filter((r) => r.state.noDetails && r.fact.origin === 'case'));
  const lacking = rows.filter((r) => (r.fact.arn && !r.hasFolder) || r.state.noDetails).length;

  const fetchFor = async (mode: 'refund_docs' | 'refunds', clientIds: string[]) => {
    const res = await bridge.startPull(mode, clientIds);
    if (res.ok) toast.success(`Fetching ${mode === 'refunds' ? 'refund applications' : 'refund folders and documents'} for ${plural(res.count ?? clientIds.length, 'client')}. Type each CAPTCHA in the portal tab; this page updates after the run.`);
    else toast.error(res.error || 'The fetch did not start.');
  };
  const zip = async () => {
    setZipping(true);
    const t = toast.loading(`Fetching ${plural(docs.length, 'PDF')}…`);
    try {
      const res = await downloadZip(docs, `Refund documents ${today}.zip`);
      if (res.ok === 0) toast.error(`None of the ${plural(docs.length, 'PDF')} could be fetched.`);
      else toast.success(`Saved ${plural(res.ok, 'PDF')} in one .zip${res.failed ? `; ${res.failed} could not be fetched` : ''}.`);
    } finally { setZipping(false); toast.dismiss(t); }
  };
  const exportXlsx = async () => {
    // The spreadsheet library loads only when someone exports (it is ~420 KB).
    const XLSX = await import('xlsx');
    const data = rows.map((r) => {
      const p = placeOf(r);
      return {
        Client: r.fact.client_name, GSTIN: r.fact.client_gstin, 'Financial year': p ? fyLabel(p.fy) : '', Quarter: p ? `Q${p.q}` : '',
        Period: refundPeriod(r) ?? '', 'Refund type': r.fact.refund_type ?? '', Reason: typeLong(typeCode(r)), ARN: r.fact.arn ?? '',
        Filed: fmtDate(r.fact.filed_date), 'Claimed (₹)': r.claimed ?? '', 'Sanctioned (₹)': r.sanctioned ?? '', 'Rejected (₹)': r.rejected ?? '',
        'Paid (₹)': r.read?.paid?.value ?? '', Standing: TONE_LABEL[toneOf(r)], 'Portal status': r.fact.status ?? '',
        'Next step': r.state.next ?? '', By: fmtDate(r.state.due), Basis: r.state.basis ?? '', 'Our stage': r.caseLink ? stageLabel(r.caseLink.stage) : '',
        'Amounts from': r.fact.sanctioned_amount !== null ? 'portal' : r.read?.sanctioned ? `AI, ${r.read.sanctioned.from}` : '',
        Linked: r.links.map((l) => `${l.kind} ${l.key}`).join('; '), Documents: r.docs.length,
      };
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Refunds');
    XLSX.writeFile(wb, `Refunds${clientName ? ` — ${clientName}` : ''} ${today}.xlsx`);
    toast.success(`Exported ${plural(rows.length, 'refund')}`);
  };

  return (
    <NoticesShell section="Refunds"
      actions={canExportData() && (
        <>
          <Button size="sm" variant="outline" className={WS_BTN} onClick={exportXlsx} disabled={!rows.length}>
            <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden /> Export to Excel
          </Button>
          <Button size="sm" variant="outline" className={WS_BTN} onClick={zip} disabled={!docs.length || zipping}>
            {zipping ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <FolderDown className="h-3.5 w-3.5" aria-hidden />}
            Download {plural(docs.length, 'PDF')} (.zip)
          </Button>
        </>
      )}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold" aria-live="polite">
          Refunds{clientName ? ` · ${clientName}` : ' · all clients'}
          <span className="text-muted-foreground"> · {ledger.data ? plural(base.length, 'application') : '…'}</span>
        </h2>
        {clientId && (
          <span className="text-xs text-muted-foreground">
            <Link to={`/notices-company/${clientId}`} className="text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary">Client profile</Link>
            {' · '}<Link to={`/notices-all?client=${clientId}`} className="text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary">Notices</Link>
            {' · '}<Link to={`/drc03-all?client=${clientId}`} className="text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary">DRC-03</Link>
          </span>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ARN, client, GSTIN, type, period…" aria-label="Search refunds" className="h-8 pl-7 text-xs" />
          </div>
          <FilterPill label="Type" allLabel="All" value={type || 'all'} onChange={(v) => set({ type: v === 'all' ? undefined : v })} options={[]}
            extraOptions={types.map((t) => ({ value: t, label: typeShort(t) }))} />
          <FilterPill label="Show" allLabel="All" value={show} onChange={(v) => set({ status: v === 'all' ? undefined : v })} options={[]}
            extraOptions={REFUND_SHOW.map((o) => ({ value: o.key, label: o.label }))} />
          <FilterPill label="Portal status" allLabel="Any" value={portal || 'all'} onChange={(v) => set({ portal: v === 'all' ? undefined : v })} options={statuses} />
        </div>
        <FilterChips chips={chips} onClear={() => { setQ(''); set({ client: undefined, status: undefined, portal: undefined, type: undefined, q: undefined }); }} />
      </div>

      {ledger.error ? (
        <Note tone="warn">Couldn't load the refunds: {ledger.error instanceof Error ? ledger.error.message : String(ledger.error)}{' '}
          <Button variant="link" className="h-auto p-0 text-xs" onClick={() => ledger.refetch()}>Retry</Button></Note>
      ) : !ledger.data ? (
        <div className="space-y-2"><Skeleton className="h-24 w-full" />{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : base.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {ledger.data.length === 0 ? `No refund application on record${clientName ? ` for ${clientName}` : ''} yet. They arrive with the portal sync.` : 'No refund matches these filters.'}
        </div>
      ) : (
        <>
          <RefundNumbers rows={base} />
          <NeedsAction rows={base} today={today} showClient={!clientId} onOpen={open} />

          {clientId ? (
            <SectionCard title="Quarter by quarter"
              description="each financial year, each quarter, each type of refund · click a refund to open it"
              info="A refund sits in the quarter its period starts in: the period on the application, else the one the AI read in its papers, else (marked) the month it was filed. A quarter missing between a type's first and latest refund reads 'not filed'.">
              <RefundGrid rows={base} onOpen={open} />
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground" aria-label="Colours">
                {LEGEND.map((t) => <span key={t} className="inline-flex items-center gap-1.5"><span className={cn('h-3 w-3 rounded-sm border', TONE_CELL[t])} aria-hidden />{TONE_LABEL[t]}</span>)}
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border border-dashed border-warning/60" aria-hidden />Not filed</span>
              </div>
            </SectionCard>
          ) : (
            <SectionCard title="Clients" description="the same four numbers per client · click a client for its quarter grid">
              <RefundClients rows={base} onClient={(id) => set({ client: id })} />
            </SectionCard>
          )}

          <SectionCard title="Register"
            description={show === 'all' ? `${plural(rows.length, 'refund')} by financial year, latest first` : `${refundShowLabel(show)} · ${plural(rows.length, 'refund')}`}
            info="Sanctioned, paid (RFD-05) and re-credited (PMT-03) refunds are closed. A rejection, in full or in part, needs action until the appeal window (3 months from the order, s.107) has run or the refund's case is closed. Statuses come from the portal; dates from the refund's case folder; amounts the portal leaves blank from the AI's reading of the refund's own orders."
            actions={canFetch && (noFolder.length > 0 || noApplication.length > 0) ? (
              <>
                {noApplication.length > 0 && (
                  <Button size="sm" variant="outline" className={WS_BTN} disabled={bridge.busy} onClick={() => fetchFor('refunds', noApplication)}>
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Fetch applications · {plural(noApplication.length, 'client')}
                  </Button>
                )}
                {noFolder.length > 0 && (
                  <Button size="sm" variant="outline" className={WS_BTN} disabled={bridge.busy} onClick={() => fetchFor('refund_docs', noFolder)}>
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Fetch case folders · {plural(noFolder.length, 'client')}
                  </Button>
                )}
              </>
            ) : undefined}>
            {lacking > 0 && !canFetch && (
              <Note tone="info">
                {plural(lacking, 'refund')} {lacking === 1 ? 'has' : 'have'} no case folder or application captured yet. They fill in when the client's refunds
                are next fetched; with the browser extension connected, this card offers to fetch them.
              </Note>
            )}
            {rows.length ? <RefundRegister rows={rows} today={today} showClient={!clientId} onOpen={open} />
              : <p className="py-4 text-center text-sm text-muted-foreground">No refund is {refundShowLabel(show).toLowerCase()}.</p>}
          </SectionCard>
        </>
      )}
    </NoticesShell>
  );
};

export default AllClientsRefundsPage;
