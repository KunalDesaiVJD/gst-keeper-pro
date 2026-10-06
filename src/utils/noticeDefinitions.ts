// Readers for the canonical notice flags. The definitions themselves live in
// the database view public.notice_facts (docs/NOTICES_LITIGATION_POSITIONS.md
// §2); a row loaded through lib/noticeFacts always carries them. The plain
// computations below are only for a row that does not (a stale shape), and
// match the view: dates are IST calendar dates, and a replied notice is
// neither overdue nor "due in 7 days".
import { isClosed } from './noticeSummaryReport';
import { istToday, daysBetween } from '@/lib/noticeFacts';

export interface NoticeBase {
  staff_status: string | null;
  reply_date?: string | null;
  due_date?: string | null;
  extended_due_date?: string | null;
  first_seen_at?: string | null;
  is_open?: boolean | null;
  is_overdue?: boolean | null;
  is_due_in_7?: boolean | null;
  is_new?: boolean | null;
  effective_due?: string | null;
}

const flag = (v: boolean | null | undefined): boolean | undefined => (typeof v === 'boolean' ? v : undefined);

export function effectiveDue(r: NoticeBase): string | null {
  return r.effective_due ?? r.extended_due_date ?? r.due_date ?? null;
}

export function isOpen(r: NoticeBase): boolean {
  return flag(r.is_open) ?? !isClosed(r.staff_status);
}

export function isOverdue(r: NoticeBase): boolean {
  const f = flag(r.is_overdue);
  if (f !== undefined) return f;
  if (!isOpen(r) || r.reply_date) return false;
  const due = effectiveDue(r);
  return !!due && daysBetween(istToday(), due) < 0;
}

export function isDueIn7(r: NoticeBase): boolean {
  const f = flag(r.is_due_in_7);
  if (f !== undefined) return f;
  if (!isOpen(r) || r.reply_date) return false;
  const due = effectiveDue(r);
  if (!due) return false;
  const d = daysBetween(istToday(), due);
  return d >= 0 && d <= 7;
}

export function isNew(r: NoticeBase): boolean {
  const f = flag(r.is_new);
  if (f !== undefined) return f;
  if (!r.first_seen_at) return false;
  return Date.now() - new Date(r.first_seen_at).getTime() < 24 * 60 * 60 * 1000;
}
