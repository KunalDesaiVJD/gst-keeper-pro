// Government contractor projects — Phase 4 of the advance set-off module.
// docs/ADVANCE_SETOFF_POSITIONS.md §9.
//
// Structurally parallel to the Builder module and sharing none of its code.
// The difference that drives everything here: a promoter's advance is absorbed
// by the unit it was booked against, whereas a contractor's MOBILISATION
// ADVANCE is received once against a bank guarantee and recovered
// proportionately from EVERY RA bill until exhausted.
//
// So the recovery is a SCHEDULE to be checked, not a one-off set-off: the
// expected recovery on each bill is computed from the contract terms, and the
// variance against what was actually adjusted in Table 11B is a real finding.
// An under-recovery means the advance is still sitting taxed while the value
// has already been billed — the double-tax position this whole module exists
// to prevent, arriving one RA bill at a time.

import { supabase } from '@/integrations/supabase/client';
import { periodOrdinal, type TaxAmount } from './advanceBalance';
import {
  effectiveLegs, taxForRate,
  type AdvanceReceipt, type AdvanceAdjustment,
} from './advanceRegister';

export type RecoveryRule = 'PCT_PER_RA_BILL' | 'LUMPSUM_AT_BILL_N';
export type ProjectStatus = 'ACTIVE' | 'COMPLETED' | 'CLOSED';

export interface ContractProject {
  id: string;
  client_id: string;
  code: string;
  name: string;
  department: string;
  work_order_no: string;
  work_order_date: string | null;
  contract_value: number;
  /** Location of the immovable property (s.12(3)), not the client's state. */
  pos_state: string;
  rate_pct: number;
  mobilisation_advance_pct: number;
  recovery_rule: RecoveryRule;
  recovery_pct: number;
  recovery_at_bill_no: number | null;
  bg_no: string;
  bg_amount: number;
  bg_expiry: string | null;
  retention_pct: number;
  status: ProjectStatus;
  notes: string;
  created_at: string;
}

export interface ContractRaBill {
  id: string;
  project_id: string;
  client_id: string;
  bill_no: number;
  bill_ref: string;
  bill_date: string;
  period_month: string;
  gross_value: number;
  taxable_value: number;
  rate_pct: number;
  igst: number;
  cgst: number;
  sgst: number;
  retention_held: number;
  notes: string;
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface RecoveryRow {
  bill: ContractRaBill;
  /** What the contract terms say should have been recovered on this bill. */
  expected: number;
  /** What was actually adjusted in Table 11B against this bill. */
  actual: number;
  /** expected − actual. Positive = under-recovered. */
  variance: number;
  /** Advance still outstanding after this bill, on the expected schedule. */
  advanceOutstanding: number;
  /** True where the bill predates the advance and so cannot recover it. */
  beforeAdvance: boolean;
}

/**
 * The recovery schedule for a project.
 *
 * Bills are walked in bill_no order because that is the order the recovery
 * actually happens in — sorting by date would reorder a bill raised late for
 * an earlier period and silently shift the whole schedule.
 *
 * A bill raised BEFORE any advance was received cannot recover one. Those are
 * marked and skipped rather than dropped, so the working paper still shows the
 * full billing history.
 */
export function recoverySchedule(params: {
  project: ContractProject;
  bills: ContractRaBill[];
  receipts: AdvanceReceipt[];
  adjustments: AdvanceAdjustment[];
}): RecoveryRow[] {
  const { project, bills, receipts, adjustments } = params;

  const projectReceipts = receipts.filter(
    (r) => r.project_id === project.id && r.supply_nature !== 'GOODS',
  );
  const advanceTotal = r2(projectReceipts.reduce((t, r) => t + num(r.taxable_value), 0));
  const earliestAdvance = projectReceipts
    .map((r) => r.period_month)
    .sort((a, b) => periodOrdinal(a) - periodOrdinal(b))[0] || null;

  const actualByBill = new Map<string, number>();
  effectiveLegs(adjustments)
    .filter((a) => a.reason === 'INVOICE' && a.project_id === project.id)
    .forEach((a) => {
      const k = (a as AdvanceAdjustment & { ra_bill_id?: string | null }).ra_bill_id || '';
      if (!k) return;
      actualByBill.set(k, r2((actualByBill.get(k) || 0) + num(a.taxable_value_adjusted)));
    });

  const ordered = [...bills].sort((a, b) => a.bill_no - b.bill_no);
  let remaining = advanceTotal;
  const rate = num(project.recovery_pct) / 100;

  return ordered.map((bill) => {
    const beforeAdvance = !!earliestAdvance
      && periodOrdinal(bill.period_month) < periodOrdinal(earliestAdvance);

    let expected = 0;
    if (!beforeAdvance && remaining > 0) {
      if (project.recovery_rule === 'LUMPSUM_AT_BILL_N') {
        expected = bill.bill_no === num(project.recovery_at_bill_no) ? remaining : 0;
      } else {
        expected = r2(rate * num(bill.taxable_value));
      }
      // Never plan to recover more than is outstanding — the last bill of a
      // schedule recovers only the tail, not a full percentage slice.
      expected = r2(Math.min(expected, remaining));
    }
    remaining = r2(remaining - expected);

    const actual = actualByBill.get(bill.id) || 0;
    return {
      bill,
      expected,
      actual,
      variance: r2(expected - actual),
      advanceOutstanding: remaining,
      beforeAdvance,
    };
  });
}

export interface ProjectWorkingPaper {
  contractValue: number;
  billedToDate: number;
  advanceReceived: number;
  recovered: number;
  balanceAdvance: number;
  /** Retention actually recorded on the bills. */
  retentionHeld: number;
  /** What the contract's retention percentage implies on the value billed. */
  retentionExpected: number;
  /** Tax still sitting on the unrecovered advance. */
  openGstOnAdvance: TaxAmount;
  /** Sum of under-recoveries across the schedule. */
  recoveryShortfall: number;
  billedPctOfContract: number;
}

/**
 * The project working paper — the figures a reviewer actually asks for, in the
 * order they ask for them.
 */
export function projectWorkingPaper(params: {
  project: ContractProject;
  bills: ContractRaBill[];
  receipts: AdvanceReceipt[];
  adjustments: AdvanceAdjustment[];
  homeState: string;
}): ProjectWorkingPaper {
  const { project, bills, receipts, adjustments, homeState } = params;

  const projectReceipts = receipts.filter(
    (r) => r.project_id === project.id && r.supply_nature !== 'GOODS',
  );
  const advanceReceived = r2(projectReceipts.reduce((t, r) => t + num(r.taxable_value), 0));
  const recovered = r2(
    effectiveLegs(adjustments)
      .filter((a) => a.reason === 'INVOICE' && a.project_id === project.id)
      .reduce((t, a) => t + num(a.taxable_value_adjusted), 0),
  );
  const billedToDate = r2(bills.reduce((t, b) => t + num(b.taxable_value), 0));
  const balanceAdvance = r2(Math.max(advanceReceived - recovered, 0));
  const contractValue = num(project.contract_value);

  // POS comes from the project, so the split follows the property's location
  // rather than the client's own state.
  const splyTy = project.pos_state && homeState && project.pos_state === homeState ? 'INTRA' : 'INTER';

  const schedule = recoverySchedule({ project, bills, receipts, adjustments });
  const recoveryShortfall = r2(
    schedule.filter((s) => s.variance > 0).reduce((t, s) => t + s.variance, 0),
  );

  return {
    contractValue,
    billedToDate,
    advanceReceived,
    recovered,
    balanceAdvance,
    retentionHeld: r2(bills.reduce((t, b) => t + num(b.retention_held), 0)),
    retentionExpected: r2((num(project.retention_pct) / 100) * billedToDate),
    openGstOnAdvance: taxForRate(balanceAdvance, num(project.rate_pct), splyTy),
    recoveryShortfall,
    billedPctOfContract: contractValue > 0 ? r2((billedToDate / contractValue) * 100) : 0,
  };
}

/** Days until the bank guarantee lapses. Negative once it already has. */
export function bgDaysRemaining(project: ContractProject, today = new Date()): number | null {
  if (!project.bg_expiry) return null;
  const expiry = new Date(project.bg_expiry);
  if (Number.isNaN(expiry.getTime())) return null;
  return Math.ceil((expiry.getTime() - today.getTime()) / 86400000);
}

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------

export async function fetchProjects(clientId: string): Promise<ContractProject[]> {
  if (!clientId) return [];
  const { data, error } = await supabase
    .from('contract_projects' as never).select('*').eq('client_id', clientId).order('name');
  if (error) return [];
  return (data as unknown as ContractProject[]) || [];
}

export async function fetchRaBills(projectId: string): Promise<ContractRaBill[]> {
  if (!projectId) return [];
  const { data, error } = await supabase
    .from('contract_ra_bills' as never).select('*').eq('project_id', projectId).order('bill_no');
  if (error) return [];
  return (data as unknown as ContractRaBill[]) || [];
}

export async function saveProject(
  project: Partial<ContractProject> & { client_id: string },
  actor: { id: string | null; name: string },
): Promise<void> {
  const payload = {
    ...project,
    updated_at: new Date().toISOString(),
    ...(project.id ? {} : { created_by: actor.id, created_by_name: actor.name }),
  };
  const { error } = project.id
    ? await supabase.from('contract_projects' as never).update(payload as never).eq('id', project.id)
    : await supabase.from('contract_projects' as never).insert(payload as never);
  if (error) throw error;
}

export async function deleteProject(id: string): Promise<void> {
  const { error } = await supabase.from('contract_projects' as never).delete().eq('id', id);
  if (error) throw error;
}

export async function saveRaBill(
  bill: Partial<ContractRaBill> & { project_id: string; client_id: string },
  actor: { id: string | null; name: string },
): Promise<void> {
  const payload = {
    ...bill,
    updated_at: new Date().toISOString(),
    ...(bill.id ? {} : { created_by: actor.id, created_by_name: actor.name }),
  };
  const { error } = bill.id
    ? await supabase.from('contract_ra_bills' as never).update(payload as never).eq('id', bill.id)
    : await supabase.from('contract_ra_bills' as never).insert(payload as never);
  if (error) throw error;
}

export async function deleteRaBill(id: string): Promise<void> {
  const { error } = await supabase.from('contract_ra_bills' as never).delete().eq('id', id);
  if (error) throw error;
}
