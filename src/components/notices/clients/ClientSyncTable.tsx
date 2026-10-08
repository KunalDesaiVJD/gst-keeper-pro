// Freshness by client (target-sync.png; audit U-50-1, U-50-4..6, U-51-1, U-51-3,
// U-53-3): last good pull as an age, the failure in words with its one fix,
// the steps of the last run, open notices that link to their list, and a row
// menu; a card list on phones and a bulk bar that appears only with a selection.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, Check, Copy, DownloadCloud, MoreHorizontal, RefreshCw, Settings2, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/gstr9/badge';
import { WS_BTN, WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TH, WS_TR } from '@/components/workspace/theme';
import { noticesListHref } from '@/lib/noticeQueries';
import { fmtAgo, fmtDateTime, plural } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';
import { PortalLoginPopover } from './PortalLoginPopover';
import { OwnerPopover } from './OwnerPopover';
import {
  OFF_LABEL, STEP_LABEL, reasonDef, syncableIds, tsCmp,
  type ClientHealth, type FailureRun, type OpenCounts, type Step,
} from './syncHealth';
import type { Started } from './useClientSync';

export type ClientSort = 'attention' | 'client' | 'pull' | 'open';

export interface RowHandlers {
  canSync: boolean;
  canEditClients: boolean;
  canDelete: boolean;
  onSync: (ids: string[]) => void;
  onFetchProfile: (ids: string[]) => void;
  onSetting: (rows: ClientHealth[]) => void;
  onDelete: (h: ClientHealth) => void;
  onChanged: () => void;
}

const timeIst = (ts: string | number) => new Date(ts).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });

function detailsText(h: ClientHealth): string {
  return [
    `${h.client.name} (${h.client.gstin})`,
    `${reasonDef(h.failReason).long} — step ${STEP_LABEL[h.failStep ?? ''] ?? h.failStep}, ${fmtDateTime(h.failAt)}`,
    `Reason code: ${h.failReason}`,
    h.steps[h.failStep as Step]?.last_ext_version ? `Extension v${h.steps[h.failStep as Step]?.last_ext_version}` : '',
    h.failMessage ? `Portal / extension said: ${h.failMessage}` : '',
  ].filter(Boolean).join('\n');
}

const copyDetails = async (h: ClientHealth) => {
  try {
    await navigator.clipboard.writeText(detailsText(h));
    toast.success('Error details copied — send them to whoever looks after the app.');
  } catch {
    toast.error("Couldn't copy; open Details and copy the text by hand.");
  }
};

/** The raw message behind a failure, out of the way until asked for (U-50-1, cross-cutting "machine text"). */
const FailureDetails: React.FC<{ h: ClientHealth }> = ({ h }) => (
  <Popover>
    <PopoverTrigger asChild>
      <button type="button" className="text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Details<span className="sr-only"> of the failure for {h.client.name}</span>
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-80 space-y-2 text-xs">
      <div className="text-sm font-semibold">{reasonDef(h.failReason).long}</div>
      <p>{reasonDef(h.failReason).hint}</p>
      <dl className="grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-0.5">
        <dt className="text-muted-foreground">Step</dt><dd>{STEP_LABEL[h.failStep ?? ''] ?? h.failStep}</dd>
        <dt className="text-muted-foreground">When</dt><dd>{fmtDateTime(h.failAt)}</dd>
        <dt className="text-muted-foreground">Reason code</dt><dd className="font-mono">{h.failReason}</dd>
      </dl>
      {h.failMessage && <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 font-mono text-[11px] text-foreground">{h.failMessage}</pre>}
      <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => copyDetails(h)}><Copy className="h-3.5 w-3.5" aria-hidden /> Copy details</Button>
    </PopoverContent>
  </Popover>
);

/** Fresh / stale / never / failing, in words beside the colour (U-50-1), plus this session's run state (U-50-4). */
export const StatusCell: React.FC<{ h: ClientHealth; run?: FailureRun; started: Started | null }> = ({ h, run, started }) => {
  const startedAt = started?.mode === 'notices_bundle' && started.ids.has(h.client.id) ? started.at : null;
  const startedIso = startedAt !== null ? new Date(startedAt).toISOString() : null;
  const doneSince = !!startedIso && !!h.lastSuccessAt && tsCmp(h.lastSuccessAt, startedIso) > 0;
  const triedSince = !!startedIso && !!h.lastAttemptAt && tsCmp(h.lastAttemptAt, startedIso) > 0;
  return (
    <div className="min-w-0 space-y-0.5">
      <div className="flex flex-wrap items-center gap-1">
        {h.state === 'failed' && <Badge variant="destructive" className="text-[11px]">{reasonDef(h.failReason).label}</Badge>}
        {h.state === 'never' && <Badge variant="warning" className="text-[11px]">{h.passwordReset ? 'Password changed · not synced yet' : 'Never synced'}</Badge>}
        {h.state === 'stale' && <Badge variant="warning" className="text-[11px]">Not synced in 24 h</Badge>}
        {h.state === 'fresh' && <Badge variant="success" className="text-[11px]">Synced</Badge>}
        {h.state === 'off' && h.off && <Badge variant="secondary" className="text-[11px]">{OFF_LABEL[h.off]}</Badge>}
        {startedAt !== null && !triedSince && <Badge variant="info" className="text-[11px]">Queued {timeIst(startedAt)}</Badge>}
        {doneSince && <Badge variant="success" className="text-[11px]">Done {timeIst(h.lastSuccessAt as string)}</Badge>}
      </div>
      {h.state === 'failed' && (
        <div className="text-xs text-muted-foreground">
          {run ? <>failing since {fmtAgo(run.since)} · {plural(run.tries, 'try', 'tries')}</> : <>failed {fmtAgo(h.failAt)}</>}
          {' · '}<FailureDetails h={h} />
        </div>
      )}
      {h.state === 'fresh' && h.steps.notices?.last_status === 'held' && (
        <div className="text-xs text-muted-foreground">removal held back: {h.steps.notices.last_message ?? 'see the sync log'}</div>
      )}
    </div>
  );
};

export const PullCell: React.FC<{ h: ClientHealth }> = ({ h }) => {
  const n = h.steps.notices;
  const triedLater = h.lastAttemptAt && (!h.lastSuccessAt || tsCmp(h.lastAttemptAt, h.lastSuccessAt) > 0);
  return (
    <div className="text-xs leading-tight">
      <div className={cn('text-sm font-semibold tabular-nums', h.eligible && !h.fresh && 'text-destructive-strong')}>
        {h.lastSuccessAt ? fmtAgo(h.lastSuccessAt) : 'never'}
      </div>
      {h.lastSuccessAt && n && <div className="text-muted-foreground">{n.rows_seen ?? 0} on portal · {n.rows_new ?? 0} new · {n.rows_changed ?? 0} changed</div>}
      {triedLater && <div className="text-muted-foreground">tried {fmtAgo(h.lastAttemptAt)}</div>}
    </div>
  );
};

export const StepChips: React.FC<{ h: ClientHealth }> = ({ h }) => {
  const steps: Step[] = ['notices', 'refunds', 'drc03'];
  const shown = steps.filter((s) => h.steps[s]);
  if (!shown.length) return <span className="text-xs text-muted-foreground">no pull on record</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((s) => {
        const st = h.steps[s];
        const bad = st?.last_status === 'failed';
        const skipped = st?.last_status === 'skipped';
        return (
          <Badge key={s} variant={bad ? 'destructive' : skipped ? 'secondary' : 'success'} className="gap-0.5 text-[11px]"
            title={bad ? `${STEP_LABEL[s]}: ${reasonDef(st?.last_reason_class).label} ${fmtAgo(st?.last_attempt_at)}` : `${STEP_LABEL[s]}: last pulled ${fmtAgo(st?.last_success_at)}`}>
            {STEP_LABEL[s]}
            {bad ? <X className="h-3 w-3" aria-hidden /> : skipped ? null : <Check className="h-3 w-3" aria-hidden />}
            <span className="sr-only">{bad ? ' failed' : skipped ? ' skipped' : ' pulled'}</span>
          </Badge>
        );
      })}
    </div>
  );
};

export const OpenCell: React.FC<{ h: ClientHealth; c?: OpenCounts }> = ({ h, c }) => {
  if (!c?.open) return <span className="text-xs text-muted-foreground">none open</span>;
  return (
    <div className="text-xs leading-tight">
      <Link to={noticesListHref({ client: h.client.id })} className="font-semibold text-foreground underline-offset-2 hover:underline">
        {c.open} open<span className="sr-only"> notices for {h.client.name}</span>
      </Link>
      {c.overdue > 0 && (
        <div><Link to={noticesListHref({ filter: 'overdue', client: h.client.id })} className="font-medium text-destructive-strong underline-offset-2 hover:underline">
          {c.overdue} overdue<span className="sr-only"> for {h.client.name}</span></Link></div>
      )}
      {c.due7 > 0 && (
        <div><Link to={noticesListHref({ filter: 'due7', client: h.client.id })} className="text-muted-foreground underline-offset-2 hover:underline">
          {c.due7} due in 7 d<span className="sr-only"> for {h.client.name}</span></Link></div>
      )}
    </div>
  );
};

/** The one next step for the row's state (U-51-1). */
export const NextStep: React.FC<{ h: ClientHealth; handlers: RowHandlers; busy: boolean }> = ({ h, handlers, busy }) => {
  const sync = (label: string) => (
    <Button size="sm" variant="outline" className={WS_BTN} disabled={busy} onClick={() => handlers.onSync([h.client.id])}>
      <RefreshCw className="h-3.5 w-3.5" aria-hidden /> {label}<span className="sr-only"> {h.client.name}</span>
    </Button>
  );
  const login = (label: string) => handlers.canEditClients
    ? <PortalLoginPopover client={h.client} label={label} onSaved={({ retry }) => { handlers.onChanged(); if (retry) handlers.onSync([h.client.id]); }} />
    : <span className="text-xs text-muted-foreground">ask a manager to {label.toLowerCase()}</span>;
  if (h.state === 'off') {
    if (h.off === 'no_user_id') return login('Add portal user ID');
    return handlers.canEditClients
      ? <Button size="sm" variant="outline" className={WS_BTN} onClick={() => handlers.onSetting([h])}><Settings2 className="h-3.5 w-3.5" aria-hidden /> Change<span className="sr-only"> sync setting for {h.client.name}</span></Button>
      : <span className="text-xs text-muted-foreground">—</span>;
  }
  if (h.state === 'failed') {
    const action = reasonDef(h.failReason).action;
    if (action === 'password') return login('Update password');
    if (action === 'report') {
      return (
        <Button size="sm" variant="outline" className={WS_BTN} onClick={() => copyDetails(h)}>
          <Copy className="h-3.5 w-3.5" aria-hidden /> Report<span className="sr-only"> the error for {h.client.name}</span>
        </Button>
      );
    }
    return handlers.canSync ? sync('Retry') : <span className="text-xs text-muted-foreground">—</span>;
  }
  if (h.state === 'never' || h.state === 'stale') return handlers.canSync ? sync('Sync') : <span className="text-xs text-muted-foreground">—</span>;
  return <span className="text-xs text-muted-foreground">nothing to do</span>;
};

// Not modal: a modal menu hides the rest of the page from screen readers while its links stay focusable (axe aria-hidden-focus).
const RowMenu: React.FC<{ h: ClientHealth; handlers: RowHandlers }> = ({ h, handlers }) => (
  <DropdownMenu modal={false}>
    <DropdownMenuTrigger asChild>
      <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`More for ${h.client.name}`}><MoreHorizontal className="h-4 w-4" /></Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      {handlers.canSync && h.client.gst_user_id && !h.client.notices_sync_excluded && (
        <DropdownMenuItem onSelect={() => handlers.onSync([h.client.id])}><RefreshCw className="mr-2 h-4 w-4" aria-hidden /> Sync now</DropdownMenuItem>
      )}
      {handlers.canSync && h.client.gst_user_id && (
        <DropdownMenuItem onSelect={() => handlers.onFetchProfile([h.client.id])}><DownloadCloud className="mr-2 h-4 w-4" aria-hidden /> Fetch portal profile</DropdownMenuItem>
      )}
      <DropdownMenuItem asChild><Link to={`/notices-company-list?tab=log&client=${h.client.id}`}>Sync log for this client</Link></DropdownMenuItem>
      <DropdownMenuItem asChild><Link to={`/notices-company/${h.client.id}`}>Client profile</Link></DropdownMenuItem>
      {handlers.canEditClients && <DropdownMenuItem onSelect={() => handlers.onSetting([h])}><Settings2 className="mr-2 h-4 w-4" aria-hidden /> Sync setting…</DropdownMenuItem>}
      {handlers.canEditClients && <DropdownMenuItem asChild><Link to={`/edit-client/${h.client.id}`}>Edit client</Link></DropdownMenuItem>}
      {handlers.canDelete && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive-strong focus:text-destructive-strong" onSelect={() => handlers.onDelete(h)}>
            <Trash2 className="mr-2 h-4 w-4" aria-hidden /> Delete client…
          </DropdownMenuItem>
        </>
      )}
    </DropdownMenuContent>
  </DropdownMenu>
);

/** GSTIN and owner under the name; the owner changes in place (U-50-6). */
const ClientSub: React.FC<{ h: ClientHealth; handlers: RowHandlers }> = ({ h, handlers }) => (
  <div className="flex min-w-0 flex-wrap items-center gap-x-1 text-[11px] text-muted-foreground">
    <span className="font-mono">{h.client.gstin}</span>
    <span aria-hidden>·</span>
    {handlers.canEditClients
      ? <OwnerPopover client={h.client} onSaved={handlers.onChanged} />
      : <span>{h.client.assigned_accountant || 'no owner'}</span>}
  </div>
);

const SortHead: React.FC<{ label: string; k: ClientSort; sort: ClientSort; dir: 'asc' | 'desc'; onSort: (k: ClientSort) => void; className?: string }> = ({ label, k, sort, dir, onSort, className }) => (
  <th scope="col" className={cn(WS_TH, className)} aria-sort={sort === k ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
    <button type="button" onClick={() => onSort(k)} className="inline-flex items-center gap-1 rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {label}{sort === k && (dir === 'asc' ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />)}
    </button>
  </th>
);

export const ClientSyncTable: React.FC<{
  rows: ClientHealth[];
  counts: Map<string, OpenCounts>;
  failRuns: Map<string, FailureRun>;
  started: Started | null;
  busy: boolean;
  sort: ClientSort;
  dir: 'asc' | 'desc';
  onSort: (k: ClientSort) => void;
  handlers: RowHandlers;
}> = ({ rows, counts, failRuns, started, busy, sort, dir, onSort, handlers }) => {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const ids = rows.map((r) => r.client.id);
  const picked = rows.filter((r) => selected.has(r.client.id));
  const allOn = ids.length > 0 && ids.every((id) => selected.has(id));
  const toggle = (id: string, on: boolean) => setSelected((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  // Rows that leave the page (a new filter or page) leave the selection too.
  React.useEffect(() => { setSelected((s) => new Set([...s].filter((id) => ids.includes(id)))); }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const canSelect = handlers.canSync || handlers.canEditClients;
  const pickedSyncable = syncableIds(picked);

  return (
    <>
      {/* Phones and tablets: cards. */}
      <ul className="space-y-2 lg:hidden">
        {rows.map((h) => (
          <li key={h.client.id} className={cn('rounded-lg border bg-card p-3', h.state === 'failed' && 'border-destructive/50')}>
            <div className="flex items-start gap-2">
              {canSelect && <Checkbox checked={selected.has(h.client.id)} onCheckedChange={(v) => toggle(h.client.id, !!v)} aria-label={`Select ${h.client.name}`} className="mt-0.5" />}
              <div className="min-w-0 flex-1">
                <Link to={`/notices-company/${h.client.id}`} className="block break-words text-sm font-semibold hover:underline">{h.client.name}</Link>
                <ClientSub h={h} handlers={handlers} />
              </div>
              <RowMenu h={h} handlers={handlers} />
            </div>
            <div className="mt-2 space-y-1.5">
              <StatusCell h={h} run={failRuns.get(h.client.id)} started={started} />
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-1"><span className="sr-only">Last good pull: </span><PullCell h={h} /><StepChips h={h} /></div>
                <OpenCell h={h} c={counts.get(h.client.id)} />
              </div>
              <div className="flex justify-end"><NextStep h={h} handlers={handlers} busy={busy} /></div>
            </div>
          </li>
        ))}
      </ul>

      <div className={cn(WS_TABLE_WRAP, 'hidden lg:block')}>
        <table className={WS_TABLE}>
          <thead>
            <tr>
              {canSelect && (
                <th scope="col" className={cn(WS_TH, 'w-8')}>
                  <Checkbox checked={allOn} onCheckedChange={(v) => setSelected(v ? new Set(ids) : new Set())} aria-label="Select every client on this page" />
                </th>
              )}
              <SortHead label="Client" k="client" sort={sort} dir={dir} onSort={onSort} />
              <SortHead label="Last good pull" k="pull" sort={sort} dir={dir} onSort={onSort} />
              <th scope="col" className={WS_TH}>Status</th>
              <th scope="col" className={WS_TH}>Steps</th>
              <SortHead label="Open notices" k="open" sort={sort} dir={dir} onSort={onSort} />
              <th scope="col" className={WS_TH}>Next step</th>
              <th scope="col" className={cn(WS_TH, 'w-10')}><span className="sr-only">More</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => (
              <tr key={h.client.id} className={cn(WS_TR, selected.has(h.client.id) && 'bg-primary/5', h.state === 'failed' && 'bg-destructive/[0.03]')}>
                {canSelect && (
                  <td className={WS_TD}><Checkbox checked={selected.has(h.client.id)} onCheckedChange={(v) => toggle(h.client.id, !!v)} aria-label={`Select ${h.client.name}`} /></td>
                )}
                <td className={cn(WS_TD, 'max-w-[15rem]')}>
                  <Link to={`/notices-company/${h.client.id}`} className="block truncate font-medium hover:underline">{h.client.name}</Link>
                  <ClientSub h={h} handlers={handlers} />
                </td>
                <td className={cn(WS_TD, 'whitespace-nowrap')}><PullCell h={h} /></td>
                <td className={cn(WS_TD, 'min-w-[13rem]')}><StatusCell h={h} run={failRuns.get(h.client.id)} started={started} /></td>
                <td className={WS_TD}><StepChips h={h} /></td>
                <td className={cn(WS_TD, 'whitespace-nowrap')}><OpenCell h={h} c={counts.get(h.client.id)} /></td>
                <td className={cn(WS_TD, 'whitespace-nowrap')}><NextStep h={h} handlers={handlers} busy={busy} /></td>
                <td className={WS_TD}><RowMenu h={h} handlers={handlers} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canSelect && picked.length > 0 && (
        <div role="toolbar" aria-label="Bulk actions"
          className="fixed inset-x-0 bottom-4 z-40 mx-auto flex w-fit max-w-[calc(100vw-2rem)] flex-wrap items-center gap-2 rounded-full border bg-card px-4 py-2 shadow-lg">
          <span className="text-xs font-semibold">{plural(picked.length, 'client')} selected</span>
          {handlers.canSync && (
            <Button size="sm" className="h-8 gap-1 rounded-full text-xs" disabled={busy || !pickedSyncable.length} onClick={() => handlers.onSync(pickedSyncable)}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Sync {pickedSyncable.length}
            </Button>
          )}
          {handlers.canSync && (
            <Button size="sm" variant="outline" className="h-8 gap-1 rounded-full text-xs" disabled={busy || !pickedSyncable.length} onClick={() => handlers.onFetchProfile(pickedSyncable)}>
              <DownloadCloud className="h-3.5 w-3.5" aria-hidden /> Fetch profile
            </Button>
          )}
          {handlers.canEditClients && (
            <Button size="sm" variant="outline" className="h-8 gap-1 rounded-full text-xs" onClick={() => handlers.onSetting(picked)}>
              <Settings2 className="h-3.5 w-3.5" aria-hidden /> Sync setting…
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-8 gap-1 rounded-full text-xs" onClick={() => setSelected(new Set())}><X className="h-3.5 w-3.5" aria-hidden /> Clear</Button>
          {pickedSyncable.length < picked.length && (
            <span className="text-[11px] text-muted-foreground">{picked.length - pickedSyncable.length} without a portal user ID or excluded</span>
          )}
        </div>
      )}
    </>
  );
};

export default ClientSyncTable;
