// The cases linked into this one (the firm's request of 24 October 2026: an
// appeal against a case, or against a partly rejected refund, shown linked and
// also apart). The chain as a tree, the original case first, each case saying
// how it is linked (by itself when both carry the same portal number, or by a
// person) and in what manner (appeal against the RFD-06 order of ...), with
// "show this case only", unlink and "let the system decide" for staff who can
// edit notices; then the cases that may belong here, scored, and a picker to
// link any other case of the client. Migration 20261024100000.
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Eye, GitBranch, Link2, Link2Off, Loader2, RotateCcw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/gstr9/badge';
import { Note } from '@/components/gstr9/ui';
import { WS_BTN } from '@/components/workspace/theme';
import { SectionCard } from '@/components/notices/ui/Panel';
import { useAuth } from '@/contexts/AuthContext';
import {
  LINK_KINDS, caseLabel, describeLink, linkKindDef, refundOutcome, resetCaseLink, setCaseLink, useCaseChain, useLinkCandidates,
  type ChainMember, type LinkCandidate, type LinkKind,
} from '@/lib/noticeCases';
import { fmtDate, fmtFy, fmtInrShort, plural } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The members in tree order: the root, then each case under the one it belongs to, oldest first. */
function treeOrder(members: ChainMember[], rootKey: string): { m: ChainMember; depth: number }[] {
  const kids = new Map<string, ChainMember[]>();
  for (const m of members) if (m.parent_key) kids.set(m.parent_key, [...(kids.get(m.parent_key) ?? []), m]);
  const out: { m: ChainMember; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (m: ChainMember, depth: number) => {
    if (seen.has(m.case_key)) return;
    seen.add(m.case_key);
    out.push({ m, depth });
    for (const k of kids.get(m.case_key) ?? []) walk(k, depth + 1);
  };
  const root = members.find((m) => m.case_key === rootKey);
  if (root) walk(root, 0);
  for (const m of members) if (!seen.has(m.case_key)) walk(m, 0);
  return out;
}

function Dates({ m }: { m: Pick<ChainMember, 'first_date' | 'last_date' | 'financial_year'> }) {
  const span = m.first_date ? (m.last_date && m.last_date !== m.first_date ? `${fmtDate(m.first_date)} to ${fmtDate(m.last_date)}` : fmtDate(m.first_date)) : null;
  return <>{[span, m.financial_year ? `FY ${fmtFy(m.financial_year)}` : null].filter(Boolean).join(' · ')}</>;
}

export const CaseChainPanel: React.FC<{
  clientId: string;
  caseKey: string;
  /** The case shown alone on the page (null: the whole chain). */
  part: string | null;
  onPart: (key: string | null) => void;
}> = ({ clientId, caseKey, part, onPart }) => {
  const { user, canEditNoticeStatus } = useAuth();
  const canEdit = canEditNoticeStatus();
  const qc = useQueryClient();
  const chain = useCaseChain(clientId, caseKey);
  const sug = useLinkCandidates(clientId, caseKey, 40);
  const [picking, setPicking] = useState(false);
  const all = useLinkCandidates(clientId, caseKey, -1000, picking);
  const [pick, setPick] = useState<string>('');
  const [pickKind, setPickKind] = useState<LinkKind>('appeal');
  const [flip, setFlip] = useState(false);
  const [busy, setBusy] = useState(false);
  const by = user?.firstName ?? null;

  const members = useMemo(() => chain.data?.members ?? [], [chain.data]);
  const byKey = useMemo(() => new Map(members.map((m) => [m.case_key, m])), [members]);
  const tree = useMemo(() => treeOrder(members, chain.data?.root_key ?? caseKey), [members, chain.data, caseKey]);
  const linked = members.length > 1;

  const refresh = () => {
    for (const k of ['notice-case', 'notice-case-chain', 'notice-case-candidates', 'notice-case-items', 'notice-case-overview',
      'notice-cases', 'notice-case-counts', 'notice-chain-links', 'notice-link-suggestions', 'notices-command-centre']) {
      qc.invalidateQueries({ queryKey: [k] });
    }
  };
  const run = async (what: () => Promise<void>, done: string) => {
    setBusy(true);
    try {
      await what();
      toast.success(done);
      refresh();
    } catch (e) { toast.error(errText(e)); } finally { setBusy(false); }
  };
  const link = (child: string, parent: string, kind: LinkKind) =>
    run(() => setCaseLink(clientId, child, parent, kind, by), 'Linked. The cases now show as one chain; each can still be seen on its own.');
  const unlink = (m: ChainMember) =>
    run(() => setCaseLink(clientId, m.case_key, null, null, by).then(() => { if (part === m.case_key) onPart(null); }),
      'Unlinked. The system will not link these two again unless someone links them.');
  const reset = (key: string) => run(() => resetCaseLink(clientId, key), 'Handed back: the system links it again only when it is certain.');

  const chosen = (all.data ?? []).find((c) => c.other_key === pick);
  const linkPicked = () => {
    if (!chosen) return;
    // The scorer knows which way round it belongs; "the other way round" swaps it.
    const child = flip ? chosen.parent_key : chosen.child_key;
    const parent = flip ? chosen.child_key : chosen.parent_key;
    link(child, parent, pickKind).then(() => { setPicking(false); setPick(''); setFlip(false); });
  };

  const description = linked
    ? `${plural(members.length, 'case')} in one chain`
    : 'This case is not linked to any other';

  return (
    <SectionCard
      title={<span className="inline-flex items-center gap-1.5"><GitBranch className="h-4 w-4 text-primary" aria-hidden /> Linked cases</span>}
      description={description}
      info="Cases are linked by themselves when their papers carry the same portal number: an appeal application naming the order it is against, a refund appeal naming the RFD-06, an order naming the original. When the papers name nothing, the cases that may belong here are suggested, scored on the kind of case, the dates (an appeal within 120 days of the order), the financial year, the amount and whether it is about a refund. A person's link or unlink always stands. Linked cases show as one case on the Cases list; switch the list to Apart, or use Show this case only, to see each on its own."
      actions={canEdit && (
        <Button size="sm" variant="outline" className={WS_BTN} onClick={() => setPicking((v) => !v)} disabled={busy}>
          <Link2 className="h-3.5 w-3.5" aria-hidden /> Link a case
        </Button>
      )}>
      {chain.error ? <Note tone="warn">Couldn't load the linked cases: {errText(chain.error)}</Note>
        : chain.isLoading ? <Skeleton className="h-16 w-full" />
        : (
          <>
            {linked && (
              <ol className="space-y-1.5" aria-label="The chain of cases">
                {tree.map(({ m, depth }) => {
                  const parent = m.parent_key ? byKey.get(m.parent_key) : undefined;
                  const out = m.track === 'refund' ? refundOutcome(m.refund) : null;
                  const shown = part === m.case_key;
                  return (
                    <li key={m.case_key} style={{ marginLeft: `${Math.min(depth, 4) * 1.25}rem` }}
                      className={cn('relative rounded-lg border p-2.5', shown ? 'border-primary/60 bg-primary/5' : 'bg-card',
                        depth > 0 && 'before:absolute before:-left-3 before:top-4 before:h-px before:w-3 before:bg-border')}>
                      <div className="flex flex-wrap items-start gap-2">
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-sm font-semibold">{caseLabel(m)}</span>
                            {!m.parent_key && <Badge variant="secondary" className="text-[10px]">Original case</Badge>}
                            {m.kind && <Badge variant="info" className="text-[10px]">{linkKindDef(m.kind).label}</Badge>}
                            <Badge variant={m.is_open ? 'warning' : 'secondary'} className="text-[10px]">{m.is_open ? 'Open' : 'Closed'}</Badge>
                            {out && <Badge variant={out === 'sanctioned' ? 'success' : 'destructive'} className="text-[10px]">Refund {out}</Badge>}
                          </div>
                          {parent && <div className="text-xs font-medium text-foreground/85">{describeLink(m, parent, fmtDate)}</div>}
                          <div className="text-[11px] text-muted-foreground">
                            {m.case_id ? <span className="font-mono">{m.case_id}</span> : 'No portal case'}
                            {' · '}<Dates m={m} />
                            {' · '}{plural(m.notices, 'notice')}{m.documents ? `, ${plural(m.documents, 'document')}` : ''}
                            {m.order ? <> · holds {m.order.form && m.order.form !== 'Order' ? m.order.form : 'an order'}{m.order.ref ? <span className="font-mono"> {m.order.ref}</span> : null}{m.order.date ? ` of ${fmtDate(m.order.date)}` : ''}</> : null}
                          </div>
                          {m.parent_key && (
                            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                              {m.source === 'auto' ? <Sparkles className="h-3 w-3 text-primary/70" aria-hidden /> : <Link2 className="h-3 w-3" aria-hidden />}
                              {m.source === 'auto'
                                ? <span>Linked by itself: {m.reason ?? (m.via_ref ? `${m.via_ref} is on the papers of both cases` : 'the papers of both cases carry the same number')}</span>
                                : <span>Linked by {m.linked_by || 'a person'}{m.linked_at ? ` on ${fmtDate(m.linked_at)}` : ''}</span>}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                          <Button size="sm" variant={shown ? 'default' : 'ghost'} className="h-7 gap-1 px-2 text-xs" onClick={() => onPart(shown ? null : m.case_key)}
                            aria-pressed={shown} title="Show only this case's correspondence">
                            <Eye className="h-3.5 w-3.5" aria-hidden /> {shown ? 'Shown alone' : 'Show alone'}
                          </Button>
                          {m.lead_notice_id && (
                            <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" asChild>
                              <Link to={`/notices/${m.lead_notice_id}`}>Notice <ArrowRight className="h-3 w-3" aria-hidden /></Link>
                            </Button>
                          )}
                          {canEdit && m.parent_key && (
                            <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs text-destructive-strong" disabled={busy} onClick={() => unlink(m)}
                              title="Not linked: keep this case apart from the one above">
                              <Link2Off className="h-3.5 w-3.5" aria-hidden /> Unlink
                            </Button>
                          )}
                          {canEdit && m.source === 'manual' && (
                            <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" disabled={busy} onClick={() => reset(m.case_key)}
                              title="Take away the person's link: the system links it again only when certain">
                              <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Let the system decide
                            </Button>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}

            {(chain.data?.unlinked ?? []).map((u) => (
              <div key={`${u.child_key}>${u.parent_key}`} className="flex flex-wrap items-center gap-2 rounded-md border border-dashed px-2.5 py-1.5 text-xs text-muted-foreground">
                <Link2Off className="h-3.5 w-3.5" aria-hidden />
                <span className="min-w-0 flex-1">
                  Kept apart: <span className="font-mono">{u.child_key}</span> and <span className="font-mono">{u.parent_key}</span>
                  {u.by ? `, unlinked by ${u.by}` : ''}{u.at ? ` on ${fmtDate(u.at)}` : ''}
                </span>
                {canEdit && (
                  <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-xs" disabled={busy} onClick={() => reset(u.child_key)}>
                    <RotateCcw className="h-3 w-3" aria-hidden /> Let the system decide
                  </Button>
                )}
              </div>
            ))}

            {(sug.data ?? []).length > 0 && (
              <div className="rounded-lg border border-info/40 bg-info/5 px-3 py-2">
                <p className="flex items-center gap-1.5 text-sm font-medium"><Sparkles className="h-4 w-4 text-info" aria-hidden /> May belong with this case</p>
                <ul className="mt-1 divide-y">
                  {(sug.data ?? []).slice(0, 4).map((c) => <Suggestion key={c.other_key} c={c} canEdit={canEdit} busy={busy} onLink={link} />)}
                </ul>
              </div>
            )}

            {picking && canEdit && (
              <div className="space-y-2 rounded-lg border p-2.5">
                <p className="text-xs font-medium">Link another case of this client</p>
                {all.isLoading ? <Skeleton className="h-8 w-full" /> : !(all.data ?? []).length ? (
                  <p className="text-xs text-muted-foreground">This client has no other case to link.</p>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Select value={pick} onValueChange={(v) => {
                      setPick(v);
                      const c = (all.data ?? []).find((x) => x.other_key === v);
                      if (c) setPickKind(c.kind);
                    }}>
                      <SelectTrigger className="h-8 w-full text-xs sm:w-[22rem]" aria-label="The other case"><SelectValue placeholder="Choose the case" /></SelectTrigger>
                      <SelectContent>
                        {(all.data ?? []).map((c) => (
                          <SelectItem key={c.other_key} value={c.other_key} className="text-xs">
                            {caseLabel(c.other)} · {c.other.case_id ?? 'no portal case'}{c.other.first_date ? ` · ${fmtDate(c.other.first_date)}` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={pickKind} onValueChange={(v) => setPickKind(v as LinkKind)}>
                      <SelectTrigger className="h-8 w-40 text-xs" aria-label="How it is linked"><SelectValue /></SelectTrigger>
                      <SelectContent>{LINK_KINDS.map((k) => <SelectItem key={k.key} value={k.key} className="text-xs">{k.label}</SelectItem>)}</SelectContent>
                    </Select>
                    <Button size="sm" className={WS_BTN} disabled={!chosen || busy} onClick={linkPicked}>
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Link2 className="h-3.5 w-3.5" aria-hidden />} Link
                    </Button>
                  </div>
                )}
                {chosen && (
                  <p className="text-[11px] text-muted-foreground">
                    <span className="font-mono">{flip ? chosen.parent_key : chosen.child_key}</span> {linkKindDef(pickKind).child}{' '}
                    <span className="font-mono">{flip ? chosen.child_key : chosen.parent_key}</span>.{' '}
                    <button type="button" className="font-medium text-primary hover:underline" onClick={() => setFlip((v) => !v)}>The other way round</button>
                  </p>
                )}
              </div>
            )}
          </>
        )}
    </SectionCard>
  );
};

const Suggestion: React.FC<{ c: LinkCandidate; canEdit: boolean; busy: boolean; onLink: (child: string, parent: string, kind: LinkKind) => void }> = ({ c, canEdit, busy, onLink }) => {
  const o = c.other;
  const out = o.track === 'refund' ? refundOutcome(o.refund) : null;
  const def = linkKindDef(c.kind);
  const otherIsChild = c.child_key === c.other_key;
  return (
    <li className="flex flex-wrap items-center gap-2 py-1.5">
      <div className="min-w-0 flex-1 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          {o.lead_notice_id
            ? <Link to={`/notices/${o.lead_notice_id}`} className="font-medium text-primary hover:underline">{caseLabel(o)}</Link>
            : <span className="font-medium">{caseLabel(o)}</span>}
          {o.case_id && <span className="font-mono text-[11px] text-muted-foreground">{o.case_id}</span>}
          <Badge variant="secondary" className="text-[10px]" title="How sure: 100 is certain">{c.score}</Badge>
          {out && <Badge variant={out === 'sanctioned' ? 'success' : 'destructive'} className="text-[10px]">Refund {out}</Badge>}
        </div>
        <div className="text-[11px] text-foreground/80">
          {otherIsChild ? `It ${def.child} this case` : `This case ${def.child} it`}
          {o.order ? ` (${o.order.form && o.order.form !== 'Order' ? o.order.form : 'order'}${o.order.ref ? ` ${o.order.ref}` : ''}${o.order.date ? ` of ${fmtDate(o.order.date)}` : ''})` : ''}
          {o.amount ? ` · ${fmtInrShort(o.amount)}` : ''}
        </div>
        <div className="text-[11px] text-muted-foreground">{c.reasons.join(' · ')}</div>
      </div>
      {canEdit && <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => onLink(c.child_key, c.parent_key, c.kind)}>Link</Button>}
    </li>
  );
};

export default CaseChainPanel;
