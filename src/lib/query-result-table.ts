import type { Table as ArrowTable } from "apache-arrow";

import { arrowTableColumnNames, arrowTableToObjects } from "@/lib/arrow-table";
import { quoteIdent } from "@/lib/data-query";

export const QUERY_RESULT_FETCH_CHUNK = 1000;

type Conn = {
  query: (sql: string) => Promise<ArrowTable>;
};

/** Stable DuckDB temp table name for a query tab (unquoted identifier). */
export function queryResultTableName(tabId: string): string {
  const safe = tabId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 32) || "x";
  return `_bf_qr_${safe}`;
}

export async function dropQueryResultTable(
  conn: Conn,
  tableName: string,
): Promise<void> {
  await conn.query(`DROP TABLE IF EXISTS ${quoteIdent(tableName)};`);
}

/**
 * Materialize a SELECT/WITH into a temp table; return columns and row count.
 */
export async function materializeQueryResult(
  conn: Conn,
  tableName: string,
  selectSql: string,
): Promise<{ columns: string[]; totalRows: number }> {
  const q = quoteIdent(tableName);
  await conn.query(`DROP TABLE IF EXISTS ${q};`);
  await conn.query(
    `CREATE TEMP TABLE ${q} AS SELECT * FROM (${selectSql}) AS _bf_sub;`,
  );
  const desc = await conn.query(`DESCRIBE ${q};`);
  const columns = arrowTableToObjects(desc)
    .map((r) => r.column_name)
    .filter((c): c is string => typeof c === "string");
  const countRow = await conn.query(
    `SELECT COUNT(*)::BIGINT AS c FROM ${q};`,
  );
  const c = countRow.getChild("c")?.get(0);
  const totalRows =
    typeof c === "bigint" ? Number(c) : typeof c === "number" ? c : 0;
  return { columns, totalRows: Number.isFinite(totalRows) ? totalRows : 0 };
}

/** Fetch a window of rows from a materialized query result table. */
export async function fetchQueryResultWindow(
  conn: Conn,
  tableName: string,
  columns: readonly string[],
  offset: number,
  limit: number,
): Promise<Record<string, unknown>[]> {
  if (columns.length === 0 || limit <= 0) return [];
  const list = columns.map(quoteIdent).join(", ");
  const q = quoteIdent(tableName);
  const table = await conn.query(
    `SELECT ${list} FROM ${q} LIMIT ${limit} OFFSET ${offset};`,
  );
  return arrowTableToObjects(table);
}
