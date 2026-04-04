"use client";

import { curveMonotoneX } from "d3-shape";
import { scaleBand, scaleLinear } from "@visx/scale";
import { Bar, LinePath, Pie } from "@visx/shape";
import {
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
  formatChartTick,
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
  pieLabelColumn: string | null;
  pieValueColumn: string | null;
};

export function defaultQueryChartConfig(): QueryChartConfig {
  return {
    kind: "scatter",
    xColumn: null,
    yColumn: null,
    yAggregate: "sum",
    pieLabelColumn: null,
    pieValueColumn: null,
  };
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
};

const M = { top: 12, right: 16, bottom: 40, left: 52 };

const CHART_KINDS: { id: QueryChartKind; label: string }[] = [
  { id: "scatter", label: "Scatter" },
  { id: "line", label: "Line" },
  { id: "bar", label: "Bar" },
  { id: "pie", label: "Pie" },
];

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
  const v = value ?? NONE_VALUE;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Label htmlFor={id} className="text-muted-foreground text-xs font-medium">
        {label}
      </Label>
      <Select
        value={v}
        onValueChange={(next) =>
          onChange(next === NONE_VALUE ? null : next)
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
}: {
  scale: ReturnType<typeof scaleLinear<number>>;
  y: number;
  tickCount?: number;
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
            className="fill-muted-foreground font-mono text-[10px]"
          >
            {formatChartTick(t)}
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
}: {
  scale: ReturnType<typeof scaleLinear<number>>;
  x: number;
  tickCount?: number;
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
            className="fill-muted-foreground font-mono text-[10px]"
          >
            {formatChartTick(t)}
          </text>
        </g>
      ))}
    </g>
  );
}

function CartesianPlot({
  width,
  height,
  kind,
  xCol,
  yCol,
  yAggregate,
  rows,
}: {
  width: number;
  height: number;
  kind: "scatter" | "line" | "bar";
  xCol: string;
  yCol: string;
  yAggregate: YValueAggregate;
  rows: Record<string, unknown>[];
}) {
  const innerW = Math.max(0, width - M.left - M.right);
  const innerH = Math.max(0, height - M.top - M.bottom);

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
            <AxisTicksY scale={yScale} x={0} />
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
                  y={innerH + 22}
                  textAnchor="middle"
                  className="fill-muted-foreground max-w-[120px] truncate font-mono text-[10px]"
                >
                  {cat.length > 18 ? `${cat.slice(0, 16)}…` : cat}
                </text>
              );
            })}
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
          <AxisTicksY scale={yScale} x={0} />
          <AxisTicksX scale={xScale} y={innerH} />
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
  }, [barRows, height, innerH, innerW, kind, points, width, xDomainCat]);

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

  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.max(8, Math.min(width, height) / 2 - 24);

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

  return (
    <div className="flex min-h-0 flex-col gap-2 md:flex-row md:items-start">
      <div className="min-h-[220px] min-w-0 shrink-0 md:w-1/2">
        <svg width={width} height={height} className="max-h-[min(50vh,320px)]">
          <Pie
            data={data}
            pieValue={(d) => d.value}
            outerRadius={radius}
            innerRadius={0}
            top={cy}
            left={cx}
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
        </svg>
      </div>
      <ul className="text-foreground max-h-[min(40vh,220px)] min-w-0 flex-1 list-none space-y-1 overflow-y-auto text-xs">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-start gap-2 font-mono">
            <span
              className="mt-0.5 size-2.5 shrink-0 rounded-sm"
              style={{ background: sliceColor(i) }}
              aria-hidden
            />
            <span className="min-w-0 break-all" title={d.label}>
              {d.label}
            </span>
            <span className="text-muted-foreground shrink-0">
              {formatChartTick(d.value)}
            </span>
          </li>
        ))}
      </ul>
      {hint ? <div className="md:w-full">{hint}</div> : null}
    </div>
  );
}

export function SqlQueryResultsChart({
  columns,
  rows,
  config,
  onConfigChange,
}: Props) {
  /** Merge with defaults so no field is ever undefined (Base UI Select must stay controlled). */
  const cfg = useMemo((): QueryChartConfig => {
    return {
      ...defaultQueryChartConfig(),
      ...config,
      yAggregate: normalizeYAggregate(config.yAggregate),
    };
  }, [config]);

  const { kind } = cfg;
  const { ref, width, height } = useSize();

  const setKind = (k: QueryChartKind) => {
    onConfigChange({ ...cfg, kind: k });
  };

  const cartesianReady =
    cfg.xColumn != null &&
    cfg.yColumn != null &&
    columns.includes(cfg.xColumn) &&
    columns.includes(cfg.yColumn);

  const pieReady =
    cfg.pieLabelColumn != null &&
    cfg.pieValueColumn != null &&
    columns.includes(cfg.pieLabelColumn) &&
    columns.includes(cfg.pieValueColumn);

  let body: ReactNode = null;

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
          width={Math.max(width, 280)}
          height={Math.max(Math.min(height, 320), 220)}
          labelCol={cfg.pieLabelColumn!}
          valueCol={cfg.pieValueColumn!}
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
        width={Math.max(width, 400)}
        height={Math.max(Math.min(height, 480), 260)}
        kind={kind}
        xCol={cfg.xColumn!}
        yCol={cfg.yColumn!}
        yAggregate={cfg.yAggregate}
        rows={rows}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-2">
      <div className="flex flex-col gap-2">
        <span className="text-muted-foreground text-xs font-medium">Chart type</span>
        <div
          className="flex flex-wrap gap-1.5"
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
              variant={kind === id ? "default" : "outline"}
              className={cn(
                "h-7 rounded-full px-3 text-xs font-medium",
                kind === id ? "" : "border-border bg-background",
              )}
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
              value={cfg.pieLabelColumn}
              columns={columns}
              onChange={(pieLabelColumn) =>
                onConfigChange({ ...cfg, pieLabelColumn })
              }
              placeholder="Column…"
            />
            <ColumnSelect
              id="pie-value-col"
              label="Value"
              value={cfg.pieValueColumn}
              columns={columns}
              onChange={(pieValueColumn) =>
                onConfigChange({ ...cfg, pieValueColumn })
              }
              placeholder="Column…"
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
              value={cfg.xColumn}
              columns={columns}
              onChange={(xColumn) => onConfigChange({ ...cfg, xColumn })}
              placeholder="Column…"
            />
            <ColumnSelect
              id="chart-y-col"
              label={kind === "bar" ? "Value (Y)" : "Y axis"}
              value={cfg.yColumn}
              columns={columns}
              onChange={(yColumn) => onConfigChange({ ...cfg, yColumn })}
              placeholder="Column…"
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
          </>
        )}
      </div>

      <div
        ref={ref}
        className="border-border/60 bg-background/40 min-h-[260px] w-full min-w-0 flex-1 rounded-lg border p-2"
      >
        {body}
      </div>
    </div>
  );
}
