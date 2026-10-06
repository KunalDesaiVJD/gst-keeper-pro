// Notices & Litigation · Matters (roadmap Phase 2; audit U-80-1..6, U-81-1..3,
// U-82-1..4, U-95-*, cross-cutting ui-c). Open matters by default, ordered by
// what needs a decision first: overdue, then the nearest clock (reply due,
// hearing, appeal limitation), then exposure. Every filter, the sort and the
// page live in the URL — the Litigation MIS and e-mails link here with them —
// and the count and total outstanding shown are those of the filtered set.
import React, { useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileDown, FileSpreadsheet, Plus, RefreshCw } from 'lucide-react';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useStaffList } from '@/hooks/useStaffList';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Note } from '@/components/gstr9/ui';
import { WS_BTN } from '@/components/workspace/theme';
import { NoticesShell } from '@/components/notices/NoticesShell';
import { Pager } from '@/components/notices/Pager';
import { stageLabel } from '@/lib/noticeStages';
import { fmtDate, fmtInr, fmtInrShort, plural } from '@/lib/noticeFormat';
import {
  CLOCK_FILTERS, filterMatters, forumLabel, lifecycleLabel, loadMatterList, matterSearch, MATTER_SORTS, parseMatterParams, sortMatters,
  type ClockFilter, type MatterListParams, type MatterSort, type SuggestedMatter,
} from '@/lib/litigationData';
import { MatterTable } from '@/components/litigation/matters/MatterTable';
import { MatterFilterBar } from '@/components/litigation/matters/MatterFilterBar';
import { CreateMatterDialog } from '@/components/litigation/matters/CreateMatterDialog';
import { SuggestedMatters } from '@/components/litigation/matters/SuggestedMatters';
import { ClientSummary } from '@/components/litigation/matters/ClientSummary';
import { clockWhen } from '@/components/litigation/matters/ClockCell';
import { exportClientMattersPdf } from '@/components/litigation/matters/clientReport';
import type { ClientOption } from '@/components/litigation/matters/ClientPicker';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 50;
const TITLES: Record<MatterListParams['status'], string> = { open: 'Open matters', closed: 'Closed matters', all: 'All matters' };

const LitigationMattersPage: React.FC = () => {
  const { isStaffRole, user, canEditNoticeStatus, canExportData } = useAuth();
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  const { staff } = useStaffList();
  const params = useMemo(() => parseMatterParams(sp), [sp]);
  const [creating, setCreating] = useState(false);
  const [suggestion, setSuggestion] = useState<SuggestedMatter | null>(null);
  const list = useQuery({ queryKey: ['matter-list'], queryFn: loadMatterList });
  const clientsQ = useQuery({
    queryKey: ['matter-clients'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ClientOption[]> => {
      const { data, error } = await supabase.from('clients').select('id, name, gstin').order('name');
      if (error) throw error;
      return (data ?? []).map((c) => ({ id: c.id, name: c.name ?? 'Unnamed client', gstin: c.gstin }));
    },
  });

  const meId = user?.id ?? null;
  const ownerName = (id: string | null) => (id ? staff.find((s) => s.userId === id)?.name ?? (id === meId ? user?.firstName ?? 'Me' : 'Staff') : null);
  const all = useMemo(() => list.data ?? [], [list.data]);
  const filtered = useMemo(() => filterMatters(all, params, meId), [all, params, meId]);
  const sorted = useMemo(() => sortMatters(filtered, params, (id) => ownerName(id) ?? ''), [filtered, params, staff]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  const canEdit = canEditNoticeStatus();
  const clients = clientsQ.data ?? [];
  const clientName = (id: string) => clients.find((c) => c.id === id)?.name ?? all.find((r) => r.client_id === id)?.client_name ?? 'Client';
  const update = (patch: Partial<MatterListParams>) => setSp(new URLSearchParams(matterSearch({ ...params, ...patch }).slice(1)));
  const sortKey: MatterSort = params.sort ?? 'clock';
  const sortDir: 'asc' | 'desc' = params.dir ?? (MATTER_SORTS[sortKey].asc ? 'asc' : 'desc');
  const onSort = (k: MatterSort) => (k === sortKey ? update({ sort: k, dir: sortDir === 'asc' ? 'desc' : 'asc', page: 1 }) : update({ sort: k, dir: undefined, page: 1 }));
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['matter-list'] });
    qc.invalidateQueries({ queryKey: ['matter-suggestions'] });
    qc.invalidateQueries({ queryKey: ['notices-command-centre'] });
  };

  const total = filtered.length;
  const openRows = filtered.filter((r) => r.open);
  const exposure = openRows.reduce((s, r) => s + r.money.exposure, 0);
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(params.page, lastPage);
  const rows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  // Each quick count is the length of the list it opens (the other filters kept).
  const quick = [
    ...CLOCK_FILTERS.map((c) => ({ key: c.key, label: c.label, on: params.clock === c.key,
      n: filterMatters(all, { ...params, clock: c.key as ClockFilter }, meId).length,
      apply: () => update({ clock: params.clock === c.key ? undefined : c.key, page: 1 }) })),
    { key: 'none', label: 'Unassigned', on: params.owner === 'none', n: filterMatters(all, { ...params, owner: 'none' }, meId).length,
      apply: () => update({ owner: params.owner === 'none' ? undefined : 'none', page: 1 }) },
  ];
  const client = params.client ? clients.find((c) => c.id === params.client) ?? { id: params.client, name: clientName(params.client), gstin: null } : null;
  const clientRows = client ? all.filter((r) => r.client_id === client.id) : [];
  const anyFilter = !!(params.stage || params.client || params.owner || params.lifecycle || params.priority || params.age || params.clock || params.q);

  const exportXlsx = () => {
    const data = sorted.map((r) => ({
      Matter: r.matter_no, Title: r.title ?? '', Client: r.client_name, GSTIN: r.client_gstin ?? '', Type: lifecycleLabel(r.lifecycle),
      Forum: forumLabel(r), Stage: stageLabel(r.stage), 'Next clock': r.next?.label ?? '', 'Clock date': r.next ? clockWhen(r.next) : '',
      'Days left': r.next?.days ?? '', Owner: ownerName(r.owner_user_id) ?? 'Unassigned', Priority: r.priority ?? '',
      'Demand (₹)': r.money.demand, 'Paid (₹)': r.money.paid, 'Pre-deposit (₹)': r.money.preDeposit, 'Outstanding (₹)': r.money.outstanding,
      Opened: fmtDate(r.opened_on), Status: r.open ? 'Open' : 'Closed',
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Matters');
    XLSX.writeFile(wb, `Matters — ${TITLES[params.status]}${client ? ` — ${client.name}` : ''}.xlsx`);
    toast.success(`Exported ${plural(data.length, 'matter')}`);
  };

  return (
    <NoticesShell section="Matters"
      actions={canEdit && (
        <Button size="sm" className={WS_BTN} onClick={() => { setSuggestion(null); setCreating(true); }}>
          <Plus className="h-3.5 w-3.5" aria-hidden /> New matter
        </Button>
      )}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-base font-semibold" aria-live="polite">
          {TITLES[params.status]}{client ? ` · ${client.name}` : ''}{' '}
          <span className="text-muted-foreground">· {list.isLoading ? '…' : plural(total, 'matter')}</span>
          {!list.isLoading && openRows.length > 0 && (
            <span className="font-normal text-muted-foreground"> · <span className="font-semibold text-foreground" title={fmtInr(exposure)}>{fmtInrShort(exposure)}</span> outstanding</span>
          )}
        </h2>
        {client && (
          <span className="text-xs text-muted-foreground">
            <Link to={`/notices-company/${client.id}`} className="text-primary underline underline-offset-2">Client profile</Link>
            {' · '}<Link to={`/notices-all?client=${client.id}`} className="text-primary underline underline-offset-2">Notices</Link>
          </span>
        )}
      </div>

      {client && !list.isLoading && !list.error && <ClientSummary clientId={client.id} rows={clientRows} />}

      {canEdit && !list.isLoading && <SuggestedMatters clientId={params.client} clientName={clientName}
        onCreate={(s) => { setSuggestion(s); setCreating(true); }} />}

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Quick filters">
        {quick.map((c) => (
          <button key={c.key} type="button" aria-pressed={c.on} onClick={c.apply}
            className={cn('inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              c.on ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-foreground hover:bg-muted')}>
            {c.label}
            <span className={cn('rounded-full px-1.5 text-[11px] font-semibold tabular-nums', c.on ? 'bg-primary-foreground/20' : c.key === 'overdue' && c.n > 0 ? 'bg-destructive/15 text-destructive-strong' : 'bg-muted')}>
              {list.isLoading ? '…' : c.n}
            </span>
          </button>
        ))}
      </div>

      <MatterFilterBar params={params} onChange={update} clients={clients} meId={meId}
        actions={<>
          <Button size="sm" variant="outline" className={WS_BTN} onClick={() => list.refetch()} aria-label="Refresh the list"><RefreshCw className="h-3.5 w-3.5" aria-hidden /></Button>
          {canExportData() && client && clientRows.length > 0 && (
            <Button size="sm" variant="outline" className={WS_BTN} onClick={() => exportClientMattersPdf(client, clientRows, ownerName)}>
              <FileDown className="h-3.5 w-3.5" aria-hidden /> Client report (PDF)
            </Button>
          )}
          {canExportData() && (
            <Button size="sm" variant="outline" className={WS_BTN} onClick={exportXlsx} disabled={!total}>
              <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden /> Export to Excel
            </Button>
          )}
        </>} />

      {list.error ? (
        <Note tone="warn">Couldn't load the matters: {list.error instanceof Error ? list.error.message : String(list.error)}{' '}
          <Button variant="link" className="h-auto p-0 text-xs" onClick={() => list.refetch()}>Retry</Button></Note>
      ) : list.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : total === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {all.length === 0 ? 'No litigation matter yet. Create one from a notice, or with New matter.' : <>
            No {params.status === 'all' ? '' : `${params.status} `}matter matches{anyFilter ? ' these filters' : ''}.{' '}
            {anyFilter && <button type="button" className="text-primary underline underline-offset-2"
              onClick={() => update({ stage: undefined, client: undefined, owner: undefined, lifecycle: undefined, priority: undefined, age: undefined, clock: undefined, q: undefined, page: 1 })}>Clear filters</button>}
            {!anyFilter && params.status !== 'all' && <button type="button" className="text-primary underline underline-offset-2" onClick={() => update({ status: 'all', page: 1 })}>Show all matters</button>}
          </>}
        </div>
      ) : (
        <>
          <MatterTable rows={rows} sort={sortKey} dir={sortDir} onSort={onSort} ownerName={ownerName} showClient={!params.client}
            total={{ count: openRows.length, exposure }} />
          <Pager page={page} pageSize={PAGE_SIZE} total={total} onPage={(p) => update({ page: p })} />
          <p className="text-xs text-muted-foreground">
            Outstanding is demand less paid less pre-deposit, on open matters — the same figure the command centre adds to notices' exposure.
            Clocks are calendar days in IST.
          </p>
        </>
      )}

      <CreateMatterDialog open={creating} onOpenChange={(o) => { setCreating(o); if (!o) setSuggestion(null); }} clients={clients}
        defaultClientId={params.client ?? null} suggestion={suggestion} onCreated={refresh} />
    </NoticesShell>
  );
};

export default LitigationMattersPage;
