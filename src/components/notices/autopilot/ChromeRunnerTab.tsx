// Scheduled syncs in the firm's own Chrome (the firm's decision of 6 Oct 2026;
// GST Keeper extension 0.7.0): how to set it up, the Chromes that run the queue
// and what each is doing, the schedule, today's queue and failures at a glance
// (every count opens its list), and the kill switch. There is no CAPTCHA wall:
// the CAPTCHA extension in that Chrome fills each CAPTCHA, and a client whose
// CAPTCHA is not filled in time is tried again later.
import React from 'react';
import { Link } from 'react-router-dom';
import { Check, Circle, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Note } from '@/components/gstr9/ui';
import { SectionCard } from '@/components/notices/ui/Panel';
import { WS_BTN } from '@/components/workspace/theme';
import { compareVersions, RECOMMENDED_EXTENSION_VERSION } from '@/lib/extensionVersion';
import {
  autopilotQueueHref, autopilotState, chromeRunners, fmtTime, hhmm, nextRunWords, reasonLabel, runnerWaiting, runnerWords,
  type AutopilotStatus, type SlotRun,
} from '@/lib/autopilot';
import { fmtAgo, plural } from '@/lib/noticeFormat';
import { MasterSwitch } from './MasterSwitch';
import { INLINE_LINK, ToneBadge } from './parts';
import { cn } from '@/lib/utils';

const Step: React.FC<{ n: number; done: boolean; children: React.ReactNode }> = ({ n, done, children }) => (
  <li className="flex gap-2.5">
    <span className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
      done ? 'bg-success/15 text-success-strong' : 'bg-primary/10 text-primary')} aria-hidden>
      {done ? <Check className="h-3 w-3" /> : n}
    </span>
    <span className="min-w-0 text-sm">{children}{done && <span className="sr-only"> (done)</span>}</span>
  </li>
);

const slotWords = (slot: SlotRun | undefined) => (slot
  ? `ran today at ${fmtTime(slot.fired_at)}, ${plural(slot.jobs, 'client')} queued`
  : 'not run yet today');

export const ChromeRunnerTab: React.FC<{ status: AutopilotStatus | undefined; loading: boolean; onOpenTab: (tab: string) => void }> = ({ status, loading, onOpenTab }) => {
  if (loading && !status) return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}</div>;
  const s = status?.settings ?? null;
  const runners = chromeRunners(status);
  const online = runners.filter((r) => r.online);
  const current = runners.some((r) => !!r.version && compareVersions(r.version, RECOMMENDED_EXTENSION_VERSION) >= 0);
  const state = autopilotState(s);
  const morning = hhmm(s?.morning_at) || '05:30';
  const afternoon = s && s.afternoon_scope !== 'off' ? hhmm(s.afternoon_at) || '13:00' : null;
  const wait = status?.captcha_wait_secs ?? s?.captcha_wait_secs ?? 120;
  const next = nextRunWords(s);
  const q = status?.queue;
  const today = status?.today;
  const failures = [...(status?.failures ?? [])].sort((a, b) => b.count - a.count);
  const failing = failures.reduce((n, g) => n + g.count, 0);

  return (
    <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-2">
      <div className="min-w-0 space-y-3">
        <SectionCard title="Scheduled syncs in your Chrome"
          description="The Chrome that has your CAPTCHA extension runs the schedule: no CAPTCHA wall, nobody at the screen.">
          <ol className="space-y-2" aria-label="Set up">
            <Step n={1} done={current}>
              Load GST Keeper extension {RECOMMENDED_EXTENSION_VERSION} in the Chrome that has your CAPTCHA extension.
            </Step>
            <Step n={2} done={runners.length > 0}>
              In its popup, tick “Run scheduled syncs in this Chrome”.
            </Step>
            <Step n={3} done={state === 'on'}>
              Switch on Autopilot below. Keep that PC and Chrome on at {morning}{afternoon ? ` and ${afternoon}` : ''}; a slot that finds Chrome
              closed runs when it opens within 3 hours.
            </Step>
          </ol>
          <p className="text-xs text-muted-foreground">
            The CAPTCHA is filled by the CAPTCHA extension in that Chrome; GST Keeper never reads it. If it is not filled within {wait} seconds,
            the client is tried again later. A sync someone starts in that Chrome goes first.
          </p>
        </SectionCard>
        <MasterSwitch status={status} />
      </div>

      <div className="min-w-0 space-y-3">
        <SectionCard title="Chrome runners" description="Each Chrome with scheduled syncs switched on, as it last reported (about once a minute).">
          {runners.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No Chrome has reported yet. Follow the steps on the PC that has the CAPTCHA extension; it appears here within a minute.
            </p>
          ) : (
            <ul className="divide-y">
              {runners.map((r) => (
                <li key={r.agent_id} className="space-y-0.5 py-1.5 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.label || 'Chrome'}</span>
                    <ToneBadge tone={r.online ? 'success' : 'warning'}>{r.online ? 'Online' : 'Offline'}</ToneBadge>
                    {r.version && <span className="text-muted-foreground">extension v{r.version}</span>}
                  </div>
                  <p className="text-muted-foreground">{r.online ? 'seen' : 'last seen'} {fmtAgo(r.last_seen)}</p>
                  <p className={cn(r.busy && 'font-medium')}>{runnerWords(r, runnerWaiting(status, r.agent_id))}</p>
                </li>
              ))}
            </ul>
          )}
          {state === 'on' && online.length === 0 && (
            <Note tone="warn">
              No scheduled Chrome is online, so the queue waits. A run that finds Chrome closed starts when it opens within 3 hours; whatever is
              not reached by {hhmm(s?.close_at) || '23:30'} is closed as “The scheduled Chrome was offline”.
            </Note>
          )}
        </SectionCard>

        <SectionCard title="Schedule" description="Times are India time (IST)."
          actions={<Button size="sm" variant="outline" className={WS_BTN} onClick={() => onOpenTab('settings')}><Settings className="h-3.5 w-3.5" aria-hidden /> Change</Button>}>
          {!s?.schedule_enabled ? (
            <p className="text-sm">The schedule is off: only Sync now, Fetch a report and portal e-mails put clients on the queue.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              <li className="flex flex-wrap gap-x-2"><span className="font-medium">{morning} every active client</span>
                <span className="text-muted-foreground">{slotWords(status?.slots?.morning)}</span></li>
              {afternoon && (
                <li className="flex flex-wrap gap-x-2">
                  <span className="font-medium">{afternoon} {s.afternoon_scope === 'all' ? 'every active client' : 'clients that need it'}</span>
                  <span className="text-muted-foreground">{slotWords(status?.slots?.afternoon)}</span>
                </li>
              )}
              {next && <li className="text-xs text-muted-foreground">Next run {next}.</li>}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            CAPTCHA wait {wait} seconds · {plural(s?.max_attempts ?? 3, 'try', 'tries')} per client, 5, 10, 20 minutes apart · the day closes at {hhmm(s?.close_at) || '23:30'}.
          </p>
        </SectionCard>

        <SectionCard title="Today" description="Every count opens its list.">
          {q && today ? (
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
              <li><Link to={autopilotQueueHref('queued')} className={INLINE_LINK}>{q.queued + q.retrying} queued</Link></li>
              <li><Link to={autopilotQueueHref('running')} className={INLINE_LINK}>{q.running} running</Link></li>
              <li><Link to={autopilotQueueHref('succeeded')} className={INLINE_LINK}>{today.succeeded} done</Link></li>
              <li>
                <Link to={autopilotQueueHref('failed')} className={cn(INLINE_LINK, today.failed > 0 && 'text-destructive-strong hover:text-destructive-strong')}>
                  {today.failed} failed
                </Link>
              </li>
            </ul>
          ) : <p className="text-xs text-muted-foreground">Loading…</p>}
          <div className="space-y-1">
            <h4 className="text-xs font-semibold">Clients not read, by reason</h4>
            {failing === 0 ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Circle className="h-2.5 w-2.5 fill-success text-success" aria-hidden /> None: every active client is fresh, queued or not due yet.</p>
            ) : (
              <ul className="space-y-0.5 text-xs">
                {failures.slice(0, 6).map((g) => (
                  <li key={`${g.reason}-${g.fix ?? ''}`}>
                    <Link to="/notices-autopilot?tab=attention"
                      className="flex items-center justify-between gap-2 rounded px-1 py-0.5 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <span className="min-w-0 truncate underline underline-offset-2">{reasonLabel(g.reason, g.fix)}</span>
                      <span className="shrink-0 font-semibold tabular-nums">{g.count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SectionCard>
      </div>
    </div>
  );
};

export default ChromeRunnerTab;
