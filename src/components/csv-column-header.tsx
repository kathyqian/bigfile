"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ListFilter } from "lucide-react";

import { NumericFilterPopoverBody } from "@/components/csv-filters/numeric-filter-popover";
import { TextFilterPopoverBody } from "@/components/csv-filters/text-filter-popover";
import { Badge } from "@/components/ui/badge";
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
import type { ColumnFilter, SortColumn } from "@/lib/csv-query";
import { ColumnHistogramMini } from "@/components/column-histogram-mini";
import type { ColumnHistogramData } from "@/lib/column-histogram";
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
};

function sortStateForColumn(
  sortColumns: readonly SortColumn[],
  columnKey: string,
): { direction: "ASC" | "DESC"; priority: number } | undefined {
  const i = sortColumns.findIndex((s) => s.columnKey === columnKey);
  if (i < 0) return undefined;
  return {
    direction: sortColumns[i].direction,
    priority: i + 1,
  };
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

export function CsvColumnHeader({
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
}: Props) {
  const [filterPopoverOpen, setFilterPopoverOpen] = useState(false);
  const [histogram, setHistogram] = useState<ColumnHistogramData | null>(null);
  const [histogramLoading, setHistogramLoading] = useState(true);

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
      className="flex h-full min-w-0 flex-col gap-0.5 py-0.5 pr-1"
      tabIndex={tabIndex}
    >
      <div className="flex min-w-0 items-center justify-between gap-1.5">
        <span
          className="min-w-0 flex-1 truncate text-xs font-medium leading-tight"
          title={displayName}
        >
          {displayName}
        </span>
        <div className="flex shrink-0 items-center gap-1">
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
              <SortIcon className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onSortAsc}>Ascending</DropdownMenuItem>
              <DropdownMenuItem onClick={onSortDesc}>Descending</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onSortClear}>Clear sort</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {st && sortColumns.length > 1 ? (
            <Badge className="px-1 tabular-nums">{st.priority}</Badge>
          ) : null}

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
                  className={cn(hasFilter && "bg-primary/10 text-primary")}
                />
              }
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <ListFilter className="size-3.5" />
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
      <span className="text-muted-foreground truncate text-xs leading-tight">
        {typeLabel}
      </span>
      <div className="w-full min-w-0">
        <ColumnHistogramMini data={histogram} loading={histogramLoading} />
      </div>
    </div>
  );
}
