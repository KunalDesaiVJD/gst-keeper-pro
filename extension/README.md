# GST Keeper — Portal Sync (browser extension)

Pulls GST portal data into GST Keeper **from your own browser**. Because it runs on
your normal office connection (not a server/cloud IP), the portal treats it like a
normal user — **no firewall block, no server, no monthly cost.**

```
Your browser (normal IP) ──logs in + reads──▶ GST portal
        │
        └──writes 2B / ledger / filing status──▶ GST Keeper (Supabase)
```

## What it does today (v1)
- Logs into the portal for a chosen client (you type the CAPTCHA once, in an overlay).
- Pulls **Filing status** (ARN + filed date + status → `filing_status`).
- Pulls **Credit-ledger opening balance** (per head → Suspended Reco / GST Receivable Reco).
- *(GSTR-2B pull is the next addition — it needs file-download handling.)*

## Install it once per browser (free, ~1 minute)
1. Open **Chrome → `chrome://extensions`**.
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked** → select this **`extension`** folder.
4. Pin the **“GST Keeper — Portal Sync”** icon to the toolbar (optional).

That's it — nothing to keep running, no account, no card.

## Use it
1. Click the extension icon → pick a **client** and the **return period** → **Start sync**.
2. A GST-portal tab opens and logs in. **Type the CAPTCHA** in the popup that appears.
3. Watch the blue banner at the top of the tab: it logs in → reads filing status → reads
   the ledger → says **“done”**. The data is now in GST Keeper.
4. Repeat for the next client. (Each client is a separate portal login, so one CAPTCHA each.)

## Why this works when the cloud didn't
The GST portal's firewall blocks **datacenter/cloud IPs** (that's why the free cloud
agent got "Request Rejected"). This extension makes the requests from **your** browser
on **your** connection — the exact path that already works when you log in by hand.

## Notes / honest limits
- The browser tab must stay open while a sync runs (a minute or two per client). It's not
  a silent overnight job — but a person is there for the CAPTCHA anyway.
- Credentials are read from GST Keeper (same access the web app already has) and used only
  in your browser; nothing extra is stored.
- First run may need a small selector tweak if the portal markup shifts — the banner will
  say where it stopped.
