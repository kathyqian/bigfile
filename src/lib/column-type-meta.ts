/**
 * Maps DuckDB `PRAGMA table_info` / DESCRIBE type strings to UI labels and filter widgets.
 * DuckDB may report types like "INTEGER", "BIGINT", "VARCHAR", "TIMESTAMP", etc.
 */

export type ColumnFilterMode = "numeric" | "text";

export type ColumnMeta = {
  name: string;
  /** Raw type from DuckDB */
  duckdbType: string;
  filterMode: ColumnFilterMode;
  /** Shown under the column name (number, percent, text, date) */
  typeLabel: string;
};

const NUMERIC = new Set([
  "TINYINT",
  "SMALLINT",
  "INTEGER",
  "BIGINT",
  "HUGEINT",
  "UTINYINT",
  "USMALLINT",
  "UINTEGER",
  "UBIGINT",
  "FLOAT",
  "DOUBLE",
  "REAL",
  "DECIMAL",
  "NUMERIC",
]);

function baseType(duckdbType: string): string {
  const t = duckdbType.trim().toUpperCase();
  const paren = t.indexOf("(");
  return paren === -1 ? t : t.slice(0, paren);
}

function isNativeNumericType(duckdbType: string): boolean {
  return NUMERIC.has(baseType(duckdbType));
}

/** DATE / TIME types use text-style distinct filters; sorting still uses native column order. */
const DATE_LIKE = new Set([
  "DATE",
  "TIME",
  "TIMESTAMP",
  "TIMESTAMP WITH TIME ZONE",
  "TIMESTAMPTZ",
  "DATETIME",
  "INTERVAL",
]);

export function columnMetaFromDuckdbType(
  name: string,
  duckdbType: string,
): ColumnMeta {
  const base = baseType(duckdbType);
  if (NUMERIC.has(base)) {
    return { name, duckdbType, filterMode: "numeric", typeLabel: "number" };
  }
  if (DATE_LIKE.has(base)) {
    return { name, duckdbType, filterMode: "text", typeLabel: "date" };
  }
  return { name, duckdbType, filterMode: "text", typeLabel: "text" };
}

export function isPercentColumn(meta: ColumnMeta): boolean {
  return meta.typeLabel === "percent";
}

/**
 * SQL expression that yields a DOUBLE for filters, histograms, and numeric sorts.
 * VARCHAR numeric columns strip grouping commas; percent columns also strip a trailing %.
 */
export function sqlNumericExpr(quotedIdent: string, meta: ColumnMeta): string {
  if (isNativeNumericType(meta.duckdbType)) {
    return `TRY_CAST(${quotedIdent} AS DOUBLE)`;
  }
  const trimmed = `trim(CAST(${quotedIdent} AS VARCHAR))`;
  const noCommas = `replace(${trimmed}, ',', '')`;
  if (isPercentColumn(meta)) {
    return `TRY_CAST(regexp_replace(${noCommas}, '%$', '') AS DOUBLE)`;
  }
  // Grouped thousands ("1,067") or plain numeric text stored as VARCHAR
  return `TRY_CAST(${noCommas} AS DOUBLE)`;
}

function readBigIntish(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "bigint") return Number(v);
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

type Conn = {
  query: (sql: string) => Promise<import("apache-arrow").Table>;
};

/**
 * Classify VARCHAR columns whose non-empty values are all numeric text:
 * plain ("542"), grouped thousands ("1,067"), or percentages ("63%", "-17.5%").
 */
async function classifyNumericTextColumn(
  conn: Conn,
  tableName: string,
  columnName: string,
): Promise<"percent" | "number" | null> {
  const q = `"${columnName.replace(/"/g, '""')}"`;
  const t = `"${tableName.replace(/"/g, '""')}"`;
  const sql = `
WITH vals AS (
  SELECT trim(CAST(${q} AS VARCHAR)) AS s
  FROM ${t}
  WHERE ${q} IS NOT NULL AND trim(CAST(${q} AS VARCHAR)) <> ''
),
parsed AS (
  SELECT
    s,
    right(s, 1) = '%' AS is_pct,
    TRY_CAST(
      replace(
        CASE WHEN right(s, 1) = '%' THEN left(s, length(s) - 1) ELSE s END,
        ',',
        ''
      ) AS DOUBLE
    ) AS n
  FROM vals
)
SELECT
  COUNT(*)::BIGINT AS n,
  COUNT(*) FILTER (WHERE n IS NOT NULL)::BIGINT AS n_ok,
  COUNT(*) FILTER (WHERE n IS NOT NULL AND is_pct)::BIGINT AS n_pct
FROM parsed;
`;
  try {
    const table = await conn.query(sql);
    const n = readBigIntish(table.getChild("n")?.get(0));
    const nOk = readBigIntish(table.getChild("n_ok")?.get(0));
    const nPct = readBigIntish(table.getChild("n_pct")?.get(0));
    if (n === 0 || n !== nOk) return null;
    if (nPct === n) return "percent";
    if (nPct === 0) return "number";
    return null;
  } catch {
    return null;
  }
}

export async function fetchTableColumnMeta(
  conn: Conn,
  tableName: string,
): Promise<ColumnMeta[]> {
  const safe = tableName.replace(/'/g, "''");
  const ti = await conn.query(
    `SELECT name, type FROM pragma_table_info('${safe}') ORDER BY cid;`,
  );
  const nameCol = ti.getChild("name");
  const typeCol = ti.getChild("type");
  const out: ColumnMeta[] = [];
  for (let i = 0; i < ti.numRows; i++) {
    const n = String(nameCol?.get(i) ?? "");
    const typ = String(typeCol?.get(i) ?? "");
    out.push(columnMetaFromDuckdbType(n, typ));
  }

  await Promise.all(
    out.map(async (meta, i) => {
      if (meta.filterMode !== "text" || meta.typeLabel !== "text") return;
      const kind = await classifyNumericTextColumn(conn, tableName, meta.name);
      if (kind === "percent") {
        out[i] = { ...meta, filterMode: "numeric", typeLabel: "percent" };
      } else if (kind === "number") {
        out[i] = { ...meta, filterMode: "numeric", typeLabel: "number" };
      }
    }),
  );

  return out;
}
