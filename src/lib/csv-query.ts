import type { ColumnMeta } from "@/lib/column-type-meta";

export type SortColumn = {
  columnKey: string;
  direction: "ASC" | "DESC";
};

/** Non-null string values to match; empty string is allowed. */
export type TextColumnFilter = {
  kind: "text";
  includeNull: boolean;
  values: string[];
};

export type NumericCompareOp = "=" | "!=" | "<" | "<=" | ">" | ">=";

export type NumericColumnFilter =
  | {
      kind: "numeric";
      mode: "between";
      min?: number;
      max?: number;
    }
  | {
      kind: "numeric";
      mode: "cmp";
      op: NumericCompareOp;
      value: number;
    };

export type ColumnFilter = TextColumnFilter | NumericColumnFilter;

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function escapeStringLiteral(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

const EMPTY: TextColumnFilter = {
  kind: "text",
  includeNull: false,
  values: [],
};

export function emptyTextFilter(): TextColumnFilter {
  return { ...EMPTY, values: [] };
}

export function isTextFilterActive(f: TextColumnFilter): boolean {
  return f.includeNull || f.values.length > 0;
}

export function isNumericFilterActive(f: NumericColumnFilter): boolean {
  if (f.mode === "cmp") {
    return Number.isFinite(f.value);
  }
  const hasMin = f.min !== undefined && Number.isFinite(f.min);
  const hasMax = f.max !== undefined && Number.isFinite(f.max);
  return hasMin || hasMax;
}

function numericFilterSql(col: string, f: NumericColumnFilter): string | null {
  const q = quoteIdent(col);
  if (f.mode === "between") {
    const hasMin = f.min !== undefined && Number.isFinite(f.min);
    const hasMax = f.max !== undefined && Number.isFinite(f.max);
    if (!hasMin && !hasMax) return null;
    if (hasMin && hasMax) return `${q} BETWEEN ${f.min} AND ${f.max}`;
    if (hasMin) return `${q} >= ${f.min}`;
    return `${q} <= ${f.max!}`;
  }
  if (!Number.isFinite(f.value)) return null;
  const op = f.op;
  return `${q} ${op} ${f.value}`;
}

function textFilterSql(col: string, f: TextColumnFilter): string | null {
  if (!isTextFilterActive(f)) return null;
  const q = quoteIdent(col);
  const parts: string[] = [];
  if (f.includeNull) parts.push(`${q} IS NULL`);
  if (f.values.length > 0) {
    const list = f.values.map(escapeStringLiteral).join(", ");
    parts.push(`${q} IN (${list})`);
  }
  if (parts.length === 1) return parts[0];
  return `(${parts.join(" OR ")})`;
}

export type FiltersMap = Record<string, ColumnFilter | undefined>;

/** Number of columns with an active filter (matches `buildWhereClause` logic). */
export function countActiveColumnFilters(
  filters: FiltersMap,
  columnMetaByName: Map<string, ColumnMeta>,
): number {
  let n = 0;
  for (const [col, raw] of Object.entries(filters)) {
    if (!raw) continue;
    const meta = columnMetaByName.get(col);
    if (!meta) continue;
    if (raw.kind === "numeric" && meta.filterMode === "numeric") {
      if (isNumericFilterActive(raw)) n++;
    } else if (raw.kind === "text" && meta.filterMode === "text") {
      if (isTextFilterActive(raw)) n++;
    }
  }
  return n;
}

export function buildWhereClause(
  filters: FiltersMap,
  columnMetaByName: Map<string, ColumnMeta>,
  excludeColumn?: string,
): string {
  const clauses: string[] = [];
  for (const [col, raw] of Object.entries(filters)) {
    if (!raw || col === excludeColumn) continue;
    const meta = columnMetaByName.get(col);
    if (!meta) continue;
    if (raw.kind === "numeric" && meta.filterMode === "numeric") {
      if (!isNumericFilterActive(raw)) continue;
      const sql = numericFilterSql(col, raw);
      if (sql) clauses.push(sql);
    } else if (raw.kind === "text" && meta.filterMode === "text") {
      if (!isTextFilterActive(raw)) continue;
      const sql = textFilterSql(col, raw);
      if (sql) clauses.push(sql);
    }
  }
  if (clauses.length === 0) return "";
  return `WHERE ${clauses.join(" AND ")}`;
}

export function buildOrderByClause(sortColumns: readonly SortColumn[]): string {
  if (sortColumns.length === 0) return "";
  const parts = sortColumns.map(
    (s) => `${quoteIdent(s.columnKey)} ${s.direction}`,
  );
  return `ORDER BY ${parts.join(", ")}`;
}

export function buildSelectList(columnNames: readonly string[]): string {
  return columnNames.map(quoteIdent).join(", ");
}

/** Human-readable fragments for the footer (legacy / debugging). */
export function formatSortSummary(sortColumns: readonly SortColumn[]): string {
  if (sortColumns.length === 0) return "";
  return sortColumns
    .map(
      (s) =>
        `${s.columnKey} ${s.direction === "ASC" ? "asc" : "desc"}`,
    )
    .join(", ");
}

/** Ordered sort levels for UI (e.g. sort details modal). Priority 1 = primary. */
export type SortDetailLine = {
  priority: number;
  columnKey: string;
  direction: "ASC" | "DESC";
};

export function listSortDetails(
  sortColumns: readonly SortColumn[],
): SortDetailLine[] {
  return sortColumns.map((s, i) => ({
    priority: i + 1,
    columnKey: s.columnKey,
    direction: s.direction,
  }));
}

export type ActiveFilterLine = { column: string; line: string };

/** One entry per column that has an active filter (for UI such as a details modal). */
export function listActiveFilterLines(
  filters: FiltersMap,
  columnMetaByName: Map<string, ColumnMeta>,
): ActiveFilterLine[] {
  const out: ActiveFilterLine[] = [];
  for (const [col, raw] of Object.entries(filters)) {
    if (!raw) continue;
    const meta = columnMetaByName.get(col);
    if (!meta) continue;
    const line = formatFilterClause(col, raw, meta);
    if (line) out.push({ column: col, line });
  }
  return out;
}

export function formatFilterClause(
  col: string,
  f: ColumnFilter,
  meta: ColumnMeta,
): string | null {
  if (f.kind === "numeric" && meta.filterMode === "numeric") {
    if (!isNumericFilterActive(f)) return null;
    if (f.mode === "between") {
      const hasMin = f.min !== undefined && Number.isFinite(f.min);
      const hasMax = f.max !== undefined && Number.isFinite(f.max);
      if (!hasMin && !hasMax) return null;
      if (hasMin && hasMax) return `${col} ${f.min}…${f.max}`;
      if (hasMin) return `${col} ≥ ${f.min}`;
      return `${col} ≤ ${f.max!}`;
    }
    return `${col} ${f.op} ${f.value}`;
  }
  if (f.kind === "text" && meta.filterMode === "text") {
    if (!isTextFilterActive(f)) return null;
    const bits: string[] = [];
    if (f.includeNull) bits.push("(null)");
    const show = f.values.slice(0, 5);
    if (show.length) bits.push(...show.map((v) => (v === "" ? "∅" : v)));
    let s = `${col} ∈ {${bits.join(", ")}}`;
    if (f.values.length > 5) s += ` (+${f.values.length - 5} more)`;
    return s;
  }
  return null;
}

export function formatFilterSummary(
  filters: FiltersMap,
  columnMetaByName: Map<string, ColumnMeta>,
): string {
  const parts: string[] = [];
  for (const [col, raw] of Object.entries(filters)) {
    if (!raw) continue;
    const meta = columnMetaByName.get(col);
    if (!meta) continue;
    const line = formatFilterClause(col, raw, meta);
    if (line) parts.push(line);
  }
  return parts.join("; ");
}
