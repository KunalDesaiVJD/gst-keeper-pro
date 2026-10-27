// The reply draft (roadmap Phase 2 workspace tab; Phase 4b reply options).
// On top, the reply options the database prepared for the notice; below, the
// draft: versions, partner review (send, approve, ask for changes), and the
// stage moves with it (Draft, Partner review, back to Draft). The firm asked
// for no hyphen or dash in reply wording: the blank draft below has none, and
// neither does the wording written here around the reply.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
import { loadReplyOptions, replyOptionsKey, saveDraft, setDraftStatus, type NoticeDraft, type Workspace } from '@/lib/noticeWorkspace';
import { fmtDateTime } from '@/lib/noticeFormat';
import { ReplyOptions } from './ReplyOptions';
import { supabase } from '@/integrations/supabase/client';
import { fillPartB, hasPartBPlaceholders } from '@/lib/reply/partB';
import type { AnnexureSummary } from '@/lib/reply/types';

// DRC-01B and DRC-01C: the annexure whose reconciling items fill Part B (section C of the law audit).
const PART_B_RECIPE: Record<string, string> = { 'DRC-01B': 'gstr1_vs_3b', 'DRC-01C': 'gstr3b_vs_2b' };

const STATUS: Record<string, { label: string; tone: 'secondary' | 'info' | 'warning' | 'success' | 'destructive' }> = {
  draft: { label: 'Draft', tone: 'info' },
  in_review: { label: 'With partner', tone: 'warning' },
  changes_requested: { label: 'Changes asked', tone: 'destructive' },
  approved: { label: 'Approved', tone: 'success' },
  superseded: { label: 'Superseded', tone: 'secondary' },
};

// ── Reply wording without dashes (contract: "FORM GST DRC 01", "Rs. 1,23,456",
// "6 October 2026", "financial year 2023/24") ──────────────────────────────
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "6 October 2026". */
function longDate(iso: string | null | undefined): string | null {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : null;
}

/** "Rs. 4,82,690" (never the "/" plus dash suffix). */
const rupees = (n: number) => `Rs. ${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(n))}`;

/** "FORM GST DRC 01", "FORM GSTR 3A", or "the notice". */
function formName(code: string | null | undefined): string {
  if (!code) return 'the notice';
  const c = code.replace(/[-\u2010-\u2015\u2212]+/g, ' ').trim();
  return /^GSTR/i.test(c) ? `FORM ${c}` : `FORM GST ${c}`;
}

/** Data placed in reply wording, without dashes: years become 2023/24, ranges read "to", GSTR 3B loses its hyphen, the "/-" suffix goes. */
function withoutDashes(text: string): string {
  return text
    .replace(/\u00ad/g, '')
    .replace(/\/[-\u2010-\u2015\u2212](?=[\s.,;)]|$)/g, '')
    .replace(/\s+[\u2014\u2015]\s+/g, ', ')
    .replace(/\s+[\u2012\u2013]\s+/g, ' to ')
    .replace(/\s+[-\u2212]\s+/g, ', ')
    .replace(/(\d{4})\s*[-\u2010-\u2015\u2212]\s*(\d{2,4})\b/g, '$1/$2')
    .replace(/(\w)\s*[\u2012-\u2015]\s*(\w)/g, '$1 to $2')
    .replace(/[-\u2010-\u2015\u2212]+/g, ' ')
    .replace(/ {2,}/g, ' ');
}

/** A blank draft from the notice and its issues, for a notice with no reply option to start from. */
function skeleton(ws: Workspace): string {
  const n = ws.notice;
  const client = ws.client?.name ?? '[name of the taxpayer]';
  const dated = longDate(n.issue_date);
  const lines = [
    withoutDashes(`Subject: Reply to ${formName(ws.fact.form_code)}${n.reference_number ? ` reference ${n.reference_number}` : ''}${dated ? ` dated ${dated}` : ''} issued to ${client}${ws.client?.gstin ? ` (GSTIN ${ws.client.gstin})` : ''}`),
    '',
    'Respected Sir or Madam,',
    '',
    'With reference to the above notice, we submit as under.',
    '',
  ];
  if (ws.issues.length) {
    ws.issues.forEach((i, k) => {
      lines.push(withoutDashes(`Issue ${k + 1}: ${i.title}${Number(i.amount) ? ` (${rupees(Number(i.amount))})` : ''}`));
      lines.push(i.position ? withoutDashes(i.position) : '[Our position on this issue]');
      if (i.annexure) lines.push(withoutDashes(`(Annexure ${i.annexure})`));
      lines.push('');
    });
  } else {
    lines.push('Issue 1: [What the notice alleges]', '[Our position, with the figures and annexures]', '');
  }
  lines.push('In view of the above, we request that the proceedings be dropped.', '', 'Thanking you,', '', withoutDashes(`For ${client}`), 'Authorised Signatory');
  return lines.join('\n');
}

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
  const [opening, setOpening] = useState<number | null>(null);
  const editor = useRef<HTMLTextAreaElement | null>(null);
  const options = useQuery({ queryKey: replyOptionsKey(ws.notice.id), queryFn: () => loadReplyOptions(ws.notice.id) });
  const fromOption = shown?.source_option_id ? options.data?.find((o) => o.id === shown.source_option_id) : undefined;
  const partBRecipe = PART_B_RECIPE[ws.notice.form_code ?? ''];
  const annexure = useQuery({
    queryKey: ['notice-partb-annexure', ws.notice.id, partBRecipe],
    enabled: !!partBRecipe,
    queryFn: async () => {
      const { data, error } = await supabase.from('reply_annexures').select('summary, title, version').eq('notice_id', ws.notice.id)
        .eq('recipe_key', partBRecipe).eq('is_current', true).order('generated_at', { ascending: false }).limit(1);
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });

  useEffect(() => { setVersion(latest?.version ?? null); }, [latest?.id, latest?.version]);
  useEffect(() => { setBody(shown?.body ?? ''); }, [shown?.id, shown?.body]);
  // A version just started from a reply option opens in the editor.
  useEffect(() => {
    if (opening === null || shown?.version !== opening) return;
    editor.current?.scrollIntoView({ block: 'center' });
    editor.current?.focus({ preventScroll: true });
    setOpening(null);
  }, [opening, shown?.version]);

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

  // A closed notice offers no reply or appeal option.
  const replyOptions = ws.fact.is_open === false ? null : (
    <ReplyOptions noticeId={ws.notice.id} responseNeed={ws.fact.response_need} drafts={drafts} canEdit={canEdit} dirty={dirty}
      onStarted={(v) => { setOpening(v); onChanged(); }} />
  );

  if (!latest && !body) {
    return (
      <div className="space-y-4">
        {replyOptions}
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          {ws.fact.response_need === 'none'
            ? 'No draft. This notice type needs no reply; start a blank draft only if you want to reply anyway.'
            : `No draft yet. ${options.data?.length ? 'Use a reply option above, or start' : 'Start'} a blank draft here: it opens with the notice's details and each issue's position, ready to edit.`}
          {canEdit && <div className="mt-3"><Button size="sm" variant="outline" onClick={() => setBody(skeleton(ws))}>Start a blank draft</Button></div>}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {replyOptions}
      <section aria-labelledby={`draft-${ws.notice.id}`} className="space-y-2">
        <h3 id={`draft-${ws.notice.id}`} className="text-sm font-semibold">The draft</h3>
        <div className="flex flex-wrap items-center gap-2">
          {drafts.length > 0 && (
            <Select value={String(shown?.version ?? '')} onValueChange={(v) => setVersion(Number(v))}>
              <SelectTrigger className="h-8 w-40 text-xs" aria-label="Version"><SelectValue placeholder="Version" /></SelectTrigger>
              <SelectContent>
                {drafts.map((d) => <SelectItem key={d.id} value={String(d.version)} className="text-xs">v{d.version} · {STATUS[d.status]?.label ?? d.status}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {shown && <Badge variant={STATUS[shown.status]?.tone ?? 'secondary'} className="text-xs">{STATUS[shown.status]?.label ?? shown.status}</Badge>}
          {shown && <span className="text-xs text-muted-foreground">{shown.author_name ? `by ${shown.author_name} · ` : ''}{fmtDateTime(shown.updated_at)}{fromOption ? ` · from the reply option "${fromOption.title}"` : ''}</span>}
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
          <Note tone="info" open>Approved by {shown.reviewed_by_name ?? 'a partner'}{shown.reviewed_at ? ` on ${fmtDateTime(shown.reviewed_at)}` : ''}. File it on the portal, then log the reply; the notice moves to Filed.</Note>
        )}

        {editable && partBRecipe && hasPartBPlaceholders(body) && (
          annexure.data?.summary && fillPartB(body, annexure.data.summary as unknown as AnnexureSummary, ws.notice.form_code ?? '') ? (
            <Note tone="info" open>
              <span className="inline-flex flex-wrap items-center gap-2">The reasons for the difference in paragraph 3 can be filled from the annexure "{annexure.data.title ?? 'Evidence'}" (version {annexure.data.version}), item by item with its amount.
                <Button size="sm" variant="outline" className="h-8 text-xs"
                  onClick={() => { const next = fillPartB(body, annexure.data!.summary as unknown as AnnexureSummary, ws.notice.form_code ?? ''); if (next) { setBody(next); toast.success('Part B reasons filled. Read them, then save.'); } }}>
                  Fill Part B from the annexure
                </Button>
              </span>
            </Note>
          ) : annexure.data ? (
            <Note tone="info">The annexure "{annexure.data.title ?? 'Evidence'}" shows no timing or DRC-03 item that explains the difference: what it shows is to pay. Use the payment option, or type the reasons.</Note>
          ) : annexure.isFetched ? (
            <Note tone="info">Build the annexure on the Evidence tab to fill the reasons in Part B with its figures; until then they are left for you to type.</Note>
          ) : null
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
            <Textarea ref={editor} value={body} onChange={(e) => setBody(e.target.value)} readOnly={!editable} aria-label="Draft reply"
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
          <span className="ml-auto text-xs text-muted-foreground">{editable ? 'Ctrl S saves.' : ''}</span>
        </div>
      </section>
    </div>
  );
};

export default DraftTab;
