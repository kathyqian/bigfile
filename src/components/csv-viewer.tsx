"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as duckdb from "@duckdb/duckdb-wasm";
import type { Table as ArrowTable } from "apache-arrow";
import { DataGrid, type Column } from "react-data-grid";
import "react-data-grid/lib/styles.css";
import { FileSpreadsheet } from "lucide-react";

import { createDuckDB } from "@/lib/duckdb-client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";

const TABLE_NAME = "csv_data";
const REGISTERED_NAME = "upload.csv";
const ROW_HEIGHT = 35;
const SCROLL_OVERSCAN_ROWS = 80;
const FETCH_CHUNK_ROWS = 8000;

export type GridRow = { __idx: number; __loaded?: boolean } & Record<
  string,
  unknown
>;

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function arrowTableToObjects(table: ArrowTable): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const fields = table.schema.fields;
  const n = table.numRows;
  for (let i = 0; i < n; i++) {
    const row: Record<string, unknown> = {};
    for (const f of fields) {
      const col = table.getChild(f.name);
      row[f.name] = col?.get(i) ?? null;
    }
    out.push(row);
  }
  return out;
}

export function CsvViewer() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const duckRef = useRef<Awaited<ReturnType<typeof createDuckDB>> | null>(null);
  const connRef = useRef<duckdb.AsyncDuckDBConnection | null>(null);
  const rowsRef = useRef<GridRow[]>([]);
  const loadedRef = useRef<Uint8Array | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const fetchInFlightRef = useRef(false);

  const [, setRenderTick] = useState(0);
  const bump = useCallback(() => setRenderTick((t) => t + 1), []);
  const [columnNames, setColumnNames] = useState<string[]>([]);

  const [status, setStatus] = useState<
    "idle" | "init-db" | "loading" | "ready" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [fileLabel, setFileLabel] = useState<string | null>(null);
  const [totalRows, setTotalRows] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [windowLoading, setWindowLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setStatus("init-db");
        const handle = await createDuckDB();
        if (cancelled) {
          await handle.terminate();
          return;
        }
        duckRef.current = handle;
        setStatus("idle");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
      void (async () => {
        await connRef.current?.close().catch(() => {});
        connRef.current = null;
        if (duckRef.current) {
          await duckRef.current.terminate();
          duckRef.current = null;
        }
      })();
    };
  }, []);

  const columns: readonly Column<GridRow>[] = useMemo(() => {
    return columnNames.map((name) => ({
      key: name,
      name,
      resizable: true,
      sortable: false,
      editable: false,
      renderCell({ row, column }) {
        if (!row.__loaded) {
          return (
            <span className="text-muted-foreground text-xs">…</span>
          );
        }
        const v = row[column.key];
        if (v === null || v === undefined) return "";
        if (typeof v === "object") return JSON.stringify(v);
        return String(v);
      },
    }));
  }, [columnNames]);

  const loadRange = useCallback(async (start: number, end: number) => {
    const conn = connRef.current;
    const cols = columnNames;
    const rows = rowsRef.current;
    const loaded = loadedRef.current;
    if (!conn || cols.length === 0 || !loaded || end <= start) return;

    const list = cols.map(quoteIdent).join(", ");
    let i = start;
    while (i < end) {
      if (loaded[i] === 1) {
        i++;
        continue;
      }
      const chunkStart = i;
      const chunkSize = Math.min(FETCH_CHUNK_ROWS, rows.length - chunkStart);
      if (chunkSize <= 0) break;
      const sql = `SELECT ${list} FROM ${TABLE_NAME} LIMIT ${chunkSize} OFFSET ${chunkStart};`;
      const table = await conn.query(sql);
      const objects = arrowTableToObjects(table as ArrowTable);
      if (objects.length === 0) break;
      for (let r = 0; r < objects.length; r++) {
        const idx = chunkStart + r;
        const target = rows[idx];
        if (!target) continue;
        Object.assign(target, objects[r]);
        target.__loaded = true;
        loaded[idx] = 1;
      }
      i = chunkStart + objects.length;
    }
  }, [columnNames]);

  const scheduleRangeLoad = useCallback(
    (scrollTop: number, clientHeight: number) => {
      if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = null;
        const total = rowsRef.current.length;
        if (total === 0) return;
        const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - SCROLL_OVERSCAN_ROWS);
        const last = Math.min(
          total,
          Math.ceil((scrollTop + clientHeight) / ROW_HEIGHT) +
            SCROLL_OVERSCAN_ROWS,
        );
        if (last <= first) return;
        void (async () => {
          if (fetchInFlightRef.current) return;
          fetchInFlightRef.current = true;
          setWindowLoading(true);
          try {
            await loadRange(first, last);
            bump();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            fetchInFlightRef.current = false;
            setWindowLoading(false);
          }
        })();
      });
    },
    [bump, loadRange],
  );

  const ingestFile = async (file: File) => {
    setError(null);
    if (!duckRef.current) {
      setError("Database is not ready yet.");
      return;
    }
    setStatus("loading");
    try {
      await connRef.current?.close().catch(() => {});
      connRef.current = null;
      loadedRef.current = null;
      rowsRef.current = [];
      setColumnNames([]);
      bump();

      const buf = await file.arrayBuffer();
      const db = duckRef.current.db;
      await db.registerFileBuffer(REGISTERED_NAME, new Uint8Array(buf));

      const conn = await db.connect();
      connRef.current = conn;

      await conn.query(`
        CREATE OR REPLACE TABLE ${TABLE_NAME} AS
        SELECT * FROM read_csv_auto('${REGISTERED_NAME}');
      `);

      const countRow = await conn.query(
        `SELECT COUNT(*)::BIGINT AS c FROM ${TABLE_NAME};`,
      );
      const countCol = countRow.getChild("c");
      const n = countCol ? Number(countCol.get(0)) : 0;

      const ti = await conn.query(
        `SELECT name FROM pragma_table_info('${TABLE_NAME}') ORDER BY cid;`,
      );
      const nameCol = ti.getChild("name");
      const names: string[] = [];
      for (let i = 0; i < ti.numRows; i++) {
        names.push(String(nameCol?.get(i)));
      }
      setColumnNames(names);

      const stubs: GridRow[] = new Array(n);
      const loaded = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        stubs[i] = { __idx: i, __loaded: false };
      }
      rowsRef.current = stubs;
      loadedRef.current = loaded;
      setTotalRows(n);
      setFileLabel(file.name);
      setStatus("ready");
      bump();

      await loadRange(0, Math.min(n, SCROLL_OVERSCAN_ROWS * 2 + 200));
      bump();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (f && (f.name.endsWith(".csv") || f.type === "text/csv")) {
      void ingestFile(f);
    }
  };

  const onBrowse = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void ingestFile(f);
    e.target.value = "";
  };

  return (
    <div
      className={cn(
        "flex flex-1 flex-col gap-4 p-4 md:p-6",
        isDragging && "bg-accent/30",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={onDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={onBrowse}
      />

      {status === "idle" || status === "init-db" ? (
        <Empty className="min-h-[40vh] border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileSpreadsheet className="size-4" />
            </EmptyMedia>
            <EmptyTitle>
              {status === "init-db"
                ? "Starting DuckDB…"
                : "Open a CSV spreadsheet"}
            </EmptyTitle>
            <EmptyDescription>
              Drag and drop a .csv file here, or choose a file to load it into
              DuckDB in your browser and browse it read-only.
            </EmptyDescription>
          </EmptyHeader>
          <Button
            type="button"
            variant="secondary"
            disabled={status === "init-db"}
            onClick={() => fileInputRef.current?.click()}
          >
            Choose CSV
          </Button>
        </Empty>
      ) : null}

      {status === "loading" ? (
        <Empty className="min-h-[40vh] border border-dashed">
          <EmptyHeader>
            <EmptyTitle>Loading CSV…</EmptyTitle>
            <EmptyDescription>
              Importing into DuckDB WASM (this may take a while for large
              files).
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {status === "error" && error ? (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-destructive">Something went wrong</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setStatus("idle");
                setError(null);
              }}
            >
              Dismiss
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {status === "ready" ? (
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <CardHeader className="shrink-0 flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <div className="min-w-0">
              <CardTitle className="truncate font-mono text-base">
                {fileLabel}
              </CardTitle>
              <CardDescription>
                {totalRows.toLocaleString()} rows · read-only · windowed load
                {windowLoading ? " · fetching…" : ""}
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              Open another file
            </Button>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 p-0 px-4 pb-4">
            <div className="rdg-wrap border-border bg-background h-[min(70vh,720px)] w-full overflow-hidden rounded-md border">
              <DataGrid
                className="rdg-theme rdg-fill-grid"
                columns={columns}
                rows={rowsRef.current}
                rowKeyGetter={(row) => row.__idx}
                defaultColumnOptions={{
                  resizable: true,
                  sortable: false,
                }}
                rowHeight={ROW_HEIGHT}
                headerRowHeight={ROW_HEIGHT}
                enableVirtualization
                onScroll={(e) => {
                  const t = e.currentTarget;
                  scheduleRangeLoad(t.scrollTop, t.clientHeight);
                }}
              />
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
