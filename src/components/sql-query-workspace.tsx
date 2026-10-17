"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ChartColumn,
  Download,
  Expand,
  Minus,
  Play,
  Plus,
  X,
} from "lucide-react";

import type { ColumnMeta } from "@/lib/column-type-meta";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { defaultSelectAllSql } from "@/lib/csv-query";
import { SqlCodeEditor } from "@/components/sql-code-editor";
import { cn } from "@/lib/utils";

import {
  SqlQueryResultsChart,
  defaultQueryChartConfig,
  isQueryChartReady,
  queryChartKindLabel,
  type QueryChartConfig,
} from "@/components/sql-query-results-chart";
import { QueryResultsGrid } from "@/components/query-results-grid";
import {
  listNumericChartColumns,
  normalizeYAggregate,
} from "@/lib/chart-series";

export type QueryResultState = {
  columns: string[];
  totalRows: number;
  /** DuckDB temp table; null for DESCRIBE/SHOW/EXPLAIN (uses {@link inlineRows}). */
  resultTable: string | null;
  /** Full rows for meta queries that are not materialized. */
  inlineRows?: Record<string, unknown>[];
  /** Sample for chart column pickers. */
  sampleRows: Record<string, unknown>[];
  /** Bumps on every successful run so the results grid remounts its window cache. */
  revision: number;
} | null;

export type QueryWorkspaceTab = {
  id: string;
  /** User-visible tab title (editable). */
  label: string;
  sql: string;
  result: QueryResultState;
  error: string | null;
};

export type QueryDownloadProgress = {
  exported: number;
  total: number;
} | null;

type SqlQueryWorkspaceProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** DuckDB table identifier derived from the loaded CSV file name. */
  tableIdentifier: string | null;
  columnMeta: ColumnMeta[];
  tabs: QueryWorkspaceTab[];
  activeTabId: string | null;
  onActiveTabChange: (id: string) => void;
  onSqlChange: (sql: string) => void;
  onAddTab: () => void;
  onCloseTab: (id: string) => void;
  onTabLabelChange: (id: string, label: string) => void;
  runningTabId: string | null;
  onRun: () => void;
  queryDataDisabled?: boolean;
  fetchResultWindow: (
    tabId: string,
    start: number,
    end: number,
  ) => Promise<Record<string, unknown>[]>;
  fetchChartSeries: (
    tabId: string,
    config: QueryChartConfig,
  ) => Promise<{ rows: Record<string, unknown>[] } | { error: string }>;
  downloadResults: (tabId: string) => Promise<void>;
  /** Non-null only when a progress modal should show (large exports). */
  downloadProgress: QueryDownloadProgress;
  /** True for any in-flight download (including small ones without a modal). */
  downloadBusy: boolean;
};

type DockedChart = {
  id: string;
  config: QueryChartConfig;
};

function sanitizeChartConfig(
  raw: QueryChartConfig,
  result: QueryResultState,
): QueryChartConfig {
  const base: QueryChartConfig = {
    ...defaultQueryChartConfig(),
    ...raw,
    yAggregate: normalizeYAggregate(raw.yAggregate),
  };
  if (result == null) return base;
  const cols = new Set(result.columns);
  return {
    ...base,
    xColumn: base.xColumn && cols.has(base.xColumn) ? base.xColumn : null,
    yColumn: base.yColumn && cols.has(base.yColumn) ? base.yColumn : null,
    pieLabelColumn:
      base.pieLabelColumn && cols.has(base.pieLabelColumn)
        ? base.pieLabelColumn
        : null,
    pieValueColumn:
      base.pieValueColumn && cols.has(base.pieValueColumn)
        ? base.pieValueColumn
        : null,
  };
}

function newChartId(): string {
  return crypto.randomUUID();
}

const MD_MIN_WIDTH_QUERY = "(min-width: 768px)";

function subscribeMdMinWidth(onChange: () => void) {
  const mq = window.matchMedia(MD_MIN_WIDTH_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function getMdMinWidthSnapshot() {
  return window.matchMedia(MD_MIN_WIDTH_QUERY).matches;
}

function useMinWidthMd() {
  return useSyncExternalStore(subscribeMdMinWidth, getMdMinWidthSnapshot, () => true);
}

export function SqlQueryWorkspace({
  open,
  onOpenChange,
  tableIdentifier,
  columnMeta,
  tabs,
  activeTabId,
  onActiveTabChange,
  onSqlChange,
  onAddTab,
  onCloseTab,
  onTabLabelChange,
  runningTabId,
  onRun,
  queryDataDisabled,
  fetchResultWindow,
  fetchChartSeries,
  downloadResults,
  downloadProgress,
  downloadBusy,
}: SqlQueryWorkspaceProps) {
  const isMd = useMinWidthMd();
  const renameInputRef = useRef<HTMLInputElement>(null);
  const skipBlurCommitRef = useRef(false);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [chartModalOpen, setChartModalOpen] = useState(false);
  /** Chart currently open in the modal; null means a brand-new draft. */
  const [editingChartId, setEditingChartId] = useState<string | null>(null);
  const [draftChartConfig, setDraftChartConfig] = useState<QueryChartConfig>(
    () => defaultQueryChartConfig(),
  );
  /** Minimized charts docked in the results pane, keyed by query tab. */
  const [dockedChartsByTabId, setDockedChartsByTabId] = useState<
    Record<string, DockedChart[]>
  >({});
  /** Config to put back on the dock if the user closes an expanded chart unfinished. */
  const restoreDockedOnCloseRef = useRef<DockedChart | null>(null);
  const [chartSeriesRows, setChartSeriesRows] = useState<
    Record<string, unknown>[] | null
  >(null);
  const [chartSeriesError, setChartSeriesError] = useState<string | null>(null);
  const [chartSeriesLoading, setChartSeriesLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      skipBlurCommitRef.current = false;
      queueMicrotask(() => {
        setEditingTabId(null);
        setDraftLabel("");
        setChartModalOpen(false);
        setEditingChartId(null);
        restoreDockedOnCloseRef.current = null;
      });
    }
  }, [open]);

  useEffect(() => {
    setChartModalOpen(false);
    setEditingChartId(null);
    restoreDockedOnCloseRef.current = null;
  }, [activeTabId]);

  const commitRename = useCallback(() => {
    if (editingTabId == null) return;
    onTabLabelChange(editingTabId, draftLabel);
    setEditingTabId(null);
    setDraftLabel("");
  }, [draftLabel, editingTabId, onTabLabelChange]);

  const cancelRename = useCallback(() => {
    skipBlurCommitRef.current = true;
    setEditingTabId(null);
    setDraftLabel("");
  }, []);

  const handleRenameBlur = useCallback(() => {
    if (skipBlurCommitRef.current) {
      skipBlurCommitRef.current = false;
      return;
    }
    commitRename();
  }, [commitRename]);

  useLayoutEffect(() => {
    if (editingTabId == null) return;
    const el = renameInputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [editingTabId]);

  const activeTab =
    tabs.find((t) => t.id === activeTabId) ?? tabs[0] ?? null;
  const sql = activeTab?.sql ?? "";
  const result = activeTab?.result ?? null;
  const error = activeTab?.error ?? null;
  const running =
    activeTabId != null && runningTabId === activeTabId;

  const sampleRows = result?.sampleRows ?? [];

  const resultNumericColumns = useMemo(() => {
    if (result == null || sampleRows.length === 0) return new Set<string>();
    return new Set(listNumericChartColumns(result.columns, sampleRows));
  }, [result, sampleRows]);

  const chartConfig = useMemo(
    () => sanitizeChartConfig(draftChartConfig, result),
    [draftChartConfig, result],
  );

  const chartReady = useMemo(() => {
    if (result == null || result.totalRows === 0) return false;
    return isQueryChartReady(chartConfig, result.columns, sampleRows);
  }, [chartConfig, result, sampleRows]);

  const dockedCharts = useMemo(() => {
    if (activeTabId == null || result == null || result.totalRows === 0) {
      return [];
    }
    return (dockedChartsByTabId[activeTabId] ?? [])
      .map((chart) => ({
        ...chart,
        config: sanitizeChartConfig(chart.config, result),
      }))
      .filter((chart) =>
        isQueryChartReady(chart.config, result.columns, sampleRows),
      );
  }, [activeTabId, dockedChartsByTabId, result, sampleRows]);

  const fetchWindowForActive = useCallback(
    (start: number, end: number) => {
      if (activeTabId == null) return Promise.resolve([]);
      return fetchResultWindow(activeTabId, start, end);
    },
    [activeTabId, fetchResultWindow],
  );

  useEffect(() => {
    if (!chartModalOpen || activeTabId == null || !chartReady) {
      setChartSeriesRows(null);
      setChartSeriesError(null);
      setChartSeriesLoading(false);
      return;
    }
    let cancelled = false;
    setChartSeriesLoading(true);
    setChartSeriesError(null);
    void fetchChartSeries(activeTabId, chartConfig).then((res) => {
      if (cancelled) return;
      setChartSeriesLoading(false);
      if ("error" in res) {
        setChartSeriesError(res.error);
        setChartSeriesRows([]);
      } else {
        setChartSeriesRows(res.rows);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [chartModalOpen, activeTabId, chartReady, chartConfig, fetchChartSeries]);

  /** Reopen a minimized chart. */
  const expandDockedChart = useCallback((chart: DockedChart) => {
    if (activeTabId == null) return;
    restoreDockedOnCloseRef.current = chart;
    setDockedChartsByTabId((prev) => ({
      ...prev,
      [activeTabId]: (prev[activeTabId] ?? []).filter((c) => c.id !== chart.id),
    }));
    setEditingChartId(chart.id);
    setDraftChartConfig({
      ...defaultQueryChartConfig(),
      ...chart.config,
      yAggregate: normalizeYAggregate(chart.config.yAggregate),
    });
    setChartModalOpen(true);
  }, [activeTabId]);

  /** Start a fresh chart; leave any docked charts in place. */
  const buildNewChart = useCallback(() => {
    restoreDockedOnCloseRef.current = null;
    setEditingChartId(null);
    setDraftChartConfig(defaultQueryChartConfig());
    setChartModalOpen(true);
  }, []);

  /** Dismiss the modal without docking (Close, Escape, overlay). */
  const dismissChartModal = useCallback(() => {
    restoreDockedOnCloseRef.current = null;
    setChartModalOpen(false);
    setEditingChartId(null);
  }, []);

  /** Dock a ready chart at the bottom of Results. */
  const minimizeChartModal = useCallback(() => {
    if (activeTabId == null || !chartReady) return;
    const saved: DockedChart = {
      id: editingChartId ?? newChartId(),
      config: chartConfig,
    };
    setDockedChartsByTabId((prev) => ({
      ...prev,
      [activeTabId]: [...(prev[activeTabId] ?? []), saved],
    }));
    restoreDockedOnCloseRef.current = null;
    setChartModalOpen(false);
    setEditingChartId(null);
  }, [activeTabId, chartReady, chartConfig, editingChartId]);

  const handleChartOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        setChartModalOpen(true);
        return;
      }
      dismissChartModal();
    },
    [dismissChartModal],
  );

  const handleDraftChartConfigChange = useCallback((next: QueryChartConfig) => {
    setDraftChartConfig({
      ...defaultQueryChartConfig(),
      ...next,
      yAggregate: normalizeYAggregate(next.yAggregate),
    });
  }, []);

  const downloadResultsCsv = useCallback(() => {
    if (!result || result.totalRows === 0 || activeTabId == null) return;
    if (downloadBusy) return;
    void downloadResults(activeTabId);
  }, [activeTabId, downloadBusy, downloadResults, result]);

  const editorId =
    activeTabId != null
      ? `sql-query-editor-${activeTabId}`
      : "sql-query-editor";

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className={cn(
          "fixed inset-0 top-0 left-0 z-50 flex h-dvh max-h-dvh w-full max-w-none min-w-0 translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 p-0 shadow-none sm:max-w-none",
        )}
      >
        <div className="bg-background flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <header className="border-border flex shrink-0 items-center border-b px-4 py-3 pr-14">
            <DialogTitle
              className="text-foreground font-mono text-base leading-snug font-medium tracking-normal break-all"
              title={tableIdentifier ?? undefined}
            >
              {tableIdentifier ?? "—"}
            </DialogTitle>
          </header>

          <ResizablePanelGroup
            key={isMd ? "sql-outer-md" : "sql-outer-sm"}
            orientation={isMd ? "horizontal" : "vertical"}
            className="min-h-0 min-w-0 flex-1"
          >
            <ResizablePanel
              id="sql-sidebar"
              defaultSize={isMd ? "18%" : "28%"}
              minSize={isMd ? "12%" : "16%"}
              maxSize="50%"
              className="min-h-0 min-w-0"
            >
              <aside className="bg-muted/20 flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
                <div className="shrink-0 px-4 pt-3 pb-2">
                  <span className="text-muted-foreground text-xs font-medium uppercase tracking-[0.14em]">
                    Columns
                  </span>
                </div>
                <ScrollArea
                  className={cn("min-h-[120px] flex-1", isMd && "min-h-0")}
                >
                  <ul className="space-y-2.5 px-4 pt-1 pb-4">
                    {columnMeta.map((c) => (
                      <li key={c.name}>
                        <p
                          className="text-foreground font-mono text-xs leading-snug break-all"
                          title={c.name}
                        >
                          {c.name}
                        </p>
                        <p className="text-muted-foreground font-mono text-xs leading-snug">
                          {c.duckdbType}
                        </p>
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              </aside>
            </ResizablePanel>

            <ResizableHandle className="shrink-0" />

            <ResizablePanel
              id="sql-main"
              minSize="35%"
              className="min-h-0 min-w-0"
            >
              <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
              <div
                className="bg-muted/80 dark:bg-muted/50 flex min-h-0 shrink-0 items-center gap-0 overflow-x-auto p-0"
                role="tablist"
                aria-label="Query tabs"
              >
                {tabs.map((tab) => {
                  const isActive = tab.id === activeTabId;
                  const canClose = tabs.length > 1;
                  const isEditing = editingTabId === tab.id;
                  return (
                    <div
                      key={tab.id}
                      className={cn(
                        "flex max-w-[min(100%,12rem)] min-h-8 shrink-0 items-center border-r border-border",
                        isActive
                          ? "border-b-0 bg-background text-foreground"
                          : "border-b border-border bg-muted/40 text-muted-foreground hover:bg-muted/55 hover:text-foreground dark:bg-muted/25 dark:hover:bg-muted/40",
                      )}
                    >
                      {isEditing ? (
                        <input
                          ref={renameInputRef}
                          type="text"
                          value={draftLabel}
                          onChange={(e) => setDraftLabel(e.target.value)}
                          onBlur={handleRenameBlur}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              skipBlurCommitRef.current = true;
                              commitRename();
                            }
                            if (e.key === "Escape") {
                              e.preventDefault();
                              cancelRename();
                            }
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="border-input bg-background text-foreground placeholder:text-muted-foreground max-w-full min-w-16 flex-1 px-2 py-1 text-xs font-medium outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          aria-label="Tab name"
                        />
                      ) : (
                        <button
                          type="button"
                          role="tab"
                          aria-selected={isActive}
                          className="min-w-0 flex-1 truncate px-2.5 py-1.5 text-left text-xs font-medium"
                          onClick={() => {
                            if (activeTabId === tab.id) {
                              setEditingTabId(tab.id);
                              setDraftLabel(tab.label);
                            } else {
                              onActiveTabChange(tab.id);
                            }
                          }}
                        >
                          {tab.label}
                        </button>
                      )}
                      {canClose ? (
                        <button
                          type="button"
                          className={cn(
                            "mr-0.5 shrink-0 rounded-sm p-1",
                            isActive
                              ? "text-muted-foreground hover:text-foreground"
                              : "text-muted-foreground/80 hover:text-foreground",
                          )}
                          aria-label={`Close ${tab.label}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onCloseTab(tab.id);
                          }}
                        >
                          <X className="size-3.5" />
                        </button>
                      ) : null}
                    </div>
                  );
                })}
                <button
                  type="button"
                  className={cn(
                    "inline-flex h-8 min-w-8 shrink-0 items-center justify-center rounded-none",
                    "border-0 border-b border-solid border-border bg-muted/40",
                    "text-muted-foreground hover:bg-muted/55 hover:text-foreground",
                    "dark:bg-muted/25 dark:hover:bg-muted/40",
                    "outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    "disabled:pointer-events-none disabled:opacity-50",
                  )}
                  aria-label="New query tab"
                  disabled={queryDataDisabled}
                  onClick={onAddTab}
                >
                  <Plus className="size-4" aria-hidden />
                </button>
                {/* Fills the rest of the tab row so the bottom border continues past the + control */}
                <div
                  className="bg-muted/80 dark:bg-muted/50 min-h-8 min-w-0 flex-1 border-b border-border"
                  aria-hidden
                />
              </div>

              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-t-0">
                <ResizablePanelGroup
                  orientation="vertical"
                  className="min-h-0 flex-1"
                >
                  <ResizablePanel
                    id="sql-editor"
                    defaultSize="30%"
                    minSize="22%"
                    className="min-h-0"
                  >
                    <div className="bg-muted/15 flex h-full min-h-0 flex-col border-t-0">
                      <div className="text-muted-foreground flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 text-xs">
                        <span className="text-foreground shrink-0 font-medium uppercase tracking-[0.14em]">
                          Editor
                        </span>
                        <Tooltip>
                          <TooltipTrigger
                            delay={0}
                            render={
                              <Button
                                type="button"
                                size="sm"
                                className="shrink-0 gap-1.5"
                                disabled={queryDataDisabled || running}
                                onClick={() => onRun()}
                                aria-label="Run query"
                              />
                            }
                          >
                            <Play className="size-3.5 fill-current" />
                            Run Query
                          </TooltipTrigger>
                          <TooltipContent>⌘↵ / Ctrl+Enter</TooltipContent>
                        </Tooltip>
                      </div>
                      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
                        <SqlCodeEditor
                          key={activeTabId ?? "none"}
                          id={editorId}
                          value={sql}
                          onChange={onSqlChange}
                          onRun={
                            queryDataDisabled || running ? undefined : onRun
                          }
                          placeholder={
                            tableIdentifier
                              ? defaultSelectAllSql(tableIdentifier)
                              : "SELECT …"
                          }
                          disabled={queryDataDisabled}
                        />
                      </div>
                    </div>
                  </ResizablePanel>

                  <ResizableHandle className="shrink-0" />

                  <ResizablePanel
                    id="sql-results"
                    minSize="25%"
                    className="min-h-0"
                  >
                    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[color-mix(in_oklab,var(--muted)_12%,transparent)]">
                  <div className="text-muted-foreground flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3 text-xs">
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="text-foreground font-medium uppercase tracking-[0.14em]">
                        Results
                      </span>
                      {result ? (
                        <span className="max-w-full font-normal wrap-break-word">
                          {result.totalRows.toLocaleString()}{" "}
                          {result.totalRows === 1 ? "row" : "rows"}
                        </span>
                      ) : null}
                    </div>
                    {result && result.totalRows > 0 ? (
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-1.5"
                          disabled={downloadBusy}
                          onClick={downloadResultsCsv}
                        >
                          <Download className="size-3.5" />
                          Download
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="gap-1.5"
                          onClick={buildNewChart}
                        >
                          <ChartColumn className="size-3.5" />
                          Build Chart
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  {error ? (
                    <div
                      className="border-destructive/30 bg-destructive/10 text-destructive mx-4 mb-2 rounded-md border px-3 py-2 text-sm"
                      role="alert"
                    >
                      {error}
                    </div>
                  ) : null}
                  <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                    {running ? (
                      <p
                        className="text-muted-foreground border-border/60 bg-muted/40 border-b px-4 py-2 text-xs"
                        aria-live="polite"
                      >
                        Running…
                      </p>
                    ) : null}
                    {!result && !error && !running ? (
                      <p className="text-muted-foreground px-4 py-6 text-sm">
                        Run a query to see results here.
                      </p>
                    ) : null}
                    {result && result.totalRows === 0 && !error && !running ? (
                      <p className="text-muted-foreground px-4 py-6 text-sm">
                        No rows returned.
                      </p>
                    ) : null}
                    {result && result.totalRows > 0 ? (
                      <QueryResultsGrid
                        resultKey={`${activeTabId ?? ""}:${result.resultTable ?? "inline"}:${result.revision}`}
                        columns={result.columns}
                        totalRows={result.totalRows}
                        numericColumns={resultNumericColumns}
                        fetchWindow={fetchWindowForActive}
                      />
                    ) : null}
                    {dockedCharts.length > 0 && result ? (
                      <div
                        className="absolute right-3 bottom-3 z-20 flex max-w-[calc(100%-1.5rem)] flex-row flex-nowrap items-end justify-end gap-2 overflow-x-auto"
                        role="region"
                        aria-label="Minimized charts"
                      >
                        {dockedCharts.map((chart) => (
                          <div
                            key={chart.id}
                            className="bg-primary text-primary-foreground border-primary flex shrink-0 items-center gap-3 rounded-full border py-1 pr-1.5 pl-3.5 shadow-sm"
                          >
                            <span className="min-w-0 truncate text-xs font-medium uppercase tracking-[0.14em]">
                              {queryChartKindLabel(chart.config.kind)}
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Expand chart"
                              className="text-primary-foreground rounded-full hover:bg-primary-foreground/10 hover:text-primary-foreground"
                              onClick={() => expandDockedChart(chart)}
                            >
                              <Expand className="size-3.5" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                    </div>
                  </ResizablePanel>
                </ResizablePanelGroup>
              </div>
            </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </DialogContent>
    </Dialog>

    <Dialog
      open={
        open && chartModalOpen && result != null && result.totalRows > 0
      }
      onOpenChange={handleChartOpenChange}
    >
      <DialogContent
        showCloseButton={false}
        overlayClassName="z-[60]"
        className="z-[60] flex h-[min(85dvh,44rem)] w-full max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl"
      >
        <DialogHeader className="border-border shrink-0 border-b px-4 py-3 pr-20">
          <DialogTitle className="uppercase tracking-[0.14em]">
            Build Chart
          </DialogTitle>
          <DialogDescription className="sr-only">
            Configure and preview a chart from the current query results.
          </DialogDescription>
        </DialogHeader>
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Minimize chart"
            title="Minimize"
            disabled={!chartReady}
            onClick={minimizeChartModal}
          >
            <Minus className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close chart"
            title="Close"
            onClick={dismissChartModal}
          >
            <X className="size-3.5" />
          </Button>
        </div>
        {result && result.totalRows > 0 && activeTabId != null ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden pt-3">
            {chartSeriesError ? (
              <p className="text-destructive px-4 text-sm" role="alert">
                {chartSeriesError}
              </p>
            ) : null}
            {chartSeriesLoading ? (
              <p className="text-muted-foreground px-4 text-sm">Loading chart…</p>
            ) : null}
            <SqlQueryResultsChart
              columns={result.columns}
              rows={sampleRows}
              plotRows={chartSeriesRows}
              seriesReady={chartSeriesRows != null && !chartSeriesLoading}
              config={chartConfig}
              onConfigChange={handleDraftChartConfigChange}
            />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>

    <Dialog
      open={downloadProgress != null}
      onOpenChange={(next) => {
        if (!next && downloadProgress != null) {
          /* Block dismiss while download runs — parent clears progress when done. */
        }
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-sm"
        overlayClassName="z-[70]"
      >
        <DialogHeader>
          <DialogTitle>Downloading results…</DialogTitle>
          <DialogDescription>
            {downloadProgress
              ? `${downloadProgress.exported.toLocaleString()} of ${downloadProgress.total.toLocaleString()} rows`
              : "Preparing download…"}
          </DialogDescription>
        </DialogHeader>
        <div
          className="bg-muted h-1 w-full overflow-hidden rounded-lg"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={
            downloadProgress && downloadProgress.total > 0
              ? Math.round(
                  (100 * downloadProgress.exported) / downloadProgress.total,
                )
              : 0
          }
          aria-label="Download progress"
        >
          <div
            className="bg-primary h-full rounded-lg transition-[width] duration-150"
            style={{
              width:
                downloadProgress && downloadProgress.total > 0
                  ? `${Math.min(
                      100,
                      (100 * downloadProgress.exported) /
                        downloadProgress.total,
                    )}%`
                  : "0%",
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
