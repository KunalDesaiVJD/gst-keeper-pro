import { assertEquals } from '@std/assert';
import { checkFilters, cleanRows, columnAllowed, searchDocs, selectList, tableAllowed } from '../readRules.ts';

Deno.test('only GST working tables are open', () => {
  for (const t of ['clients', 'twob_import_docs', 'books_register', 'bills_not_in_2b', 'filing_status', 'builder_units', 'annual_return_docs']) assertEquals(tableAllowed(t), true, t);
  for (const t of ['profiles', 'portal_sessions', 'client_password_resets', 'ai_api_key', 'doc_links', 'builder_bu_confirm_codes', 'gst_change_log_stage', 'user_roles', 'clients; drop']) assertEquals(tableAllowed(t), false, t);
});

Deno.test('secrets never leave', () => {
  for (const c of ['gst_password', 'client_password', 'gst_user_id', 'token_hash']) assertEquals(columnAllowed(c), false, c);
  assertEquals(typeof selectList(['name', 'gst_password']), 'object');
  assertEquals(selectList(['name', 'gstin']), 'name,gstin');
  assertEquals(Array.isArray(checkFilters([{ column: 'gst_password', op: 'eq', value: 'x' }])), false);
  const { rows, withheld } = cleanRows('clients', [{ id: 'a', name: 'A', gst_password: 'p' }, { id: 'b', name: 'B' }], new Set(['b']));
  assertEquals(rows, [{ id: 'a', name: 'A' }]);
  assertEquals(withheld, 1);
});

Deno.test('doc search prefers headings', () => {
  const docs = [
    { doc: 'a.md', title: 'A', heading: 'Credit notes in 2B', text: 'credit note rows wait on the ledger' },
    { doc: 'b.md', title: 'B', heading: 'Builder', text: 'units and bookings, credit note mentioned once' },
  ];
  assertEquals(searchDocs(docs, 'credit note')[0].doc, 'a.md');
});
