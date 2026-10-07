// Ported from agent/src/read/schema.ts for the notice-ai Edge Function (Deno);
// keep the two in step. The Edge copy also asks for each issue's paragraph
// text (issues[].text), which the assistant learns from.
// What the notice reader asks the Claude API to return, as a JSON schema for
// structured outputs (output_config.format), built once. The API limits union
// types (anyOf, ["string","null"]) to 16 a request, so nothing here is
// nullable: a value the notice does not state comes back as "" / 0 / page 0,
// and coerceReading() below turns that into "absent". No min/max/length
// constraints (structured outputs do not support them); limits such as the
// 200-character quote are in the instructions and checked in code.

export interface FieldOut {
  value: string;
  page: number;
  quote: string;
}
export interface HeadOut {
  tax: number;
  interest: number;
  penalty: number;
  fee: number;
  others: number;
}
export interface HeadsOut {
  igst: HeadOut;
  cgst: HeadOut;
  sgst: HeadOut;
  cess: HeadOut;
}
export interface DemandOut extends HeadsOut {
  stated: boolean;
  page: number;
  quote: string;
}
export interface IssueOut {
  issue_code: string;
  title: string;
  detail: string;
  period_from: string;
  period_to: string;
  demand: HeadsOut;
  amount: number;
  page: number;
  para: string;
  quote: string;
  text: string;
}

export const FIELD_KEYS = [
  'gstin', 'form_code', 'reference_number', 'din', 'issue_date', 'section_of_law', 'financial_year',
  'period_from', 'period_to', 'due_date', 'hearing_date', 'hearing_time', 'hearing_venue', 'officer',
] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

export type ReadingOut = Record<FieldKey, FieldOut> & {
  demand: DemandOut;
  issues: IssueOut[];
  documents_asked: string[];
  summary: string;
};

export const HEADS = ['igst', 'cgst', 'sgst', 'cess'] as const;
export type Head = (typeof HEADS)[number];
export const COMPONENTS = ['tax', 'interest', 'penalty', 'fee', 'others'] as const;
export type Component = (typeof COMPONENTS)[number];

const FIELD_HINTS: Record<FieldKey, string> = {
  gstin: 'GSTIN of the taxpayer the notice is addressed to',
  form_code: 'Form of the notice as printed, e.g. FORM GST DRC-01',
  reference_number: 'Reference number of the notice as printed',
  din: 'Document Identification Number (DIN) as printed',
  issue_date: 'Date of the notice, YYYY-MM-DD',
  section_of_law: 'Section of the Act the notice is issued under, as printed',
  financial_year: 'Financial year as printed',
  period_from: 'First day of the tax period covered, YYYY-MM-DD',
  period_to: 'Last day of the tax period covered, YYYY-MM-DD',
  due_date: 'Last date to reply or pay, YYYY-MM-DD',
  hearing_date: 'Date of the personal hearing, YYYY-MM-DD',
  hearing_time: 'Time of the personal hearing as printed',
  hearing_venue: 'Place of the personal hearing as printed',
  officer: 'Name and designation of the issuing officer as printed',
};

function field(description: string) {
  return {
    type: 'object',
    description,
    additionalProperties: false,
    required: ['value', 'page', 'quote'],
    properties: {
      value: { type: 'string' },
      page: { type: 'integer' },
      quote: { type: 'string' },
    },
  };
}
function head() {
  return {
    type: 'object',
    additionalProperties: false,
    required: [...COMPONENTS],
    properties: Object.fromEntries(COMPONENTS.map((c) => [c, { type: 'number' }])),
  };
}
function heads() {
  return Object.fromEntries(HEADS.map((h) => [h, head()]));
}

function buildSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: [...FIELD_KEYS, 'demand', 'issues', 'documents_asked', 'summary'],
    properties: {
      ...Object.fromEntries(FIELD_KEYS.map((k) => [k, field(FIELD_HINTS[k])])),
      demand: {
        type: 'object',
        description: 'Total demand in the notice, in rupees, by tax and component',
        additionalProperties: false,
        required: ['stated', ...HEADS, 'page', 'quote'],
        properties: {
          stated: { type: 'boolean' },
          ...heads(),
          page: { type: 'integer' },
          quote: { type: 'string' },
        },
      },
      issues: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['issue_code', 'title', 'detail', 'period_from', 'period_to', 'demand', 'amount', 'page', 'para', 'quote', 'text'],
          properties: {
            issue_code: { type: 'string' },
            title: { type: 'string' },
            detail: { type: 'string' },
            period_from: { type: 'string' },
            period_to: { type: 'string' },
            demand: {
              type: 'object',
              additionalProperties: false,
              required: [...HEADS],
              properties: heads(),
            },
            amount: { type: 'number' },
            page: { type: 'integer' },
            para: { type: 'string' },
            quote: { type: 'string' },
            text: { type: 'string' },
          },
        },
      },
      documents_asked: { type: 'array', items: { type: 'string' } },
      summary: { type: 'string' },
    },
  };
}

export const OUTPUT_SCHEMA: Record<string, unknown> = buildSchema();

// ── Reading the model's JSON defensively ───────────────────────────────────
// Structured outputs guarantee the shape on a normal stop; this still turns
// anything missing or mistyped into "absent" rather than throwing, so one odd
// value never loses the rest of a reading.
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const num = (v: unknown): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v.replace(/,/g, '')))) return Number(v.replace(/,/g, ''));
  return 0;
};
const int = (v: unknown): number => {
  const n = num(v);
  return Number.isInteger(n) && n > 0 ? n : 0;
};
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function coerceField(v: unknown): FieldOut {
  const o = obj(v);
  return { value: str(o.value).trim(), page: int(o.page), quote: str(o.quote) };
}
export function coerceHeads(v: unknown): HeadsOut {
  const o = obj(v);
  const out = {} as HeadsOut;
  for (const h of HEADS) {
    const x = obj(o[h]);
    out[h] = { tax: num(x.tax), interest: num(x.interest), penalty: num(x.penalty), fee: num(x.fee), others: num(x.others) };
  }
  return out;
}

export function coerceReading(json: unknown): ReadingOut {
  const o = obj(json);
  const fields = Object.fromEntries(FIELD_KEYS.map((k) => [k, coerceField(o[k])])) as Record<FieldKey, FieldOut>;
  const d = obj(o.demand);
  const demand: DemandOut = { stated: d.stated === true, ...coerceHeads(d), page: int(d.page), quote: str(d.quote) };
  const issues: IssueOut[] = (Array.isArray(o.issues) ? o.issues : []).map((v) => {
    const i = obj(v);
    return {
      issue_code: str(i.issue_code).trim(),
      title: str(i.title).trim(),
      detail: str(i.detail).trim(),
      period_from: str(i.period_from).trim(),
      period_to: str(i.period_to).trim(),
      demand: coerceHeads(i.demand),
      amount: num(i.amount),
      page: int(i.page),
      para: str(i.para).trim(),
      quote: str(i.quote),
      text: str(i.text).trim(),
    };
  });
  const documents_asked = (Array.isArray(o.documents_asked) ? o.documents_asked : [])
    .map((x) => str(x).trim()).filter((x) => x !== '');
  return { ...fields, demand, issues, documents_asked, summary: str(o.summary).trim() };
}
