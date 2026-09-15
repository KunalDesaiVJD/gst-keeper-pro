import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

interface CategoryRow {
  type: string;
  total: number;
  open: number;
  closed: number;
  replied: number;
  placeholder?: boolean;
  to?: string;
}

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
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Notice Categories</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const visibleCategories = categories.filter((c) => !c.placeholder);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Notice Categories</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {visibleCategories.map((cat) => (
          <div
            key={cat.type}
            className={cn(
              'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-muted/60',
              activeCategory === cat.type && 'bg-primary/10 ring-1 ring-primary/30'
            )}
            onClick={() => onCategoryClick?.(cat.type)}
          >
            <span className="w-[120px] shrink-0 truncate text-xs font-medium">
              {cat.type}
            </span>

            {cat.total > 0 ? (
              <div className="flex h-4 flex-1 overflow-hidden rounded-full bg-muted/40">
                {cat.open > 0 && (
                  <div
                    className="bg-blue-500"
                    style={{ width: `${(cat.open / cat.total) * 100}%` }}
                  />
                )}
                {cat.replied > 0 && (
                  <div
                    className="bg-emerald-500"
                    style={{ width: `${(cat.replied / cat.total) * 100}%` }}
                  />
                )}
                {cat.closed > 0 && (
                  <div
                    className="bg-slate-400"
                    style={{ width: `${(cat.closed / cat.total) * 100}%` }}
                  />
                )}
              </div>
            ) : (
              <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-muted/40" />
            )}

            <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {cat.total}
            </span>
          </div>
        ))}

        {/* Grand total row */}
        <div className="flex items-center gap-2 border-t px-2 pt-2">
          <span className="w-[120px] shrink-0 text-xs font-bold">Total</span>

          {grandTotal.total > 0 ? (
            <div className="flex h-4 flex-1 overflow-hidden rounded-full bg-muted/40">
              {grandTotal.open > 0 && (
                <div
                  className="bg-blue-500"
                  style={{ width: `${(grandTotal.open / grandTotal.total) * 100}%` }}
                />
              )}
              {grandTotal.replied > 0 && (
                <div
                  className="bg-emerald-500"
                  style={{ width: `${(grandTotal.replied / grandTotal.total) * 100}%` }}
                />
              )}
              {grandTotal.closed > 0 && (
                <div
                  className="bg-slate-400"
                  style={{ width: `${(grandTotal.closed / grandTotal.total) * 100}%` }}
                />
              )}
            </div>
          ) : (
            <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-muted/40" />
          )}

          <span className="w-12 shrink-0 text-right text-xs font-bold tabular-nums">
            {grandTotal.total}
          </span>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 px-2 pt-2">
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-blue-500" />
            <span className="text-[10px] text-muted-foreground">Open</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />
            <span className="text-[10px] text-muted-foreground">Replied</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-slate-400" />
            <span className="text-[10px] text-muted-foreground">Closed</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
