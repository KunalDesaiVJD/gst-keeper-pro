// Notices & Litigation · Refunds (audit U-75-1..5, U-76-1..3; cross-cutting
// ui-b). Every refund application plus the portal's refund cases no
// application covers (public.refund_facts, one row per ARN), read through one
// status map (components/notices/reports/ledgerStatus): needs action in red
// with its reply-by or appeal-by date, in process in blue with the officer's
// clock, sanctioned or paid green, rejected or withdrawn grey; sanction,
// payment and re-credit are closed. The tiles are filters; the client, filter,
// search and sort live in the URL (?client=<id>, ?status=open|action|process|
// paid|rejected|closed) and every active filter shows as a chip. Rows sort by
// the next date. Amounts not captured read "—" and stay out of the totals,
// which sit in the card header. One .zip for the PDFs.
import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { FileSpreadsheet, FolderDown, Loader2, RefreshCw, Search } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Note, SectionCard } from '@/components/gstr9/ui';
import { WS_BTN } from '@/components/workspace/theme';
import { NoticesShell } from '@/components/notices/NoticesShell';
import { FilterPill } from '@/components/notices/FilterPill';
import { useExtensionBridge } from '@/hooks/useExtensionBridge';
import { FilterChips, FilterTile, type Chip } from '@/components/notices/reports/ReportBits';
import { RefundTable, type RefundSort } from '@/components/notices/reports/RefundTable';
import { useRefundLedger, type RefundRow } from '@/components/notices/reports/ledgerData';
import { REFUND_GROUPS, matchesRefundShow, parseRefundShow, refundShowLabel, REFUND_SHOW, type RefundShow } from '@/components/notices/reports/ledgerStatus';
import { downloadZip } from '@/components/notices/reports/zip';
import { istToday } from '@/lib/noticeFacts';
import { fmtDate, fmtInr, fmtInrShort, plural } from '@/lib/noticeFormat';
import { stageLabel } from '@/lib/noticeStages';

const SORTS: RefundSort[] = ['due', 'filed', 'client', 'claimed', 'sanctioned'];
const ASCENDING: RefundSort[] = ['due', 'client'];
const ACCENT = { action: 'destructive', process: 'info', paid: 'success', rejected: 'muted', unknown: 'muted' } as const;

const AllClientsRefundsPage: React.FC = () => {
  const { isStaffRole, canExportData, canEditNoticeStatus } = useAuth();
  const [sp, setSp] = useSearchParams();
  const today = istToday();
  const clientId = sp.get('client') || undefined;
  const show = parseRefundShow(sp.get('status'));
  const portal = sp.get('portal') || '';
  const sort = (SORTS.includes(sp.get('sort') as RefundSort) ? sp.get('sort') : 'due') as RefundSort;
  const dir: 'asc' | 'desc' = sp.get('dir') === 'asc' || sp.get('dir') === 'desc' ? (sp.get('dir') as 'asc' | 'desc') : ASCENDING.includes(sort) ? 'asc' : 'desc';
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

  // Everything but the status filter: what the tiles count (so a tile opens a list of its own size).
  const base = useMemo(() => {
    const term = qParam.trim().toLowerCase();
    return (ledger.data ?? []).filter((r) => {
      if (portal && (r.fact.status ?? '') !== portal) return false;
      if (!term) return true;
      return [r.fact.arn, r.fact.client_name, r.fact.client_gstin, r.fact.refund_type, r.fact.status, r.state.label]
        .some((v) => (v ?? '').toLowerCase().includes(term));
    });
  }, [ledger.data, qParam, portal]);
  const rows = useMemo(() => {
    const list = base.filter((r) => matchesRefundShow(r.state, show));
    const sign = dir === 'asc' ? 1 : -1;
    const val = (r: RefundRow): string | number | null => {
      switch (sort) {
        case 'due': return r.state.due;
        case 'filed': return r.fact.filed_date;
        case 'client': return (r.fact.client_name ?? '').toLowerCase();
        case 'claimed': return r.fact.claimed_amount === null ? null : Number(r.fact.claimed_amount);
        case 'sanctioned': return r.fact.sanctioned_amount === null ? null : Number(r.fact.sanctioned_amount);
        default: return null;
      }
    };
    // Open before closed, then the chosen order (missing values last), then newest filed.
    return list.sort((a, b) => {
      if (sort === 'due' && a.state.open !== b.state.open) return a.state.open ? -1 : 1;
      const va = val(a);
      const vb = val(b);
      if (va !== vb) {
        if (va === null) return 1;
        if (vb === null) return -1;
        return sign * (va < vb ? -1 : 1);
      }
      return (b.fact.filed_date ?? '').localeCompare(a.fact.filed_date ?? '');
    });
  }, [base, show, sort, dir]);
  const totals = useMemo(() => rows.reduce((t, r) => ({
    claimed: t.claimed + (Number(r.fact.claimed_amount) || 0),
    sanctioned: t.sanctioned + (Number(r.fact.sanctioned_amount) || 0),
    noClaim: t.noClaim + (r.fact.claimed_amount === null ? 1 : 0),
  }), { claimed: 0, sanctioned: 0, noClaim: 0 }), [rows]);
  const statuses = useMemo(() => [...new Set((ledger.data ?? []).map((r) => r.fact.status).filter((s): s is string => !!s && !!s.trim()))].sort(), [ledger.data]);

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  const clientName = clientId ? client.data?.name ?? ledger.data?.[0]?.fact.client_name ?? null : null;
  const tileHref = (key: RefundShow) => {
    const next = new URLSearchParams(sp);
    if (show === key) next.delete('status'); else next.set('status', key);
    const s = next.toString();
    return `/refunds-all${s ? `?${s}` : ''}`;
  };
  const chips: Chip[] = [];
  if (clientId) chips.push({ key: 'client', label: `Client: ${clientName ?? 'one client'}`, onRemove: () => set({ client: undefined }) });
  if (show !== 'all') chips.push({ key: 'status', label: `Show: ${refundShowLabel(show)}`, onRemove: () => set({ status: undefined }) });
  if (portal) chips.push({ key: 'portal', label: `Portal status: ${portal}`, onRemove: () => set({ portal: undefined }) });
  if (qParam) chips.push({ key: 'q', label: `Search: ${qParam}`, onRemove: () => { setQ(''); set({ q: undefined }); } });
  const onSort = (k: RefundSort) => set(k === sort ? { sort: k, dir: dir === 'asc' ? 'desc' : 'asc' } : { sort: k === 'due' ? undefined : k, dir: undefined });
  const docs = rows.flatMap((r) => r.docs.map((d) => ({ url: d.url, name: `${r.fact.client_name ?? 'Client'} ${r.fact.arn ?? ''} ${d.label}` })));
  const canFetch = bridge.ready && canEditNoticeStatus();
  // Clients whose refunds have no case folder, or whose case has no application record, yet.
  const clientsOf = (list: RefundRow[]) => [...new Set(list.map((r) => r.fact.client_id).filter((v): v is string => !!v))];
  const noFolder = clientsOf(rows.filter((r) => r.fact.arn && !r.hasFolder && r.fact.origin !== 'case'));
  const noApplication = clientsOf(rows.filter((r) => r.state.noDetails && r.fact.origin === 'case'));
  const lacking = rows.filter((r) => (r.fact.arn && !r.hasFolder) || r.state.noDetails).length;

  const fetchFor = async (mode: 'refund_docs' | 'refunds', clientIds: string[]) => {
    const res = await bridge.startPull(mode, clientIds);
    if (res.ok) toast.success(`Fetching ${mode === 'refunds' ? 'refund applications' : 'refund folders and documents'} for ${plural(res.count ?? clientIds.length, 'client')}. Type each CAPTCHA in the portal tab; this list updates after the run.`);
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
  const exportXlsx = () => {
    const data = rows.map((r) => ({
      Client: r.fact.client_name, GSTIN: r.fact.client_gstin, ARN: r.fact.arn ?? '', 'Refund type': r.fact.refund_type ?? '',
      Filed: fmtDate(r.fact.filed_date), 'Portal status': r.state.label, Group: REFUND_GROUPS.find((g) => g.key === r.state.group)?.label ?? '',
      'Next step': r.state.next ?? '', 'By': fmtDate(r.state.due), Basis: r.state.basis ?? '',
      'Our stage': r.caseLink ? stageLabel(r.caseLink.stage) : '', 'Claimed (₹)': r.fact.claimed_amount ?? '', 'Sanctioned (₹)': r.fact.sanctioned_amount ?? '',
      'Not sanctioned (₹)': r.state.rejectedAmount ?? '', Documents: r.docs.length, Source: r.fact.origin === 'case' ? 'portal case only' : 'application',
    }));
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
          {show === 'all' ? 'Refund applications' : refundShowLabel(show)}{clientName ? ` · ${clientName}` : ''}
          <span className="text-muted-foreground"> · {ledger.data ? rows.length.toLocaleString('en-IN') : '…'}</span>
        </h2>
        {clientId && (
          <span className="text-xs text-muted-foreground">
            <Link to={`/notices-company/${clientId}`} className="text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary">Client profile</Link>
            {' · '}<Link to={`/notices-all?client=${clientId}`} className="text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary">Notices</Link>
            {' · '}<Link to={`/drc03-all?client=${clientId}`} className="text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary">DRC-03</Link>
          </span>
        )}
      </div>

      {ledger.data && (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {REFUND_GROUPS.filter((g) => g.key !== 'unknown' || base.some((r) => r.state.group === 'unknown')).map((g) => {
            const list = base.filter((r) => r.state.group === g.key);
            const amount = list.reduce((s, r) => s + (Number(g.key === 'paid' ? r.fact.sanctioned_amount : r.fact.claimed_amount) || 0), 0);
            const active = show === g.key || (show === 'open' && (g.key === 'action' || g.key === 'process')) || (show === 'closed' && !['action', 'process'].includes(g.key));
            return (
              <FilterTile key={g.key} to={tileHref(g.key)} label={g.label} accent={ACCENT[g.key]} active={active}
                alarm={g.key === 'action' && list.length > 0} value={list.length.toLocaleString('en-IN')}
                hint={amount ? `${fmtInrShort(amount)} ${g.key === 'paid' ? 'sanctioned' : 'claimed'} · ${g.hint}` : g.hint} />
            );
          })}
        </div>
      )}

      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ARN, client, GSTIN, type…" aria-label="Search refunds" className="h-8 pl-7 text-xs" />
          </div>
          <FilterPill label="Show" allLabel="All" value={show} onChange={(v) => set({ status: v === 'all' ? undefined : v })} options={[]}
            extraOptions={REFUND_SHOW.map((o) => ({ value: o.key, label: o.label }))} />
          <FilterPill label="Portal status" allLabel="Any" value={portal || 'all'} onChange={(v) => set({ portal: v === 'all' ? undefined : v })} options={statuses} />
        </div>
        <FilterChips chips={chips} onClear={() => { setQ(''); set({ client: undefined, status: undefined, portal: undefined, q: undefined }); }} />
      </div>

      {ledger.error ? (
        <Note tone="warn">Couldn't load the refunds: {ledger.error instanceof Error ? ledger.error.message : String(ledger.error)}{' '}
          <Button variant="link" className="h-auto p-0 text-xs" onClick={() => ledger.refetch()}>Retry</Button></Note>
      ) : !ledger.data ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {ledger.data.length === 0 ? `No refund application on record${clientName ? ` for ${clientName}` : ''} yet. They arrive with the portal sync.` : 'No refund matches these filters.'}
        </div>
      ) : (
        <SectionCard title={plural(rows.length, 'refund')}
          description={<>Claimed {fmtInr(totals.claimed)} · sanctioned {fmtInr(totals.sanctioned)}{totals.noClaim ? ` · ${totals.noClaim} without a claimed amount (left out)` : ''} · open first, by the next date</>}
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
          <RefundTable rows={rows} today={today} showClient={!clientId} sort={sort} dir={dir} onSort={onSort} totals={totals} />
          <p className="text-xs text-muted-foreground">
            Sanctioned, paid (RFD-05) and re-credited (PMT-03) refunds are closed. A rejection, in full or in part, stays under
            Needs action until the appeal window (3 months from the order, s.107) has run or the refund's case is closed.
            Statuses come from the portal; dates from the refund's case folder when it has been fetched.
          </p>
        </SectionCard>
      )}
    </NoticesShell>
  );
};

export default AllClientsRefundsPage;
