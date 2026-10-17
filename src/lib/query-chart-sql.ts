import type { Table as ArrowTable } from "apache-arrow";

import { arrowTableToObjects } from "@/lib/arrow-table";
import {
  normalizeYAggregate,
  type YValueAggregate,
} from "@/lib/chart-series";
import { quoteIdent } from "@/lib/csv-query";

/** Minimal chart config needed to build series SQL (avoids importing UI). */
export type QueryChartSeriesConfig = {
  kind: "scatter" | "line" | "bar" | "pie";
  xColumn: string | null;
  yColumn: string | null;
  yAggregate: YValueAggregate;
  pieLabelColumn: string | null;
  pieValueColumn: string | null;
};

type Conn = {
  query: (sql: string) => Promise<ArrowTable>;
};

/** Coerce a column to DOUBLE for charting (numbers, commas, trailing %). */
export function sqlChartNumericExpr(quotedIdent: string): string {
  const trimmed = `trim(CAST(${quotedIdent} AS VARCHAR))`;
  const noCommas = `replace(${trimmed}, ',', '')`;
  return `TRY_CAST(regexp_replace(${noCommas}, '%$', '') AS DOUBLE)`;
}

function sqlYAggregate(
  yExpr: string,
  mode: YValueAggregate,
): string {
  switch (mode) {
    case "first":
      return `first(${yExpr})`;
    case "sum":
      return `sum(${yExpr})`;
    case "avg":
      return `avg(${yExpr})`;
    case "median":
      return `median(${yExpr})`;
    case "min":
      return `min(${yExpr})`;
    case "max":
      return `max(${yExpr})`;
    case "count":
      return `count(${yExpr})`;
    case "countDistinct":
      return `count(DISTINCT ${yExpr})`;
    default: {
      const _e: never = mode;
      return _e;
    }
  }
}

/**
 * Build DuckDB SQL that returns an already-aggregated chart series from a
 * materialized query result table. Column aliases match the chart config keys
 * so the existing plotter can consume the rows with any yAggregate (one row per group).
 */
export function buildQueryChartSeriesSql(
  resultTable: string,
  config: QueryChartSeriesConfig,
): string | { error: string } {
  const cfg = {
    ...config,
    yAggregate: normalizeYAggregate(config.yAggregate),
  };
  const t = quoteIdent(resultTable);

  if (cfg.kind === "pie") {
    if (!cfg.pieLabelColumn || !cfg.pieValueColumn) {
      return { error: "Pie chart needs label and value columns." };
    }
    const labelQ = quoteIdent(cfg.pieLabelColumn);
    const valueExpr = sqlChartNumericExpr(quoteIdent(cfg.pieValueColumn));
    const agg = sqlYAggregate(valueExpr, cfg.yAggregate);
    return `
SELECT
  CAST(${labelQ} AS VARCHAR) AS ${labelQ},
  ${agg} AS ${quoteIdent(cfg.pieValueColumn)}
FROM ${t}
WHERE CAST(${labelQ} AS VARCHAR) IS NOT NULL
  AND trim(CAST(${labelQ} AS VARCHAR)) <> ''
  AND ${valueExpr} IS NOT NULL
GROUP BY 1
ORDER BY 2 DESC NULLS LAST
`.trim();
  }

  if (!cfg.xColumn || !cfg.yColumn) {
    return { error: "Chart needs X and Y columns." };
  }

  const xQ = quoteIdent(cfg.xColumn);
  const yExpr = sqlChartNumericExpr(quoteIdent(cfg.yColumn));
  const yAgg = sqlYAggregate(yExpr, cfg.yAggregate);

  if (cfg.kind === "bar") {
    return `
SELECT
  CAST(${xQ} AS VARCHAR) AS ${xQ},
  ${yAgg} AS ${quoteIdent(cfg.yColumn)}
FROM ${t}
WHERE CAST(${xQ} AS VARCHAR) IS NOT NULL
  AND ${yExpr} IS NOT NULL
GROUP BY 1
ORDER BY 1
`.trim();
  }

  // scatter / line — numeric X
  const xExpr = sqlChartNumericExpr(xQ);
  return `
SELECT
  ${xExpr} AS ${xQ},
  ${yAgg} AS ${quoteIdent(cfg.yColumn)}
FROM ${t}
WHERE ${xExpr} IS NOT NULL
  AND ${yExpr} IS NOT NULL
GROUP BY 1
ORDER BY 1
`.trim();
}

/** Run chart series SQL; returns rows shaped for {@link SqlQueryResultsChart}. */
export async function fetchQueryChartSeries(
  conn: Conn,
  resultTable: string,
  config: QueryChartSeriesConfig,
): Promise<
  { rows: Record<string, unknown>[] } | { error: string }
> {
  const built = buildQueryChartSeriesSql(resultTable, config);
  if (typeof built !== "string") return built;
  try {
    const table = await conn.query(built);
    return { rows: arrowTableToObjects(table) };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Sample rows for chart column typing (numeric vs categorical pickers). */
export async function fetchQueryResultSample(
  conn: Conn,
  resultTable: string,
  columns: readonly string[],
  limit = 500,
): Promise<Record<string, unknown>[]> {
  if (columns.length === 0) return [];
  const list = columns.map(quoteIdent).join(", ");
  const table = await conn.query(
    `SELECT ${list} FROM ${quoteIdent(resultTable)} LIMIT ${limit};`,
  );
  return arrowTableToObjects(table);
}
