// The Reply Factory's status line (roadmap Phase 4; audit U-01-4: one state,
// never a hard-coded "healthy"): is AI on, is its reader running (the Supabase
// Edge Function, or the office agent when that is the runner), today's spend
// against the cap (USD and ₹), and the two Phase 4 shares — due-date coverage
// and automatic annexures. Each count opens its list.
import React from 'react';
import { Link } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { INLINE_LINK } from '@/components/notices/autopilot/parts';
import {
  AUTO_ANNEXURE_TARGET, DUE_COVERAGE_TARGET, factoryHref, fmtShare, fmtUsdInr, type ReplyFactoryStatus,
} from '@/lib/replyFactory';
import { runnerWords } from '@/lib/noticeAi';
import { cn } from '@/lib/utils';

const Sep = () => <span aria-hidden>·</span>;

export const FactoryStatusLine: React.FC<{ s: ReplyFactoryStatus | undefined }> = ({ s }) => {
  if (!s) return <Skeleton className="h-4 w-96 max-w-full" />;
  const ai = s.ai;
  const on = !!ai.settings?.read_enabled;
  const rate = ai.settings?.usd_inr ?? 84;
  const cap = ai.settings?.daily_cap_usd ?? 0;
  const capped = on && cap > 0 && ai.spend_today_usd >= cap;
  const edge = (ai.settings?.runner ?? 'edge') === 'edge';
  const reader = edge ? runnerWords(ai.runner, on) : null;
  const readerOk = edge ? reader?.tone === 'success' : ai.agent_online;
  const dot = !on ? 'bg-muted-foreground' : !readerOk || capped ? 'bg-warning' : 'bg-success';
  const cov = s.due_coverage;
  const ann = s.annexures;
  const covShort = cov.share !== null && cov.share < DUE_COVERAGE_TARGET;
  const annShort = ann.share_automatic !== null && ann.share_automatic < AUTO_ANNEXURE_TARGET;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
      <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', dot)} aria-hidden />
      <Link to={factoryHref('ai')} className={INLINE_LINK}>AI {on ? 'on' : 'off'}</Link>
      <Sep />
      <span className="font-medium text-foreground">{edge ? `Supabase reader: ${reader?.text.toLowerCase()}` : `Office agent ${ai.agent_online ? 'online' : 'offline'}`}</span>
      <Sep />
      <Link to={factoryHref('ai')} className={cn(INLINE_LINK, capped && 'text-destructive-strong hover:text-destructive-strong')}>
        spent today {fmtUsdInr(ai.spend_today_usd, rate, 2)} of {fmtUsdInr(cap, rate, 2)}{capped ? ' — cap reached' : ''}
      </Link>
      <Sep />
      <Link to={factoryHref('overview', { show: 'cov:covered' })} className={cn(INLINE_LINK, covShort && 'text-destructive-strong hover:text-destructive-strong')}>
        due dates on {cov.covered} of {cov.open} open notices ({fmtShare(cov.share)})
      </Link>
      <Sep />
      <Link to={factoryHref('overview', { show: 'ann:auto' })} className={cn(INLINE_LINK, annShort && 'text-destructive-strong hover:text-destructive-strong')}>
        automatic annexures {ann.automatic} of {ann.target_open} ({fmtShare(ann.share_automatic)})
      </Link>
    </p>
  );
};

export default FactoryStatusLine;
