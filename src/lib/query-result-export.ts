function formatCsvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** CSV header line (no trailing newline). */
export function queryResultCsvHeader(columns: readonly string[]): string {
  return columns.map((c) => formatCsvCell(c)).join(",");
}

/** CSV body lines for a batch of rows (no trailing newline on last line). */
export function queryResultCsvBody(
  columns: readonly string[],
  rows: readonly Record<string, unknown>[],
): string {
  if (rows.length === 0) return "";
  return rows
    .map((row) => columns.map((c) => formatCsvCell(row[c])).join(","))
    .join("\n");
}

/** Build a CSV string (header + rows) from a query result table. */
export function queryResultToCsv(
  columns: readonly string[],
  rows: readonly Record<string, unknown>[],
): string {
  const header = queryResultCsvHeader(columns);
  if (rows.length === 0) return `${header}\n`;
  return `${header}\n${queryResultCsvBody(columns, rows)}\n`;
}

/** Trigger a browser download of the given CSV text. */
export function downloadCsvText(csv: string, fileName: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName.endsWith(".csv") ? fileName : `${fileName}.csv`;
  a.rel = "noopener";
  a.click();
  URL.revokeObjectURL(url);
}
