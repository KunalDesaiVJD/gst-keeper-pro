// Figures that come from a source are the superadmin's to change.
//
// Two kinds of figure in the workings are not typed by staff:
//  - portal data: the GSTR-9 system-computed figures and the as-filed GSTR-3B.
//    Anyone on staff can bring them in (pull or upload); typing over one —
//    which marks its path in PortalDoc.manual — is the superadmin's alone;
//  - figures the working fills in from another table or return, stored as an
//    override field that stays null while the filled-in figure is used.
//
// The database enforces the same list (annual_return_docs_source_lock in
// supabase/migrations/20261002100000_annual_return_source_lock.sql) against
// the role the app declares on save; keep the two in step.

import type { AnnualReturnDocs, DocKey } from './types';

/** The role that may change a locked figure. */
export const SOURCE_EDITOR_ROLE = 'superadmin';

/** The locked fields of each sheet, as dot paths into the doc. */
export const LOCKED_FIELDS: Partial<Record<DocKey, readonly string[]>> = {
  portal: ['manual', 'f'],
  gstr9: ['t6A1', 't6G', 't7.s17_5', 't9Payable', 't12'],
  annexures: ['a3ExcessItc'],
  gstr9c: ['t5A', 't5Q', 't7', 't7F', 't9', 't9Q', 't12A', 't12B', 't12C'],
  notice: ['deemedSupplies', 'unreturnedGoods', 'pendingDemands', 'prevYear8C', 'ineligible4D', 'itcUsed4A5', 'reversed4B2'],
};

/** What a locked figure is, for the messages ("figures from the portal"). */
export const LOCKED_WHAT: Partial<Record<DocKey, string>> = {
  portal: 'figures from the portal (GSTR-9 system-computed, as-filed GSTR-3B)',
  gstr9: 'GSTR-9 figures filled in from the portal, the GSTR-3B or the working',
  annexures: 'Annexure-3 figures filled in from GSTR-9',
  gstr9c: 'GSTR-9C figures filled in from GSTR-9, the audit report or the books',
  notice: 'notice-format figures filled in from GSTR-9, the GSTR-3B or Annexure-4',
};

const at = (doc: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), doc);

/** A value with its null leaves and empty objects removed (undefined when nothing is left), so "not typed" compares equal however it is spelt. */
const strip = (v: unknown): unknown => {
  if (v === null || v === undefined) return undefined;
  if (typeof v !== 'object' || Array.isArray(v)) return v;
  const out: Record<string, unknown> = {};
  Object.keys(v as Record<string, unknown>).sort().forEach((k) => {
    const s = strip((v as Record<string, unknown>)[k]);
    if (s !== undefined) out[k] = s;
  });
  return Object.keys(out).length ? out : undefined;
};

const same = (a: unknown, b: unknown) => JSON.stringify(strip(a)) === JSON.stringify(strip(b));

/** The locked fields (dot paths) a change from `before` to `after` touches; empty when none. */
export function lockedChanges<K extends DocKey>(key: K, before: AnnualReturnDocs[K] | undefined, after: AnnualReturnDocs[K] | undefined): string[] {
  const paths: string[] = [...(LOCKED_FIELDS[key] ?? [])];
  if (key === 'portal') {
    const typed = (d: unknown) => Object.keys((at(d, 'manual') as Record<string, unknown> | undefined) ?? {});
    paths.push(...new Set([...typed(before), ...typed(after)]));
  }
  return paths.filter((p) => !same(at(before, p), at(after, p)));
}

/** The message for a refused change. */
export const lockedMessage = (key: DocKey): string =>
  `Only a superadmin can change ${LOCKED_WHAT[key] ?? 'figures that come from a source'}.`;

/** Tooltips for a locked cell. */
export const LOCKED_TITLE = {
  portal: 'From the portal — locked. Pull or upload to bring in the portal figure; only a superadmin can type over it.',
  filled: 'Filled in by the working — locked. Only a superadmin can type over it.',
} as const;
