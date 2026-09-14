import { supabase } from '@/integrations/supabase/client';

interface CandidateRow {
  id: number;
  case_id: string;
  notice_type: string | null;
}

interface FolderItem {
  notice_id: number;
  folder_section: string | null;
  raw_json: Record<string, unknown> | null;
}

const CLOSURE_SECTIONS = new Set(['CLSR', 'CLOSR', 'CLOSURE']);
const ORDER_SECTIONS = new Set(['ORDRS', 'ORDER', 'ORDERS']);
const REFUND_TYPES = /refund/i;
const LUT_TYPES = /letter of undertaking|lut/i;

function sectionNorm(s: string | null): string {
  return (s || '').trim().toUpperCase();
}

export async function runAutoClose(): Promise<{ closed: number; errors: string[] }> {
  const errors: string[] = [];

  const { data: candidates, error: candErr } = await supabase
    .from('gst_notices')
    .select('id, case_id, notice_type')
    .is('staff_status', null)
    .is('deleted_at', null)
    .not('case_id', 'is', null)
    .limit(2000);

  if (candErr) return { closed: 0, errors: [candErr.message] };
  if (!candidates || candidates.length === 0) return { closed: 0, errors: [] };

  const noticeIds = (candidates as CandidateRow[]).map((r) => r.id);

  const { data: folderItems, error: fiErr } = await supabase
    .from('gst_case_folder_items')
    .select('notice_id, folder_section, raw_json')
    .in('notice_id', noticeIds)
    .is('deleted_at', null);

  if (fiErr) return { closed: 0, errors: [fiErr.message] };

  const sectionsByNotice = new Map<number, Set<string>>();
  (folderItems || []).forEach((fi: FolderItem) => {
    const norm = sectionNorm(fi.folder_section);
    if (!norm) return;
    let s = sectionsByNotice.get(fi.notice_id);
    if (!s) { s = new Set(); sectionsByNotice.set(fi.notice_id, s); }
    s.add(norm);
  });

  const toClose: { id: number; reason: string }[] = [];

  for (const row of candidates as CandidateRow[]) {
    const sections = sectionsByNotice.get(row.id);
    if (!sections) continue;

    const hasClosure = [...sections].some((s) => CLOSURE_SECTIONS.has(s));
    const hasOrder = [...sections].some((s) => ORDER_SECTIONS.has(s));
    const isRefund = REFUND_TYPES.test(row.notice_type || '');
    const isLut = LUT_TYPES.test(row.notice_type || '');

    if (hasClosure) {
      toClose.push({ id: row.id, reason: 'auto:closure' });
    } else if (isRefund && hasOrder) {
      toClose.push({ id: row.id, reason: 'auto:refund_order' });
    } else if (isLut && hasOrder) {
      toClose.push({ id: row.id, reason: 'auto:lut_approval' });
    }
  }

  if (toClose.length === 0) return { closed: 0, errors: [] };

  let closed = 0;
  const BATCH = 50;
  for (let i = 0; i < toClose.length; i += BATCH) {
    const batch = toClose.slice(i, i + BATCH);
    const reasons = new Map<string, number[]>();
    batch.forEach((b) => {
      const arr = reasons.get(b.reason) || [];
      arr.push(b.id);
      reasons.set(b.reason, arr);
    });

    for (const [reason, ids] of reasons) {
      const { error: upErr, count } = await supabase
        .from('gst_notices')
        .update({ staff_status: 'Closed', close_reason: reason })
        .in('id', ids)
        .is('staff_status', null);

      if (upErr) errors.push(upErr.message);
      else closed += count || ids.length;
    }
  }

  return { closed, errors };
}

const NOTICE_SECTIONS = new Set(['INTIM', 'NOTCE', 'NOTICES', 'INTIMATIONS', 'NOTICE/ACKNOWLEDGEMENT', 'NOTAC']);
const DD_MM_YYYY = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseDateToIso(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  const iso = ISO_DATE.exec(v);
  if (iso) return v;
  const m = DD_MM_YYYY.exec(v);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

function extractDueDate(raw: Record<string, unknown> | null): string | null {
  if (!raw) return null;
  const sdtls = raw.sdtls as Record<string, unknown> | undefined;
  if (sdtls?.duedate) return parseDateToIso(sdtls.duedate);
  const dtscn = raw.dtscn as Record<string, unknown> | undefined;
  if (dtscn?.duedate) return parseDateToIso(dtscn.duedate);
  if (raw.duedate) return parseDateToIso(raw.duedate);
  return null;
}

export async function runDueDateSweep(): Promise<{ updated: number; errors: string[] }> {
  const errors: string[] = [];

  const { data: candidates, error: candErr } = await supabase
    .from('gst_notices')
    .select('id, case_id')
    .is('due_date', null)
    .is('deleted_at', null)
    .not('case_id', 'is', null)
    .limit(2000);

  if (candErr) return { updated: 0, errors: [candErr.message] };
  if (!candidates || candidates.length === 0) return { updated: 0, errors: [] };

  const noticeIds = candidates.map((r: { id: number }) => r.id);

  const { data: folderItems, error: fiErr } = await supabase
    .from('gst_case_folder_items')
    .select('notice_id, folder_section, raw_json')
    .in('notice_id', noticeIds)
    .is('deleted_at', null);

  if (fiErr) return { updated: 0, errors: [fiErr.message] };

  const dueDateByNotice = new Map<number, string>();
  (folderItems || []).forEach((fi: FolderItem) => {
    const norm = sectionNorm(fi.folder_section);
    if (!NOTICE_SECTIONS.has(norm)) return;
    const d = extractDueDate(fi.raw_json);
    if (!d) return;
    const existing = dueDateByNotice.get(fi.notice_id);
    if (!existing || d < existing) dueDateByNotice.set(fi.notice_id, d);
  });

  let updated = 0;
  for (const [noticeId, dueDate] of dueDateByNotice) {
    const { error: upErr } = await supabase
      .from('gst_notices')
      .update({ due_date: dueDate })
      .eq('id', noticeId)
      .is('due_date', null);
    if (upErr) errors.push(upErr.message);
    else updated += 1;
  }

  return { updated, errors };
}

export async function runNoticeSweep(): Promise<{ closed: number; dueDatesSet: number; errors: string[] }> {
  const [closeResult, dueResult] = await Promise.all([runAutoClose(), runDueDateSweep()]);
  return {
    closed: closeResult.closed,
    dueDatesSet: dueResult.updated,
    errors: [...closeResult.errors, ...dueResult.errors],
  };
}
