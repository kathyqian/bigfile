"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  NumericColumnFilter,
  NumericCompareOp,
} from "@/lib/data-query";

const OPS: NumericCompareOp[] = ["=", "!=", "<", "<=", ">", ">="];

const MODE_ITEMS = [
  { value: "between", label: "Between" },
  { value: "cmp", label: "Compare (=, ≠, <, …)" },
] as const;

const OP_ITEMS = OPS.map((o) => ({ value: o, label: o }));

const SELECT_TRIGGER_CLASS =
  "border-input bg-background dark:bg-input/30 h-8 w-full";

function numericFilterSignature(f: NumericColumnFilter | undefined): string {
  if (!f || f.kind !== "numeric") return "none";
  if (f.mode === "between") return `b:${f.min ?? ""}:${f.max ?? ""}`;
  return `c:${f.op}:${f.value}`;
}

type Props = {
  initial: NumericColumnFilter | undefined;
  onApply: (f: NumericColumnFilter | null) => void;
};

export function NumericFilterPopoverBody({ initial, onApply }: Props) {
  const [mode, setMode] = useState<"between" | "cmp">(
    initial?.kind === "numeric" && initial.mode === "cmp" ? "cmp" : "between",
  );
  const [minV, setMinV] = useState(
    initial?.kind === "numeric" && initial.mode === "between"
      ? initial.min?.toString() ?? ""
      : "",
  );
  const [maxV, setMaxV] = useState(
    initial?.kind === "numeric" && initial.mode === "between"
      ? initial.max?.toString() ?? ""
      : "",
  );
  const [op, setOp] = useState<NumericCompareOp>(
    initial?.kind === "numeric" && initial.mode === "cmp" ? initial.op : "=",
  );
  const [cmpV, setCmpV] = useState(
    initial?.kind === "numeric" && initial.mode === "cmp"
      ? initial.value?.toString() ?? ""
      : "",
  );

  const initialSig = useMemo(() => numericFilterSignature(initial), [initial]);

  useEffect(() => {
    const i = initial;
    setMode(i?.kind === "numeric" && i.mode === "cmp" ? "cmp" : "between");
    setMinV(
      i?.kind === "numeric" && i.mode === "between"
        ? i.min?.toString() ?? ""
        : "",
    );
    setMaxV(
      i?.kind === "numeric" && i.mode === "between"
        ? i.max?.toString() ?? ""
        : "",
    );
    setOp(i?.kind === "numeric" && i.mode === "cmp" ? i.op : "=");
    setCmpV(
      i?.kind === "numeric" && i.mode === "cmp"
        ? i.value?.toString() ?? ""
        : "",
    );
  }, [initialSig]);

  function parseNum(s: string): number | undefined {
    const t = s.trim();
    if (t === "") return undefined;
    const n = Number(t);
    return Number.isFinite(n) ? n : undefined;
  }

  function handleApply() {
    if (mode === "between") {
      const min = parseNum(minV);
      const max = parseNum(maxV);
      if (min === undefined && max === undefined) {
        onApply(null);
        return;
      }
      onApply({ kind: "numeric", mode: "between", min, max });
      return;
    }
    const v = parseNum(cmpV);
    if (v === undefined) {
      onApply(null);
      return;
    }
    onApply({ kind: "numeric", mode: "cmp", op, value: v });
  }

  function handleClear() {
    onApply(null);
  }

  return (
    <div className="flex w-[min(100vw-2rem,18rem)] flex-col gap-3 p-1">
      <div className="flex flex-col gap-2">
        <Label className="text-muted-foreground text-xs font-medium">Mode</Label>
        <Select
          value={mode}
          modal={false}
          items={MODE_ITEMS.map((o) => ({ value: o.value, label: o.label }))}
          onValueChange={(v) => setMode(v as "between" | "cmp")}
        >
          <SelectTrigger size="sm" className={SELECT_TRIGGER_CLASS}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODE_ITEMS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {mode === "between" ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <Label className="text-muted-foreground text-xs font-medium">Min</Label>
            <Input
              className="h-8 font-mono text-xs"
              inputMode="decimal"
              value={minV}
              onChange={(e) => setMinV(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-muted-foreground text-xs font-medium">Max</Label>
            <Input
              className="h-8 font-mono text-xs"
              inputMode="decimal"
              value={maxV}
              onChange={(e) => setMaxV(e.target.value)}
              placeholder="Optional"
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <Label className="text-muted-foreground text-xs font-medium">Operator</Label>
            <Select
              value={op}
              modal={false}
              items={OP_ITEMS}
              onValueChange={(v) => setOp(v as NumericCompareOp)}
            >
              <SelectTrigger size="sm" className={SELECT_TRIGGER_CLASS}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OP_ITEMS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-muted-foreground text-xs font-medium">Value</Label>
            <Input
              className="h-8 w-full font-mono text-xs"
              inputMode="decimal"
              value={cmpV}
              onChange={(e) => setCmpV(e.target.value)}
            />
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={handleClear}>
          Clear
        </Button>
        <Button type="button" size="sm" onClick={handleApply}>
          Apply
        </Button>
      </div>
    </div>
  );
}
