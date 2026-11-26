import { assert, assertEquals } from '@std/assert';
import { parseVarianceRequest, RECORD_SUMMARY_TOOL, TABLES, validateSummary, varianceSystemPrompt, varianceUserText } from '../varianceSummary.ts';

const body = {
  clientId: '0f8fad5b-d9cb-469f-a165-70867728950e',
  financialYear: '2025-26',
  cells: [
    { id: '5D.t', table: '5', row: '5D', label: 'Exempted', head: 'Taxable value', portal: 1000, final: 1500.555, diff: 500.555, remarks: ['reason:g9.t5.5D', 'reason:unknown'] },
    { id: '9A.payable', table: '9', row: '9A', label: 'Integrated tax', head: 'Tax payable', portal: 10, final: 20, diff: 10, remarks: [] },
    { id: 'bad id!', table: '5', portal: 0, final: 1, diff: 1 },
    { id: '7A.t', table: '7', portal: 0, final: 1, diff: 1 },
  ],
  remarks: [
    { id: 'reason:g9.t5.5D', kind: 'reason', label: 'Exempted (5D): books vs portal', text: 'Exempt interest income shown in books only', effect: null, tables: ['5'] },
    { id: 'gstr9c:t6Reasons', kind: 'gstr9c', label: 'GSTR-9C Table 6', text: '   ', tables: ['4'] },
  ],
  nextFy: { t10: { t: 0 } },
};

Deno.test('requests are checked and cleaned', () => {
  const r = parseVarianceRequest(body);
  assert(!('error' in r));
  assertEquals(r.cells.map((c) => c.id), ['5D.t', '9A.payable']);
  assertEquals(r.cells[0].final, 1500.56);
  assertEquals(r.cells[0].remarks, ['reason:g9.t5.5D']);
  assertEquals(r.remarks.length, 1);
  assert(varianceUserText(r).includes('<cells>'));
  assert('error' in parseVarianceRequest({ ...body, clientId: 'abc' }));
  assert('error' in parseVarianceRequest({ ...body, financialYear: '2025' }));
  assert('error' in parseVarianceRequest({ ...body, cells: [] }));
  const big = parseVarianceRequest({ ...body, cells: Array.from({ length: 300 }, (_, i) => ({ id: `5D.t${i}`, table: '5', portal: 0, final: 1, diff: 1 })) });
  assert(!('error' in big));
  assertEquals(big.cells.length, 120);
});

const ids = new Set(['5D.t', '9A.payable']);

Deno.test('a good summary is kept, in table order', () => {
  const v = validateSummary({
    overall: 'Two figures differ.',
    tables: [{ table: '9', summary: 'IGST payable typed.' }, { table: '5', summary: 'Exempt income from books.' }, { table: '5', summary: 'twice' }],
    unexplained: [{ id: '9A.payable', note: '' }, { id: '9A.payable', note: 'again' }],
  }, ids);
  assert(!('error' in v));
  assertEquals(v.tables.map((t) => t.table), ['5', '9']);
  assertEquals(v.unexplained, [{ id: '9A.payable', note: 'No remark explains this difference.' }]);
});

Deno.test('bad summaries are refused', () => {
  assert('error' in validateSummary(null, ids));
  assert('error' in validateSummary({ overall: '', tables: [], unexplained: [] }, ids));
  assert('error' in validateSummary({ overall: 'x', tables: 'no', unexplained: [] }, ids));
  assert('error' in validateSummary({ overall: 'x', tables: [{ table: '7', summary: 'x' }], unexplained: [] }, ids));
  assert('error' in validateSummary({ overall: 'x', tables: [{ table: '5', summary: ' ' }], unexplained: [] }, ids));
  assert('error' in validateSummary({ overall: 'x', tables: [], unexplained: [{ id: '4A.t', note: 'x' }] }, ids));
});

Deno.test('prompt and tool', () => {
  const text = varianceSystemPrompt('2025-26')[0].text;
  assert(text.includes('April 2025 to March 2026') && text.includes('<remarks>'));
  const props = RECORD_SUMMARY_TOOL.input_schema.properties as Record<string, { items?: { properties?: Record<string, { enum?: string[] }> } }>;
  assertEquals(props.tables.items?.properties?.table.enum, [...TABLES]);
});
