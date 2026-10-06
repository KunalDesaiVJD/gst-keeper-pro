// The notice reader: an independent loop next to the portal workers. It
// claims one reading at a time from the database (notice_read_claim — only
// while reading is switched on in the app, the client has consent on file
// and the day's spending cap is not reached), downloads the notice PDF from
// the app's storage, reads it with the Claude API, checks every field against
// the PDF's own text, and finishes the job (notice_read_finish), which
// applies only checked fields, only into empty columns, as "auto — verify".
// No API key in agent/.env: the reader stays off.

import type Anthropic from '@anthropic-ai/sdk';
import type { AgentConfig } from '../config.js';
import { sleep, type Db } from '../db.js';
import { log } from '../log.js';
import { makeClaudeClient, readNotice, scrub, type CallUsage } from './claude.js';
import { DocumentError, documentUrlAllowed, downloadPdf, readPdfText } from './pdf.js';
import { buildResult, type ReadResult, type ReaderClaim } from './result.js';

export interface ReaderInfo {
  enabled: boolean;
  busy: boolean;
  last_claim_at: string | null;
  last_error: string | null;
  done_today: number;
}

interface Finish {
  status: 'done' | 'failed' | 'retry' | 'cancelled';
  result?: ReadResult | Partial<ReadResult> | null;
  usage?: CallUsage | null;
  error?: string | null;
  reason?: string | null;
  pause?: string;
}

interface FinishReply {
  status?: string;
  outcome?: string;
  applied?: string[];
  issues_added?: number;
  error?: string;
}

const istDay = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const PAUSES: Record<string, string> = {
  api_key: 'The Claude API refused the API key in agent/.env. The notice reader is paused: put a valid ANTHROPIC_API_KEY in agent/.env and restart the agent.',
  api_permission: 'The Claude API refused requests for this API key\'s organisation. The notice reader is paused until the agent restarts.',
  api_billing: 'The Claude API account has a billing problem. The notice reader is paused until the agent restarts.',
};

export interface ReaderOptions {
  // Tests pass a client pointed at a stand-in server.
  client?: Anthropic;
}

export class NoticeReader {
  private client: Anthropic | null;
  private stopping = false;
  private paused: string | null = null;
  private busy = false;
  private capped = false;
  private lastClaimAt: string | null = null;
  private lastError: string | null = null;
  private doneToday = 0;
  private doneDay = istDay();
  private current: AbortController | null = null;
  private running: Promise<void> | null = null;
  private wake: (() => void) | null = null;

  constructor(private cfg: AgentConfig, private db: Db, opts: ReaderOptions = {}) {
    this.client = cfg.anthropicApiKey
      ? opts.client ?? makeClaudeClient({ apiKey: cfg.anthropicApiKey, baseUrl: cfg.anthropicBaseUrl })
      : null;
  }

  info(): ReaderInfo {
    if (this.doneDay !== istDay()) { this.doneDay = istDay(); this.doneToday = 0; }
    return {
      enabled: !!this.client && !this.paused,
      busy: this.busy,
      last_claim_at: this.lastClaimAt,
      last_error: this.paused ?? this.lastError,
      done_today: this.doneToday,
    };
  }

  start(): void {
    if (!this.running) this.running = this.loop().catch((e) => log('error', `notice reader stopped: ${scrub((e as Error).message)}`));
  }

  // Waits for a reading in progress (up to graceMs), then stops it; whatever
  // this agent still holds goes back on the queue.
  async stop(graceMs = 10_000): Promise<void> {
    this.stopping = true;
    this.wake?.();
    if (this.running) {
      const ended = await Promise.race([this.running.then(() => true), sleep(graceMs).then(() => false)]);
      if (!ended) {
        this.current?.abort();
        await Promise.race([this.running, sleep(15_000)]);
      }
    }
    if (this.client) await this.db.rpc('notice_reads_release', { p_agent: this.cfg.agentId }).catch(() => 0);
  }

  private nap(ms: number): Promise<void> {
    if (this.stopping) return Promise.resolve();
    return new Promise((resolve) => {
      const t = setTimeout(() => { this.wake = null; resolve(); }, ms);
      this.wake = () => { clearTimeout(t); this.wake = null; resolve(); };
    });
  }

  private async loop(): Promise<void> {
    const released = await this.db.rpc<number>('notice_reads_release', { p_agent: this.cfg.agentId }).catch(() => 0);
    if (released) log('info', `notice reader: ${released} reading(s) left from the last run went back on the queue`);
    if (!this.client) {
      log('info', 'notice reader off: no ANTHROPIC_API_KEY in agent/.env');
      return;
    }
    log('info', 'notice reader on: reads notice PDFs with the Claude API while reading is switched on in the app');
    while (!this.stopping) {
      if (this.paused) { await this.nap(this.cfg.readerPollMs * 4); continue; }
      let claim: ReaderClaim | { capped: true } | null;
      try {
        claim = await this.db.rpc<ReaderClaim | { capped: true } | null>('notice_read_claim', { p_agent: this.cfg.agentId });
      } catch (e) {
        this.lastError = `claim failed: ${scrub((e as Error).message).slice(0, 200)}`;
        log('warn', `notice reader: ${this.lastError}`);
        await this.nap(this.cfg.readerPollMs * 2);
        continue;
      }
      if (!claim) {
        this.capped = false;
        await this.nap(this.cfg.readerPollMs);
        continue;
      }
      if ('capped' in claim) {
        if (!this.capped) log('info', 'notice reader: today\'s spending cap is reached; readings wait for tomorrow (or a higher cap)');
        this.capped = true;
        await this.nap(this.cfg.readerPollMs * 4);
        continue;
      }
      this.capped = false;
      this.lastClaimAt = new Date().toISOString();
      await this.runJob(claim);
      await this.nap(1000);
    }
  }

  private async runJob(claim: ReaderClaim): Promise<void> {
    this.busy = true;
    const ctl = new AbortController();
    this.current = ctl;
    const label = claim.reference_number || claim.notice_id;
    const started = Date.now();
    log('info', `notice reader: reading ${label}`);
    try {
      const f = await this.read(claim, ctl.signal);
      if (f.pause) {
        this.paused = PAUSES[f.pause] ?? `The notice reader is paused (${f.pause}) until the agent restarts.`;
        log('error', `notice reader: ${this.paused}`);
      }
      const reply = await this.finish(claim, f);
      if (reply?.error) {
        // Released and claimed again meanwhile (not_yours), or deleted (gone).
        this.lastError = `${label}: the database did not take the reading (${reply.error})`;
        log('warn', `notice reader: ${this.lastError}`);
        return;
      }
      if (f.status === 'done') {
        this.lastError = null;
        if (this.doneDay !== istDay()) { this.doneDay = istDay(); this.doneToday = 0; }
        this.doneToday++;
      } else {
        this.lastError = `${label}: ${f.error ?? f.reason ?? f.status}`.slice(0, 300);
      }
      const u = f.usage;
      const tokens = u ? ` · ${u.input_tokens} in / ${u.output_tokens} out tokens` : '';
      const what = f.status === 'done'
        ? `${reply?.outcome ?? 'done'}${reply?.applied?.length ? ` (${reply.applied.join(', ')})` : ''}${reply?.issues_added ? ` · ${reply.issues_added} issue(s)` : ''}`
        : `${f.status}${f.reason ? ` · ${f.reason}` : ''}`;
      log(f.status === 'done' ? 'info' : 'warn', `notice reader: ${label} → ${what}${tokens} · ${Math.round((Date.now() - started) / 1000)} s`);
    } catch (e) {
      // The database could not be told (it was unreachable after retries):
      // the reading stays with this agent and goes back on the queue when the
      // agent next starts or stops.
      this.lastError = `${label}: ${scrub((e as Error).message).slice(0, 200)}`;
      log('error', `notice reader: ${this.lastError}`);
    } finally {
      this.current = null;
      this.busy = false;
    }
  }

  private async read(claim: ReaderClaim, signal: AbortSignal): Promise<Finish> {
    if (!claim.document_url) return { status: 'failed', reason: 'no_document', error: 'The notice has no PDF to read.' };
    let doc: { bytes: Uint8Array; sha256: string };
    try {
      doc = await downloadPdf(claim.document_url, { signal, allow: (u) => documentUrlAllowed(u, this.cfg.supabaseUrl) });
    } catch (e) {
      return fromDocumentError(e, null);
    }
    const base = { document_sha256: doc.sha256 };
    let text: Awaited<ReturnType<typeof readPdfText>>;
    try {
      text = await readPdfText(doc.bytes, claim.max_pages);
    } catch (e) {
      return fromDocumentError(e, base);
    }
    if (text.pageCount > claim.max_pages) {
      return {
        status: 'failed', reason: 'too_long', result: { ...base, pages: text.pageCount },
        error: `The PDF has ${text.pageCount} pages; the reader reads at most ${claim.max_pages} (Settings).`,
      };
    }
    const meta = { ...base, pages: text.pageCount, text_layer: text.textLayer };
    if (signal.aborted) return { status: 'retry', reason: 'agent_stopped', error: 'The agent stopped before the notice was sent.', result: meta };
    const out = await readNotice(this.client!, {
      pdfBase64: Buffer.from(doc.bytes).toString('base64'),
      model: claim.model,
      effort: claim.effort,
      issueCodes: claim.issue_codes ?? [],
      signal,
    });
    if (!out.ok) {
      return { status: out.status, reason: out.reason, error: out.error, usage: out.usage, result: { ...meta, model: out.usage?.model ?? claim.model }, pause: out.pause };
    }
    const result = buildResult(out.reading, { pages: text.pages, pageCount: text.pageCount, textLayer: text.textLayer, sha256: doc.sha256 }, claim, out.model);
    return { status: 'done', result, usage: out.usage };
  }

  private async finish(claim: ReaderClaim, f: Finish): Promise<FinishReply | null> {
    return this.db.rpc<FinishReply | null>('notice_read_finish', {
      p_extraction_id: claim.extraction_id,
      p_agent: this.cfg.agentId,
      p_status: f.status,
      p_result: f.result ?? null,
      p_usage: f.usage ?? null,
      p_error: f.error ? scrub(f.error).slice(0, 1000) : null,
      p_reason_class: f.reason ?? null,
    });
  }
}

function fromDocumentError(e: unknown, result: Partial<ReadResult> | null): Finish {
  if (e instanceof DocumentError) {
    return { status: e.retryable ? 'retry' : 'failed', reason: e.reason, error: `The notice PDF: ${e.message}.`, result };
  }
  return { status: 'retry', reason: 'document', error: `The notice PDF: ${scrub((e as Error).message || String(e)).slice(0, 300)}`, result };
}
