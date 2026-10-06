// Minimum browser-extension version allowed to write portal data (Phase 0 of the
// notices roadmap). 0.4.0 is the first version that never marks saved notices
// missing after an empty or partly failed pull, checks the portal session's GSTIN
// before saving, and keeps portal passwords out of chrome.storage. Older copies
// are refused here; the database also turns their hard deletes into soft deletes.
export const MIN_EXTENSION_VERSION = '0.4.0';
// Phase 1: 0.5.0 writes through the database's single ingest door (sync_ingest),
// fills the run ledger, skips documents already stored and has the CAPTCHA
// watchdog. 0.4.x is still allowed (its writes are safe), only nudged to update.
export const RECOMMENDED_EXTENSION_VERSION = '0.5.0';

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
  return `Browser extension v${version} still syncs, but v${RECOMMENDED_EXTENSION_VERSION} is faster (skips documents already saved) `
    + 'and fills the sync run ledger. Reload it from the updated extension folder (chrome://extensions → Reload) when convenient.';
}
