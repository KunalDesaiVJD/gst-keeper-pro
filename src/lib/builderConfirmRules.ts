// Pure rules of the BU agreement value confirmation (no Supabase here, so
// scripts/verify-bu-confirm.mjs can run them): which typed addresses are
// valid, which are the firm's own, which units the pop-up still offers, and
// what the public page's "Confirm all" covers. The database holds the same
// address rules (supabase/migrations/20261021140000_bu_confirm_cc.sql:
// builder_bu_confirm_email_ok, builder_bu_confirm_is_staff).

/** The firm's domain: its addresses may get a copy but never answer. */
export const FIRM_DOMAIN = 'vjdesai.com';

/** One e-mail address: a dot-atom local part (no leading, trailing or doubled
 *  dot) and a domain of labels made of letters, digits and inner hyphens.
 *  The database checks the same pattern (builder_bu_confirm_email_ok). */
export const EMAIL_RE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z][A-Za-z0-9-]{0,61}[A-Za-z0-9]$/;

export const emailOk = (a: string): boolean =>
  a.length <= 254 && a.split('@')[0].length <= 64 && EMAIL_RE.test(a);

/** The firm's own address (its domain or a subdomain). The database also
 *  counts every staff member's profile e-mail. */
export const isFirmAddress = (a: string): boolean => {
  const domain = a.trim().toLowerCase().split('@')[1] || '';
  return domain === FIRM_DOMAIN || domain.endsWith(`.${FIRM_DOMAIN}`);
};

/** Split on commas, semicolons and new lines that are not inside quotes. */
const splitParts = (text: string): string[] => {
  const parts: string[] = [];
  let cur = '';
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && (ch === ',' || ch === ';' || ch === '\n' || ch === '\r')) {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  parts.push(cur);
  return parts;
};

/**
 * Addresses typed or pasted into a To or CC box: separated by commas,
 * semicolons, new lines or spaces. "Name <address>" (as Outlook copies it,
 * the name quoted or not) gives the address inside the angle brackets.
 * Trimmed, lower case, each once, in the order typed.
 */
export function parseEmailList(text: string): { valid: string[]; invalid: string[] } {
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const part of splitParts(text || '')) {
    const bracket = /<([^<>]*)>/.exec(part);
    const tokens = bracket ? [bracket[1]] : part.split(/\s+/);
    for (const raw of tokens) {
      const a = raw.trim().replace(/^<|>$/g, '').toLowerCase();
      if (!a || seen.has(a)) continue;
      seen.add(a);
      (emailOk(a) ? valid : invalid).push(a);
    }
  }
  return { valid, invalid };
}

/** A unit's confirmation status as the pop-up and the BU Events page read it. */
export type ConfirmStatus = 'PENDING' | 'CONFIRMED' | 'DISPUTED' | 'OVERRIDDEN' | 'NOT_SENT';

export const isClearedStatus = (s: ConfirmStatus | undefined): boolean => s === 'CONFIRMED' || s === 'OVERRIDDEN';

interface FreshRow {
  unitId: string;
  status: ConfirmStatus;
  disputeNotes?: string | null;
  respondedByName?: string | null;
}

/**
 * The units the pop-up offers, from the page's list and the statuses read
 * again when the pop-up opened (or after a send found a unit answered): a unit
 * confirmed or accepted since the page loaded is left out, and every other
 * unit shows its status as it is now. fresh null: not read yet, the page's list
 * as it is.
 */
export function freshCandidates<T extends FreshRow>(candidates: T[], fresh: FreshRow[] | null): T[] {
  if (!fresh) return candidates;
  const now = new Map(fresh.map((f) => [f.unitId, f]));
  return candidates
    .filter((c) => !isClearedStatus(now.get(c.unitId)?.status))
    .map((c) => {
      const f = now.get(c.unitId);
      return {
        ...c,
        status: f?.status ?? 'NOT_SENT',
        disputeNotes: f?.disputeNotes ?? null,
        respondedByName: f?.respondedByName ?? null,
      };
    });
}

/** A unit as the public page shows it. */
export type PageUnitState = 'PENDING' | 'CONFIRMED' | 'DISPUTED' | 'ACCEPTED' | 'REPLACED';

/**
 * What "Confirm all" on the public page covers: the open units, leaving out
 * any whose dispute box is open (the reader is writing a dispute for it, and
 * a confirmation cannot be undone).
 */
export function confirmAllTargets(units: { unit_id: string; state: PageUnitState }[], disputing: Iterable<string>): string[] {
  const open = new Set(disputing);
  return units.filter((u) => u.state === 'PENDING' && !open.has(u.unit_id)).map((u) => u.unit_id);
}

/** The page's summary line and total. */
export function pageSummary(units: { state: PageUnitState; agreement_value: number }[]): {
  open: number;
  replaced: number;
  /** No open unit, nothing replaced: every unit here has an answer. */
  allAnswered: boolean;
  /** No open unit, some replaced: the rest were asked again in a newer e-mail. */
  restReplaced: boolean;
  allReplaced: boolean;
  total: number;
  totalLabel: string;
} {
  const open = units.filter((u) => u.state === 'PENDING').length;
  const replaced = units.filter((u) => u.state === 'REPLACED').length;
  const total = units.filter((u) => u.state !== 'REPLACED').reduce((a, u) => a + (Number(u.agreement_value) || 0), 0);
  return {
    open,
    replaced,
    allAnswered: open === 0 && replaced === 0 && units.length > 0,
    restReplaced: open === 0 && replaced > 0 && replaced < units.length,
    allReplaced: units.length > 0 && replaced === units.length,
    total,
    totalLabel: replaced > 0 ? 'Total of units still on this link' : 'Total',
  };
}
