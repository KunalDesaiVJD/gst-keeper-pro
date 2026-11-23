// The GST Assistant's one way to Claude (23 Nov 2026): the Claude API with the
// key saved from the app (or the ANTHROPIC_API_KEY secret, ../_shared/claudeKey.ts),
// always Sonnet at medium effort (../_shared/aiModel.ts), whatever a request
// names. One call is one turn of the tool loop in index.ts; the caller adds up
// the tokens of every turn and records them per user (assistant_usage).

import Anthropic from '@anthropic-ai/sdk';
import { AI_EFFORT, AI_MODEL } from '../_shared/aiModel.ts';

export type Msg = Anthropic.Beta.Messages.BetaMessageParam;
export type Tool = Anthropic.Beta.Messages.BetaTool;
export type Block = Anthropic.Beta.Messages.BetaContentBlock;
export type SystemBlock = Anthropic.Beta.Messages.BetaTextBlockParam;

export interface TurnUsage { input: number; output: number; cacheRead: number; cacheWrite: number }

export function makeClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, authToken: null, maxRetries: 2, timeout: 120_000 });
}

/** One turn: the request as sent is always the one model at the one effort. */
export async function assistantTurn(client: Anthropic, req: { system: SystemBlock[]; tools: Tool[]; messages: Msg[] }) {
  const msg = await client.beta.messages.create({
    model: AI_MODEL,
    max_tokens: 12_000,
    thinking: { type: 'adaptive' },
    output_config: { effort: AI_EFFORT },
    system: req.system,
    tools: req.tools,
    messages: req.messages,
  });
  const u = msg.usage as unknown as Record<string, number | null | undefined>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const usage: TurnUsage = {
    input: n(u.input_tokens),
    output: n(u.output_tokens),
    cacheRead: n(u.cache_read_input_tokens),
    cacheWrite: n(u.cache_creation_input_tokens),
  };
  return { msg, usage, model: msg.model || AI_MODEL };
}

/** Keys never reach a log, the database or an answer. */
export function scrub(s: string): string {
  return s.replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-…');
}
