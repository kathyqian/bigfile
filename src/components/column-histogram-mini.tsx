"use client";

import { createPortal } from "react-dom";
import {
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { Bar } from "@visx/shape";
import { scaleBand, scaleLinear } from "@visx/scale";

import {
  NUMERIC_BINS,
  type ColumnHistogramData,
} from "@/lib/column-histogram";

const H = 32;

type Props = {
  data: ColumnHistogramData | null;
  loading: boolean;
};

type HistogramTooltipState = {
  clientX: number;
  clientY: number;
  label: string;
  detail: string;
};

function formatHistogramNumber(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9 || (abs > 0 && abs < 1e-6)) return n.toExponential(3);
  if (abs >= 1_000_000)
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (abs >= 1)
    return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
  return n.toPrecision(5);
}

function numericBinRangeLabel(
  min: number,
  max: number,
  binIndex: number,
  binCount: number,
): string {
  const span = max - min;
  const start = min + (binIndex / binCount) * span;
  const end = binIndex === binCount - 1 ? max : min + ((binIndex + 1) / binCount) * span;
  return `${formatHistogramNumber(start)} – ${formatHistogramNumber(end)}`;
}

function tipDetail(count: number, totalNonNull: number): string {
  const pct = totalNonNull > 0 ? (100 * count) / totalNonNull : 0;
  const rows = count === 1 ? "1 row" : `${count.toLocaleString()} rows`;
  return `${rows} (${pct.toFixed(1)}%)`;
}

function buildNumericTip(
  data: Extract<ColumnHistogramData, { kind: "numeric" }>,
  binIndex: number,
  count: number,
): { label: string; detail: string } {
  return {
    label: numericBinRangeLabel(data.min, data.max, binIndex, NUMERIC_BINS),
    detail: tipDetail(count, data.totalNonNull),
  };
}

function buildCategoricalTip(
  data: Extract<ColumnHistogramData, { kind: "categorical" }>,
  i: number,
  count: number,
): { label: string; detail: string } {
  const raw = data.labels[i] ?? "";
  return {
    label: raw === "Other" ? "Other" : raw ? raw : "(empty string)",
    detail: tipDetail(count, data.totalNonNull),
  };
}

function HistogramTooltip({ tip }: { tip: HistogramTooltipState | null }) {
  if (tip === null || typeof document === "undefined") return null;

  const el = (
    <div
      role="tooltip"
      className="bg-popover text-popover-foreground border-border pointer-events-none fixed z-200 max-w-[min(20rem,calc(100vw-1rem))] rounded-md border px-2.5 py-2 text-xs shadow-md"
      style={{
        left: tip.clientX + 12,
        top: tip.clientY + 12,
      }}
    >
      <div className="text-foreground font-medium wrap-break-word">{tip.label}</div>
      <div className="text-muted-foreground mt-0.5 font-mono tabular-nums">
        {tip.detail}
      </div>
    </div>
  );

  return createPortal(el, document.body);
}

function Bars({
  data,
  width,
  onTipChange,
}: {
  data: Extract<ColumnHistogramData, { kind: "numeric" | "categorical" }>;
  width: number;
  onTipChange: (tip: HistogramTooltipState | null) => void;
}) {
  const w = Math.max(width, 1);
  const counts =
    data.kind === "numeric" ? data.bins : data.counts;
  const max = Math.max(1, ...counts);
  const xScale = scaleBand<number>({
    domain: counts.map((_, i) => i),
    range: [0, w],
    padding: 0.12,
  });
  const yScale = scaleLinear<number>({
    domain: [0, max],
    range: [H, 0],
  });

  const showTip = (
    e: PointerEvent<SVGRectElement>,
    binIndex: number,
    count: number,
  ) => {
    const { clientX, clientY } = e;
    const payload =
      data.kind === "numeric"
        ? buildNumericTip(data, binIndex, count)
        : buildCategoricalTip(data, binIndex, count);
    onTipChange({
      clientX,
      clientY,
      label: payload.label,
      detail: payload.detail,
    });
  };

  const moveTip = (
    e: PointerEvent<SVGRectElement>,
    binIndex: number,
    count: number,
  ) => {
    const { clientX, clientY } = e;
    const payload =
      data.kind === "numeric"
        ? buildNumericTip(data, binIndex, count)
        : buildCategoricalTip(data, binIndex, count);
    onTipChange({
      clientX,
      clientY,
      label: payload.label,
      detail: payload.detail,
    });
  };

  return (
    <g>
      {counts.map((c, i) => {
        const x = xScale(i);
        const bw = xScale.bandwidth();
        if (x === undefined || bw === undefined) return null;
        const y = yScale(c) ?? H;
        const barH = H - y;
        return (
          <g key={i}>
            <rect
              x={x}
              y={0}
              width={bw}
              height={H}
              fill="transparent"
              className="cursor-default"
              onPointerEnter={(e) => showTip(e, i, c)}
              onPointerMove={(e) => moveTip(e, i, c)}
              onPointerLeave={() => onTipChange(null)}
            />
            {c > 0 ? (
              <Bar
                x={x}
                y={y}
                width={bw}
                height={barH}
                fill="currentColor"
                opacity={0.72}
                rx={1}
                pointerEvents="none"
              />
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

function useContainerWidth() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      setWidth(el.getBoundingClientRect().width);
    };

    measure();
    const ro = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next !== undefined) setWidth(next);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, width };
}

export function ColumnHistogramMini({ data, loading }: Props) {
  const { ref, width } = useContainerWidth();
  const w = Math.max(width, 1);
  const [tip, setTip] = useState<HistogramTooltipState | null>(null);

  useLayoutEffect(() => {
    const hide = () => setTip(null);
    window.addEventListener("scroll", hide, true);
    return () => window.removeEventListener("scroll", hide, true);
  }, []);

  return (
    <>
      <div
        ref={ref}
        className="mt-0.5 h-8 w-full min-w-0 shrink"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {loading || data === null ? (
          <div
            className="bg-muted/45 h-full w-full animate-pulse rounded-sm"
            aria-hidden
          />
        ) : data.kind === "empty" ? (
          <svg
            width="100%"
            height={H}
            viewBox={`0 0 ${w} ${H}`}
            className="text-muted-foreground/45 block"
            preserveAspectRatio="none"
            aria-hidden
          >
            <line
              x1={Math.min(4, w * 0.05)}
              y1={H / 2}
              x2={Math.max(w - 4, w * 0.95)}
              y2={H / 2}
              stroke="currentColor"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          </svg>
        ) : (
          <svg
            width="100%"
            height={H}
            viewBox={`0 0 ${w} ${H}`}
            className="text-muted-foreground block"
            preserveAspectRatio="none"
          >
            <Bars data={data} width={w} onTipChange={setTip} />
          </svg>
        )}
      </div>
      <HistogramTooltip tip={tip} />
    </>
  );
}
