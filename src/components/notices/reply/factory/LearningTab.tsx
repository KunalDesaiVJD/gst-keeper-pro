// "Learning" (Notices Phase 7; the firm's request of 7 October 2026: an admin
// chooses which past and ongoing client responses the AI learns from). Every
// response the firm gave (a reply filed on the portal, an approved draft, what
// staff typed on a notice page) is read into paragraph pairs: what the notice
// alleged and how the firm answered. The assistant is given only the pairs of
// the responses chosen here (and never a pair left out one by one). Filters
// live in the URL.
import React, { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { WS_BTN, WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TH, WS_TR } from '@/components/workspace/theme';
import { FilterPill } from '@/components/notices/FilterPill';
import { EmptyBox, INLINE_LINK, LoadError, ToneBadge } from '@/components/notices/autopilot/parts';
import { Pager } from '@/components/notices/Pager';
import { Panel, Stat } from '@/components/notices/ui/Panel';
import { useAuth } from '@/contexts/AuthContext';
import { fmtDate, fmtFy } from '@/lib/noticeFormat';
import { fmtCount, type ReplyFactoryStatus } from '@/lib/replyFactory';
import {
  learningKey, loadLearningFacets, loadLearningResponses, loadPairs, PAIR_ORIGIN, RESPONSE_SOURCE, setPairsIncluded,
  setResponsesIncluded, type Chosen, type LearningFilter, type LearningResponse, type Phase,
} from '@/lib/noticeAi';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

const PAGE = 50;

function readFilter(sp: URLSearchParams): LearningFilter {
  const phase = sp.get('phase');
  const chosen = sp.get('chosen');
  return {
    client: sp.get('lc') || null, fy: sp.get('lfy') || null, form: sp.get('lform') || null,
    phase: phase === 'past' || phase === 'ongoing' ? phase : 'all',
    chosen: chosen === 'yes' || chosen === 'no' ? chosen : 'all',
    q: sp.get('lq') ?? '',
  };
}

/** Every response the filter matches (all pages), for "choose all shown". */
async function idsFor(f: LearningFilter): Promise<string[]> {
  let q = supabase.from('ai_learning_responses').select('id');
  if (f.client) q = q.eq('client_id', f.client);
  if (f.fy) q = q.eq('financial_year', f.fy);
  if (f.form) q = q.eq('form_code', f.form);
  if (f.phase !== 'all') q = q.eq('phase', f.phase);
  if (f.chosen !== 'all') q = q.eq('learning_included', f.chosen === 'yes');
  const t = f.q.trim().replace(/[%,()]/g, ' ');
  if (t) q = q.or(`client_name.ilike.%${t}%,notice_ref.ilike.%${t}%,label.ilike.%${t}%,title.ilike.%${t}%`);
  const { data, error } = await q.limit(5000);
  if (error) throw error;
  return (data ?? []).map((r) => r.id as string).filter(Boolean);
}

export const LearningTab: React.FC<{ s: ReplyFactoryStatus | undefined }> = ({ s }) => {
  const { user, canManageNoticeAlerts } = useAuth();
  const canEdit = canManageNoticeAlerts();
  const actor = user?.firstName ?? null;
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const f = useMemo(() => readFilter(sp), [sp]);
  const page = Math.max(1, Number(sp.get('p')) || 1);
  const [q, setQ] = useState(f.q);
  const [open, setOpen] = useState<LearningResponse | null>(null);
  const [bulk, setBulk] = useState<boolean | null>(null);
  const list = useQuery({ queryKey: learningKey(f, page), queryFn: () => loadLearningResponses(f, page, PAGE) });
  const facets = useQuery({ queryKey: ['ai-learning-facets'], queryFn: loadLearningFacets, staleTime: 60_000 });

  const set = (patch: Record<string, string | null>) => {
    const n = new URLSearchParams(sp);
    Object.entries(patch).forEach(([k, v]) => { if (v === null || v === '' || v === 'all') n.delete(k); else n.set(k, v); });
    n.delete('p');
    setSp(n, { replace: true });
  };
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['ai-learning'] });
    qc.invalidateQueries({ queryKey: ['reply-factory-status'] });
  };
  const toggle = async (r: LearningResponse, include: boolean) => {
    try {
      await setResponsesIncluded([r.id as string], include, actor);
      refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  };
  const applyAll = async (include: boolean) => {
    setBulk(include);
    try {
      const ids = await idsFor(f);
      const n = ids.length ? await setResponsesIncluded(ids, include, actor) : 0;
      toast.success(`${ids.length} response${ids.length === 1 ? '' : 's'} ${include ? 'chosen' : 'left out'} (${n} pair${n === 1 ? '' : 's'} changed).`);
      refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBulk(null); }
  };

  const l = s?.ai.learning;
  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;

  return (
    <div className="space-y-3">
      <Panel title="Learning"
        info="The firm's own responses, paragraph by paragraph: what the notice alleged and how the firm answered. The assistant is given only the responses chosen here, and uses their reasoning and wording, never another client's facts."
        actions={canEdit && total > 0 && (
          <>
            <Button size="sm" className={WS_BTN} disabled={bulk !== null} onClick={() => applyAll(true)}>
              {bulk === true ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Choose all shown ({total})
            </Button>
            <Button size="sm" variant="outline" className={WS_BTN} disabled={bulk !== null} onClick={() => applyAll(false)}>
              {bulk === false ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />} Leave out all shown
            </Button>
          </>
        )}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Responses read" value={fmtCount(l?.responses)} />
            <Stat label="Chosen" value={fmtCount(l?.responses_included)} sub="teach the assistant" />
            <Stat label="Examples kept" value={fmtCount(l?.pairs_included)} sub={`of ${fmtCount(l?.pairs)} pairs`} />
            <Stat label="Used in answers" value={fmtCount(l?.uses)} />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="relative w-full sm:w-56">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') set({ lq: q }); }} onBlur={() => q !== f.q && set({ lq: q })}
                placeholder="Client, reference, reply…" aria-label="Search responses" className="h-8 pl-7 text-xs" />
            </div>
            <ToggleGroup type="single" value={f.phase} onValueChange={(v) => v && set({ phase: v as Phase })} className="rounded-md border p-0.5" aria-label="Past or ongoing">
              {(['all', 'past', 'ongoing'] as const).map((k) => (
                <ToggleGroupItem key={k} value={k} className="h-7 px-2.5 text-xs capitalize data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">{k}</ToggleGroupItem>
              ))}
            </ToggleGroup>
            <FilterPill label="Client" allLabel="All" value={f.client ?? 'all'} onChange={(v) => set({ lc: v })} options={[]}
              extraOptions={(facets.data?.clients ?? []).map((c) => ({ value: c.id, label: c.name }))} />
            <FilterPill label="FY" allLabel="Any" value={f.fy ?? 'all'} onChange={(v) => set({ lfy: v })} options={[]}
              extraOptions={(facets.data?.fys ?? []).map((y) => ({ value: y, label: fmtFy(y) }))} />
            <FilterPill label="Form" allLabel="Any" value={f.form ?? 'all'} onChange={(v) => set({ lform: v })} options={facets.data?.forms ?? []} />
            <FilterPill label="Chosen" allLabel="All" value={f.chosen} onChange={(v) => set({ chosen: v as Chosen })} options={[]}
              extraOptions={[{ value: 'yes', label: 'Chosen' }, { value: 'no', label: 'Not chosen' }]} />
          </div>
          {list.error ? <LoadError what="the responses" error={list.error} onRetry={() => list.refetch()} />
            : list.isLoading ? <Skeleton className="h-48 w-full" />
            : !rows.length ? (
              <EmptyBox className="p-4">
                {l?.responses ? 'No response matches these filters.' : 'No response has been read yet. Replies are read once AI is switched on (AI tab).'}
              </EmptyBox>
            ) : (
              <div className={WS_TABLE_WRAP}>
                <table className={WS_TABLE}>
                  <thead>
                    <tr>
                      <th className={WS_TH}>Client</th><th className={WS_TH}>Notice</th><th className={WS_TH}>Response</th>
                      <th className={WS_TH}>When</th><th className={cn(WS_TH, 'text-right')}>Pairs</th><th className={WS_TH}>Teaches</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className={WS_TR}>
                        <td className={cn(WS_TD, 'max-w-[12rem] truncate')}>{r.client_name}</td>
                        <td className={cn(WS_TD, 'whitespace-nowrap')}>
                          {r.notice_id ? <Link to={`/notices/${r.notice_id}?tab=assistant`} className={INLINE_LINK}>{[r.form_code, r.notice_ref].filter(Boolean).join(' · ') || 'Notice'}</Link> : '—'}
                          {r.financial_year && <span className="ml-1 text-[11px] text-muted-foreground">FY {fmtFy(r.financial_year)}</span>}
                        </td>
                        <td className={cn(WS_TD, 'max-w-[20rem]')}>
                          <button type="button" className="block w-full truncate text-left hover:underline" onClick={() => setOpen(r)}>{r.title || r.label}</button>
                          <span className="text-[11px] text-muted-foreground">{RESPONSE_SOURCE[r.source ?? ''] ?? r.source} · {r.phase === 'past' ? 'past' : 'ongoing'}{r.status !== 'done' ? ` · ${r.status === 'queued' ? 'waiting to be read' : r.status}` : ''}</span>
                        </td>
                        <td className={cn(WS_TD, 'whitespace-nowrap text-xs')}>{fmtDate(r.response_date)}</td>
                        <td className={WS_TD_NUM}>
                          <button type="button" className={INLINE_LINK} onClick={() => setOpen(r)}>{r.pairs_included ?? 0}/{r.pairs ?? 0}</button>
                        </td>
                        <td className={WS_TD}>
                          <Switch checked={!!r.learning_included} disabled={!canEdit} onCheckedChange={(v) => toggle(r, v)}
                            aria-label={`${r.learning_included ? 'Leave out' : 'Choose'} ${r.title || r.label}`} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          <Pager page={page} pageSize={PAGE} total={total} onPage={(p) => { const n = new URLSearchParams(sp); n.set('p', String(p)); setSp(n); }} />
        </div>
      </Panel>
      <PairsSheet response={open} canEdit={canEdit} actor={actor} onClose={() => setOpen(null)} onChanged={refresh} />
    </div>
  );
};

const PairsSheet: React.FC<{ response: LearningResponse | null; canEdit: boolean; actor: string | null; onClose: () => void; onChanged: () => void }> = ({ response, canEdit, actor, onClose, onChanged }) => {
  const id = response?.id ?? null;
  const pairs = useQuery({ queryKey: ['ai-learning-pairs', id], queryFn: () => loadPairs(id as string), enabled: !!id });
  const set = async (ids: string[], include: boolean) => {
    try { await setPairsIncluded(ids, include, actor); await pairs.refetch(); onChanged(); } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <Sheet open={!!response} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader><SheetTitle className="text-base">{response?.title || response?.label}</SheetTitle></SheetHeader>
        <p className="text-xs text-muted-foreground">{response?.client_name} · {[response?.form_code, response?.notice_ref].filter(Boolean).join(' · ')} · {RESPONSE_SOURCE[response?.source ?? ''] ?? response?.source}</p>
        <div className="mt-3 space-y-2">
          {pairs.isLoading ? <Skeleton className="h-40 w-full" />
            : pairs.error ? <LoadError what="the pairs" error={pairs.error} onRetry={() => pairs.refetch()} />
            : !(pairs.data ?? []).length ? <EmptyBox className="p-4">{response?.status === 'done' ? 'No paragraph pairs were found in this response.' : 'This response has not been read yet.'}</EmptyBox>
            : (pairs.data ?? []).map((p) => (
              <div key={p.id} className={cn('space-y-1.5 rounded-md border p-2.5', !p.included && 'opacity-70')}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <ToneBadge tone="secondary">{PAIR_ORIGIN[p.origin] ?? p.origin}</ToneBadge>
                  {p.issue_code !== 'OTHER' && <ToneBadge tone="secondary">{p.issue_code}</ToneBadge>}
                  {p.verified && <ToneBadge tone="success">Checked</ToneBadge>}
                  {p.uses > 0 && <span className="text-[11px] text-muted-foreground">used {p.uses}×</span>}
                  <Switch className="ml-auto" checked={p.included} disabled={!canEdit} onCheckedChange={(v) => set([p.id], v)} aria-label={p.included ? 'Leave this pair out' : 'Use this pair'} />
                </div>
                <p className="line-clamp-4 text-xs text-muted-foreground" title={p.allegation}>{p.allegation}</p>
                <p className="whitespace-pre-wrap text-sm">{p.response}</p>
                {p.ai_text && p.ai_text !== p.response && (
                  <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">What the assistant had suggested</summary><p className="mt-1 whitespace-pre-wrap">{p.ai_text}</p></details>
                )}
              </div>
            ))}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default LearningTab;
