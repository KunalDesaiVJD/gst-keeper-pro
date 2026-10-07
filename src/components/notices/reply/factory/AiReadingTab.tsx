// "AI" (roadmap Phase 4, Phase 7): the switch (ships off; a confirm says what is
// sent, to whom, for which clients and how results are used), who reads and when
// it last ran, what has been read, the examples the assistant may use, the day's
// spend against both caps, the settings, and the lists behind the numbers
// (readings, documents, every call to the Claude API). A GST manager changes
// things; everyone else reads them.
import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Play, Power } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Note } from '@/components/gstr9/ui';
import { WS_BTN, WS_TAB, WS_TAB_ACTIVE, WS_TABS_LIST } from '@/components/workspace/theme';
import { INLINE_LINK, ToneBadge } from '@/components/notices/autopilot/parts';
import { Bar, Panel, PanelRow, Stat } from '@/components/notices/ui/Panel';
import { useAuth } from '@/contexts/AuthContext';
import { fmtAgo } from '@/lib/noticeFormat';
import { runReaderNow, runnerWords } from '@/lib/noticeAi';
import {
  factoryHref, fmtCount, fmtUsdInr, readerWords, saveAiSettings, useAgentHeartbeats, type Actor, type ReplyFactoryStatus,
} from '@/lib/replyFactory';
import { AiSettingsCard } from './AiSettingsCard';
import { AiReadingsCard } from './AiReadingsCard';
import { AiDocumentsCard } from './AiDocumentsCard';
import { AuditLogCard } from './AuditLogCard';
import { cn } from '@/lib/utils';

const ONLINE_MS = 90_000;
const LISTS = [
  { key: 'readings', label: 'Notices read' },
  { key: 'documents', label: 'Documents' },
  { key: 'calls', label: 'API calls' },
] as const;
type ListKey = (typeof LISTS)[number]['key'];

export const AiReadingTab: React.FC<{ s: ReplyFactoryStatus | undefined; loading: boolean }> = ({ s, loading }) => {
  const { user, canManageNoticeAlerts } = useAuth();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [sp, setSp] = useSearchParams();
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const canEdit = canManageNoticeAlerts();
  const actor: Actor | null = user ? { id: user.id, firstName: user.firstName } : null;
  if (loading && !s) return <Skeleton className="h-96 w-full" />;
  const ai = s?.ai;
  const settings = ai?.settings ?? null;
  if (!ai || !settings) return <Note tone="warn">The AI settings are not in this database yet.</Note>;
  const on = settings.read_enabled;
  const edge = (settings.runner ?? 'edge') === 'edge';
  const rate = Number(settings.usd_inr) || 84;
  const list: ListKey = LISTS.find((l) => l.key === sp.get('ailist'))?.key
    ?? (sp.get('audit') ? 'calls' : sp.get('docs') ? 'documents' : 'readings');
  const setList = (k: ListKey) => { const n = new URLSearchParams(sp); n.set('ailist', k); n.delete('p'); setSp(n, { replace: true }); };

  const toggle = async () => {
    const next = !on;
    const everyone = settings.consent_scope === 'all_clients';
    const ok = await confirm(next ? {
      title: 'Switch AI on?',
      description: (
        <span className="block space-y-2">
          <span className="block">
            {edge ? 'Supabase (the notice-ai Edge Function)' : 'The office agent'} will send notice PDFs, case-folder documents and approved drafts to the
            Claude API (Anthropic) under the firm's commercial terms, {everyone ? 'for every client that has not opted out' : 'only for clients with consent on file'}.
            No passwords, portal sessions or notes are sent.
          </span>
          <span className="block">
            Read values fill only empty fields, marked "auto — verify". Reading stops for the day at {fmtUsdInr(settings.daily_cap_usd, rate, 2)}; the
            assistant at {fmtUsdInr(settings.assist_daily_cap_usd, rate, 2)}.
          </span>
          <span className="block">A partner's decision (docs/REPLY_FACTORY_POSITIONS.md §3 and §13).</span>
        </span>
      ),
      confirmText: 'Switch on',
    } : {
      title: 'Switch AI off?',
      description: 'Nothing more is sent to the Claude API and the assistant stops answering. What is queued waits; what was read stays.',
      confirmText: 'Switch off', destructive: true,
    });
    if (!ok) return;
    setSaving(true);
    try {
      await saveAiSettings({ read_enabled: next }, actor);
      toast.success(next ? 'AI is on.' : 'AI is off. Nothing more is sent to the Claude API.');
      qc.invalidateQueries({ queryKey: ['reply-factory-status'] });
    } catch (e) {
      toast.error(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const runNow = async () => {
    setRunning(true);
    try { toast.success(await runReaderNow()); } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setRunning(false); }
    setTimeout(() => qc.invalidateQueries({ queryKey: ['reply-factory-status'] }), 5000);
  };

  const cap = Number(settings.daily_cap_usd) || 0;
  const acap = Number(settings.assist_daily_cap_usd) || 0;
  const rw = runnerWords(ai.runner, on);
  const q = ai.queue;
  const d = ai.documents;
  const l = ai.learning;

  return (
    <div className="space-y-3">
      <PanelRow>
        <Panel title="AI assistant"
          info="Reads every notice, attachment and reply, and drafts replies from the firm's own past answers. Nothing is sent while it is off."
          actions={(
            <>
              <ToneBadge tone={on ? 'success' : 'secondary'}>{on ? 'On' : 'Off'}</ToneBadge>
              {canEdit && (
                <Button size="sm" variant={on ? 'outline' : 'default'} className={WS_BTN} disabled={saving} onClick={toggle}>
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Power className="h-3.5 w-3.5" aria-hidden />} {on ? 'Switch off' : 'Switch on'}
                </Button>
              )}
            </>
          )}>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {edge ? <ToneBadge tone={rw.tone}>{rw.text}</ToneBadge> : <ToneBadge tone={ai.agent_online ? 'success' : 'warning'}>{ai.agent_online ? 'Office agent online' : 'Office agent offline'}</ToneBadge>}
              {edge && ai.runner?.last_error && <span className="min-w-0 truncate text-destructive-strong" title={ai.runner.last_error}>{ai.runner.last_error}</span>}
              {edge && on && canEdit && (
                <Button size="sm" variant="outline" className={cn(WS_BTN, 'ml-auto')} disabled={running} onClick={runNow}>
                  {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Run now
                </Button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Notices read" value={fmtCount(q.done)} sub={`${q.queued} waiting${q.failed_today ? ` · ${q.failed_today} failed today` : ''}`} />
              <Stat label="Documents read" value={fmtCount(d.done)} sub={`${d.queued} waiting${d.failed ? ` · ${d.failed} failed` : ''}`} />
              <Stat label="Examples kept" value={`${fmtCount(l.pairs_included)}`} sub={`of ${fmtCount(l.pairs)} · used ${fmtCount(l.uses)}×`} />
              <Stat label="Read today" value={fmtCount(q.done_today + d.done_today)} sub={`${q.done_today} notices · ${d.done_today} documents`} />
              <Stat label="Answers today" value={fmtCount(ai.assist.runs_today)} sub="asked of the assistant" />
              <Stat label="Used in drafts" value={fmtCount(ai.assist.used_today)} sub="today, as edited" />
            </div>
            <div className="space-y-2">
              <div className="space-y-1">
                <div className="flex items-baseline justify-between text-xs"><span>Reading today <b>{fmtUsdInr(ai.spend_today_usd, rate, 2)}</b></span><span className="text-muted-foreground">cap {fmtUsdInr(cap, rate, 2)}</span></div>
                <Bar pct={cap > 0 ? (100 * ai.spend_today_usd) / cap : 0} tone={cap > 0 && ai.spend_today_usd >= cap ? 'bad' : 'primary'} label="Reading spend against its cap" />
              </div>
              <div className="space-y-1">
                <div className="flex items-baseline justify-between text-xs"><span>Assistant today <b>{fmtUsdInr(ai.assist_spend_today_usd, rate, 2)}</b> · {ai.assist.runs_today} asked</span><span className="text-muted-foreground">cap {fmtUsdInr(acap, rate, 2)}</span></div>
                <Bar pct={acap > 0 ? (100 * ai.assist_spend_today_usd) / acap : 0} tone={acap > 0 && ai.assist_spend_today_usd >= acap ? 'bad' : 'primary'} label="Assistant spend against its cap" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              This month {fmtCount(ai.month.calls)} calls · {fmtUsdInr(ai.month.cost_usd, rate, 2)} · consent for{' '}
              <Link to={factoryHref('consent', { consent: 'with' })} className={INLINE_LINK}>{ai.consent.with_consent} of {ai.consent.clients}</Link> clients
              {settings.consent_scope === 'all_clients' ? ' (every client is read)' : ''} · last changed {fmtAgo(settings.updated_at)}{settings.updated_by_name ? ` by ${settings.updated_by_name}` : ''}
            </p>
          </div>
        </Panel>
        <AiSettingsCard settings={settings} canEdit={canEdit} actor={actor} />
      </PanelRow>

      {!edge && <AgentCard agentOnline={ai.agent_online} />}

      <div className="space-y-2">
        <nav className={WS_TABS_LIST} aria-label="AI lists">
          {LISTS.map((t) => (
            <button key={t.key} type="button" onClick={() => setList(t.key)} aria-current={list === t.key ? 'page' : undefined}
              className={cn(WS_TAB, 'h-8 px-3', list === t.key && WS_TAB_ACTIVE)}>{t.label}</button>
          ))}
        </nav>
        {list === 'readings' && <AiReadingsCard rate={rate} />}
        {list === 'documents' && <AiDocumentsCard canEdit={canEdit} />}
        {list === 'calls' && <AuditLogCard rate={rate} />}
      </div>
    </div>
  );
};

/** The office agent as its heartbeat reports it (only when it is the runner). */
const AgentCard: React.FC<{ agentOnline: boolean }> = ({ agentOnline }) => {
  const hb = useAgentHeartbeats();
  const agents = hb.data ?? [];
  return (
    <Panel title="Office agent" info="The office PC reads the PDFs; it reports in every few seconds.">
      {hb.isLoading ? <Skeleton className="h-12 w-full" />
        : agents.length === 0 ? <p className="text-xs text-muted-foreground">No office agent has reported yet (agent/README.md).</p>
        : (
          <ul className="divide-y">
            {agents.map((a) => {
              const online = Date.now() - Date.parse(a.last_seen) < ONLINE_MS || (agentOnline && agents[0] === a);
              const r = readerWords(a.info);
              return (
                <li key={a.agent_id} className="flex flex-wrap items-center gap-2 py-1.5 text-xs">
                  <span className="font-medium">{a.agent_id}</span>
                  <ToneBadge tone={online ? 'success' : 'warning'}>{online ? 'Online' : 'Offline'}</ToneBadge>
                  <span className="text-muted-foreground">{online ? 'seen' : 'last seen'} {fmtAgo(a.last_seen)}</span>
                  {r.reported ? <span>Reader: {r.parts.join(' · ')}{r.problem && <span className="text-destructive-strong"> · {r.problem}</span>}</span>
                    : <span className="text-muted-foreground">no notice reader (no key in agent/.env)</span>}
                </li>
              );
            })}
          </ul>
        )}
    </Panel>
  );
};

export default AiReadingTab;
