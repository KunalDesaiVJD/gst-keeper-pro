import { assert, assertEquals } from '@std/assert';
import { EFFECT_KINDS, fyYears, parseRemarkRequest, RECORD_EFFECT_TOOL, remarkSystemPrompt, remarkUserText, validateEffect } from '../remarkEffect.ts';

const ok = {
  kind: 'next_fy_t13',
  amount: { t: 500, i: 1234.567, c: 0, s: 0, x: 0 },
  summary: 'ITC of March booked in books was claimed in the May 2026 GSTR-3B.',
  thisFy: 'Table 13 and 8C',
  nextFy: 'Report in Table 6A1, not 6B.',
  confidence: 'high',
};

Deno.test('a good effect is kept, rounded, t only for Tables 10 and 11', () => {
  const v = validateEffect(ok);
  assert(!('error' in v));
  assertEquals(v.amount, { t: 0, i: 1234.57, c: 0, s: 0, x: 0 });
  assertEquals(v.kind, 'next_fy_t13');
  assertEquals('question' in v, false);
  const t10 = validateEffect({ ...ok, kind: 'next_fy_t10', amount: { t: 1000.005, i: 180, c: 0, s: 0, x: 0 } });
  assert(!('error' in t10));
  assertEquals(t10.amount.t, 1000.01);
});

Deno.test('bad kinds and amounts are refused', () => {
  assert('error' in validateEffect(null));
  assert('error' in validateEffect({ ...ok, kind: 'write_db' }));
  assert('error' in validateEffect({ ...ok, amount: { t: 0, i: -1, c: 0, s: 0, x: 0 } }));
  assert('error' in validateEffect({ ...ok, amount: { t: 0, i: Infinity, c: 0, s: 0, x: 0 } }));
  assert('error' in validateEffect({ ...ok, amount: { t: 0, i: 'abc', c: 0, s: 0, x: 0 } }));
  assert('error' in validateEffect({ ...ok, amount: undefined }));
  assert('error' in validateEffect({ ...ok, summary: '  ' }));
});

Deno.test('strings are clipped, nextFy null, confidence defaults to low', () => {
  const v = validateEffect({ ...ok, kind: 'no_effect', thisFy: '', nextFy: 'null', confidence: 'certain', summary: 'x'.repeat(2000), question: 'Which month?' });
  assert(!('error' in v));
  assertEquals(v.thisFy, 'No table');
  assertEquals(v.nextFy, null);
  assertEquals(v.confidence, 'low');
  assertEquals(v.summary.length, 500);
  assertEquals(v.question, 'Which month?');
});

const body = {
  clientId: '0f8fad5b-d9cb-469f-a165-70867728950e',
  financialYear: '2025-26',
  line: { key: 'itc', label: 'ITC: Books − 3B', step: 'itc', direction: 'Books − 3B', aLabel: 'Books', bLabel: '3B', a: { t: 0, i: 100, c: 0, s: 0, x: 0 }, b: { t: 0, i: 40, c: 0, s: 0, x: 0 }, diff: { t: 0, i: 60, c: 0, s: 0, x: 0 }, hasTax: true, hasTaxable: false },
  remark: 'Claimed in May 2026 3B',
  figures: { t13: { i: 0 } },
  carried: [],
};

Deno.test('requests are checked', () => {
  const r = parseRemarkRequest(body);
  assert(!('error' in r));
  assertEquals(r.line.diff.i, 60);
  assert(remarkUserText(r).includes('<remark>\nClaimed in May 2026 3B\n</remark>'));
  assert('error' in parseRemarkRequest({ ...body, clientId: 'abc' }));
  assert('error' in parseRemarkRequest({ ...body, remark: '   ' }));
  assert('error' in parseRemarkRequest({ ...body, financialYear: '2025-27' }));
  assert('error' in parseRemarkRequest({ ...body, line: null }));
  const big = parseRemarkRequest({ ...body, remark: 'a'.repeat(9000), carried: Array.from({ length: 80 }, () => ({ kind: 'next_fy_t13', remark: 'x'.repeat(500) })) });
  assert(!('error' in big));
  assertEquals(big.remark.length, 4000);
  assert(big.carried.length <= 8000 + 10);
});

Deno.test('prompt and tool name the FYs and every kind', () => {
  assertEquals(fyYears('2025-26'), { start: 2025, end: 2026 });
  assertEquals(fyYears('2099-00'), { start: 2099, end: 2100 });
  const text = remarkSystemPrompt('2025-26')[0].text;
  assert(text.includes('April 2025 to March 2026') && text.includes('30 November 2026') && text.includes('FY 2024-25'));
  for (const k of EFFECT_KINDS) assert(text.includes(k), k);
  assertEquals((RECORD_EFFECT_TOOL.input_schema.properties as Record<string, { enum?: string[] }>).kind.enum, [...EFFECT_KINDS]);
});
