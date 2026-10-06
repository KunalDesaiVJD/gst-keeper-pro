// "Needs a person" (roadmap Phase 3; audit U-51-1, S-22): every active client
// the autopilot could not read, grouped by what fixes it, each with its one-
// click fix — update the password, ask the client (password or OTP reset), run
// again (with the office agent: open the CAPTCHA wall) — and the clients whose
// registration the portal shows as cancelled or suspended, to mark inactive.
// With the scheduled Chrome a CAPTCHA not filled in time points at the CAPTCHA
// extension in that Chrome.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Mail, RefreshCw, ShieldOff, Siren } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Note, SectionCard } from '@/components/gstr9/ui';
import { WS_BTN } from '@/components/workspace/theme';
import { PortalLoginPopover } from '@/components/notices/clients/PortalLoginPopover';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import {
  askClient, enqueueJobs, reasonLabel, runnerMode, useRegistrationAlerts,
  type Actor, type AutopilotStatus, type FailureClient, type FailureGroup, type RegistrationAlert, type RunnerMode,
} from '@/lib/autopilot';
import { fmtAgo, fmtDate, plural } from '@/lib/noticeFormat';
import { EmptyBox, INLINE_LINK, ToneBadge } from './parts';

type Fix = 'login' | 'locked' | 'wall' | 'retry';

/** What fixes a group, and what to tell the person. */
function fixOf(g: FailureGroup, mode: RunnerMode): { kind: Fix; hint: string } {
  if (g.reason === 'login_failed' && (g.fix === 'password' || g.fix === 'no_password')) {
    return { kind: 'login', hint: g.fix === 'no_password'
      ? 'No portal password is saved for these clients. Add it, or ask the client for it; the next run logs in with it.'
      : 'The portal refused the saved password, so it was probably changed. Update it, or ask the client for the new one; three wrong tries lock the portal account, so fix it before running the client again.' };
  }
  if (g.reason === 'login_failed' && g.fix === 'account_locked') {
    return { kind: 'locked', hint: 'The portal account is locked. Only the client can reset it (Forgot Password; the OTP goes to their registered mobile and e-mail). Ask them, then save the new password.' };
  }
  if (g.reason === 'captcha_timeout' && mode === 'chrome') {
    return { kind: 'retry', hint: 'The CAPTCHA was not filled in time in the scheduled Chrome, on every try. Check that the CAPTCHA extension there is switched on and fills the GST portal\'s CAPTCHA, then run them again.' };
  }
  if (g.reason === 'captcha_timeout') {
    return { kind: 'wall', hint: 'Nobody typed the CAPTCHA for these clients. Run them again and type the CAPTCHAs on the wall.' };
  }
  if ((g.reason === 'agent_offline' || g.reason === 'not_reached') && mode === 'chrome') {
    return { kind: 'retry', hint: 'The scheduled Chrome was closed or busy until the day closed. Keep that PC and Chrome on at the scheduled times, then run them again.' };
  }
  if (g.reason === 'skipped_at_wall') {
    return mode === 'chrome'
      ? { kind: 'retry', hint: 'Someone skipped these clients on the CAPTCHA wall while the office agent ran the queue. Run them again; the scheduled Chrome takes them.' }
      : { kind: 'wall', hint: 'Someone skipped these clients on the wall. Run them again when there is time to type their CAPTCHAs.' };
  }
  return { kind: 'retry', hint: 'Usually temporary. Run them again; if one keeps failing, open its sync log.' };
}
const RANK: Record<Fix, number> = { login: 0, locked: 1, wall: 2, retry: 3 };

const ClientLine: React.FC<{ c: FailureClient; children?: React.ReactNode }> = ({ c, children }) => (
  <li className="flex flex-col gap-2 py-2 sm:flex-row sm:items-start sm:justify-between">
    <div className="min-w-0 space-y-0.5">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <Link to={`/notices-company/${c.client_id}`} className="font-medium hover:underline">{c.name}</Link>
        <span className="font-mono text-[11px] text-muted-foreground">{c.gstin}</span>
      </div>
      {c.message && <p className="break-words text-xs text-foreground/80">“{c.message}”</p>}
      <p className="text-[11px] text-muted-foreground">
        Failed {fmtAgo(c.at)} · last good pull {c.last_ok ? fmtAgo(c.last_ok) : 'never'} ·{' '}
        <Link to={`/notices-company-list?tab=log&client=${c.client_id}`} className={INLINE_LINK}>sync log</Link>
      </p>
    </div>
    <div className="flex shrink-0 flex-wrap items-center gap-1.5">{children}</div>
  </li>
);

export const AttentionTab: React.FC<{ status: AutopilotStatus | undefined; loading: boolean; onOpenWall: () => void }> = ({ status, loading, onOpenWall }) => {
  const { user, canEditNoticeStatus, canAddEditClients } = useAuth();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const reg = useRegistrationAlerts();
  const [busy, setBusy] = useState<string | null>(null);
  const actor: Actor | null = user ? { id: user.id, firstName: user.firstName } : null;
  const canAct = canEditNoticeStatus();
  const canEditClients = canAddEditClients();
  const mode = runnerMode(status);

  const groups = [...(status?.failures ?? [])].sort((a, b) => RANK[fixOf(a, mode).kind] - RANK[fixOf(b, mode).kind] || b.count - a.count);
  const loginIds = groups.filter((g) => fixOf(g, mode).kind === 'login' || fixOf(g, mode).kind === 'locked').flatMap((g) => g.clients.map((c) => c.client_id));
  // The saved portal user ID, so "Update password" opens with it filled in.
  const logins = useQuery({
    queryKey: ['autopilot-logins', loginIds.join(',')],
    enabled: canEditClients && loginIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('id, name, gst_user_id').in('id', loginIds);
      if (error) throw error;
      return new Map((data ?? []).map((c) => [c.id, c]));
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['autopilot-status'] });
    qc.invalidateQueries({ queryKey: ['autopilot-queue'] });
    qc.invalidateQueries({ queryKey: ['autopilot-registration'] });
  };
  const runAgain = async (ids: string[], key: string, what: string) => {
    setBusy(key);
    const res = await enqueueJobs({ clientIds: ids, jobType: 'PULL_NOTICES_BUNDLE', origin: 'manual', actor });
    setBusy(null);
    if (!res.ok) { toast.error(`Couldn't queue ${what}: ${res.error}`); return; }
    toast[res.tone === 'warning' ? 'warning' : 'success'](res.text, mode === 'chrome' ? {
      description: res.result.queued ? 'The scheduled Chrome takes them one at a time.' : undefined,
    } : {
      description: res.result.queued ? 'Their CAPTCHAs come to the CAPTCHA wall.' : undefined,
      action: res.result.queued ? { label: 'Open the wall', onClick: onOpenWall } : undefined,
    });
    refresh();
  };
  const ask = async (c: FailureClient, kind: 'password' | 'account_locked') => {
    setBusy(`ask-${c.client_id}`);
    const out = await askClient(c.client_id, kind, actor);
    setBusy(null);
    toast[out.tone](`${c.name}: ${out.text}`);
  };
  const markInactive = async (r: RegistrationAlert) => {
    const ok = await confirm({
      title: `Mark ${r.name} inactive?`,
      description: `The portal shows the registration as ${r.status.toLowerCase()}${r.cancellation_date ? ` from ${fmtDate(r.cancellation_date)}` : ''}. Inactive clients are left out of the scheduled runs and the freshness count; you can switch it back in Edit Client.`,
      confirmText: 'Mark inactive',
    });
    if (!ok) return;
    setBusy(`reg-${r.client_id}`);
    const { error } = await supabase.from('clients').update({ inactive_at_hand: true }).eq('id', r.client_id);
    setBusy(null);
    if (error) { toast.error(`Couldn't update ${r.name}: ${error.message}`); return; }
    toast.success(`${r.name} marked inactive.`);
    refresh();
  };

  if (loading && !status) return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}</div>;
  const regRows = reg.data ?? [];
  if (!groups.length && !regRows.length) {
    return <EmptyBox>Nobody needs a person: every active client is fresh, waiting in the queue or not due yet.</EmptyBox>;
  }

  return (
    <div className="space-y-3">
      {!canAct && <Note tone="info">You can see what needs a person. Running clients again and asking clients needs the "Edit notice status" permission.</Note>}
      {groups.map((g) => {
        const fix = fixOf(g, mode);
        const key = `${g.reason}-${g.fix ?? ''}`;
        return (
          <SectionCard key={key}
            title={<span className="flex flex-wrap items-center gap-2">{reasonLabel(g.reason, g.fix, mode)} <ToneBadge tone={fix.kind === 'retry' ? 'secondary' : 'warning'}>{plural(g.count, 'client')}</ToneBadge></span>}
            description={fix.hint}
            actions={canAct && (fix.kind === 'wall' || fix.kind === 'retry') && g.clients.length > 1 && (
              <Button size="sm" variant="outline" className={WS_BTN} disabled={busy === key} onClick={() => runAgain(g.clients.map((c) => c.client_id), key, 'them')}>
                <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Run all {g.clients.length} again
              </Button>
            )}>
            <ul className="divide-y">
              {g.clients.map((c) => {
                const login = logins.data?.get(c.client_id);
                return (
                  <ClientLine key={c.client_id} c={c}>
                    {fix.kind === 'login' && canEditClients && (
                      <PortalLoginPopover client={{ id: c.client_id, name: c.name, gst_user_id: login?.gst_user_id ?? null }} label="Update password"
                        onSaved={({ retry }) => { refresh(); if (retry) runAgain([c.client_id], `run-${c.client_id}`, c.name); }} />
                    )}
                    {fix.kind === 'login' && canAct && (
                      <Button size="sm" variant="outline" className={WS_BTN} disabled={busy === `ask-${c.client_id}`} onClick={() => ask(c, 'password')}>
                        <Mail className="h-3.5 w-3.5" aria-hidden /> Ask the client<span className="sr-only"> {c.name}</span>
                      </Button>
                    )}
                    {fix.kind === 'locked' && canAct && (
                      <Button size="sm" variant="outline" className={WS_BTN} disabled={busy === `ask-${c.client_id}`} onClick={() => ask(c, 'account_locked')}>
                        <Mail className="h-3.5 w-3.5" aria-hidden /> Ask the client to reset (OTP)<span className="sr-only"> {c.name}</span>
                      </Button>
                    )}
                    {fix.kind === 'locked' && canEditClients && (
                      <PortalLoginPopover client={{ id: c.client_id, name: c.name, gst_user_id: login?.gst_user_id ?? null }} label="Save the new password"
                        onSaved={({ retry }) => { refresh(); if (retry) runAgain([c.client_id], `run-${c.client_id}`, c.name); }} />
                    )}
                    {fix.kind === 'wall' && (
                      <Button size="sm" variant="outline" className={WS_BTN} onClick={onOpenWall}><KeyRound className="h-3.5 w-3.5" aria-hidden /> Open the CAPTCHA wall</Button>
                    )}
                    {(fix.kind === 'wall' || fix.kind === 'retry') && canAct && (
                      <Button size="sm" variant="outline" className={WS_BTN} disabled={busy === `run-${c.client_id}`} onClick={() => runAgain([c.client_id], `run-${c.client_id}`, c.name)}>
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Run again<span className="sr-only"> {c.name}</span>
                      </Button>
                    )}
                  </ClientLine>
                );
              })}
            </ul>
          </SectionCard>
        );
      })}

      {regRows.length > 0 && (
        <SectionCard
          title={<span className="flex flex-wrap items-center gap-2"><ShieldOff className="h-4 w-4 text-destructive-strong" aria-hidden /> Registration cancelled or suspended <ToneBadge tone="destructive">{plural(regRows.length, 'client')}</ToneBadge></span>}
          description="The portal's taxpayer profile shows these active clients' registration as cancelled or suspended. Check with the client; if the firm no longer acts, mark the client inactive so the schedule stops logging in.">
          <ul className="divide-y">
            {regRows.map((r) => (
              <li key={r.client_id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <Link to={`/notices-company/${r.client_id}`} className="font-medium hover:underline">{r.name}</Link>
                    <span className="font-mono text-[11px] text-muted-foreground">{r.gstin}</span>
                  </div>
                  <p className="text-xs">
                    <Siren className="mr-1 inline h-3.5 w-3.5 text-destructive-strong" aria-hidden />
                    {r.status}{r.cancellation_date ? ` from ${fmtDate(r.cancellation_date)}` : ''}
                    <span className="text-muted-foreground"> · profile read {fmtAgo(r.pulled_at)}</span>
                  </p>
                </div>
                {canEditClients && (
                  <Button size="sm" variant="outline" className={WS_BTN} disabled={busy === `reg-${r.client_id}`} onClick={() => markInactive(r)}>
                    Mark inactive<span className="sr-only"> {r.name}</span>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
    </div>
  );
};

export default AttentionTab;
