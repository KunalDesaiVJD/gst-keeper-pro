// Profile/ID-card renderer for reference-data reports that aren't really
// tables at all — Taxpayer Information (a ['Field','Value'] list) and
// Download Registration Certificate (a single wide row ending in a PDF URL).
// A grid would bury a 9-row name/address/status list under spreadsheet
// chrome it doesn't need; this instead reads like a profile card: an
// identity header (avatar initials + the subtitle's client/GSTIN/period/ARN
// context as chips) followed by a two-column label/value grid, with any URL
// cell promoted to a prominent "View Certificate" button instead of a link
// buried in a row.
import React from 'react';
import type { ReportTable } from '@/utils/allClientsReports';
import type { ReportDefinition } from '@/lib/reportRegistry';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { FileText, ExternalLink, UserCircle2 } from 'lucide-react';

interface ProfileCardViewProps {
  table: ReportTable;
  report: ReportDefinition;
}

interface ProfileField {
  label: string;
  value: string | number;
}

const NUMERIC_HEADER_RE =
  /CGST|SGST|IGST|TOTAL|VALUE|AMOUNT|CLAIMED|LIABILITY|ITC|CESS|FEE|INTEREST|PAYABLE|PENALTY/i;

const isUrl = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\//.test(v);

const isSentinel = (v: string | number): boolean => {
  if (typeof v !== 'string') return false;
  const s = v.trim().toUpperCase();
  return s === 'NOT PULLED' || s === 'TOTAL' || /not captured|not pulled/i.test(v);
};

const isStatusLabel = (label: string) => /^status$/i.test(label.trim());

const statusVariant = (v: string): 'success' | 'warning' | 'destructive' | 'secondary' => {
  const s = v.toUpperCase();
  if (/ACKNOWLEDG|APPROV|SANCTION|FILED|ACCEPT|PROCESSED/.test(s)) return 'success';
  if (/PENDING|PROCESSING|SUBMIT/.test(s)) return 'warning';
  if (/FAIL|REJECT|DENIED|CANCEL/.test(s)) return 'destructive';
  return 'secondary';
};

const formatValue = (label: string, v: string | number): string => {
  if (typeof v === 'number') {
    return NUMERIC_HEADER_RE.test(label) ? v.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : String(v);
  }
  return v;
};

// Builds the flat list of {label, value} fields this card shows, generically
// off table.headers/table.rows — handles both real shapes seen for this
// archetype: a ['Field','Value'] table with one row per field, and a wide
// single-row table where every header IS the field label (e.g. the
// certificate report, whose last column is a URL).
const buildFields = (table: ReportTable): ProfileField[] => {
  const { headers, rows } = table;
  if (headers.length === 0 || rows.length === 0) return [];

  const isFieldValueShape =
    headers.length === 2 && /^field$/i.test(headers[0].trim()) && /^value$/i.test(headers[1].trim());

  if (isFieldValueShape) {
    return rows
      .filter((row) => !row.some((c) => String(c).trim().toUpperCase() === 'TOTAL'))
      .map((row) => ({ label: String(row[0] ?? ''), value: row[1] ?? '' }));
  }

  // Wide shape: every header is its own field label. Flatten every row's
  // columns (multi-row wide tables aren't expected for this archetype today,
  // but this still degrades sanely rather than only showing the first row).
  const fields: ProfileField[] = [];
  rows.forEach((row) => {
    headers.forEach((h, ci) => {
      const cell = row[ci];
      if (cell === undefined || cell === '') return;
      fields.push({ label: h, value: cell });
    });
  });
  return fields;
};

const initials = (name: string): string => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return words
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
};

export const ProfileCardView: React.FC<ProfileCardViewProps> = ({ table }) => {
  const fields = buildFields(table);
  const subtitleChips = table.subtitle
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);

  // The headline is whichever field reads as a name (Legal Name / Trade
  // Name), falling back to the report's own title for shapes that have none.
  const nameField = fields.find((f) => /legal name|trade name|^name$/i.test(f.label) && typeof f.value === 'string');
  const headline = (nameField?.value as string) || table.title;

  if (fields.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 flex flex-col items-center gap-2 text-center text-muted-foreground">
          <UserCircle2 className="h-8 w-8 opacity-50" />
          <p className="text-sm">No profile data available for this report yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b bg-primary/5">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary">
            {initials(headline)}
          </div>
          <div className="min-w-0">
            <CardTitle className="truncate text-xl">{headline}</CardTitle>
            {subtitleChips.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {subtitleChips.map((chip, i) => (
                  <Badge key={i} variant="outline" className="font-normal text-xs">
                    {chip}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-6">
        <div className="grid grid-cols-1 gap-x-10 gap-y-6 sm:grid-cols-2">
          {fields.map((field, i) => {
            const urlValue = isUrl(field.value) ? field.value : null;
            return (
              <div key={i} className={cn(urlValue && 'sm:col-span-2')}>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{field.label}</p>
                <div className="mt-1.5">
                  {urlValue ? (
                    <Button asChild size="sm">
                      <a
                        href={urlValue}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5"
                      >
                        <FileText className="h-3.5 w-3.5" />
                        View Certificate
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </Button>
                  ) : isStatusLabel(field.label) && field.value !== '' ? (
                    <Badge variant={statusVariant(String(field.value))}>{String(field.value)}</Badge>
                  ) : isSentinel(field.value) ? (
                    <Badge variant="outline" className="border-dashed font-normal text-muted-foreground">
                      Not pulled
                    </Badge>
                  ) : (
                    <p
                      className={cn(
                        'break-words text-sm font-medium text-foreground',
                        NUMERIC_HEADER_RE.test(field.label) && 'tabular-nums',
                      )}
                    >
                      {formatValue(field.label, field.value)}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};
