// The sync log as a page section with its own URL (audit U-52-1..3; target
// "Today's run log"): the runs, then one line per client and step of the chosen
// run with what it found, filterable and exportable; the extension's own
// message log below, its diagnostic rows behind a switch.
import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FileSpreadsheet, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Note } from '@/components/gstr9/ui';
import { SectionCard } from '@/components/notices/ui/Panel';
import { Badge } from '@/components/gstr9/badge';
import { WS_BTN, WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TH, WS_TR } from '@/components/workspace/theme';
import { FilterPill } from '@/components/notices/FilterPill';
import { Pager } from '@/components/notices/Pager';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { fmtAgo, fmtDateTime, plural } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';
import { STEP_LABEL, reasonDef, type SyncItem, type SyncRun } from './syncHealth';

type LogRow = Database['public']['Tables']['client_sync_log']['Row'];
type Names = Map<string, { name: string; gstin: string }>;

const PAGE = 50;
const RESULT_LABEL: Record<string, string> = { ok: 'Pulled', held: 'Removal held back', failed: 'Failed', skipped: 'Skipped' };
const RUN_STATUS: Record<string, { label: string; tone: 'success' | 'info' | 'warning' | 'destructive' | 'secondary' }> = {
  done: { label: 'Done', tone: 'success' },
  running: { label: 'Running', tone: 'info' },
  stopped: { label: 'Stopped', tone: 'secondary' },
  abandoned: { label: 'Abandoned', tone: 'warning' },
  failed: { label: 'Failed', tone: 'destructive' },
};
const ACTION_LABEL: Record<string, string> = {
  notices: 'Notices', login_failed: 'Login', refunds_debug: 'Refunds (diagnostic)', notices_gstr3a_debug: 'GSTR-3A (diagnostic)',
  notices_guard: 'Removal guard (diagnostic)',
};
const isDiagnostic = (action: string) => /_debug$/.test(action) || action === 'notices_guard';

const minutes = (a: string, b: string | null) => (b ? Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60000)) : null);

/** Long portal text: two lines, the rest on request (U-52-2). */
const Clamp: React.FC<{ text: string | null }> = ({ text }) => {
  const [open, setOpen] = useState(false);
  if (!text) return <span className="text-muted-foreground">—</span>;
  const long = text.length > 110;
  return (
    <span className="block min-w-0 text-xs">
      <span className={cn('block break-words', !open && long && 'line-clamp-2')}>{text}</span>
      {long && (
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
          className="text-[11px] font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {open ? 'less' : 'more'}
        </button>
      )}
    </span>
  );
};

const ResultBadge: React.FC<{ r: SyncItem }> = ({ r }) => (
  <Badge variant={r.status === 'ok' ? 'success' : r.status === 'held' ? 'warning' : r.status === 'failed' ? 'destructive' : 'secondary'} className="whitespace-nowrap text-[11px]">
    {r.status === 'failed' ? reasonDef(r.reason_class).label : RESULT_LABEL[r.status] ?? r.status}
  </Badge>
);

const counts = (r: SyncItem) => r.status === 'failed' || r.status === 'skipped' ? '—'
  : `${r.rows_seen} on portal · ${r.rows_new} new · ${r.rows_changed} changed · ${r.rows_removed} removed${r.rows_held ? ` · ${r.rows_held} held` : ''}`;

export const SyncLogTab: React.FC<{ runs: SyncRun[]; runsLoading: boolean; names: Names; canExport: boolean }> = ({ runs, runsLoading, names, canExport }) => {
  const [sp, setSp] = useSearchParams();
  const client = sp.get('client');
  const runParam = sp.get('run');
  const runId = runParam === 'all' || (!runParam && client) ? null : runParam ?? runs[0]?.id ?? null;
  const run = runs.find((r) => r.id === runId) ?? null;
  const step = sp.get('step') ?? 'all';
  const result = sp.get('result') ?? 'all';
  const page = Math.max(1, Number(sp.get('lpage')) || 1);
  const debug = sp.get('debug') === '1';
  const mpage = Math.max(1, Number(sp.get('mpage')) || 1);
  const [exporting, setExporting] = useState(false);

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp);
    Object.entries(patch).forEach(([k, v]) => { if (v === null || v === '' || v === 'all') next.delete(k); else next.set(k, v); });
    if (!('lpage' in patch)) next.delete('lpage');
    setSp(next);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filter = (q: any) => {
    if (runId) q = q.eq('run_id', runId);
    if (step !== 'all') q = q.eq('step', step);
    if (result !== 'all') q = q.eq('status', result);
    if (client) q = q.eq('client_id', client);
    return q;
  };
  const items = useQuery({
    queryKey: ['sync-log-items', runId, step, result, client, page],
    enabled: !runsLoading,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const from = (page - 1) * PAGE;
      const { data, error, count } = await filter(supabase.from('sync_run_items').select('*', { count: 'exact' }))
        .order('created_at', { ascending: false }).order('id').range(from, from + PAGE - 1);
      if (error) throw error;
      return { rows: (data ?? []) as SyncItem[], total: count ?? 0 };
    },
  });
  const messages = useQuery({
    queryKey: ['sync-log-messages', client, debug, mpage],
    placeholderData: (prev) => prev,
    queryFn: async () => {
      let q = supabase.from('client_sync_log').select('*', { count: 'exact' });
      if (client) q = q.eq('client_id', client);
      if (!debug) q = q.not('action', 'like', '%\\_debug').neq('action', 'notices_guard');
      const from = (mpage - 1) * PAGE;
      const { data, error, count } = await q.order('created_at', { ascending: false }).order('id').range(from, from + PAGE - 1);
      if (error) throw error;
      return { rows: (data ?? []) as LogRow[], total: count ?? 0 };
    },
  });

  const exportXlsx = async () => {
    setExporting(true);
    try {
      const rows = await fetchAllRows<SyncItem>('sync_run_items', '*', (q) => filter(q).order('created_at', { ascending: false }).order('id'));
      const runStart = new Map(runs.map((r) => [r.id, r.started_at]));
      const ws = XLSX.utils.json_to_sheet(rows.map((r) => ({
        Client: names.get(r.client_id)?.name ?? r.client_id, GSTIN: names.get(r.client_id)?.gstin ?? '', 'Time (IST)': fmtDateTime(r.created_at),
        Step: STEP_LABEL[r.step] ?? r.step, Result: RESULT_LABEL[r.status] ?? r.status, Reason: r.reason_class ? reasonDef(r.reason_class).long : '',
        'On portal': r.rows_seen, New: r.rows_new, Changed: r.rows_changed, Removed: r.rows_removed, Held: r.rows_held,
        Message: r.message ?? '', 'Run started': r.run_id && runStart.get(r.run_id) ? fmtDateTime(runStart.get(r.run_id)) : '', Extension: r.ext_version ?? '',
      })));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Sync log');
      XLSX.writeFile(wb, `Sync log${run ? ` — ${fmtDateTime(run.started_at).replace(/[,:]/g, '')}` : ''}${client ? ` — ${names.get(client)?.name ?? 'client'}` : ''}.xlsx`);
      toast.success(`Exported ${plural(rows.length, 'line')}`);
    } catch (e) {
      toast.error(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setExporting(false); }
  };

  const clientName = client ? names.get(client)?.name ?? 'one client' : null;
  const total = items.data?.total ?? 0;

  return (
    <div className="space-y-3">
      <SectionCard title="Runs" description="Each Sync now or scheduled run · newest first">
        {runsLoading ? <Skeleton className="h-24 w-full" /> : runs.length === 0 ? (
          <p className="text-xs text-muted-foreground">No run recorded yet. Extension v0.5.0 and later record every run here.</p>
        ) : (
          <ul className="divide-y" aria-label="Sync runs">
            <li>
              <Link to={`?${new URLSearchParams({ tab: 'log', run: 'all', ...(client ? { client } : {}) }).toString()}`} aria-current={runId === null ? 'true' : undefined}
                className={cn('flex items-center gap-2 rounded px-1.5 py-1.5 text-xs hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', runId === null && 'bg-primary/5 font-semibold')}>
                All runs
              </Link>
            </li>
            {runs.map((r) => {
              const st = RUN_STATUS[r.status] ?? { label: r.status, tone: 'secondary' as const };
              const dur = minutes(r.started_at, r.finished_at);
              return (
                <li key={r.id}>
                  <Link to={`?${new URLSearchParams({ tab: 'log', run: r.id, ...(client ? { client } : {}) }).toString()}`} aria-current={r.id === runId ? 'true' : undefined}
                    className={cn('flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded px-1.5 py-1.5 text-xs hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', r.id === runId && 'bg-primary/5')}>
                    <span className="font-semibold tabular-nums">{fmtDateTime(r.started_at)}</span>
                    <Badge variant={st.tone} className="text-[11px]">{st.label}</Badge>
                    <span className="text-foreground/70">
                      {r.clients_total ? `${r.clients_done} of ${plural(r.clients_total, 'client')}` : plural(r.clients_done, 'client')}
                      {dur !== null ? ` · ${dur} min` : ` · started ${fmtAgo(r.started_at)}`}
                      {r.ext_version ? ` · extension v${r.ext_version}` : ''}{r.note ? ` · ${r.note}` : ''}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title={run ? `Run of ${fmtDateTime(run.started_at)}` : 'Every run'}
        description="One line per client and step: what the portal showed and what changed here"
        actions={canExport && (
          <Button size="sm" variant="outline" className={WS_BTN} onClick={exportXlsx} disabled={exporting || !total}>
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden />} Export to Excel
          </Button>
        )}>
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterPill label="Step" allLabel="Any" value={step} onChange={(v) => set({ step: v })} options={[]}
            extraOptions={['login', 'notices', 'case_folder', 'refunds', 'drc03'].map((s) => ({ value: s, label: STEP_LABEL[s] }))} />
          <FilterPill label="Result" allLabel="Any" value={result} onChange={(v) => set({ result: v })} options={[]}
            extraOptions={Object.entries(RESULT_LABEL).map(([value, label]) => ({ value, label }))} />
          {clientName && (
            <button type="button" onClick={() => set({ client: null, run: null })}
              className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Remove filter Client: ${clientName}`}>
              Client: {clientName} <X className="h-3 w-3" aria-hidden />
            </button>
          )}
          <span className="ml-auto text-xs text-muted-foreground" aria-live="polite">{items.isLoading ? '…' : plural(total, 'line')}</span>
        </div>
        {items.error ? (
          <Note tone="warn">Couldn't load the log: {items.error instanceof Error ? items.error.message : String(items.error)}</Note>
        ) : items.isLoading ? <Skeleton className="h-40 w-full" /> : total === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Nothing in the log for these filters.</p>
        ) : (
          <>
            <ul className="space-y-2 md:hidden">
              {(items.data?.rows ?? []).map((r) => (
                <li key={r.id} className="rounded-lg border p-2.5 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <Link to={`/notices-company/${r.client_id}`} className="min-w-0 break-words font-medium hover:underline">{names.get(r.client_id)?.name ?? 'Client'}</Link>
                    <ResultBadge r={r} />
                  </div>
                  <div className="text-muted-foreground">{fmtDateTime(r.created_at)} · {STEP_LABEL[r.step] ?? r.step}</div>
                  <div>{counts(r)}</div>
                  <Clamp text={r.message} />
                </li>
              ))}
            </ul>
            <div className={cn(WS_TABLE_WRAP, 'hidden md:block')}>
              <table className={WS_TABLE}>
                <thead><tr>
                  <th scope="col" className={WS_TH}>Time</th>
                  <th scope="col" className={WS_TH}>Client</th>
                  <th scope="col" className={WS_TH}>Step</th>
                  <th scope="col" className={WS_TH}>Result</th>
                  <th scope="col" className={WS_TH}>Rows</th>
                  <th scope="col" className={WS_TH}>Message</th>
                </tr></thead>
                <tbody>
                  {(items.data?.rows ?? []).map((r) => (
                    <tr key={r.id} className={WS_TR}>
                      <td className={cn(WS_TD, 'whitespace-nowrap text-xs tabular-nums')}>{fmtDateTime(r.created_at)}</td>
                      <td className={cn(WS_TD, 'max-w-[14rem]')}>
                        <Link to={`/notices-company/${r.client_id}`} className="block truncate text-xs font-medium hover:underline">{names.get(r.client_id)?.name ?? 'Client'}</Link>
                        <div className="truncate font-mono text-[11px] text-muted-foreground">{names.get(r.client_id)?.gstin}</div>
                      </td>
                      <td className={cn(WS_TD, 'whitespace-nowrap text-xs')}>{STEP_LABEL[r.step] ?? r.step}{r.scope ? <span className="block font-mono text-[11px] text-muted-foreground">{r.scope}</span> : null}</td>
                      <td className={WS_TD}><ResultBadge r={r} /></td>
                      <td className={cn(WS_TD, 'text-xs')}>{counts(r)}</td>
                      <td className={cn(WS_TD, 'min-w-[16rem] max-w-[28rem]')}><Clamp text={r.message} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} pageSize={PAGE} total={total} onPage={(p) => set({ lpage: String(p) })} />
          </>
        )}
      </SectionCard>

      <SectionCard title="Extension messages" description="What the extension wrote per client, in its own words (older versions write only here)"
        actions={(
          <div className="flex items-center gap-2">
            <Switch id="sync-log-debug" checked={debug} onCheckedChange={(v) => set({ debug: v ? '1' : null, mpage: null })} />
            <Label htmlFor="sync-log-debug" className="text-xs font-normal">Show diagnostic rows</Label>
          </div>
        )}>
        {messages.error ? (
          <Note tone="warn">Couldn't load the messages: {messages.error instanceof Error ? messages.error.message : String(messages.error)}</Note>
        ) : messages.isLoading ? <Skeleton className="h-24 w-full" /> : (messages.data?.total ?? 0) === 0 ? (
          <p className="text-xs text-muted-foreground">No messages{clientName ? ` for ${clientName}` : ''}.</p>
        ) : (
          <>
            <ul className="divide-y">
              {(messages.data?.rows ?? []).map((m) => (
                <li key={m.id} className="grid grid-cols-1 gap-x-3 gap-y-0.5 py-1.5 text-xs sm:grid-cols-[9.5rem_minmax(0,12rem)_minmax(0,1fr)]">
                  <span className="tabular-nums text-muted-foreground">{fmtDateTime(m.created_at)}</span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{names.get(m.client_id)?.name ?? 'Client'}</span>
                    <span className="flex flex-wrap items-center gap-1">
                      <span className="text-muted-foreground">{ACTION_LABEL[m.action] ?? m.action}</span>
                      <Badge variant={m.status === 'success' ? (isDiagnostic(m.action) ? 'secondary' : 'success') : 'destructive'} className="text-[10px]">
                        {m.status === 'success' ? 'ok' : 'failed'}
                      </Badge>
                    </span>
                  </span>
                  <Clamp text={m.message} />
                </li>
              ))}
            </ul>
            <Pager page={mpage} pageSize={PAGE} total={messages.data?.total ?? 0} onPage={(p) => set({ mpage: String(p) })} />
          </>
        )}
      </SectionCard>
    </div>
  );
};

export default SyncLogTab;
