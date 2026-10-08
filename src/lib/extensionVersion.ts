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
// 0.4.x to 0.8.0 are still allowed (their writes are safe), only nudged to update.
export const RECOMMENDED_EXTENSION_VERSION = '0.8.1';

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

export function updateRecommendedMessage(version: string | null | undefined): string {
  const scheduled = 'runs the scheduled syncs in the Chrome that has your CAPTCHA extension (tick "Run scheduled syncs in this Chrome" in its popup)';
  const refundDocs = 'reads the documents of new or changed refunds in the notices sync';
  const passwords = 'never retries a wrong or changed portal password: the client is logged and the sync moves on to the next one';
  const linking = "links each notice's own PDF, reply date, officer and DIN from its case folder";
  const gains = version && compareVersions(version, '0.8.0') >= 0
    ? passwords
    : version && compareVersions(version, '0.7.1') >= 0
    ? `${linking}, and ${passwords}`
    : version && compareVersions(version, '0.7.0') >= 0
    ? `also ${refundDocs}, ${linking}, and ${passwords}`
    : version && compareVersions(version, '0.6.0') >= 0
    ? `${scheduled}, and ${refundDocs}`
    : version && compareVersions(version, '0.5.0') >= 0
      ? `also reads applications on the portal (appeals and others), the registration status and the GSTR-3A period, and ${scheduled}`
      : `is faster (skips documents already saved), fills the sync run ledger, reads applications on the portal and the registration status, and ${scheduled}`;
  return `Browser extension v${version} still syncs, but v${RECOMMENDED_EXTENSION_VERSION} ${gains}. `
    + 'Reload it from the updated extension folder (chrome://extensions → Reload) when convenient.';
}
