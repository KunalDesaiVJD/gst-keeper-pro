// Master filters for Notices & Litigation (the firm's request of 7 October
// 2026: "master filters required to filter out anything"; and year filters on
// litigation): client, financial year, owner, form and priority, set once in
// the bar under the module's tabs and kept while moving between its pages (the
// tabs carry them). Every list, report and the command centre applies them.
// They live in the URL under the names the notice lists already use, so a
// link reproduces the view.
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fmtFy } from '@/lib/noticeFormat';

export const MASTER_KEYS = ['client', 'fy', 'owner', 'form', 'priority'] as const;
export type MasterKey = (typeof MASTER_KEYS)[number];
export type Master = Partial<Record<MasterKey, string>>;

export function readMaster(sp: URLSearchParams): Master {
  const m: Master = {};
  MASTER_KEYS.forEach((k) => { const v = sp.get(k); if (v) m[k] = v; });
  return m;
}

export const masterCount = (m: Master) => MASTER_KEYS.filter((k) => !!m[k]).length;

/** The pages that apply the master filters (the others, such as Clients, read the same names differently). */
export const MASTER_PAGES = [
  '/notices-dashboard', '/notices-queue', '/notices-all', '/litigation', '/notices-hearings', '/notices-calendar',
  '/notices-report', '/notices-gstin-wise-count', '/litigation-mis',
];

/** A module link that keeps the master filters (its own query string wins on a clash); other pages get none. */
export function hrefWithMaster(to: string, m: Master): string {
  if (!masterCount(m)) return to;
  const [path, query = ''] = to.split('?');
  if (!MASTER_PAGES.includes(path)) return to;
  const sp = new URLSearchParams(query);
  MASTER_KEYS.forEach((k) => { if (m[k] && !sp.has(k)) sp.set(k, m[k] as string); });
  const s = sp.toString();
  return s ? `${path}?${s}` : path;
}

/** The master filters of the page, and setters that keep every other parameter (but the page number). */
export function useMaster() {
  const [sp, setSp] = useSearchParams();
  const m = useMemo(() => readMaster(sp), [sp]);
  const set = useCallback((patch: Master) => {
    const next = new URLSearchParams(sp);
    (Object.keys(patch) as MasterKey[]).forEach((k) => { const v = patch[k]; if (v && v !== 'all') next.set(k, v); else next.delete(k); });
    next.delete('page');
    next.delete('p');
    setSp(next, { replace: true });
  }, [sp, setSp]);
  const clear = useCallback(() => {
    const next = new URLSearchParams(sp);
    MASTER_KEYS.forEach((k) => next.delete(k));
    next.delete('page');
    next.delete('p');
    setSp(next, { replace: true });
  }, [sp, setSp]);
  return { m, set, clear, count: masterCount(m) };
}

// ── Matching ───────────────────────────────────────────────────────────────
/** "2019-2020", "FY 2019-20", "2019/20" all read as "2019-20". */
export const fyKey = (v: string | null | undefined) => (v ? fmtFy(v) || v : '');

export function fyMatches(value: string | string[] | null | undefined, fy: string | undefined): boolean {
  if (!fy) return true;
  const want = fyKey(fy);
  const vals = Array.isArray(value) ? value : value ? [value] : [];
  return vals.some((v) => fyKey(v) === want);
}

export function ownerMatches(ownerId: string | null | undefined, owner: string | undefined, meId: string | null): boolean {
  if (!owner) return true;
  if (owner === 'none') return !ownerId;
  return ownerId === (owner === 'me' ? meId : owner);
}

export function formMatches(form: string | null | undefined | (string | null)[], want: string | undefined): boolean {
  if (!want) return true;
  const vals = Array.isArray(form) ? form : [form];
  return want === 'none' ? vals.every((v) => !v) : vals.some((v) => v === want);
}

/** A notice-shaped row against the master filters (client, FY, owner, form, priority). */
export function noticeMatches(
  n: { client_id?: string | null; financial_year?: string | null; assign_to_user_id?: string | null; form_code?: string | null; effective_priority?: string | null; priority?: string | null },
  m: Master,
  meId: string | null,
): boolean {
  if (m.client && n.client_id !== m.client) return false;
  if (!fyMatches(n.financial_year ?? null, m.fy)) return false;
  if (!ownerMatches(n.assign_to_user_id ?? null, m.owner, meId)) return false;
  if (!formMatches(n.form_code ?? null, m.form)) return false;
  if (m.priority && (n.effective_priority ?? n.priority) !== m.priority) return false;
  return true;
}

/** The filters as the command centre RPC takes them (owner "me" resolved). */
export function masterForRpc(m: Master, meId: string | null): Record<string, string> | null {
  if (!masterCount(m)) return null;
  const out: Record<string, string> = {};
  if (m.client) out.client = m.client;
  if (m.fy) out.fy = fyKey(m.fy);
  if (m.owner) out.owner = m.owner === 'me' ? meId ?? 'none' : m.owner;
  if (m.form) out.form = m.form;
  if (m.priority) out.priority = m.priority;
  return out;
}

/** The ways a financial year is written on record ("2019-20" and "2019-2020"). */
export function fyVariants(fy: string): string[] {
  const k = fyKey(fy);
  const m = /^(\d{4})-(\d{2})$/.exec(k);
  return m ? [k, `${m[1]}-${m[1].slice(0, 2)}${m[2]}`] : [k];
}

// The query builder's type for these views is not worth spelling out.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Q = any;

/** The master filters on a notice_facts / notice_plan query. */
export function applyMasterToQuery(q: Q, m: Master, meId: string | null): Q {
  if (m.client) q = q.eq('client_id', m.client);
  if (m.fy === 'none') q = q.is('financial_year', null);
  else if (m.fy) q = q.in('financial_year', fyVariants(m.fy));
  if (m.owner === 'none') q = q.is('assign_to_user_id', null);
  else if (m.owner === 'me') q = q.eq(meId ? 'assign_to_user_id' : 'id', meId ?? '00000000-0000-0000-0000-000000000000');
  else if (m.owner) q = q.eq('assign_to_user_id', m.owner);
  if (m.form === 'none') q = q.is('form_code', null);
  else if (m.form) q = q.eq('form_code', m.form);
  if (m.priority) q = q.eq('effective_priority', m.priority);
  return q;
}

/** `(to) => to` with the page's master filters added: for links inside a page. */
export function useMasterHref(): (to: string) => string {
  const [sp] = useSearchParams();
  return useCallback((to: string) => hrefWithMaster(to, readMaster(sp)), [sp]);
}
