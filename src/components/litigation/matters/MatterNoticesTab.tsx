// The matter's notices (audit U-84-4, U-95-3): each opens its notice
// workspace, with its form, reference, due or reply date, stage, demand and
// PDF; notices of the client that are in no matter can be linked, and a linked
// notice unlinked — both logged on the matter and on the notice.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Link2, Loader2, Unlink } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { WS_BTN, WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TH, WS_TR } from '@/components/workspace/theme';
import { StageBadge } from '@/components/notices/StageBadge';
import { useAuth } from '@/contexts/AuthContext';
import type { NoticeFact } from '@/lib/noticeFacts';
import { fmtDate, fmtInr, fmtInrShort, noticeTitle } from '@/lib/noticeFormat';
import { linkNoticesToMatter, unlinkNotice, type MatterWorkspace } from '@/lib/litigationData';
import { clockWords } from './ClockCell';
import { cn } from '@/lib/utils';

export const noticeLabel = (n: Pick<NoticeFact, 'form_code' | 'reference_number' | 'case_id'>) =>
  [n.form_code, n.reference_number || n.case_id].filter(Boolean).join(' ') || 'notice';

function DueText({ n }: { n: NoticeFact }) {
  if (n.reply_date) return <span className="text-xs"><span className="block font-medium text-success-strong">Replied</span>{fmtDate(n.reply_date)}</span>;
  if (!n.is_open) return <span className="text-xs text-muted-foreground">closed</span>;
  if (!n.effective_due) return <span className="text-xs text-muted-foreground">no due date</span>;
  const d = n.days_to_due ?? 0;
  return (
    <span className="text-xs leading-tight">
      <span className={cn('block font-semibold tabular-nums', d < 0 && 'text-destructive-strong')}>{fmtDate(n.effective_due)}</span>
      <span className="text-muted-foreground">{d === 0 ? 'due today' : clockWords(d)}</span>
    </span>
  );
}

export const LinkNoticesDialog: React.FC<{ open: boolean; onOpenChange: (o: boolean) => void; ws: MatterWorkspace; onDone: () => void }> = ({ open, onOpenChange, ws, onDone }) => {
  const { user } = useAuth();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  React.useEffect(() => { if (open) setPicked(new Set()); }, [open]);
  const save = async () => {
    if (!user || !picked.size) return;
    setSaving(true);
    const chosen = ws.unlinked.filter((n) => picked.has(n.id as string));
    const { error } = await linkNoticesToMatter(ws.matter.id, chosen.map((n) => n.id as string), user, chosen.map(noticeLabel));
    setSaving(false);
    if (error) { toast.error(`Couldn't link: ${error.message}`); return; }
    toast.success(`Linked ${chosen.length} notice${chosen.length === 1 ? '' : 's'}`);
    onOpenChange(false); onDone();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Link notices to {ws.matter.matter_no}</DialogTitle>
          <DialogDescription>Open notices of {ws.client?.name} that are in no matter.</DialogDescription>
        </DialogHeader>
        {ws.unlinked.length === 0 ? <p className="text-sm text-muted-foreground">Every open notice of this client is already in a matter.</p> : (
          <fieldset className="space-y-1">
            <legend className="sr-only">Notices to link</legend>
            {ws.unlinked.map((n) => (
              <label key={n.id} htmlFor={`ln-${n.id}`} className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 text-xs hover:bg-muted/50">
                <Checkbox id={`ln-${n.id}`} className="mt-0.5" checked={picked.has(n.id as string)}
                  onCheckedChange={(v) => setPicked((s) => { const x = new Set(s); if (v) x.add(n.id as string); else x.delete(n.id as string); return x; })} />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{noticeTitle(n)}</span>
                  <span className="block text-muted-foreground"><span className="font-mono">{n.reference_number || n.case_id}</span>
                    {n.issue_date ? ` · issued ${fmtDate(n.issue_date)}` : ''}{Number(n.amount_of_demand) > 0 ? ` · ${fmtInr(n.amount_of_demand)}` : ''}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !picked.size}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Link {picked.size || ''} notice{picked.size === 1 ? '' : 's'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const MatterNoticesTab: React.FC<{ ws: MatterWorkspace; canEdit: boolean; onLink: () => void; onChanged: () => void }> = ({ ws, canEdit, onLink, onChanged }) => {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const unlink = async (n: NoticeFact) => {
    if (!user) return;
    if (!(await confirm({ title: `Unlink ${noticeLabel(n)}?`, description: 'The notice stays on record and goes back to the notices that are in no matter.', confirmText: 'Unlink' }))) return;
    setBusy(n.id as string);
    const { error } = await unlinkNotice(n.id as string, user, noticeLabel(n));
    setBusy(null);
    if (error) { toast.error(`Couldn't unlink: ${error.message}`); return; }
    toast.success('Unlinked'); onChanged();
  };
  const linkButton = canEdit && ws.unlinked.length > 0 && (
    <Button size="sm" variant="outline" className={WS_BTN} onClick={onLink}><Link2 className="h-3.5 w-3.5" aria-hidden /> Link notices ({ws.unlinked.length} not in a matter)</Button>
  );

  if (ws.notices.length === 0) {
    return (
      <div className="space-y-2 rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        <p>No notice is linked to this matter yet{ws.unlinked.length ? ` — ${ws.client?.name} has ${ws.unlinked.length} open notice${ws.unlinked.length === 1 ? '' : 's'} in no matter` : ''}.</p>
        {linkButton}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <ul className="space-y-2 md:hidden">
        {ws.notices.map((n) => (
          <li key={n.id} className="rounded-lg border p-3">
            <Link to={`/notices/${n.id}`} className="block text-sm font-semibold hover:underline">{noticeTitle(n)}</Link>
            <div className="truncate font-mono text-[11px] text-muted-foreground">{n.reference_number || n.case_id}</div>
            <div className="mt-2 flex flex-wrap items-center gap-2"><DueText n={n} /><StageBadge stage={n.stage} />
              {Number(n.amount_of_demand) > 0 && <span className="ml-auto text-xs tabular-nums">{fmtInrShort(n.amount_of_demand)}</span>}</div>
          </li>
        ))}
      </ul>
      <div className={cn(WS_TABLE_WRAP, 'hidden md:block')}>
        <table className={WS_TABLE}>
          <thead><tr>
            <th scope="col" className={WS_TH}>Notice</th><th scope="col" className={WS_TH}>Due / reply</th><th scope="col" className={WS_TH}>Stage</th>
            <th scope="col" className={cn(WS_TH, 'text-right')}>Demand</th><th scope="col" className={cn(WS_TH, 'w-20')}><span className="sr-only">PDF and unlink</span></th>
          </tr></thead>
          <tbody>
            {ws.notices.map((n) => (
              <tr key={n.id} className={WS_TR}>
                <td className={cn(WS_TD, 'min-w-[16rem]')}>
                  <Link to={`/notices/${n.id}`} className="font-medium hover:underline">{noticeTitle(n)}</Link>
                  <div className="text-xs text-muted-foreground">
                    <span className="font-mono">{n.reference_number || n.case_id || 'no reference'}</span>
                    {n.issue_date ? ` · issued ${fmtDate(n.issue_date)}` : ''}{n.order_date ? ` · order ${fmtDate(n.order_date)}` : ''}
                    {n.submission_arn ? <> · ARN <span className="font-mono">{n.submission_arn}</span></> : null}
                  </div>
                </td>
                <td className={cn(WS_TD, 'whitespace-nowrap')}><DueText n={n} /></td>
                <td className={cn(WS_TD, 'whitespace-nowrap')}><StageBadge stage={n.stage} since={n.stage_changed_at} by={n.stage_changed_by} /></td>
                <td className={WS_TD_NUM}>{Number(n.amount_of_demand) > 0 ? fmtInr(n.amount_of_demand) : '—'}</td>
                <td className={cn(WS_TD, 'whitespace-nowrap')}>
                  {n.pdf_url && (
                    <a href={n.pdf_url} target="_blank" rel="noreferrer" className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-muted" aria-label={`Open the PDF of ${noticeLabel(n)}`}>
                      <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />
                    </a>
                  )}
                  {canEdit && (
                    <Button size="icon" variant="ghost" className="h-7 w-7" disabled={busy === n.id} onClick={() => unlink(n)} aria-label={`Unlink ${noticeLabel(n)}`}>
                      {busy === n.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5" />}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Replies are drafted and filed on each notice; its workspace opens from the title.</p>
        {linkButton}
      </div>
    </div>
  );
};
