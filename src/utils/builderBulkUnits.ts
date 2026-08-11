/**
 * Pure helpers for bulk unit entry — the numbering expansion and the sheet
 * parser. Kept out of the dialog so both can be exercised directly: a parser
 * that silently mis-reads a carpet area produces a wrong rate on every receipt
 * that unit ever takes, and that is not something to find out at BU.
 */

import type { UnitType } from './builderRates';

export const BULK_UNIT_STATUSES = [
  'Available', 'Booked', 'Cancelled', 'Converted', 'Closed',
] as const;

export interface DraftUnit {
  unit_no: string;
  unit_type: UnitType;
  /** False when the source text didn't clearly say "Residential" or
   *  "Commercial" — a blank or unrecognised cell defaults unit_type to
   *  Residential so the row still has a value to preview, but the row must
   *  be treated as unsaveable until someone confirms it by hand. Silently
   *  guessing here is exactly the mistake that put a Commercial unit on the
   *  1.5% rate in production. */
  unit_type_recognized: boolean;
  carpet_area_sqm: number;
  base_consideration: number;
  status: string;
  group_id: string | null;
}

/**
 * Expand a numbering pattern.
 *
 * `{F}` is the floor, `{N}` the unit index on that floor, `{NN}` the same
 * padded to two digits. So `{F}{NN}` on floor 3, unit 2 gives "302" — the
 * convention nearly every tower in Gujarat uses.
 */
export const expandPattern = (pattern: string, floor: number, n: number): string =>
  (pattern || '{F}{NN}')
    .replace(/\{F\}/g, String(floor))
    .replace(/\{NN\}/g, String(n).padStart(2, '0'))
    .replace(/\{N\}/g, String(n));

/**
 * Amounts arrive from Excel carrying ₹, Indian digit grouping, or both.
 * Anything unparseable becomes 0 rather than NaN, so a stray cell cannot
 * poison a whole batch's arithmetic silently.
 */
export const parseAmount = (s: string): number => {
  const v = parseFloat((s || '').replace(/[₹,\s]/g, ''));
  return Number.isFinite(v) ? v : 0;
};

/**
 * Generate a tower: floors × units per floor, minus any skipped floors.
 * Returns [] rather than a partial list when the inputs do not describe a
 * tower, so the caller's preview stays empty instead of half-right.
 */
export function generateUnits(params: {
  floorFrom: number;
  floorTo: number;
  perFloor: number;
  pattern: string;
  skipFloors?: number[];
  unitType: UnitType;
  carpetAreaSqM: number;
  baseConsideration: number;
  status: string;
  groupId: string | null;
  /** Guard against a typo asking for a hundred thousand rows. */
  maxRows?: number;
}): DraftUnit[] {
  const { floorFrom, floorTo, perFloor } = params;
  if (![floorFrom, floorTo, perFloor].every(Number.isFinite)) return [];
  if (floorTo < floorFrom || perFloor < 1) return [];
  if ((floorTo - floorFrom + 1) * perFloor > (params.maxRows ?? 2000)) return [];

  const skip = new Set(params.skipFloors || []);
  const out: DraftUnit[] = [];
  for (let f = floorFrom; f <= floorTo; f++) {
    if (skip.has(f)) continue;
    for (let n = 1; n <= perFloor; n++) {
      out.push({
        unit_no: expandPattern(params.pattern, f, n),
        unit_type: params.unitType,
        unit_type_recognized: true, // an explicit dropdown choice, never parsed text
        carpet_area_sqm: params.carpetAreaSqM,
        base_consideration: params.baseConsideration,
        status: params.status,
        group_id: params.groupId,
      });
    }
  }
  return out;
}

/**
 * Parse a pasted sheet. Tab- or comma-separated, header row optional.
 *
 * Column order: unit number, type, carpet area (sq m), base consideration,
 * status, group. Only the unit number is required — a client's sheet routinely
 * stops after three columns, and refusing it would send the employee back to
 * one-at-a-time entry, which is the thing this exists to avoid.
 */
export function parsePastedUnits(
  text: string,
  groups: { id: string; name: string }[],
): DraftUnit[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];

  const split = (l: string) => (l.includes('\t') ? l.split('\t') : l.split(',')).map((c) => c.trim());

  // Drop a header row when the first line reads like column labels rather than
  // a unit. Checking for label words beats checking "is cell 1 numeric": plenty
  // of real unit numbers are non-numeric ("A-101", "Shop 4").
  const first = split(lines[0]).map((c) => c.toLowerCase());
  const looksLikeHeader = first.some(
    (c) => /unit|flat|shop|type|carpet|area|consideration|amount|value|status|block|wing|tower|phase/.test(c),
  );
  const body = looksLikeHeader ? lines.slice(1) : lines;

  return body.map((line): DraftUnit => {
    const c = split(line);
    const typeRaw = (c[1] || '').toLowerCase();
    const statusRaw = (c[4] || '').trim();
    const groupRaw = (c[5] || '').trim().toLowerCase();
    // Anything starting with "c" is Commercial, "r" is Residential — covers
    // "Commercial"/"Comm"/"COM" and "Residential"/"Res". A blank or anything
    // else is NOT guessed — defaulting a bare cell to Residential is exactly
    // how a Commercial unit ended up on the 1.5% rate in production, so an
    // unrecognised type is flagged for the preview to block instead.
    const typeRecognized = typeRaw.startsWith('c') || typeRaw.startsWith('r');
    return {
      unit_no: c[0] || '',
      unit_type: typeRaw.startsWith('c') ? 'Commercial' : 'Residential',
      unit_type_recognized: typeRecognized,
      carpet_area_sqm: parseAmount(c[2]),
      base_consideration: parseAmount(c[3]),
      status: BULK_UNIT_STATUSES.find((s) => s.toLowerCase() === statusRaw.toLowerCase())
        || 'Available',
      group_id: groups.find((g) => g.name.toLowerCase() === groupRaw)?.id ?? null,
    };
  }).filter((d) => d.unit_no);
}
