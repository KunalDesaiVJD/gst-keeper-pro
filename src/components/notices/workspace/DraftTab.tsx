import React, { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Loader2, MessageSquareWarning, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Note } from '@/components/gstr9/ui';
import { Badge } from '@/components/gstr9/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAuth } from '@/contexts/AuthContext';
import { saveDraft, setDraftStatus, type NoticeDraft, type Workspace } from '@/lib/noticeWorkspace';
import { fmtDate, fmtDateTime, fmtInr, noticeTitle } from '@/lib/noticeFormat';

const STATUS: Record<string, { label: string; tone: 'secondary' | 'info' | 'warning' | 'success' | 'destructive' }> = {
  draft: { label: 'Draft', tone: 'info' },
  in_review: { label: 'With partner', tone: 'warning' },
  changes_requested: { label: 'Changes asked', tone: 'destructive' },
  approved: { label: 'Approved', tone: 'success' },
  superseded: { label: 'Superseded', tone: 'secondary' },
};

/** A starting skeleton from the notice and its issues (Phase 5 drafts it for you). */
function skeleton(ws: Workspace): string {
  const n = ws.notice;
  const f = ws.fact;
  const lines = [
    `Subject: Reply to ${noticeTitle(f, { fy: true })}${n.reference_number ? ` (Ref ${n.reference_number})` : ''}${n.issue_date ? ` dated ${fmtDate(n.issue_date)}` : ''} — ${ws.client?.name ?? ''}${ws.client?.gstin ? ` (GSTIN ${ws.client.gstin})` : ''}`,
    '',
    'Respected Sir / Madam,',
    '',
    'With reference to the above notice, we submit as under.',
    '',
  ];
  if (ws.issues.length) {
    ws.issues.forEach((i, k) => {
      lines.push(`Issue ${k + 1} — ${i.title}${Number(i.amount) ? ` (${fmtInr(i.amount)})` : ''}`);
      lines.push(i.position ? i.position : '[Our position on this issue]');
      if (i.annexure) lines.push(`(Annexure ${i.annexure})`);
      lines.push('');
    });
  } else {
    lines.push('Issue 1 — [What the notice alleges]', '[Our position, with the figures and annexures]', '');
  }
  lines.push('In view of the above, we request that the proceedings be dropped.', '', 'Thanking you,', '', 'For ' + (ws.client?.name ?? '[client]'), 'Authorised signatory');
  return lines.join('\n');
}

/**
 * The reply draft (roadmap Phase 2 workspace tab; Phase 5 adds AI drafting
 * with hard gates). Versions, partner review — send, approve, ask for changes —
 * and the stage moves with it (Draft → Partner review, back to Draft).
 */
export const DraftTab: React.FC<{ ws: Workspace; canEdit: boolean; canApprove: boolean; onChanged: () => void }> = ({ ws, canEdit, canApprove, onChanged }) => {
  const { user } = useAuth();
  const drafts = ws.drafts; // newest first
  const latest = drafts[0] ?? null;
  const [version, setVersion] = useState<number | null>(latest?.version ?? null);
  const shown: NoticeDraft | null = drafts.find((d) => d.version === version) ?? latest;
  const [body, setBody] = useState(shown?.body ?? '');
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');
  const [compare, setCompare] = useState(false);

  useEffect(() => { setVersion(latest?.version ?? null); }, [latest?.id, latest?.version]);
  useEffect(() => { setBody(shown?.body ?? ''); }, [shown?.id, shown?.body]);

  const isLatest = !!shown && shown.id === latest?.id;
  const editable = canEdit && (!latest || (isLatest && (shown.status === 'draft' || shown.status === 'changes_requested')));
  const dirty = editable && body !== (shown?.body ?? '');
  const previous = useMemo(() => (shown ? drafts.find((d) => d.version === shown.version - 1) ?? null : null), [drafts, shown]);

  const run = async (fn: () => Promise<void>, ok: string) => {
    setSaving(true);
    try { await fn(); toast.success(ok); onChanged(); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };

  const save = (asNew = false) => user && run(() => saveDraft(ws.notice.id, body, latest, user, asNew), asNew || !latest ? `Saved as v${(latest?.version ?? 0) + 1}` : 'Draft saved');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && dirty) { e.preventDefault(); save(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!latest && !body) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        No draft yet. Start the reply here — it opens with the notice's details and each issue's position, ready to edit.
        {canEdit && <div className="mt-3"><Button size="sm" onClick={() => setBody(skeleton(ws))}>Start the draft</Button></div>}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {drafts.length > 0 && (
          <Select value={String(shown?.version ?? '')} onValueChange={(v) => setVersion(Number(v))}>
            <SelectTrigger className="h-8 w-40 text-xs" aria-label="Version"><SelectValue placeholder="Version" /></SelectTrigger>
            <SelectContent>
              {drafts.map((d) => <SelectItem key={d.id} value={String(d.version)} className="text-xs">v{d.version} · {STATUS[d.status]?.label ?? d.status}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {shown && <Badge variant={STATUS[shown.status]?.tone ?? 'secondary'} className="text-[11px]">{STATUS[shown.status]?.label ?? shown.status}</Badge>}
        {shown && <span className="text-xs text-muted-foreground">{shown.author_name ? `by ${shown.author_name} · ` : ''}{fmtDateTime(shown.updated_at)}</span>}
        <div className="ml-auto flex flex-wrap gap-1.5">
          {previous && <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setCompare((c) => !c)}>{compare ? 'Hide' : 'Compare with'} v{previous.version}</Button>}
          <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => navigator.clipboard.writeText(body).then(() => toast.success('Copied'))}>
            <Copy className="h-3.5 w-3.5" /> Copy
          </Button>
        </div>
      </div>

      {shown?.status === 'changes_requested' && shown.review_note && (
        <Note tone="warn"><b>{shown.reviewed_by_name ?? 'Partner'}:</b> {shown.review_note}</Note>
      )}
      {shown?.status === 'approved' && (
        <Note tone="info" open>Approved by {shown.reviewed_by_name ?? 'a partner'}{shown.reviewed_at ? ` on ${fmtDateTime(shown.reviewed_at)}` : ''}. File it on the portal, then log the reply — the notice moves to Filed.</Note>
      )}

      <div className={compare && previous ? 'grid gap-2 lg:grid-cols-2' : ''}>
        {compare && previous && (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">v{previous.version}</Label>
            <Textarea readOnly value={previous.body} className="min-h-[22rem] bg-muted/30 font-mono text-xs leading-relaxed" />
          </div>
        )}
        <div className="space-y-1">
          {compare && previous && <Label className="text-xs text-muted-foreground">v{shown?.version ?? 1}</Label>}
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} readOnly={!editable} aria-label="Draft reply"
            className="min-h-[22rem] font-mono text-xs leading-relaxed" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {editable && (
          <Button size="sm" className="h-8 text-xs" disabled={saving || (!dirty && !!latest)} onClick={() => save()}>
            {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />} {latest ? 'Save' : 'Save as v1'}
          </Button>
        )}
        {canEdit && latest && isLatest && !editable && (
          <Button size="sm" variant="outline" className="h-8 text-xs" disabled={saving} onClick={() => save(true)}>Edit as v{latest.version + 1}</Button>
        )}
        {editable && latest && dirty && (
          <Button size="sm" variant="outline" className="h-8 text-xs" disabled={saving} onClick={() => save(true)}>Save as v{latest.version + 1}</Button>
        )}
        {canEdit && latest && isLatest && (latest.status === 'draft' || latest.status === 'changes_requested') && (
          <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" disabled={saving || dirty || !body.trim()}
            title={dirty ? 'Save first' : undefined}
            onClick={() => user && run(() => setDraftStatus(latest, 'in_review', user), 'Sent for partner review')}>
            <Send className="h-3.5 w-3.5" /> Send for partner review
          </Button>
        )}
        {latest && isLatest && latest.status === 'in_review' && canApprove && (
          <>
            <Button size="sm" className="h-8 gap-1 text-xs" disabled={saving} onClick={() => user && run(() => setDraftStatus(latest, 'approved', user), 'Draft approved')}>
              <Check className="h-3.5 w-3.5" /> Approve v{latest.version}
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" disabled={saving}><MessageSquareWarning className="h-3.5 w-3.5" /> Ask for changes</Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 space-y-2">
                <Label htmlFor="review-note" className="text-xs">What should change?</Label>
                <Textarea id="review-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} className="text-xs" />
                <div className="flex justify-end">
                  <Button size="sm" className="h-8 text-xs" disabled={!note.trim() || saving}
                    onClick={() => user && run(() => setDraftStatus(latest, 'changes_requested', user, note.trim()), 'Sent back with your note')}>Send back</Button>
                </div>
              </PopoverContent>
            </Popover>
          </>
        )}
        {latest?.status === 'in_review' && !canApprove && <span className="text-xs text-muted-foreground">Waiting for a partner (GST manager) to approve.</span>}
        <span className="ml-auto text-[11px] text-muted-foreground">{editable ? 'Ctrl S saves.' : ''}</span>
      </div>
    </div>
  );
};

export default DraftTab;
