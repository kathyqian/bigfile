import {
  sqlNumericExpr,
  type ColumnMeta,
} from "@/lib/column-type-meta";
import { quoteIdent } from "@/lib/data-query";

export type ColumnStats =
  | {
      kind: "numeric";
      min: number | null;
      max: number | null;
      average: number | null;
      median: number | null;
      count: number;
      countDistinct: number;
      sum: number | null;
      stddev: number | null;
    }
  | {
      kind: "categorical";
      /** Distinct non-null values under the current filter. */
      uniqueValues: number;
    }
  | { kind: "empty" };

type Conn = {
  query: (sql: string) => Promise<import("apache-arrow").Table>;
};

function readBigIntish(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "bigint") return Number(v);
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "bigint" ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Summary stats for one column, respecting the same row filter as the grid
 * (`whereClause` from {@link buildWhereClause}).
 */
export async function fetchColumnStats(
  conn: Conn,
  tableName: string,
  meta: ColumnMeta,
  whereClause: string,
): Promise<ColumnStats> {
  const q = quoteIdent(meta.name);
  const t = quoteIdent(tableName);
  const tail = whereClause.trim() ? ` ${whereClause}` : "";

  if (meta.filterMode === "numeric") {
    const asDouble = sqlNumericExpr(q, meta);
    const sql = `
WITH filtered AS (
  SELECT ${asDouble} AS v
  FROM ${t}${tail}
)
SELECT
  COUNT(v)::BIGINT AS cnt,
  COUNT(DISTINCT v)::BIGINT AS cnt_distinct,
  MIN(v) AS mn,
  MAX(v) AS mx,
  AVG(v) AS avg,
  MEDIAN(v) AS med,
  SUM(v) AS sm,
  STDDEV_SAMP(v) AS sd
FROM filtered
WHERE v IS NOT NULL;
`;
    const table = await conn.query(sql);
    const count = readBigIntish(table.getChild("cnt")?.get(0));
    if (count === 0) return { kind: "empty" };
    return {
      kind: "numeric",
      count,
      countDistinct: readBigIntish(table.getChild("cnt_distinct")?.get(0)),
      min: num(table.getChild("mn")?.get(0)),
      max: num(table.getChild("mx")?.get(0)),
      average: num(table.getChild("avg")?.get(0)),
      median: num(table.getChild("med")?.get(0)),
      sum: num(table.getChild("sm")?.get(0)),
      stddev: num(table.getChild("sd")?.get(0)),
    };
  }

  const sql = `
SELECT COUNT(DISTINCT ${q})::BIGINT AS uniq
FROM ${t}${tail}
WHERE ${q} IS NOT NULL;
`;
  const table = await conn.query(sql);
  const uniqueValues = readBigIntish(table.getChild("uniq")?.get(0));
  return { kind: "categorical", uniqueValues };
}
