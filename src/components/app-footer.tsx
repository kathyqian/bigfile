import { cn } from "@/lib/utils";

type AppFooterProps = {
  totalRows: number;
  columnCount: number;
  showRowStats: boolean;
  windowLoading: boolean;
  importing?: boolean;
  loadError?: boolean;
  className?: string;
};

export function AppFooter({
  totalRows,
  columnCount,
  showRowStats,
  windowLoading,
  importing,
  loadError,
  className,
}: AppFooterProps) {
  return (
    <footer
      className={cn(
        "border-border bg-background text-muted-foreground flex shrink-0 items-center justify-between gap-4 border-t px-4 py-2.5 text-sm md:px-6",
        className,
      )}
    >
      <span>
        {loadError ? (
          "Load failed — see message above"
        ) : importing ? (
          "Importing CSV…"
        ) : showRowStats ? (
          <>
            <span className="text-foreground font-medium tabular-nums">
              {totalRows.toLocaleString()}
            </span>{" "}
            rows ·{" "}
            <span className="text-foreground font-medium tabular-nums">
              {columnCount.toLocaleString()}
            </span>{" "}
            columns
            {windowLoading ? " · fetching…" : ""}
          </>
        ) : null}
      </span>
    </footer>
  );
}
