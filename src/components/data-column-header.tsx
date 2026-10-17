"use client";

import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ListFilter } from "lucide-react";

import { NumericFilterPopoverBody } from "@/components/column-filters/numeric-filter-popover";
import { TextFilterPopoverBody } from "@/components/column-filters/text-filter-popover";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { ColumnFilterMode } from "@/lib/column-type-meta";
import type { ColumnFilter, SortColumn } from "@/lib/data-query";
import { ColumnHistogramMini } from "@/components/column-histogram-mini";
import type { ColumnHistogramData } from "@/lib/column-histogram";
import type { ColumnStats } from "@/lib/column-stats";
import { cn } from "@/lib/utils";

type Props = {
  columnKey: string;
  displayName: string;
  typeLabel: string;
  filterMode: ColumnFilterMode;
  sortColumns: readonly SortColumn[];
  /** From react-data-grid */
  tabIndex?: number;
  filter: ColumnFilter | undefined;
  onSortAsc: () => void;
  onSortDesc: () => void;
  onSortClear: () => void;
  onFilterApply: (f: ColumnFilter | null) => void;
  loadDistinct: () => Promise<{
    values: (string | null)[];
    truncated: boolean;
  }>;
  loadHistogramForColumn: (columnKey: string) => Promise<ColumnHistogramData>;
  loadStatsForColumn: (columnKey: string) => Promise<ColumnStats>;
};

type StatsTipState = {
  clientX: number;
  clientY: number;
};

function sortStateForColumn(
  sortColumns: readonly SortColumn[],
  columnKey: string,
): { direction: "ASC" | "DESC" } | undefined {
  const i = sortColumns.findIndex((s) => s.columnKey === columnKey);
  if (i < 0) return undefined;
  return { direction: sortColumns[i].direction };
}

function filterActive(f: ColumnFilter | undefined, mode: ColumnFilterMode): boolean {
  if (!f) return false;
  if (f.kind === "numeric" && mode === "numeric") {
    if (f.mode === "cmp") return Number.isFinite(f.value);
    const hasMin = f.min !== undefined && Number.isFinite(f.min);
    const hasMax = f.max !== undefined && Number.isFinite(f.max);
    return hasMin || hasMax;
  }
  if (f.kind === "text" && mode === "text") {
    return f.includeNull || f.values.length > 0;
  }
  return false;
}

function formatStatNumber(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}

function statsRows(stats: ColumnStats | null, loading: boolean): { label: string; value: string }[] {
  if (stats === null) {
    return [{ label: loading ? "Loading…" : "…", value: "" }];
  }
  if (stats.kind === "empty") {
    return [{ label: "No values", value: "" }];
  }
  if (stats.kind === "categorical") {
    return [
      {
        label: "Unique values",
        value: stats.uniqueValues.toLocaleString(),
      },
    ];
  }
  return [
    { label: "Min", value: formatStatNumber(stats.min) },
    { label: "Max", value: formatStatNumber(stats.max) },
    { label: "Average", value: formatStatNumber(stats.average) },
    { label: "Median", value: formatStatNumber(stats.median) },
    { label: "Count", value: stats.count.toLocaleString() },
    { label: "Count distinct", value: stats.countDistinct.toLocaleString() },
    { label: "Sum", value: formatStatNumber(stats.sum) },
    { label: "Standard deviation", value: formatStatNumber(stats.stddev) },
  ];
}

function ColumnStatsTooltip({
  tip,
  rows,
}: {
  tip: StatsTipState | null;
  rows: { label: string; value: string }[];
}) {
  if (tip === null || typeof document === "undefined") return null;

  const el = (
    <div
      role="tooltip"
      className="bg-popover text-popover-foreground border-border pointer-events-none fixed z-200 max-w-[min(20rem,calc(100vw-1rem))] rounded-md border px-2.5 py-2 text-xs shadow-md"
      style={{
        left: tip.clientX + 12,
        top: tip.clientY + 12,
      }}
    >
      <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-muted-foreground">{row.label}</dt>
            {row.value ? (
              <dd className="text-foreground text-right font-mono tabular-nums">
                {row.value}
              </dd>
            ) : (
              <dd />
            )}
          </div>
        ))}
      </dl>
    </div>
  );

  return createPortal(el, document.body);
}

export function DataColumnHeader({
  columnKey,
  displayName,
  typeLabel,
  filterMode,
  sortColumns,
  tabIndex = 0,
  filter,
  onSortAsc,
  onSortDesc,
  onSortClear,
  onFilterApply,
  loadDistinct,
  loadHistogramForColumn,
  loadStatsForColumn,
}: Props) {
  const [filterPopoverOpen, setFilterPopoverOpen] = useState(false);
  const [histogram, setHistogram] = useState<ColumnHistogramData | null>(null);
  const [histogramLoading, setHistogramLoading] = useState(true);
  const [stats, setStats] = useState<ColumnStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsTip, setStatsTip] = useState<StatsTipState | null>(null);
  const statsRequestRef = useRef(0);

  const applyFilterAndClose = useCallback(
    (f: ColumnFilter | null) => {
      onFilterApply(f);
      setFilterPopoverOpen(false);
    },
    [onFilterApply],
  );

  useEffect(() => {
    let cancelled = false;
    setHistogramLoading(true);
    setHistogram(null);
    void (async () => {
      try {
        const d = await loadHistogramForColumn(columnKey);
        if (!cancelled) {
          setHistogram(d);
          setHistogramLoading(false);
        }
      } catch {
        if (!cancelled) {
          setHistogram({ kind: "empty" });
          setHistogramLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [columnKey, loadHistogramForColumn]);

  useEffect(() => {
    statsRequestRef.current += 1;
    setStats(null);
    setStatsLoading(false);
  }, [loadStatsForColumn]);

  useLayoutEffect(() => {
    const hide = () => setStatsTip(null);
    window.addEventListener("scroll", hide, true);
    return () => window.removeEventListener("scroll", hide, true);
  }, []);

  const ensureStats = useCallback(() => {
    if (stats !== null || statsLoading) return;
    const req = ++statsRequestRef.current;
    setStatsLoading(true);
    void (async () => {
      try {
        const next = await loadStatsForColumn(columnKey);
        if (statsRequestRef.current === req) {
          setStats(next);
          setStatsLoading(false);
        }
      } catch {
        if (statsRequestRef.current === req) {
          setStats({ kind: "empty" });
          setStatsLoading(false);
        }
      }
    })();
  }, [columnKey, loadStatsForColumn, stats, statsLoading]);

  const onStatsPointerEnter = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      ensureStats();
      setStatsTip({ clientX: e.clientX, clientY: e.clientY });
    },
    [ensureStats],
  );

  const onStatsPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      ensureStats();
      setStatsTip({ clientX: e.clientX, clientY: e.clientY });
    },
    [ensureStats],
  );

  const onStatsPointerLeave = useCallback(() => {
    setStatsTip(null);
  }, []);

  const st = sortStateForColumn(sortColumns, columnKey);
  const hasSort = st !== undefined;
  const hasFilter = filterActive(filter, filterMode);
  const initialNumeric =
    filter?.kind === "numeric" ? filter : undefined;
  const initialText =
    filter?.kind === "text" ? filter : undefined;

  const SortIcon =
    st?.direction === "ASC"
      ? ArrowUp
      : st?.direction === "DESC"
        ? ArrowDown
        : ArrowUpDown;

  return (
    <div
      className="flex h-full min-w-0 flex-col justify-start gap-2 pt-2 pb-1 pr-0"
      tabIndex={tabIndex}
    >
      <div className="flex min-w-0 items-start justify-between gap-1.5">
        <div
          className="flex min-w-0 flex-1 flex-col gap-0.5"
          onPointerEnter={onStatsPointerEnter}
          onPointerMove={onStatsPointerMove}
          onPointerLeave={onStatsPointerLeave}
        >
          <span className="min-w-0 truncate text-xs font-medium leading-tight">
            {displayName}
          </span>
          <span className="text-muted-foreground truncate text-xs font-normal leading-none">
            {typeLabel}
          </span>
        </div>
        <div className="flex shrink-0 items-start -mt-[7px]">
          <div className="inline-flex">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Sort ${displayName}`}
                    className={cn(hasSort && "text-primary")}
                  />
                }
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <span className="relative inline-flex">
                  <SortIcon className="size-3.5" />
                  {hasSort ? (
                    <span
                      aria-hidden
                      className="bg-primary absolute -top-px -right-px size-1.5 rounded-full"
                    />
                  ) : null}
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onSortAsc}>Ascending</DropdownMenuItem>
                <DropdownMenuItem onClick={onSortDesc}>Descending</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onSortClear}>Clear sort</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="inline-flex -ml-2">
            <Popover open={filterPopoverOpen} onOpenChange={setFilterPopoverOpen}>
              <PopoverTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={
                      hasFilter
                        ? `Filter (active) — ${displayName}`
                        : `Filter ${displayName}`
                    }
                    aria-pressed={hasFilter}
                    className={cn(hasFilter && "text-primary")}
                  />
                }
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <span className="relative inline-flex">
                  <ListFilter className="size-3.5" />
                  {hasFilter ? (
                    <span
                      aria-hidden
                      className="bg-primary absolute -top-px -right-px size-1.5 rounded-full"
                    />
                  ) : null}
                </span>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-auto p-3">
                {filterMode === "numeric" ? (
                  <NumericFilterPopoverBody
                    key={columnKey}
                    initial={initialNumeric}
                    onApply={applyFilterAndClose}
                  />
                ) : (
                  <TextFilterPopoverBody
                    key={columnKey}
                    columnKey={columnKey}
                    initial={initialText}
                    onApply={applyFilterAndClose}
                    loadDistinct={loadDistinct}
                  />
                )}
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </div>
      <div className="w-full min-w-0">
        <ColumnHistogramMini data={histogram} loading={histogramLoading} />
      </div>
      <ColumnStatsTooltip
        tip={statsTip}
        rows={statsRows(stats, statsLoading && stats === null)}
      />
    </div>
  );
}
