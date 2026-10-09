// "Learning" (Notices Phase 7; the firm's requests of 7 and 9 October 2026: an
// admin chooses whose responses the AI learns from, client by client, not
// notice by notice). Every response the firm gave (a reply filed on the portal,
// an approved draft, what staff typed on a notice page) is read into paragraph
// pairs: what the notice alleged and how the firm answered. Choosing a client
// chooses all its responses, and every response of it read later; one response
// or pair can still be left out under its client. Filters live in the URL.
import React, { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronRight, Loader2, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { WS_BTN, WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TH, WS_TR } from '@/components/workspace/theme';
import { FilterPill } from '@/components/notices/FilterPill';
import { EmptyBox, INLINE_LINK, LoadError, ToneBadge } from '@/components/notices/autopilot/parts';
import { Pager } from '@/components/notices/Pager';
import { Panel, Stat } from '@/components/notices/ui/Panel';
import { useAuth } from '@/contexts/AuthContext';
import { fmtDate, fmtFy } from '@/lib/noticeFormat';
import { fmtCount, type ReplyFactoryStatus } from '@/lib/replyFactory';
import {
  learningClientIds, loadClientResponses, loadLearningClients, loadPairs, PAIR_ORIGIN, RESPONSE_SOURCE, setClientsLearning,
  setPairsIncluded, setResponsesIncluded, type Chosen, type LearningClient, type LearningClientFilter, type LearningResponse,
} from '@/lib/noticeAi';
import { cn } from '@/lib/utils';

const PAGE = 50;

function readFilter(sp: URLSearchParams): LearningClientFilter {
  const chosen = sp.get('chosen');
  return { q: sp.get('lq') ?? '', chosen: chosen === 'yes' || chosen === 'no' ? chosen : 'all' };
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
  const [expanded, setExpanded] = useState<string | null>(null);
  const [bulk, setBulk] = useState<boolean | null>(null);
  const list = useQuery({ queryKey: ['ai-learning-clients', f, page], queryFn: () => loadLearningClients(f, page, PAGE) });

  const set = (patch: Record<string, string | null>) => {
    const n = new URLSearchParams(sp);
    Object.entries(patch).forEach(([k, v]) => { if (v === null || v === '' || v === 'all') n.delete(k); else n.set(k, v); });
    n.delete('p');
    setSp(n, { replace: true });
  };
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['ai-learning-clients'] });
    qc.invalidateQueries({ queryKey: ['ai-learning-client-responses'] });
    qc.invalidateQueries({ queryKey: ['reply-factory-status'] });
  };
  const toggleClient = async (c: LearningClient, include: boolean) => {
    try {
      const r = await setClientsLearning([c.client_id as string], include, actor);
      toast.success(`${c.client_name}: ${include ? 'teaches the assistant' : 'left out'} (${r.pairs} pair${r.pairs === 1 ? '' : 's'} changed).`);
      refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  };
  const applyAll = async (include: boolean) => {
    setBulk(include);
    try {
      const ids = await learningClientIds(f);
      const r = ids.length ? await setClientsLearning(ids, include, actor) : { clients: 0, pairs: 0 };
      toast.success(`${r.clients} client${r.clients === 1 ? '' : 's'} ${include ? 'chosen' : 'left out'} (${r.pairs} pair${r.pairs === 1 ? '' : 's'} changed).`);
      refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBulk(null); }
  };

  const l = s?.ai.learning;
  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;

  return (
    <div className="space-y-3">
      <Panel title="Learning"
        info="Choose the clients whose responses teach the assistant. Choosing a client chooses every response of it, and every response read later. Open a client to leave out one response or one paragraph. The assistant uses the reasoning and wording of the chosen responses, never another client's facts."
        actions={canEdit && total > 0 && (
          <>
            <Button size="sm" className={WS_BTN} disabled={bulk !== null} onClick={() => applyAll(true)}>
              {bulk === true ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Choose all {total} clients shown
            </Button>
            <Button size="sm" variant="outline" className={WS_BTN} disabled={bulk !== null} onClick={() => applyAll(false)}>
              {bulk === false ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />} Leave them out
            </Button>
          </>
        )}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Clients with responses" value={fmtCount(total || null)} />
            <Stat label="Responses read" value={fmtCount(l?.responses)} sub={`${fmtCount(l?.responses_included)} chosen`} />
            <Stat label="Examples kept" value={fmtCount(l?.pairs_included)} sub={`of ${fmtCount(l?.pairs)} pairs`} />
            <Stat label="Used in answers" value={fmtCount(l?.uses)} />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') set({ lq: q }); }} onBlur={() => q !== f.q && set({ lq: q })}
                placeholder="Client or GSTIN" aria-label="Search clients" className="h-8 pl-7 text-xs" />
            </div>
            <FilterPill label="Teaches" allLabel="All" value={f.chosen} onChange={(v) => set({ chosen: v as Chosen })} options={[]}
              extraOptions={[{ value: 'yes', label: 'Chosen' }, { value: 'no', label: 'Not chosen' }]} />
          </div>
          {list.error ? <LoadError what="the clients" error={list.error} onRetry={() => list.refetch()} />
            : list.isLoading ? <Skeleton className="h-48 w-full" />
            : !rows.length ? (
              <EmptyBox className="p-4">{l?.responses ? 'No client matches these filters.' : 'No response has been read yet. Replies are read once AI is switched on (AI tab).'}</EmptyBox>
            ) : (
              <div className={WS_TABLE_WRAP}>
                <table className={WS_TABLE}>
                  <thead>
                    <tr>
                      <th className={cn(WS_TH, 'w-8')}><span className="sr-only">Open</span></th>
                      <th className={WS_TH}>Client</th>
                      <th className={cn(WS_TH, 'text-right')}>Responses</th>
                      <th className={cn(WS_TH, 'text-right')}>Pairs kept</th>
                      <th className={WS_TH}>Forms and years</th>
                      <th className={WS_TH}>Last response</th>
                      <th className={WS_TH}>Teaches</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c) => {
                      const id = c.client_id as string;
                      const isOpen = expanded === id;
                      const partly = (c.responses_included ?? 0) > 0 && (c.responses_included ?? 0) < (c.responses ?? 0);
                      return (
                        <React.Fragment key={id}>
                          <tr className={WS_TR}>
                            <td className={WS_TD}>
                              <button type="button" onClick={() => setExpanded(isOpen ? null : id)} aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} ${c.client_name}'s responses`}
                                className="rounded p-0.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                <ChevronRight className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-90')} aria-hidden />
                              </button>
                            </td>
                            <td className={cn(WS_TD, 'max-w-[16rem]')}>
                              <button type="button" className="block w-full truncate text-left text-sm font-medium hover:underline" onClick={() => setExpanded(isOpen ? null : id)}>{c.client_name}</button>
                              <span className="font-mono text-[11px] text-muted-foreground">{c.client_gstin}</span>
                            </td>
                            <td className={WS_TD_NUM}>
                              {c.responses}
                              <div className="text-[11px] text-muted-foreground">{c.past} past · {c.ongoing} ongoing{(c.read ?? 0) < (c.responses ?? 0) ? ` · ${(c.responses ?? 0) - (c.read ?? 0)} to read` : ''}</div>
                            </td>
                            <td className={WS_TD_NUM}>{c.pairs_included}/{c.pairs}</td>
                            <td className={cn(WS_TD, 'max-w-[14rem] truncate text-xs text-muted-foreground')}>
                              {[...(c.forms ?? []).slice(0, 4), ...(c.financial_years ?? []).slice(0, 3).map((y) => `FY ${fmtFy(y)}`)].join(' · ') || '—'}
                            </td>
                            <td className={cn(WS_TD, 'whitespace-nowrap text-xs')}>{fmtDate(c.last_response_date)}</td>
                            <td className={WS_TD}>
                              <div className="flex items-center gap-1.5">
                                <Switch checked={!!c.ai_learning} disabled={!canEdit} onCheckedChange={(v) => toggleClient(c, v)}
                                  aria-label={`${c.ai_learning ? 'Leave out' : 'Choose'} ${c.client_name}`} />
                                {partly && <span className="text-[11px] text-muted-foreground">{c.responses_included} of {c.responses}</span>}
                              </div>
                            </td>
                          </tr>
                          {isOpen && (
                            <tr>
                              <td colSpan={7} className="border-b bg-muted/20 p-2">
                                <ClientResponses clientId={id} canEdit={canEdit} actor={actor} onOpen={setOpen} onChanged={refresh} />
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
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

/** A client's responses, under its row: each can be left out on its own. */
const ClientResponses: React.FC<{ clientId: string; canEdit: boolean; actor: string | null; onOpen: (r: LearningResponse) => void; onChanged: () => void }> = ({ clientId, canEdit, actor, onOpen, onChanged }) => {
  const q = useQuery({ queryKey: ['ai-learning-client-responses', clientId], queryFn: () => loadClientResponses(clientId) });
  const toggle = async (r: LearningResponse, include: boolean) => {
    try { await setResponsesIncluded([r.id as string], include, actor); await q.refetch(); onChanged(); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  };
  if (q.isLoading) return <Skeleton className="h-24 w-full" />;
  if (q.error) return <LoadError what="the responses" error={q.error} onRetry={() => q.refetch()} />;
  const rows = q.data ?? [];
  if (!rows.length) return <EmptyBox className="p-3">No response.</EmptyBox>;
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-b last:border-0">
            <td className="px-2 py-1.5 align-top whitespace-nowrap text-xs">
              {r.notice_id ? <Link to={`/notices/${r.notice_id}?tab=assistant`} className={INLINE_LINK}>{[r.form_code, r.notice_ref].filter(Boolean).join(' · ') || 'Notice'}</Link> : '—'}
              {r.financial_year && <div className="text-[11px] text-muted-foreground">FY {fmtFy(r.financial_year)}</div>}
            </td>
            <td className="max-w-[28rem] px-2 py-1.5 align-top">
              <button type="button" className="block w-full truncate text-left text-xs hover:underline" onClick={() => onOpen(r)}>{r.title || r.label}</button>
              <span className="text-[11px] text-muted-foreground">{RESPONSE_SOURCE[r.source ?? ''] ?? r.source} · {r.phase}{r.status !== 'done' ? ` · ${r.status === 'queued' ? 'waiting to be read' : r.status}` : ''}</span>
            </td>
            <td className="px-2 py-1.5 align-top whitespace-nowrap text-xs">{fmtDate(r.response_date)}</td>
            <td className="px-2 py-1.5 text-right align-top text-xs tabular-nums"><button type="button" className={INLINE_LINK} onClick={() => onOpen(r)}>{r.pairs_included ?? 0}/{r.pairs ?? 0}</button></td>
            <td className="px-2 py-1.5 align-top">
              <Switch checked={!!r.learning_included} disabled={!canEdit} onCheckedChange={(v) => toggle(r, v)} aria-label={`${r.learning_included ? 'Leave out' : 'Choose'} ${r.title || r.label}`} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
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
