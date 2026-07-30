/**
 * The unit import template.
 *
 * A promoter's inventory arrives as a spreadsheet, always. The template gives
 * that spreadsheet a known shape so it can be read back without guesswork, and
 * — the part that matters more — it carries the **charge heads**, which plain
 * paste cannot. That is not a convenience: a charge head is what pushes a unit
 * past ₹45 lakh and out of the 1.5% affordable bracket, so a unit list imported
 * without its charges can classify correctly today and be wrong the moment the
 * charges are entered by hand later.
 *
 * Columns are matched **by header name, not position**, so a client who inserts
 * a column of their own, reorders two, or deletes the ones they do not use
 * still imports cleanly. Only "Unit No" is structurally required.
 *
 * The layout follows the existing Bulk Client Import template — title,
 * instructions, blank, header, samples — so the two feel like one system.
 */

import * as XLSX from 'xlsx';
import {
  CHARGE_HEADS, CHARGE_HEAD_LABEL, CHARGE_HEAD_SETTING_KEY,
  type ChargeHead, type ChargeInclusionSettings, type UnitCharge, type UnitType,
} from './builderRates';
import { BULK_UNIT_STATUSES, parseAmount, type DraftUnit } from './builderBulkUnits';

/** A draft carrying the charge heads the template can express. */
export interface DraftUnitWithCharges extends DraftUnit {
  charges: UnitCharge[];
}

const CORE_HEADERS = {
  unitNo: 'Unit No*',
  type: 'Type',
  carpet: 'RERA Carpet Area (sq m)',
  consideration: 'Base Consideration',
  status: 'Status',
} as const;

/** Header text for a charge-head column. Kept in one place so write and read agree. */
const chargeHeader = (h: ChargeHead): string => CHARGE_HEAD_LABEL[h];

/**
 * Normalise a header cell for matching: lower case, collapse whitespace, drop
 * the required-marker and any parenthetical unit hint. So "RERA Carpet Area
 * (sq m)", "rera carpet area" and "Carpet Area*" all land on the same key.
 */
const normaliseHeader = (s: unknown): string =>
  String(s ?? '')
    .toLowerCase()
    .replace(/\*/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export function buildUnitTemplateWorkbook(params: {
  projectName?: string;
  groupingLabel?: string;
  groupNames?: string[];
  /** Client elections, so the template can say which heads actually count. */
  settings?: ChargeInclusionSettings;
  isMetro?: boolean;
}): XLSX.WorkBook {
  const groupingLabel = params.groupingLabel || 'Block';
  const groups = params.groupNames || [];
  const areaLimit = params.isMetro ? 60 : 90;

  const headers = [
    CORE_HEADERS.unitNo,
    CORE_HEADERS.type,
    CORE_HEADERS.carpet,
    CORE_HEADERS.consideration,
    CORE_HEADERS.status,
    groupingLabel,
    ...CHARGE_HEADS.map(chargeHeader),
  ];

  const rows: unknown[][] = [
    [`Unit Import Template${params.projectName ? ` — ${params.projectName}` : ''}`],
    ['Fill in one row per unit. Only Unit No is required. Amounts may be plain numbers; '
      + '₹ signs and comma grouping are also accepted. Do not delete or rename the header row.'],
    [`Type: Residential or Commercial. Status: ${BULK_UNIT_STATUSES.join(' / ')}. `
      + `${groupingLabel}: ${groups.length ? groups.join(' / ') : `create ${groupingLabel.toLowerCase()}s in the app first, or leave blank`}.`],
    [],
    headers,
    ['101', 'Residential', 58, 4200000, 'Booked', groups[0] || '', 150000, 75000, 200000, 50000, 25000, 15000, 100000, 0],
    ['102', 'Residential', 72, 5100000, 'Available', groups[0] || '', 0, 75000, 200000, 50000, 25000, 15000, 100000, 0],
    ['S-1', 'Commercial', 30, 2500000, 'Available', groups[0] || '', 0, 0, 0, 0, 25000, 15000, 0, 0],
  ];

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 12 }, { wch: 14 }, { wch: 22 }, { wch: 20 }, { wch: 12 }, { wch: 16 },
    ...CHARGE_HEADS.map(() => ({ wch: 30 })),
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Units');

  // ── Reference sheet ──────────────────────────────────────────────────────
  // The rate is derived, never typed, and the person filling this in is usually
  // the client's accounts staff rather than ours. Saying what drives the rate
  // is what stops a carpet area arriving in square feet.
  const included = (h: ChargeHead) => {
    const key = CHARGE_HEAD_SETTING_KEY[h] as keyof ChargeInclusionSettings;
    return params.settings ? params.settings[key] !== false : true;
  };

  const ref: unknown[][] = [
    ['How to fill this template'],
    [],
    ['Column', 'Required', 'What to enter'],
    [CORE_HEADERS.unitNo, 'Yes', 'Any identifier — 101, A-101, Shop 4. Must be unique within the project.'],
    [CORE_HEADERS.type, 'No', 'Residential or Commercial. Blank is treated as Residential.'],
    [CORE_HEADERS.carpet, 'No', `RERA carpet area in SQUARE METRES, not square feet. Drives the ${areaLimit} sq m affordable limit.`],
    [CORE_HEADERS.consideration, 'No', 'Base price excluding GST and excluding the charge heads below.'],
    [CORE_HEADERS.status, 'No', `One of: ${BULK_UNIT_STATUSES.join(', ')}. Blank is treated as Available.`],
    [groupingLabel, 'No', `Must match a ${groupingLabel.toLowerCase()} already created in the app. Blank leaves the unit ungrouped.`],
    [],
    ['Charge head', 'Counts toward ₹45 lakh?', 'Notes'],
    ...CHARGE_HEADS.map((h) => [
      CHARGE_HEAD_LABEL[h],
      included(h) ? 'Yes' : 'No',
      included(h)
        ? 'Included in gross amount charged, per this client\'s confirmed election.'
        : 'Excluded for this client. Recorded but not counted toward the limit.',
    ]),
    [],
    ['How the rate is decided — you do not enter it'],
    ['A residential unit is affordable only if BOTH hold: RERA carpet area is at most '
      + `${areaLimit} sq m, AND the gross amount charged is at most ₹45,00,000.`],
    ['Gross amount charged = base consideration + every charge head marked "Yes" above. '
      + 'Stamp duty, registration and GST itself are never part of it.'],
    ['Affordable residential 1.5% (eff. 1%) · Other residential 7.5% (eff. 5%) · '
      + 'Commercial in an RREP 7.5% (eff. 5%) · Commercial in a REP other than RREP 18% (eff. 12%).'],
    ['Every unit\'s derived rate is shown in the preview before anything is saved. Check it there.'],
  ];
  const refWs = XLSX.utils.aoa_to_sheet(ref);
  refWs['!cols'] = [{ wch: 38 }, { wch: 24 }, { wch: 86 }];
  XLSX.utils.book_append_sheet(wb, refWs, 'How to fill');

  return wb;
}

/** Build and save the template. */
export function downloadUnitTemplate(params: Parameters<typeof buildUnitTemplateWorkbook>[0]): void {
  const wb = buildUnitTemplateWorkbook(params);
  const stem = (params.projectName || 'Project').replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40);
  XLSX.writeFile(wb, `Unit_Import_Template_${stem}.xlsx`);
}

export interface ParsedTemplate {
  drafts: DraftUnitWithCharges[];
  /** Rows that carried data but no unit number, so could not be used. */
  skippedRows: number;
  /** Set when the sheet had no recognisable header row. */
  error?: string;
}

/**
 * Read a filled template back.
 *
 * Accepts the template as issued, and also a bare sheet with just a header row
 * — clients routinely rebuild the file rather than filling ours in.
 */
export function parseUnitWorkbook(
  data: ArrayBuffer,
  groups: { id: string; name: string }[],
): ParsedTemplate {
  const wb = XLSX.read(data, { type: 'array' });
  // Prefer the sheet we named; otherwise take the first one, since a rebuilt
  // file will not be called "Units".
  const sheetName = wb.SheetNames.find((n) => n.toLowerCase() === 'units') || wb.SheetNames[0];
  if (!sheetName) return { drafts: [], skippedRows: 0, error: 'The file has no sheets.' };

  const grid = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    header: 1, blankrows: false, defval: '',
  }) as unknown[][];

  // Find the header row rather than assuming its index: the template ships it
  // at row 5, but an edited file moves it.
  const headerIdx = grid.findIndex(
    (row) => row.some((c) => normaliseHeader(c) === normaliseHeader(CORE_HEADERS.unitNo)),
  );
  if (headerIdx === -1) {
    return {
      drafts: [], skippedRows: 0,
      error: 'Could not find a "Unit No" column. Use the downloaded template, or make sure the '
        + 'header row includes a column called "Unit No".',
    };
  }

  const header = grid[headerIdx].map(normaliseHeader);
  const col = (label: string) => header.indexOf(normaliseHeader(label));

  const idx = {
    unitNo: col(CORE_HEADERS.unitNo),
    type: col(CORE_HEADERS.type),
    carpet: col(CORE_HEADERS.carpet),
    consideration: col(CORE_HEADERS.consideration),
    status: col(CORE_HEADERS.status),
  };
  // The grouping column is whatever the project calls it, so match any of the
  // four permitted labels rather than only the one this project uses.
  const groupIdx = ['Block', 'Wing', 'Tower', 'Phase']
    .map((l) => col(l)).find((i) => i >= 0) ?? -1;

  const chargeIdx = CHARGE_HEADS
    .map((h) => ({ head: h, i: col(chargeHeader(h)) }))
    .filter((c) => c.i >= 0);

  const at = (row: unknown[], i: number): string => (i >= 0 ? String(row[i] ?? '').trim() : '');

  let skippedRows = 0;
  const drafts: DraftUnitWithCharges[] = [];

  for (const row of grid.slice(headerIdx + 1)) {
    // A row is only worth complaining about if it carried something.
    const hasAnything = row.some((c) => String(c ?? '').trim() !== '');
    const unitNo = at(row, idx.unitNo);
    if (!unitNo) { if (hasAnything) skippedRows++; continue; }

    const typeRaw = at(row, idx.type).toLowerCase();
    const statusRaw = at(row, idx.status);
    const groupRaw = at(row, groupIdx).toLowerCase();

    drafts.push({
      unit_no: unitNo,
      unit_type: (typeRaw.startsWith('c') ? 'Commercial' : 'Residential') as UnitType,
      carpet_area_sqm: parseAmount(at(row, idx.carpet)),
      base_consideration: parseAmount(at(row, idx.consideration)),
      status: BULK_UNIT_STATUSES.find((s) => s.toLowerCase() === statusRaw.toLowerCase())
        || 'Available',
      group_id: groups.find((g) => g.name.toLowerCase() === groupRaw)?.id ?? null,
      charges: chargeIdx
        .map(({ head, i }) => ({ charge_head: head, amount: parseAmount(at(row, i)) }))
        // A zero is the same as not charging it; keeping the row would only add
        // noise to the unit's charge list and to every working paper after it.
        .filter((c) => c.amount > 0),
    });
  }

  return { drafts, skippedRows };
}
