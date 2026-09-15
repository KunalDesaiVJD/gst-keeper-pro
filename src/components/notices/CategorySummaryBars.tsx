import { Card, CardContent } from '@/components/ui/card';
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
  const emptyCount = categories.filter((c) => c.placeholder).length;

  return (
    <Card>
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Notice summary by category</h2>
          <p className="text-[11px] text-muted-foreground">Open · Replied · Closed — click a bar to filter</p>
        </div>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
          {grandTotal.total.toLocaleString('en-IN')} total
        </span>
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

            <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {cat.total}
            </span>
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
          {emptyCount > 0 && (
            <span className="text-[11px] font-semibold text-primary">
              + {emptyCount} categories with no data
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
