// The CAPTCHA wall (roadmap Phase 3; audit S-01, S-23, U-07-1): every portal
// login the office agent holds open, one card each, typed in a burst. Enter
// sends and moves the cursor to the next card while the agent logs that client
// in and reads the portal. The wall asks the database every 2 s for as long as
// it is open, saying whether the person is attentive (on screen, or typed or
// clicked here in the last 10 minutes): the agent opens logins only then, so
// staff can work in another tab and come back when the title or a desktop
// notification says a CAPTCHA is waiting. Each answer carries the time that
// CAPTCHA was on screen — the human time the acceptance target counts.
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, Loader2, Power, RefreshCw, SkipForward } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Note, SectionCard } from '@/components/gstr9/ui';
import { useAuth } from '@/contexts/AuthContext';
import {
  answerCaptcha, autopilotQueueHref, autopilotState, latestAgent, modeLabel, nextRunWords, originLabel, pausedUntilWords, useCaptchaNotify,
  useOnScreenClock, useWallPing, workersLine, type AnswerResult, type AutopilotStatus, type WallCaptcha,
} from '@/lib/autopilot';
import { fmtAgo, plural } from '@/lib/noticeFormat';
import { EmptyBox, INLINE_LINK, ToneBadge } from './parts';
import { cn } from '@/lib/utils';

const isTypingIn = (el: Element | null) =>
  !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el as HTMLElement).isContentEditable);

const CaptchaCard: React.FC<{
  c: WallCaptcha;
  visible: boolean;
  inputRef: (el: HTMLInputElement | null) => void;
  onAnswer: (text: string, onScreenMs: number) => void;
  onRefresh: (onScreenMs: number) => void;
  onSkip: (onScreenMs: number) => void;
}> = ({ c, visible, inputRef, onAnswer, onRefresh, onSkip }) => {
  const uid = useId();
  const [text, setText] = useState('');
  const onScreen = useOnScreenClock(c.prompt_id, visible);
  // A replaced CAPTCHA (same client, new image) starts empty.
  useEffect(() => { setText(''); }, [c.prompt_id]);
  const what = c.job_type === 'FETCH_REPORT' ? modeLabel(c.report) : originLabel(c.origin);
  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.replace(/\s+/g, '');
    if (!t) return;
    onAnswer(t, onScreen());
  };
  return (
    <form onSubmit={send} aria-labelledby={`${uid}-name`}
      className={cn('flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-3 shadow-sm', c.origin === 'email' && 'border-l-4 border-l-warning')}>
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 id={`${uid}-name`} className="truncate text-sm font-semibold" title={c.client_name}>{c.client_name}</h4>
          <div className="font-mono text-[11px] text-muted-foreground">{c.gstin}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <ToneBadge tone={c.origin === 'email' ? 'warning' : 'secondary'}>{what}</ToneBadge>
          {c.attempt > 1 && <ToneBadge tone="warning">Try {c.attempt}</ToneBadge>}
        </div>
      </div>
      <div className="flex h-20 items-center justify-center overflow-hidden rounded-md border bg-white p-1">
        <img src={c.image} alt={`CAPTCHA for ${c.client_name}`} className="h-16 w-auto max-w-full object-contain" draggable={false} />
      </div>
      {c.attempt > 1 && <p className="text-[11px] text-foreground/80">The portal said the last one was wrong; this is a new CAPTCHA.</p>}
      <div className="space-y-1">
        <Label htmlFor={`${uid}-input`} className="text-xs">Type the digits you see<span className="sr-only"> for {c.client_name}</span></Label>
        <div className="flex gap-2">
          <Input id={`${uid}-input`} ref={inputRef} value={text} inputMode="numeric" autoComplete="off" autoCorrect="off"
            autoCapitalize="off" spellCheck={false} enterKeyHint="send" maxLength={12}
            onChange={(e) => setText(e.target.value)}
            className="h-11 min-w-0 flex-1 font-mono text-lg tracking-[0.3em] md:text-lg" />
          <Button type="submit" className="h-11 shrink-0 px-4" disabled={!text.trim()}>Send<span className="sr-only"> for {c.client_name}</span></Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-1">
        <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" onClick={() => onRefresh(onScreen())}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Can't read it<span className="sr-only">: {c.client_name}</span>
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" onClick={() => onSkip(onScreen())}>
          <SkipForward className="h-3.5 w-3.5" aria-hidden /> Skip this client<span className="sr-only">: {c.client_name}</span>
        </Button>
      </div>
    </form>
  );
};

/** What the wall says when no CAPTCHA is on it, in order of what blocks the work. */
const NothingLive: React.FC<{
  status: AutopilotStatus | undefined; waiting: number; working: number; agentOnline: boolean; canManage: boolean; onOpenSettings: () => void;
}> = ({ status, waiting, working, agentOnline, canManage, onOpenSettings }) => {
  const state = autopilotState(status?.settings);
  const agent = latestAgent(status);
  if (status && state === 'off') {
    return (
      <EmptyBox className="space-y-2">
        <p className="font-medium text-foreground">The portal autopilot is switched off.</p>
        <p>Nothing is fetched from the portal and no CAPTCHA comes to this wall until a GST manager switches it on.</p>
        {canManage && (
          <Button size="sm" className="h-8 gap-1 text-xs" onClick={onOpenSettings}><Power className="h-3.5 w-3.5" aria-hidden /> Switch on</Button>
        )}
      </EmptyBox>
    );
  }
  if (status && state === 'paused') {
    return (
      <EmptyBox className="space-y-2">
        <p className="font-medium text-foreground">The autopilot is paused {pausedUntilWords(status.settings?.paused_until)}.</p>
        <p>{waiting ? `${plural(waiting, 'client')} will wait for a CAPTCHA until then.` : 'Nothing is waiting.'}</p>
        {canManage && <Button size="sm" variant="outline" className="h-8 text-xs" onClick={onOpenSettings}>Resume in Settings</Button>}
      </EmptyBox>
    );
  }
  if (!agentOnline) {
    return (
      <Note tone="warn">
        <span className="font-medium">CAPTCHAs cannot be fetched until the office PC's agent is running.</span>{' '}
        {agent ? `It was last seen ${fmtAgo(agent.last_seen)}.` : 'No agent has reported yet.'}{' '}
        Start the GST Keeper agent on the office PC; {waiting ? `${plural(waiting, 'client')} ${waiting === 1 ? 'is' : 'are'} waiting.` : 'nothing is waiting yet.'}
      </Note>
    );
  }
  if (waiting > 0) {
    return (
      <EmptyBox className="flex items-center justify-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        <span>Fetching the next CAPTCHAs from the portal… they appear here within seconds.</span>
      </EmptyBox>
    );
  }
  if (working > 0) {
    return (
      <EmptyBox className="flex items-center justify-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        <span>The agent is working through {plural(working, 'client')}; a CAPTCHA appears here as soon as one needs a login.</span>
      </EmptyBox>
    );
  }
  const next = nextRunWords(status?.settings);
  return (
    <EmptyBox>
      Nothing is waiting for a CAPTCHA.{' '}
      {next ? `The next run is ${next}.` : 'The schedule is off: use Sync now or Fetch a report.'}
    </EmptyBox>
  );
};

/** "Notify me on this PC": a desktop notification when CAPTCHAs arrive while the wall is in a background tab. */
const NotifyButton: React.FC<{ notify: ReturnType<typeof useCaptchaNotify> }> = ({ notify }) => {
  if (!notify.supported) return null;
  if (notify.on) {
    return (
      <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={notify.disable}>
        <BellOff className="h-3.5 w-3.5" aria-hidden /> Stop notifying me
      </Button>
    );
  }
  const enable = async () => {
    const p = await notify.enable();
    if (p === 'granted') toast.success('A desktop notification will say when CAPTCHAs come in while this tab is in the background.');
    else if (p === 'denied') toast.error('This browser blocks notifications for the app. Allow them in the site settings (the icon beside the address), then try again.');
  };
  return (
    <Button type="button" variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={enable}>
      <Bell className="h-3.5 w-3.5" aria-hidden /> Notify me on this PC
    </Button>
  );
};

export const CaptchaWall: React.FC<{ status: AutopilotStatus | undefined; canManage: boolean; onOpenSettings: () => void }> = ({
  status, canManage, onOpenSettings,
}) => {
  const { user } = useAuth();
  const actor = useMemo(() => (user ? { id: user.id, firstName: user.firstName } : null), [user]);
  const { query: ping, visible, touch } = useWallPing(actor);
  const notify = useCaptchaNotify();
  const notifyShow = notify.show;
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [said, setSaid] = useState('');
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const wallRef = useRef<HTMLDivElement>(null);
  const hadCards = useRef(false);
  const seen = useRef(new Map<string, number>());
  const lastCount = useRef(0);

  const w = ping.data;
  // Cards keep their place: a client's new CAPTCHA (a refresh, or a second try) stays where it was, new clients join at the end.
  const live = useMemo(() => {
    const list = (w?.captchas ?? []).filter((c) => !hidden.has(c.prompt_id));
    list.forEach((c) => { if (!seen.current.has(c.job_id)) seen.current.set(c.job_id, seen.current.size); });
    return list.sort((a, b) => (seen.current.get(a.job_id) ?? 0) - (seen.current.get(b.job_id) ?? 0));
  }, [w, hidden]);
  const liveKey = live.map((c) => c.prompt_id).join(',');

  // Forget answered CAPTCHAs once the database no longer lists them.
  useEffect(() => {
    if (!w) return;
    const ids = new Set(w.captchas.map((c) => c.prompt_id));
    setHidden((h) => {
      const next = new Set([...h].filter((id) => ids.has(id)));
      return next.size === h.size ? h : next;
    });
  }, [w]);

  // The live count in the browser tab's title while the wall is open; the old title back when it closes.
  useEffect(() => {
    const before = document.title;
    return () => { document.title = before; };
  }, []);
  useEffect(() => {
    document.title = `${live.length ? `(${live.length}) ` : ''}CAPTCHA wall · GST Keeper`;
  }, [live.length]);

  // From none to some while the tab is in the background: a desktop notification (if asked for).
  useEffect(() => {
    if (!w) return;
    if (lastCount.current === 0 && live.length > 0 && document.visibilityState === 'hidden') {
      notifyShow(`${plural(live.length, 'CAPTCHA')} waiting`, 'The portal autopilot needs you on the CAPTCHA wall.');
    }
    lastCount.current = live.length;
  }, [w, live.length, notifyShow]);

  // The first box takes the cursor when CAPTCHAs arrive, or when the box being typed in went away.
  useEffect(() => {
    if (!live.length) { hadCards.current = false; return; }
    const a = document.activeElement;
    const lost = !a || a === document.body;
    const elsewhere = isTypingIn(a) && !wallRef.current?.contains(a);
    if ((!hadCards.current || lost) && !elsewhere) inputs.current.get(live[0].job_id)?.focus();
    hadCards.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveKey]);

  const refreshCounts = () => {
    qc.invalidateQueries({ queryKey: ['autopilot-status'] });
    qc.invalidateQueries({ queryKey: ['autopilot-badge'] });
  };
  const hide = (c: WallCaptcha) => setHidden((h) => new Set(h).add(c.prompt_id));
  const unhide = (c: WallCaptcha) => setHidden((h) => { const n = new Set(h); n.delete(c.prompt_id); return n; });
  const focusAfter = (c: WallCaptcha) => {
    const i = live.findIndex((x) => x.prompt_id === c.prompt_id);
    const next = live[i + 1] ?? live[i - 1];
    if (next) inputs.current.get(next.job_id)?.focus();
  };
  const notOk = (res: AnswerResult, c: WallCaptcha) => {
    if (res === 'stale') toast.warning('That CAPTCHA was replaced — type the new one.');
    else if (res === 'empty') { unhide(c); toast.error('Type the digits first.'); }
    else if (res === 'gone') toast.info(`${c.client_name} is no longer waiting for a CAPTCHA.`);
  };
  const act = async (c: WallCaptcha, action: 'answer' | 'refresh' | 'skip', text: string | null, onScreenMs: number) => {
    hide(c);
    try {
      const res = await answerCaptcha(c, action, text, onScreenMs, actor);
      if (res !== 'ok') notOk(res, c);
      else if (action === 'answer') setSaid(`Sent for ${c.client_name}. ${plural(Math.max(live.length - 1, 0), 'CAPTCHA')} left on the wall.`);
      else if (action === 'refresh') toast.info(`Asking the portal for a new CAPTCHA for ${c.client_name}…`);
      else toast.success(`${c.client_name} skipped for today. It shows under Needs a person.`);
    } catch (e) {
      unhide(c);
      toast.error(`Couldn't send it for ${c.client_name}: ${e instanceof Error ? e.message : String(e)}`);
    }
    refreshCounts();
  };
  const answer = (c: WallCaptcha) => (text: string, ms: number) => { focusAfter(c); act(c, 'answer', text, ms); };
  const refresh = (c: WallCaptcha) => (ms: number) => { focusAfter(c); act(c, 'refresh', null, ms); };
  const skip = (c: WallCaptcha) => async (ms: number) => {
    const ok = await confirm({
      title: `Skip ${c.client_name} for today?`,
      description: 'The agent leaves this client until the next run. It shows under Needs a person as "Skipped on the CAPTCHA wall", with Run again.',
      confirmText: 'Skip for today',
    });
    if (!ok) return;
    act(c, 'skip', null, ms);
    setTimeout(() => focusAfter(c), 60);
  };

  const waitingTotal = live.length + (w?.waiting ?? 0);
  const others = (w?.present ?? []).filter((n, i, all) => n !== user?.firstName || all.indexOf(n) !== i);
  const agentOnline = w ? w.agent_online : !!status?.agent_online;
  const workers = workersLine(latestAgent(status));

  return (
    // Any key or click on the wall counts as being at it (attentive) for the next 10 minutes.
    <div ref={wallRef} className="space-y-3" onKeyDownCapture={touch} onPointerDownCapture={touch}>
      <SectionCard
        title="CAPTCHA wall"
        description={!w ? 'Connecting to the office agent…'
          : waitingTotal === 0 ? 'Nothing is waiting for a CAPTCHA right now.'
          : `${plural(waitingTotal, 'client')} waiting for a CAPTCHA · ${live.length} on screen. Type each one and press Enter: the next box takes the cursor while the agent logs that client in.`}
        actions={<NotifyButton notify={notify} />}
      >
        {w && (
          <p className="text-xs text-muted-foreground">
            <Link to="/notices-autopilot?tab=acceptance" className={INLINE_LINK}>{w.typed_today} typed today</Link>
            {' · '}
            <Link to={autopilotQueueHref('succeeded')} className={INLINE_LINK}>{w.done_today} done today</Link>
            {' · '}
            {others.length ? <>Also at the wall: <span className="font-medium text-foreground">{others.join(', ')}</span></> : 'Only you are at the wall'}
          </p>
        )}
        {autopilotState(status?.settings) === 'on' && (
          <p className="text-xs text-muted-foreground">
            You can work in another tab: the agent keeps fetching CAPTCHAs while you type one at least every 10 minutes, and this tab's title shows how many are waiting.
          </p>
        )}
        {ping.error && w && <Note tone="warn">Lost the connection to the database; trying again every 2 seconds.</Note>}
        {ping.error && !w ? (
          <Note tone="warn">Couldn't reach the wall: {ping.error instanceof Error ? ping.error.message : String(ping.error)}. It tries again every 2 seconds.</Note>
        ) : !w ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-60" />)}</div>
        ) : live.length === 0 ? (
          <NothingLive status={status} waiting={w.waiting} working={w.queued + w.running} agentOnline={agentOnline} canManage={canManage}
            onOpenSettings={onOpenSettings} />
        ) : (
          <>
            {!agentOnline && <Note tone="warn">The office agent stopped reporting; these CAPTCHAs may not go through until it is back.</Note>}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {live.map((c) => (
                <CaptchaCard key={c.job_id} c={c} visible={visible}
                  inputRef={(el) => { if (el) inputs.current.set(c.job_id, el); else inputs.current.delete(c.job_id); }}
                  onAnswer={answer(c)} onRefresh={refresh(c)} onSkip={skip(c)} />
              ))}
            </div>
            {w.waiting > 0 && (
              <p className="text-xs text-muted-foreground">
                {plural(w.waiting, 'more client')} waiting: the agent opens the next logins as you type.
              </p>
            )}
            {workers && <p className="text-xs text-muted-foreground">On the office PC: {workers}.</p>}
          </>
        )}
        <p className="sr-only" aria-live="polite">{said}</p>
      </SectionCard>
      <Note tone="info">
        The portal's CAPTCHA images expire after a few minutes, so the agent replaces one nobody typed
        {status?.settings ? ` within ${status.settings.captcha_refresh_secs} seconds` : ''}. Nobody at the wall means nothing is opened:
        the agent parks those clients as waiting and brings them back the moment someone is here.
      </Note>
    </div>
  );
};

export default CaptchaWall;
