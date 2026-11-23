// Builder clients: the project's final Rule 42/43 reversal at completion, as
// approved on Builder › ITC Reversal (carpet area, src/utils/builderItcReversal.ts),
// read into the Annual Return of the year whose GSTR-3B carries it (the
// working's posting period). Pure: the store below loads, the engine adds.
// docs/GSTR9_9C_WORKINGS.md §6 position 42.

import type { Tax } from './types';

export interface BuilderReversalWorking {
  id: string;
  project: string;
  completionDate: string;
  postingPeriod: string;
  approvedAt: string | null;
  /** Σ over the project's years of the net Rule 42 / Rule 43 figure (positive = reverse, negative = re-credit). */
  r42: Tax;
  r43: Tax;
  interest: Tax;
}

export interface BuilderReversalYear {
  workings: BuilderReversalWorking[];
  /** Positive parts: into 7C / 7D, and already reversed in the posting period's 4(B)(1). */
  r42: Tax;
  r43: Tax;
  /** Negative parts: re-credited in 4(A)(5) (GSTR-9 6H), shown, never netted. */
  recredit: Tax;
  interest: Tax;
}

const T = (i = 0, c = 0, s = 0, x = 0): Tax => ({ i, c, s, x });
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const add = (...xs: Tax[]): Tax => xs.reduce((a, b) => T(r2(a.i + b.i), r2(a.c + b.c), r2(a.s + b.s), r2(a.x + b.x)), T());
const pos = (a: Tax): Tax => T(Math.max(0, a.i), Math.max(0, a.c), Math.max(0, a.s), Math.max(0, a.x));
const neg = (a: Tax): Tax => T(Math.max(0, -a.i), Math.max(0, -a.c), Math.max(0, -a.s), Math.max(0, -a.x));

/** "MM/YYYY" → "2025-26". */
export const fyOfPeriod = (p: string): string | null => {
  const m = /^(\d{2})\/(\d{4})$/.exec(p ?? '');
  if (!m) return null;
  const y = Number(m[2]) - (Number(m[1]) < 4 ? 1 : 0);
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
};

export const emptyBuilderReversal = (): BuilderReversalYear => ({ workings: [], r42: T(), r43: T(), recredit: T(), interest: T() });

/** The approved workings posted in `fy`, summed. */
export function summariseBuilderReversal(all: BuilderReversalWorking[], fy: string): BuilderReversalYear {
  const workings = all.filter((w) => fyOfPeriod(w.postingPeriod) === fy);
  const r42 = add(...workings.map((w) => w.r42));
  const r43 = add(...workings.map((w) => w.r43));
  return { workings, r42: pos(r42), r43: pos(r43), recredit: add(neg(r42), neg(r43)), interest: add(...workings.map((w) => w.interest)) };
}
