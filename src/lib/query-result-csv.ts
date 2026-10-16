function formatCsvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Build a CSV string (header + rows) from a query result table. */
export function queryResultToCsv(
  columns: readonly string[],
  rows: readonly Record<string, unknown>[],
): string {
  const header = columns.map((c) => formatCsvCell(c)).join(",");
  if (rows.length === 0) return `${header}\n`;
  const body = rows
    .map((row) => columns.map((c) => formatCsvCell(row[c])).join(","))
    .join("\n");
  return `${header}\n${body}\n`;
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
