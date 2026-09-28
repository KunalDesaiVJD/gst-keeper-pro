// Excel working papers of the Annual Return: the firm's MASTER_PMS.xlsx
// sheets (PL-OUTPUT … NOTICE FORMATE, DIFFERENCES) restyled as Big4 working
// papers with WP refs, plus a cover, index, sign-off, the portal figures used,
// the official GSTR-9C tables, payables with their set-offs and the revision
// history. Values, not formulas: every figure comes from computeWorkings();
// the only things read from the docs are what staff typed.
//
// The papers are built by export/papers.ts (renderer-agnostic) and laid out by
// export/excel.ts; ExcelJS is loaded on demand, so it is a separate chunk and
// never part of the main bundle.

import { downloadBlob } from './export/download';
import { exportFileName, type WorkingPapersInput } from './export/model';
import { buildWorkingPapers } from './export/papers';

export type { ExportMeta, WorkingPapersInput } from './export/model';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Build the workbook without downloading it (tests, previews). */
export async function buildWorkbook(input: WorkingPapersInput): Promise<{ name: string; buffer: ArrayBuffer }> {
  const set = buildWorkingPapers(input);
  const { renderWorkbook } = await import('./export/excel');
  const buffer = await renderWorkbook(set);
  return { name: exportFileName('GSTR9_Working', input.meta, 'xlsx'), buffer };
}

/** Build and download the Excel working papers. Returns the file name. */
export async function exportWorkbook(input: WorkingPapersInput): Promise<string> {
  const { name, buffer } = await buildWorkbook(input);
  downloadBlob(new Blob([buffer], { type: XLSX_MIME }), name);
  return name;
}
