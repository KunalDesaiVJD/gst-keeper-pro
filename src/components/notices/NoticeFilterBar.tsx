// The one filter bar for notice lists (audit U-20-5, U-22-3, cross-cutting
// "filter state is scattered"): search, then pills, then a chip with ✕ for each
// active filter, then the page's actions on the right. Every value lives in the
// URL (lib/noticeQueries), so a dashboard number and its list share a filter
// and a link reproduces the view. A list opened from the command centre shows
// a "Dashboard notice types only" chip (dash=1); removing it drops the filter.
import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { Input } from '@/components/ui/input';
import { FilterPill } from './FilterPill';
import { useStaffList } from '@/hooks/useStaffList';
import { LIST_FILTERS, type ListFilter, type NoticeListParams } from '@/lib/noticeQueries';
import { STAGES, stageLabel } from '@/lib/noticeStages';
import { RESPONSE_NEEDS, responseNeedDef } from '@/lib/noticeTypes';
import { fmtDate, fmtFy } from '@/lib/noticeFormat';

interface Options { categories: string[]; forms: { code: string; label: string }[]; fys: string[] }

/** Values to filter by, from what is on record (cached for five minutes). */
export function useNoticeFilterOptions() {
  return useQuery({
    queryKey: ['notice-filter-options'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Options> => {
      const [rows, rules] = await Promise.all([
        fetchAllRows<{ category: string | null; form_code: string | null; financial_year: string | null }>(
          'notice_facts', 'category, form_code, financial_year', (q) => q.order('id')),
        supabase.from('notice_form_rules').select('form_code, label').eq('is_active', true).order('form_code'),
      ]);
      const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b));
      const used = new Set(rows.map((r) => r.form_code).filter(Boolean));
      return {
        categories: uniq(rows.map((r) => r.category)),
        forms: (rules.data ?? []).filter((r) => used.has(r.form_code)).map((r) => ({ code: r.form_code, label: r.label })),
        fys: uniq(rows.map((r) => r.financial_year)).reverse(),
      };
    },
  });
}

export const NoticeFilterBar: React.FC<{
  params: NoticeListParams;
  onChange: (patch: Partial<NoticeListParams>) => void;
  /** The "Show" pill (open / overdue / …); off for the work queue. */
  showFilter?: boolean;
  /** Names for chips (client id → name). */
  clientName?: string | null;
  actions?: React.ReactNode;
  /** The page shows the master filter bar: leave client, owner, form, FY and priority to it. */
  master?: boolean;
}> = ({ params, onChange, showFilter = true, clientName, actions, master = false }) => {
  const { staff } = useStaffList();
  const opts = useNoticeFilterOptions().data;
  const [q, setQ] = useState(params.q ?? '');
  useEffect(() => { setQ(params.q ?? ''); }, [params.q]);
  useEffect(() => {
    if ((params.q ?? '') === q) return;
    const t = setTimeout(() => onChange({ q: q || undefined, page: 1 }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const set = (key: keyof NoticeListParams) => (v: string) => onChange({ [key]: v === 'all' ? undefined : v, page: 1 });
  const ownerName = params.owner === 'me' ? 'Me' : params.owner === 'none' ? 'Unassigned' : staff.find((s) => s.userId === params.owner)?.name ?? 'Someone';

  const chips: { key: keyof NoticeListParams; label: string }[] = [];
  if (params.dash === '1') chips.push({ key: 'dash', label: 'Dashboard notice types only' });
  if (params.dash === '0') chips.push({ key: 'dash', label: 'Notice types not on the dashboard' });
  if (params.client && !master) chips.push({ key: 'client', label: `Client: ${clientName ?? 'one client'}` });
  if (params.due) chips.push({ key: 'due', label: `Due on ${fmtDate(params.due)}` });
  if (params.stage) chips.push({ key: 'stage', label: `Stage: ${stageLabel(params.stage)}` });
  if (params.owner && !master) chips.push({ key: 'owner', label: `Owner: ${ownerName}` });
  if (params.category) chips.push({ key: 'category', label: `Category: ${params.category}` });
  if (params.form && !master) chips.push({ key: 'form', label: params.form === 'none' ? 'Form: not recognised' : `Form: ${params.form}` });
  if (params.need) chips.push({ key: 'need', label: `Reply need: ${responseNeedDef(params.need).chip}` });
  if (params.fy && !master) chips.push({ key: 'fy', label: params.fy === 'none' ? 'FY not stated' : `FY ${fmtFy(params.fy)}` });
  if (params.priority && !master) chips.push({ key: 'priority', label: `Priority: ${params.priority}` });

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Client, GSTIN, reference, case, form…" aria-label="Search notices" className="h-8 pl-7 text-xs" />
        </div>
        {showFilter && (
          <FilterPill label="Show" allLabel="All" value={params.filter === 'all' ? 'all' : params.filter}
            onChange={(v) => onChange({ filter: (v === 'all' ? 'all' : v) as ListFilter, page: 1 })}
            options={[]} extraOptions={LIST_FILTERS.filter((f) => f.key !== 'all').map((f) => ({ value: f.key, label: f.label }))} />
        )}
        <FilterPill label="Stage" allLabel="Any" value={params.stage ?? 'all'} onChange={set('stage')} options={[]}
          extraOptions={STAGES.map((s) => ({ value: s.key, label: s.label }))} />
        {!master && (
          <FilterPill label="Owner" allLabel="Anyone" value={params.owner ?? 'all'} onChange={set('owner')} options={[]}
            extraOptions={[{ value: 'me', label: 'Me' }, { value: 'none', label: 'Unassigned' }, ...staff.map((s) => ({ value: s.userId, label: s.name }))]} />
        )}
        <FilterPill label="Category" allLabel="Any" value={params.category ?? 'all'} onChange={set('category')} options={opts?.categories ?? []} />
        {!master && (
          <>
            <FilterPill label="Form" allLabel="Any" value={params.form ?? 'all'} onChange={set('form')} options={[]}
              extraOptions={[...(opts?.forms ?? []).map((f) => ({ value: f.code, label: `${f.code} · ${f.label}` })), { value: 'none', label: 'Not recognised' }]} />
            <FilterPill label="FY" allLabel="Any" value={params.fy ?? 'all'} onChange={set('fy')} options={[]}
              extraOptions={[...(opts?.fys ?? []).map((y) => ({ value: y, label: fmtFy(y) })), { value: 'none', label: 'Not stated' }]} />
            <FilterPill label="Priority" allLabel="Any" value={params.priority ?? 'all'} onChange={set('priority')} options={['High', 'Medium', 'Low']} />
          </>
        )}
        <FilterPill label="Reply need" allLabel="All" value={params.need ?? 'all'} onChange={set('need')} options={[]}
          extraOptions={RESPONSE_NEEDS.map((d) => ({ value: d.key, label: d.chip }))} />
        {actions && <div className="ml-auto flex flex-wrap items-center gap-1.5">{actions}</div>}
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
          {chips.map((c) => (
            <button key={c.key} type="button" onClick={() => onChange({ [c.key]: undefined, page: 1 })}
              className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Remove filter ${c.label}`}>
              {c.label} <X className="h-3 w-3" aria-hidden />
            </button>
          ))}
          <button type="button" className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => onChange({ stage: undefined, client: undefined, owner: undefined, category: undefined, form: undefined, fy: undefined, priority: undefined, due: undefined, q: undefined, need: undefined, dash: undefined, page: 1 })}>
            Clear all
          </button>
        </div>
      )}
    </div>
  );
};

export default NoticeFilterBar;
