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
 * Percent VARCHAR columns ("63%") strip the trailing % before casting.
 */
export function sqlNumericExpr(quotedIdent: string, meta: ColumnMeta): string {
  if (isPercentColumn(meta)) {
    return `TRY_CAST(regexp_replace(trim(CAST(${quotedIdent} AS VARCHAR)), '%$', '') AS DOUBLE)`;
  }
  return `TRY_CAST(${quotedIdent} AS DOUBLE)`;
}

function readBigIntish(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "bigint") return Number(v);
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * True when every non-empty value looks like a percentage ("63%", "-17.5%").
 * Mixed labels such as "MVP: +16%" stay text.
 */
async function columnLooksLikePercent(
  conn: {
    query: (sql: string) => Promise<import("apache-arrow").Table>;
  },
  tableName: string,
  columnName: string,
): Promise<boolean> {
  const q = `"${columnName.replace(/"/g, '""')}"`;
  const t = `"${tableName.replace(/"/g, '""')}"`;
  const sql = `
WITH vals AS (
  SELECT trim(CAST(${q} AS VARCHAR)) AS s
  FROM ${t}
  WHERE ${q} IS NOT NULL AND trim(CAST(${q} AS VARCHAR)) <> ''
)
SELECT
  COUNT(*)::BIGINT AS n,
  COUNT(*) FILTER (
    WHERE length(s) > 1
      AND right(s, 1) = '%'
      AND TRY_CAST(left(s, length(s) - 1) AS DOUBLE) IS NOT NULL
  )::BIGINT AS n_ok
FROM vals;
`;
  try {
    const table = await conn.query(sql);
    const n = readBigIntish(table.getChild("n")?.get(0));
    const nOk = readBigIntish(table.getChild("n_ok")?.get(0));
    return n > 0 && n === nOk;
  } catch {
    return false;
  }
}

export async function fetchTableColumnMeta(
  conn: {
    query: (sql: string) => Promise<import("apache-arrow").Table>;
  },
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
      if (await columnLooksLikePercent(conn, tableName, meta.name)) {
        out[i] = {
          ...meta,
          filterMode: "numeric",
          typeLabel: "percent",
        };
      }
    }),
  );

  return out;
}
