// Shared class names for the Annual Return (GSTR-9/9C) look, so the working
// pages (Filing Status, GSTR-1, GSTR-3B, GST Working, GST Update Sheet) read as
// one system: dense grids (text-sm figures) with a muted sticky header, compact h-8
// controls, labelled filter toolbars. Components to pair with these:
//   PageHeader `compact`        — src/components/layout/PageHeader.tsx
//   KpiTile, Note, Money, SectionCard — src/components/gstr9/ui.tsx
//   Badge (readable tones)      — src/components/gstr9/badge.tsx
//   fmtMoney                    — src/components/gstr9/grid/money.ts

/** Page root: tighter rhythm than the old space-y-6. */
export const WS_PAGE = 'space-y-3 animate-fade-in';

/** Small toolbar button (pair with variant="outline" / default, size="sm"). */
export const WS_BTN = 'h-8 gap-1 px-2.5 text-xs';

/** Scroll container around a data table. */
export const WS_TABLE_WRAP = 'relative overflow-auto rounded-md border bg-card';
/** The table itself. */
export const WS_TABLE = 'w-full border-separate border-spacing-0 text-sm';
/** Header cell: muted, sticky, bordered (replaces the navy bg-primary header). */
export const WS_TH = 'sticky top-0 z-10 border-b border-r bg-muted px-2 py-1.5 text-left text-[13px] font-semibold text-muted-foreground whitespace-nowrap';
/** Grouped (upper) header row cell. */
export const WS_TH_GROUP = 'border-b border-r bg-muted px-2 py-1 text-center font-semibold text-muted-foreground';
/** Body cell. */
export const WS_TD = 'border-b border-r px-2 py-1.5';
/** Numeric body cell. */
export const WS_TD_NUM = 'border-b border-r px-2 py-1.5 text-right tabular-nums whitespace-nowrap';
/** Body row with hover. */
export const WS_TR = 'group transition-colors hover:bg-muted/30';
/** Section / heading row inside a table body. */
export const WS_TR_HEADING = 'bg-muted/50 font-semibold';
/** Total row (tbody or sticky tfoot). */
export const WS_TR_TOTAL = 'bg-muted font-semibold';

/** Filter toolbar label above a control. */
export const WS_FILTER_LABEL = 'text-[11px] font-medium text-muted-foreground';
/** Compact control inside a toolbar (SelectTrigger, Input, SearchableSelect). */
export const WS_CONTROL = 'h-8 text-xs';

/** Inline editable cell input (Input inside a td with p-0). */
export const WS_CELL_INPUT = 'h-9 rounded-none border-0 bg-transparent px-2 text-sm md:text-sm shadow-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary focus-visible:ring-offset-0';

/**
 * Tab strips: for Radix <Tabs>, use TAB_LIST_CLASS / TAB_TRIGGER_CLASS from
 * src/components/gstr9/reco/StepTabs.tsx. For hand-rolled button tabs, these
 * reproduce the same look (navy-tint rail, active tab a navy pill).
 */
export const WS_TABS_LIST = 'inline-flex h-auto max-w-full flex-wrap items-center justify-start gap-1 rounded-md border border-primary/20 bg-primary/[0.08] p-1 text-foreground/80';
export const WS_TAB = 'inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-sm px-4 text-sm font-medium transition-colors hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
export const WS_TAB_ACTIVE = 'bg-primary text-primary-foreground shadow hover:bg-primary hover:text-primary-foreground';
