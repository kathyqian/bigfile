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
} from "@/lib/csv-query";

const OPS: NumericCompareOp[] = ["=", "!=", "<", "<=", ">", ">="];

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
        <Label className="text-muted-foreground text-xs">Mode</Label>
        <Select
          value={mode}
          onValueChange={(v) => setMode(v as "between" | "cmp")}
        >
          <SelectTrigger className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="between">Between / bounds</SelectItem>
            <SelectItem value="cmp">Compare (=, ≠, &lt;, …)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {mode === "between" ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <Label className="text-muted-foreground text-xs">Min</Label>
            <Input
              className="h-8"
              inputMode="decimal"
              value={minV}
              onChange={(e) => setMinV(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-muted-foreground text-xs">Max</Label>
            <Input
              className="h-8"
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
            <Label className="text-muted-foreground text-xs">Operator</Label>
            <Select
              value={op}
              onValueChange={(v) => setOp(v as NumericCompareOp)}
            >
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPS.map((o) => (
                  <SelectItem key={o} value={o}>
                    {o}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-muted-foreground text-xs">Value</Label>
            <Input
              className="h-8"
              inputMode="decimal"
              value={cmpV}
              onChange={(e) => setCmpV(e.target.value)}
            />
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={handleClear}>
          Clear
        </Button>
        <Button type="button" size="sm" onClick={handleApply}>
          Apply
        </Button>
      </div>
    </div>
  );
}
