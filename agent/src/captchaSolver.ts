// OPTIONAL automatic CAPTCHA solver hook.
//
// This is intentionally left UNIMPLEMENTED and returns null (=> defer to a human).
//
// Automatically defeating the GST portal's login CAPTCHA is bypassing its
// bot-detection and is against GSTN's terms (IT Act 2000 s.43/45; the 9-Sep-2023
// advisory against scraping). For that reason the solver itself is NOT provided
// here — only this seam is.
//
// If your firm decides to add one (at your own risk, with client authorization),
// implement this function to return the solved CAPTCHA text, or null to fall back
// to the human-in-the-loop flow. Typical implementations:
//   - a local OCR model (Tesseract/EasyOCR) on the captcha image, or
//   - a solver service (e.g. 2Captcha / Anti-Captcha) via their API.
//
// login.ts calls this first; if it returns a non-empty string that string is used,
// otherwise the job parks as needs_human and a person types the CAPTCHA in the app.
export async function autoSolveCaptcha(_imagePngBuffer: Buffer): Promise<string | null> {
  return null;
}
