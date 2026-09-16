import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { summaryCellHref, type CategoryRow } from '@/utils/noticeSummaryReport';
import { Loader2 } from 'lucide-react';

interface CategorySummaryBarsProps {
  categories: CategoryRow[];
  grandTotal: { total: number; open: number; closed: number; replied: number };
  onCategoryClick?: (category: string) => void;
  activeCategory?: string | null;
  loading?: boolean;
}

export default function CategorySummaryBars({
  categories,
  grandTotal,
  onCategoryClick,
  activeCategory,
  loading,
}: CategorySummaryBarsProps) {
  const [showEmpty, setShowEmpty] = useState(false);

  if (loading) {
    return (
      <Card>
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Notice summary by category</h2>
        </div>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const visibleCategories = categories.filter((c) => !c.placeholder);
  const emptyCategories = categories.filter((c) => c.placeholder);

  return (
    <Card>
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Notice summary by category</h2>
          <p className="text-[11px] text-muted-foreground">
            Click a row to filter this dashboard · click its count to open the list
          </p>
        </div>
        {/* Filtering scopes the tiles and panels above, which are usually
            scrolled out of view — so the state is echoed here, where the
            click happened. */}
        {activeCategory ? (
          <button
            type="button"
            onClick={() => onCategoryClick?.(activeCategory)}
            className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary hover:bg-primary/20"
            title="Clear this filter"
          >
            Filtering: {activeCategory} ✕
          </button>
        ) : (
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
            {grandTotal.total.toLocaleString('en-IN')} total
          </span>
        )}
      </div>
      <CardContent className="space-y-1.5 pt-3 pb-3">
        {visibleCategories.map((cat) => (
          <div
            key={cat.type}
            className={cn(
              'flex cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 transition-colors hover:bg-muted/60',
              activeCategory === cat.type && 'bg-primary/10 ring-1 ring-primary/30'
            )}
            onClick={() => onCategoryClick?.(cat.type)}
          >
            <span className="w-[120px] shrink-0 truncate text-xs font-medium">
              {cat.type}
            </span>

            {cat.total > 0 ? (
              <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-muted/40">
                {cat.open > 0 && (
                  <div
                    className="bg-amber-500"
                    style={{ width: `${(cat.open / cat.total) * 100}%` }}
                  />
                )}
                {cat.replied > 0 && (
                  <div
                    className="bg-blue-500"
                    style={{ width: `${(cat.replied / cat.total) * 100}%` }}
                  />
                )}
                {cat.closed > 0 && (
                  <div
                    className="bg-emerald-500"
                    style={{ width: `${(cat.closed / cat.total) * 100}%` }}
                  />
                )}
              </div>
            ) : (
              <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-muted/40" />
            )}

            {/* The row itself filters this dashboard; the count opens the
                matching list, so a category is both a lens and a way out. */}
            {summaryCellHref(cat, 'total') ? (
              <Link
                to={summaryCellHref(cat, 'total')!}
                onClick={(e) => e.stopPropagation()}
                className="w-10 shrink-0 text-right text-xs font-semibold tabular-nums text-primary hover:underline"
                title={`Open the ${cat.type} list`}
              >
                {cat.total}
              </Link>
            ) : (
              <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {cat.total}
              </span>
            )}
          </div>
        ))}

        {showEmpty && emptyCategories.map((cat) => (
          <div key={cat.type} className="flex items-center gap-2 rounded-md px-1 py-0.5 opacity-60">
            <span className="w-[120px] shrink-0 truncate text-xs font-medium">{cat.type}</span>
            <div className="h-2 flex-1 rounded-full bg-muted/40" />
            <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">0</span>
          </div>
        ))}

        {/* Footer: legend + empty categories */}
        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-500" />
              <span className="text-[10px] text-muted-foreground">Open</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-blue-500" />
              <span className="text-[10px] text-muted-foreground">Replied</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" />
              <span className="text-[10px] text-muted-foreground">Closed</span>
            </div>
          </div>
          {emptyCategories.length > 0 && (
            <button
              type="button"
              className="text-[11px] font-semibold text-primary hover:underline"
              onClick={() => setShowEmpty((v) => !v)}
            >
              {showEmpty ? 'Hide' : '+'} {emptyCategories.length} categories with no data
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
