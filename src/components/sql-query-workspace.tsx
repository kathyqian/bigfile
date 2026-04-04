"use client";

import { useCallback, useRef } from "react";
import { Play } from "lucide-react";

import type { ColumnMeta } from "@/lib/column-type-meta";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { quoteIdent } from "@/lib/csv-query";
import { QUERY_RESULT_ROW_LIMIT } from "@/lib/sql-guardrails";
import { cn } from "@/lib/utils";

export type QueryResultState = {
  columns: string[];
  rows: Record<string, unknown>[];
} | null;

type SqlQueryWorkspaceProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** DuckDB table identifier derived from the loaded CSV file name. */
  tableIdentifier: string | null;
  columnMeta: ColumnMeta[];
  sql: string;
  onSqlChange: (sql: string) => void;
  result: QueryResultState;
  error: string | null;
  running: boolean;
  onRun: () => void;
  queryDataDisabled?: boolean;
};

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function SqlQueryWorkspace({
  open,
  onOpenChange,
  tableIdentifier,
  columnMeta,
  sql,
  onSqlChange,
  result,
  error,
  running,
  onRun,
  queryDataDisabled,
}: SqlQueryWorkspaceProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (queryDataDisabled || running) return;
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onRun();
      }
    },
    [onRun, queryDataDisabled, running],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className={cn(
          "fixed inset-0 top-0 left-0 z-50 flex h-dvh max-h-dvh w-full max-w-none min-w-0 translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 p-0 shadow-none sm:max-w-none",
        )}
      >
        <div className="bg-background flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <header className="border-border flex shrink-0 items-center border-b px-4 py-3 pr-14 md:px-5 md:pr-16">
            <DialogTitle
              className="text-foreground font-mono text-base leading-snug font-medium tracking-normal break-all"
              title={tableIdentifier ?? undefined}
            >
              {tableIdentifier ?? "—"}
            </DialogTitle>
          </header>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
            <aside className="border-border bg-muted/20 flex w-full shrink-0 flex-col border-b md:w-52 md:shrink-0 md:border-r md:border-b-0">
              <ScrollArea className="min-h-[120px] flex-1 md:max-h-none">
                <ul className="space-y-2.5 px-4 py-3 pb-4">
                  {columnMeta.map((c) => (
                    <li key={c.name}>
                      <p
                        className="text-foreground font-mono text-xs leading-snug break-all"
                        title={c.name}
                      >
                        {c.name}
                      </p>
                      <p className="text-muted-foreground font-mono text-[0.65rem] leading-snug">
                        {c.duckdbType}
                      </p>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            </aside>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                <div className="bg-muted/15 flex min-h-0 flex-1 flex-col p-3 md:p-4">
                  <div className="mb-2 flex min-w-0 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                      <label
                        htmlFor="sql-query-editor"
                        className="text-muted-foreground shrink-0 text-xs font-medium"
                      >
                        Editor
                      </label>
                      <span className="text-muted-foreground max-w-full text-xs font-normal wrap-break-word">
                        Read-only; max {QUERY_RESULT_ROW_LIMIT.toLocaleString()} rows
                        for SELECT and WITH.
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-muted-foreground hidden text-xs sm:inline">
                        ⌘↵ / Ctrl+Enter
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        className="gap-1.5"
                        disabled={queryDataDisabled || running}
                        onClick={() => onRun()}
                        aria-label="Run query"
                      >
                        <Play className="size-3.5 fill-current" />
                        Run
                      </Button>
                    </div>
                  </div>
                  <textarea
                    ref={textareaRef}
                    id="sql-query-editor"
                    value={sql}
                    onChange={(e) => onSqlChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    spellCheck={false}
                    className={cn(
                      "border-input bg-background text-foreground placeholder:text-muted-foreground",
                      "focus-visible:ring-ring min-h-0 w-full min-w-0 flex-1 resize-none rounded-lg border p-3 font-mono text-sm leading-relaxed",
                      "focus-visible:ring-[3px] focus-visible:ring-offset-2 focus-visible:outline-none",
                    )}
                    placeholder={
                      tableIdentifier
                        ? `SELECT * FROM ${quoteIdent(tableIdentifier)}`
                        : "SELECT …"
                    }
                    disabled={queryDataDisabled}
                  />
                </div>

                <Separator className="shrink-0" />

                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[color-mix(in_oklab,var(--muted)_12%,transparent)]">
                  <div className="text-muted-foreground flex shrink-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3 py-2 text-xs md:px-4">
                    <span className="font-medium">Results</span>
                    <span className="max-w-full font-normal wrap-break-word sm:max-w-[min(100%,28rem)] sm:text-right">
                      Read-only; max {QUERY_RESULT_ROW_LIMIT.toLocaleString()} rows
                      for SELECT and WITH.
                    </span>
                  </div>
                  {error ? (
                    <div
                      className="border-destructive/30 bg-destructive/10 text-destructive mx-3 mb-2 rounded-md border px-3 py-2 text-sm md:mx-4"
                      role="alert"
                    >
                      {error}
                    </div>
                  ) : null}
                  <div className="min-h-0 flex-1 overflow-hidden px-0 pb-3 md:pb-4">
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
                    {result && result.rows.length === 0 && !error && !running ? (
                      <p className="text-muted-foreground px-4 py-6 text-sm">
                        No rows returned.
                      </p>
                    ) : null}
                    {result && result.rows.length > 0 ? (
                      <ScrollArea className="h-full min-h-0">
                        <div className="inline-block min-w-full align-middle">
                          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                            <thead>
                              <tr className="bg-muted/80 border-border sticky top-0 z-10 border-b">
                                {result.columns.map((col) => (
                                  <th
                                    key={col}
                                    className="text-foreground max-w-56 truncate px-3 py-2 font-mono text-xs font-medium whitespace-nowrap"
                                    title={col}
                                  >
                                    {col}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {result.rows.map((row, ri) => (
                                <tr
                                  key={ri}
                                  className="border-border/80 odd:bg-background/40 even:bg-background/70 border-b"
                                >
                                  {result.columns.map((col) => (
                                    <td
                                      key={col}
                                      className="text-foreground max-w-56 truncate px-3 py-1.5 font-mono text-xs whitespace-nowrap"
                                      title={formatCell(row[col])}
                                    >
                                      {formatCell(row[col])}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </ScrollArea>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
