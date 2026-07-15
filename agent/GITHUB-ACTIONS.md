# Free cloud agent via GitHub Actions (no card, no office PC)

This runs the agent **on GitHub's cloud, for free** — no credit card, nothing
installed on any machine. Your repo is already on GitHub, so you just flip it on.

```
Vercel app --enqueue--> Supabase queue --every 30 min / on demand--> GitHub Actions --> GST portal
```

## One-time setup (all free, all in the browser)

**1. Add the session table to Supabase** (once)
   - Supabase dashboard → **SQL Editor** → paste the contents of
     `supabase/migrations/20260715120000_portal_sessions.sql` → **Run**.
   - (This stores each client's login session so the agent doesn't ask for a
     CAPTCHA on every run.)

**2. Add your Supabase key as a GitHub secret** (once)
   - GitHub repo → **Settings** → **Secrets and variables** → **Actions** →
     **New repository secret**.
   - Name: `SUPABASE_SERVICE_ROLE_KEY`
   - Value: your Supabase **service_role** key (Supabase → Project Settings → API).
   - Save. (This is a secret box, *not* a card.)

**3. Turn on Actions**
   - GitHub repo → **Actions** tab → if prompted, click to enable workflows.

Done. From now on it runs itself.

## How it works / daily use
- The workflow runs **every 30 minutes** automatically. Each run checks the queue;
  if there's nothing to do it ends in seconds (so it stays inside the free minutes).
- Your team clicks **Sync from portal** in the app as usual. Within ≤30 minutes the
  next run picks the jobs up and processes them.
- **Want it instant?** GitHub repo → **Actions** → **Portal Agent** → **Run workflow**.
  It starts immediately.
- When a client's login needs a fresh **CAPTCHA**, the run shows it in the app for a
  human to type (you have a few minutes). Once a session is established it's **reused
  for hours**, so most runs need no CAPTCHA.

## Honest trade-offs
- **Up to ~30-min delay** on the automatic schedule (free-minute limit). Use
  **Run workflow** for instant, or ask me to add the on-demand trigger (below).
- **CAPTCHA timing:** the run must be *live* when someone types the CAPTCHA (a ~3-min
  window). Easiest flow: click **Run workflow** (or Sync), keep the app open, and type
  the CAPTCHA when it appears. After that, it's hands-off for hours.
- **Datacenter IP:** GitHub's servers use datacenter IPs, which the GST portal treats
  more suspiciously than an office IP — expect **somewhat more CAPTCHAs**, occasionally
  a refused login that retries.
- **Free minutes:** a private repo gets 2000 free Action-minutes/month; the 30-min
  schedule uses well under that. If you make the repo **public**, minutes are unlimited
  and the schedule can be more frequent.

## Optional upgrade — instant, on-demand (v2)
To skip the ≤30-min wait entirely, a small **Supabase Edge Function** can trigger a
GitHub run the moment your team clicks Sync (via `repository_dispatch`). That needs a
GitHub token stored in Supabase. Ask and I'll wire it — the workflow already listens
for the `portal-sync` dispatch event.
