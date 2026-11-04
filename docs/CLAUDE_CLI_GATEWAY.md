# GST Keeper's Claude CLI gateway (retired 4 November 2026)

`api/claude-cli.ts` (a Vercel function that ran the Claude Code CLI in a Vercel Sandbox on
the firm's subscription, built 29 October 2026) and its dependency `@vercel/sandbox` are
removed. The AI Edge Functions now call the Claude API directly: read
[`CLAUDE_API_KEY.md`](./CLAUDE_API_KEY.md).

The client side of a gateway (`supabase/functions/notice-ai/cli.ts`) is kept only as the last
fallback, used when no Claude API key is set and the secrets `CLAUDE_CLI_GATEWAY_URL` /
`CLAUDE_CLI_GATEWAY_SECRET` still are. On 4 November 2026 those secrets pointed at the
gateway of the firm's other Vercel project (caflow-core-ui), not at this one: GST Keeper's own
gateway was never given its Vercel variables. Once the Claude API key works, those Supabase
secrets (and `CLAUDE_CLI_GATEWAY_FILES`) can be taken off; nothing else in this project calls
a gateway.
