// Shared flag: while the Bulk Sync dialog is open it OWNS the CAPTCHA surface
// (it shows captchas for its own job set inline), so the global
// PortalCaptchaWatcher pauses to avoid two competing dialogs. Plain module state
// is enough — the watcher re-checks this each poll tick.
let active = false;

export const bulkSyncCaptcha = {
  setActive: (v: boolean) => { active = v; },
  isActive: () => active,
};
