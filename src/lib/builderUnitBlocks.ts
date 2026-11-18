/**
 * The block (wing / tower) a builder unit belongs to, for picking a whole
 * block at once (BU Working). The unit's group when the project has groups
 * (builder_project_groups); otherwise the short prefix of the unit number
 * before its first "-" ("A-0201" → "A", "C - 0001" → "C"). A unit number with
 * no such prefix ("Plot No. 001", "Shed No.-001") has no block.
 */
export function unitBlock(
  unit: { unit_no: string; group_id?: string | null },
  groupNames: Map<string, string>,
): string | null {
  if (unit.group_id && groupNames.has(unit.group_id)) return groupNames.get(unit.group_id) ?? null;
  const m = /^\s*([A-Za-z0-9]{1,3})\s*-/.exec(unit.unit_no || '');
  return m && /[A-Za-z]/.test(m[1]) ? m[1].toUpperCase() : null;
}

export interface UnitBlockGroup<T> {
  /** null: the units with no block. */
  block: string | null;
  units: T[];
}

/** Units in their blocks, blocks in first-seen order, units without a block last. */
export function groupUnitsByBlock<T extends { unit_no: string; group_id?: string | null }>(
  units: T[],
  groupNames: Map<string, string>,
): UnitBlockGroup<T>[] {
  const byBlock = new Map<string | null, T[]>();
  for (const u of units) {
    const b = unitBlock(u, groupNames);
    if (!byBlock.has(b)) byBlock.set(b, []);
    byBlock.get(b)!.push(u);
  }
  const out: UnitBlockGroup<T>[] = [];
  for (const [block, list] of byBlock) if (block !== null) out.push({ block, units: list });
  if (byBlock.has(null)) out.push({ block: null, units: byBlock.get(null)! });
  return out;
}
