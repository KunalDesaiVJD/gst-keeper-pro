// "Client consent" (roadmap Phase 4; audit R-15): which clients agreed — the
// engagement-letter clause — that the firm may read their notices with the
// Claude API, and who opted out. Nothing of a client without consent is ever
// sent. A GST manager marks consent (date and note), withdraws it or records
// an opt-out for many clients at once; everyone else reads the list.
import React, { useId, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Ban, Check, Loader2, Search, Undo2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Note } from '@/components/gstr9/ui';
import { WS_BTN, WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TH, WS_TR } from '@/components/workspace/theme';
import { FilterPill } from '@/components/notices/FilterPill';
import { EmptyBox, INLINE_LINK, LoadError, ToneBadge } from '@/components/notices/autopilot/parts';
import { useAuth } from '@/contexts/AuthContext';
import { istToday } from '@/lib/noticeFacts';
import { fmtDate, plural } from '@/lib/noticeFormat';
import { consentState, factoryHref, setConsent, useConsentClients, type ConsentClient, type ConsentState } from '@/lib/replyFactory';
import { cn } from '@/lib/utils';

const FILTERS: { key: ConsentState; label: string }[] = [
  { key: 'with', label: 'With consent' },
  { key: 'without', label: 'Without consent' },
  { key: 'opted_out', label: 'Opted out' },
];

const StateBadge: React.FC<{ c: ConsentClient }> = ({ c }) => {
  const st = consentState(c);
  if (st === 'opted_out') return <ToneBadge tone="destructive">Opted out</ToneBadge>;
  if (st === 'with') return <ToneBadge tone="success">Consent {fmtDate(c.ai_consent_at)}</ToneBadge>;
  return <ToneBadge tone="secondary">No consent</ToneBadge>;
};

export const ConsentTab: React.FC = () => {
  const uid = useId();
  const { canManageNoticeAlerts } = useAuth();
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const q = useConsentClients();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [marking, setMarking] = useState(false);
  const [date, setDate] = useState(istToday());
  const [note, setNote] = useState('Engagement letter clause');
  const [busy, setBusy] = useState(false);
  const canEdit = canManageNoticeAlerts();

  const filter = (FILTERS.find((f) => f.key === sp.get('consent'))?.key ?? 'all') as ConsentState | 'all';
  const search = (sp.get('q') ?? '').trim().toLowerCase();
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp);
    Object.entries(patch).forEach(([k, v]) => { if (!v || v === 'all') next.delete(k); else next.set(k, v); });
    setSp(next);
  };
  const base = useMemo(() => (q.data ?? []).filter((c) => !search || `${c.name} ${c.gstin}`.toLowerCase().includes(search)), [q.data, search]);
  const count = (k: ConsentState) => base.filter((c) => consentState(c) === k).length;
  const rows = base.filter((c) => filter === 'all' || consentState(c) === filter);
  const shownPicked = rows.filter((c) => picked.has(c.id));
  const allShownPicked = rows.length > 0 && shownPicked.length === rows.length;
  const toggle = (id: string, on: boolean) => setPicked((p) => { const n = new Set(p); if (on) n.add(id); else n.delete(id); return n; });
  const toggleAll = (on: boolean) => setPicked((p) => { const n = new Set(p); rows.forEach((c) => (on ? n.add(c.id) : n.delete(c.id))); return n; });
  const ids = [...picked];

  const run = async (action: 'mark' | 'withdraw' | 'opt_out') => {
    if (!ids.length) return;
    if (action !== 'mark') {
      const ok = await confirm(action === 'withdraw' ? {
        title: `Withdraw consent for ${plural(ids.length, 'client')}?`,
        description: 'Their notices are no longer read with AI: anything of theirs waiting in the queue is cancelled when the agent reaches it. Fields already read stay as they are.',
        confirmText: 'Withdraw consent', destructive: true,
      } : {
        title: `Record that ${plural(ids.length, 'client')} opted out?`,
        description: 'Nothing of theirs is ever read with AI, whatever consent date is on file; the consent date is cleared. Marking consent again later clears the opt-out.',
        confirmText: 'Record the opt-out', destructive: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const n = await setConsent(ids, action, date, note);
      toast.success(action === 'mark' ? `Consent recorded for ${plural(n, 'client')} (${fmtDate(date)}).`
        : action === 'withdraw' ? `Consent withdrawn for ${plural(n, 'client')}.` : `Opt-out recorded for ${plural(n, 'client')}.`);
      setPicked(new Set());
      setMarking(false);
      qc.invalidateQueries({ queryKey: ['reply-factory', 'consent-clients'] });
      qc.invalidateQueries({ queryKey: ['reply-factory-status'] });
    } catch (e) {
      toast.error(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const total = base.length;
  return (
    <div className="space-y-2 pb-16">
      <Note tone="info" open>
        Nothing of a client without consent is ever sent to the Claude API. Consent is the engagement-letter clause that lets the firm process
        the client's notices with AI: record the date it was agreed. A client who opted out is never read, whatever date is on file.
      </Note>
      {!canEdit && <Note tone="info">Only a GST manager can record or withdraw consent. You can read the list.</Note>}

      {q.data && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <Link to={factoryHref('consent', { q: sp.get('q') })} className={INLINE_LINK}>{plural(total, 'active client')}</Link>
          {FILTERS.map((f) => (
            <React.Fragment key={f.key}>
              <span aria-hidden>·</span>
              <Link to={factoryHref('consent', { consent: f.key, q: sp.get('q') })} className={INLINE_LINK}>{count(f.key)} {f.label.toLowerCase()}</Link>
            </React.Fragment>
          ))}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input defaultValue={sp.get('q') ?? ''} key={sp.get('q') ?? ''} placeholder="Client or GSTIN" aria-label="Search clients"
            onKeyDown={(e) => { if (e.key === 'Enter') set({ q: (e.target as HTMLInputElement).value.trim() || null }); }}
            onBlur={(e) => { if ((e.target.value.trim() || null) !== (sp.get('q') || null)) set({ q: e.target.value.trim() || null }); }}
            className="h-8 pl-7 text-xs" />
        </div>
        <FilterPill label="Consent" allLabel={`Every client (${total})`} value={filter} onChange={(v) => set({ consent: v })} options={[]}
          extraOptions={FILTERS.map((f) => ({ value: f.key, label: `${f.label} (${count(f.key)})` }))} />
        {(filter !== 'all' || search) && (
          <button type="button" onClick={() => set({ consent: null, q: null })}
            className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Clear filters <X className="h-3 w-3" aria-hidden />
          </button>
        )}
      </div>

      {q.error ? <LoadError what="the clients" error={q.error} onRetry={() => q.refetch()} />
        : q.isLoading ? <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        : rows.length === 0 ? <EmptyBox>No client matches.</EmptyBox>
        : (
          <>
            <h3 className="sr-only" aria-live="polite">{plural(rows.length, 'client')}</h3>
            {canEdit && (
              <label className="flex items-center gap-2 text-xs md:hidden">
                <Checkbox checked={allShownPicked} onCheckedChange={(v) => toggleAll(!!v)} /> Select all {plural(rows.length, 'client')} shown
              </label>
            )}
            <ul className="space-y-1.5 md:hidden">
              {rows.map((c) => (
                <li key={c.id} className={cn('flex items-start gap-2 rounded-md border bg-card p-2.5', picked.has(c.id) && 'border-primary/50 bg-primary/5')}>
                  {canEdit && <Checkbox checked={picked.has(c.id)} onCheckedChange={(v) => toggle(c.id, !!v)} aria-label={`Select ${c.name}`} className="mt-0.5" />}
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-start justify-between gap-2">
                      <Link to={`/notices-company/${c.id}`} className="min-w-0 truncate text-sm font-medium hover:underline">{c.name}</Link>
                      <StateBadge c={c} />
                    </div>
                    <div className="font-mono text-[11px] text-muted-foreground">{c.gstin}</div>
                    {c.ai_consent_note && <div className="break-words text-xs text-foreground/80">{c.ai_consent_note}</div>}
                  </div>
                </li>
              ))}
            </ul>
            <div className={cn(WS_TABLE_WRAP, 'hidden md:block')}>
              <table className={WS_TABLE}>
                <caption className="sr-only">Clients and their consent to AI reading</caption>
                <thead>
                  <tr>
                    {canEdit && (
                      <th scope="col" className={cn(WS_TH, 'w-8')}>
                        <Checkbox checked={allShownPicked} onCheckedChange={(v) => toggleAll(!!v)} aria-label="Select every client shown" />
                      </th>
                    )}
                    <th scope="col" className={WS_TH}>Client</th>
                    <th scope="col" className={WS_TH}>GSTIN</th>
                    <th scope="col" className={WS_TH}>Consent</th>
                    <th scope="col" className={WS_TH}>Note</th>
                    <th scope="col" className={WS_TH}>Opted out</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id} className={cn(WS_TR, picked.has(c.id) && 'bg-primary/5')}>
                      {canEdit && (
                        <td className={WS_TD}><Checkbox checked={picked.has(c.id)} onCheckedChange={(v) => toggle(c.id, !!v)} aria-label={`Select ${c.name}`} /></td>
                      )}
                      <td className={cn(WS_TD, 'max-w-[18rem]')}><Link to={`/notices-company/${c.id}`} className="block truncate font-medium hover:underline">{c.name}</Link></td>
                      <td className={cn(WS_TD, 'font-mono text-xs')}>{c.gstin}</td>
                      <td className={cn(WS_TD, 'whitespace-nowrap text-xs')}>{c.ai_consent_at ? fmtDate(c.ai_consent_at) : '—'}</td>
                      <td className={cn(WS_TD, 'max-w-[20rem] break-words text-xs')}>{c.ai_consent_note ?? '—'}</td>
                      <td className={cn(WS_TD, 'text-xs')}>{c.ai_opt_out ? <span className="font-medium text-destructive-strong">Yes</span> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

      {canEdit && picked.size > 0 && (
        <div className="sticky bottom-3 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-card p-2 shadow-lg" role="region" aria-label="Selected clients">
          <span className="text-xs font-medium">{plural(picked.size, 'client')} selected</span>
          <Button size="sm" className={WS_BTN} disabled={busy} onClick={() => setMarking(true)}><Check className="h-3.5 w-3.5" aria-hidden /> Mark consent</Button>
          <Button size="sm" variant="outline" className={WS_BTN} disabled={busy} onClick={() => run('withdraw')}><Undo2 className="h-3.5 w-3.5" aria-hidden /> Withdraw</Button>
          <Button size="sm" variant="outline" className={WS_BTN} disabled={busy} onClick={() => run('opt_out')}><Ban className="h-3.5 w-3.5" aria-hidden /> Opt out</Button>
          <Button size="sm" variant="ghost" className={cn(WS_BTN, 'ml-auto')} disabled={busy} onClick={() => setPicked(new Set())}>Clear the selection</Button>
        </div>
      )}

      <Dialog open={marking} onOpenChange={(o) => { if (!o) setMarking(false); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark consent for {plural(ids.length, 'client')}</DialogTitle>
            <DialogDescription>
              Record the date the client agreed (the engagement-letter clause). Their notices may then be read with AI while it is switched on;
              an opt-out on file is cleared.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (date) run('mark'); }}>
            <div className="space-y-1">
              <Label htmlFor={`${uid}-date`}>Consent given on</Label>
              <Input id={`${uid}-date`} type="date" value={date} max={istToday()} onChange={(e) => setDate(e.target.value)} className="h-9 w-44" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${uid}-note`}>Note</Label>
              <Input id={`${uid}-note`} value={note} onChange={(e) => setNote(e.target.value)} className="h-9" placeholder="Engagement letter clause" />
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="ghost" onClick={() => setMarking(false)}>Cancel</Button>
              <Button type="submit" disabled={busy || !date}>{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Mark consent</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ConsentTab;
