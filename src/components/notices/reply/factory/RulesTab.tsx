// "Reply rules" (roadmap Phase 4; audit R-11): every issue code — what it is,
// the evidence recipe that answers it, the documents the client is asked for,
// the firm's position and the two paragraphs a prepared reply uses for it
// (contesting, accepting; contract §B) — with its approval state. The positions are
// engineering proposals until a partner approves each one
// (docs/REPLY_FACTORY_POSITIONS.md); a GST manager can edit, approve or send
// one back, everyone else reads. Filters live in the URL.
import React, { useId, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, ChevronRight, MessageSquareWarning, Pencil, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Note } from '@/components/gstr9/ui';
import { WS_BTN } from '@/components/workspace/theme';
import { FilterPill } from '@/components/notices/FilterPill';
import { EmptyBox, INLINE_LINK, LoadError, ToneBadge } from '@/components/notices/autopilot/parts';
import { useAuth } from '@/contexts/AuthContext';
import { fmtDate, plural } from '@/lib/noticeFormat';
import {
  FAMILY_LABELS, POSITION_STATUS, approveIssueType, factoryHref, familyLabel, positionStatusDef, recipeLabel, requestIssueTypeChanges,
  saveIssueType, useIssueTypes, type Actor, type IssueType, type IssueTypePatch,
} from '@/lib/replyFactory';
import { RuleEditDialog } from './RuleEditDialog';
import { cn } from '@/lib/utils';

const day = (ts: string | null | undefined) => (ts ? fmtDate(new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })) : '');

/** The status chip: "Proposed", "Approved by X on 04 Oct 2026", "Changes requested". */
function chipWords(t: IssueType): string {
  if (t.position_status === 'approved') return `Approved by ${t.approved_by_name ?? 'a partner'}${t.approved_at ? ` on ${day(t.approved_at)}` : ''}`;
  return positionStatusDef(t.position_status).label;
}

/** Who did what last, under the rule. */
function statusWords(t: IssueType): string {
  if (t.position_status === 'approved') return `The firm's position since ${day(t.approved_at)}${t.updated_by_name && t.updated_by_name !== t.approved_by_name ? ` · last edited by ${t.updated_by_name}` : ''}`;
  if (t.position_status === 'changes_requested') return `Changes requested${t.updated_by_name ? ` by ${t.updated_by_name}` : ''} on ${day(t.updated_at)}`;
  return t.updated_by_name ? `Proposed · last edited by ${t.updated_by_name} on ${day(t.updated_at)}` : 'Proposed by engineering';
}

export const RulesTab: React.FC = () => {
  const { user, canManageNoticeAlerts } = useAuth();
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const q = useIssueTypes();
  const [editing, setEditing] = useState<IssueType | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const canEdit = canManageNoticeAlerts();
  const actor: Actor | null = user ? { id: user.id, firstName: user.firstName } : null;

  const status = sp.get('rstatus') ?? 'all';
  const family = sp.get('family') ?? 'all';
  const search = (sp.get('q') ?? '').trim().toLowerCase();
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp);
    Object.entries(patch).forEach(([k, v]) => { if (!v || v === 'all') next.delete(k); else next.set(k, v); });
    setSp(next);
  };

  const base = useMemo(() => (q.data ?? []).filter((t) => (family === 'all' || t.family === family)
    && (!search || `${t.code} ${t.title} ${t.description ?? ''} ${t.firm_position ?? ''} ${t.documents.join(' ')} ${t.para_contest ?? ''} ${t.para_accept ?? ''}`
      .toLowerCase().includes(search))), [q.data, family, search]);
  const byStatus = (s: string) => base.filter((t) => t.position_status === s).length;
  const rows = base.filter((t) => status === 'all' || t.position_status === status)
    .sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.sort - b.sort);
  const refresh = () => qc.invalidateQueries({ queryKey: ['reply-issue-types'] });

  const act = async (t: IssueType, what: 'approve' | 'changes') => {
    const ok = await confirm(what === 'approve' ? {
      title: `Approve the reply rule "${t.title}"?`,
      description: 'It becomes the firm\'s position for this issue: replies to notices that raise it start from these words. Approving records your name and today\'s date.',
      confirmText: 'Approve',
    } : {
      title: `Send "${t.title}" back for changes?`,
      description: 'The position stays as it is, marked "Changes requested", until someone edits it and a partner approves it. Say what should change to whoever edits it.',
      confirmText: 'Request changes',
    });
    if (!ok) return;
    setBusy(t.code);
    try {
      if (what === 'approve') await approveIssueType(t.code, actor); else await requestIssueTypeChanges(t.code, actor);
      toast.success(what === 'approve' ? `Approved: ${t.title}.` : `Sent back for changes: ${t.title}.`);
      refresh();
    } catch (e) {
      toast.error(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const save = async (t: IssueType, patch: IssueTypePatch) => {
    setBusy(t.code);
    try {
      const { reset, parasChanged } = await saveIssueType(t, patch, actor);
      toast.success([
        reset ? `Saved. "${t.title}" is back to Proposed until a partner approves the new words.` : `Saved: ${t.title}.`,
        parasChanged ? 'Open notices that raise this issue get the new reply paragraphs; drafts already started keep their own text.' : '',
      ].filter(Boolean).join(' '));
      setEditing(null);
      refresh();
    } catch (e) {
      toast.error(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const chips: { key: string; label: string; clear: Record<string, null> }[] = [];
  if (status !== 'all') chips.push({ key: 'rstatus', label: `Status: ${positionStatusDef(status).label}`, clear: { rstatus: null } });
  if (family !== 'all') chips.push({ key: 'family', label: `Area: ${familyLabel(family)}`, clear: { family: null } });
  if (search) chips.push({ key: 'q', label: `Search: ${sp.get('q')}`, clear: { q: null } });
  const statusHref = (s: string) => factoryHref('rules', { rstatus: s === 'all' ? null : s, family: family === 'all' ? null : family, q: sp.get('q') });

  return (
    <div className="space-y-2">
      <Note tone="info" open>
        These reply rules are engineering proposals until a partner approves each one (docs/REPLY_FACTORY_POSITIONS.md). Until a rule
        is approved, use it as a starting point and check the law and circulars for the period before relying on it.
      </Note>
      {!canEdit && <Note tone="info">Only a GST manager can edit, approve or send back a rule. You can read them.</Note>}

      {q.data && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <Link to={statusHref('all')} className={INLINE_LINK}>{plural(base.length, 'rule')}</Link>
          <span aria-hidden>·</span>
          <Link to={statusHref('approved')} className={INLINE_LINK}>{byStatus('approved')} approved</Link>
          <span aria-hidden>·</span>
          <Link to={statusHref('changes_requested')} className={INLINE_LINK}>{byStatus('changes_requested')} with changes requested</Link>
          <span aria-hidden>·</span>
          <Link to={statusHref('proposed')} className={INLINE_LINK}>{byStatus('proposed')} proposed</Link>
        </p>
      )}

      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input defaultValue={sp.get('q') ?? ''} key={sp.get('q') ?? ''} placeholder="Code, title or words" aria-label="Search the reply rules"
              onKeyDown={(e) => { if (e.key === 'Enter') set({ q: (e.target as HTMLInputElement).value.trim() || null }); }}
              onBlur={(e) => { if ((e.target.value.trim() || null) !== (sp.get('q') || null)) set({ q: e.target.value.trim() || null }); }}
              className="h-8 pl-7 text-xs" />
          </div>
          <FilterPill label="Status" allLabel={`Any (${base.length})`} value={status} onChange={(v) => set({ rstatus: v })} options={[]}
            extraOptions={Object.entries(POSITION_STATUS).map(([k, d]) => ({ value: k, label: `${d.label} (${byStatus(k)})` }))} />
          <FilterPill label="Area" allLabel="Every area" value={family} onChange={(v) => set({ family: v })} options={[]}
            extraOptions={Object.entries(FAMILY_LABELS).map(([k, label]) => ({ value: k, label }))} />
        </div>
        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
            {chips.map((ch) => (
              <button key={ch.key} type="button" onClick={() => set(ch.clear)}
                className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {ch.label} <X className="h-3 w-3" aria-hidden /><span className="sr-only">(remove this filter)</span>
              </button>
            ))}
            <button type="button" className="text-[11px] text-muted-foreground underline underline-offset-2" onClick={() => set({ rstatus: null, family: null, q: null })}>
              Clear all
            </button>
          </div>
        )}
      </div>

      {q.error ? <LoadError what="the reply rules" error={q.error} onRetry={() => q.refetch()} />
        : q.isLoading ? <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}</div>
        : rows.length === 0 ? <EmptyBox>No rule matches these filters.</EmptyBox>
        : (
          <>
            <h3 className="sr-only" aria-live="polite">{plural(rows.length, 'reply rule')}</h3>
            <ul className="space-y-2">
              {rows.map((t) => (
                <RuleCard key={t.code} t={t} canEdit={canEdit} busy={busy === t.code}
                  onEdit={() => setEditing(t)} onApprove={() => act(t, 'approve')} onChanges={() => act(t, 'changes')} />
              ))}
            </ul>
          </>
        )}
      <RuleEditDialog rule={editing} saving={!!busy} onClose={() => setEditing(null)} onSave={save} />
    </div>
  );
};

const RuleCard: React.FC<{ t: IssueType; canEdit: boolean; busy: boolean; onEdit: () => void; onApprove: () => void; onChanges: () => void }> = ({ t, canEdit, busy, onEdit, onApprove, onChanges }) => {
  const st = positionStatusDef(t.position_status);
  const recipe = recipeLabel(t.recipe_key);
  return (
    <li className={cn('rounded-lg border bg-card p-3', !t.is_active && 'bg-muted/40')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <h4 className="text-sm font-semibold leading-snug">{t.title}</h4>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            <span className="font-mono text-foreground/80">{t.code}</span>
            <span aria-hidden>·</span><span>{familyLabel(t.family)}</span>
            {t.forms.length > 0 && <><span aria-hidden>·</span><span>Forms: {t.forms.join(', ')}</span></>}
            {!t.is_active && <><span aria-hidden>·</span><span className="font-medium text-foreground">Not in use</span></>}
          </div>
        </div>
        <ToneBadge tone={st.tone} className="whitespace-normal text-left">{chipWords(t)}</ToneBadge>
      </div>
      {t.description && <p className="mt-1.5 text-xs text-foreground/80">{t.description}</p>}
      <div className="mt-2 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-1">
          <div className="text-xs font-semibold">Firm position</div>
          {t.firm_position
            ? <p className="whitespace-pre-line break-words text-sm leading-relaxed">{t.firm_position}</p>
            : <p className="text-xs text-muted-foreground">No position written yet.</p>}
        </div>
        <div className="min-w-0 space-y-2 text-xs">
          <div>
            <div className="font-semibold">Evidence</div>
            <p className="text-foreground/80">{recipe ? `Built automatically: ${recipe}.` : 'No automatic evidence: built by hand.'}</p>
          </div>
          <div>
            <div className="font-semibold">Documents asked from the client</div>
            {t.documents.length
              ? <ul className="list-disc space-y-0.5 pl-4 text-foreground/80">{t.documents.map((d) => <li key={d} className="break-words">{d}</li>)}</ul>
              : <p className="text-foreground/80">None: the evidence comes from the portal figures.</p>}
          </div>
        </div>
      </div>
      <ReplyParagraphs t={t} />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-2">
        <span className="text-[11px] text-muted-foreground">{statusWords(t)}</span>
        {canEdit && (
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" className={WS_BTN} disabled={busy} onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit<span className="sr-only"> {t.title}</span>
            </Button>
            {t.position_status !== 'changes_requested' && (
              <Button size="sm" variant="outline" className={WS_BTN} disabled={busy} onClick={onChanges}>
                <MessageSquareWarning className="h-3.5 w-3.5" aria-hidden /> Request changes<span className="sr-only"> to {t.title}</span>
              </Button>
            )}
            {t.position_status !== 'approved' && (
              <Button size="sm" className={WS_BTN} disabled={busy || !t.firm_position} onClick={onApprove}>
                <Check className="h-3.5 w-3.5" aria-hidden /> Approve<span className="sr-only"> {t.title}</span>
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  );
};

/** The two paragraphs a prepared reply uses for the issue, read only (folded: they are long). */
const ReplyParagraphs: React.FC<{ t: IssueType }> = ({ t }) => {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const written = [t.para_contest, t.para_accept].filter(Boolean).length;
  return (
    <div className="mt-2 rounded-md border bg-muted/20">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={`${uid}-paras`}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-semibold hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {open ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
        Reply paragraphs<span className="sr-only"> for {t.title}</span>
        <span className="font-normal text-foreground/70">{written === 2 ? 'contesting and accepting' : written === 1 ? 'one of two written' : 'none written: replies use a general paragraph'}</span>
      </button>
      {open && (
        <div id={`${uid}-paras`} className="grid gap-3 border-t p-2 text-sm lg:grid-cols-2">
          {([['When contesting', t.para_contest], ['When accepting', t.para_accept]] as const).map(([label, text]) => (
            <div key={label} className="min-w-0 space-y-0.5">
              <div className="text-xs font-semibold">{label}</div>
              {text ? <p className="whitespace-pre-line break-words leading-relaxed">{text}</p>
                : <p className="text-xs text-foreground/70">Not written: the reply uses a general paragraph.</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default RulesTab;
