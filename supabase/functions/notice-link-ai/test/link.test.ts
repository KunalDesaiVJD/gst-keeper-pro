// notice-link-ai: the material as the model reads it, the request pinned to Sonnet at medium, and the answer kept.
import { assertEquals, assertStringIncludes } from '@std/assert';
import { judgeLink, linkUserText, mapLinkOutput, type LinkDeps } from '../link.ts';
import { FakeDb, FakeNet, jsonReply, type J } from '../../notice-ai/test/fake.ts';

const ctx = {
  kind: 'related', client: 'Unity Organics',
  check: {
    against_law: true,
    problems: [{ code: 'two_proceedings', level: 'law', text: 'This puts 2 show cause proceedings in one case.' }],
    proceedings: [{ case_key: 'AD240923028913Z', scn_ref: 'ZD2409230452688', financial_year: '2017-18' },
      { case_key: 'AD240923031848T', scn_ref: 'ZD240923048202N', financial_year: '2017-18' }],
  },
  shared_numbers: [],
  child: { case_key: 'AD240923031848T', step: 'proceeding', financial_year: '2017-18', notices: [{ form: 'DRC-01', ref: 'ZD240923048202N', date: '2023-09-29', description: 'Show Cause Notice' }], documents: [] },
  parent: { case_key: 'AD2408230098061', step: 'pre_scn', financial_year: '2017-18', notices: [{ form: 'DRC-01A', ref: 'ZD240823020814K', date: '2023-08-17', amount: 2677816 }], documents: [] },
};

Deno.test('link: the material as read', () => {
  const text = linkUserText(ctx);
  assertStringIncludes(text, 'portal case AD240923031848T, a show cause proceeding');
  assertStringIncludes(text, 'Notice DRC-01A ZD240823020814K dated 2023-08-17, Rs. 26,77,816');
  assertStringIncludes(text, 'No portal number is on the papers of both cases.');
  assertStringIncludes(text, '[against the law] This puts 2 show cause proceedings');
  assertStringIncludes(text, 'AD240923028913Z (DRC-01 ZD2409230452688, FY 2017-18)');
  assertEquals(mapLinkOutput({ verdict: 'maybe', kind: 'x', confidence: 140, reasons: ['a', 3], law: [] }),
    { verdict: 'unsure', kind: 'none', confidence: 100, reasons: ['a'], law: [] });
});

Deno.test('link: judged at Sonnet medium, kept, bad requests refused', async () => {
  const inserted: J[] = [];
  const fake = new FakeDb({ notice_case_link_ai_context: () => ctx });
  const db = { rpc: fake.rpc.bind(fake), insert: (t: string, row: J) => { inserted.push({ t, row }); return Promise.resolve(); } };
  const net = new FakeNet({}, () => jsonReply({ verdict: 'keep_apart', kind: 'none', confidence: 90, reasons: ['Two notices.'], law: ['section 73'] }));
  const deps: LinkDeps = { db, claude: net.client() };
  const r = await judgeLink(deps, { client_id: '00000000-0000-0000-0000-0000000000c1', child_key: 'AD240923031848T', parent_key: 'AD2408230098061', actor: 'Meet' });
  assertEquals(r.opinion?.verdict, 'keep_apart');
  const req = net.claude[0].body;
  assertEquals(req.model, 'claude-sonnet-5-5');
  assertEquals(req.output_config.effort, 'medium');
  assertStringIncludes(req.system, 'Never put two show cause notices in one case');
  assertEquals(inserted[0].t, 'notice_case_link_ai');
  assertEquals(inserted[0].row.verdict, 'keep_apart');
  assertEquals(inserted[0].row.asked_by, 'Meet');
  assertEquals((await judgeLink(deps, { client_id: 'x', child_key: 'A', parent_key: 'B' })).error, 'bad_request');
  assertEquals((await judgeLink(deps, { client_id: '00000000-0000-0000-0000-0000000000c1', child_key: 'A;drop', parent_key: 'B' })).error, 'bad_request');
});
