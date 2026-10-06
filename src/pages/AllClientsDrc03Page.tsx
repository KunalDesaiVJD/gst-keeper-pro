// Notices & Litigation · DRC-03 payments (audit U-77-1..4, L-37, R-21;
// cross-cutting ui-b). Every DRC-03 filing plus the portal's voluntary-payment
// cases no filing covers (public.drc03_facts, one row per ARN), as eight
// columns — client · ARN · cause · period · total paid · status · against ·
// PDF — with the tax heads and the cash / credit split in a row that opens
// under each payment. Nothing captured reads "—", never ₹0; a case-only row
// says "details not fetched" with a Fetch action. "Against" names the notice
// or matter the payment is linked to, else the one it most likely settles
// (same client, form for the cause, same FY), linked with one click through
// the workspace's notice_payments. The client, filters, search and sort live
// in the URL (?client=<id>, ?status=, ?fy=, ?against=none).
import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { FileSpreadsheet, FolderDown, Loader2, RefreshCw, Search, Wallet } from 'lucide-react';
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
import { AsOfLine, FilterChips, FilterTile, type Chip } from '@/components/notices/reports/ReportBits';
import { Drc03Table, type Drc03Sort } from '@/components/notices/reports/Drc03Table';
import { periodText, useDrc03Ledger, type Drc03Row, type NoticeRef } from '@/components/notices/reports/ledgerData';
import { DRC03_GROUPS, DRC03_SHOW, drc03ShowLabel, matchesDrc03Show, parseDrc03Show, type Drc03Show } from '@/components/notices/reports/ledgerStatus';
import { downloadZip } from '@/components/notices/reports/zip';
import { linkPayment } from '@/lib/noticeWorkspace';
import { istToday } from '@/lib/noticeFacts';
import { fmtDate, fmtFy, fmtInr, fmtInrShort, plural } from '@/lib/noticeFormat';

const SORTS: Drc03Sort[] = ['filed', 'client', 'total'];
const ACCENT = { pending: 'info', acknowledged: 'success', nodetails: 'warning' } as const;
const linked = (r: Drc03Row) => r.against.notices.length > 0 || r.against.matters.length > 0;

const AllClientsDrc03Page: React.FC = () => {
  const { isStaffRole, user, canExportData, canEditNoticeStatus } = useAuth();
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  const today = istToday();
  const clientId = sp.get('client') || undefined;
  const show = parseDrc03Show(sp.get('status'));
  const fy = sp.get('fy') || '';
  const against = sp.get('against') === 'none' ? 'none' : sp.get('against') === 'linked' ? 'linked' : '';
  const sort = (SORTS.includes(sp.get('sort') as Drc03Sort) ? sp.get('sort') : 'filed') as Drc03Sort;
  const dir: 'asc' | 'desc' = sp.get('dir') === 'asc' || sp.get('dir') === 'desc' ? (sp.get('dir') as 'asc' | 'desc') : sort === 'client' ? 'asc' : 'desc';
  const qParam = sp.get('q') ?? '';
  const [q, setQ] = useState(qParam);
  const [zipping, setZipping] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);
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

  const ledger = useDrc03Ledger(clientId);
  const client = useQuery({
    queryKey: ['client-name', clientId],
    enabled: !!clientId,
    queryFn: async () => (await supabase.from('clients').select('name, gstin').eq('id', clientId as string).maybeSingle()).data,
  });

  // Each filter but one, so a tile counts exactly the list it opens (the status tiles skip the
  // status filter, the "not linked" tile skips the against filter).
  const { rows, byStatus, byAgainst } = useMemo(() => {
    const term = qParam.trim().toLowerCase();
    const keep = (r: Drc03Row, skip: 'status' | 'against' | null) => {
      if (fy && fmtFy(r.fy) !== fmtFy(fy)) return false;
      if (skip !== 'against' && against === 'none' && (r.fact.origin !== 'filing' || linked(r))) return false;
      if (skip !== 'against' && against === 'linked' && !linked(r)) return false;
      if (skip !== 'status' && !matchesDrc03Show(r.state, !!r.fact.is_closed, show)) return false;
      if (!term) return true;
      return [r.fact.arn, r.fact.client_name, r.fact.client_gstin, r.fact.cause_of_payment, r.section, r.state.label]
        .some((v) => (v ?? '').toLowerCase().includes(term));
    };
    const all = ledger.data ?? [];
    const sign = dir === 'asc' ? 1 : -1;
    const val = (r: Drc03Row): string | number | null =>
      sort === 'client' ? (r.fact.client_name ?? '').toLowerCase() : sort === 'total' ? r.total : r.fact.filed_date;
    const sorted = all.filter((r) => keep(r, null)).sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va !== vb) {
        if (va === null) return 1;
        if (vb === null) return -1;
        return sign * (va < vb ? -1 : 1);
      }
      return (b.fact.filed_date ?? '').localeCompare(a.fact.filed_date ?? '');
    });
    return { rows: sorted, byStatus: all.filter((r) => keep(r, 'status')), byAgainst: all.filter((r) => keep(r, 'against')) };
  }, [ledger.data, qParam, fy, against, show, sort, dir]);
  const total = rows.reduce((s, r) => s + (r.total ?? 0), 0);
  const noAmount = rows.filter((r) => r.total === null).length;
  const fys = useMemo(() => [...new Set((ledger.data ?? []).map((r) => r.fy).filter((v): v is string => !!v))].sort().reverse(), [ledger.data]);

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  const clientName = clientId ? client.data?.name ?? ledger.data?.[0]?.fact.client_name ?? null : null;
  const hrefWith = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(sp);
    Object.entries(patch).forEach(([k, v]) => { if (v) next.set(k, v); else next.delete(k); });
    const s = next.toString();
    return `/drc03-all${s ? `?${s}` : ''}`;
  };
  const chips: Chip[] = [];
  if (clientId) chips.push({ key: 'client', label: `Client: ${clientName ?? 'one client'}`, onRemove: () => set({ client: undefined }) });
  if (show !== 'all') chips.push({ key: 'status', label: `Show: ${drc03ShowLabel(show)}`, onRemove: () => set({ status: undefined }) });
  if (fy) chips.push({ key: 'fy', label: `FY ${fmtFy(fy)}`, onRemove: () => set({ fy: undefined }) });
  if (against) chips.push({ key: 'against', label: against === 'none' ? 'Not linked to a notice' : 'Linked to a notice or matter', onRemove: () => set({ against: undefined }) });
  if (qParam) chips.push({ key: 'q', label: `Search: ${qParam}`, onRemove: () => { setQ(''); set({ q: undefined }); } });
  const onSort = (k: Drc03Sort) => set(k === sort ? { sort: k, dir: dir === 'asc' ? 'desc' : 'asc' } : { sort: k === 'filed' ? undefined : k, dir: undefined });
  const pdfs = rows.filter((r) => r.fact.pdf_url).map((r) => ({ url: r.fact.pdf_url as string, name: `${r.fact.client_name ?? 'Client'} DRC-03 ${r.fact.arn ?? ''}` }));
  const canEdit = canEditNoticeStatus();
  const canFetch = bridge.ready && canEdit;
  const unlinked = byAgainst.filter((r) => r.fact.origin === 'filing' && !linked(r)).length;

  const link = async (r: Drc03Row, n: NoticeRef) => {
    if (!user || !r.fact.arn) return;
    setLinking(r.key);
    try {
      await linkPayment(n.id, { kind: 'drc03', drc03_arn: r.fact.arn, amount: r.total ?? 0, paid_on: r.fact.filed_date, note: r.fact.cause_of_payment }, user);
      toast.success(`DRC-03 ${r.fact.arn} linked to ${n.form_code ?? 'the notice'} ${n.reference_number ?? ''}`.trim());
      qc.invalidateQueries({ queryKey: ['drc03-ledger'] });
      qc.invalidateQueries({ queryKey: ['notice-workspace', n.id] });
    } catch (e) {
      toast.error(`Couldn't link: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setLinking(null); }
  };
  // Clients with voluntary-payment cases but no DRC-03 filing captured for them.
  const noDetails = [...new Set(rows.filter((r) => r.state.group === 'nodetails').map((r) => r.fact.client_id).filter((v): v is string => !!v))];
  const fetchDetails = async () => {
    const res = await bridge.startPull('drc03', noDetails);
    if (res.ok) toast.success(`Fetching DRC-03 filings for ${plural(res.count ?? noDetails.length, 'client')}. Type each CAPTCHA in the portal tab; this list updates after the run.`);
    else toast.error(res.error || 'The fetch did not start.');
  };
  const zip = async () => {
    setZipping(true);
    const t = toast.loading(`Fetching ${plural(pdfs.length, 'PDF')}…`);
    try {
      const res = await downloadZip(pdfs, `DRC-03 payments ${today}.zip`);
      if (res.ok === 0) toast.error(`None of the ${plural(pdfs.length, 'PDF')} could be fetched.`);
      else toast.success(`Saved ${plural(res.ok, 'PDF')} in one .zip${res.failed ? `; ${res.failed} could not be fetched` : ''}.`);
    } finally { setZipping(false); toast.dismiss(t); }
  };
  const exportXlsx = () => {
    const data = rows.map((r) => ({
      Client: r.fact.client_name, GSTIN: r.fact.client_gstin, ARN: r.fact.arn ?? '', 'Paid on': fmtDate(r.fact.filed_date),
      Cause: r.fact.cause_of_payment ?? '', Section: r.section ?? '', FY: fmtFy(r.fy), Period: periodText(r) ?? '',
      'IGST (₹)': r.heads?.igst ?? '', 'CGST (₹)': r.heads?.cgst ?? '', 'SGST (₹)': r.heads?.sgst ?? '', 'Cess (₹)': r.heads?.cess ?? '',
      'Interest (₹)': r.heads?.interest ?? '', 'Late fee (₹)': r.heads?.lateFee ?? '', 'Penalty (₹)': r.heads?.penalty ?? '',
      'Total paid (₹)': r.total ?? '', 'Cash (₹)': r.cash ?? '', 'Credit (₹)': r.credit ?? '', Status: r.state.label,
      'Paid against': [...r.against.notices.map((n) => `${n.form_code ?? 'Notice'} ${n.reference_number ?? ''}`.trim()), ...r.against.matters.map((m) => m.matter_no)].join(', '),
      Source: r.fact.origin === 'case' ? 'portal case only' : 'filing', PDF: r.fact.pdf_url ?? '',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'DRC-03');
    XLSX.writeFile(wb, `DRC-03 payments${clientName ? ` — ${clientName}` : ''} ${today}.xlsx`);
    toast.success(`Exported ${plural(rows.length, 'payment')}`);
  };

  return (
    <NoticesShell section="DRC-03 payments" status={<AsOfLine at={ledger.dataUpdatedAt} />}
      actions={canExportData() && (
        <>
          <Button size="sm" variant="outline" className={WS_BTN} onClick={exportXlsx} disabled={!rows.length}>
            <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden /> Export to Excel
          </Button>
          <Button size="sm" variant="outline" className={WS_BTN} onClick={zip} disabled={!pdfs.length || zipping}>
            {zipping ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <FolderDown className="h-3.5 w-3.5" aria-hidden />}
            Download {plural(pdfs.length, 'PDF')} (.zip)
          </Button>
        </>
      )}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-base font-semibold" aria-live="polite">
          <Wallet className="h-4 w-4 text-primary" aria-hidden />
          <span>{show === 'all' ? 'DRC-03 payments' : drc03ShowLabel(show)}{clientName ? ` · ${clientName}` : ''}
            <span className="text-muted-foreground"> · {ledger.data ? rows.length.toLocaleString('en-IN') : '…'}</span></span>
        </h2>
        {clientId && (
          <span className="text-xs text-muted-foreground">
            <Link to={`/notices-company/${clientId}`} className="text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary">Client profile</Link>
            {' · '}<Link to={`/notices-all?client=${clientId}`} className="text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary">Notices</Link>
            {' · '}<Link to={`/refunds-all?client=${clientId}`} className="text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary">Refunds</Link>
          </span>
        )}
      </div>

      {ledger.data && (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {DRC03_GROUPS.filter((g) => g.key !== 'nodetails' || byStatus.some((r) => r.state.group === 'nodetails')).map((g) => {
            const list = byStatus.filter((r) => r.state.group === g.key);
            const amount = list.reduce((s, r) => s + (r.total ?? 0), 0);
            return (
              <FilterTile key={g.key} to={hrefWith({ status: show === g.key ? undefined : g.key })} label={g.label} accent={ACCENT[g.key]}
                active={show === g.key} value={list.length.toLocaleString('en-IN')} hint={amount ? `${fmtInrShort(amount)} · ${g.hint}` : g.hint} />
            );
          })}
          <FilterTile to={hrefWith({ against: against === 'none' ? undefined : 'none' })} label="Not linked to a notice" accent="warning"
            active={against === 'none'} value={unlinked.toLocaleString('en-IN')} hint="link each to what it settles" />
        </div>
      )}

      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ARN, client, GSTIN, cause…" aria-label="Search DRC-03 payments" className="h-8 pl-7 text-xs" />
          </div>
          <FilterPill label="Show" allLabel="All" value={show} onChange={(v) => set({ status: v === 'all' ? undefined : v })} options={[]}
            extraOptions={DRC03_SHOW.map((o) => ({ value: o.key, label: o.label }))} />
          <FilterPill label="FY" allLabel="Any" value={fy || 'all'} onChange={(v) => set({ fy: v === 'all' ? undefined : v })} options={[]}
            extraOptions={fys.map((y) => ({ value: y, label: fmtFy(y) }))} />
          <FilterPill label="Against" allLabel="Any" value={against || 'all'} onChange={(v) => set({ against: v === 'all' ? undefined : v })} options={[]}
            extraOptions={[{ value: 'none', label: 'Not linked to a notice' }, { value: 'linked', label: 'Linked to a notice or matter' }]} />
        </div>
        <FilterChips chips={chips} onClear={() => { setQ(''); set({ client: undefined, status: undefined, fy: undefined, against: undefined, q: undefined }); }} />
      </div>

      {ledger.error ? (
        <Note tone="warn">Couldn't load the DRC-03 payments: {ledger.error instanceof Error ? ledger.error.message : String(ledger.error)}{' '}
          <Button variant="link" className="h-auto p-0 text-xs" onClick={() => ledger.refetch()}>Retry</Button></Note>
      ) : !ledger.data ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {ledger.data.length === 0 ? `No DRC-03 payment on record${clientName ? ` for ${clientName}` : ''} yet. They arrive with the portal sync.` : 'No payment matches these filters.'}
        </div>
      ) : (
        <SectionCard title={plural(rows.length, 'payment')}
          description={<>Paid {fmtInr(total)}{noAmount ? ` · ${noAmount} without amounts (left out)` : ''} · newest first · open a total for its tax heads</>}
          actions={canFetch && noDetails.length > 0 ? (
            <Button size="sm" variant="outline" className={WS_BTN} disabled={bridge.busy} onClick={fetchDetails}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Fetch DRC-03 details · {plural(noDetails.length, 'client')}
            </Button>
          ) : undefined}>
          <Drc03Table rows={rows} showClient={!clientId} sort={sort} dir={dir} onSort={onSort} total={total}
            onLink={canEdit ? link : undefined} linking={linking} />
          <p className="text-xs text-muted-foreground">
            A DRC-03 is a payment already made: "with the officer" waits only for the acknowledgement (DRC-04). "Likely" pairs a payment with an
            open notice of the same client, a form that fits the cause and the same financial year; Link records it on the notice's Payments tab.
          </p>
        </SectionCard>
      )}
    </NoticesShell>
  );
};

export default AllClientsDrc03Page;
