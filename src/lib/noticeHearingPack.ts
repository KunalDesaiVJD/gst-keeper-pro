// Hearing pack (the law audit of 26 October 2026, section C): one PDF to carry
// to a personal hearing. It holds the notice and the hearing, the demand head by
// head, the issues with the firm's stand on each, the reply (filed, or the latest
// draft), the papers to carry and a checklist for the day. Built in the browser
// from the notice page's own data; jsPDF loads only when it is asked for.
// §36 of docs/NOTICES_LITIGATION_POSITIONS.md.
import { supabase } from '@/integrations/supabase/client';
import type { Workspace } from '@/lib/noticeWorkspace';
import { demandHeads, HEAD_LABEL, HEADS, payToCloseQuote } from '@/lib/noticePayToClose';

const rs = (n: number | null | undefined) => `Rs. ${Math.round(Number(n || 0)).toLocaleString('en-IN')}`;
const d = (iso: string | null | undefined) => {
  if (!iso) return '';
  const [y, m, day] = iso.slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
};
// The PDF's standard font has no rupee sign or curly quotes.
const plain = (s: string | null | undefined) => (s ?? '').replace(/₹/g, 'Rs. ').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, ', ');

const CARRY = [
  'Letter of authority for the person appearing, on the client\'s letterhead, signed by the authorised signatory',
  'Identity proof of the person appearing, and the client\'s registration certificate',
  'The notice and its annexures, and the reply as filed with its acknowledgement',
  'Every document relied on in the reply, with originals where the officer may ask to see them',
  'A short written note of the points to be argued, to hand over and to be recorded',
  'Where more time is needed: a written request for adjournment with the reason (at most three in the proceeding, s.75(5))',
  'After the hearing: ask that the points made be recorded, and file any further submission the officer allows',
];

export async function downloadHearingPack(ws: Workspace): Promise<void> {
  const [{ default: jsPDF }, { default: autoTable }, { drawFirmLogo }] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'), import('@/utils/reportTheme'),
  ]);
  const n = ws.notice;
  // Papers of the case the AI could not read: the reply and drafts were built without them (P4).
  const unread = n.case_id
    ? await supabase.from('ai_documents').select('title, label, source_ref, status, reason_class')
        .eq('client_id', n.client_id).eq('case_id', n.case_id).in('status', ['failed', 'skipped'])
    : { data: [], error: null };
  const unreadRows = (unread.error ? [] : unread.data ?? []).filter((x) => ['needs_vision', 'not_pdf', 'too_long'].includes(x.reason_class ?? ''));
  // Adjournments granted in the proceeding: at most three (s.75(5)).
  const adjournments = ws.related.filter((r) => r.form_code === 'ADJOURNMENT').length;
  const doc = new jsPDF('p', 'mm', 'a4');
  const W = doc.internal.pageSize.getWidth();
  const M = 14;
  drawFirmLogo(doc, { width: 70, y: 7, align: 'center' });
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text('Hearing pack', W / 2, 30, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text(plain(`${ws.client?.name ?? ''}${ws.client?.gstin ? `  (${ws.client.gstin})` : ''}`), W / 2, 36, { align: 'center' });

  let y = 42;
  const next = () => ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6);
  const head = { fillColor: [30, 41, 59] as [number, number, number], textColor: 255, fontStyle: 'bold' as const, fontSize: 8 };
  const section = (title: string) => {
    if (y > 265) { doc.addPage(); y = 16; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(title, M, y); y += 2;
    doc.setFont('helvetica', 'normal');
  };
  const kv = (rows: [string, string | null | undefined][]) => {
    autoTable(doc, {
      startY: y, theme: 'grid', body: rows.filter(([, v]) => v).map(([k, v]) => [k, plain(v)]),
      bodyStyles: { fontSize: 9 }, columnStyles: { 0: { cellWidth: 48, fontStyle: 'bold' } }, margin: { left: M, right: M },
    });
    y = next();
  };

  section('The hearing');
  kv([
    ['Date', n.hearing_date ? d(n.hearing_date) : 'Not fixed on record'],
    ['Time and place', n.hearing_note],
    ['Officer', n.issued_by],
    ['Adjournments granted', `${adjournments} of the 3 the law allows in a proceeding (s.75(5))`],
  ]);

  section('The notice');
  kv([
    ['Form', n.form_code],
    ['Reference', n.reference_number],
    ['Case ID', n.case_id],
    ['Issued on', d(n.issue_date)],
    ['Reply due', d(n.extended_due_date ?? n.due_date)],
    ['Section', n.section_of_law ? `s.${n.section_of_law}` : null],
    ['Financial year', n.financial_year],
    ['Period', n.period_from ? `${d(n.period_from)} to ${d(n.period_to)}` : null],
    ['Demand', n.amount_of_demand ? rs(n.amount_of_demand) : null],
  ]);

  const dh = demandHeads(n.demand);
  if (Object.keys(dh).length) {
    section('Demand by head');
    autoTable(doc, {
      startY: y, head: [['Head', 'Tax', 'Interest', 'Penalty']],
      body: HEADS.filter((h) => dh[h]).map((h) => [HEAD_LABEL[h], rs(dh[h]!.tax), rs(dh[h]!.interest), rs(dh[h]!.penalty)]),
      headStyles: head, bodyStyles: { fontSize: 9 }, columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
      margin: { left: M, right: M },
    });
    y = next();
  }

  if (ws.issues.length) {
    section('The issues and our stand');
    autoTable(doc, {
      startY: y, head: [['#', 'Issue', 'Amount', 'Our stand', 'Explained']],
      body: ws.issues.map((i, k) => [String(k + 1), plain(i.title + (i.detail ? `\n${i.detail}` : '')), rs(i.amount), plain(i.position), rs(i.explained_amount)]),
      headStyles: head, bodyStyles: { fontSize: 8, valign: 'top' },
      columnStyles: { 0: { cellWidth: 8 }, 1: { cellWidth: 62 }, 2: { halign: 'right', cellWidth: 24 }, 4: { halign: 'right', cellWidth: 24 } },
      margin: { left: M, right: M },
    });
    y = next();
  }

  const q = payToCloseQuote(n);
  if (q) {
    section('If the client chooses to pay and close');
    kv([
      ['Rule', `${q.title} (${q.law})`],
      ['Pay by', q.payBy ? d(q.payBy) : null],
      ['To pay today', `${rs(q.total.total)}: tax ${rs(q.total.tax)}, interest ${rs(q.total.interest_notice + q.total.interest_since)}, penalty ${rs(q.total.penalty)}`],
    ]);
  }

  // The reply: as filed, else the latest draft.
  const draft = ws.drafts.find((x) => x.status === 'approved') ?? ws.drafts.find((x) => x.status !== 'superseded') ?? ws.drafts[0] ?? null;
  section('The reply');
  kv([
    ['Filed on', n.reply_date ? d(n.reply_date) : 'Not filed yet'],
    ['Reference', n.reply_ref_number ?? n.submission_arn],
    ['Text below', draft ? `Version ${draft.version}, ${draft.status}${draft.author_name ? `, by ${draft.author_name}` : ''}` : 'No draft on record'],
  ]);

  const papers: string[][] = [];
  if (n.pdf_url) papers.push(['Notice', plain(`${n.form_code ?? ''} ${n.reference_number ?? ''}`.trim())]);
  for (const m of ws.documents) papers.push([m.kind === 'evidence' ? 'Evidence' : m.kind === 'reply' ? 'Reply' : 'Document', plain(m.title)]);
  for (const f of ws.folder) {
    const raw = (f.raw_json ?? {}) as Record<string, unknown>;
    const name = typeof raw.act_cd === 'string' ? raw.act_cd : f.folder_section ?? 'Case folder item';
    papers.push(['Case folder', plain(`${name}${f.reference_number ? ` ${f.reference_number}` : ''}`)]);
  }
  for (const p of ws.payments) papers.push(['Payment', plain(`${p.kind === 'drc03' ? 'DRC-03' : p.kind === 'pre_deposit' ? 'Pre-deposit' : 'Payment'} ${p.drc03_arn ?? ''} ${rs(p.amount)}${p.paid_on ? ` on ${d(p.paid_on)}` : ''}`)]);
  if (papers.length) {
    section('Papers on record to carry');
    autoTable(doc, { startY: y, head: [['Kind', 'Paper']], body: papers, headStyles: head, bodyStyles: { fontSize: 8 }, columnStyles: { 0: { cellWidth: 28 } }, margin: { left: M, right: M } });
    y = next();
  }

  if (unreadRows.length) {
    section(`Papers the AI could not read · ${unreadRows.length}`);
    autoTable(doc, {
      startY: y, head: [['Paper', 'Why']],
      body: unreadRows.map((u) => [plain(u.title ?? u.label ?? u.source_ref), u.reason_class === 'needs_vision' ? 'A scan' : u.reason_class === 'too_long' ? 'Too long to read whole' : 'Not a PDF']),
      headStyles: head, bodyStyles: { fontSize: 8 }, columnStyles: { 1: { cellWidth: 40 } }, margin: { left: M, right: M },
    });
    y = next();
    doc.setFontSize(8); doc.text('Read these before the hearing: the reply and drafts were prepared without them.', M, y - 2); y += 3;
  }

  section('Checklist for the day');
  autoTable(doc, { startY: y, body: CARRY.map((c) => ['[  ]', c]), theme: 'plain', bodyStyles: { fontSize: 9 }, columnStyles: { 0: { cellWidth: 10 } }, margin: { left: M, right: M } });
  y = next();

  if (draft?.body) {
    doc.addPage();
    y = 16;
    section(`Reply text (version ${draft.version})`);
    y += 4;
    doc.setFontSize(9.5);
    for (const line of doc.splitTextToSize(plain(draft.body), W - 2 * M) as string[]) {
      if (y > 282) { doc.addPage(); y = 16; }
      doc.text(line, M, y); y += 4.6;
    }
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor(120);
    doc.text(plain(`Hearing pack · ${ws.client?.name ?? ''} · ${n.form_code ?? ''} ${n.reference_number ?? ''} · page ${i} of ${pages}`), W / 2, 292, { align: 'center' });
    doc.setTextColor(0);
  }
  doc.save(`Hearing pack ${(ws.client?.name ?? '').replace(/[^\w ]+/g, '')} ${n.reference_number ?? n.id}.pdf`.replace(/\s+/g, ' '));
}
