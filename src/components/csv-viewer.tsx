"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type * as duckdb from "@duckdb/duckdb-wasm";
import type { Table as ArrowTable } from "apache-arrow";
import {
  DataGrid,
  type Column,
  type ColumnOrColumnGroup,
  type DataGridHandle,
  type RenderCellProps,
  type RenderHeaderCellProps,
} from "react-data-grid";
import "react-data-grid/lib/styles.css";

import { CsvColumnHeader } from "@/components/csv-column-header";
import { AppFooter } from "@/components/app-footer";
import { AppTopBar } from "@/components/app-topbar";
import { createDuckDB } from "@/lib/duckdb-client";
import { arrowTableColumnNames, arrowTableToObjects } from "@/lib/arrow-table";
import type { ColumnMeta } from "@/lib/column-type-meta";
import { fetchTableColumnMeta } from "@/lib/column-type-meta";
import { fetchColumnHistogram } from "@/lib/column-histogram";
import {
  buildOrderByClause,
  buildWhereClause,
  type ColumnFilter,
  type FiltersMap,
  countActiveColumnFilters,
  listActiveFilterLines,
  listSortDetails,
  quoteIdent,
  type SortColumn,
} from "@/lib/csv-query";
import { prepareReadOnlyQuery } from "@/lib/sql-guardrails";
import { tableIdentifierFromFileName } from "@/lib/csv-table-name";
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
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  SqlQueryWorkspace,
  type QueryWorkspaceTab,
} from "@/components/sql-query-workspace";

const REGISTERED_NAME = "upload.csv";
/** Grid-only; avoids colliding with a CSV column named "row" or similar. */
const ROW_NUM_KEY = "__rdg_rn__";
const ROW_HEIGHT = 35;
/** Shared styles for column letters (A, B, …) and row index gutter (1, 2, …). */
const GUTTER_LABEL_CLASS =
  "font-normal font-mono tabular-nums text-xs text-muted-foreground";
/** Grouped letter-row cell above the row-number column; RDG omits frozen inset on group headers. */
const GUTTER_CORNER_LETTER_CLASS = "rdg-gutter-corner-letter";
/** Frozen row-index header in the name/histogram tier — must stack above resize z-index CSS. */
const GUTTER_HEADER_CLASS = "rdg-csv-header-gutter";
/** Tier with column names, filters, type label, and histogram. */
const HEADER_MAIN_ROW_HEIGHT = 92;
/** Column letters row — same pixel height as body rows ({@link ROW_HEIGHT}). */
const HEADER_LETTER_ROW_HEIGHT = ROW_HEIGHT;
/**
 * react-data-grid only supports one `headerRowHeight` for every header tier. We pass the
 * average so 2 × this ≈ letter + main (keeps fill-grid / viewport math honest), then
 * {@link patchRdgHeaderLetterRow} sets the real letter and main tracks.
 */
const HEADER_ROW_UNIFORM_HEIGHT = Math.round(
  (HEADER_LETTER_ROW_HEIGHT + HEADER_MAIN_ROW_HEIGHT) / 2,
);
const SCROLL_OVERSCAN_ROWS = 80;
const FETCH_CHUNK_ROWS = 8000;
/** Fetch up to N+1 rows to detect truncation */
const MAX_DISTINCT = 10_000;

export type GridRow = { __idx: number; __loaded?: boolean } & Record<
  string,
  unknown
>;

/**
 * Narrow letter row (= body) + full main row; fixes uniform header height from RDG.
 * Idempotent — safe to re-run from a MutationObserver when RDG resets styles.
 */
function patchRdgHeaderLetterRow(
  root: HTMLDivElement,
  letterPx: number,
  mainPx: number,
  uniformPx: number,
) {
  const gtr = root.style.gridTemplateRows;
  if (!gtr) return;
  const desired = `${letterPx}px ${mainPx}px`;
  const repeatRe = new RegExp(`^repeat\\(\\s*2\\s*,\\s*${uniformPx}px\\s*\\)`);
  const pairRe = new RegExp(`^${uniformPx}px\\s+${uniformPx}px(?=\\s|$)`);
  let next = gtr;
  if (repeatRe.test(gtr)) {
    next = gtr.replace(repeatRe, desired);
  } else if (pairRe.test(gtr)) {
    next = gtr.replace(pairRe, desired);
  }
  if (next !== gtr) {
    root.style.gridTemplateRows = next;
  }
  /* Sticky main-header `top` is `1 * var(--rdg-header-row-height)`; keep it = letter track. */
  if (root.style.getPropertyValue("--rdg-header-row-height") !== `${letterPx}px`) {
    root.style.setProperty("--rdg-header-row-height", `${letterPx}px`);
  }
}

/** 0-based column index → Excel-style letters (A … Z, AA …). */
function excelColumnLabel(zeroBasedIndex: number): string {
  let n = zeroBasedIndex + 1;
  let s = "";
  while (n > 0) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

export function CsvViewer() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<DataGridHandle>(null);
  const duckRef = useRef<Awaited<ReturnType<typeof createDuckDB>> | null>(null);
  const connRef = useRef<duckdb.AsyncDuckDBConnection | null>(null);
  /** DuckDB table name derived from the loaded CSV file name (quoted in SQL via {@link quoteIdent}). */
  const dataTableNameRef = useRef<string | null>(null);
  const rowsRef = useRef<GridRow[]>([]);
  const loadedRef = useRef<Uint8Array | null>(null);
  const columnNamesRef = useRef<string[]>([]);
  const columnMetaMapRef = useRef<Map<string, ColumnMeta>>(new Map());
  const sortColumnsRef = useRef<SortColumn[]>([]);
  const filtersRef = useRef<FiltersMap>({});
  const scrollRafRef = useRef<number | null>(null);
  const fetchInFlightRef = useRef(false);

  const [, setRenderTick] = useState(0);
  const bump = useCallback(() => setRenderTick((t) => t + 1), []);
  const [columnNames, setColumnNames] = useState<string[]>([]);
  const [columnMeta, setColumnMeta] = useState<ColumnMeta[]>([]);
  columnNamesRef.current = columnNames;

  const [sortColumns, setSortColumns] = useState<SortColumn[]>([]);
  const [filters, setFilters] = useState<FiltersMap>({});

  const [status, setStatus] = useState<
    "idle" | "init-db" | "loading" | "ready" | "error"
  >("init-db");
  const [error, setError] = useState<string | null>(null);
  const [fileLabel, setFileLabel] = useState<string | null>(null);
  const [dataTableName, setDataTableName] = useState<string | null>(null);
  const [totalRows, setTotalRows] = useState(0);
  /** Full table row count (no WHERE); used for "X out of Y rows" when filters apply. */
  const [totalRowsUnfiltered, setTotalRowsUnfiltered] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [windowLoading, setWindowLoading] = useState(false);
  const [filterDetailsOpen, setFilterDetailsOpen] = useState(false);
  const [sortDetailsOpen, setSortDetailsOpen] = useState(false);
  /** True when the grid viewport overflows vertically (last-row border tweak in globals.css). */
  const [gridScrollable, setGridScrollable] = useState(false);

  const [queryWorkspaceOpen, setQueryWorkspaceOpen] = useState(false);
  const [queryWorkspaceTabs, setQueryWorkspaceTabs] = useState<
    QueryWorkspaceTab[]
  >([]);
  const [queryWorkspaceActiveTabId, setQueryWorkspaceActiveTabId] = useState<
    string | null
  >(null);
  const [queryWorkspaceRunningTabId, setQueryWorkspaceRunningTabId] = useState<
    string | null
  >(null);

  const queryWorkspaceTabsRef = useRef<QueryWorkspaceTab[]>([]);
  queryWorkspaceTabsRef.current = queryWorkspaceTabs;
  const queryWorkspaceActiveTabIdRef = useRef<string | null>(null);
  queryWorkspaceActiveTabIdRef.current = queryWorkspaceActiveTabId;

  const updateGridScrollable = useCallback(() => {
    const el = gridRef.current?.element;
    if (!el) {
      setGridScrollable(false);
      return;
    }
    setGridScrollable(el.scrollHeight > el.clientHeight + 0.5);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStatus("init-db");
    const initPromise = createDuckDB();
    void (async () => {
      try {
        const handle = await initPromise;
        if (cancelled) {
          await handle.terminate().catch(() => {});
          return;
        }
        duckRef.current = handle;
        setStatus("idle");
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
      void (async () => {
        await connRef.current?.close().catch(() => {});
        connRef.current = null;
        try {
          const handle = await initPromise;
          if (duckRef.current === handle) {
            duckRef.current = null;
          }
          await handle.terminate().catch(() => {});
        } catch {
          // Init failed; nothing to terminate.
        }
      })();
    };
  }, []);

  useEffect(() => {
    if (status !== "ready") {
      setGridScrollable(false);
      return;
    }
    let el: HTMLDivElement | null = null;
    let ro: ResizeObserver | null = null;
    let cancelled = false;

    const setup = () => {
      if (cancelled) return;
      el = gridRef.current?.element ?? null;
      if (!el) return;
      updateGridScrollable();
      ro = new ResizeObserver(() => updateGridScrollable());
      ro.observe(el);
      el.addEventListener("scroll", updateGridScrollable, { passive: true });
    };

    const id = requestAnimationFrame(() => requestAnimationFrame(setup));

    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
      if (ro) ro.disconnect();
      if (el) el.removeEventListener("scroll", updateGridScrollable);
    };
  }, [status, totalRows, updateGridScrollable]);

  useLayoutEffect(() => {
    if (status !== "ready") return;
    const root = gridRef.current?.element;
    if (!root) return;

    const apply = () => {
      patchRdgHeaderLetterRow(
        root,
        HEADER_LETTER_ROW_HEIGHT,
        HEADER_MAIN_ROW_HEIGHT,
        HEADER_ROW_UNIFORM_HEIGHT,
      );
      /* GroupedColumnHeaderCell does not merge getCellStyle; mirror frozen leaf headers. */
      const corner = root.querySelector<HTMLElement>(
        `.${GUTTER_CORNER_LETTER_CLASS}`,
      );
      if (corner) {
        corner.style.insetInlineStart = "var(--rdg-frozen-left-0)";
      }
    };

    apply();
    updateGridScrollable();
    /* RDG rewrites gridTemplateRows on render (uniform header height); keep letter = body. */
    const mo = new MutationObserver(apply);
    mo.observe(root, { attributes: true, attributeFilter: ["style"] });
    return () => mo.disconnect();
  }, [status, totalRows, columnNames.length, updateGridScrollable]);

  const columnMetaMap = useMemo(
    () => new Map(columnMeta.map((m) => [m.name, m])),
    [columnMeta],
  );
  columnMetaMapRef.current = columnMetaMap;

  const loadDistinctForColumn = useCallback(async (columnKey: string) => {
    const conn = connRef.current;
    const tableId = dataTableNameRef.current;
    if (!conn || !tableId)
      return { values: [] as (string | null)[], truncated: false };
    const t = quoteIdent(tableId);
    const where = buildWhereClause(
      filtersRef.current,
      columnMetaMapRef.current,
      columnKey,
    );
    const q = quoteIdent(columnKey);
    const sql = `SELECT DISTINCT ${q} AS v FROM ${t} ${where} ORDER BY v NULLS LAST LIMIT ${MAX_DISTINCT + 1}`;
    const table = await conn.query(sql);
    const col = table.getChild("v");
    const values: (string | null)[] = [];
    const n = table.numRows;
    const truncated = n > MAX_DISTINCT;
    const cap = truncated ? MAX_DISTINCT : n;
    for (let i = 0; i < cap; i++) {
      const raw = col?.get(i);
      if (raw === null || raw === undefined) values.push(null);
      else values.push(String(raw));
    }
    return { values, truncated };
  }, []);

  const loadHistogramForColumn = useCallback(
    async (columnKey: string) => {
      const conn = connRef.current;
      const meta = columnMetaMap.get(columnKey);
      const tableId = dataTableNameRef.current;
      if (!conn || !meta || !tableId) {
        return { kind: "empty" as const };
      }
      const where = buildWhereClause(filters, columnMetaMap);
      return fetchColumnHistogram(conn, tableId, meta, where);
    },
    [filters, columnMetaMap],
  );

  const loadRange = useCallback(async (start: number, end: number) => {
    const conn = connRef.current;
    const cols = columnNamesRef.current;
    const rows = rowsRef.current;
    const loaded = loadedRef.current;
    const tableId = dataTableNameRef.current;
    if (!conn || !tableId || cols.length === 0 || !loaded || end <= start)
      return;

    const t = quoteIdent(tableId);
    const where = buildWhereClause(
      filtersRef.current,
      columnMetaMapRef.current,
    );
    const orderBy = buildOrderByClause(
      sortColumnsRef.current,
      columnMetaMapRef.current,
    );
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
      const sql = `SELECT ${list} FROM ${t} ${where} ${orderBy} LIMIT ${chunkSize} OFFSET ${chunkStart};`;
      const table = await conn.query(sql);
      const objects = arrowTableToObjects(table as ArrowTable);
      if (objects.length === 0) break;
      for (let r = 0; r < objects.length; r++) {
        const idx = chunkStart + r;
        if (!rows[idx]) continue;
        rows[idx] = { ...objects[r], __idx: idx, __loaded: true };
        loaded[idx] = 1;
      }
      i = chunkStart + objects.length;
    }
  }, []);

  const runQueryWorkspace = useCallback(async () => {
    const conn = connRef.current;
    const activeId = queryWorkspaceActiveTabIdRef.current;
    const tab = activeId
      ? queryWorkspaceTabsRef.current.find((t) => t.id === activeId)
      : undefined;
    if (!conn) {
      if (activeId) {
        setQueryWorkspaceTabs((prev) =>
          prev.map((t) =>
            t.id === activeId
              ? {
                  ...t,
                  error: "Database connection is not available.",
                }
              : t,
          ),
        );
      }
      return;
    }
    if (!activeId || !tab) return;

    setQueryWorkspaceRunningTabId(activeId);
    const prepared = prepareReadOnlyQuery(tab.sql);
    if ("error" in prepared) {
      setQueryWorkspaceTabs((prev) =>
        prev.map((t) =>
          t.id === activeId ? { ...t, error: prepared.error } : t,
        ),
      );
      setQueryWorkspaceRunningTabId(null);
      return;
    }
    setQueryWorkspaceTabs((prev) =>
      prev.map((t) => (t.id === activeId ? { ...t, error: null } : t)),
    );
    try {
      const table = (await conn.query(prepared.sql)) as ArrowTable;
      const rows = arrowTableToObjects(table);
      const columns = arrowTableColumnNames(table);
      setQueryWorkspaceTabs((prev) =>
        prev.map((t) =>
          t.id === activeId
            ? { ...t, result: { columns, rows }, error: null }
            : t,
        ),
      );
    } catch (e) {
      setQueryWorkspaceTabs((prev) =>
        prev.map((t) =>
          t.id === activeId
            ? {
                ...t,
                error: e instanceof Error ? e.message : String(e),
              }
            : t,
        ),
      );
    } finally {
      setQueryWorkspaceRunningTabId(null);
    }
  }, []);

  const handleQueryWorkspaceSqlChange = useCallback((sql: string) => {
    const activeId = queryWorkspaceActiveTabIdRef.current;
    if (!activeId) return;
    setQueryWorkspaceTabs((prev) =>
      prev.map((t) => (t.id === activeId ? { ...t, sql } : t)),
    );
  }, []);

  const addQueryWorkspaceTab = useCallback(() => {
    const tableId = dataTableNameRef.current;
    const sql = tableId ? `SELECT * FROM ${quoteIdent(tableId)}` : "";
    const id = crypto.randomUUID();
    setQueryWorkspaceTabs((prev) => {
      const newTab: QueryWorkspaceTab = {
        id,
        label: `Query ${prev.length + 1}`,
        sql,
        result: null,
        error: null,
      };
      return [...prev, newTab];
    });
    setQueryWorkspaceActiveTabId(id);
  }, []);

  const renameQueryWorkspaceTab = useCallback((id: string, label: string) => {
    setQueryWorkspaceTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      const fallback = idx >= 0 ? `Query ${idx + 1}` : "Query";
      const nextLabel = label.trim() || fallback;
      return prev.map((t) => (t.id === id ? { ...t, label: nextLabel } : t));
    });
  }, []);

  const closeQueryWorkspaceTab = useCallback((id: string) => {
    const prev = queryWorkspaceTabsRef.current;
    const active = queryWorkspaceActiveTabIdRef.current;
    if (prev.length <= 1) return;
    const idx = prev.findIndex((t) => t.id === id);
    const filtered = prev.filter((t) => t.id !== id);
    let nextActive = active;
    if (active === id) {
      const neighbor = prev[idx - 1] ?? prev[idx + 1];
      nextActive = neighbor?.id ?? filtered[0]!.id;
    }
    setQueryWorkspaceTabs(filtered);
    setQueryWorkspaceActiveTabId(nextActive);
  }, []);

  const applyQueryAndReload = useCallback(async () => {
    const conn = connRef.current;
    const cols = columnNamesRef.current;
    const tableId = dataTableNameRef.current;
    if (!conn || !tableId || cols.length === 0) return;

    const t = quoteIdent(tableId);
    const where = buildWhereClause(
      filtersRef.current,
      columnMetaMapRef.current,
    );
    const countRow = await conn.query(
      `SELECT COUNT(*)::BIGINT AS c FROM ${t} ${where};`,
    );
    const countCol = countRow.getChild("c");
    const n = countCol ? Number(countCol.get(0)) : 0;

    const stubs: GridRow[] = new Array(n);
    const loaded = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      stubs[i] = { __idx: i, __loaded: false };
    }
    rowsRef.current = stubs;
    loadedRef.current = loaded;
    setTotalRows(n);
    bump();

    requestAnimationFrame(() => {
      gridRef.current?.scrollToCell({ idx: 0, rowIdx: 0 });
    });

    await loadRange(0, Math.min(n, SCROLL_OVERSCAN_ROWS * 2 + 200));
    bump();
    requestAnimationFrame(() => updateGridScrollable());
  }, [bump, loadRange, updateGridScrollable]);

  const handleSortAsc = useCallback(
    (columnKey: string) => {
      const cur = [...sortColumnsRef.current];
      const i = cur.findIndex((s) => s.columnKey === columnKey);
      if (i >= 0) cur[i] = { columnKey, direction: "ASC" };
      else cur.push({ columnKey, direction: "ASC" });
      sortColumnsRef.current = cur;
      setSortColumns(cur);
      void applyQueryAndReload();
    },
    [applyQueryAndReload],
  );

  const handleSortDesc = useCallback(
    (columnKey: string) => {
      const cur = [...sortColumnsRef.current];
      const i = cur.findIndex((s) => s.columnKey === columnKey);
      if (i >= 0) cur[i] = { columnKey, direction: "DESC" };
      else cur.push({ columnKey, direction: "DESC" });
      sortColumnsRef.current = cur;
      setSortColumns(cur);
      void applyQueryAndReload();
    },
    [applyQueryAndReload],
  );

  const handleSortClear = useCallback(
    (columnKey: string) => {
      const cur = sortColumnsRef.current.filter(
        (s) => s.columnKey !== columnKey,
      );
      sortColumnsRef.current = cur;
      setSortColumns(cur);
      void applyQueryAndReload();
    },
    [applyQueryAndReload],
  );

  const handleFilterApply = useCallback(
    (columnKey: string, f: ColumnFilter | null) => {
      const next = { ...filtersRef.current };
      if (f == null) delete next[columnKey];
      else next[columnKey] = f;
      filtersRef.current = next;
      setFilters(next);
      void applyQueryAndReload();
    },
    [applyQueryAndReload],
  );

  const clearAllFilters = useCallback(() => {
    filtersRef.current = {};
    setFilters({});
    setFilterDetailsOpen(false);
    void applyQueryAndReload();
  }, [applyQueryAndReload]);

  const clearAllSorting = useCallback(() => {
    sortColumnsRef.current = [];
    setSortColumns([]);
    setSortDetailsOpen(false);
    void applyQueryAndReload();
  }, [applyQueryAndReload]);

  const columns: readonly ColumnOrColumnGroup<GridRow>[] = useMemo(() => {
    const metaByName = columnMetaMap;

    /** Group so the corner matches data columns: blank tier (letters row), then row index tier. */
    const rowNumberColumnGroup: ColumnOrColumnGroup<GridRow> = {
      name: <span className="block h-full min-h-0 w-full" aria-hidden />,
      headerCellClass: `rdg-col-letter-header ${GUTTER_CORNER_LETTER_CLASS}`,
      children: [
        {
          key: ROW_NUM_KEY,
          name: "",
          width: 52,
          minWidth: 44,
          maxWidth: 88,
          resizable: false,
          frozen: true,
          draggable: false,
          sortable: false,
          headerCellClass: GUTTER_HEADER_CLASS,
          renderHeaderCell() {
            return <span className="sr-only">Row numbers</span>;
          },
          renderCell({ row }) {
            return (
              <span
                className={`${GUTTER_LABEL_CLASS} block w-full pr-1.5 text-right`}
                title={`Row ${row.__idx + 1}`}
              >
                {row.__idx + 1}
              </span>
            );
          },
        },
      ],
    };

    const dataColumns: ColumnOrColumnGroup<GridRow>[] = columnNames.map(
      (name, colIndex) => {
        const letter = excelColumnLabel(colIndex);
        const meta = metaByName.get(name);
        const isNumeric = meta?.filterMode === "numeric";
        const leafColumn: Column<GridRow> = {
          key: name,
          name,
          resizable: true,
          sortable: false,
          editable: false,
          headerCellClass: `rdg-csv-header-z-${colIndex}`,
          cellClass: cn(
            "text-xs font-mono tabular-nums",
            isNumeric && "text-right",
          ),
          renderHeaderCell(p: RenderHeaderCellProps<GridRow>) {
            if (!meta) {
              return (
                <div className="flex h-full min-w-0 items-center py-0.5 pr-1">
                  <span
                    className="min-w-0 flex-1 truncate text-xs font-medium"
                    title={name}
                  >
                    {name}
                  </span>
                </div>
              );
            }
            return (
              <CsvColumnHeader
                columnKey={name}
                displayName={name}
                typeLabel={meta.typeLabel}
                filterMode={meta.filterMode}
                sortColumns={sortColumns}
                tabIndex={p.tabIndex}
                filter={filters[name]}
                onSortAsc={() => handleSortAsc(name)}
                onSortDesc={() => handleSortDesc(name)}
                onSortClear={() => handleSortClear(name)}
                onFilterApply={(f) => handleFilterApply(name, f)}
                loadDistinct={() => loadDistinctForColumn(name)}
                loadHistogramForColumn={loadHistogramForColumn}
              />
            );
          },
          renderCell({ row, column }: RenderCellProps<GridRow>) {
            if (!row.__loaded) {
              return (
                <span className="text-muted-foreground text-xs font-mono">…</span>
              );
            }
            const v = (row as Record<string, unknown>)[column.key];
            if (v === null || v === undefined) return "";
            if (typeof v === "object") return JSON.stringify(v);
            return String(v);
          },
        };

        return {
          name: (
            <span
              className={`${GUTTER_LABEL_CLASS} flex h-full w-full select-none items-center justify-center leading-none`}
              title={`Column ${letter}`}
            >
              {letter}
            </span>
          ),
          headerCellClass: "rdg-col-letter-header",
          children: [leafColumn],
        };
      },
    );

    return [rowNumberColumnGroup, ...dataColumns];
  }, [
    columnNames,
    columnMetaMap,
    sortColumns,
    filters,
    handleSortAsc,
    handleSortDesc,
    handleSortClear,
    handleFilterApply,
    loadDistinctForColumn,
    loadHistogramForColumn,
  ]);

  /** Left headers stack above right ones so column resize handles can straddle the shared border. */
  const headerResizeStackCss = useMemo(() => {
    if (columnNames.length === 0) return "";
    const n = columnNames.length;
    return columnNames
      .map(
        (_, colIndex) =>
          `.rdg-wrap .rdg-header-row .rdg-csv-header-z-${colIndex}{z-index:${
            10000 + n - colIndex
          }}`,
      )
      .join("");
  }, [columnNames]);

  const scheduleRangeLoad = useCallback(
    (scrollTop: number, clientHeight: number) => {
      if (scrollRafRef.current !== null)
        cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = null;
        const total = rowsRef.current.length;
        if (total === 0) return;
        const first = Math.max(
          0,
          Math.floor(scrollTop / ROW_HEIGHT) - SCROLL_OVERSCAN_ROWS,
        );
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
            requestAnimationFrame(() => updateGridScrollable());
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            fetchInFlightRef.current = false;
            setWindowLoading(false);
          }
        })();
      });
    },
    [bump, loadRange, updateGridScrollable],
  );

  const ingestFile = async (file: File) => {
    setError(null);
    if (!duckRef.current) {
      setError("Database is not ready yet.");
      return;
    }
    setStatus("loading");
    try {
      setQueryWorkspaceOpen(false);
      setQueryWorkspaceTabs([]);
      setQueryWorkspaceActiveTabId(null);
      setQueryWorkspaceRunningTabId(null);
      dataTableNameRef.current = null;
      setDataTableName(null);
      await connRef.current?.close().catch(() => {});
      connRef.current = null;
      loadedRef.current = null;
      rowsRef.current = [];
      setColumnNames([]);
      setColumnMeta([]);
      setTotalRowsUnfiltered(0);
      columnNamesRef.current = [];
      sortColumnsRef.current = [];
      filtersRef.current = {};
      setSortColumns([]);
      setFilters({});
      bump();

      const buf = await file.arrayBuffer();
      const db = duckRef.current.db;
      await db.registerFileBuffer(REGISTERED_NAME, new Uint8Array(buf));

      const conn = await db.connect();
      connRef.current = conn;

      const tableId = tableIdentifierFromFileName(file.name);
      const tableQuoted = quoteIdent(tableId);
      dataTableNameRef.current = tableId;
      setDataTableName(tableId);
      const initialTab: QueryWorkspaceTab = {
        id: crypto.randomUUID(),
        label: "Query 1",
        sql: `SELECT * FROM ${tableQuoted}`,
        result: null,
        error: null,
      };
      setQueryWorkspaceTabs([initialTab]);
      setQueryWorkspaceActiveTabId(initialTab.id);

      await conn.query(`
        CREATE OR REPLACE TABLE ${tableQuoted} AS
        SELECT * FROM read_csv_auto('${REGISTERED_NAME}');
      `);

      const meta = await fetchTableColumnMeta(conn, tableId);
      const names = meta.map((m) => m.name);
      const map = new Map(meta.map((m) => [m.name, m]));
      columnMetaMapRef.current = map;
      setColumnMeta(meta);
      setColumnNames(names);
      columnNamesRef.current = names;

      const allCountRow = await conn.query(
        `SELECT COUNT(*)::BIGINT AS c FROM ${tableQuoted};`,
      );
      const allC = allCountRow.getChild("c");
      setTotalRowsUnfiltered(allC ? Number(allC.get(0)) : 0);

      setFileLabel(file.name);
      setStatus("ready");
      bump();

      await applyQueryAndReload();
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

  const openFile = () => fileInputRef.current?.click();

  const hasSpreadsheet = status === "ready";
  const topBarDisabled = status === "init-db";
  const isEmptyChrome = status === "idle" || status === "init-db";

  const activeFilterCount = countActiveColumnFilters(filters, columnMetaMap);
  const activeFilterLines = useMemo(
    () => listActiveFilterLines(filters, columnMetaMap),
    [filters, columnMetaMap],
  );
  const sortDetailLines = useMemo(
    () => listSortDetails(sortColumns),
    [sortColumns],
  );

  return (
    <div className="bg-background flex h-dvh flex-col overflow-hidden">
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={onBrowse}
      />

      <AppTopBar
        fileLabel={fileLabel}
        hasSpreadsheet={hasSpreadsheet}
        showOpenFileButton={!isEmptyChrome}
        openFileDisabled={topBarDisabled}
        onOpenFile={openFile}
      />

      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col",
          isDragging && "bg-accent/30",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
      >
        <main
          className={cn(
            "flex min-h-0 flex-1 flex-col",
            status === "ready" ? "p-0" : "px-4 py-4",
          )}
        >
          {status === "init-db" ? (
            <div className="flex min-h-0 flex-1 items-center justify-center">
              <div className="flex w-full max-w-56 flex-col items-center gap-3">
                <p className="text-muted-foreground text-sm">Loading...</p>
                <div
                  className="bg-muted h-2.5 w-full overflow-hidden rounded-full"
                  role="progressbar"
                  aria-busy="true"
                  aria-label="Loading"
                >
                  <div className="bg-primary loading-bar-indeterminate h-full w-1/3 rounded-full" />
                </div>
              </div>
            </div>
          ) : null}

          {status === "idle" ? (
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto">
              <div className="w-full max-w-md shrink-0">
                <Empty className="border-border border border-dashed">
                  <EmptyHeader>
                    <EmptyTitle>Open a CSV</EmptyTitle>
                    <EmptyDescription className="text-foreground/80">
                      Drag and drop a .csv file here, or choose a file to load.
                      Data stays in your browser and is processed locally.
                    </EmptyDescription>
                  </EmptyHeader>
                  <Button type="button" variant="default" onClick={openFile}>
                    Choose CSV
                  </Button>
                </Empty>
              </div>
            </div>
          ) : null}

          {status === "loading" ? (
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto">
              <div className="w-full max-w-md shrink-0">
                <Empty className="border-border border border-dashed">
                  <EmptyHeader>
                    <EmptyTitle>Loading CSV…</EmptyTitle>
                    <EmptyDescription>
                      Importing your file (this may take a while for large
                      files).
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </div>
            </div>
          ) : null}

          {status === "error" && error ? (
            <div className="flex min-h-0 flex-1 items-center justify-center">
              <Card className="border-destructive/50 w-full max-w-md">
                <CardHeader>
                  <CardTitle className="text-destructive">
                    Something went wrong
                  </CardTitle>
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
            </div>
          ) : null}

          {status === "ready" ? (
            <div
              className={cn(
                "rdg-wrap bg-background flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
                gridScrollable && "rdg-scrollable",
              )}
            >
              {headerResizeStackCss ? (
                <style>{headerResizeStackCss}</style>
              ) : null}
              <DataGrid
                ref={gridRef}
                className="rdg-theme rdg-fill-grid min-h-0 min-w-0 flex-1"
                columns={columns}
                rows={rowsRef.current}
                rowKeyGetter={(row) => row.__idx}
                sortColumns={sortColumns}
                defaultColumnOptions={{
                  resizable: true,
                  sortable: false,
                }}
                rowHeight={ROW_HEIGHT}
                headerRowHeight={HEADER_ROW_UNIFORM_HEIGHT}
                enableVirtualization
                onScroll={(e) => {
                  const t = e.currentTarget;
                  scheduleRangeLoad(t.scrollTop, t.clientHeight);
                  updateGridScrollable();
                }}
              />
            </div>
          ) : null}
        </main>
      </div>

      {status !== "idle" && status !== "init-db" ? (
        <AppFooter
          totalRows={totalRows}
          totalRowsUnfiltered={totalRowsUnfiltered}
          columnCount={columnNames.length}
          showRowStats={status === "ready"}
          windowLoading={windowLoading}
          importing={status === "loading"}
          loadError={status === "error"}
          activeFilterCount={activeFilterCount}
          sortColumnCount={sortColumns.length}
          onActiveFiltersClick={
            status === "ready" && activeFilterCount > 0
              ? () => setFilterDetailsOpen(true)
              : undefined
          }
          onSortDetailsClick={
            status === "ready" && sortColumns.length > 0
              ? () => setSortDetailsOpen(true)
              : undefined
          }
          onQueryDataClick={() => setQueryWorkspaceOpen(true)}
          queryDataDisabled={status !== "ready"}
        />
      ) : null}

      <Dialog open={filterDetailsOpen} onOpenChange={setFilterDetailsOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Active filters</DialogTitle>
            <DialogDescription>
              Only rows that match all of the following conditions are shown in
              the grid.
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-[min(60vh,22rem)] list-none space-y-3 overflow-y-auto pr-1">
            {activeFilterLines.map(({ column, line }) => (
              <li
                key={column}
                className="border-border border-b pb-3 text-sm last:border-b-0 last:pb-0"
              >
                <p className="text-foreground leading-snug">{line}</p>
              </li>
            ))}
          </ul>
          <DialogFooter className="mt-2">
            <Button type="button" variant="outline" onClick={clearAllFilters}>
              Clear all filters
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SqlQueryWorkspace
        open={queryWorkspaceOpen}
        onOpenChange={setQueryWorkspaceOpen}
        tableIdentifier={dataTableName}
        columnMeta={columnMeta}
        tabs={queryWorkspaceTabs}
        activeTabId={queryWorkspaceActiveTabId}
        onActiveTabChange={setQueryWorkspaceActiveTabId}
        onSqlChange={handleQueryWorkspaceSqlChange}
        onAddTab={addQueryWorkspaceTab}
        onCloseTab={closeQueryWorkspaceTab}
        onTabLabelChange={renameQueryWorkspaceTab}
        runningTabId={queryWorkspaceRunningTabId}
        onRun={runQueryWorkspace}
        queryDataDisabled={status !== "ready"}
      />

      <Dialog open={sortDetailsOpen} onOpenChange={setSortDetailsOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Sort order</DialogTitle>
            <DialogDescription>
              Rows are ordered by these columns, from first (primary) to last
              (tie-breaker).
            </DialogDescription>
          </DialogHeader>
          <ol className="max-h-[min(60vh,22rem)] list-decimal space-y-3 overflow-y-auto pl-5 pr-1 text-sm">
            {sortDetailLines.map(({ priority, columnKey, direction }) => (
              <li
                key={`${columnKey}-${priority}`}
                className="border-border border-b pb-3 marker:font-medium last:border-b-0 last:pb-0"
              >
                <span className="text-foreground font-medium">{columnKey}</span>
                <span className="text-muted-foreground">
                  {" "}
                  — {direction === "ASC" ? "Ascending" : "Descending"}
                </span>
              </li>
            ))}
          </ol>
          <DialogFooter className="mt-2">
            <Button type="button" variant="outline" onClick={clearAllSorting}>
              Clear all sorting
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
