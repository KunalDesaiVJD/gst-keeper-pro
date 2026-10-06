// The notice reader's checks (src/read/checks.ts) and the mapping of a reading
// to what notice_read_finish takes (src/read/result.ts). Pure: page texts are
// plain strings here; the PDF tests read the same text from real PDFs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  amountInText, amountsIn, checkQuote, dateInText, dateOrderCheck, DocText, fyInText, gstinCheck, monthInText, normText,
  periodInText, squash, sumsCheck, valueInText, wordsInOrder, words,
} from '../src/read/checks.js';
import { buildResult, monthEnd, monthStart, normFormCode, normFy, normSection } from '../src/read/result.js';
import { coerceReading, OUTPUT_SCHEMA, type HeadsOut } from '../src/read/schema.js';
import type { Json } from './fakeAnthropic.js';
import { drc01Pages, noticeReading } from './readFixtures.js';

const SPEC = { gstin: '24AAAAA0000A1Z5', name: 'Navkar Test Traders', ref: 'ZD2410260012345' };
// The fixture's text as pdf.js gives it (cells joined with spaces).
const PAGES = drc01Pages(SPEC).map((lines) => lines.map((l) => (typeof l === 'string' ? l : l.map((c) => c.text).join(' '))).join('\n'));
const CLAIM = {
  client_gstin: SPEC.gstin, issue_date: '2026-10-01', form_code: 'DRC-01', reference_number: SPEC.ref,
  issue_codes: [{ code: 'LIAB_GSTR1_V_3B', title: 'Output tax' }, { code: 'ITC_2A_V_3B', title: 'ITC v 2A' }, { code: 'OTHER', title: 'Other' }],
};
const doc = (textLayer = true) => ({ pages: PAGES, pageCount: PAGES.length, textLayer, sha256: 'ab'.repeat(32) });
const zero = { tax: 0, interest: 0, penalty: 0, fee: 0, others: 0 };
const heads = (p: Partial<Record<keyof HeadsOut, Partial<typeof zero>>>): HeadsOut => ({
  igst: { ...zero, ...p.igst }, cgst: { ...zero, ...p.cgst }, sgst: { ...zero, ...p.sgst }, cess: { ...zero, ...p.cess },
});

// ── Normalising ────────────────────────────────────────────────────────────
test('normText: case, Unicode forms, dashes, quotes, spaces and Indian digit grouping', () => {
  assert.equal(normText('  FORM GST  DRC\u201301 \u2014 \u201cShow\u201d\u00a0Cause '), 'form gst drc-01 - "show" cause');
  assert.equal(normText('Rs. 1,23,456.00 and 123,456'), 'rs. 123456.00 and 123456');
  assert.equal(normText('\ufb01nal o\u00adrder'), 'final order', 'ligature and soft hyphen');
  assert.equal(normText('Tax\tPeriod\n\nApril'), 'tax period april');
});

test('squash and words keep letters, marks and digits only', () => {
  assert.equal(squash('Section 74 (1) of the CGST Act, 2017'), 'section741ofthecgstact2017');
  assert.equal(squash('assess-\nment'), 'assessment');
  assert.deepEqual(words('GSTIN: 24AAAAA0000A1Z5; Rs.1,00,000/-'), ['gstin', '24aaaaa0000a1z5', 'rs', '100000']);
  assert.equal(squash('कर नोटिस'), 'करनोटिस', 'Devanagari vowel signs are kept');
});

// ── Quotes ─────────────────────────────────────────────────────────────────
test('a quote is found on its page despite spacing, line breaks, case and grouping', () => {
  const d = new DocText(PAGES, true);
  assert.deepEqual(d.findQuote('Tax of Rs. 50,000 (CGST 25,000 and SGST 25,000) is short paid.', 1), { found: true, page: 1, how: 'exact' });
  assert.deepEqual(d.findQuote('tax  of rs.50000 (cgst 25000 and sgst 25000) is SHORT paid', 1), { found: true, page: 1, how: 'exact' });
  assert.deepEqual(d.findQuote('TOTAL 1,50,000 27,000 15,000 0 0 1,92,000', 2), { found: true, page: 2, how: 'exact' });
});

test('a quote on another page than stated is found there; one not in the notice is not', () => {
  const d = new DocText(PAGES, true);
  assert.deepEqual(d.findQuote('Personal hearing: 05/11/2026 at 11:00 AM', 1), { found: true, page: 2, how: 'exact' });
  assert.equal(d.findQuote('Tax of Rs. 60,000 is short paid', 1).found, false, 'a changed figure');
  assert.equal(d.findQuote('Penalty under section 122 is imposed', 1).found, false, 'words not in the notice');
  assert.equal(d.findQuote('', 1).found, false, 'empty');
});

test('word-order matching tolerates a few words in between, not missing ones', () => {
  assert.equal(wordsInOrder(['cgst', '75000', '96000'], ['cgst', '75000', '13500', '96000']), true);
  assert.equal(wordsInOrder(['cgst', '75000', '96000'], ['cgst', '75000', '13500', '7500', '0', '96000']), false, 'too many in between');
  assert.equal(wordsInOrder(['cgst', '80000', '96000'], ['cgst', '75000', '13500', '96000']), false, 'a word not there');
  const d = new DocText(['CGST 75,000 13,500 7,500 0 0 96,000'], true);
  assert.deepEqual(d.findQuote('CGST 75,000 13,500 7,500 0 96,000', 1), { found: true, page: 1, how: 'words' }, 'one cell in between');
  assert.equal(d.findQuote('CGST 75,000 13,500 7,500 96,000', 1).found, false, 'two in five words is too many');
});

// ── Values in quotes ───────────────────────────────────────────────────────
test('amounts: with or without commas, Indian grouping, decimals, Rs. and lakh/crore', () => {
  for (const q of ['Rs. 1,23,456.00', 'Rs.123456/-', '1,23,456', '123,456', '₹ 1,23,456', 'demand of 123456.40 rupees']) {
    assert.equal(amountInText(123456, q), true, q);
  }
  assert.equal(amountInText(150000, 'tax of 1.5 lakh'), true);
  assert.equal(amountInText(20000000, 'Rs. 2 crore'), true);
  assert.equal(amountInText(123456, 'Rs. 1,23,465'), false, 'transposed digits');
  assert.equal(amountInText(123456, 'Rs. 12,34,560'), false, 'a digit more');
  assert.equal(amountInText(123456, 'Rs. 123457'), false, 'a rupee off');
  assert.deepEqual(amountsIn('CGST 25,000 and SGST 25,000.50'), [25000, 25000.5]);
});

test('dates: dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy, d Month yyyy, Month d, yyyy, ISO', () => {
  for (const q of ['on or before 31/10/2026', 'dated 31-10-2026', 'Date: 31.10.2026', '31st October, 2026', '31 Oct 2026',
    '31-Oct-2026', 'October 31, 2026', 'Oct. 31st 2026', '2026-10-31', 'by 31/10/26']) {
    assert.equal(dateInText('2026-10-31', q), true, q);
  }
  assert.equal(dateInText('2026-10-05', 'on 5/10/2026'), true, 'no leading zeros');
  assert.equal(dateInText('2026-10-05', 'on 10/05/2026'), false, 'month first is not read as day first');
  assert.equal(dateInText('2026-10-31', 'on or before 30/10/2026'), false);
  assert.equal(dateInText('2026-10-31', '131/10/2026'), false, 'digits glued on');
  assert.equal(dateInText('2026-02-30', '30/02/2026'), false, 'not a real date');
});

test('periods: the date, its month, or the financial year', () => {
  assert.equal(monthInText(2019, 4, 'April 2019 to March 2020'), true);
  assert.equal(monthInText(2019, 4, 'Apr-19'), true);
  assert.equal(monthInText(2019, 4, 'return period 042019'), true);
  assert.equal(monthInText(2019, 4, '04/2019'), true);
  assert.equal(monthInText(2019, 5, 'April 2019'), false);
  assert.equal(fyInText(2019, 'F.Y. 2019-20'), true);
  assert.equal(fyInText(2019, 'FY 19-20'), true);
  assert.equal(fyInText(2019, '2019-2020'), true);
  assert.equal(fyInText(2019, '2018-19'), false);
  assert.equal(periodInText('2019-04-01', 'for the financial year 2019-20', 'from'), true);
  assert.equal(periodInText('2020-03-31', 'for the financial year 2019-20', 'to'), true);
  assert.equal(periodInText('2020-03-31', 'for the financial year 2020-21', 'to'), false);
  assert.equal(periodInText('2019-07-01', 'for the financial year 2019-20', 'from'), false, 'a FY gives only April and March');
});

test('strings are contained in the quote after normalising', () => {
  assert.equal(valueInText('text', 'Section 73(1)', 'issued under SECTION 73 (1) of the Act'), true);
  assert.equal(valueInText('text', '11:00 AM', 'at 11.00 a.m.'), true, 'punctuation does not matter');
  assert.equal(valueInText('text', '11:00 AM', 'at 11:00 PM'), false);
  assert.equal(valueInText('text', '11:00 AM', 'hearing at 11:00 am'), true);
  assert.equal(valueInText('text', 'Room No. 5', 'Venue: Room No. 6'), false);
  assert.equal(valueInText('text', '', 'anything'), false, 'empty value');
});

test('checkQuote: found and consistent; or why not', () => {
  const d = new DocText(PAGES, true);
  assert.deepEqual(checkQuote(d, 'date', '2026-10-31', 2, 'on or before 31/10/2026'), { quote_ok: true, page: 2 });
  assert.deepEqual(checkQuote(d, 'date', '2026-11-30', 2, 'on or before 31/10/2026'), { quote_ok: false, page: 2, why: 'value_not_in_quote' });
  assert.deepEqual(checkQuote(d, 'text', '73(1)', 1, 'Section 73(2)'), { quote_ok: false, page: 1, why: 'quote_not_found' });
  assert.deepEqual(checkQuote(d, 'text', 'x', 1, '  '), { quote_ok: false, page: 1, why: 'no_quote' });
  assert.deepEqual(checkQuote(new DocText(PAGES, false), 'text', 'DRC-01', 1, 'FORM GST DRC-01'), { quote_ok: false, page: 1, why: 'no_text_layer' });
});

// ── Sums, GSTIN, dates ─────────────────────────────────────────────────────
test('sums: the issues add up to the demand, tax by tax, within ₹1', () => {
  const demand = heads({ cgst: { tax: 75000, interest: 13500 }, sgst: { tax: 75000, interest: 13500 } });
  const full = [
    { demand: heads({ cgst: { tax: 25000, interest: 4500 }, sgst: { tax: 25000, interest: 4500 } }), amount: 59000 },
    { demand: heads({ cgst: { tax: 50000, interest: 9000.6 }, sgst: { tax: 50000, interest: 9000 } }), amount: 118000.6 },
  ];
  assert.equal(sumsCheck(demand, full).ok, true, '0.60 off: within ₹1');
  const taxOnly = [
    { demand: heads({ cgst: { tax: 25000 }, sgst: { tax: 25000 } }), amount: 50000 },
    { demand: heads({ cgst: { tax: 50000 }, sgst: { tax: 50000 } }), amount: 100000 },
  ];
  assert.equal(sumsCheck(demand, taxOnly).ok, true, 'issues state only the tax');
  const wrongHead = [{ demand: heads({ igst: { tax: 150000 } }), amount: 150000 }];
  const r = sumsCheck(demand, wrongHead);
  assert.equal(r.ok, false, 'same total, wrong taxes');
  assert.match(r.detail, /IGST 1,50,000 in the issues v 0 in the notice/);
  assert.equal(sumsCheck(demand, [{ demand: heads({ cgst: { tax: 75002 }, sgst: { tax: 75000 } }), amount: 150002 }]).ok, false, '₹2 off');
  assert.equal(sumsCheck(demand, [{ demand: heads({}), amount: 177000 }]).ok, true, 'amounts only: the total');
  assert.equal(sumsCheck(demand, [{ demand: heads({}), amount: 150000 }]).ok, true, 'amounts only: the tax');
  assert.equal(sumsCheck(demand, [{ demand: heads({}), amount: 1000 }]).ok, false);
  assert.equal(sumsCheck(null, taxOnly).ok, null, 'no demand: not checked');
  assert.equal(sumsCheck(demand, []).ok, null, 'no issues: not checked');
  assert.equal(sumsCheck(demand, [{ demand: heads({}), amount: 0 }]).ok, null, 'an issue without an amount');
});

test('GSTIN: must be the client\'s; none found is not a mismatch', () => {
  assert.deepEqual(gstinCheck(' 24aaaaa0000a1z5 ', '24AAAAA0000A1Z5'), { expected: '24AAAAA0000A1Z5', found: '24AAAAA0000A1Z5', ok: true });
  assert.deepEqual(gstinCheck('24ZZZZZ9999Z1Z5', '24AAAAA0000A1Z5'), { expected: '24AAAAA0000A1Z5', found: '24ZZZZZ9999Z1Z5', ok: false });
  assert.equal(gstinCheck('24AAAAA0000A1Z', '24AAAAA0000A1Z5').ok, false, '14 characters');
  assert.deepEqual(gstinCheck('', '24AAAAA0000A1Z5'), { expected: '24AAAAA0000A1Z5', found: null, ok: null });
  assert.equal(gstinCheck('24AAAAA0000A1Z5', null).ok, null, 'no GSTIN on file');
});

test('dates that cannot be right', () => {
  assert.deepEqual(dateOrderCheck({ issue: '2026-10-01', due: '2026-10-31', hearing: '2026-11-05', from: '2019-04-01', to: '2020-03-31' }), { ok: true, failed: [] });
  assert.deepEqual(dateOrderCheck({ issue: '2026-10-01', due: '2026-09-30', hearing: '2026-09-01', from: '2020-04-01', to: '2020-03-31' }),
    { ok: false, failed: ['due_date', 'hearing_date', 'period_from', 'period_to'] });
  assert.deepEqual(dateOrderCheck({ issue: null, due: '2020-01-01', hearing: null, from: null, to: null }), { ok: true, failed: [] });
});

// ── Normalising for the columns ────────────────────────────────────────────
test('section, financial year, periods and form code as the columns hold them', () => {
  assert.equal(normSection('Section 73(1) of the CGST Act, 2017'), '73(1)');
  assert.equal(normSection('CGST Act, 2017 section 74 (1)'), '74(1)');
  assert.equal(normSection('u/s 61'), '61');
  assert.equal(normSection('Section 74A'), '74A');
  assert.equal(normSection('74'), '74');
  assert.equal(normSection('the Act'), null);
  assert.equal(normFy('F.Y. 2019-2020'), '2019-20');
  assert.equal(normFy('2019-20'), '2019-20');
  assert.equal(normFy('FY 19-20'), '2019-20');
  assert.equal(normFy('2017-18 to 2019-20'), null, 'several years: none');
  assert.equal(normFy('2019-2021'), null);
  assert.equal(monthStart('2019-04-15'), '2019-04-01');
  assert.equal(monthEnd('2020-02-03'), '2020-02-29');
  assert.equal(monthEnd('2019-04-31'), null, 'not a date');
  assert.equal(normFormCode('FORM GST DRC-01'), 'DRC-01');
  assert.equal(normFormCode('Form GST ASMT \u2013 10'), 'ASMT-10');
  assert.equal(normFormCode('DRC-01A'), 'DRC-01A');
});

// ── The reading → notice_read_finish's p_result ────────────────────────────
test('a clean reading: every field checked, normalised for its column, issues sent', () => {
  const r = buildResult(noticeReading(SPEC), doc(), CLAIM, 'claude-opus-5-5');
  assert.deepEqual(r.checks.quotes, { checked: 17, ok: 17, failed: [] });
  assert.equal(r.fields.section_of_law.value, '73(1)');
  assert.equal(r.fields.section_of_law.printed, 'Section 73(1)');
  assert.equal(r.fields.financial_year.value, '2019-20');
  assert.equal(r.fields.period_from.value, '2019-04-01');
  assert.equal(r.fields.period_to.value, '2020-03-31');
  assert.equal(r.fields.due_date.value, '2026-10-31');
  assert.equal(r.fields.hearing_note.value, '11:00 AM · Room No. 5, GST Bhavan, Ahmedabad');
  assert.equal(r.fields.hearing_note.quote_ok, true);
  assert.equal(r.fields.officer.value, 'R. K. Testofficer, Assistant Commissioner, Ghatak 99, Ahmedabad');
  assert.deepEqual(r.fields.demand.value, {
    cgst: { tax: 75000, interest: 13500, penalty: 7500, fee: 0, others: 0 },
    sgst: { tax: 75000, interest: 13500, penalty: 7500, fee: 0, others: 0 },
  });
  assert.equal(r.fields.demand.quote_ok, true);
  assert.equal(r.issues.length, 2);
  assert.deepEqual(r.issues.map((i) => [i.issue_code, i.amount, i.page, i.quote_ok]), [['LIAB_GSTR1_V_3B', 50000, 1, true], ['ITC_2A_V_3B', 100000, 1, true]]);
  assert.deepEqual(r.issues[0].demand, { cgst: { tax: 25000, interest: 0, penalty: 0, fee: 0, others: 0 }, sgst: { tax: 25000, interest: 0, penalty: 0, fee: 0, others: 0 } });
  assert.equal(r.checks.sums.ok, true);
  assert.deepEqual(r.checks.gstin, { expected: SPEC.gstin, found: SPEC.gstin, ok: true });
  assert.equal(r.checks.form.ok, true);
  assert.equal(r.checks.reference.ok, true);
  assert.equal(r.detail.issues_withheld, undefined);
  assert.deepEqual([r.pages, r.text_layer, r.model], [2, true, 'claude-opus-5-5']);
  // Everything the database casts must cast.
  for (const k of ['period_from', 'period_to', 'due_date', 'hearing_date']) assert.match(String(r.fields[k].value), /^\d{4}-\d{2}-\d{2}$/);
});

test('a misread value fails its field only; a scan fails everything and sends no issue', () => {
  const reading = noticeReading(SPEC);
  reading.due_date = { value: '2026-11-30', page: 2, quote: 'on or before 31/10/2026' };
  reading.din = { value: '20261001TEST000999', page: 1, quote: 'DIN: 20261001TEST000999' };
  const r = buildResult(reading, doc(), CLAIM, 'm');
  assert.equal(r.fields.due_date.quote_ok, false);
  assert.equal(r.fields.due_date.why, 'value_not_in_quote');
  assert.equal(r.fields.din.why, 'quote_not_found');
  assert.equal(r.fields.section_of_law.quote_ok, true);
  assert.deepEqual(r.checks.quotes.failed, ['din', 'due_date']);

  const s = buildResult(noticeReading(SPEC), doc(false), CLAIM, 'm');
  assert.equal(Object.values(s.fields).every((f) => !f.quote_ok), true);
  assert.deepEqual(s.issues, []);
  assert.equal(s.detail.issues_withheld?.length, 2);
  assert.match(s.detail.withheld ?? '', /scan/);
  assert.equal(s.checks.quotes.ok, 0);
  assert.equal(s.text_layer, false);
});

test('issues go in together or not at all; unknown codes become OTHER', () => {
  const reading = noticeReading(SPEC);
  reading.issues[1].quote = 'credit in GSTR-2A by Rs. 2,00,000';
  reading.issues[0].issue_code = 'MADE_UP_CODE';
  const r = buildResult(reading, doc(), CLAIM, 'm');
  assert.deepEqual(r.issues, []);
  assert.equal(r.detail.issues_withheld?.[0].issue_code, 'OTHER');
  assert.equal(r.detail.issues_withheld?.[1].why, 'quote_not_found');
  assert.deepEqual(r.checks.quotes.failed, ['issues[1]']);
});

test('dates out of order fail; issue dates come before due dates', () => {
  const reading = noticeReading(SPEC);
  reading.issue_date = { value: '2026-11-15', page: 1, quote: 'Date: 15/11/2026' };
  const pages = [PAGES[0].replace('01/10/2026', '15/11/2026'), PAGES[1]];
  const r = buildResult(reading, { ...doc(), pages }, CLAIM, 'm');
  assert.equal(r.fields.issue_date.quote_ok, true);
  assert.equal(r.fields.due_date.quote_ok, false);
  assert.equal(r.fields.due_date.why, 'date_order');
  assert.equal(r.fields.hearing_date.why, 'date_order');
  assert.deepEqual([r.fields.hearing_note.quote_ok, r.fields.hearing_note.why], [false, 'date_order'], 'the time and place go with the date');
  assert.deepEqual(r.checks.dates, { ok: false, failed: ['due_date', 'hearing_date'] });
});

test('demand: every amount must be printed; sums decide whether it applies', () => {
  const reading = noticeReading(SPEC);
  reading.demand.cgst.penalty = 7600;
  reading.demand.sgst.penalty = 7400;
  const r = buildResult(reading, doc(), CLAIM, 'm');
  assert.equal(r.fields.demand.quote_ok, false, 'the total is right, two of its amounts are not printed');
  assert.equal(r.fields.demand.why, 'amounts_not_in_text');
  reading.demand.sgst.penalty = 7500;
  assert.equal(buildResult(reading, doc(), CLAIM, 'm').fields.demand.why, 'value_not_in_quote', 'the total is not in the quote either');

  const none = noticeReading(SPEC);
  none.demand = { ...none.demand, stated: false };
  assert.equal(buildResult(none, doc(), CLAIM, 'm').fields.demand, undefined, 'no demand stated: no field');
  assert.equal(buildResult(none, doc(), CLAIM, 'm').checks.sums.ok, null);
});

test('GSTIN mismatch is reported for the database to refuse', () => {
  const reading = noticeReading({ ...SPEC, gstin: '24ZZZZZ9999Z1Z5' });
  const pages = PAGES.map((p) => p.replace(SPEC.gstin, '24ZZZZZ9999Z1Z5'));
  const r = buildResult(reading, { ...doc(), pages }, CLAIM, 'm');
  assert.deepEqual(r.checks.gstin, { expected: SPEC.gstin, found: '24ZZZZZ9999Z1Z5', ok: false });
});

test('absent values ("" / page 0) are left out; odd JSON is coerced, not thrown', () => {
  const reading = noticeReading(SPEC);
  reading.din = { value: '', page: 0, quote: '' };
  reading.hearing_venue = { value: '', page: 0, quote: '' };
  const r = buildResult(reading, doc(), CLAIM, 'm');
  assert.equal(r.fields.din, undefined);
  assert.equal(r.fields.hearing_note.value, '11:00 AM');

  const c = coerceReading({ gstin: { value: 5, page: '2', quote: null }, demand: { stated: 'yes', cgst: { tax: '1,000' } }, issues: [{ amount: 'x' }], documents_asked: ['a', 3, ''] });
  assert.deepEqual(c.gstin, { value: '5', page: 2, quote: '' });
  assert.equal(c.demand.stated, false);
  assert.equal(c.demand.cgst.tax, 1000);
  assert.equal(c.issues[0].amount, 0);
  assert.deepEqual(c.documents_asked, ['a', '3']);
  assert.equal(c.officer.value, '');
});

test('the output schema uses no unions or numeric/length limits (structured-outputs rules)', () => {
  const s = JSON.stringify(OUTPUT_SCHEMA);
  for (const k of ['anyOf', 'oneOf', 'minimum', 'maximum', 'minLength', 'maxLength', '"null"']) assert.equal(s.includes(k), false, k);
  const walk = (o: Json): void => {
    if (o && typeof o === 'object') {
      if (o.type === 'object') {
        assert.equal(o.additionalProperties, false);
        assert.deepEqual([...o.required].sort(), Object.keys(o.properties).sort());
      }
      Object.values(o).forEach(walk);
    }
  };
  walk(OUTPUT_SCHEMA);
});
