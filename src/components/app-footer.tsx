import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type AppFooterProps = {
  /** Row count for the current query (respects filters). */
  totalRows: number;
  /** Full table row count before filters; used when showing "out of". */
  totalRowsUnfiltered: number;
  columnCount: number;
  showRowStats: boolean;
  windowLoading: boolean;
  importing?: boolean;
  loadError?: boolean;
  /** Number of columns that currently have an active filter */
  activeFilterCount?: number;
  /** Opens the active-filters details modal (e.g. when the filter count is clicked). */
  onActiveFiltersClick?: () => void;
  /** Number of columns in the current sort order (0 = default table order). */
  sortColumnCount?: number;
  /** Opens the sort-order details modal. */
  onSortDetailsClick?: () => void;
  /** Opens the SQL query workspace (spreadsheet ready only). */
  onQueryDataClick?: () => void;
  queryDataDisabled?: boolean;
  className?: string;
};

export function AppFooter({
  totalRows,
  totalRowsUnfiltered,
  columnCount,
  showRowStats,
  windowLoading,
  importing,
  loadError,
  activeFilterCount = 0,
  onActiveFiltersClick,
  sortColumnCount = 0,
  onSortDetailsClick,
  onQueryDataClick,
  queryDataDisabled,
  className,
}: AppFooterProps) {
  return (
    <footer
      className={cn(
        "border-border bg-background text-muted-foreground shrink-0 border-t text-xs",
        className,
      )}
    >
      <div className="flex w-full min-w-0 items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
        {loadError ? (
          "Load failed — see message above"
        ) : importing ? (
          "Importing CSV…"
        ) : showRowStats ? (
          <>
            {activeFilterCount > 0 ? (
              <>
                <span className="text-foreground font-medium tabular-nums">
                  {totalRows.toLocaleString()}
                </span>{" "}
                out of{" "}
                <span className="text-foreground font-medium tabular-nums">
                  {totalRowsUnfiltered.toLocaleString()}
                </span>{" "}
                rows
              </>
            ) : (
              <>
                <span className="text-foreground font-medium tabular-nums">
                  {totalRows.toLocaleString()}
                </span>{" "}
                rows
              </>
            )}{" "}
            ·{" "}
            <span className="text-foreground font-medium tabular-nums">
              {columnCount.toLocaleString()}
            </span>{" "}
            columns
            {activeFilterCount > 0 ? (
              <>
                {" "}
                ·{" "}
                {onActiveFiltersClick ? (
                  <Button
                    type="button"
                    variant="link"
                    onClick={onActiveFiltersClick}
                    aria-haspopup="dialog"
                    className="h-auto px-0 text-xs font-normal"
                  >
                    filtered by{" "}
                    <span className="text-foreground font-medium tabular-nums">
                      {activeFilterCount.toLocaleString()}
                    </span>{" "}
                    {activeFilterCount === 1 ? "column" : "columns"}
                  </Button>
                ) : (
                  <>
                    filtered by{" "}
                    <span className="text-foreground font-medium tabular-nums">
                      {activeFilterCount.toLocaleString()}
                    </span>{" "}
                    {activeFilterCount === 1 ? "column" : "columns"}
                  </>
                )}
              </>
            ) : null}
            {sortColumnCount > 0 ? (
              <>
                {" "}
                ·{" "}
                {onSortDetailsClick ? (
                  <Button
                    type="button"
                    variant="link"
                    onClick={onSortDetailsClick}
                    aria-haspopup="dialog"
                    className="h-auto px-0 text-xs font-normal"
                  >
                    sorted by{" "}
                    <span className="text-foreground font-medium tabular-nums">
                      {sortColumnCount.toLocaleString()}
                    </span>{" "}
                    {sortColumnCount === 1 ? "column" : "columns"}
                  </Button>
                ) : (
                  <>
                    sorted by{" "}
                    <span className="text-foreground font-medium tabular-nums">
                      {sortColumnCount.toLocaleString()}
                    </span>{" "}
                    {sortColumnCount === 1 ? "column" : "columns"}
                  </>
                )}
              </>
            ) : null}
            {windowLoading ? " · fetching…" : ""}
          </>
        ) : null}
        </div>
        {onQueryDataClick ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={queryDataDisabled}
            onClick={onQueryDataClick}
          >
            Query Data
          </Button>
        ) : null}
      </div>
    </footer>
  );
}
