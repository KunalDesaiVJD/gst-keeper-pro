// Minimum browser-extension version allowed to write portal data (Phase 0 of the
// notices roadmap). 0.4.0 is the first version that never marks saved notices
// missing after an empty or partly failed pull, checks the portal session's GSTIN
// before saving, and keeps portal passwords out of chrome.storage. Older copies
// are refused here; the database also turns their hard deletes into soft deletes.
export const MIN_EXTENSION_VERSION = '0.4.0';
// Phase 1: 0.5.0 writes through the database's single ingest door (sync_ingest),
// fills the run ledger, skips documents already stored and has the CAPTCHA
// watchdog. Phase 3: 0.6.0 also reads applications on the portal, the
// registration status and the GSTR-3A period, and is what the office agent runs.
// 0.7.0 runs the autopilot's scheduled syncs in the firm's own Chrome ("Run
// scheduled syncs in this Chrome"; its CAPTCHA extension fills the CAPTCHA).
// 0.7.1 also reads the documents of new or changed refunds in the notices sync
// and leaves every other pull exactly as 0.3.3 ran it. 0.8.0 links each notice's
// own PDF, reply date, officer and DIN from its case folder. 0.8.1 offers a
// password the portal refused only once: a bulk or scheduled sync logs that
// client and moves on, and skips it until the password is changed.
// 0.8.2 also leaves the portal's change-password page at once and skips every
// client with a password issue recorded in GST Keeper (Notices · Settings).
// 0.8.3 records a CAPTCHA the portal kept rejecting as a CAPTCHA failure
// (captcha_failed, retried), never as a password issue.
// 0.8.4 pushes a NIL GSTR-1 and pulls e-invoices (its IRN attach on a push is
// dropped in 0.8.7);
// 0.8.5 records a NIL push in Filing Status itself, even if the page was closed.
// 0.8.6 records every GSTR-3B push in Push History itself (filled, partial or
// failed; a filled one shows Pushed), names the client and period in every push
// result, and lets Refresh errors record an upload the portal processed.
// 0.8.7 keeps every e-invoice's IRN on the portal: the GSTR-1 push leaves out
// the documents already there as e-invoices (the page's einvoice.keep) instead
// of re-sending them, never writes an IRN field, and the e-invoice pull checks
// the file's GSTIN and period and drops e-invoices the portal no longer holds.
// 0.4.x to 0.8.6 are still allowed (their writes are safe), only nudged to update.
export const RECOMMENDED_EXTENSION_VERSION = '0.9.1';

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function isExtensionOutdated(version: string | null | undefined): boolean {
  return !version || compareVersions(version, MIN_EXTENSION_VERSION) < 0;
}

export function outdatedExtensionMessage(version: string | null | undefined): string {
  return `The browser extension${version ? ` (v${version})` : ''} is out of date. Load v${MIN_EXTENSION_VERSION} or later `
    + '(chrome://extensions → Reload, from the updated extension folder) before syncing: older copies can remove saved notices when the portal returns an error.';
}

export function isExtensionUpdateRecommended(version: string | null | undefined): boolean {
  return !!version && !isExtensionOutdated(version) && compareVersions(version, RECOMMENDED_EXTENSION_VERSION) < 0;
}

/** What each version added, newest last — the nudge lists what the user's copy is missing. */
const GAINS: [string, string][] = [
  ['0.5.0', 'is faster (skips documents already saved) and fills the sync run ledger'],
  ['0.6.0', 'reads applications on the portal (appeals and others), the registration status and the GSTR-3A period'],
  ['0.7.0', 'runs the scheduled syncs in the Chrome that has your CAPTCHA extension (tick "Run scheduled syncs in this Chrome" in its popup)'],
  ['0.7.1', 'reads the documents of new or changed refunds in the notices sync'],
  ['0.8.0', "links each notice's own PDF, reply date, officer and DIN from its case folder"],
  ['0.8.1', 'never retries a wrong or changed portal password: the client is logged and the sync moves on'],
  ['0.8.2', "leaves the portal's change-password page at once and skips every client with a password issue listed in Notices · Settings"],
  ['0.8.3', 'records a CAPTCHA the portal kept rejecting as a CAPTCHA failure, never as a password issue'],
  ['0.8.4', 'pushes NIL GSTR-1 returns and pulls e-invoices'],
  ['0.8.5', 'records a NIL push in Filing Status itself, even if the page was closed'],
  ['0.8.6', 'records every GSTR-3B push itself (so a filled one shows Pushed even if the page was closed), says which client and period each push was for, no longer types into the cess box of an import row, and lets Refresh errors record an upload the portal processed'],
  ['0.8.7', "keeps every e-invoice's IRN on the portal by leaving e-invoices out of the upload"],
  ['0.8.8', "never pushes inside another client's portal session, flags a saved password the portal cannot accept, and waits for the portal's GSTR-1 file on an e-invoice pull"],
  ['0.8.9', "says in exact numbers what an e-invoice pull read: the GSTR-1 file's documents, how many carry an IRN, and how they compare with the e-invoice Excel"],
  ['0.9.0', "the e-invoice pull opens the month's GSTR-1 on the portal and downloads and imports its e-invoice details (Excel) by itself"],
  ['0.9.1', "says only what the GSTR-1 file and the month's e-invoice details show, and checks the e-invoice import by the database's clock"],
];

export function updateRecommendedMessage(version: string | null | undefined): string {
  const missing = GAINS
    .filter(([v]) => (!version || compareVersions(v, version) > 0) && compareVersions(v, RECOMMENDED_EXTENSION_VERSION) <= 0)
    .map(([, text]) => text);
  // The newest three, so the message stays readable for a very old copy.
  const shown = missing.slice(-3);
  const list = shown.length > 1 ? `${shown.slice(0, -1).join('; ')}; and ${shown[shown.length - 1]}` : shown[0] ?? 'has the latest fixes';
  return `Browser extension v${version} still syncs, but v${RECOMMENDED_EXTENSION_VERSION} ${list}${missing.length > 3 ? ', among other fixes' : ''}. `
    + 'Reload it from the updated extension folder (chrome://extensions → Reload) when convenient.';
}
