// "Portal e-mails" (roadmap Phase 3): the GST portal's notice e-mails the
// office agent read from the firm's inbox in the last 7 days — which client
// each matched, whether it queued a priority sync, the notice once it is in
// the app and how long that took (the 4-hour target for short-clock forms).
import React, { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Note } from '@/components/gstr9/ui';
import { WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TH, WS_TR } from '@/components/workspace/theme';
import { FilterPill } from '@/components/notices/FilterPill';
import { supabase } from '@/integrations/supabase/client';
import { addDays, istToday } from '@/lib/noticeFacts';
import { EMAIL_STATUS, fmtMinutes, fmtWhen, istDayStart, type AutopilotStatus, type PortalEmail } from '@/lib/autopilot';
import { fmtAgo, plural } from '@/lib/noticeFormat';
import { EmptyBox, INLINE_LINK, LoadError, ToneBadge } from './parts';
import { cn } from '@/lib/utils';

type EmailRow = Pick<PortalEmail, 'id' | 'received_at' | 'from_addr' | 'subject' | 'gstins' | 'form_code' | 'reference_number' | 'client_id' |
  'status' | 'job_id' | 'notice_id' | 'notice_seen_at'> & { clients: { name: string; gstin: string | null } | null };

/** The status filter; "sync" is every e-mail that queued (or already had) a sync — the status line's "queued" count. */
const STATUS_FILTERS: { key: string; label: string; match: (s: string) => boolean }[] = [
  { key: 'sync', label: 'Queued a sync', match: (s) => s === 'queued' || s === 'already_queued' || s === 'synced' },
  { key: 'unmatched', label: 'No client with this GSTIN', match: (s) => s === 'unmatched' },
  { key: 'autopilot_off', label: 'Not queued: trigger off', match: (s) => s === 'autopilot_off' },
  { key: 'ignored', label: 'Not a notice e-mail', match: (s) => s === 'ignored' },
];

const captureMinutes = (e: EmailRow) => (e.notice_seen_at ? (Date.parse(e.notice_seen_at) - Date.parse(e.received_at)) / 60_000 : null);

export const EmailsTab: React.FC<{ status: AutopilotStatus | undefined; canManage: boolean; onOpenSettings: () => void }> = ({ status, canManage, onOpenSettings }) => {
  const [sp, setSp] = useSearchParams();
  const today = sp.get('when') === 'today';
  const filter = STATUS_FILTERS.find((f) => f.key === sp.get('estatus'));
  const since = istDayStart(addDays(istToday(), -6));
  const q = useQuery({
    queryKey: ['autopilot-emails', since],
    refetchInterval: 60_000,
    queryFn: async (): Promise<EmailRow[]> => {
      const { data, error } = await supabase.from('portal_emails')
        .select('id, received_at, from_addr, subject, gstins, form_code, reference_number, client_id, status, job_id, notice_id, notice_seen_at, clients(name, gstin)')
        .gte('received_at', since).order('received_at', { ascending: false }).limit(1000);
      if (error) throw error;
      return (data ?? []) as unknown as EmailRow[];
    },
  });
  // Forms with a reply clock of 7 days or less: the e-mail should bring them in within 4 hours.
  const shortForms = useQuery({
    queryKey: ['notice-short-forms'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from('notice_form_rules').select('form_code, reply_days').lte('reply_days', 7);
      return new Set((data ?? []).map((r) => r.form_code));
    },
  });

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp);
    Object.entries(patch).forEach(([k, v]) => { if (v === null) next.delete(k); else next.set(k, v); });
    setSp(next);
  };
  const dayStart = Date.parse(istDayStart());
  const rows = useMemo(() => (q.data ?? []).filter((e) => (!today || Date.parse(e.received_at) >= dayStart)
    && (!filter || filter.match(e.status))), [q.data, today, filter, dayStart]);
  const em = status?.email;
  const short = shortForms.data ?? new Set<string>();

  return (
    <div className="space-y-2">
      {em && !em.enabled && (
        <Note tone="warn">
          The e-mail trigger is off: portal e-mails are read and listed here, but they do not queue a sync.
          {canManage ? <> Switch it on in <button type="button" onClick={onOpenSettings} className={INLINE_LINK}>Settings</button>.</> : ' A GST manager can switch it on in Settings.'}
        </Note>
      )}
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
        {em?.address
          ? <>Reading <span className="font-medium text-foreground">{em.address}</span> · last read {fmtAgo(em.last_poll_at)}</>
          : <>No inbox is connected yet: the office agent reads the firm's notices inbox once it is set up on the office PC.</>}
        {em?.last_error && <span className="font-medium text-destructive-strong">· last error: {em.last_error}</span>}
        {em && (
          <>
            <span aria-hidden>·</span>
            <Link to="/notices-autopilot?tab=emails&when=today" className={INLINE_LINK}>{plural(em.today.received, 'e-mail')} today</Link>
            <span aria-hidden>·</span>
            <Link to="/notices-autopilot?tab=emails&when=today&estatus=sync" className={INLINE_LINK}>{em.today.queued} queued a sync</Link>
            <span aria-hidden>·</span>
            <Link to="/notices-autopilot?tab=emails&when=today&estatus=unmatched" className={INLINE_LINK}>{em.today.unmatched} matched no client</Link>
          </>
        )}
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        <FilterPill label="Received" allLabel="Last 7 days" value={today ? 'today' : 'all'} onChange={(v) => set({ when: v === 'today' ? 'today' : null })}
          options={[]} extraOptions={[{ value: 'today', label: 'Today' }]} />
        <FilterPill label="Status" allLabel="Any" value={filter?.key ?? 'all'} onChange={(v) => set({ estatus: v === 'all' ? null : v })}
          options={[]} extraOptions={STATUS_FILTERS.map((f) => ({ value: f.key, label: f.label }))} />
        {(today || filter) && (
          <button type="button" onClick={() => set({ when: null, estatus: null })}
            className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Clear filters <X className="h-3 w-3" aria-hidden />
          </button>
        )}
      </div>

      {q.error ? <LoadError what="the portal e-mails" error={q.error} onRetry={() => q.refetch()} />
        : q.isLoading ? <Skeleton className="h-48 w-full" />
        : rows.length === 0 ? (
          <EmptyBox>{today || filter ? 'No portal e-mail matches these filters.' : 'No portal e-mail in the last 7 days.'}</EmptyBox>
        ) : (
          <>
            <h3 className="sr-only" aria-live="polite">{plural(rows.length, 'portal e-mail')}</h3>
            <ul className="space-y-2 md:hidden">
              {rows.map((e) => <EmailCard key={e.id} e={e} short={!!e.form_code && short.has(e.form_code)} />)}
            </ul>
            <div className={cn(WS_TABLE_WRAP, 'hidden md:block')} tabIndex={0} role="region" aria-label="Portal e-mails">
              <table className={WS_TABLE}>
                <thead>
                  <tr>
                    <th scope="col" className={WS_TH}>Received</th>
                    <th scope="col" className={WS_TH}>Client</th>
                    <th scope="col" className={WS_TH}>Form</th>
                    <th scope="col" className={WS_TH}>Reference</th>
                    <th scope="col" className={WS_TH}>Status</th>
                    <th scope="col" className={WS_TH}>Notice</th>
                    <th scope="col" className={cn(WS_TH, 'text-right')}>E-mail to app</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => {
                    const st = EMAIL_STATUS[e.status] ?? { label: e.status, tone: 'secondary' as const };
                    const min = captureMinutes(e);
                    const isShort = !!e.form_code && short.has(e.form_code);
                    return (
                      <tr key={e.id} className={WS_TR}>
                        <td className={cn(WS_TD, 'whitespace-nowrap text-xs')}>{fmtWhen(e.received_at)}</td>
                        <td className={cn(WS_TD, 'max-w-[14rem]')}>
                          {e.client_id
                            ? <Link to={`/notices-company/${e.client_id}`} className="block truncate font-medium hover:underline">{e.clients?.name ?? 'Client'}</Link>
                            : <span className="text-xs text-muted-foreground">No client</span>}
                          <div className="font-mono text-[11px] text-muted-foreground">{e.clients?.gstin ?? e.gstins.join(', ')}</div>
                        </td>
                        <td className={cn(WS_TD, 'text-xs')}>
                          {e.form_code ?? '—'}{isShort && <div className="text-[11px] text-muted-foreground">short clock</div>}
                        </td>
                        <td className={cn(WS_TD, 'font-mono text-xs')}>{e.reference_number ?? '—'}</td>
                        <td className={WS_TD}><ToneBadge tone={st.tone}>{st.label}</ToneBadge></td>
                        <td className={cn(WS_TD, 'text-xs')}>
                          {e.notice_id ? <Link to={`/notices/${e.notice_id}`} className={INLINE_LINK}>Open notice</Link>
                            : e.client_id && e.status !== 'ignored' ? <span className="text-muted-foreground">not in the app yet</span> : '—'}
                        </td>
                        <td className={cn(WS_TD, 'whitespace-nowrap text-right text-xs tabular-nums')}>
                          {min === null ? '—' : (
                            <span className={cn(isShort && (min <= 240 ? 'font-semibold text-success-strong' : 'font-semibold text-destructive-strong'))}>
                              {fmtMinutes(min)}{isShort ? (min <= 240 ? ' ✓' : ' (over 4 h)') : ''}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      <p className="text-[11px] text-muted-foreground">
        Only the subject, a short snippet and the GSTIN, form and reference are kept — never the whole e-mail. A short-clock form
        (reply in 7 days or less) should be in the app within 4 hours of its e-mail.
      </p>
    </div>
  );
};

const EmailCard: React.FC<{ e: EmailRow; short: boolean }> = ({ e, short }) => {
  const st = EMAIL_STATUS[e.status] ?? { label: e.status, tone: 'secondary' as const };
  const min = captureMinutes(e);
  return (
    <li className="space-y-1 rounded-lg border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {e.client_id
            ? <Link to={`/notices-company/${e.client_id}`} className="block truncate text-sm font-semibold hover:underline">{e.clients?.name ?? 'Client'}</Link>
            : <span className="text-sm text-muted-foreground">No client</span>}
          <div className="font-mono text-[11px] text-muted-foreground">{e.clients?.gstin ?? e.gstins.join(', ')}</div>
        </div>
        <ToneBadge tone={st.tone}>{st.label}</ToneBadge>
      </div>
      <div className="text-xs">{e.form_code ?? 'Form not read'}{short ? ' · short clock' : ''} · <span className="font-mono">{e.reference_number ?? 'no reference'}</span></div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>Received {fmtWhen(e.received_at)}{min !== null ? ` · in the app ${fmtMinutes(min)} later` : ''}</span>
        {e.notice_id && <Link to={`/notices/${e.notice_id}`} className={INLINE_LINK}>Open notice</Link>}
      </div>
    </li>
  );
};

export default EmailsTab;
