// "AI reading" (roadmap Phase 4; audit R-08, R-15): the switch that lets the
// office agent read notice PDFs with the Claude API (ships off; a confirm
// says exactly what is sent, to whom, for which clients, and how results are
// applied), the agent and its reader, the queue and the spend against the
// daily cap, the settings, the readings and the audit log of every API call.
// A GST manager changes things; everyone else reads them.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Power } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Note, SectionCard } from '@/components/gstr9/ui';
import { WS_BTN } from '@/components/workspace/theme';
import { INLINE_LINK, ToneBadge } from '@/components/notices/autopilot/parts';
import { useAuth } from '@/contexts/AuthContext';
import { fmtAgo } from '@/lib/noticeFormat';
import {
  factoryHref, fmtCount, fmtUsdInr, readerWords, saveAiSettings, useAgentHeartbeats, type Actor, type ReplyFactoryStatus,
} from '@/lib/replyFactory';
import { AiSettingsCard } from './AiSettingsCard';
import { AiReadingsCard } from './AiReadingsCard';
import { AuditLogCard } from './AuditLogCard';
import { CountLink } from './parts';
import { cn } from '@/lib/utils';

const ONLINE_MS = 90_000;

export const AiReadingTab: React.FC<{ s: ReplyFactoryStatus | undefined; loading: boolean }> = ({ s, loading }) => {
  const { user, canManageNoticeAlerts } = useAuth();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [saving, setSaving] = useState(false);
  const canEdit = canManageNoticeAlerts();
  const actor: Actor | null = user ? { id: user.id, firstName: user.firstName } : null;
  if (loading && !s) return <Skeleton className="h-96 w-full" />;
  const ai = s?.ai;
  const settings = ai?.settings ?? null;
  if (!ai || !settings) return <Note tone="warn">The AI reading settings are not in this database yet.</Note>;
  const on = settings.read_enabled;
  const rate = Number(settings.usd_inr) || 84;

  const toggle = async () => {
    const next = !on;
    const ok = await confirm(next ? {
      title: 'Switch AI reading on?',
      description: (
        <span className="block space-y-2">
          <span className="block">
            The office agent will send each notice PDF — only the PDF and the reader's fixed instructions (with the firm's list of issue
            codes); no client details, passwords, portal sessions or notes — to the Claude API (Anthropic), under the firm's commercial terms
            with Anthropic, and only for clients whose consent is on file and who have not opted out. The API key stays on the office PC; the
            app never holds it.
          </span>
          <span className="block">
            What it reads is applied only into empty fields, marked "auto — verify" until someone confirms it. A value a person typed is never
            replaced, and a notice addressed to another GSTIN is never applied. Reading stops for the day at the cap ({fmtUsdInr(settings.daily_cap_usd, rate, 2)}).
          </span>
          <span className="block">
            This is the partner's decision (docs/REPLY_FACTORY_POSITIONS.md §3): check Anthropic's current commercial terms and
            data-retention options first.
          </span>
        </span>
      ),
      confirmText: 'Switch on',
    } : {
      title: 'Switch AI reading off?',
      description: 'Nothing more is sent to the Claude API. Readings waiting in the queue stay there until it is switched on again; fields already read stay as they are.',
      confirmText: 'Switch off', destructive: true,
    });
    if (!ok) return;
    setSaving(true);
    try {
      await saveAiSettings({ read_enabled: next }, actor);
      toast.success(next ? 'AI reading is on.' : 'AI reading is off. Nothing more is sent to the Claude API.');
      qc.invalidateQueries({ queryKey: ['reply-factory-status'] });
    } catch (e) {
      toast.error(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const cap = Number(settings.daily_cap_usd) || 0;
  const spentPct = cap > 0 ? Math.min(100, (100 * ai.spend_today_usd) / cap) : 0;
  const q = ai.queue;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-2">
        <div className="min-w-0 space-y-3">
          <SectionCard title="AI reading"
            description={on ? 'On: the office agent reads queued notices with the Claude API.' : 'Off: nothing is sent to the Claude API.'}
            actions={<span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', on ? 'bg-success/15 text-success-strong' : 'bg-muted text-foreground')}>{on ? 'On' : 'Off'}</span>}>
            {!canEdit && <Note tone="info">Only a GST manager can change AI reading. You can read the settings.</Note>}
            <p className="text-xs text-muted-foreground">
              When on, the office agent reads each queued notice PDF with the Claude API and fills only empty fields, as "auto — verify". Nothing
              of a client without consent is ever sent: consent is on file for{' '}
              <Link to={factoryHref('consent', { consent: 'with' })} className={INLINE_LINK}>{ai.consent.with_consent} of {ai.consent.clients} active clients</Link>
              {ai.consent.opted_out > 0 && <>; <Link to={factoryHref('consent', { consent: 'opted_out' })} className={INLINE_LINK}>{ai.consent.opted_out} opted out</Link></>}.
            </p>
            {canEdit && (
              <Button size="sm" variant={on ? 'outline' : 'default'} className={WS_BTN} disabled={saving} onClick={toggle}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Power className="h-3.5 w-3.5" aria-hidden />}
                {on ? 'Switch off' : 'Switch on'}
              </Button>
            )}
            <p className="text-[11px] text-muted-foreground">Last changed {fmtAgo(settings.updated_at)}{settings.updated_by_name ? ` by ${settings.updated_by_name}` : ''}.</p>
          </SectionCard>

          <SectionCard title="Queue and spend" description="Today and this month are India time.">
            <p className="text-sm">
              <CountLink to={factoryHref('ai', { reads: 'queued' })} n={q.queued} /> waiting ·{' '}
              <CountLink to={factoryHref('ai', { reads: 'running' })} n={q.running} /> reading now ·{' '}
              <CountLink to={factoryHref('ai', { reads: 'done_today' })} n={q.done_today} /> done today ·{' '}
              <CountLink to={factoryHref('ai', { reads: 'failed_today' })} n={q.failed_today} strong /> failed today
            </p>
            <div className="space-y-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span>
                  Spent today <Link to={factoryHref('ai', { audit: 'today' })} className={cn(INLINE_LINK, 'font-semibold')}>{fmtUsdInr(ai.spend_today_usd, rate, 2)}</Link>
                </span>
                <span className="text-xs text-muted-foreground">daily cap {fmtUsdInr(cap, rate, 2)}</span>
              </div>
              <Progress value={spentPct} className="h-2" aria-label={`Spent today: ${Math.round(spentPct)}% of the daily cap`} />
              {cap > 0 && ai.spend_today_usd >= cap && <p className="text-xs font-medium text-destructive-strong">The cap is reached: nothing more is read today.</p>}
            </div>
            <p className="text-xs">
              This month: <CountLink to={factoryHref('ai', { audit: 'month' })} n={ai.month.calls} /> calls ·{' '}
              {fmtUsdInr(ai.month.cost_usd, rate, 2)} · {fmtCount(ai.month.input_tokens)} tokens in · {fmtCount(ai.month.output_tokens)} out
            </p>
          </SectionCard>

          <AgentCard agentOnline={ai.agent_online} />
        </div>
        <AiSettingsCard settings={settings} canEdit={canEdit} actor={actor} />
      </div>
      <AiReadingsCard rate={rate} />
      <AuditLogCard rate={rate} />
    </div>
  );
};

/** The office agent as its heartbeat reports it, and whether it has a notice reader (heartbeat info.reader). */
const AgentCard: React.FC<{ agentOnline: boolean }> = ({ agentOnline }) => {
  const hb = useAgentHeartbeats();
  const agents = hb.data ?? [];
  return (
    <SectionCard title="Office agent" description="The office PC reads the PDFs; it reports in every few seconds.">
      {hb.isLoading ? <Skeleton className="h-12 w-full" />
        : agents.length === 0 ? (
          <p className="text-xs text-muted-foreground">No office agent has reported yet. It is installed on the office PC from the agent folder (agent/README.md).</p>
        ) : (
          <ul className="divide-y">
            {agents.map((a) => {
              const online = Date.now() - Date.parse(a.last_seen) < ONLINE_MS || (agentOnline && agents[0] === a);
              const r = readerWords(a.info);
              const host = typeof a.info?.host === 'string' ? a.info.host : null;
              const version = typeof a.info?.version === 'string' ? a.info.version : null;
              return (
                <li key={a.agent_id} className="space-y-1 py-1.5 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{a.agent_id}</span>
                    {host && <span className="text-muted-foreground">on {host}</span>}
                    <ToneBadge tone={online ? 'success' : 'warning'}>{online ? 'Online' : 'Offline'}</ToneBadge>
                  </div>
                  <p className="text-muted-foreground">{online ? 'seen' : 'last seen'} {fmtAgo(a.last_seen)}{version ? ` · agent v${version}` : ''}</p>
                  {r.reported ? (
                    <p>Notice reader: <span className="font-medium">{r.parts.join(' · ')}</span>
                      {r.problem && <span className="font-medium text-destructive-strong"> · {r.problem}</span>}</p>
                  ) : (
                    <p className="text-foreground/80">
                      This agent does not report a notice reader yet. It reports one once the reader is installed and an Anthropic API key is set on
                      the office PC (agent/.env).
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
    </SectionCard>
  );
};

export default AiReadingTab;
