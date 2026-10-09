import React from 'react';
import { AlertTriangle, CornerUpLeft, Lock } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  changesSinceSignoff, daysInStage, displayName, isMyTurn, nextSentence, ownerOf, STAGE_META, stageSentence, turnVerb,
  type SignoffActor, type SignoffState,
} from '@/lib/gstr9/signoffFlow';
import { cn } from '@/lib/utils';
import { CellIsland } from '../grid/CellIsland';
import { fmtWhen } from '../overview/steps';
import { Monogram } from '../signoff/Monogram';
import { StageTrack } from '../signoff/StageTrack';
import { useRegisterSignoff, type SignoffRowInfo } from './signoffContext';
import { SignoffPanel } from './SignoffPanel';

const shortDay = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
};

/** "4d" in the cell: quiet under a week, amber from 7 days, red from 14. */
const AgePill: React.FC<{ s: SignoffState }> = ({ s }) => {
  if (s.stage === 'locked') return <span className="text-[10px] text-muted-foreground">{shortDay(s.locked?.at)}</span>;
  const d = daysInStage(s);
  if (d === null) return null;
  return (
    <span className={cn('rounded px-1 text-[10px] tabular-nums', d >= 14 ? 'font-semibold text-destructive-strong' : d >= 7 ? 'bg-warning/20 text-foreground' : 'text-muted-foreground')}>
      {d}d
    </span>
  );
};

/** The person side of the cell: who has the working now. */
const OwnerSide: React.FC<{ s: SignoffState; me: SignoffActor; turn: boolean }> = ({ s, me, turn }) => {
  const o = ownerOf(s);
  if (o.kind === 'done') {
    const who = s.locked?.name;
    return (
      <span className="inline-flex min-w-0 items-center gap-1">
        <Monogram name={who} muted />
        <span className="truncate text-muted-foreground">{displayName(who)}</span>
      </span>
    );
  }
  if (o.kind === 'unallotted') {
    return (
      <span className="inline-flex min-w-0 items-center gap-1">
        <Monogram kind="nobody" />
        <span className={cn('truncate', me.isManager ? 'font-medium text-primary' : 'text-muted-foreground')}>{me.isManager ? 'Allot' : 'Unallotted'}</span>
      </span>
    );
  }
  if (o.kind === 'managers') {
    return (
      <span className="inline-flex min-w-0 items-center gap-1">
        <Monogram kind="managers" />
        <span className={cn('truncate', turn ? 'font-semibold text-primary' : 'text-muted-foreground')}>{turn ? 'You' : 'Managers'}</span>
      </span>
    );
  }
  const mine = o.person.id === me.id;
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <Monogram name={o.person.name} me={mine} />
      <span className={cn('truncate', mine && 'font-semibold text-primary')}>{mine ? 'You' : displayName(o.person.name)}</span>
    </span>
  );
};

/** Plain words for the cell's tooltip (the grid shows it as the cell's title). */
export const signoffTitle = (r: SignoffRowInfo): string | undefined => {
  const s = r.s;
  if (!r.inScope && !s.preparer && !s.verifier && !s.reviewer) return undefined;
  const lines: string[] = [stageSentence(s)];
  if (s.stage === 'locked') {
    const p = [s.prepared && `Prepared ${displayName(s.prepared.name)} ${shortDay(s.prepared.at)}`, s.verified && `Verified ${displayName(s.verified.name)} ${shortDay(s.verified.at)}`].filter(Boolean);
    if (p.length) lines.push(p.join(' · '));
  } else {
    const next = nextSentence(s);
    const d = daysInStage(s);
    if (next) lines.push(`${next}${d !== null ? ` · ${d} day${d === 1 ? '' : 's'}` : ''}`);
    const n = changesSinceSignoff(s);
    if (n) lines.push(`${n} figure change${n === 1 ? '' : 's'} since ${s.verified ? 'verified' : 'prepared'}${s.changes?.lastBy ? ` (last: ${displayName(s.changes.lastBy)})` : ''}`);
  }
  const who = (p: { name: string } | null, none: string) => (p ? displayName(p.name) : none);
  lines.push(`Preparer ${who(s.preparer, 'not allotted')} · Verifier ${who(s.verifier, 'any GST manager')} · Reviewer ${who(s.reviewer, 'any GST manager')}`);
  if (s.lastSavedAt) lines.push(`Last saved ${fmtWhen(s.lastSavedAt)}`);
  if (!r.inScope) lines.unshift('Not being filed this year — the allotment is kept');
  return lines.join('\n');
};

/** Copy / export text: "Prepared · Amit". */
export const signoffLabel = (r: SignoffRowInfo): string => {
  const s = r.s;
  if (!r.inScope) return s.preparer ? 'Not filing' : '';
  const o = ownerOf(s);
  const who = o.kind === 'person' ? displayName(o.person.name) : o.kind === 'managers' ? 'any GST manager' : o.kind === 'unallotted' ? 'unallotted' : displayName(s.locked?.name);
  return `${STAGE_META[s.stage].label} · ${who}`;
};

/**
 * The register's Sign-off cell: three dots (prepare · verify · review), the
 * stage, who has the working now and for how long. When it is my turn the cell
 * is tinted and says what to do. A click (or Enter on the cell) opens
 * allotment and sign-off.
 */
export const SignoffCell: React.FC<{ row: SignoffRowInfo }> = ({ row: r }) => {
  const ctx = useRegisterSignoff();
  const { me } = ctx;
  const s = r.s;
  const allotted = !!(s.preparer || s.verifier || s.reviewer);

  if (!r.inScope && !allotted) return <span className="text-[11px] text-muted-foreground">—</span>;

  const open = ctx.openFor === r.id;
  const turn = r.inScope && isMyTurn(s, me);
  const changed = changesSinceSignoff(s) > 0;
  const meta = STAGE_META[s.stage];

  const face = !r.inScope ? (
    <>
      <span className="w-[28px] shrink-0" />
      <span className="w-[62px] shrink-0 truncate text-muted-foreground">Not filing</span>
      <span className="ml-auto inline-flex min-w-0 items-center gap-1">
        <Monogram name={s.preparer?.name} muted />
        <span className="truncate text-muted-foreground">{displayName(s.preparer?.name ?? s.verifier?.name ?? s.reviewer?.name)}</span>
      </span>
    </>
  ) : (
    <>
      <StageTrack state={s} className="w-[28px]" />
      <span
        className={cn(
          'inline-flex w-[62px] shrink-0 items-center gap-0.5 truncate font-medium',
          turn ? 'font-semibold text-primary'
            : s.stage === 'sent_back' ? 'text-destructive-strong'
              : s.stage === 'locked' ? 'text-success-strong'
                : s.stage === 'not_started' ? 'text-muted-foreground' : 'text-foreground',
        )}
      >
        {s.stage === 'locked' && <Lock className="h-2.5 w-2.5 shrink-0" aria-hidden />}
        {s.stage === 'sent_back' && !turn && <CornerUpLeft className="h-2.5 w-2.5 shrink-0" aria-hidden />}
        <span className="truncate">{turn ? turnVerb(s) : meta.label}</span>
        {changed && <AlertTriangle className="h-2.5 w-2.5 shrink-0 text-warning" aria-hidden />}
      </span>
      <span className="ml-auto flex min-w-0 max-w-[96px] items-center"><OwnerSide s={s} me={me} turn={turn} /></span>
      <span className="w-[30px] shrink-0 text-right"><AgePill s={s} /></span>
    </>
  );

  const label = [
    `Sign-off, ${r.name}: ${r.inScope ? stageSentence(s, { notes: false }) : 'not being filed this year'}`,
    r.inScope ? nextSentence(s) : null,
    turn ? `your turn to ${turnVerb(s).toLowerCase()}` : null,
    changed ? `${changesSinceSignoff(s)} figure changes since the last sign-off` : null,
  ].filter(Boolean).join('; ') + '. Open allotment and sign-off.';

  return (
    <CellIsland className="flex w-full gap-0">
      <Popover
        open={open}
        onOpenChange={(o) => {
          if (!o) ctx.setOpenFor(null);
          else { ctx.restoreFocusRef.current = null; ctx.setOpenFor(r.id); }
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className={cn(
              'flex h-6 w-full items-center gap-1.5 rounded px-1 text-left text-[11px] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted',
              turn && 'bg-primary/[0.08] ring-1 ring-inset ring-primary/30 hover:bg-primary/[0.12]',
            )}
          >
            {face}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={4}
          className="w-[340px] p-0"
          onCloseAutoFocus={(e) => {
            const back = ctx.restoreFocusRef.current;
            if (back) { e.preventDefault(); ctx.restoreFocusRef.current = null; back(); }
          }}
        >
          {open && <SignoffPanel row={r} />}
        </PopoverContent>
      </Popover>
    </CellIsland>
  );
};

export default SignoffCell;
