import React from 'react';
import { ListFilter, Users } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { displayName } from '@/lib/gstr9/signoffFlow';
import { useRegisterSignoff, type StageFilter } from './signoffContext';

export const STAGE_FILTERS: { value: StageFilter; label: string }[] = [
  { value: 'unallotted', label: 'No preparer allotted' },
  { value: 'not_started', label: 'Not started' },
  { value: 'preparing', label: 'Preparing' },
  { value: 'sent_back', label: 'Sent back' },
  { value: 'prepared', label: 'Prepared — to verify' },
  { value: 'verified', label: 'Verified — to review & lock' },
  { value: 'locked', label: 'Locked' },
  { value: 'changed', label: 'Changed since sign-off' },
  { value: 'stuck', label: 'In one stage 14 days or more' },
];

export const stageFilterLabel = (f: StageFilter): string => STAGE_FILTERS.find((x) => x.value === f)?.label ?? f;

const Count: React.FC<{ n?: number }> = ({ n }) => <span className="ml-auto pl-3 text-[11px] tabular-nums text-muted-foreground">{n ?? 0}</span>;

/** The Sign-off column's header: its name, and a menu to filter by stage or person and (for managers) to allot what is shown. */
export const SignoffHeader: React.FC = () => {
  const ctx = useRegisterSignoff();
  const active = !!ctx.stageFilter || !!ctx.personFilter;
  const personLabel = !ctx.personFilter ? 'Anyone'
    : ctx.personFilter === 'me' ? 'Me'
      : ctx.personFilter === 'unallotted' ? 'Nobody (no preparer)'
        : displayName(ctx.staffById.get(ctx.personFilter)?.name ?? 'someone');
  return (
    <span className="flex w-full items-center justify-between gap-1">
      <span>Sign-off</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Sign-off filters and allotment${active ? ' (filtered)' : ''}`}
            className="relative inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ListFilter className="h-3.5 w-3.5" aria-hidden />
            {active && <span aria-hidden className="absolute right-0 top-0 h-1.5 w-1.5 rounded-full bg-primary" />}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 text-xs">
          <DropdownMenuLabel className="text-[11px] text-muted-foreground">Show stage</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={ctx.stageFilter ?? 'any'} onValueChange={(v) => ctx.setStageFilter(v === 'any' ? null : (v as StageFilter))}>
            <DropdownMenuRadioItem value="any" className="text-xs">Any stage</DropdownMenuRadioItem>
            {STAGE_FILTERS.map((f) => (
              <DropdownMenuRadioItem key={f.value} value={f.value} className="text-xs">
                {f.label}<Count n={ctx.stageCounts[f.value]} />
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="text-xs">
              <Users className="mr-2 h-3.5 w-3.5" aria-hidden /> Allotted to: <span className="ml-1 font-medium">{personLabel}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-80 w-56 overflow-y-auto">
              <DropdownMenuRadioGroup value={ctx.personFilter ?? 'anyone'} onValueChange={(v) => ctx.setPersonFilter(v === 'anyone' ? null : v)}>
                <DropdownMenuRadioItem value="anyone" className="text-xs">Anyone</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="me" className="text-xs">Me<Count n={ctx.personCounts.get(ctx.me.id)} /></DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="unallotted" className="text-xs">Nobody (no preparer)<Count n={ctx.stageCounts.unallotted} /></DropdownMenuRadioItem>
                <DropdownMenuSeparator />
                {ctx.staff.map((st) => (
                  <DropdownMenuRadioItem key={st.userId} value={st.userId} className="text-xs">
                    <span className="truncate">{displayName(st.name)}</span><Count n={ctx.personCounts.get(st.userId)} />
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {ctx.me.isManager && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-xs" disabled={!ctx.allotScope.length} onSelect={() => ctx.openBulk()}>
                Allot the {ctx.allotScope.length} shown…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
};

export default SignoffHeader;
