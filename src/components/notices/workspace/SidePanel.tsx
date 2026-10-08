// What used to be the notice page's right column (rebalanced 7 October 2026, the
// firm's request: one column, nothing said twice). The next step is the header's
// one primary button with its hint beside the chips; the facts the header does
// not already carry (portal sync, the matter, the same case's other notices) are
// one line under it. The notice's own facts are in "What the notice says".
import React from 'react';
import { Link } from 'react-router-dom';
import type { Workspace } from '@/lib/noticeWorkspace';
import { stageLabel, nextActionDef } from '@/lib/noticeStages';
import { fmtAgo, noticeTitle } from '@/lib/noticeFormat';

const REASON: Record<string, string> = {
  login_failed: 'login failed — password changed?', captcha_timeout: 'CAPTCHA not typed', captcha_failed: 'CAPTCHA not accepted', session_mismatch: 'portal session was another GSTIN',
  portal_error: 'portal error', timeout: 'portal timed out', stalled: 'run stalled', other: 'failed',
};

/** "Next: assign an owner" — the hint of the header's primary button. */
export function nextHint(ws: Workspace): string | null {
  const f = ws.fact;
  if (f.stage === 'closed') return null;
  const hint = nextActionDef(f.next_action).hint;
  return hint ? `${hint}${f.days_in_stage ? ` · ${stageLabel(f.stage)} for ${f.days_in_stage} d` : ''}` : null;
}

/** Portal sync · matter · other notices of the same case, in one line. */
export const KeyFactsLine: React.FC<{ ws: Workspace }> = ({ ws }) => {
  const n = ws.notice;
  const notices = ws.sync.find((s) => s.step === 'notices');
  const login = ws.sync.find((s) => s.step === 'login');
  const loginFailedLater = login?.last_status === 'failed' && (!notices?.last_success_at || (login.last_attempt_at ?? '') > notices.last_success_at);
  const parts: React.ReactNode[] = [];
  parts.push(
    <span key="sync">
      Portal sync:{' '}
      {loginFailedLater ? <span className="text-destructive-strong">{REASON[login?.last_reason_class ?? 'other'] ?? 'failed'} {fmtAgo(login?.last_attempt_at)}</span>
        : notices?.last_success_at ? <>{fmtAgo(notices.last_success_at)}{notices.last_status === 'failed' ? <span className="text-destructive-strong"> · last try {REASON[notices.last_reason_class ?? 'other'] ?? 'failed'}</span> : null}</>
        : 'none recorded'}
    </span>,
  );
  if (ws.matter) {
    parts.push(
      <span key="matter">Matter <Link to={`/litigation/${ws.matter.id}`} className="text-primary underline underline-offset-2">{ws.matter.matter_no}</Link> · {stageLabel(ws.matter.stage)}</span>,
    );
  }
  if (ws.related.length > 0) {
    parts.push(
      <span key="related">
        {n.case_id ? 'Same case' : 'Other open'}:{' '}
        {ws.related.slice(0, 3).map((r, i) => (
          <React.Fragment key={r.id}>{i > 0 && ', '}<Link to={`/notices/${r.id}`} className="text-primary underline underline-offset-2">{noticeTitle(r, { fy: false })}</Link></React.Fragment>
        ))}
        {ws.related.length > 3 && ` +${ws.related.length - 3}`}
      </span>,
    );
  }
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
      {parts.map((p, i) => <React.Fragment key={i}>{i > 0 && <span aria-hidden>·</span>}{p}</React.Fragment>)}
    </p>
  );
};
