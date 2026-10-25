import React, { useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/gstr9/badge';
import { SectionCard } from '@/components/gstr9/ui';
import { TAB_LIST_CLASS, TAB_TRIGGER_CLASS } from '@/components/gstr9/reco/StepTabs';
import { WS_BTN, WS_TABLE_WRAP, WS_TABLE, WS_TH, WS_TD, WS_TR } from '@/components/workspace/theme';
import { cn } from '@/lib/utils';
import { prettyPeriod } from '@/lib/gstReminders';
import { buildEmailHtml } from '@/lib/emailTemplate';
import { cancelQueued } from '@/lib/reminderPlans';
import { toast } from 'sonner';
import { AlertTriangle, Ban, BellRing, CheckCircle2, Clock, Eye, Loader2, Search, XCircle } from 'lucide-react';

export type OutboxStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped' | 'cancelled' | 'preview';

export interface OutboxRow {
  id: string;
  client_id: string;
  to_email: string;
  kind: string;
  return_type: string | null;
  period_month: string | null;
  subject: string;
  status: OutboxStatus;
  error: string | null;
  reminder_step: number | null;
  created_at: string;
  sent_at: string | null;
}

const fmtWhen = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

type StatusVariant = 'warning' | 'success' | 'destructive' | 'secondary' | 'info';
const STATUS_META: Record<OutboxStatus, { label: string; variant: StatusVariant; icon: React.ReactNode }> = {
  pending: { label: 'Queued', variant: 'warning', icon: <Clock className="h-3 w-3" /> },
  sending: { label: 'Sending', variant: 'warning', icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  sent: { label: 'Sent', variant: 'success', icon: <CheckCircle2 className="h-3 w-3" /> },
  failed: { label: 'Failed', variant: 'destructive', icon: <XCircle className="h-3 w-3" /> },
  skipped: { label: 'Skipped', variant: 'secondary', icon: <Ban className="h-3 w-3" /> },
  cancelled: { label: 'Cancelled', variant: 'secondary', icon: <Ban className="h-3 w-3" /> },
  // Notice alerts written while the engine is in preview mode: never sent.
  preview: { label: 'Preview', variant: 'info', icon: <Eye className="h-3 w-3" /> },
};

const STATUS_FILTERS = ['all', 'pending', 'sent', 'failed', 'cancelled', 'preview'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];
const KIND_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'All e-mails' },
  { value: 'reminder', label: 'Reminders' },
  { value: 'confirmation', label: 'Filing confirmations' },
  { value: 'notice_alert', label: 'Notice alerts' },
  { value: 'other', label: 'Other' },
];
const NO_SEND = 'Needs the Send client e-mails permission — ask a GST Manager to add it to your position';

const kindLabel = (r: OutboxRow) => {
  if (r.kind === 'confirmation') return <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Confirmation</span>;
  if (r.kind === 'notice_alert') return <span className="inline-flex items-center gap-1 text-violet-700"><AlertTriangle className="h-3.5 w-3.5" /> Notice alert</span>;
  if (r.kind === 'bills_not_in_books') return <span className="inline-flex items-center gap-1 text-amber-700"><AlertTriangle className="h-3.5 w-3.5" /> Bills not in books</span>;
  if (r.kind === 'reminder') {
    return <span className="inline-flex items-center gap-1 text-amber-700"><BellRing className="h-3.5 w-3.5" /> {r.reminder_step === 3 ? 'Final reminder' : r.reminder_step === 2 ? '2nd reminder' : '1st reminder'}</span>;
  }
  return <span className="text-muted-foreground">{r.kind.replace(/_/g, ' ')}</span>;
};

/** Every e-mail the app has queued: filter, read it as the client sees it, stop a queued one. */
const OutboxTab: React.FC<{ rows: OutboxRow[]; names: Record<string, string>; loading: boolean; onChanged: () => void }> = ({ rows, names, loading, onChanged }) => {
  const { user, canSendClientEmails } = useAuth();
  const canSend = canSendClientEmails();
  const [status, setStatus] = useState<StatusFilter>('all');
  const [kind, setKind] = useState('all');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [cancelling, setCancelling] = useState(false);
  const [previewRow, setPreviewRow] = useState<{ subject: string; html: string; to: string } | null>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== 'all' && r.status !== status) return false;
      if (kind === 'other' ? ['reminder', 'confirmation', 'notice_alert'].includes(r.kind) : kind !== 'all' && r.kind !== kind) return false;
      if (!needle) return true;
      return [names[r.client_id], r.to_email, r.subject, r.return_type, prettyPeriod(r.period_month)].some((v) => (v ?? '').toLowerCase().includes(needle));
    });
  }, [rows, status, kind, q, names]);
  const visiblePending = visible.filter((r) => r.status === 'pending');
  const pickedPending = visiblePending.filter((r) => picked.has(r.id));

  const openPreview = async (id: string) => {
    const { data, error } = await supabase.from('email_outbox')
      .select('to_email, subject, body, kind, template_key, render_vars').eq('id', id).maybeSingle();
    if (error || !data) { toast.error('Could not load this e-mail.'); return; }
    const vars = (data.render_vars ?? {}) as Record<string, string>;
    setPreviewRow({
      to: data.to_email,
      subject: data.subject,
      html: data.render_vars ? buildEmailHtml({ key: data.template_key, kind: data.kind, message: data.body, vars }) : (data.body ?? ''),
    });
  };

  const cancel = async (ids: string[]) => {
    if (!canSend) { toast.error(NO_SEND); return; }
    if (!ids.length) return;
    if (!window.confirm(`Stop ${ids.length} queued e-mail${ids.length === 1 ? '' : 's'}? They will not be sent, and a cancelled reminder is not queued again for that period.`)) return;
    setCancelling(true);
    try {
      const n = await cancelQueued(ids, user?.firstName ?? null);
      toast.success(`Stopped ${n} e-mail${n === 1 ? '' : 's'}.${n < ids.length ? ` ${ids.length - n} had already gone out.` : ''}`);
      setPicked(new Set());
      onChanged();
    } catch (e) { toast.error(`Could not stop them: ${(e as Error).message}`); }
    setCancelling(false);
  };

  return (
    <SectionCard
      title="Outbox"
      description={`${counts.pending ?? 0} queued · ${counts.sent ?? 0} sent · ${counts.failed ?? 0} failed · ${counts.cancelled ?? 0} cancelled${counts.preview ? ` · ${counts.preview} notice-alert previews (not sent)` : ''}. The latest 400 e-mails. Queued e-mails go out every 15 minutes.`}
      actions={
        <Tabs value={status} onValueChange={(v) => { setStatus(v as StatusFilter); setPicked(new Set()); }}>
          <TabsList className={TAB_LIST_CLASS}>
            {STATUS_FILTERS.map((f) => (
              <TabsTrigger key={f} value={f} className={TAB_TRIGGER_CLASS}>{f === 'all' ? 'All' : STATUS_META[f].label}{f !== 'all' && counts[f] ? ` (${counts[f]})` : ''}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      }
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Client, e-mail, return, period" className="h-8 w-64 pl-7 text-xs" />
        </div>
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-xs" aria-label="Kind of e-mail">
          {KIND_FILTERS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
        {visiblePending.length > 0 && (
          <>
            <Button size="sm" variant="outline" className={WS_BTN} disabled={cancelling || !pickedPending.length || !canSend} title={canSend ? undefined : NO_SEND} onClick={() => void cancel(pickedPending.map((r) => r.id))}>
              <Ban className="h-3.5 w-3.5" /> Stop {pickedPending.length || ''} selected
            </Button>
            <Button size="sm" variant="ghost" className={WS_BTN} disabled={cancelling || !canSend} title={canSend ? undefined : NO_SEND} onClick={() => void cancel(visiblePending.map((r) => r.id))}>
              Stop all {visiblePending.length} queued shown
            </Button>
          </>
        )}
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : visible.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">No e-mails match.</div>
      ) : (
        <div className={cn(WS_TABLE_WRAP, 'max-h-[60vh]')}>
          <table className={WS_TABLE}>
            <thead>
              <tr>
                <th className={cn(WS_TH, 'w-0')}>
                  {visiblePending.length > 0 && (
                    <Checkbox
                      checked={pickedPending.length === visiblePending.length}
                      onCheckedChange={(v) => setPicked(v ? new Set(visiblePending.map((r) => r.id)) : new Set())}
                      aria-label="All queued"
                    />
                  )}
                </th>
                <th className={WS_TH}>Client</th>
                <th className={WS_TH}>E-mail</th>
                <th className={WS_TH}>Return · Period</th>
                <th className={WS_TH}>Subject</th>
                <th className={WS_TH}>Status</th>
                <th className={WS_TH}>Queued</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const meta = STATUS_META[r.status] ?? STATUS_META.pending;
                return (
                  <tr key={r.id} className={cn(WS_TR, 'align-top')}>
                    <td className={WS_TD}>
                      {r.status === 'pending' && (
                        <Checkbox
                          checked={picked.has(r.id)}
                          onCheckedChange={(v) => setPicked((s) => { const n = new Set(s); if (v) n.add(r.id); else n.delete(r.id); return n; })}
                          aria-label="Select"
                        />
                      )}
                    </td>
                    <td className={WS_TD}>
                      <div className="font-medium">{names[r.client_id] ?? '—'}</div>
                      <div className="text-xs text-muted-foreground">{r.to_email}</div>
                    </td>
                    <td className={cn(WS_TD, 'whitespace-nowrap')}>{kindLabel(r)}</td>
                    <td className={cn(WS_TD, 'whitespace-nowrap')}>
                      <div>{r.return_type ?? '—'}</div>
                      <div className="text-xs text-muted-foreground">{prettyPeriod(r.period_month)}</div>
                    </td>
                    <td className={cn(WS_TD, 'max-w-[22rem] truncate')} title={r.subject}>
                      <button type="button" className="max-w-full truncate text-left text-primary hover:underline" onClick={() => void openPreview(r.id)}>
                        {r.subject}
                      </button>
                    </td>
                    <td className={WS_TD}>
                      <Badge variant={meta.variant} className="gap-1">{meta.icon}{meta.label}</Badge>
                      {(r.status === 'failed' || r.status === 'cancelled') && r.error && (
                        <div className={cn('mt-1 max-w-[16rem] truncate text-xs', r.status === 'failed' ? 'text-destructive-strong' : 'text-muted-foreground')} title={r.error}>{r.error}</div>
                      )}
                      {r.sent_at && <div className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">{fmtWhen(r.sent_at)}</div>}
                    </td>
                    <td className={cn(WS_TD, 'whitespace-nowrap text-muted-foreground tabular-nums')}>{fmtWhen(r.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!previewRow} onOpenChange={(o) => { if (!o) setPreviewRow(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-base">{previewRow?.subject}</DialogTitle>
            <DialogDescription>To {previewRow?.to}</DialogDescription>
          </DialogHeader>
          {previewRow && (
            <iframe title="E-mail preview" sandbox="" srcDoc={previewRow.html} className="h-[60vh] w-full rounded-md border bg-white" />
          )}
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
};

export default OutboxTab;
