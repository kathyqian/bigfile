"use client";

import { curveMonotoneX } from "d3-shape";
import { scaleBand, scaleLinear } from "@visx/scale";
import { Bar, LinePath, Pie } from "@visx/shape";
import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  aggregateNumericValues,
  chartLabelText,
  formatBestFitEquation,
  formatChartTick,
  isPercentChartColumn,
  linearBestFit,
  listNonNumericChartColumns,
  listNumericChartColumns,
  normalizeYAggregate,
  parseChartNumber,
  type YValueAggregate,
} from "@/lib/chart-series";
import { cn } from "@/lib/utils";

const NONE_VALUE = "__none__";

export type QueryChartKind = "scatter" | "line" | "bar" | "pie";

export type QueryChartConfig = {
  kind: QueryChartKind;
  xColumn: string | null;
  yColumn: string | null;
  /** When several rows share the same X (or category / pie label), how to combine Y. */
  yAggregate: YValueAggregate;
  /** Scatter only: draw an OLS best-fit line with its equation. */
  showBestFitLine: boolean;
  pieLabelColumn: string | null;
  pieValueColumn: string | null;
};

export function defaultQueryChartConfig(): QueryChartConfig {
  return {
    kind: "scatter",
    xColumn: null,
    yColumn: null,
    yAggregate: "sum",
    showBestFitLine: false,
    pieLabelColumn: null,
    pieValueColumn: null,
  };
}

const BEST_FIT_OPTIONS = [
  { id: "show", label: "Show" },
  { id: "hide", label: "Hide" },
] as const;

/** True when the config has enough valid columns to draw a chart. */
export function isQueryChartReady(
  config: QueryChartConfig,
  columns: readonly string[],
  rows: readonly Record<string, unknown>[],
): boolean {
  const cfg = {
    ...defaultQueryChartConfig(),
    ...config,
    yAggregate: normalizeYAggregate(config.yAggregate),
  };
  const numericColumns = listNumericChartColumns(columns, rows);
  const categoricalColumns = listNonNumericChartColumns(columns, rows);

  if (cfg.kind === "pie") {
    return (
      cfg.pieLabelColumn != null &&
      categoricalColumns.includes(cfg.pieLabelColumn) &&
      cfg.pieValueColumn != null &&
      numericColumns.includes(cfg.pieValueColumn)
    );
  }

  const xAxisColumns =
    cfg.kind === "bar" ? categoricalColumns : numericColumns;
  return (
    cfg.xColumn != null &&
    xAxisColumns.includes(cfg.xColumn) &&
    cfg.yColumn != null &&
    numericColumns.includes(cfg.yColumn)
  );
}

const Y_AGGREGATE_OPTIONS: { id: YValueAggregate; label: string }[] = [
  { id: "first", label: "First value" },
  { id: "sum", label: "Sum" },
  { id: "avg", label: "Average" },
  { id: "median", label: "Median" },
  { id: "min", label: "Minimum" },
  { id: "max", label: "Maximum" },
  { id: "count", label: "Count" },
  { id: "countDistinct", label: "Count distinct" },
];

type Props = {
  columns: string[];
  rows: Record<string, unknown>[];
  config: QueryChartConfig;
  onConfigChange: (next: QueryChartConfig) => void;
  /** Hide type/axis controls; plot only (docked preview). */
  variant?: "full" | "preview";
};

/** Plot margins — leave room for tick labels plus axis titles (column names). */
const M = { top: 12, right: 16, bottom: 56, left: 68 };

function truncateAxisLabel(label: string, max = 36): string {
  if (label.length <= max) return label;
  return `${label.slice(0, Math.max(1, max - 1))}…`;
}

function AxisTitleX({
  label,
  x,
  y,
}: {
  label: string;
  x: number;
  y: number;
}) {
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      className="fill-muted-foreground text-xs"
    >
      {truncateAxisLabel(label)}
    </text>
  );
}

function AxisTitleY({
  label,
  x,
  y,
}: {
  label: string;
  x: number;
  y: number;
}) {
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      dominantBaseline="middle"
      transform={`rotate(-90 ${x} ${y})`}
      className="fill-muted-foreground text-xs"
    >
      {truncateAxisLabel(label)}
    </text>
  );
}

const CHART_KINDS: { id: QueryChartKind; label: string }[] = [
  { id: "scatter", label: "Scatter" },
  { id: "line", label: "Line" },
  { id: "bar", label: "Bar" },
  { id: "pie", label: "Pie" },
];

export function queryChartKindLabel(kind: QueryChartKind): string {
  return CHART_KINDS.find((k) => k.id === kind)?.label ?? "Chart";
}

function sliceColor(i: number): string {
  const hue = (i * 47) % 360;
  return `hsl(${hue} 65% 48%)`;
}

function useSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [h, setH] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setW(r.width);
      setH(r.height);
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    setW(r.width);
    setH(r.height);
    return () => ro.disconnect();
  }, []);
  return { ref, width: w, height: h };
}

function ColumnSelect({
  id,
  label,
  value,
  columns,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string | null;
  columns: string[];
  onChange: (v: string | null) => void;
  placeholder: string;
}) {
  const items = useMemo(
    () => [
      { value: NONE_VALUE, label: placeholder },
      ...columns.map((c) => ({ value: c, label: c })),
    ],
    [columns, placeholder],
  );
  const v = value ?? NONE_VALUE;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Label htmlFor={id} className="text-muted-foreground text-xs font-medium">
        {label}
      </Label>
      <Select
        value={v}
        items={items}
        modal={false}
        onValueChange={(next) =>
          onChange(!next || next === NONE_VALUE ? null : next)
        }
      >
        <SelectTrigger
          id={id}
          size="sm"
          className="border-input bg-background dark:bg-input/30 h-8 min-w-40 max-w-full"
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE_VALUE}>{placeholder}</SelectItem>
          {columns.map((c) => (
            <SelectItem key={c} value={c}>
              {c}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function AxisTicksX({
  scale,
  y,
  tickCount = 5,
  percent = false,
}: {
  scale: ReturnType<typeof scaleLinear<number>>;
  y: number;
  tickCount?: number;
  percent?: boolean;
}) {
  const ticks = scale.ticks(tickCount);
  return (
    <g className="text-muted-foreground">
      {ticks.map((t, i) => (
        <g key={`x-tick-${i}`} transform={`translate(${scale(t) ?? 0},${y})`}>
          <line y2={6} className="stroke-border" strokeWidth={1} />
          <text
            y={18}
            textAnchor="middle"
            className="fill-muted-foreground font-mono text-[11px]"
          >
            {formatChartTick(t, { percent })}
          </text>
        </g>
      ))}
    </g>
  );
}

function AxisTicksY({
  scale,
  x,
  tickCount = 5,
  percent = false,
}: {
  scale: ReturnType<typeof scaleLinear<number>>;
  x: number;
  tickCount?: number;
  percent?: boolean;
}) {
  const ticks = scale.ticks(tickCount);
  return (
    <g className="text-muted-foreground">
      {ticks.map((t, i) => (
        <g key={`y-tick-${i}`} transform={`translate(${x},${scale(t) ?? 0})`}>
          <line x2={-6} className="stroke-border" strokeWidth={1} />
          <text
            x={-10}
            dy="0.35em"
            textAnchor="end"
            className="fill-muted-foreground font-mono text-[11px]"
          >
            {formatChartTick(t, { percent })}
          </text>
        </g>
      ))}
    </g>
  );
}

/** Approx. mono 11px glyph size for collision tests. */
const BEST_FIT_CHAR_W = 6.6;
const BEST_FIT_CHAR_H = 12;

function bestFitLabelHitsPoint(
  labelX: number,
  labelY: number,
  angleDeg: number,
  textW: number,
  textH: number,
  px: number,
  py: number,
  pad: number,
): boolean {
  const rad = (-angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = px - labelX;
  const dy = py - labelY;
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;
  return (
    Math.abs(lx) <= textW / 2 + pad && Math.abs(ly) <= textH / 2 + pad
  );
}

function placeBestFitLabel(
  lx1: number,
  ly1: number,
  lx2: number,
  ly2: number,
  label: string,
  plotPoints: readonly { x: number; y: number }[],
  innerW: number,
  innerH: number,
): { x: number; y: number; angle: number } {
  const angleDeg = (Math.atan2(ly2 - ly1, lx2 - lx1) * 180) / Math.PI;
  const textAngle =
    angleDeg > 90 || angleDeg < -90 ? angleDeg + 180 : angleDeg;
  const rad = (textAngle * Math.PI) / 180;
  const textW = Math.max(label.length, 8) * BEST_FIT_CHAR_W;
  const textH = BEST_FIT_CHAR_H;
  const pointPad = 5; // clear scatter dots (r≈3.5)
  const ts = [0.2, 0.35, 0.5, 0.65, 0.8];
  const offsets = [12, 18, 24, -12, -18, -24];

  type Candidate = { x: number; y: number; hits: number; clearance: number };
  let best: Candidate | null = null;

  for (const t of ts) {
    const alongX = lx1 + (lx2 - lx1) * t;
    const alongY = ly1 + (ly2 - ly1) * t;
    for (const offset of offsets) {
      const rawX = alongX + Math.sin(rad) * offset;
      const rawY = alongY - Math.cos(rad) * offset;
      const x = Math.min(Math.max(rawX, textW / 2 + 4), innerW - textW / 2 - 4);
      const y = Math.min(Math.max(rawY, textH / 2 + 4), innerH - textH / 2 - 4);
      let hits = 0;
      let clearance = Infinity;
      for (const p of plotPoints) {
        const dx = p.x - x;
        const dy = p.y - y;
        clearance = Math.min(clearance, Math.hypot(dx, dy));
        if (
          bestFitLabelHitsPoint(
            x,
            y,
            textAngle,
            textW,
            textH,
            p.x,
            p.y,
            pointPad,
          )
        ) {
          hits++;
        }
      }
      const candidate: Candidate = {
        x,
        y,
        hits,
        clearance: Number.isFinite(clearance) ? clearance : 0,
      };
      if (
        !best ||
        candidate.hits < best.hits ||
        (candidate.hits === best.hits && candidate.clearance > best.clearance)
      ) {
        best = candidate;
      }
      if (candidate.hits === 0) {
        // Prefer earlier t / smaller |offset| once clear — already scanning that way.
        return { x: candidate.x, y: candidate.y, angle: textAngle };
      }
    }
  }

  return {
    x: best?.x ?? lx1 + (lx2 - lx1) * 0.72,
    y: best?.y ?? ly1 + (ly2 - ly1) * 0.72 - 12,
    angle: textAngle,
  };
}

function CartesianPlot({
  width,
  height,
  kind,
  xCol,
  yCol,
  yAggregate,
  showBestFitLine,
  rows,
}: {
  width: number;
  height: number;
  kind: "scatter" | "line" | "bar";
  xCol: string;
  yCol: string;
  yAggregate: YValueAggregate;
  showBestFitLine: boolean;
  rows: Record<string, unknown>[];
}) {
  const clipId = `best-fit-${useId().replace(/:/g, "")}`;
  const innerW = Math.max(0, width - M.left - M.right);
  const innerH = Math.max(0, height - M.top - M.bottom);
  const xIsPercent = kind !== "bar" && isPercentChartColumn(xCol, rows);
  const yIsPercent =
    yAggregate !== "count" &&
    yAggregate !== "countDistinct" &&
    isPercentChartColumn(yCol, rows);

  const { points, skipped, barRows, xDomainCat } = useMemo(() => {
    let skipped = 0;
    if (kind === "bar") {
      const groups = new Map<string, number[]>();
      for (const row of rows) {
        const cat = chartLabelText(row[xCol]);
        const yv = parseChartNumber(row[yCol]);
        if (yv === null) {
          skipped++;
          continue;
        }
        if (!groups.has(cat)) groups.set(cat, []);
        groups.get(cat)!.push(yv);
      }
      const entries: [string, number][] = [];
      for (const [cat, ys] of groups) {
        const v = aggregateNumericValues(ys, yAggregate);
        if (v !== null) entries.push([cat, v]);
      }
      entries.sort((a, b) =>
        a[0].localeCompare(b[0], undefined, { numeric: true }),
      );
      return {
        points: [] as { x: number; y: number }[],
        skipped,
        barRows: entries,
        xDomainCat: entries.map(([k]) => k),
      };
    }

    const groups = new Map<number, number[]>();
    for (const row of rows) {
      const xv = parseChartNumber(row[xCol]);
      const yv = parseChartNumber(row[yCol]);
      if (xv === null || yv === null) {
        skipped++;
        continue;
      }
      if (!groups.has(xv)) groups.set(xv, []);
      groups.get(xv)!.push(yv);
    }
    const pts: { x: number; y: number }[] = [];
    for (const [xv, ys] of groups) {
      const y = aggregateNumericValues(ys, yAggregate);
      if (y !== null) pts.push({ x: xv, y });
    }
    if (kind === "line") {
      pts.sort((a, b) => a.x - b.x);
    }
    return {
      points: pts,
      skipped,
      barRows: [] as [string, number][],
      xDomainCat: [] as string[],
    };
  }, [kind, rows, xCol, yCol, yAggregate]);

  const plot = useMemo(() => {
    if (innerW < 8 || innerH < 8) return null;

    if (kind === "bar") {
      if (barRows.length === 0) return null;
      const yMax = Math.max(...barRows.map(([, v]) => v), 0);
      const yPad = yMax <= 0 ? 1 : yMax * 0.06;
      const xScale = scaleBand<string>({
        domain: xDomainCat,
        range: [0, innerW],
        padding: 0.2,
      });
      const yScale = scaleLinear<number>({
        domain: [0, yMax + yPad],
        range: [innerH, 0],
      });
      return (
        <svg width={width} height={height} className="overflow-visible">
          <g transform={`translate(${M.left},${M.top})`}>
            <rect
              x={0}
              y={0}
              width={innerW}
              height={innerH}
              className="fill-muted/5 stroke-border/60"
              strokeWidth={1}
            />
            <AxisTicksY scale={yScale} x={0} percent={yIsPercent} />
            {barRows.map(([cat, val], i) => {
              const x = xScale(cat);
              if (x == null) return null;
              const w = xScale.bandwidth();
              const y = yScale(val);
              const bh = innerH - y;
              return (
                <Bar
                  key={`${cat}-${i}`}
                  x={x}
                  y={y}
                  width={w}
                  height={bh}
                  className="fill-primary/80"
                  rx={2}
                />
              );
            })}
            {xDomainCat.map((cat) => {
              const cx = (xScale(cat) ?? 0) + xScale.bandwidth() / 2;
              return (
                <text
                  key={cat}
                  x={cx}
                  y={innerH + 18}
                  textAnchor="middle"
                  className="fill-muted-foreground max-w-[120px] truncate font-mono text-[11px]"
                >
                  {cat.length > 18 ? `${cat.slice(0, 16)}…` : cat}
                </text>
              );
            })}
            <AxisTitleX label={xCol} x={innerW / 2} y={innerH + 40} />
            <AxisTitleY label={yCol} x={-50} y={innerH / 2} />
          </g>
        </svg>
      );
    }

    if (points.length === 0) return null;

    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const xPad = maxX === minX ? Math.abs(minX) * 0.02 || 1 : (maxX - minX) * 0.04;
    const yPad = maxY === minY ? Math.abs(minY) * 0.02 || 1 : (maxY - minY) * 0.06;

    const xScale = scaleLinear<number>({
      domain: [minX - xPad, maxX + xPad],
      range: [0, innerW],
    });
    const yScale = scaleLinear<number>({
      domain: [minY - yPad, maxY + yPad],
      range: [innerH, 0],
    });

    const scaled = points.map((p) => ({
      x: xScale(p.x) ?? 0,
      y: yScale(p.y) ?? 0,
    }));

    const fit =
      kind === "scatter" && showBestFitLine ? linearBestFit(points) : null;
    let bestFitLine: {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      labelX: number;
      labelY: number;
      labelAngle: number;
      label: string;
    } | null = null;
    if (fit) {
      const [d0, d1] = xScale.domain();
      const x0 = d0!;
      const x1 = d1!;
      const y0 = fit.slope * x0 + fit.intercept;
      const y1 = fit.slope * x1 + fit.intercept;
      const lx1 = xScale(x0) ?? 0;
      const ly1 = yScale(y0) ?? 0;
      const lx2 = xScale(x1) ?? 0;
      const ly2 = yScale(y1) ?? 0;
      const label = formatBestFitEquation(fit.slope, fit.intercept);
      const placed = placeBestFitLabel(
        lx1,
        ly1,
        lx2,
        ly2,
        label,
        scaled,
        innerW,
        innerH,
      );
      bestFitLine = {
        x1: lx1,
        y1: ly1,
        x2: lx2,
        y2: ly2,
        labelX: placed.x,
        labelY: placed.y,
        labelAngle: placed.angle,
        label,
      };
    }

    return (
      <svg width={width} height={height} className="overflow-visible">
        <defs>
          <clipPath id={clipId}>
            <rect x={0} y={0} width={innerW} height={innerH} />
          </clipPath>
        </defs>
        <g transform={`translate(${M.left},${M.top})`}>
          <rect
            x={0}
            y={0}
            width={innerW}
            height={innerH}
            className="fill-muted/5 stroke-border/60"
            strokeWidth={1}
          />
          <AxisTicksY scale={yScale} x={0} percent={yIsPercent} />
          <AxisTicksX scale={xScale} y={innerH} percent={xIsPercent} />
          <AxisTitleX label={xCol} x={innerW / 2} y={innerH + 40} />
          <AxisTitleY label={yCol} x={-50} y={innerH / 2} />
          {kind === "scatter"
            ? scaled.map((p, i) => (
                <circle
                  key={i}
                  cx={p.x}
                  cy={p.y}
                  r={3.5}
                  className="fill-primary stroke-background"
                  strokeWidth={1}
                />
              ))
            : null}
          {bestFitLine ? (
            <>
              <g clipPath={`url(#${clipId})`}>
                <line
                  x1={bestFitLine.x1}
                  y1={bestFitLine.y1}
                  x2={bestFitLine.x2}
                  y2={bestFitLine.y2}
                  className="stroke-foreground"
                  strokeWidth={1.5}
                  strokeDasharray="5 4"
                />
              </g>
              <text
                x={bestFitLine.labelX}
                y={bestFitLine.labelY}
                textAnchor="middle"
                dominantBaseline="middle"
                transform={`rotate(${bestFitLine.labelAngle} ${bestFitLine.labelX} ${bestFitLine.labelY})`}
                className="fill-foreground font-mono text-[11px]"
              >
                {bestFitLine.label}
              </text>
            </>
          ) : null}
          {kind === "line" && scaled.length >= 2 ? (
            <LinePath
              data={scaled}
              x={(d) => d.x}
              y={(d) => d.y}
              curve={curveMonotoneX}
              className="stroke-primary fill-none"
              strokeWidth={2}
            />
          ) : null}
          {kind === "line" && scaled.length === 1 ? (
            <circle
              cx={scaled[0].x}
              cy={scaled[0].y}
              r={4}
              className="fill-primary stroke-background"
              strokeWidth={1}
            />
          ) : null}
        </g>
      </svg>
    );
  }, [
    barRows,
    clipId,
    height,
    innerH,
    innerW,
    kind,
    points,
    showBestFitLine,
    width,
    xCol,
    xDomainCat,
    xIsPercent,
    yCol,
    yIsPercent,
  ]);

  const hint =
    skipped > 0 ? (
      <p className="text-muted-foreground px-1 pt-1 text-[11px]">
        {skipped.toLocaleString()} row{skipped === 1 ? "" : "s"} skipped (missing or
        non-numeric values).
      </p>
    ) : null;

  if (!plot) {
    return (
      <div className="flex min-h-[200px] flex-col">
        <p className="text-muted-foreground text-sm">
          No plottable points for the selected columns.
        </p>
        {hint}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-[240px] min-w-0 flex-1">{plot}</div>
      {hint}
    </div>
  );
}

function PiePlot({
  width,
  height,
  labelCol,
  valueCol,
  yAggregate,
  rows,
}: {
  width: number;
  height: number;
  labelCol: string;
  valueCol: string;
  yAggregate: YValueAggregate;
  rows: Record<string, unknown>[];
}) {
  const valueIsPercent =
    yAggregate !== "count" &&
    yAggregate !== "countDistinct" &&
    isPercentChartColumn(valueCol, rows);

  const { data, skipped } = useMemo(() => {
    const groups = new Map<string, number[]>();
    let skipped = 0;
    for (const row of rows) {
      const lab = chartLabelText(row[labelCol]);
      const v = parseChartNumber(row[valueCol]);
      if (lab === "" || v === null) {
        skipped++;
        continue;
      }
      if (!groups.has(lab)) groups.set(lab, []);
      groups.get(lab)!.push(v);
    }
    const data: { label: string; value: number }[] = [];
    for (const [label, ys] of groups) {
      const value = aggregateNumericValues(ys, yAggregate);
      if (value !== null) data.push({ label, value });
    }
    data.sort((a, b) => b.value - a.value);
    return { data, skipped };
  }, [labelCol, rows, valueCol, yAggregate]);

  const hint =
    skipped > 0 ? (
      <p className="text-muted-foreground px-1 pt-1 text-[11px]">
        {skipped.toLocaleString()} row{skipped === 1 ? "" : "s"} skipped (empty label or
        non-numeric value).
      </p>
    ) : null;

  if (data.length === 0) {
    return (
      <div className="flex min-h-[200px] flex-col">
        <p className="text-muted-foreground text-sm">
          No slices to display for the selected columns.
        </p>
        {hint}
      </div>
    );
  }

  // Fit the pie within the chart pane, leaving room for the legend beside it.
  const paneW = width > 0 ? width : 560;
  const paneH = height > 0 ? height : 260;
  const pieSize = Math.max(
    160,
    Math.min(paneH - 24, paneW * 0.42, 280),
  );
  const pieCx = pieSize / 2;
  const pieCy = pieSize / 2;
  const pieRadius = Math.max(8, pieSize / 2 - 16);
  const total = data.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="flex h-full min-h-[220px] min-w-0 flex-col items-center justify-center gap-3 md:flex-row md:gap-6">
      <div className="flex shrink-0 items-center justify-center">
        <svg width={pieSize} height={pieSize}>
          {/* visx Pie ignores top/left when using children — translate the arcs ourselves. */}
          <g transform={`translate(${pieCx},${pieCy})`}>
            <Pie
              data={data}
              pieValue={(d) => d.value}
              outerRadius={pieRadius}
              innerRadius={0}
            >
              {(pie) =>
                pie.arcs.map((arc, i) => (
                  <g key={`pie-slice-${i}-${String(arc.data.label)}`}>
                    <path
                      d={pie.path(arc) ?? ""}
                      fill={sliceColor(i)}
                      stroke="var(--background)"
                      strokeWidth={1}
                    />
                  </g>
                ))
              }
            </Pie>
          </g>
        </svg>
      </div>
      <ul className="text-foreground max-h-[min(40vh,240px)] w-max max-w-full min-w-0 list-none space-y-1 overflow-x-auto overflow-y-auto text-xs md:flex-none">
        {data.map((d, i) => {
          const pct = total > 0 ? (d.value / total) * 100 : 0;
          return (
            <li
              key={d.label}
              className="flex items-center gap-2 font-mono whitespace-nowrap"
            >
              <span
                className="size-2.5 shrink-0 rounded-sm"
                style={{ background: sliceColor(i) }}
                aria-hidden
              />
              <span title={d.label}>{d.label}</span>
              <span className="text-muted-foreground shrink-0 tabular-nums">
                {formatChartTick(d.value, { percent: valueIsPercent })} (
                {pct.toFixed(1)}%)
              </span>
            </li>
          );
        })}
      </ul>
      {hint ? <div className="w-full text-center md:basis-full">{hint}</div> : null}
    </div>
  );
}

export function SqlQueryResultsChart({
  columns,
  rows,
  config,
  onConfigChange,
  variant = "full",
}: Props) {
  /** Merge with defaults so no field is ever undefined (Base UI Select must stay controlled). */
  const cfg = useMemo((): QueryChartConfig => {
    return {
      ...defaultQueryChartConfig(),
      ...config,
      yAggregate: normalizeYAggregate(config.yAggregate),
      showBestFitLine: Boolean(config.showBestFitLine),
    };
  }, [config]);

  const { kind } = cfg;
  const { ref, width, height } = useSize();
  const isPreview = variant === "preview";

  const numericColumns = useMemo(
    () => listNumericChartColumns(columns, rows),
    [columns, rows],
  );
  const categoricalColumns = useMemo(
    () => listNonNumericChartColumns(columns, rows),
    [columns, rows],
  );

  const xAxisColumns =
    kind === "scatter" || kind === "line"
      ? numericColumns
      : kind === "bar"
        ? categoricalColumns
        : columns;
  const yAxisColumns =
    kind === "scatter" || kind === "line" || kind === "bar"
      ? numericColumns
      : columns;

  const xColumn =
    cfg.xColumn != null && xAxisColumns.includes(cfg.xColumn)
      ? cfg.xColumn
      : null;
  const yColumn =
    cfg.yColumn != null && yAxisColumns.includes(cfg.yColumn)
      ? cfg.yColumn
      : null;
  const pieLabelColumn =
    cfg.pieLabelColumn != null &&
    categoricalColumns.includes(cfg.pieLabelColumn)
      ? cfg.pieLabelColumn
      : null;
  const pieValueColumn =
    cfg.pieValueColumn != null && numericColumns.includes(cfg.pieValueColumn)
      ? cfg.pieValueColumn
      : null;

  const setKind = (k: QueryChartKind) => {
    if (k === "scatter" || k === "line") {
      onConfigChange({
        ...cfg,
        kind: k,
        xColumn:
          cfg.xColumn != null && numericColumns.includes(cfg.xColumn)
            ? cfg.xColumn
            : null,
        yColumn:
          cfg.yColumn != null && numericColumns.includes(cfg.yColumn)
            ? cfg.yColumn
            : null,
      });
      return;
    }
    if (k === "bar") {
      onConfigChange({
        ...cfg,
        kind: k,
        xColumn:
          cfg.xColumn != null && categoricalColumns.includes(cfg.xColumn)
            ? cfg.xColumn
            : null,
        yColumn:
          cfg.yColumn != null && numericColumns.includes(cfg.yColumn)
            ? cfg.yColumn
            : null,
      });
      return;
    }
    if (k === "pie") {
      onConfigChange({
        ...cfg,
        kind: k,
        pieLabelColumn:
          cfg.pieLabelColumn != null &&
          categoricalColumns.includes(cfg.pieLabelColumn)
            ? cfg.pieLabelColumn
            : null,
        pieValueColumn:
          cfg.pieValueColumn != null &&
          numericColumns.includes(cfg.pieValueColumn)
            ? cfg.pieValueColumn
            : null,
      });
      return;
    }
    onConfigChange({ ...cfg, kind: k });
  };

  const cartesianReady =
    xColumn != null &&
    yColumn != null &&
    columns.includes(xColumn) &&
    columns.includes(yColumn);

  const pieReady = pieLabelColumn != null && pieValueColumn != null;

  let body: ReactNode = null;

  const plotWidth = isPreview
    ? Math.max(width, 120)
    : Math.max(width, kind === "pie" ? 280 : 400);
  const plotHeight = isPreview
    ? Math.max(height, 100)
    : kind === "pie"
      ? Math.max(Math.min(height, 320), 220)
      : Math.max(Math.min(height, 480), 260);

  if (kind === "pie") {
    if (!pieReady) {
      body = (
        <p className="text-muted-foreground text-sm">
          Choose a label column and a value column to draw the chart.
        </p>
      );
    } else {
      body = (
        <PiePlot
          width={plotWidth}
          height={plotHeight}
          labelCol={pieLabelColumn!}
          valueCol={pieValueColumn!}
          yAggregate={cfg.yAggregate}
          rows={rows}
        />
      );
    }
  } else if (!cartesianReady) {
    body = (
      <p className="text-muted-foreground text-sm">
        Choose X and Y columns to draw the chart.
      </p>
    );
  } else {
    body = (
      <CartesianPlot
        width={plotWidth}
        height={plotHeight}
        kind={kind}
        xCol={xColumn!}
        yCol={yColumn!}
        yAggregate={cfg.yAggregate}
        showBestFitLine={kind === "scatter" && cfg.showBestFitLine}
        rows={rows}
      />
    );
  }

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col",
        isPreview ? "gap-0 p-0" : "gap-3 px-4 pb-4",
      )}
    >
      {!isPreview ? (
        <>
          <div className="flex flex-col gap-2">
            <span className="text-muted-foreground text-xs font-medium">
              Chart type
            </span>
            <div
              className="flex flex-wrap gap-2"
              role="tablist"
              aria-label="Chart type"
            >
              {CHART_KINDS.map(({ id, label }) => (
                <Button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={kind === id}
                  size="sm"
                  variant={kind === id ? "default" : "ghost"}
                  onClick={() => setKind(id)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-3">
            {kind === "pie" ? (
              <>
                <ColumnSelect
                  id="pie-label-col"
                  label="Label"
                  value={pieLabelColumn}
                  columns={categoricalColumns}
                  onChange={(next) =>
                    onConfigChange({ ...cfg, pieLabelColumn: next })
                  }
                  placeholder="Select Column…"
                />
                <ColumnSelect
                  id="pie-value-col"
                  label="Value"
                  value={pieValueColumn}
                  columns={numericColumns}
                  onChange={(next) =>
                    onConfigChange({ ...cfg, pieValueColumn: next })
                  }
                  placeholder="Select Column…"
                />
                <div className="flex min-w-0 flex-col gap-1">
                  <Label
                    htmlFor="pie-value-aggregate"
                    className="text-muted-foreground text-xs font-medium"
                  >
                    Value when duplicate label
                  </Label>
                  <Select
                    value={cfg.yAggregate}
                    modal={false}
                    items={Y_AGGREGATE_OPTIONS.map((o) => ({
                      value: o.id,
                      label: o.label,
                    }))}
                    onValueChange={(v) =>
                      onConfigChange({
                        ...cfg,
                        yAggregate: normalizeYAggregate(v),
                      })
                    }
                  >
                    <SelectTrigger
                      id="pie-value-aggregate"
                      size="sm"
                      className="border-input bg-background dark:bg-input/30 h-8 min-w-40 max-w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Y_AGGREGATE_OPTIONS.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            ) : (
              <>
                <ColumnSelect
                  id="chart-x-col"
                  label={kind === "bar" ? "Category (X)" : "X axis"}
                  value={xColumn}
                  columns={xAxisColumns}
                  onChange={(next) => onConfigChange({ ...cfg, xColumn: next })}
                  placeholder="Select Column…"
                />
                <ColumnSelect
                  id="chart-y-col"
                  label={kind === "bar" ? "Value (Y)" : "Y axis"}
                  value={yColumn}
                  columns={yAxisColumns}
                  onChange={(next) => onConfigChange({ ...cfg, yColumn: next })}
                  placeholder="Select Column…"
                />
                <div className="flex min-w-0 flex-col gap-1">
                  <Label
                    htmlFor="chart-y-aggregate"
                    className="text-muted-foreground text-xs font-medium"
                  >
                    {kind === "bar"
                      ? "Value when duplicate category"
                      : "Y when duplicate X"}
                  </Label>
                  <Select
                    value={cfg.yAggregate}
                    modal={false}
                    items={Y_AGGREGATE_OPTIONS.map((o) => ({
                      value: o.id,
                      label: o.label,
                    }))}
                    onValueChange={(v) =>
                      onConfigChange({
                        ...cfg,
                        yAggregate: normalizeYAggregate(v),
                      })
                    }
                  >
                    <SelectTrigger
                      id="chart-y-aggregate"
                      size="sm"
                      className="border-input bg-background dark:bg-input/30 h-8 min-w-40 max-w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Y_AGGREGATE_OPTIONS.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {kind === "scatter" ? (
                  <div className="flex min-w-0 flex-col gap-1">
                    <Label
                      htmlFor="chart-best-fit"
                      className="text-muted-foreground text-xs font-medium"
                    >
                      Line of best fit
                    </Label>
                    <Select
                      value={cfg.showBestFitLine ? "show" : "hide"}
                      modal={false}
                      items={BEST_FIT_OPTIONS.map((o) => ({
                        value: o.id,
                        label: o.label,
                      }))}
                      onValueChange={(v) =>
                        onConfigChange({
                          ...cfg,
                          showBestFitLine: v === "show",
                        })
                      }
                    >
                      <SelectTrigger
                        id="chart-best-fit"
                        size="sm"
                        className="border-input bg-background dark:bg-input/30 h-8 min-w-40 max-w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {BEST_FIT_OPTIONS.map((o) => (
                          <SelectItem key={o.id} value={o.id}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </>
      ) : null}

      <div
        ref={ref}
        className={cn(
          "bg-background/40 flex min-w-0 flex-1 flex-col",
          isPreview
            ? "min-h-0 w-full p-1"
            : "border-border/60 min-h-[260px] w-full rounded-lg border p-2",
        )}
      >
        {body}
      </div>
    </div>
  );
}
