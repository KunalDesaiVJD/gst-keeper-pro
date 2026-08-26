/**
 * Splits clipboard text copied from Excel/Google Sheets into rows of cell
 * strings — rows are newline-separated, cells are tab-separated. Used by
 * every "Paste from Excel" import in the Annual Return module so staff can
 * paste a block of rows instead of typing one field at a time.
 */
export function parseTsvBlock(text: string): string[][] {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split('\t').map((cell) => cell.trim()));
}
