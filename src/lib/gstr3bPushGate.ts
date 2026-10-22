import { supabase } from '@/integrations/supabase/client';
import { manualSourceLabel } from '@/lib/manualSource';

// The GSTR-3B push gate (the firm's decisions of 21 Oct 2026). One database
// function, gstr3b_push_gate(client, period), decides for the GSTR-3B page's
// push, its JSON download and the browser extension (0.16.0), so all three
// agree. It passes only when Suspended Reco and GST Receivable Reco (from
// 06/2026) are pulled from the portal, or allowed manual by the superadmin,
// and show no difference after the ₹10 tolerance, under every head as well
// as in total (Builder + NO_ITC: the Suspended Reco difference is waived). Nil returns are included. An
// override of the opening balance by the superadmin or a GST Manager is how
// a difference is cleared. Migration 20261021120000;
// docs/2B_RECONCILIATION_FLOW.md §14.
//
// It fails closed: a missing row, an error in the function, or an error
// calling it blocks, with the reason.

export interface GateReason { code: string; message: string }

export interface GateDifference { cgst: number; sgst: number; igst: number; total: number }

/** How one reco stands: pulled, manual (allowed), or not. */
export interface GateRecoPart {
  status?: 'pulled' | 'manual' | 'revoked' | 'not_pulled' | 'missing';
  source?: string | null;
  pulled_at?: string | null;
  pulled_by?: string | null;
  pulled_by_name?: string | null;
  override?: { by: string | null; by_name: string | null; at: string | null; reason: string | null } | null;
  allowance?: {
    id: string; reason: string; allowed_by: string; allowed_by_name: string | null; allowed_at: string;
    used_by: string | null; used_at: string | null; revoked_at: string | null;
  } | null;
  difference?: GateDifference | null;
  /** Suspended Reco: the Builder + NO_ITC waiver of the difference. */
  waived?: boolean;
  /** The pull found no balance row on the portal for the month (saved as 0). */
  empty?: boolean;
  required?: boolean;
  required_pull?: boolean;
}

export interface Gstr3bGateResult {
  ok: boolean;
  error?: boolean;
  client_id?: string;
  period_month?: string;
  checked_at?: string;
  reasons: GateReason[];
  suspended?: GateRecoPart;
  receivable?: GateRecoPart;
}

type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }> };

const blocked = (message: string): Gstr3bGateResult => ({ ok: false, error: true, reasons: [{ code: 'error', message }] });

/**
 * Asks the database whether this client's GSTR-3B for this month may leave
 * the app. Never throws; anything but a clear "ok" from the function blocks.
 */
export async function checkGstr3bPushGate(clientId: string, periodMonth: string, client: RpcClient = supabase as unknown as RpcClient): Promise<Gstr3bGateResult> {
  if (!clientId || !periodMonth) return blocked('Select a client and month.');
  try {
    const { data, error } = await client.rpc('gstr3b_push_gate', { p_client_id: clientId, p_period: periodMonth });
    if (error) return blocked(`The reconciliation check could not run: ${error.message || 'unknown error'}.`);
    const r = data as Partial<Gstr3bGateResult> | null;
    if (!r || typeof r !== 'object' || typeof r.ok !== 'boolean') return blocked('The reconciliation check gave no answer.');
    const reasons = Array.isArray(r.reasons) ? r.reasons.filter((x): x is GateReason => !!x && typeof x.message === 'string') : [];
    if (r.ok !== true || reasons.length) {
      return { ...r, ok: false, reasons: reasons.length ? reasons : [{ code: 'error', message: 'The reconciliation check did not pass.' }] } as Gstr3bGateResult;
    }
    if (r.client_id && r.client_id !== clientId) return blocked('The reconciliation check answered for another client.');
    if (r.period_month && r.period_month !== periodMonth) return blocked('The reconciliation check answered for another month.');
    return { ...r, ok: true, reasons: [] } as Gstr3bGateResult;
  } catch (e) {
    return blocked(`The reconciliation check could not run: ${e instanceof Error ? e.message : String(e)}.`);
  }
}

/**
 * For a click that sends a GSTR-3B out (the push, the JSON download): asks
 * the gate again at that moment, not the answer from when the page loaded.
 * allowed is true only when it passes now; message is what to show when not.
 */
export async function askGateForClick(clientId: string, periodMonth: string, what: string, client?: RpcClient): Promise<{ gate: Gstr3bGateResult; allowed: boolean; message: string }> {
  const gate = await checkGstr3bPushGate(clientId, periodMonth, client);
  const allowed = gate.ok === true && gate.reasons.length === 0;
  return { gate, allowed, message: allowed ? '' : `${what} is locked. ${gateReasonsText(gate)}` };
}

/** The reasons, one sentence each, for a toast or a button title. */
export const gateReasonsText = (g: Gstr3bGateResult | null | undefined): string =>
  !g ? 'Checking Suspended Reco and GST Receivable Reco…' : g.reasons.map((r) => r.message).join(' ');

/**
 * True when every head and the total are 0 (the gate's rule since round 2 of
 * the review: heads that offset, IGST on the portal against CGST + SGST in
 * the books, do not tally). The reco pages' Tallies / Differs use it too.
 */
export const headsTally = (d: Partial<GateDifference> | null | undefined): boolean =>
  !d || ([d.cgst, d.sgst, d.igst, d.total] as (number | undefined)[]).every((x) => Number(x ?? 0) === 0);

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

/**
 * What a passing gate rests on, one sentence per reco, so "ready" never
 * claims more than the gate checked: pulled or an allowed manual entry, a
 * waived difference (Builder, no ITC), no pull needed before Jun 2026, an
 * override.
 */
export function gateReadyText(g: Gstr3bGateResult | null | undefined): string {
  if (!g || !g.ok) return '';
  const sentence = (name: string, p: GateRecoPart | undefined, required: boolean): string => {
    if (!p) return '';
    const waived = !!p.waived && !headsTally(p.difference);
    let text: string;
    if (p.status === 'pulled') text = waived ? `${name} is pulled; its difference is waived (Builder, no ITC).` : `${name} is pulled and has no difference.`;
    else if (p.status === 'manual') text = waived ? `${name} is a manual entry (allowed); its difference is waived (Builder, no ITC).` : `${name} is a manual entry (allowed) with no difference.`;
    else if (!required) text = waived ? `${name}: its difference is waived (Builder, no ITC); no pull is needed before Jun 2026.` : `${name} has no difference (no pull is needed before Jun 2026).`;
    else text = `${name} is not pulled.`;
    if (p.empty && p.status === 'pulled') text += ' The portal had no balance for the month.';
    if (p.override) text += ` Its opening was overridden by ${p.override.by_name || 'someone'}.`;
    return text;
  };
  return [
    sentence('Suspended Reco', g.suspended, !!g.suspended?.required_pull),
    g.receivable?.required ? sentence('GST Receivable Reco', g.receivable, true) : '',
  ].filter(Boolean).join(' ');
}

/** "Pulled from portal 21 Oct 2026 by Asha", "manual (allowed by X: reason)", or why it is not. */
export function gatePartLabel(part: GateRecoPart | null | undefined): string {
  if (!part) return '';
  // Before Jun 2026 a typed or uploaded opening is the allowed source: say
  // where it came from, not that it is missing a pull (round 2 of the review).
  if (part.required_pull === false && part.status !== 'pulled' && part.status !== 'manual') {
    if (part.status === 'missing') return 'No row (opening 0)';
    return part.source === 'csv' ? 'Opening from a CSV upload'
      : part.source === 'not_applicable' ? 'Marked Not Applicable'
      : part.source === 'portal' ? 'Opening from the portal'
      : 'Opening typed';
  }
  switch (part.status) {
    case 'pulled':
      return `Pulled from portal ${fmtDate(part.pulled_at)}${part.pulled_by_name ? ` by ${part.pulled_by_name}` : ''}${part.empty ? ', no balance on the portal' : ''}`;
    case 'manual':
      return manualSourceLabel(part.allowance?.allowed_by_name, part.allowance?.reason);
    case 'revoked':
      return 'Manual entry revoked';
    case 'missing':
      return 'Not pulled';
    default:
      return part.source === 'csv' || part.source === 'not_applicable' ? 'Not pulled (entered by hand, not allowed)' : 'Not pulled yet';
  }
}
