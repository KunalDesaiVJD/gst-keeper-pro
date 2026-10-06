// A stand-in for the Claude Messages API on 127.0.0.1, for the notice
// reader's tests: it records each request and answers with what the test
// scripts — a streamed message (server-sent events, as the API streams
// them), or an error status. The SDK is pointed at it through its base URL.
// Never used outside tests; the real API is never called.
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export type FakeBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking' }
  | { type: 'fallback'; from: string; to: string };

export interface FakeReply {
  // An error reply: HTTP status, error type and headers (e.g. retry-after-ms).
  status?: number;
  errorType?: string;
  headers?: Record<string, string>;
  // A streamed message.
  blocks?: FakeBlock[];
  stop_reason?: string;
  stop_details?: unknown;
  usage?: Record<string, unknown>;
  model?: string;
  // Close the connection after the first event (a stream cut off).
  cutAfterStart?: boolean;
  // Wait before answering.
  delayMs?: number;
}

// Parsed JSON (request bodies, database rows): tests read nested fields freely.
export type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface SeenRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: Record<string, Json>;
}

export class FakeAnthropic {
  seen: SeenRequest[] = [];
  url = '';
  private server: http.Server | null = null;

  constructor(public reply: (req: SeenRequest, n: number) => FakeReply) {}

  async start(): Promise<string> {
    this.server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        let body: Record<string, Json> = {};
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { /* recorded as {} */ }
        const seen: SeenRequest = { method: req.method || '', url: req.url || '', headers: req.headers, body };
        this.seen.push(seen);
        const n = this.seen.length;
        const r = this.reply(seen, n);
        const go = () => this.answer(res, r, n);
        if (r.delayMs) setTimeout(go, r.delayMs);
        else go();
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', () => resolve()));
    this.url = `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}`;
    return this.url;
  }

  async stop(): Promise<void> {
    const s = this.server;
    this.server = null;
    if (s) await new Promise<void>((resolve) => { s.closeAllConnections?.(); s.close(() => resolve()); });
  }

  private answer(res: http.ServerResponse, r: FakeReply, n: number) {
    if (res.destroyed) return;
    const requestId = `req_fake_${n}`;
    if (r.status && r.status >= 400) {
      res.writeHead(r.status, { 'content-type': 'application/json', 'request-id': requestId, ...(r.headers ?? {}) });
      res.end(JSON.stringify({ type: 'error', error: { type: r.errorType ?? 'api_error', message: `fake ${r.status}` }, request_id: requestId }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'request-id': requestId, ...(r.headers ?? {}) });
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const model = r.model ?? 'claude-opus-5-5';
    const usage = r.usage ?? { input_tokens: 1000, output_tokens: 200 };
    send('message_start', {
      type: 'message_start',
      message: {
        id: `msg_fake_${n}`, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, stop_details: null,
        usage: { input_tokens: usage.input_tokens ?? 0, cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0, cache_read_input_tokens: usage.cache_read_input_tokens ?? 0, output_tokens: 1 },
      },
    });
    if (r.cutAfterStart) { setTimeout(() => res.destroy(), 100); return; }
    (r.blocks ?? []).forEach((b, index) => {
      if (b.type === 'thinking') {
        send('content_block_start', { type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } });
        send('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: 'fake-signature' } });
      } else if (b.type === 'fallback') {
        send('content_block_start', { type: 'content_block_start', index, content_block: { type: 'fallback', from: { model: b.from }, to: { model: b.to } } });
      } else {
        send('content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
        for (let i = 0; i < b.text.length; i += 400) {
          send('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: b.text.slice(i, i + 400) } });
        }
      }
      send('content_block_stop', { type: 'content_block_stop', index });
    });
    send('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: r.stop_reason ?? 'end_turn', stop_sequence: null, stop_details: r.stop_details ?? null },
      usage,
    });
    send('message_stop', { type: 'message_stop' });
    res.end();
  }
}

// A normal answer: an (empty) thinking block, then the reading as JSON.
export function readingReply(json: unknown, usage: Record<string, unknown> = { input_tokens: 12000, output_tokens: 2500 }): FakeReply {
  return { blocks: [{ type: 'thinking' }, { type: 'text', text: JSON.stringify(json) }], stop_reason: 'end_turn', usage };
}
