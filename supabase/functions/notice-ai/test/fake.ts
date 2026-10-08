// Stand-ins for the notice-ai tests: the Claude Messages API (a fetch that
// streams scripted server-sent events, as the API streams them), the app's
// storage (PDFs drawn with pdf-lib, every quote real text) and the database
// (scripted RPC answers, every call recorded). The real API is never called.
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { apiCaller, makeClaudeClient } from '../claude.ts';
import { cliCaller } from '../cli.ts';
import type { Db } from '../runner.ts';

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type J = any;

export const SUPA = 'https://test-project.supabase.co';
export const storageUrl = (name: string) => `${SUPA}/storage/v1/object/public/return-pdfs/${name}`;

export interface FakeReply {
  status?: number;
  errorType?: string;
  text?: string;
  stop_reason?: string;
  stop_details?: unknown;
  usage?: Record<string, number>;
  model?: string;
}

export const jsonReply = (json: unknown, usage = { input_tokens: 12000, output_tokens: 2500 }): FakeReply =>
  ({ text: JSON.stringify(json), stop_reason: 'end_turn', usage });

function sse(r: FakeReply, n: number): Response {
  const requestId = `req_fake_${n}`;
  if (r.status && r.status >= 400) {
    return new Response(JSON.stringify({ type: 'error', error: { type: r.errorType ?? 'api_error', message: `fake ${r.status}` }, request_id: requestId }),
      { status: r.status, headers: { 'content-type': 'application/json', 'request-id': requestId } });
  }
  const model = r.model ?? 'claude-opus-5-5';
  const usage = r.usage ?? { input_tokens: 1000, output_tokens: 200 };
  const events: string[] = [];
  const send = (event: string, data: unknown) => events.push(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send('message_start', {
    type: 'message_start',
    message: {
      id: `msg_fake_${n}`, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, stop_details: null,
      usage: { input_tokens: usage.input_tokens ?? 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 },
    },
  });
  send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } });
  send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'fake-signature' } });
  send('content_block_stop', { type: 'content_block_stop', index: 0 });
  if (r.text !== undefined) {
    send('content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } });
    for (let i = 0; i < r.text.length; i += 400) {
      send('content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: r.text.slice(i, i + 400) } });
    }
    send('content_block_stop', { type: 'content_block_stop', index: 1 });
  }
  send('message_delta', { type: 'message_delta', delta: { stop_reason: r.stop_reason ?? 'end_turn', stop_sequence: null, stop_details: r.stop_details ?? null }, usage });
  send('message_stop', { type: 'message_stop' });
  const body = new ReadableStream({
    start(c) {
      const enc = new TextEncoder();
      for (const e of events) c.enqueue(enc.encode(e));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream', 'request-id': requestId } });
}

export interface Seen {
  url: string;
  body: J;
}

// One fetch for both the Claude API and the storage.
export const GATEWAY = 'https://cli-gateway.test/run';

export class FakeNet {
  claude: Seen[] = [];
  cli: (Seen & { auth: string | null })[] = [];
  downloads: string[] = [];
  /** The Claude CLI gateway's answer: {status?, body}. */
  gateway: (req: Seen, n: number) => { status?: number; body: J } = () => ({ status: 500, body: { error: 'no gateway' } });
  constructor(public files: Record<string, Uint8Array>, public reply: (req: Seen, n: number) => FakeReply) {}

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url === GATEWAY) {
      const seen = { url, body: JSON.parse(String(init?.body ?? '{}')), auth: new Headers(init?.headers).get('authorization') };
      this.cli.push(seen);
      const r = this.gateway(seen, this.cli.length);
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.startsWith('https://api.anthropic.com/')) {
      const raw = init?.body ?? (input instanceof Request ? await input.text() : '');
      const body = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(new TextDecoder().decode(raw as Uint8Array));
      const seen = { url, body };
      this.claude.push(seen);
      return sse(this.reply(seen, this.claude.length), this.claude.length);
    }
    this.downloads.push(url);
    const name = url.split('/').pop() ?? '';
    const f = this.files[name];
    if (!f) return new Response('not found', { status: 404 });
    return new Response(f.slice(), { status: 200, headers: { 'content-type': 'application/pdf', 'content-length': String(f.byteLength) } });
  };

  raw() {
    return makeClaudeClient({ apiKey: 'sk-ant-test-key', fetch: this.fetch, maxRetries: 0 });
  }
  client() {
    return apiCaller(this.raw());
  }
  cliClient() {
    return cliCaller({ url: GATEWAY, secret: 'gw-secret', fetch: this.fetch });
  }
}

// Scripted database: each function answers from a handler (or a queue).
export class FakeDb implements Db {
  calls: { fn: string; args: J }[] = [];
  constructor(public handlers: Record<string, (args: J, n: number) => unknown>) {}
  rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ fn, args });
    const h = this.handlers[fn];
    const n = this.calls.filter((c) => c.fn === fn).length;
    return Promise.resolve((h ? h(args, n) : null) as T);
  }
  called(fn: string) {
    return this.calls.filter((c) => c.fn === fn);
  }
}

export async function buildPdf(pages: string[][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = doc.addPage([595, 842]);
    lines.forEach((line, i) => page.drawText(line, { x: 40, y: 800 - i * 18, size: 10, font }));
  }
  return await doc.save();
}

// A reply to an ASMT-10 (fictional names, GSTIN and amounts).
export const replyPages = [[
  'Reply to notice in FORM GST ASMT-10 Reference ZD-ASMT-1 dated 01/04/2025',
  'GSTIN: 24AAAAA0000A1Z5    Financial year 2019-20',
  'Para 2: Excess ITC over GSTR-2A',
  'The difference arose because the suppliers filed their GSTR-1 after the due date;',
  'the credit is reconciled invoice wise in Annexure A.',
  'Para 3: Interest',
  'Interest has been paid by DRC-03 on 12/05/2025.',
]];

// The reading a model would return for replyPages: every quote is text the PDF carries.
export const replyReading = {
  doc_kind: 'reply',
  title: 'Reply to ASMT 10 for 2019 20',
  summary: 'The taxpayer explains the GSTR 2A difference and the interest paid.',
  doc_date: '2025-04-20',
  reference: 'ZD-ASMT-1',
  outcome: '',
  paragraphs: [
    {
      kind: 'response', para: '2', heading: 'Excess ITC over GSTR 2A', issue_code: 'ITC_2A_V_3B',
      text: 'The difference arose because the suppliers filed their GSTR-1 after the due date; the credit is reconciled invoice wise in Annexure A.',
      page: 1, quote: 'the credit is reconciled invoice wise in Annexure A.', answers: 'P1', allegation: '',
    },
    {
      kind: 'response', para: '3', heading: 'Interest', issue_code: 'INTEREST_50',
      text: 'Interest has been paid by DRC-03 on 12/05/2025.', page: 1, quote: 'Interest has been paid by DRC-03 on 12/05/2025.',
      answers: '', allegation: 'Interest under section 50 on the excess credit.',
    },
    {
      kind: 'response', para: '', heading: 'Prayer', issue_code: 'OTHER', text: 'It is prayed that the proceedings be dropped.',
      page: 1, quote: 'It is prayed that the proceedings be dropped.', answers: '', allegation: '',
    },
  ],
  key_facts: [{ label: 'Financial year', value: '2019-20', page: 1 }],
};

export const ISSUE_CODES = [
  { code: 'ITC_2A_V_3B', title: 'ITC in GSTR-3B more than in GSTR-2A' },
  { code: 'INTEREST_50', title: 'Interest under section 50' },
  { code: 'OTHER', title: 'Other issue' },
];
