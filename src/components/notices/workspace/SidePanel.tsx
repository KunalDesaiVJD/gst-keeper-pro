import React from 'react';
import { Link } from 'react-router-dom';
import { SectionCard } from '@/components/gstr9/ui';
import { Badge } from '@/components/gstr9/badge';
import type { Workspace } from '@/lib/noticeWorkspace';
import { stageLabel, nextActionDef } from '@/lib/noticeStages';
import { fmtAgo, fmtDate, fmtDateTime, fmtFy, noticeTitle, sentenceCase } from '@/lib/noticeFormat';

const REASON: Record<string, string> = {
  login_failed: 'login failed — password changed?', captcha_timeout: 'CAPTCHA not typed', session_mismatch: 'portal session was another GSTIN',
  portal_error: 'portal error', timeout: 'portal timed out', stalled: 'run stalled', other: 'failed',
};

/** The next step, said once and done with one button (target-notice: right column). */
export const NextStepCard: React.FC<{ ws: Workspace; action: React.ReactNode }> = ({ ws, action }) => {
  const f = ws.fact;
  const closed = f.stage === 'closed';
  const def = nextActionDef(f.next_action);
  return (
    <SectionCard title="Next step" description={closed ? 'This notice is closed.' : def.hint}>
      <div className="flex flex-wrap items-center gap-2">
        {action}
        {!closed && <span className="text-xs text-muted-foreground">Stage: {stageLabel(f.stage)}{f.days_in_stage ? ` for ${f.days_in_stage} d` : ''}</span>}
      </div>
    </SectionCard>
  );
};

export const KeyFacts: React.FC<{ ws: Workspace }> = ({ ws }) => {
  const f = ws.fact;
  const n = ws.notice;
  const notices = ws.sync.find((s) => s.step === 'notices');
  const login = ws.sync.find((s) => s.step === 'login');
  const loginFailedLater = login?.last_status === 'failed' && (!notices?.last_success_at || (login.last_attempt_at ?? '') > notices.last_success_at);
  const Row: React.FC<{ k: string; children: React.ReactNode }> = ({ k, children }) => (
    <div className="grid grid-cols-[7.5rem_1fr] gap-2 py-1 text-xs">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="min-w-0 break-words font-medium">{children}</dd>
    </div>
  );
  return (
    <SectionCard title="Key facts">
      <dl className="divide-y">
        <Row k="Client"><Link to={`/notices-company/${n.client_id}`} className="text-primary underline underline-offset-2">{ws.client?.name ?? f.client_name}</Link></Row>
        <Row k="GSTIN"><span className="font-mono">{ws.client?.gstin ?? f.client_gstin}</span></Row>
        <Row k="Portal sync">
          {loginFailedLater ? <span className="text-destructive-strong">{REASON[login?.last_reason_class ?? 'other'] ?? 'failed'} · {fmtAgo(login?.last_attempt_at)}</span>
            : notices?.last_success_at ? <>synced {fmtAgo(notices.last_success_at)}{notices.last_status === 'failed' ? <span className="text-destructive-strong"> · last try {REASON[notices.last_reason_class ?? 'other'] ?? 'failed'}</span> : null}</>
            : <span className="text-muted-foreground">no sync recorded</span>}
        </Row>
        <Row k="Form">{f.form_code ? <>{f.form_code}{f.form_label ? ` · ${f.form_label.replace(/\s*\([A-Z0-9-]+\)\s*$/, '')}` : ''}</> : sentenceCase(f.notice_type) || '—'}</Row>
        <Row k="Category">{f.category ?? '—'}</Row>
        <Row k="Reply window">
          {f.effective_due ? <>
            {fmtDate(f.effective_due)}{' '}
            <Badge variant={f.due_basis === 'computed' ? 'warning' : 'secondary'} className="text-[10px]">
              {f.due_basis === 'extended' ? 'extended' : f.due_basis === 'computed' ? 'computed — verify' : 'portal'}
            </Badge>
            {f.due_basis === 'computed' && f.due_basis_note && <span className="block font-normal text-muted-foreground">{f.due_basis_note}</span>}
            {n.extended_due_date && n.due_date && <span className="block font-normal text-muted-foreground">original due {fmtDate(n.due_date)}</span>}
          </> : 'no due date'}
        </Row>
        <Row k="Issued">{n.issue_date ? fmtDate(n.issue_date) : '—'}{n.issued_by ? ` · ${n.issued_by}` : ''}</Row>
        <Row k="Financial year">{fmtFy(n.financial_year) || '—'}</Row>
        <Row k="Captured">{fmtDateTime(n.first_seen_at)}{n.portal_key?.startsWith('manual:') ? ' · typed in' : ' · portal sync'}</Row>
        {ws.matter && (
          <Row k="Matter">
            <Link to={`/litigation/${ws.matter.id}`} className="text-primary underline underline-offset-2">{ws.matter.matter_no}</Link>
            <span className="font-normal text-muted-foreground"> · {stageLabel(ws.matter.stage)}{ws.matter.title ? ` · ${ws.matter.title}` : ''}</span>
          </Row>
        )}
        {ws.related.length > 0 && (
          <Row k={n.case_id ? 'Same case' : 'Other open'}>
            <ul className="space-y-0.5">
              {ws.related.slice(0, 5).map((r) => (
                <li key={r.id}><Link to={`/notices/${r.id}`} className="text-primary underline underline-offset-2">{noticeTitle(r, { fy: false })}</Link>
                  <span className="font-normal text-muted-foreground"> · {stageLabel(r.stage)}</span></li>
              ))}
            </ul>
          </Row>
        )}
      </dl>
    </SectionCard>
  );
};
