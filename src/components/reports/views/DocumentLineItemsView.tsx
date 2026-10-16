// Archetype: DocumentLineItemsView
//
// Renders the highest-row-count report shape in the Reports Hub: the portal
// document-level GSTR-2A / 2B pulls (hundreds of invoices a month, thousands
// over a quarter), the rate-wise, supplier-wise and P.Y.-in-C.Y. reports and
// the GSTR-1 family. Generic over table.headers / table.rows: no fixed column
// indices, no new fetching.
//
// A reviewer works such a list from every angle, so every column can be
// filtered from its header (tick values, "contains", a figure range, a date
// range), sorted, and grouped with subtotals; columns can be hidden; and the
// list exports exactly as shown to the house Excel / PDF. All of that is the
// table kit (./tableKit: useTableKit, its toolbar, header, table and pager),
// which other views share; its rules live in ./tableKit/tableModel.ts, tested
// by scripts/verify-doc-table-model.mjs.
//
// Kept from the first version: the summary strip of grand totals before
// anyone scrolls, the TOTAL pinned under the list, status badges, "View" links
// for a PDF column and the dashed "Not Pulled" sentinel.
import React from 'react';
import type { ReportTable } from '@/utils/allClientsReports';
import type { ReportDefinition } from '@/lib/reportRegistry';
import { REPORT_STATUS_META } from '@/lib/reportRegistry';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/gstr9/badge';
import { KpiTile } from '@/components/gstr9/ui';
import { TableKitEmpty, TableKitPager, TableKitTable, TableKitToolbar, useTableKit } from './tableKit';

interface DocumentLineItemsViewProps {
  table: ReportTable;
  report: ReportDefinition;
}

const MONTH_LABEL_RE = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s-]+\d{2,4}$/i;

export const DocumentLineItemsView: React.FC<DocumentLineItemsViewProps> = ({ table, report }) => {
  // What was chosen resets when a different report (or a different column
  // set) is opened, and stays when the same report refreshes after a Pull.
  const kit = useTableKit(table, { resetKey: report.key });
  const { model, view } = kit;

  // A merge keeps the first month's subtitle; its month is not the report's period.
  const subtitleParts = table.subtitle.split('|').map((s) => s.trim()).filter(Boolean)
    .filter((s) => !model.merged || !(MONTH_LABEL_RE.test(s) || /^(period|month|return period):/i.test(s)));
  const hasAnyData = table.rows.length > 0;

  return (
    // The card fills the preview so the list takes the room left and its TOTAL and pager stay in sight.
    <Card className="flex h-full min-h-0 flex-col">
      <CardHeader className="space-y-0 px-4 pb-2 pt-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <report.icon className="h-4 w-4 shrink-0 text-primary" />
              <CardTitle className="text-[15px] leading-snug">{table.title || report.title}</CardTitle>
              <Badge variant={REPORT_STATUS_META[report.status].badgeVariant} className="text-[10px] font-medium">
                {REPORT_STATUS_META[report.status].shortLabel}
              </Badge>
            </div>
            {subtitleParts.length > 0 && (
              <CardDescription className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                {subtitleParts.map((part, i) => (
                  <span key={i} className="flex items-center gap-2">
                    {i > 0 && <span className="text-muted-foreground/40">•</span>}
                    {part}
                  </span>
                ))}
              </CardDescription>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col gap-2.5 px-4 pb-3">
        {!hasAnyData && <TableKitEmpty />}

        {hasAnyData && (
          <>
            {/* Summary strip: the totals before anyone scrolls; once filtered, the rows shown against the whole. */}
            {kit.totals.length > 0 && (
              <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2">
                <KpiTile
                  label={view.filtered ? 'Rows shown' : 'Rows'}
                  value={(view.filtered ? view.rows.length : model.data.length).toLocaleString('en-IN')}
                  hint={view.filtered ? `of ${model.data.length.toLocaleString('en-IN')}` : model.merged ? `${model.periods.length} periods` : undefined}
                />
                {kit.totals.map((s) => (
                  <KpiTile
                    key={s.col}
                    label={model.columns[s.col].name}
                    value={kit.figure(s.col, s.shown ?? s.total)}
                    hint={s.shown !== null ? `of ${kit.figure(s.col, s.total)}` : undefined}
                  />
                ))}
              </div>
            )}

            <TableKitToolbar kit={kit} searchPlaceholder="Search supplier, GSTIN, invoice no., amount…" />
            <TableKitTable kit={kit} />
            <TableKitPager kit={kit} />
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default DocumentLineItemsView;
