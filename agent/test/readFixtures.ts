// Made-up notices for the notice reader's tests: a DRC-01-style show cause
// notice drawn with pdf-lib (text layer, a demand table), a "scan" (graphics
// only, no text), and the reading a model would return for each — every quote
// in it is text the PDF really carries. All names, GSTINs, references and
// amounts are fictional (GSTINs like 24AAAAA0000A1Z5: no PAN has 0000).
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { ReadingOut } from '../src/read/schema.js';

export interface NoticeSpec {
  gstin: string;
  name: string;
  ref: string;
}

type Cell = { x: number; text: string };
type Line = string | Cell[];

const zero = { tax: 0, interest: 0, penalty: 0, fee: 0, others: 0 };

export function drc01Pages(s: NoticeSpec): Line[][] {
  return [
    [
      'FORM GST DRC-01',
      '[See rule 142(1)(a)]',
      'Summary of Show Cause Notice',
      `Reference No.: ${s.ref}    Date: 01/10/2026`,
      'DIN: 20261001TEST000123',
      'To,',
      `GSTIN: ${s.gstin}`,
      `Name: ${s.name}`,
      'Address: 12, Test Market, Ahmedabad 380001',
      'Tax Period: April 2019 to March 2020    F.Y. 2019-20',
      'Act: CGST Act, 2017 and GGST Act, 2017',
      'Section under which the notice is issued: Section 73(1)',
      'Brief facts of the case',
      '1. Short payment of tax on outward supplies: the liability declared in GSTR-1',
      'exceeds the tax paid in GSTR-3B. Tax of Rs. 50,000 (CGST 25,000 and SGST',
      '25,000) is short paid.',
      '2. Excess input tax credit: the credit claimed in GSTR-3B exceeds the credit',
      'in GSTR-2A by Rs. 1,00,000 (CGST 50,000 and SGST 50,000).',
    ],
    [
      'Details of demand (amount in Rs.)',
      [{ x: 40, text: 'Act' }, { x: 120, text: 'Tax' }, { x: 200, text: 'Interest' }, { x: 280, text: 'Penalty' }, { x: 360, text: 'Fee' }, { x: 420, text: 'Others' }, { x: 490, text: 'Total' }],
      [{ x: 40, text: 'CGST' }, { x: 120, text: '75,000' }, { x: 200, text: '13,500' }, { x: 280, text: '7,500' }, { x: 360, text: '0' }, { x: 420, text: '0' }, { x: 490, text: '96,000' }],
      [{ x: 40, text: 'SGST' }, { x: 120, text: '75,000' }, { x: 200, text: '13,500' }, { x: 280, text: '7,500' }, { x: 360, text: '0' }, { x: 420, text: '0' }, { x: 490, text: '96,000' }],
      [{ x: 40, text: 'Total' }, { x: 120, text: '1,50,000' }, { x: 200, text: '27,000' }, { x: 280, text: '15,000' }, { x: 360, text: '0' }, { x: 420, text: '0' }, { x: 490, text: '1,92,000' }],
      'You are directed to file your reply in FORM GST DRC-06 on or before 31/10/2026.',
      'Personal hearing: 05/11/2026 at 11:00 AM',
      'Venue: Room No. 5, GST Bhavan, Ahmedabad',
      'Documents to be produced: copies of invoices for April 2019 to March 2020;',
      'the electronic credit ledger for 2019-20.',
      'Issued by: R. K. Testofficer, Assistant Commissioner, Ghatak 99, Ahmedabad',
    ],
  ];
}

export async function buildPdf(pages: Line[][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = doc.addPage([595, 842]);
    lines.forEach((line, i) => {
      const y = 800 - i * 18;
      if (typeof line === 'string') page.drawText(line, { x: 40, y, size: 10, font });
      else for (const c of line) page.drawText(c.text, { x: c.x, y, size: 10, font });
    });
  }
  return doc.save();
}

export const noticePdf = (s: NoticeSpec) => buildPdf(drc01Pages(s));

// A "scan": the page is graphics only, nothing in the text layer.
export async function scanPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  for (let i = 0; i < 30; i++) page.drawRectangle({ x: 40, y: 780 - i * 22, width: 300 + (i % 5) * 40, height: 8, color: rgb(0.2, 0.2, 0.2) });
  return doc.save();
}

// Several pages, for the page limit.
export async function longPdf(n: number): Promise<Uint8Array> {
  return buildPdf(Array.from({ length: n }, (_, i) => [`Page ${i + 1} of a long annexure to a notice, with enough text to count as a text layer.`]));
}

const f = (value: string, page: number, quote: string) => ({ value, page, quote });
const none = { value: '', page: 0, quote: '' };

// What the model returns for noticePdf(s), quotes copied from the PDF's text.
export function noticeReading(s: NoticeSpec): ReadingOut {
  return {
    gstin: f(s.gstin, 1, `GSTIN: ${s.gstin}`),
    form_code: f('FORM GST DRC-01', 1, 'FORM GST DRC-01'),
    reference_number: f(s.ref, 1, `Reference No.: ${s.ref}`),
    din: f('20261001TEST000123', 1, 'DIN: 20261001TEST000123'),
    issue_date: f('2026-10-01', 1, 'Date: 01/10/2026'),
    section_of_law: f('Section 73(1)', 1, 'Section under which the notice is issued: Section 73(1)'),
    financial_year: f('2019-20', 1, 'F.Y. 2019-20'),
    period_from: f('2019-04-01', 1, 'Tax Period: April 2019 to March 2020'),
    period_to: f('2020-03-31', 1, 'Tax Period: April 2019 to March 2020'),
    due_date: f('2026-10-31', 2, 'file your reply in FORM GST DRC-06 on or before 31/10/2026'),
    hearing_date: f('2026-11-05', 2, 'Personal hearing: 05/11/2026 at 11:00 AM'),
    hearing_time: f('11:00 AM', 2, 'Personal hearing: 05/11/2026 at 11:00 AM'),
    hearing_venue: f('Room No. 5, GST Bhavan, Ahmedabad', 2, 'Venue: Room No. 5, GST Bhavan, Ahmedabad'),
    officer: f('R. K. Testofficer, Assistant Commissioner, Ghatak 99, Ahmedabad', 2,
      'Issued by: R. K. Testofficer, Assistant Commissioner, Ghatak 99, Ahmedabad'),
    demand: {
      stated: true,
      igst: { ...zero },
      cgst: { tax: 75000, interest: 13500, penalty: 7500, fee: 0, others: 0 },
      sgst: { tax: 75000, interest: 13500, penalty: 7500, fee: 0, others: 0 },
      cess: { ...zero },
      page: 2,
      quote: 'Total 1,50,000 27,000 15,000 0 0 1,92,000',
    },
    issues: [
      {
        issue_code: 'LIAB_GSTR1_V_3B',
        title: 'Short payment of tax: GSTR-1 higher than GSTR-3B',
        detail: 'Liability declared in GSTR-1 exceeds the tax paid in GSTR-3B for 2019-20.',
        period_from: '2019-04-01',
        period_to: '2020-03-31',
        demand: { igst: { ...zero }, cgst: { ...zero, tax: 25000 }, sgst: { ...zero, tax: 25000 }, cess: { ...zero } },
        amount: 50000,
        page: 1,
        para: '1',
        quote: 'Tax of Rs. 50,000 (CGST 25,000 and SGST 25,000) is short paid.',
      },
      {
        issue_code: 'ITC_2A_V_3B',
        title: 'Excess input tax credit over GSTR-2A',
        detail: 'Credit claimed in GSTR-3B exceeds the credit in GSTR-2A.',
        period_from: '2019-04-01',
        period_to: '2020-03-31',
        demand: { igst: { ...zero }, cgst: { ...zero, tax: 50000 }, sgst: { ...zero, tax: 50000 }, cess: { ...zero } },
        amount: 100000,
        page: 1,
        para: '2',
        quote: 'the credit claimed in GSTR-3B exceeds the credit in GSTR-2A by Rs. 1,00,000 (CGST 50,000 and SGST 50,000).',
      },
    ],
    documents_asked: ['Copies of invoices for April 2019 to March 2020', 'Electronic credit ledger for 2019-20'],
    summary: 'A DRC-01 summary of a show cause notice under section 73(1) for 2019-20 demanding Rs. 1,92,000. It alleges short payment of tax and excess input tax credit. A reply is due by 31 October 2026, with a hearing on 5 November 2026.',
  };
}

export const emptyField = () => ({ ...none });
