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
  /** Shown under the column name (number, text, date) */
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
  return out;
}
