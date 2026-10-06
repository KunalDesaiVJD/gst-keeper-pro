// Notice types (contract §A; the firm's request of 6 Oct 2026: "certain kinds
// of notice need no reply"): per form, whether it needs a reply (Reply
// required / Reply optional / No reply needed) and whether its notices count on
// the command centre. A superadmin or GST manager changes a row in place: saved
// at once, rolled back with a toast if the save fails, stamped with their name.
// Everyone else reads. Self-contained: the command centre opens it in a dialog
// and the Reply Factory shows it as a tab; with `urlState` the filters live in
// the URL (tq, tneed, tdash), so a link reproduces the view.
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/gstr9/badge';
import { Note } from '@/components/gstr9/ui';
import { WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TH, WS_TR } from '@/components/workspace/theme';
import { FilterPill } from '@/components/notices/FilterPill';
import { EmptyBox, INLINE_LINK, LoadError } from '@/components/notices/autopilot/parts';
import { useAuth } from '@/contexts/AuthContext';
import { noticesListHref } from '@/lib/noticeQueries';
import { fmtDate, plural } from '@/lib/noticeFormat';
import {
  canManageNoticeTypes, countUnclassifiedOpen, invalidateAfterTypeChange, isResponseNeed, NOTICE_TYPES_KEY, RESPONSE_NEEDS,
  responseNeedDef, saveNoticeType, useNoticeTypes, type NoticeTypePatch, type NoticeTypeRow, type ResponseNeed,
} from '@/lib/noticeTypes';
import { cn } from '@/lib/utils';

type DashFilter = 'all' | 'shown' | 'hidden';
interface Filters { q: string; need: ResponseNeed | 'all'; dash: DashFilter }
const NO_FILTERS: Filters = { q: '', need: 'all', dash: 'all' };

/** The filters, in the URL (tq, tneed, tdash) or in local state. */
function useTypeFilters(urlState: boolean): [Filters, (patch: Partial<Filters>) => void] {
  const [sp, setSp] = useSearchParams();
  const [local, setLocal] = useState<Filters>(NO_FILTERS);
  if (!urlState) return [local, (patch) => setLocal((f) => ({ ...f, ...patch }))];
  const need = sp.get('tneed');
  const dash = sp.get('tdash');
  const current: Filters = {
    q: sp.get('tq') ?? '',
    need: isResponseNeed(need) ? need : 'all',
    dash: dash === 'shown' || dash === 'hidden' ? dash : 'all',
  };
  // Only the keys in the patch change, read from the live URL (the search box writes late).
  const set = (patch: Partial<Filters>) => setSp((prev) => {
    const next = new URLSearchParams(prev);
    const put = (k: string, v: string | undefined, empty: string) => { if (!v || v === empty) next.delete(k); else next.set(k, v); };
    if ('q' in patch) put('tq', patch.q?.trim(), '');
    if ('need' in patch) put('tneed', patch.need, 'all');
    if ('dash' in patch) put('tdash', patch.dash, 'all');
    return next;
  }, { replace: true });
  return [current, set];
}

const istDay = (ts: string) => fmtDate(new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }));

/** The rule's label without a trailing "(DRC-01A)" that only repeats the code beside it. */
function typeLabel(r: NoticeTypeRow): string {
  const label = r.label ?? '';
  const tail = `(${r.form_code ?? ''})`;
  return r.form_code && label.endsWith(tail) ? label.slice(0, -tail.length).trim() : label;
}

/** "Changed by Kunal on 06 Oct 2026", or "Default setting" while nobody has changed it. */
function changedWords(r: NoticeTypeRow): string {
  if (!r.updated_by_name) return 'Default setting';
  return `Changed by ${r.updated_by_name}${r.updated_at ? ` on ${istDay(r.updated_at)}` : ''}`;
}

const NEED_DOT: Record<ResponseNeed, string> = { critical: 'bg-destructive', optional: 'bg-warning', none: 'bg-muted-foreground/50' };

const NeedSelect: React.FC<{ r: NoticeTypeRow; disabled: boolean; onSave: (p: NoticeTypePatch) => void; className?: string }> = ({ r, disabled, onSave, className }) => {
  const def = responseNeedDef(r.response_need);
  return (
    <Select value={def.key} disabled={disabled} onValueChange={(v) => { if (isResponseNeed(v) && v !== def.key) onSave({ response_need: v }); }}>
      <SelectTrigger className={cn('h-8 w-[10.5rem] text-xs', className)} aria-label={`Reply need for ${r.form_code}: ${def.label}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {RESPONSE_NEEDS.map((d) => (
          <SelectItem key={d.key} value={d.key} className="text-xs">
            <span className="inline-flex items-center gap-1.5">
              <span className={cn('h-2 w-2 shrink-0 rounded-full', NEED_DOT[d.key])} aria-hidden />{d.label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

const NeedBadge: React.FC<{ r: NoticeTypeRow }> = ({ r }) => {
  const def = responseNeedDef(r.response_need);
  return <Badge variant={def.tone} className="whitespace-nowrap text-[11px] font-medium">{def.label}</Badge>;
};

const DashSwitch: React.FC<{ r: NoticeTypeRow; disabled: boolean; onSave: (p: NoticeTypePatch) => void }> = ({ r, disabled, onSave }) => (
  <Switch checked={!!r.show_on_dashboard} disabled={disabled} onCheckedChange={(on) => onSave({ show_on_dashboard: on })}
    aria-label={`Show ${r.form_code} on the dashboard`} />
);

/** Open and total, each a link to the list it counts. */
const Count: React.FC<{ n: number | null; to: string; what: string; code: string }> = ({ n, to, what, code }) => (
  (n ?? 0) > 0
    ? <Link to={to} className="font-medium tabular-nums text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {(n ?? 0).toLocaleString('en-IN')}<span className="sr-only"> {what} {code} notices</span>
      </Link>
    : <span className="tabular-nums text-muted-foreground">0<span className="sr-only"> {what}</span></span>
);

export const NoticeTypesSettings: React.FC<{
  /** Keep the filters in the URL (a page or a dialog opened from the URL). */
  urlState?: boolean;
  /** Called after each save (the caller's own refresh). */
  onSaved?: () => void;
  className?: string;
}> = ({ urlState = false, onSaved, className }) => {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canEdit = canManageNoticeTypes(user?.role);
  const types = useNoticeTypes();
  const unclassified = useQuery({ queryKey: ['notice-types-unclassified'], queryFn: countUnclassifiedOpen, staleTime: 60_000 });
  const [filters, setFilters] = useTypeFilters(urlState);
  const [text, setText] = useState(filters.q);
  const [pending, setPending] = useState<Set<string>>(new Set());

  // The search box filters at once and reaches the URL a moment later.
  useEffect(() => { setText(filters.q); }, [filters.q]);
  useEffect(() => {
    if (text.trim() === filters.q.trim()) return;
    const t = setTimeout(() => setFilters({ q: text }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const mark = (code: string, on: boolean) => setPending((s) => { const n = new Set(s); if (on) n.add(code); else n.delete(code); return n; });

  const save = useMutation({
    mutationKey: ['notice-type-set'],
    mutationFn: (v: { code: string; patch: NoticeTypePatch }) => saveNoticeType(v.code, v.patch, user?.firstName ?? null),
    onMutate: async (v) => {
      mark(v.code, true);
      await qc.cancelQueries({ queryKey: NOTICE_TYPES_KEY });
      const prevRow = qc.getQueryData<NoticeTypeRow[]>(NOTICE_TYPES_KEY)?.find((r) => r.form_code === v.code) ?? null;
      qc.setQueryData<NoticeTypeRow[]>(NOTICE_TYPES_KEY, (old) => old?.map((r) => (r.form_code === v.code
        ? { ...r, ...v.patch, updated_by_name: user?.firstName ?? r.updated_by_name, updated_at: new Date().toISOString() } : r)));
      return { prevRow };
    },
    onError: (e, v, ctx) => {
      if (ctx?.prevRow) {
        const prev = ctx.prevRow;
        qc.setQueryData<NoticeTypeRow[]>(NOTICE_TYPES_KEY, (old) => old?.map((r) => (r.form_code === v.code ? prev : r)));
      }
      toast.error(`Couldn't save ${v.code}: ${e instanceof Error ? e.message : String(e)}. The setting is as it was.`);
    },
    onSuccess: (row, v) => {
      const fresh = Object.fromEntries((['response_need', 'show_on_dashboard', 'updated_at', 'updated_by_name'] as const)
        .filter((k) => row && k in row).map((k) => [k, row[k]])) as Partial<NoticeTypeRow>;
      qc.setQueryData<NoticeTypeRow[]>(NOTICE_TYPES_KEY, (old) => old?.map((r) => (r.form_code === v.code ? { ...r, ...fresh } : r)));
      if (v.patch.response_need) {
        const d = responseNeedDef(v.patch.response_need);
        toast.success(v.patch.response_need === 'none'
          ? `${v.code}: ${d.label}. Its notices never turn overdue; their next step is Read and close.`
          : `${v.code}: ${d.label}.`);
      } else {
        toast.success(v.patch.show_on_dashboard
          ? `${v.code} is back on the dashboard.`
          : `${v.code} is off the dashboard. Its notices stay in All notices and the Work queue.`);
      }
    },
    onSettled: (_d, _e, v) => {
      mark(v.code, false);
      if (qc.isMutating({ mutationKey: ['notice-type-set'] }) <= 1) qc.invalidateQueries({ queryKey: NOTICE_TYPES_KEY });
      invalidateAfterTypeChange(qc);
      onSaved?.();
    },
  });
  const onSave = (r: NoticeTypeRow) => (patch: NoticeTypePatch) => { if (r.form_code) save.mutate({ code: r.form_code, patch }); };

  const all = useMemo(() => types.data ?? [], [types.data]);
  const term = text.trim().toLowerCase();
  const base = useMemo(() => all.filter((r) => !term || `${r.form_code} ${r.label ?? ''} ${r.category ?? ''}`.toLowerCase().includes(term)), [all, term]);
  const needCount = (k: ResponseNeed) => base.filter((r) => responseNeedDef(r.response_need).key === k).length;
  const shown = base.filter((r) => r.show_on_dashboard).length;
  const rows = base
    .filter((r) => filters.need === 'all' || responseNeedDef(r.response_need).key === filters.need)
    .filter((r) => filters.dash === 'all' || (filters.dash === 'shown') === !!r.show_on_dashboard)
    .sort((a, b) => Number(!!b.is_active) - Number(!!a.is_active) || (b.open_count ?? 0) - (a.open_count ?? 0)
      || (b.total_count ?? 0) - (a.total_count ?? 0) || (a.form_code ?? '').localeCompare(b.form_code ?? ''));
  const filtered = !!term || filters.need !== 'all' || filters.dash !== 'all';
  const busy = (r: NoticeTypeRow) => !canEdit || pending.has(r.form_code ?? '');

  return (
    <div className={cn('space-y-2', className)}>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {RESPONSE_NEEDS.map((d) => (
          <React.Fragment key={d.key}><span className="font-medium text-foreground">{d.label}</span>: {d.short} · </React.Fragment>
        ))}
        types off the dashboard still appear in All notices and the Work queue.
      </p>
      {!canEdit && <Note tone="info">Only a superadmin or a GST manager can change these settings. You can read them.</Note>}

      <div className="flex flex-wrap items-center gap-1.5">
        <div className="relative w-full sm:w-60">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Form, label or category" aria-label="Search notice types" className="h-8 pl-7 text-xs" />
        </div>
        <FilterPill label="Reply need" allLabel={`All (${base.length})`} value={filters.need} onChange={(v) => setFilters({ need: isResponseNeed(v) ? v : 'all' })}
          options={[]} extraOptions={RESPONSE_NEEDS.map((d) => ({ value: d.key, label: `${d.label} (${needCount(d.key)})` }))} />
        <FilterPill label="Dashboard" allLabel={`Any (${base.length})`} value={filters.dash} onChange={(v) => setFilters({ dash: v === 'shown' || v === 'hidden' ? v : 'all' })}
          options={[]} extraOptions={[{ value: 'shown', label: `Shown (${shown})` }, { value: 'hidden', label: `Not shown (${base.length - shown})` }]} />
        {filtered && (
          <button type="button" className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
            onClick={() => { setText(''); setFilters(NO_FILTERS); }}>
            Clear filters
          </button>
        )}
        {types.data && <span className="ml-auto text-xs text-muted-foreground" aria-live="polite">{rows.length} of {plural(all.length, 'notice type')}</span>}
      </div>

      {types.error ? <LoadError what="the notice types" error={types.error} onRetry={() => types.refetch()} />
        : types.isLoading ? <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}</div>
        : rows.length === 0 ? <EmptyBox>No notice type matches these filters.</EmptyBox>
        : (
          <>
            {/* Phones and tablets: cards. */}
            <ul className="space-y-2 lg:hidden">
              {rows.map((r) => (
                <li key={r.form_code} className={cn('rounded-lg border bg-card p-3', !r.is_active && 'bg-muted/40')}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-mono text-xs font-semibold">{r.form_code}</div>
                      <div className="break-words text-sm leading-snug">{typeLabel(r)}</div>
                      <div className="text-[11px] text-foreground/70">{r.category || 'No category'}{!r.is_active && ' · not in use'}</div>
                    </div>
                    <div className="shrink-0 text-right text-xs">
                      <div><Count n={r.open_count} to={noticesListHref({ form: r.form_code ?? undefined })} what="open" code={r.form_code ?? ''} /> open</div>
                      <div className="text-muted-foreground"><Count n={r.total_count} to={noticesListHref({ filter: 'all', form: r.form_code ?? undefined })} what="in all" code={r.form_code ?? ''} /> in all</div>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                    {canEdit ? <NeedSelect r={r} disabled={busy(r)} onSave={onSave(r)} /> : <NeedBadge r={r} />}
                    {canEdit ? (
                      <label className="inline-flex items-center gap-2 text-xs">
                        <DashSwitch r={r} disabled={busy(r)} onSave={onSave(r)} /> On the dashboard
                      </label>
                    ) : <span className="text-xs text-foreground/70">{r.show_on_dashboard ? 'On the dashboard' : 'Not on the dashboard'}</span>}
                  </div>
                  <div className="mt-1.5 text-[11px] text-muted-foreground">{changedWords(r)}</div>
                </li>
              ))}
            </ul>

            <div className={cn(WS_TABLE_WRAP, 'hidden lg:block')}>
              <table className={WS_TABLE}>
                <caption className="sr-only">Notice types: whether each needs a reply and whether it shows on the dashboard</caption>
                <thead>
                  <tr>
                    <th scope="col" className={WS_TH}>Notice type</th>
                    <th scope="col" className={WS_TH}>Category</th>
                    <th scope="col" className={cn(WS_TH, 'text-right')}>Open</th>
                    <th scope="col" className={cn(WS_TH, 'text-right')}>Total</th>
                    <th scope="col" className={WS_TH}>Reply need</th>
                    <th scope="col" className={WS_TH}>Show on the dashboard</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.form_code} className={cn(WS_TR, !r.is_active && 'bg-muted/40')}>
                      <td className={cn(WS_TD, 'min-w-[16rem]')}>
                        <div className="leading-snug">
                          <span className="mr-2 font-mono text-xs font-semibold">{r.form_code}</span>{typeLabel(r)}
                          {!r.is_active && <span className="ml-2 text-[11px] font-medium text-foreground/70">not in use</span>}
                        </div>
                        <div className="text-[11px] text-foreground/70">{changedWords(r)}</div>
                      </td>
                      <td className={cn(WS_TD, 'text-xs')}>{r.category || <span className="text-muted-foreground">—</span>}</td>
                      <td className={WS_TD_NUM}><Count n={r.open_count} to={noticesListHref({ form: r.form_code ?? undefined })} what="open" code={r.form_code ?? ''} /></td>
                      <td className={WS_TD_NUM}><Count n={r.total_count} to={noticesListHref({ filter: 'all', form: r.form_code ?? undefined })} what="in all" code={r.form_code ?? ''} /></td>
                      <td className={WS_TD}>{canEdit ? <NeedSelect r={r} disabled={busy(r)} onSave={onSave(r)} /> : <NeedBadge r={r} />}</td>
                      <td className={WS_TD}>
                        {canEdit ? (
                          <span className="inline-flex items-center gap-2">
                            <DashSwitch r={r} disabled={busy(r)} onSave={onSave(r)} />
                            <span className="text-xs text-foreground/70" aria-hidden>{r.show_on_dashboard ? 'Shown' : 'Not shown'}</span>
                          </span>
                        ) : <span className="text-xs">{r.show_on_dashboard ? 'Shown' : 'Not shown'}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

      <p className="text-[11px] text-muted-foreground">
        Notices with no form recognised always count as Reply required and stay on the dashboard
        {unclassified.data !== undefined && (unclassified.data > 0
          ? <>: <Link to={noticesListHref({ form: 'none' })} className={INLINE_LINK}>{plural(unclassified.data, 'open notice')}</Link> now.</>
          : <>; none is open now.</>)}
        {unclassified.data === undefined && '.'}
      </p>
    </div>
  );
};

export default NoticeTypesSettings;
