/**
 * The GST portal password as GST Keeper saves it. The portal takes 8 to 15
 * characters, and a pasted password often carries a space at either end that
 * the portal then refuses (10 Oct 2026: MAHIL INFRA saved first with 17
 * characters, then with a leading space). The extension types the saved value
 * exactly, so it is cleaned and checked here, where it is saved.
 */
export const cleanPortalPassword = (raw: string | null | undefined): string => String(raw ?? '').trim();

/** Why the GST portal would never accept this (already cleaned) password, or null. */
export function portalPasswordProblem(pw: string): string | null {
  if (!pw) return null;
  if (pw.length < 8 || pw.length > 15) {
    return `The GST portal password must be 8 to 15 characters; this one is ${pw.length}. Check it on the portal and type it again.`;
  }
  return null;
}
