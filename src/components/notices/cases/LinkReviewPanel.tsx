// What waits for a person before cases are linked (the firm's request of 25
// October 2026: "whenever ... confidence less than 90% then the system may ask
// human for tagging or linking"). The system links by itself only when it is
// at least 90% sure (the gate of 20261025100000); everything else is listed
// here: a link it was not sure of, an appeal / waiver / rectification linked
// to no order, and two cases that look like the same case. Each item says how
// sure the system was and why, and a person links it, keeps it apart, or
// marks it as nothing to do. Every decision is kept with who made it.
// Each pair also carries the law check (20261027140000): what GST law does not
// allow (two show cause proceedings in one case) or what is unusual, and Link
// warns first (LinkWarnDialog).
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, ShieldQuestion, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/gstr9/badge';
import { SectionCard } from '@/components/notices/ui/Panel';
import { LoadError } from '@/components/notices/autopilot/parts';
import { useAuth } from '@/contexts/AuthContext';
import {
  LINK_KINDS, MIN_LINK_CONFIDENCE, REVIEW_ISSUES, caseHref, caseLabel, decideReview, linkKindDef,
  type LinkKind, type ReviewCase, type ReviewDecision, type ReviewItem,
} from '@/lib/noticeCases';
import { fmtDate, fmtFy, fmtInrShort } from '@/lib/noticeFormat';
import { LinkCheckChip, LinkProblems, useGuardedLink } from '@/components/notices/cases/LinkWarnDialog';
import { decideReviewChecked, pairKey, useLinkChecks, type LinkCheck, type LinkPair } from '@/lib/noticeCaseLinkLaw';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const itemKey = (i: ReviewItem) => `${i.client_id}:${i.issue}:${i.child_key}:${i.parent_key ?? ''}`;

function CaseLine({ clientId, c, fallback }: { clientId: string; c: ReviewCase | null; fallback: string | null }) {
  if (!c) return <span className="font-mono text-[11px]">{fallback ?? 'no case'}</span>;
  const facts = [
    c.case_id,
    c.financial_year ? `FY ${fmtFy(c.financial_year)}` : null,
    c.order ? `${c.order.form && c.order.form !== 'Order' ? c.order.form : 'order'}${c.order.ref ? ` ${c.order.ref}` : ''}${c.order.date ? ` of ${fmtDate(c.order.date)}` : ''}` : null,
    c.amount ? fmtInrShort(c.amount) : null,
  ].filter(Boolean).join(' · ');
  return (
    <span className="min-w-0">
      <Link to={caseHref(clientId, c.case_key)} className="font-medium text-primary hover:underline">{caseLabel(c)}</Link>
      {facts && <span className="ml-1.5 text-[11px] text-muted-foreground">{facts}</span>}
    </span>
  );
}

function Sure({ n }: { n: number | null }) {
  if (n === null || n === undefined) return null;
  return (
    <Badge variant={n >= MIN_LINK_CONFIDENCE ? 'success' : n >= 70 ? 'warning' : 'secondary'} className="text-[10px]"
      title={`The system links by itself only when it is at least ${MIN_LINK_CONFIDENCE}% sure`}>
      {n}% sure
    </Badge>
  );
}

const ReviewRow: React.FC<{ item: ReviewItem; showClient: boolean; canEdit: boolean; busy: boolean; check?: LinkCheck;
  onDecide: (i: ReviewItem, parent: string | null, d: ReviewDecision, kind: LinkKind | null) => void }> = ({ item, showClient, canEdit, busy, check, onDecide }) => {
  const [kind, setKind] = useState<LinkKind>((item.kind as LinkKind) ?? 'related');
  const def = REVIEW_ISSUES[item.issue];
  const canLink = !!item.parent_key;
  const linkWord = item.issue === 'duplicate' ? 'Link as related' : 'Link';
  const noWord = item.issue === 'low_confidence' ? 'Not linked' : item.issue === 'unlinked' ? 'Nothing to link' : 'Not the same case';
  const noDecision: ReviewDecision = item.issue === 'low_confidence' ? 'not_linked' : 'dismissed';
  return (
    <li className="space-y-1 py-2">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <Badge variant={item.issue === 'duplicate' ? 'destructive' : 'warning'} className="text-[10px]">{def.label}</Badge>
        <Sure n={item.confidence} />
        <LinkCheckChip check={check} />
        {showClient && <span className="font-medium">{item.client_name}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <CaseLine clientId={item.client_id} c={item.child} fallback={item.child_key} />
        <span className="text-muted-foreground">
          {item.issue === 'duplicate' ? 'and' : item.parent_key ? linkKindDef(item.kind).child : 'is linked to no order.'}
        </span>
        {item.parent_key
          ? <CaseLine clientId={item.client_id} c={item.parent} fallback={item.parent_key} />
          : null}
        {item.issue === 'unlinked' && item.parent_key && <span className="text-[11px] text-muted-foreground">(suggested)</span>}
        {item.issue === 'unlinked' && !item.parent_key && (
          <span className="text-[11px] text-muted-foreground">No case of this client looks like the one it is against; link it from its case page if the order is here.</span>
        )}
      </div>
      {item.reasons.length > 0 && <div className="text-[11px] text-muted-foreground">Why: {item.reasons.join(' · ')}</div>}
      {check?.against_law && <LinkProblems compact problems={check.problems.filter((p) => p.level === 'law')} />}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          {canLink && item.issue !== 'duplicate' && (
            <Select value={kind} onValueChange={(v) => setKind(v as LinkKind)}>
              <SelectTrigger className="h-7 w-40 text-xs" aria-label="Kind of link"><SelectValue /></SelectTrigger>
              <SelectContent>{LINK_KINDS.map((k) => <SelectItem key={k.key} value={k.key} className="text-xs">{k.label}</SelectItem>)}</SelectContent>
            </Select>
          )}
          {canLink && (
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={busy}
              onClick={() => onDecide(item, item.parent_key, 'link', item.issue === 'duplicate' ? 'related' : kind)}>
              <Check className="h-3.5 w-3.5" aria-hidden /> {linkWord}
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" disabled={busy}
            onClick={() => onDecide(item, item.parent_key, noDecision, null)}>
            <X className="h-3.5 w-3.5" aria-hidden /> {noWord}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" asChild>
            <Link to={caseHref(item.client_id, item.child_key)}>Open case <ArrowRight className="h-3 w-3" aria-hidden /></Link>
          </Button>
        </div>
      )}
    </li>
  );
};

export const LinkReviewPanel: React.FC<{
  items: ReviewItem[] | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  /** True when the list spans clients (no client chosen). */
  showClient: boolean;
}> = ({ items, loading, error, onRetry, showClient }) => {
  const { user, canEditNoticeStatus } = useAuth();
  const canEdit = canEditNoticeStatus();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const by = user?.firstName ?? null;
  const guard = useGuardedLink(by);

  const decide = async (i: ReviewItem, parent: string | null, d: ReviewDecision, kind: LinkKind | null) => {
    setBusy(true);
    try {
      if (d === 'link' && parent) {
        // Through the law check: the person is warned first when anything is wrong or unusual.
        const pair: LinkPair = { clientId: i.client_id, childKey: i.child_key, parentKey: parent, kind };
        if (!(await guard.attempt(pair, (confirm) => decideReviewChecked(i, parent, kind, by, confirm)))) return;
      } else {
        await decideReview(i, parent, d, kind, by);
      }
      toast.success(d === 'link' ? 'Linked by you. The system will keep it.' : d === 'not_linked'
        ? 'Kept apart. The system will not propose this pair again.' : 'Noted. It leaves the list.');
      for (const k of ['notice-case-review', 'notice-cases', 'notice-case-counts', 'notice-chain-links', 'notice-case-chain', 'notice-case']) {
        qc.invalidateQueries({ queryKey: [k] });
      }
    } catch (e) { toast.error(errText(e)); } finally { setBusy(false); }
  };

  const list = useMemo(() => items ?? [], [items]);
  const pairs = useMemo<LinkPair[]>(() => list.filter((i) => i.parent_key && i.issue !== 'duplicate').slice(0, 40)
    .map((i) => ({ clientId: i.client_id, childKey: i.child_key, parentKey: i.parent_key as string, kind: i.kind })), [list]);
  const checks = useLinkChecks(pairs);
  const checkOf = (i: ReviewItem) => (i.parent_key
    ? checks.data?.get(pairKey({ clientId: i.client_id, childKey: i.child_key, parentKey: i.parent_key, kind: i.kind })) : undefined);
  return (
    <SectionCard
      title={<span className="inline-flex items-center gap-1.5"><ShieldQuestion className="h-4 w-4 text-primary" aria-hidden /> Links to check</span>}
      description={list.length ? `${list.length} to decide before these cases are linked` : 'Nothing waits: every link was certain'}
      info={`The system links two cases by itself only when it is at least ${MIN_LINK_CONFIDENCE}% sure: an appeal, waiver or rectification naming the other case's order is 98%, a refund filed again naming the earlier one is 90% or more. Anything less waits here, with how sure the system was and why. Also listed: an appeal, waiver or rectification linked to no order, and two cases that look like the same case. Your decision always stands; the system never undoes it.`}
    >
      {error ? <LoadError what="the review list" error={error} onRetry={onRetry} />
        : loading ? <Skeleton className="h-24 w-full" />
        : !list.length ? <p className="text-xs text-muted-foreground">Nothing to review.</p>
        : <ul className="divide-y">{list.map((i) => <ReviewRow key={itemKey(i)} item={i} showClient={showClient} canEdit={canEdit} busy={busy} check={checkOf(i)} onDecide={decide} />)}</ul>}
      {guard.dialog}
    </SectionCard>
  );
};

export default LinkReviewPanel;
