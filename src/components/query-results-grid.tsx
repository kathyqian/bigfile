"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DataGrid,
  type Column,
  type DataGridHandle,
  type RenderCellProps,
} from "react-data-grid";
import "react-data-grid/lib/styles.css";

import { cn } from "@/lib/utils";
import { QUERY_RESULT_FETCH_CHUNK } from "@/lib/query-result-table";

export type QueryGridRow = { __idx: number; __loaded?: boolean } & Record<
  string,
  unknown
>;

type Props = {
  columns: string[];
  totalRows: number;
  numericColumns: ReadonlySet<string>;
  /** Load [start, end) from DuckDB (or inline buffer). */
  fetchWindow: (
    start: number,
    end: number,
  ) => Promise<Record<string, unknown>[]>;
  /** Change when the underlying result is replaced. */
  resultKey: string;
};

const ROW_HEIGHT = 35;
const OVERSCAN = 40;

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function QueryResultsGrid({
  columns,
  totalRows,
  numericColumns,
  fetchWindow,
  resultKey,
}: Props) {
  const gridRef = useRef<DataGridHandle>(null);
  const rowsRef = useRef<QueryGridRow[]>([]);
  const loadedRef = useRef<Uint8Array>(new Uint8Array(0));
  const fetchInFlightRef = useRef(false);
  const fetchWindowRef = useRef(fetchWindow);
  const generationRef = useRef(0);
  const [, bump] = useState(0);
  const scrollRafRef = useRef<number | null>(null);

  fetchWindowRef.current = fetchWindow;

  const ensureRange = useCallback(async (start: number, end: number) => {
    if (fetchInFlightRef.current) return;
    const generation = generationRef.current;
    const loaded = loadedRef.current;
    const rows = rowsRef.current;
    if (!loaded.length || rows.length === 0) return;

    let i = Math.max(0, start);
    const stop = Math.min(end, rows.length);
    while (i < stop) {
      if (generationRef.current !== generation) return;
      if (loaded[i] === 1) {
        i++;
        continue;
      }
      const chunkStart = i;
      let chunkEnd = chunkStart;
      while (
        chunkEnd < stop &&
        loaded[chunkEnd] !== 1 &&
        chunkEnd - chunkStart < QUERY_RESULT_FETCH_CHUNK
      ) {
        chunkEnd++;
      }
      if (chunkEnd <= chunkStart) break;
      fetchInFlightRef.current = true;
      try {
        const objects = await fetchWindowRef.current(chunkStart, chunkEnd);
        if (generationRef.current !== generation) return;
        for (let r = 0; r < objects.length; r++) {
          const idx = chunkStart + r;
          if (!rows[idx]) continue;
          rows[idx] = { ...objects[r], __idx: idx, __loaded: true };
          loaded[idx] = 1;
        }
        bump((n) => n + 1);
      } catch {
        // Leave stubs as "…"; scroll/retry can try again.
      } finally {
        if (generationRef.current === generation) {
          fetchInFlightRef.current = false;
        }
      }
      i = chunkEnd;
    }
  }, []);

  useEffect(() => {
    generationRef.current += 1;
    fetchInFlightRef.current = false;
    const stubs: QueryGridRow[] = new Array(totalRows);
    for (let i = 0; i < totalRows; i++) {
      stubs[i] = { __idx: i, __loaded: false };
    }
    rowsRef.current = stubs;
    loadedRef.current = new Uint8Array(totalRows);
    bump((n) => n + 1);
    const end = Math.min(totalRows, QUERY_RESULT_FETCH_CHUNK);
    if (end > 0) void ensureRange(0, end);
  }, [resultKey, totalRows, ensureRange]);

  const scheduleRange = useCallback(
    (scrollTop: number, clientHeight: number) => {
      if (scrollRafRef.current != null) {
        cancelAnimationFrame(scrollRafRef.current);
      }
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = null;
        const start = Math.max(
          0,
          Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN,
        );
        const end = Math.min(
          totalRows,
          Math.ceil((scrollTop + clientHeight) / ROW_HEIGHT) + OVERSCAN,
        );
        void ensureRange(start, end);
      });
    },
    [ensureRange, totalRows],
  );

  const rdgColumns: Column<QueryGridRow>[] = useMemo(
    () =>
      columns.map((col) => ({
        key: col,
        name: col,
        resizable: true,
        minWidth: 80,
        renderCell({ row }: RenderCellProps<QueryGridRow>) {
          if (!row.__loaded) {
            return (
              <span className="text-muted-foreground font-mono text-xs">…</span>
            );
          }
          const text = formatCell(row[col]);
          return (
            <span className="block truncate font-mono text-xs" title={text}>
              {text}
            </span>
          );
        },
        cellClass: numericColumns.has(col)
          ? "text-right tabular-nums"
          : undefined,
        headerCellClass: cn(
          "font-mono text-xs font-medium",
          numericColumns.has(col) && "text-right",
        ),
      })),
    [columns, numericColumns],
  );

  if (totalRows === 0) {
    return (
      <p className="text-muted-foreground px-4 py-6 text-sm">No rows returned.</p>
    );
  }

  return (
    <div className="rdg-wrap rdg-query-results bg-background flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <DataGrid
        ref={gridRef}
        className="rdg-theme rdg-fill-grid min-h-0 min-w-0 flex-1"
        columns={rdgColumns}
        rows={rowsRef.current}
        rowKeyGetter={(row) => row.__idx}
        rowHeight={ROW_HEIGHT}
        headerRowHeight={ROW_HEIGHT}
        enableVirtualization
        onScroll={(e) => {
          const t = e.currentTarget;
          scheduleRange(t.scrollTop, t.clientHeight);
        }}
      />
    </div>
  );
}
