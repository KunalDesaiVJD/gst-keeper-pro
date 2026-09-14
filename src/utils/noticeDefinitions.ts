import { isClosed } from './noticeSummaryReport';

export interface NoticeBase {
  staff_status: string | null;
  reply_date?: string | null;
  due_date?: string | null;
  extended_due_date?: string | null;
  first_seen_at?: string | null;
}

function todayIST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function effectiveDue(r: NoticeBase): string | null {
  return r.extended_due_date || r.due_date || null;
}

export function isOpen(r: NoticeBase): boolean {
  return !isClosed(r.staff_status);
}

export function isOverdue(r: NoticeBase): boolean {
  if (!isOpen(r)) return false;
  if (r.reply_date) return false;
  const due = effectiveDue(r);
  if (!due) return false;
  return due < todayIST();
}

export function isDueIn7(r: NoticeBase): boolean {
  if (!isOpen(r)) return false;
  const due = effectiveDue(r);
  if (!due) return false;
  const today = todayIST();
  if (due < today) return false;
  const sevenOut = new Date(today);
  sevenOut.setDate(sevenOut.getDate() + 7);
  return due <= sevenOut.toISOString().slice(0, 10);
}

export function isNew(r: NoticeBase): boolean {
  if (!r.first_seen_at) return false;
  return Date.now() - new Date(r.first_seen_at).getTime() < 24 * 60 * 60 * 1000;
}
