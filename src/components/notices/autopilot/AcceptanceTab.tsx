// Acceptance (roadmap Phase 3): the three targets, one row per IST day from
// public.autopilot_metrics — active GSTINs fresh (< 24 h) or with a named
// failure reason (≥ 95%), human time on fetching (≤ 20 min a day: the minutes
// the CAPTCHAs were on screen in front of someone), and portal notices in the
// app within 24 h (within 4 h for short-clock forms a portal e-mail announced)
// — and how many of the last 10 working days met each. The attentive wall time
// is shown beside the human time.
import React from 'react';
import { Check, X } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { KpiTile, Note } from '@/components/gstr9/ui';
import { WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TH, WS_TR } from '@/components/workspace/theme';
import { istToday } from '@/lib/noticeFacts';
import { useAutopilotMetrics, type MetricsRow } from '@/lib/autopilot';
import { fmtDay } from '@/lib/noticeFormat';
import { LoadError } from './parts';
import { cn } from '@/lib/utils';

const FRESH_TARGET = 95;
const HUMAN_TARGET = 20;

const freshOk = (r: MetricsRow) => r.share !== null && Number(r.share) >= FRESH_TARGET;
const humanOk = (r: MetricsRow) => Number(r.typing_minutes) <= HUMAN_TARGET;
const captureOk = (r: MetricsRow) => r.captured_within_24h >= r.notices_captured && r.short_form_within_4h >= r.short_form_emails;

const Mark: React.FC<{ ok: boolean; label: string }> = ({ ok, label }) => ok
  ? <><Check className="ml-1 inline h-3.5 w-3.5 text-success-strong" aria-hidden /><span className="sr-only"> meets {label}</span></>
  : <><X className="ml-1 inline h-3.5 w-3.5 text-destructive-strong" aria-hidden /><span className="sr-only"> misses {label}</span></>;

export const AcceptanceTab: React.FC = () => {
  const q = useAutopilotMetrics(14);
  if (q.error) return <LoadError what="the acceptance numbers" error={q.error} onRetry={() => q.refetch()} />;
  if (q.isLoading || !q.data) return <Skeleton className="h-96 w-full" />;
  const today = istToday();
  const rows = q.data;
  // The last 10 complete working days (today is still running).
  const days = rows.filter((r) => r.working && r.day < today).slice(0, 10);
  const met = (f: (r: MetricsRow) => boolean) => days.filter(f).length;
  const tone = (n: number) => (days.length === 0 ? 'neutral' : n === days.length ? 'ok' : n >= days.length * 0.8 ? 'warn' : 'error');
  const [a, b, c] = [met(freshOk), met(humanOk), met(captureOk)];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        <KpiTile label="GSTINs fresh or with a named reason ≥ 95%" value={`${a} of ${days.length} days`} tone={tone(a)}
          hint="fresh = a good notices pull in the last 24 h" />
        <KpiTile label={`Time at the CAPTCHAs ≤ ${HUMAN_TARGET} min a day`} value={`${b} of ${days.length} days`} tone={tone(b)}
          hint="minutes CAPTCHAs were on screen, everyone together" />
        <KpiTile label="Notices in the app within 24 h (4 h after an e-mail)" value={`${c} of ${days.length} days`} tone={tone(c)}
          hint="every new portal notice; short-clock forms from their e-mail" />
      </div>
      <Note tone="info">
        Counted over the last {days.length} complete working days (Sundays and today left out). A day with no new notice meets the
        third target. Eligible GSTINs are today's active clients with a portal login that are not excluded from the notices sync.
      </Note>

      {/* A wide table scrolls inside its frame on a phone; the frame takes keyboard focus so it can be scrolled. */}
      <div className={WS_TABLE_WRAP} tabIndex={0} role="region" aria-label="Acceptance by day">
        <table className={WS_TABLE}>
          <caption className="sr-only">Acceptance by day, newest first</caption>
          <thead>
            <tr>
              <th scope="col" className={WS_TH}>Day</th>
              <th scope="col" className={cn(WS_TH, 'text-right')}>Fresh or named</th>
              <th scope="col" className={cn(WS_TH, 'text-right')}>Time at the CAPTCHAs, min</th>
              <th scope="col" className={cn(WS_TH, 'text-right')}>Wall open (attentive), min</th>
              <th scope="col" className={cn(WS_TH, 'text-right')}>CAPTCHAs typed</th>
              <th scope="col" className={cn(WS_TH, 'text-right')}>Notices · within 24 h</th>
              <th scope="col" className={cn(WS_TH, 'text-right')}>Short-clock e-mails · within 4 h</th>
              <th scope="col" className={cn(WS_TH, 'text-right')}>Jobs done · failed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.day} className={cn(WS_TR, !r.working && 'bg-muted/40')}>
                <th scope="row" className={cn(WS_TD, 'whitespace-nowrap text-left font-medium')}>
                  {fmtDay(r.day)}
                  {!r.working && <span className="ml-1 text-[11px] font-normal text-foreground/70">(not a working day)</span>}
                  {r.day === today && <span className="ml-1 text-[11px] font-normal text-foreground/70">(so far)</span>}
                </th>
                <td className={WS_TD_NUM}>
                  {r.share === null ? '—' : `${Number(r.share).toFixed(1)}%`}
                  {r.working && r.share !== null && <Mark ok={freshOk(r)} label="the 95% target" />}
                  <span className="block text-[11px] text-muted-foreground">{r.fresh} fresh + {r.named} named of {r.eligible}</span>
                </td>
                <td className={WS_TD_NUM}>{Number(r.typing_minutes).toFixed(1)}{r.working && <Mark ok={humanOk(r)} label="the 20-minute target" />}</td>
                <td className={WS_TD_NUM}>{Number(r.wall_minutes).toFixed(1)}</td>
                <td className={WS_TD_NUM}>{r.captchas}</td>
                <td className={WS_TD_NUM}>
                  {r.notices_captured} · {r.captured_within_24h}
                  {r.notices_captured > 0 && <Mark ok={r.captured_within_24h >= r.notices_captured} label="the 24-hour target" />}
                  {r.notices_captured > 0 && r.capture_median_hours !== null && <span className="block text-[11px] text-muted-foreground">median {Number(r.capture_median_hours).toFixed(1)} h</span>}
                </td>
                <td className={WS_TD_NUM}>
                  {r.short_form_emails ? `${r.short_form_emails} · ${r.short_form_within_4h}` : '—'}
                  {r.short_form_emails > 0 && <Mark ok={r.short_form_within_4h >= r.short_form_emails} label="the 4-hour target" />}
                  {r.short_form_emails > 0 && r.email_median_minutes !== null && <span className="block text-[11px] text-muted-foreground">median {Math.round(Number(r.email_median_minutes))} min</span>}
                </td>
                <td className={WS_TD_NUM}>{r.jobs_done} · {r.jobs_failed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AcceptanceTab;
