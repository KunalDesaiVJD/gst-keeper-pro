# Portal Agent — First-Time Setup (one page, one time only)

Do this **once** on the always-on office PC. After that, nobody touches a terminal
again — the agent runs itself, and the only daily action is typing a CAPTCHA.

---

## Setup (≈10 minutes, once)

**1. Install Node.js** (skip if already installed)
   - Go to <https://nodejs.org/> → download the **LTS** version → run the installer → click Next/Finish.

**2. Get your Supabase service-role key** (you'll paste it in step 3)
   - Open the Supabase dashboard → your project → **Project Settings** → **API**.
   - Under "Project API keys", copy the **`service_role`** key (the secret one — *not* the anon key).

**3. Run the installer**
   - Open the `agent` folder → **double-click `install-agent.bat`**.
   - When it asks, **paste the service-role key** and press Enter.
   - Let it finish (it installs everything and downloads a browser — a few minutes the first time).
   - When you see **"DONE — the agent is running"**, close the window.

✅ That's it. The agent now starts automatically every time the PC turns on, and
restarts itself if it ever stops.

---

## Daily use (the whole team)

1. In the app, click the **blue globe** button (bottom-right) → **Sync from portal**.
2. Choose **1 client / selected clients / all clients** → **Import everything**.
3. When a **CAPTCHA** pops up, type the characters shown and Submit. (Only when a
   client's login has expired — a session is reused for hours.)
4. Watch the chips turn green. 2B, ledger opening, and filed-return ARNs land in the app.

---

## If something looks off

- **App says "Agent offline"?** Make sure the office PC is **on and signed in**.
  The agent starts at logon; if the PC was fully logged out it won't be running.
- **Want to re-do setup / moved PCs?** Just double-click `install-agent.bat` again.
- **Stop / remove the agent?** Double-click `uninstall-agent.bat` (your settings are kept).

> Keep the office PC powered on and signed in. Credentials live only in the local
> `.env` on that PC — never in the app or in git.
