import { createContext, useContext, type MutableRefObject } from 'react';
import type { StaffMember } from '@/hooks/useStaffList';
import type { Load, SignoffActor, SignoffState, Stage } from '@/lib/gstr9/signoffFlow';

/** One register row as the Sign-off column sees it. */
export interface SignoffRowInfo {
  id: string;
  name: string;
  gstin: string | null;
  pan: string | null;
  /** "GSTR-9 + 9C", "GSTR-9 only", or why it is not filed. */
  returns: string;
  /** Filing (or turnover still to type), or the working has begun: the column shows the sign-off. */
  inScope: boolean;
  s: SignoffState;
}

export type StageFilter = Stage | 'unallotted' | 'changed' | 'stuck';
/** A staff user id, 'me' or 'unallotted'. */
export type PersonFilter = string;

export interface RegisterSignoffValue {
  me: SignoffActor;
  financialYear: string;
  staff: StaffMember[];
  staffById: Map<string, StaffMember>;
  staffLoading: boolean;
  staffError: string | null;
  reloadStaff: () => void;
  loads: Map<string, Load>;
  /** The row whose popover is open (controlled, so Enter on the grid cell can open it). */
  openFor: string | null;
  setOpenFor: (id: string | null) => void;
  /** Set when the popover was opened from the grid's keyboard: closing hands focus back to the grid. */
  restoreFocusRef: MutableRefObject<(() => void) | null>;
  patchRow: (clientId: string, s: SignoffState) => void;
  /** Re-read one working's sign-off from the database. */
  refreshRow: (clientId: string) => Promise<SignoffState | null>;
  onOpen: (clientId: string, extra?: Record<string, string>) => void;
  stageFilter: StageFilter | null;
  setStageFilter: (f: StageFilter | null) => void;
  personFilter: PersonFilter | null;
  setPersonFilter: (f: PersonFilter | null) => void;
  /** Rows of the view before the sign-off filters, per stage filter and per person. */
  stageCounts: Partial<Record<StageFilter, number>>;
  personCounts: Map<string, number>;
  /** Rows shown now, in scope and open: what "Allot the N shown" works on. */
  allotScope: SignoffRowInfo[];
  openBulk: () => void;
}

export const RegisterSignoffContext = createContext<RegisterSignoffValue | null>(null);

export const useRegisterSignoff = (): RegisterSignoffValue => {
  const v = useContext(RegisterSignoffContext);
  if (!v) throw new Error('useRegisterSignoff must be used inside the register');
  return v;
};
