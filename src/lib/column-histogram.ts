import type { ColumnMeta } from "@/lib/column-type-meta";
import { quoteIdent } from "@/lib/csv-query";

export const NUMERIC_BINS = 20;

/** Max distinct values shown as their own bars; additional rows are aggregated into "Other". */
export const MAX_CATEGORICAL_HISTOGRAM_VALUES = 1000;

export type ColumnHistogramData =
  | {
      kind: "numeric";
      /** Length {@link NUMERIC_BINS}; counts per bin from min → max. */
      bins: number[];
      min: number;
      max: number;
      /** Non-null values in this column (under filter); equals sum of {@link bins}. */
      totalNonNull: number;
    }
  | {
      kind: "categorical";
      counts: number[];
      /** Distinct value per bar (same order as {@link counts}). */
      labels: string[];
      /** Non-null values in this column (under filter); equals the sum of {@link counts} (including "Other" when present). */
      totalNonNull: number;
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
 * Distribution for one column, respecting the same row filter as the grid
 * (`whereClause` from {@link buildWhereClause}).
 *
 * Text/date columns: up to {@link MAX_CATEGORICAL_HISTOGRAM_VALUES} bars for the most frequent
 * distinct values; remaining rows roll into an "Other" bar when needed.
 */
export async function fetchColumnHistogram(
  conn: Conn,
  tableName: string,
  meta: ColumnMeta,
  whereClause: string,
): Promise<ColumnHistogramData> {
  const q = quoteIdent(meta.name);
  const tail = whereClause.trim() ? ` ${whereClause}` : "";

  if (meta.filterMode === "numeric") {
    const boundsSql = `
WITH filtered AS (
  SELECT ${q}::DOUBLE AS v
  FROM ${tableName}${tail}
)
SELECT
  MIN(v) AS mn,
  MAX(v) AS mx,
  COUNT(*)::BIGINT AS n
FROM filtered
WHERE v IS NOT NULL;
`;
    const br = await conn.query(boundsSql);
    const mn = num(br.getChild("mn")?.get(0));
    const mx = num(br.getChild("mx")?.get(0));
    const n = readBigIntish(br.getChild("n")?.get(0));
    if (n === 0 || mn === null || mx === null) {
      return { kind: "empty" };
    }

    const bins = new Array<number>(NUMERIC_BINS).fill(0);

    if (mn === mx || Math.abs(mx - mn) < 1e-15 * Math.max(1, Math.abs(mx))) {
      bins[0] = n;
      return { kind: "numeric", bins, min: mn, max: mx, totalNonNull: n };
    }

    const span = mx - mn;
    const binSql = `
WITH filtered AS (
  SELECT ${q}::DOUBLE AS v
  FROM ${tableName}${tail}
)
SELECT
  LEAST(
    ${NUMERIC_BINS - 1},
    GREATEST(
      0,
      FLOOR((v - ${mn}) / ${span} * ${NUMERIC_BINS})::INTEGER
    )
  ) AS bin,
  COUNT(*)::BIGINT AS c
FROM filtered
WHERE v IS NOT NULL
GROUP BY 1
ORDER BY 1;
`;
    const table = await conn.query(binSql);
    const binCol = table.getChild("bin");
    const cCol = table.getChild("c");
    for (let i = 0; i < table.numRows; i++) {
      const b = binCol?.get(i);
      const c = cCol?.get(i);
      const bi = typeof b === "number" ? b : Number(b);
      if (bi >= 0 && bi < NUMERIC_BINS) {
        bins[bi] = readBigIntish(c);
      }
    }
    return { kind: "numeric", bins, min: mn, max: mx, totalNonNull: n };
  }

  const sql = `
WITH filtered AS (
  SELECT CAST(${q} AS VARCHAR) AS v
  FROM ${tableName}${tail}
),
tot AS (
  SELECT COUNT(*)::BIGINT AS n FROM filtered WHERE v IS NOT NULL
)
SELECT agg.v, agg.c, tot.n AS total_non_null
FROM (
  SELECT v, COUNT(*)::BIGINT AS c
  FROM filtered
  WHERE v IS NOT NULL
  GROUP BY v
  ORDER BY c DESC, v ASC
  LIMIT ${MAX_CATEGORICAL_HISTOGRAM_VALUES}
) AS agg
CROSS JOIN tot;
`;
  const table = await conn.query(sql);
  const vCol = table.getChild("v");
  const cCol = table.getChild("c");
  const totalCol = table.getChild("total_non_null");
  const counts: number[] = [];
  const labels: string[] = [];
  let totalNonNull = 0;
  for (let i = 0; i < table.numRows; i++) {
    const raw = vCol?.get(i);
    labels.push(raw === null || raw === undefined ? "" : String(raw));
    counts.push(readBigIntish(cCol?.get(i)));
    if (i === 0) {
      totalNonNull = readBigIntish(totalCol?.get(i));
    }
  }
  if (counts.length === 0 || counts.every((c) => c === 0)) {
    return { kind: "empty" };
  }

  const sumTop = counts.reduce((a, b) => a + b, 0);
  const otherRows = totalNonNull - sumTop;
  if (otherRows > 0) {
    labels.push("Other");
    counts.push(otherRows);
  }

  return { kind: "categorical", counts, labels, totalNonNull };
}
