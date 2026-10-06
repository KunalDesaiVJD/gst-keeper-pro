// Reply options on the Draft tab (roadmap Phase 4b; contract B). The database
// prepares several replies for each notice from its facts, issues and
// annexures when it is fetched; staff preview one and start the draft from it,
// as a new version that never overwrites an earlier one. The text is shown
// exactly as stored. The firm asked for no hyphen or dash in reply wording, so
// the wording written here around the replies carries none either.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Eye, FileText, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/gstr9/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useAuth } from '@/contexts/AuthContext';
import {
  loadReplyOptions, refreshReplyOptions, replyOptionsKey, startDraftFromOption, type NoticeDraft, type ReplyOption,
} from '@/lib/noticeWorkspace';
import { fmtDate } from '@/lib/noticeFormat';

// Exported for the Reply templates tab (src/components/notices/reply/factory), so both say the same.
// eslint-disable-next-line react-refresh/only-export-components
export const STANCE: Record<string, { label: string; tone: 'destructive' | 'warning' | 'info' | 'success' | 'secondary' }> = {
  contest: { label: 'Contest', tone: 'destructive' },
  partial: { label: 'Part accept', tone: 'warning' },
  accept_pay: { label: 'Accept and pay', tone: 'warning' },
  explain: { label: 'Explain', tone: 'info' },
  complied: { label: 'Complied', tone: 'success' },
  adjournment: { label: 'More time', tone: 'secondary' },
  documents: { label: 'Documents', tone: 'info' },
  rectify: { label: 'Rectify', tone: 'info' },
  appeal_stay: { label: 'Stay of recovery', tone: 'destructive' },
  consent: { label: 'Consent', tone: 'success' },
  general: { label: 'General', tone: 'secondary' },
};

const istDate = (ts: string) => new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const StanceChip: React.FC<{ stance: string }> = ({ stance }) => {
  const s = STANCE[stance] ?? STANCE.general;
  return <Badge variant={s.tone} className="shrink-0 whitespace-nowrap px-1.5 py-0 text-[10px]">{s.label}</Badge>;
};

export const ReplyOptions: React.FC<{
  noticeId: string;
  /** notice_facts.response_need: critical, optional or none. */
  responseNeed: string | null | undefined;
  /** The notice's drafts, newest first. */
  drafts: NoticeDraft[];
  canEdit: boolean;
  /** The editor holds changes not saved yet. */
  dirty: boolean;
  /** A draft version was started from an option. */
  onStarted: (version: number | null) => void;
}> = ({ noticeId, responseNeed, drafts, canEdit, dirty, onStarted }) => {
  const { user, canManageNoticeAlerts } = useAuth();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: replyOptionsKey(noticeId), queryFn: () => loadReplyOptions(noticeId) });
  const [preview, setPreview] = useState<ReplyOption | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const options = q.data ?? [];
  const latest = drafts[0] ?? null;
  const none = responseNeed === 'none';

  const use = async (o: ReplyOption) => {
    if (!user) return;
    if (latest) {
      const next = latest.version + 1;
      const ok = await confirm({
        title: `Start draft version ${next}?`,
        description: `This starts draft version ${next} from this option. Version ${latest.version} stays as it is.${dirty ? ' Changes not saved in the editor are not kept.' : ''}`,
        confirmText: 'Use this reply',
      });
      if (!ok) return;
    }
    setBusy(o.id);
    try {
      const r = await startDraftFromOption(o.id, user);
      toast.success(`Draft version ${r.version ?? ''} started from "${o.title}".`);
      setPreview(null);
      onStarted(r.version);
    } catch (e) {
      toast.error(`Couldn't start the draft: ${message(e)}`);
    } finally { setBusy(null); }
  };

  const refresh = async () => {
    setBusy('refresh');
    try {
      const n = await refreshReplyOptions(noticeId);
      await q.refetch();
      toast.success(n ? `Reply options prepared again: ${n}.` : 'Prepared again: no reply options for this notice type.');
    } catch (e) {
      toast.error(`Couldn't prepare the reply options: ${message(e)}`);
    } finally { setBusy(null); }
  };

  const usedLine = (o: ReplyOption) => {
    const d = drafts.find((x) => x.id === o.used_draft_id);
    return `Used for ${d ? `draft v${d.version}` : 'a draft'}${o.used_by_name ? ` by ${o.used_by_name}` : ''}${o.used_at ? ` on ${fmtDate(istDate(o.used_at))}` : ''}`;
  };

  const empty = (text: string) => (
    <div className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
      {text}
      {canManageNoticeAlerts() && (
        <div className="mt-1 text-xs">
          <Link to="/notices-reply-factory?tab=types" className="font-medium text-primary underline underline-offset-2">Notice types and reply templates</Link>
        </div>
      )}
    </div>
  );

  return (
    <section aria-labelledby={`reply-options-${noticeId}`} className="space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-[1_1_16rem]">
          <h3 id={`reply-options-${noticeId}`} className="text-sm font-semibold">Reply options</h3>
          <p className="text-xs text-muted-foreground">Prepared from the notice, its issues and evidence. Preview one, then start the draft from it; everything stays editable.</p>
        </div>
        {canEdit && !none && (
          <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-xs" disabled={busy === 'refresh'} onClick={refresh}>
            {busy === 'refresh' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />} Prepare again
          </Button>
        )}
      </div>

      {q.isLoading ? <Skeleton className="h-24 w-full" />
        : q.error ? <p className="text-xs text-destructive-strong">Couldn't load the reply options: {message(q.error)}</p>
        : options.length === 0 ? empty(none ? 'No reply is needed for this notice type.' : 'No reply options for this notice type yet.')
        : (
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2" aria-label="Reply options">
            {options.map((o) => (
              <li key={o.id} className="flex min-w-0 flex-col gap-1.5 rounded-md border bg-card p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 break-words text-sm font-medium">{o.title}</span>
                  <StanceChip stance={o.stance} />
                </div>
                <p className="line-clamp-2 break-words text-xs text-muted-foreground" title={o.summary}>{o.summary}</p>
                {o.status === 'used' && <p className="text-xs font-medium text-success-strong">{usedLine(o)}</p>}
                <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
                  <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setPreview(o)}>
                    <Eye className="h-3.5 w-3.5" aria-hidden /> Preview<span className="sr-only">: {o.title}</span>
                  </Button>
                  {canEdit && (
                    <Button type="button" size="sm" className="h-7 gap-1 text-xs" disabled={!!busy} onClick={() => use(o)}>
                      {busy === o.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <FileText className="h-3.5 w-3.5" aria-hidden />}
                      Use this reply<span className="sr-only">: {o.title}</span>
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

      <Dialog open={!!preview} onOpenChange={(v) => { if (!v) setPreview(null); }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="pr-6">{preview?.title}</DialogTitle>
            {preview && <div><StanceChip stance={preview.stance} /></div>}
            <DialogDescription>{preview?.summary}</DialogDescription>
          </DialogHeader>
          <div tabIndex={0} role="region" aria-label="Reply text"
            className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words rounded-md border p-3 text-sm leading-relaxed">
            {preview?.body}
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => setPreview(null)}>Close</Button>
            {canEdit && preview && (
              <Button type="button" disabled={!!busy} onClick={() => use(preview)}>
                {busy === preview.id && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />} Use this reply
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
};

export default ReplyOptions;
