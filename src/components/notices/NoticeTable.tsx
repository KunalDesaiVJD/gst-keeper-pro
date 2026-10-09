// The notice list (audit U-20-1..6, U-31-*, U-33-*): eight columns that say
// what the notice is and what is next, a card list on phones, the stage and
// owner changed in place, and a bulk bar that never reflows the filters —
// closing asks for a reason and every bulk change can be undone. Each row
// carries its type's reply need (Critical / Optional / Info only, contract §A).
// Since 9 October 2026 (the firm's request): a Select menu takes the page, every
// notice matching the filters (all pages), only the open or overdue ones, or one
// form; and the bar closes them in one go with a reason.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, CheckSquare, ChevronDown, FileText, Flag, Loader2, Lock, UserPlus, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub,
  DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ReadCloseDialog } from './workspace/ReadCloseDialog';
import { Badge } from '@/components/gstr9/badge';
import { WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TH, WS_TR } from '@/components/workspace/theme';
import { useAuth } from '@/contexts/AuthContext';
import type { NoticeFact } from '@/lib/noticeFacts';
import type { SortKey } from '@/lib/noticeQueries';
import { updateNotices } from '@/lib/noticeWrites';
import { stageLabel, type StageKey } from '@/lib/noticeStages';
import { closeReasonText, dueWords, fmtDate, fmtInrShort, noticeTitle, sentenceCase } from '@/lib/noticeFormat';
import { StagePicker } from './StagePicker';
import { StageBadge } from './StageBadge';
import { AssignPopover } from './AssignPopover';
import { OwnerChip } from './OwnerChip';
import { ResponseNeedChip } from './types/ResponseNeedChip';
import { cn } from '@/lib/utils';

export function DueCell({ r }: { r: NoticeFact }) {
  if (r.reply_date) return <span className="text-xs"><span className="block font-medium text-success-strong">Replied</span><span className="text-muted-foreground">{fmtDate(r.reply_date)}</span></span>;
  // A type that needs no reply has no reply clock: never late (contract §A).
  if (r.response_need === 'none') {
    return (
      <span className="text-xs leading-tight">
        {r.effective_due && <span className="block tabular-nums">{fmtDate(r.effective_due)}</span>}
        <span className="text-muted-foreground">no reply needed</span>
      </span>
    );
  }
  if (!r.effective_due) return <span className="text-xs text-muted-foreground">no due date</span>;
  const d = r.days_to_due ?? 0;
  const open = r.is_open;
  return (
    <span className="text-xs leading-tight">
      <span className={cn('block font-semibold tabular-nums', open && d < 0 && 'text-destructive-strong')}>{fmtDate(r.effective_due)}</span>
      <span className="text-muted-foreground">{open ? dueWords(d) : 'closed'}{r.due_basis === 'computed' ? ' · computed' : r.due_basis === 'extended' ? ' · extended' : ''}</span>
    </span>
  );
}

type Undo = { ids: string[]; prev: Map<string, StageKey> };

/** What the Select menu needs of every notice in the filtered list. */
export type SelectableRow = Pick<NoticeFact, 'id' | 'stage' | 'form_code' | 'form_label' | 'is_open' | 'is_overdue'>;

const CHUNK = 100;
const chunks = <T,>(a: T[]): T[][] => Array.from({ length: Math.ceil(a.length / CHUNK) }, (_, i) => a.slice(i * CHUNK, (i + 1) * CHUNK));

const SortHead: React.FC<{ label: string; k: SortKey; sort: SortKey; dir: 'asc' | 'desc'; onSort: (k: SortKey) => void; className?: string }> = ({ label, k, sort, dir, onSort, className }) => (
  <th scope="col" className={cn(WS_TH, className)} aria-sort={sort === k ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
    <button type="button" onClick={() => onSort(k)} className="inline-flex items-center gap-1 rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {label}{sort === k && (dir === 'asc' ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />)}
    </button>
  </th>
);

export const NoticeTable: React.FC<{
  rows: NoticeFact[];
  canEdit: boolean;
  sort: SortKey;
  dir: 'asc' | 'desc';
  onSort: (k: SortKey) => void;
  onChanged: () => void;
  showClient?: boolean;
  /** A total row under the demand column for the whole list (the exposure drill-down, U-24-1). */
  footerTotal?: { label: string; amount: number } | null;
  /** Every notice matching the list's filters (all pages), for the Select menu. */
  loadAll?: () => Promise<SelectableRow[]>;
  /** How many notices match the filters. */
  total?: number;
  /** Changes when the filters change: a selection across pages is then dropped. */
  filterKey?: string;
}> = ({ rows, canEdit, sort, dir, onSort, onChanged, showClient = true, footerTotal, loadAll, total, filterKey }) => {
  const { user } = useAuth();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 'page': what is ticked on this page; 'filter': chosen from the whole filtered list (kept across pages).
  const [scope, setScope] = useState<'page' | 'filter'>('page');
  const [menuOpen, setMenuOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const all = useQuery({ queryKey: ['notice-list-all', filterKey], queryFn: () => loadAll!(), enabled: !!loadAll && menuOpen, staleTime: 30_000 });
  const ids = rows.map((r) => r.id as string);
  const allOn = ids.length > 0 && ids.every((id) => selected.has(id));
  const visibleSelected = ids.filter((id) => selected.has(id));
  const targets = scope === 'filter' ? [...selected] : visibleSelected;
  const toggle = (id: string, on: boolean) => setSelected((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  const pick = (list: SelectableRow[]) => { setScope('filter'); setSelected(new Set(list.map((r) => r.id as string))); };

  // Rows that left the page leave a page selection (U-31-3); a new filter drops any selection.
  React.useEffect(() => { if (scope === 'page') setSelected((s) => new Set([...s].filter((id) => ids.includes(id)))); }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { setSelected(new Set()); setScope('page'); }, [filterKey]);

  const forms = React.useMemo(() => {
    const m = new Map<string, { label: string; rows: SelectableRow[] }>();
    for (const r of all.data ?? []) {
      const k = r.form_code ?? '—';
      const e = m.get(k) ?? { label: r.form_code ? `${r.form_code}${r.form_label ? ` · ${r.form_label}` : ''}` : 'Form not known', rows: [] };
      e.rows.push(r); m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.rows.length - a.rows.length);
  }, [all.data]);

  const apply = async (targetIds: string[], payload: Parameters<typeof updateNotices>[1], what: string, undo?: Undo) => {
    if (!user) return;
    for (const part of chunks(targetIds)) {
      const { error } = await updateNotices(part, payload, user);
      if (error) { toast.error(`Couldn't update: ${error.message}`); onChanged(); return; }
    }
    setSelected(new Set()); setScope('page');
    onChanged();
    toast.success(`${what} · ${targetIds.length} notice${targetIds.length === 1 ? '' : 's'}`, undo ? {
      action: {
        label: 'Undo',
        onClick: async () => {
          const groups = new Map<StageKey, string[]>();
          undo.ids.forEach((id) => { const p = undo.prev.get(id); if (p) groups.set(p, [...(groups.get(p) ?? []), id]); });
          for (const [stage, gIds] of groups) for (const part of chunks(gIds)) await updateNotices(part, { stage }, user);
          onChanged();
        },
      },
    } : undefined);
  };
  const prevStages = (targetIds: string[]) => {
    const want = new Set(targetIds);
    const src: SelectableRow[] = [...(all.data ?? []), ...rows];
    return new Map(src.filter((r) => want.has(r.id as string)).map((r) => [r.id as string, (r.stage ?? 'new') as StageKey]));
  };

  const setStageFor = (targetIds: string[]) => async (stage: StageKey, reason?: string) =>
    apply(targetIds, stage === 'closed' ? { stage, close_reason: reason ?? null } : { stage }, stage === 'closed' ? 'Closed' : `Moved to ${stageLabel(stage)}`,
      { ids: targetIds, prev: prevStages(targetIds) });

  const selectMenu = canEdit && (
    <div className="flex flex-wrap items-center gap-2">
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className="h-8 gap-1 text-xs"><CheckSquare className="h-3.5 w-3.5" aria-hidden /> Select <ChevronDown className="h-3 w-3" aria-hidden /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuItem onSelect={() => { setScope('page'); setSelected(new Set(ids)); }}>This page ({ids.length})</DropdownMenuItem>
          {loadAll && (all.isLoading ? (
            <DropdownMenuLabel className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Counting every page…</DropdownMenuLabel>
          ) : all.data ? (
            <>
              <DropdownMenuItem onSelect={() => pick(all.data)}>All matching the filters ({all.data.length})</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => pick(all.data.filter((r) => r.is_open))}>Open only ({all.data.filter((r) => r.is_open).length})</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => pick(all.data.filter((r) => r.is_open && r.is_overdue))}>Overdue only ({all.data.filter((r) => r.is_open && r.is_overdue).length})</DropdownMenuItem>
              {forms.length > 1 && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>By form</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-80 w-80 overflow-y-auto">
                    {forms.map((f) => {
                      const open = f.rows.filter((r) => r.is_open);
                      return (
                        <DropdownMenuItem key={f.label} onSelect={() => pick(open.length ? open : f.rows)} className="text-xs">
                          <span className="min-w-0 flex-1 truncate">{f.label}</span>
                          <span className="ml-2 shrink-0 tabular-nums text-muted-foreground">{open.length ? `${open.length} open` : f.rows.length}</span>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
            </>
          ) : all.error ? <DropdownMenuLabel className="text-xs font-normal text-destructive-strong">Couldn't count the list</DropdownMenuLabel> : null)}
          {selected.size > 0 && <><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => { setSelected(new Set()); setScope('page'); }}>Clear the selection</DropdownMenuItem></>}
        </DropdownMenuContent>
      </DropdownMenu>
      {scope === 'filter' && selected.size > 0 && (
        <span className="text-xs text-muted-foreground">
          {selected.size} selected across {total && total > rows.length ? 'every page' : 'the list'}
        </span>
      )}
    </div>
  );

  return (
    <>
      {selectMenu}
      {/* Phones: cards (U-20-6). */}
      <ul className="space-y-2 lg:hidden">
        {rows.map((r) => (
          <li key={r.id} className={cn('rounded-lg border bg-card p-3', r.is_overdue && 'border-destructive/50')}>
            <div className="flex items-start gap-2">
              {canEdit && <Checkbox checked={selected.has(r.id as string)} onCheckedChange={(v) => toggle(r.id as string, !!v)} aria-label={`Select ${r.client_name} ${r.reference_number ?? ''}`} className="mt-0.5" />}
              <div className="min-w-0 flex-1">
                <Link to={`/notices/${r.id}`} className="block text-sm font-semibold hover:underline">{noticeTitle(r)}</Link>
                {showClient && <div className="truncate text-xs text-muted-foreground">{r.client_name} · <span className="font-mono">{r.client_gstin}</span></div>}
                <div className="truncate font-mono text-[11px] text-muted-foreground">{r.reference_number || r.case_id}</div>
              </div>
              <div className="shrink-0 text-right"><DueCell r={r} /></div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StageBadge stage={r.stage} since={r.stage_changed_at} by={r.stage_changed_by} />
              <ResponseNeedChip need={r.response_need} compact />
              {Number(r.amount_of_demand) > 0 && <span className="text-xs tabular-nums">{fmtInrShort(r.amount_of_demand)}</span>}
              <OwnerChip name={r.assign_to} showName className="ml-auto" />
            </div>
          </li>
        ))}
      </ul>

      <div className={cn(WS_TABLE_WRAP, 'hidden lg:block')}>
        <table className={WS_TABLE}>
          <thead>
            <tr>
              {canEdit && (
                <th scope="col" className={cn(WS_TH, 'w-8')}>
                  <Checkbox checked={allOn} onCheckedChange={(v) => setSelected(v ? new Set(ids) : new Set())} aria-label="Select every notice on this page" />
                </th>
              )}
              {showClient && <SortHead label="Client" k="client" sort={sort} dir={dir} onSort={onSort} />}
              {/* The lists open newest first by issue date; this header turns it to oldest first and back. */}
              <SortHead label="Notice · issued" k="issued" sort={sort} dir={dir} onSort={onSort} />
              <SortHead label="Due" k="due" sort={sort} dir={dir} onSort={onSort} />
              <SortHead label="Stage" k="stage" sort={sort} dir={dir} onSort={onSort} />
              <SortHead label="Demand" k="demand" sort={sort} dir={dir} onSort={onSort} className="text-right" />
              <th scope="col" className={WS_TH}>Owner</th>
              <th scope="col" className={cn(WS_TH, 'w-10')}><span className="sr-only">PDF</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const id = r.id as string;
              return (
                <tr key={id} className={cn(WS_TR, selected.has(id) && 'bg-primary/5', r.is_overdue && 'bg-destructive/[0.03]')}>
                  {canEdit && (
                    <td className={WS_TD}>
                      <Checkbox checked={selected.has(id)} onCheckedChange={(v) => toggle(id, !!v)} aria-label={`Select ${r.client_name} ${r.reference_number ?? r.case_id ?? ''}`} />
                    </td>
                  )}
                  {showClient && (
                    <td className={cn(WS_TD, 'max-w-[13rem]')}>
                      <Link to={`/notices-company/${r.client_id}`} className="block truncate font-medium hover:underline">{r.client_name}</Link>
                      <div className="font-mono text-[11px] text-muted-foreground">{r.client_gstin}</div>
                    </td>
                  )}
                  <td className={cn(WS_TD, 'min-w-[18rem]')}>
                    <Link to={`/notices/${id}`} className="font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{noticeTitle(r)}</Link>
                    <ResponseNeedChip need={r.response_need} className="ml-1.5 align-middle" />
                    <div className="line-clamp-1 text-xs text-muted-foreground" title={r.description ?? ''}>
                      {(r.reference_number || r.case_id) && <span className="font-mono">{r.reference_number || r.case_id}</span>}
                      {r.issue_date ? ` · issued ${fmtDate(r.issue_date)}` : ''}
                      {r.description ? ` · ${sentenceCase(r.description)}` : ''}
                    </div>
                    {!r.is_open && r.close_reason && <div className="text-[11px] text-muted-foreground">{closeReasonText(r.close_reason)}</div>}
                  </td>
                  <td className={cn(WS_TD, 'whitespace-nowrap')}><DueCell r={r} /></td>
                  <td className={cn(WS_TD, 'whitespace-nowrap')}>
                    <StagePicker value={r.stage} since={r.stage_changed_at} by={r.stage_changed_by} disabled={!canEdit} onChange={setStageFor([id])} />
                  </td>
                  <td className={WS_TD_NUM}>{Number(r.amount_of_demand) > 0 ? fmtInrShort(r.amount_of_demand) : <span className="text-muted-foreground">—</span>}</td>
                  <td className={cn(WS_TD, 'whitespace-nowrap')}>
                    {canEdit ? (
                      <AssignPopover currentOwnerId={r.assign_to_user_id} onAssign={(o) => apply([id], { assign_to_user_id: o?.userId ?? null, assign_to: o?.name ?? null }, o ? `Assigned to ${o.name}` : 'Unassigned')}>
                        <button type="button" className="rounded px-1 py-0.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          <span className="sr-only">Owner: </span><OwnerChip name={r.assign_to} showName /><span className="sr-only">. Change owner</span>
                        </button>
                      </AssignPopover>
                    ) : <OwnerChip name={r.assign_to} showName />}
                  </td>
                  <td className={WS_TD}>
                    {r.pdf_url ? (
                      <a href={r.pdf_url} target="_blank" rel="noreferrer" className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-muted" aria-label={`Open the notice PDF for ${r.reference_number ?? r.client_name}`}>
                        <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />
                      </a>
                    ) : <span className="sr-only">no PDF captured</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {footerTotal && rows.length > 0 && (
            <tfoot>
              <tr className="sticky bottom-0 bg-muted font-semibold">
                <td className={WS_TD} colSpan={(canEdit ? 1 : 0) + (showClient ? 1 : 0) + 3}>{footerTotal.label}</td>
                <td className={WS_TD_NUM}>{fmtInrShort(footerTotal.amount)}</td>
                <td className={WS_TD} colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {canEdit && targets.length > 0 && (
        <div role="toolbar" aria-label="Bulk actions"
          className="fixed inset-x-0 bottom-4 z-40 mx-auto flex w-fit max-w-[calc(100vw-2rem)] flex-wrap items-center gap-2 rounded-full border bg-card px-4 py-2 shadow-lg">
          <span className="text-xs font-semibold">{targets.length} selected</span>
          <Button size="sm" className="h-8 gap-1 rounded-full text-xs" onClick={() => setCloseOpen(true)}><Lock className="h-3.5 w-3.5" aria-hidden /> Close…</Button>
          <StagePicker value={null} onChange={setStageFor(targets)} align="center"
            trigger={<Button size="sm" variant="outline" className="h-8 gap-1 rounded-full text-xs">Stage <ChevronDown className="h-3 w-3" /></Button>} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="sm" variant="outline" className="h-8 gap-1 rounded-full text-xs"><Flag className="h-3.5 w-3.5" /> Priority</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="center">
              {(['High', 'Medium', 'Low'] as const).map((p) => (
                <DropdownMenuItem key={p} onSelect={() => apply(targets, { priority: p }, `Priority ${p}`)}>{p}</DropdownMenuItem>
              ))}
              <DropdownMenuItem onSelect={() => apply(targets, { priority: null }, 'Priority from the form')}>Form's default</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <AssignPopover align="center" onAssign={(o) => apply(targets, { assign_to_user_id: o?.userId ?? null, assign_to: o?.name ?? null }, o ? `Assigned to ${o.name}` : 'Unassigned')}>
            <Button size="sm" variant="outline" className="h-8 gap-1 rounded-full text-xs"><UserPlus className="h-3.5 w-3.5" /> Assign</Button>
          </AssignPopover>
          <Button size="sm" variant="ghost" className="h-8 gap-1 rounded-full text-xs" onClick={() => { setSelected(new Set()); setScope('page'); }}><X className="h-3.5 w-3.5" /> Clear</Button>
          <Badge variant="secondary" className="hidden text-[10px] sm:inline-flex">changes can be undone</Badge>
        </div>
      )}
      <ReadCloseDialog open={closeOpen} onOpenChange={setCloseOpen} count={targets.length}
        onClose={(reason) => setStageFor(targets)('closed', reason)} />
    </>
  );
};

export default NoticeTable;
