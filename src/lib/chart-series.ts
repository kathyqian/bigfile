/** How to combine multiple Y (or value) numbers for the same X or category. */
export type YValueAggregate =
  | "first"
  | "sum"
  | "avg"
  | "min"
  | "max"
  | "median"
  | "count"
  | "countDistinct";

const Y_AGGREGATE_SET: ReadonlySet<string> = new Set([
  "first",
  "sum",
  "avg",
  "min",
  "max",
  "median",
  "count",
  "countDistinct",
]);

/** Ensures Select / persisted state always maps to a valid aggregate mode. */
export function normalizeYAggregate(v: unknown): YValueAggregate {
  if (typeof v === "string" && Y_AGGREGATE_SET.has(v)) {
    return v as YValueAggregate;
  }
  return "sum";
}

function medianOfSorted(sorted: number[]): number {
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Values must be in row order; "first" uses values[0]. */
export function aggregateNumericValues(
  values: number[],
  mode: YValueAggregate,
): number | null {
  if (values.length === 0) return null;
  switch (mode) {
    case "first":
      return values[0];
    case "sum":
      return values.reduce((a, b) => a + b, 0);
    case "avg":
      return values.reduce((a, b) => a + b, 0) / values.length;
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
    case "median": {
      const sorted = [...values].sort((a, b) => a - b);
      return medianOfSorted(sorted);
    }
    case "count":
      return values.length;
    case "countDistinct":
      return new Set(values).size;
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

/** Parse a cell value into a finite number for charts, or null. */
export function parseChartNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") {
    return Number.isFinite(v) ? v : null;
  }
  // DuckDB/Arrow often surfaces INTEGER / BIGINT as bigint.
  if (typeof v === "bigint") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Columns that can be used as numeric chart axes: at least one non-empty value
 * parses as a number, and no non-empty value fails to parse.
 */
export function listNumericChartColumns(
  columns: readonly string[],
  rows: readonly Record<string, unknown>[],
): string[] {
  return columns.filter((col) => {
    let sawNumeric = false;
    for (const row of rows) {
      const v = row[col];
      if (v === null || v === undefined) continue;
      if (typeof v === "string" && v.trim() === "") continue;
      if (parseChartNumber(v) === null) return false;
      sawNumeric = true;
    }
    return sawNumeric;
  });
}

/** Columns that are not numeric — used for bar categories and pie labels. */
export function listNonNumericChartColumns(
  columns: readonly string[],
  rows: readonly Record<string, unknown>[],
): string[] {
  const numeric = new Set(listNumericChartColumns(columns, rows));
  return columns.filter((col) => !numeric.has(col));
}

export function formatChartTick(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e6 || (abs > 0 && abs < 1e-3)) return n.toExponential(1);
  if (abs >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (abs >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return n.toPrecision(3);
}

export function chartLabelText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
