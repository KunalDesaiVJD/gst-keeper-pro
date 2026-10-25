// What an appeal filed on the portal says about itself, read from the portal's
// own record of it in My Applications (gst_portal_applications.raw_json,
// appItem.itemJson). An appeal filed but not yet taken up by the appellate
// authority has no notice and no case folder of its own, so this record is
// all the app has of it until the extension reads its case (the firm, 25
// October 2026: "refund is filed for refund case and also it is showing here
// but it is not opening ... no documents ... not linked with any refund").
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { PortalApplication } from '@/lib/autopilot';
import { caseHref, noticeCaseHref } from '@/lib/noticeCases';
import { fmtDate, fmtInrShort } from '@/lib/noticeFormat';
import { periodText } from '@/components/notices/reports/refundModel';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
/** "11/09/2025" or "11-09-2025" → "2025-09-11". */
const isoOf = (v: unknown): string | null => {
  const m = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(str(v) ?? '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const total = (heads: unknown, key: 'tot' | 'tx' = 'tot'): number | null => {
  const t = num(obj(obj(heads).total)[key]);
  if (t !== null) return t;
  const sum = ['igst', 'cgst', 'sgst', 'cess'].reduce((s, h) => s + (num(obj(obj(heads)[h]).tot ?? obj(obj(heads)[h]).tax) ?? 0), 0);
  return sum || null;
};

const ORDER_TYPES: Record<string, string> = {
  RFDOR: 'refund order', DMDOR: 'demand order', ADJOR: 'adjudication order', REGOR: 'registration order', ASMTOR: 'assessment order',
};

export interface PortalAppealDoc { id: string; name: string }
export interface PortalAppeal {
  arn: string | null;
  form: string;
  status: string | null;
  filedOn: string | null;
  /** The order appealed against. */
  order: { ref: string | null; kind: string | null; date: string | null; communicated: string | null };
  /** The period the order is about (YYYY-MM). */
  period: { from: string | null; to: string | null };
  disputed: number | null;
  preDeposit: number | null;
  /** For an appeal against a refund order: the refund claimed and what the order granted. */
  refundClaimed: number | null;
  refundGranted: number | null;
  issues: string[];
  /** The files the portal lists with the appeal (APL-01, grounds, annexures). */
  docs: PortalAppealDoc[];
  signedBy: string | null;
  authority: string | null;
}

export function parsePortalAppeal(a: Pick<PortalApplication, 'arn' | 'form_number' | 'form_description' | 'status' | 'filed_date' | 'raw_json'>): PortalAppeal {
  const raw = obj(a.raw_json);
  const item = obj(raw.appItem);
  let j: Obj = {};
  try { j = obj(typeof item.itemJson === 'string' ? JSON.parse(item.itemJson) : item.itemJson); } catch { j = {}; }
  const od = obj(j.orddtl);
  const per = obj(od.prdofdisp);
  const from = isoOf(per.fromdate);
  const to = isoOf(per.todate);
  const docs: PortalAppealDoc[] = [];
  const seen = new Set<string>();
  const add = (d: unknown, fallback: string) => {
    const o = obj(d);
    const id = str(o.id);
    if (!id || seen.has(id)) return;
    seen.add(id);
    docs.push({ id, name: str(o.docname) ?? str(o.docName) ?? str(o.name) ?? fallback });
  };
  add(j.docappeal, 'Appeal (APL-01)');
  add(j.docannexure, 'Grounds of appeal');
  (Array.isArray(j.docothers) ? j.docothers : []).forEach((d) => add(d, 'Annexure'));
  const auth = obj(j.authdtls);
  const ordType = str(od.ordtyp);
  return {
    arn: a.arn,
    form: a.form_number ?? 'GST APL-01',
    status: a.status ?? str(raw.statusDesc),
    filedOn: a.filed_date ?? isoOf(auth.dt),
    order: {
      ref: str(od.ordnum) ?? str(od.dmdid) ?? str(item.refId),
      kind: ordType ? ORDER_TYPES[ordType] ?? ordType : null,
      date: isoOf(od.orddt),
      communicated: isoOf(od.ordcommdt),
    },
    period: { from: from ? from.slice(0, 7) : null, to: to ? to.slice(0, 7) : null },
    disputed: total(od.dispamt),
    preDeposit: total(od.predepositamt),
    refundClaimed: total(od.refundclaimed),
    refundGranted: total(od.refundgranted),
    issues: (Array.isArray(j.issuecat) ? j.issuecat : []).map((x) => str(obj(x).desc)).filter((x): x is string => !!x),
    docs,
    signedBy: [str(auth.auth), str(auth.authdesig)?.toLowerCase()].filter(Boolean).join(', ') || null,
    authority: str(raw.apprAuth) === 'STATE' ? 'State appellate authority' : str(raw.apprAuth) === 'CENTRE' ? 'Central appellate authority' : null,
  };
}

// ── The client's applications, each with where it belongs ─────────────────
type AppRow = Pick<PortalApplication, 'id' | 'case_type_cd' | 'arn' | 'form_number' | 'form_description' | 'status' | 'filed_date' | 'last_seen_at' | 'raw_json'>;

/** Where an application belongs: the refund it is against, or the case of the order. */
export interface AppealTarget { kind: 'refund' | 'case'; key: string; href: string }
/** files: the appeal's own files downloaded from its case folder (extension 0.18.5), by the portal's name. */
export interface PortalApp { row: AppRow; appeal: PortalAppeal | null; target: AppealTarget | null; files: { label: string; url: string }[] }

async function loadPortalApps(clientId: string): Promise<PortalApp[]> {
  const { data, error } = await supabase.from('gst_portal_applications')
    .select('id, case_type_cd, arn, form_number, form_description, status, filed_date, last_seen_at, raw_json')
    .eq('client_id', clientId).is('deleted_at', null);
  if (error) throw error;
  const rows = (data ?? []) as AppRow[];
  if (!rows.length) return [];
  const appeals = rows.map((r) => (r.case_type_cd === 'APPEL' ? parsePortalAppeal(r) : null));
  const arns = rows.map((r) => r.arn).filter((a): a is string => !!a);
  const refs = appeals.map((a) => a?.order.ref).filter((x): x is string => !!x);
  const [links, refunds, cases, notices, folder] = await Promise.all([
    supabase.from('notice_case_links').select('child_key, parent_key').eq('client_id', clientId).in('child_key', arns.length ? arns : ['-']),
    supabase.from('gst_refund_applications').select('arn, documents').eq('client_id', clientId).is('deleted_at', null),
    supabase.from('notice_cases_flat').select('case_key').eq('client_id', clientId),
    supabase.from('notice_facts').select('id, client_id, case_id, category, reference_number').eq('client_id', clientId)
      .in('reference_number', refs.length ? refs : ['-']),
    supabase.from('gst_case_folder_items').select('case_id, attachments').eq('client_id', clientId).is('deleted_at', null)
      .in('case_id', arns.length ? arns : ['-']),
  ]);
  const filesOf = new Map<string, { label: string; url: string }[]>();
  for (const it of (folder.data ?? []) as { case_id: string; attachments: unknown }[]) {
    const list = Array.isArray(it.attachments) ? (it.attachments as { label?: string; url?: string }[]) : [];
    const ok = list.filter((x) => typeof x?.url === 'string').map((x) => ({ label: x.label || 'Document', url: x.url as string }));
    if (ok.length) filesOf.set(it.case_id, [...(filesOf.get(it.case_id) ?? []), ...ok]);
  }
  const parentOf = new Map(((links.data ?? []) as { child_key: string; parent_key: string }[]).map((l) => [l.child_key, l.parent_key]));
  const refundRows = (refunds.data ?? []) as { arn: string | null; documents: unknown }[];
  const refundArns = new Set(refundRows.map((r) => r.arn).filter(Boolean) as string[]);
  const caseKeys = new Set(((cases.data ?? []) as { case_key: string }[]).map((c) => c.case_key));
  const noticeByRef = new Map(((notices.data ?? []) as { id: string; client_id: string; case_id: string | null; category: string | null; reference_number: string | null }[])
    .map((n) => [n.reference_number as string, n]));
  // A refund whose own papers carry the order's number (its RFD-06 file is named after it).
  const refundByOrder = (ref: string) => refundRows.find((r) => r.arn && JSON.stringify(r.documents ?? '').includes(ref))?.arn ?? null;

  return rows.map((row, i) => {
    const appeal = appeals[i];
    const parent = row.arn ? parentOf.get(row.arn) : undefined;
    const ref = appeal?.order.ref ?? null;
    let target: AppealTarget | null = null;
    if (parent && refundArns.has(parent)) target = { kind: 'refund', key: parent, href: `/refunds/${clientId}/${encodeURIComponent(parent)}` };
    else if (parent && caseKeys.has(parent)) target = { kind: 'case', key: parent, href: caseHref(clientId, parent) };
    else if (ref && refundByOrder(ref)) {
      const arn = refundByOrder(ref) as string;
      target = { kind: 'refund', key: arn, href: `/refunds/${clientId}/${encodeURIComponent(arn)}` };
    } else if (ref && noticeByRef.has(ref)) {
      const n = noticeByRef.get(ref)!;
      target = { kind: 'case', key: n.case_id ?? ref, href: noticeCaseHref(n) };
    }
    const files = [...new Map((row.arn ? filesOf.get(row.arn) ?? [] : []).map((f) => [f.url, f])).values()];
    return { row, appeal, target, files };
  });
}

export const usePortalApps = (clientId: string | null | undefined) =>
  useQuery({ queryKey: ['portal-applications', clientId], enabled: !!clientId, queryFn: () => loadPortalApps(clientId as string), staleTime: 60_000 });

/** "against refund order ZD… of 11 Sep 2025 · Apr–Jun 2025 · ₹8.00 L in dispute". */
export function appealLine(a: PortalAppeal): string {
  const per = a.period.from ? periodText(a.period.from, a.period.to) : null;
  return [
    a.order.ref ? `against ${a.order.kind ?? 'order'} ${a.order.ref}${a.order.date ? ` of ${fmtDate(a.order.date)}` : ''}` : null,
    per,
    a.disputed ? `${fmtInrShort(a.disputed)} in dispute` : null,
  ].filter(Boolean).join(' · ');
}

