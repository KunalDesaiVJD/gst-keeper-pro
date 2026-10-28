// A PDF's pages as the model is given them, kept apart from pdf.ts (which loads
// pdf.js) so the functions that share cli.ts do not load it: which pages a long
// document is read by, and the text sent for the pages read.

// A page of a scanned file still counts as text with this many characters (a
// typed form among scanned annexures), not for a stamp or a page number.
export const PAGE_TEXT_CHARS = 150;

/**
 * The pages a long document is read by, at most `max` of them: its first pages
 * and its last few, where an order's decision, its amounts and its signature
 * are. All of them when the document is not longer than `max`.
 */
export function pagesToRead(pageCount: number, max: number): number[] {
  const all = Array.from({ length: pageCount }, (_, i) => i + 1);
  if (pageCount <= max) return all;
  const tail = Math.min(5, Math.floor(max / 4));
  return [...all.slice(0, max - tail), ...all.slice(pageCount - tail)];
}

/** Page numbers as a reader writes them: "1 to 35 and 81 to 85". */
export function pageRanges(nums: number[]): string {
  const runs: string[] = [];
  for (let i = 0; i < nums.length;) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    runs.push(j === i ? String(nums[i]) : `${nums[i]} to ${nums[j]}`);
    i = j + 1;
  }
  return runs.length > 1 ? `${runs.slice(0, -1).join(', ')} and ${runs[runs.length - 1]}` : runs[0] ?? '';
}

/**
 * The document as text for the model, page by page under each page's own
 * number, saying which pages are left out (a long document read in part, the
 * scanned pages of a file whose other pages are typed); null when there is no
 * text to send (a scan).
 */
export function pagesAsText(t: { pages: string[]; textLayer: boolean; read?: number[]; pageCount?: number | null }): string | null {
  const total = t.pageCount ?? t.pages.length;
  const read = t.read ?? t.pages.map((_, i) => i + 1);
  const chars = (n: number) => (t.pages[n - 1] ?? '').replace(/\s+/g, '').length;
  // A file with a text layer is sent whole (its short pages too); otherwise only its pages of text.
  const sent = t.textLayer ? read.filter((n) => (t.pages[n - 1] ?? '').trim()) : read.filter((n) => chars(n) >= PAGE_TEXT_CHARS);
  if (!sent.length) return null;
  const notes: string[] = [];
  if (t.read && t.read.length < total) {
    notes.push(`The PDF has ${total} pages and is too long to read whole: only pages ${pageRanges(t.read)} are given here; the pages between them are left out, so say nothing of what they hold.`);
  }
  const scanned = read.filter((n) => !sent.includes(n));
  if (scanned.length) {
    notes.push(`${scanned.length === 1 ? `Page ${scanned[0]} is a scanned image` : `Pages ${pageRanges(scanned)} are scanned images`} without a text layer, not given here.`);
  }
  return `The PDF document, as its text layer, page by page (quote it exactly as written here):${notes.length ? `\n${notes.join('\n')}` : ''}\n\n`
    + sent.map((n) => `--- Page ${n} ---\n${t.pages[n - 1]}`).join('\n\n');
}
