# Run the agent 100% in the cloud (no office PC)

This puts the whole pull engine in the cloud. **No machine in your office does
anything** — not even a one-time install. The agent runs as a small always-on
container; the Vercel app queues jobs; the container processes them. The only
human touch is typing a CAPTCHA **in the web app** (from any phone/laptop) when a
client's login expires.

```
Vercel app --enqueue--> Supabase queue --poll--> CLOUD worker --> GST portal
     ^                                                 |
     └───────────── results + CAPTCHA prompt ──────────┘   (human types CAPTCHA in the app)
```

## Deploy it (once, all in the browser)

**Recommended: Render Blueprint** (no terminal, no PC)
1. The repo already contains `render.yaml` and `agent/Dockerfile`.
2. Go to <https://render.com> → sign in → **New +** → **Blueprint**.
3. Pick this GitHub repo → Render reads `render.yaml` and proposes a **worker**.
4. When asked, paste **`SUPABASE_SERVICE_ROLE_KEY`** (Supabase dashboard →
   Project Settings → API → `service_role` secret). Everything else is pre-filled.
5. **Apply.** Render builds the container and keeps it running 24/7, restarting it
   on crash. Done — nothing else to run, now or ever.

Within a minute the web app's Sync dialog flips to **"Agent online"** and it starts
draining the queue (the first login will ask a human for a CAPTCHA).

**Alternatives** (same container, different host):
- **Railway** — New Project → Deploy from repo → it builds `agent/Dockerfile` → set
  the same env vars. Usage-based (~a few $/mo).
- **Fly.io** — `fly launch` in the `agent` folder (uses the Dockerfile) → `fly secrets
  set SUPABASE_SERVICE_ROLE_KEY=...` → `fly deploy`. (Needs the Fly CLI once.)
- **Any VPS** (DigitalOcean/Hetzner) — `docker build -t agent ./agent && docker run -d
  --restart=always --env-file .env agent`.

## Cost
An always-on worker is a **paid instance everywhere** (there's no free 24/7 tier),
roughly **US$5–7/month**. That's the trade for "no office PC."

## Honest trade-off: cloud IP vs. the GST portal
The GST portal is stricter with **datacenter IPs** (what cloud hosts use) than with a
normal office/residential IP. In practice this can mean **more frequent CAPTCHAs**, or
occasionally a login that's refused until retried. If the portal turns out to block the
cloud IP, the fix is to route the agent through a **residential/business proxy** (set
`HTTP_PROXY`/`HTTPS_PROXY` env vars + a proxy provider — a small extra cost). This only
matters if you actually hit blocks; try the plain cloud deploy first.

> This is the one thing an office PC does better (its IP looks "normal" to the portal).
> Cloud wins on "zero machine effort"; an office PC wins on looking like a real user.
> Both are supported — see `install-agent.bat` for the office-PC route.

## What stays the same
- Secrets live only in the cloud host's env vars — never in the app or git.
- CAPTCHA is still human, but typed in the **web app** from anywhere (not on any PC).
- Everything else (queue, verification, save-only scope) is unchanged.
