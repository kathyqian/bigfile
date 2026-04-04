"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { TextColumnFilter } from "@/lib/csv-query";
import { isTextFilterActive } from "@/lib/csv-query";
import { cn } from "@/lib/utils";

const MAX_DISTINCT = 10_000;

type Props = {
  columnKey: string;
  initial: TextColumnFilter | undefined;
  onApply: (f: TextColumnFilter | null) => void;
  /** Load distinct values (nulls represented as null in array) */
  loadDistinct: () => Promise<{ values: (string | null)[]; truncated: boolean }>;
};

function textFilterSignature(f: TextColumnFilter | undefined): string {
  if (!f || f.kind !== "text") return "none";
  return `t:${f.includeNull}:${[...f.values].sort().join("\x01")}`;
}

function labelForValue(v: string | null): string {
  if (v === null) return "(null)";
  if (v === "") return "(blank)";
  return v.length > 80 ? `${v.slice(0, 77)}…` : v;
}

export function TextFilterPopoverBody({
  columnKey,
  initial,
  onApply,
  loadDistinct,
}: Props) {
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [truncated, setTruncated] = useState(false);
  const [options, setOptions] = useState<(string | null)[]>([]);
  const [selNull, setSelNull] = useState(initial?.includeNull ?? false);
  const [selStrings, setSelStrings] = useState<Set<string>>(
    () => new Set(initial?.values ?? []),
  );

  const initialSig = useMemo(() => textFilterSignature(initial), [initial]);

  useEffect(() => {
    setSelNull(initial?.includeNull ?? false);
    setSelStrings(new Set(initial?.values ?? []));
  }, [initialSig]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const { values, truncated: t } = await loadDistinct();
      setOptions(values);
      setTruncated(t);
    } finally {
      setLoading(false);
    }
  }, [loadDistinct]);

  useEffect(() => {
    void reload();
  }, [reload, columnKey]);

  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((v) => {
      const s = v === null ? "" : v;
      return s.toLowerCase().includes(q);
    });
  }, [options, search]);

  function toggleString(v: string) {
    setSelStrings((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  }

  function handleApply() {
    const f: TextColumnFilter = {
      kind: "text",
      includeNull: selNull,
      values: [...selStrings],
    };
    if (!isTextFilterActive(f)) onApply(null);
    else onApply(f);
  }

  function handleClear() {
    onApply(null);
  }

  function selectAllVisible() {
    const next = new Set(selStrings);
    for (const v of filteredOptions) {
      if (v === null) setSelNull(true);
      else next.add(v);
    }
    setSelStrings(next);
  }

  return (
    <div className="flex w-[min(100vw-2rem,20rem)] flex-col gap-2 p-1">
      <div className="flex flex-col gap-1">
        <Label className="text-muted-foreground text-xs">Search values</Label>
        <Input
          className="h-8"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter list…"
        />
      </div>

      {loading ? (
        <p className="text-muted-foreground py-6 text-center text-xs">
          Loading distinct values…
        </p>
      ) : (
        <>
          {truncated ? (
            <p className="text-muted-foreground text-[0.7rem] leading-tight">
              Showing first {MAX_DISTINCT.toLocaleString()} distinct values.
            </p>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="h-7 text-xs"
              onClick={selectAllVisible}
            >
              Select visible
            </Button>
          </div>
          <ScrollArea className="h-[min(40vh,220px)] rounded-md border pr-2">
            <div className="flex flex-col gap-1 py-1">
              {options.some((v) => v === null) ? (
                <label
                  className={cn(
                    "hover:bg-muted/50 flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm",
                  )}
                >
                  <Checkbox
                    checked={selNull}
                    onCheckedChange={(c) => setSelNull(c === true)}
                  />
                  <span className="truncate">{labelForValue(null)}</span>
                </label>
              ) : null}
              {filteredOptions.map((v, i) => {
                if (v === null) return null;
                const id = `${columnKey}-${i}-${v.slice(0, 24)}`;
                return (
                  <label
                    key={id}
                    className="hover:bg-muted/50 flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm"
                  >
                    <Checkbox
                      checked={selStrings.has(v)}
                      onCheckedChange={() => toggleString(v)}
                    />
                    <span className="truncate font-mono text-xs" title={v}>
                      {labelForValue(v)}
                    </span>
                  </label>
                );
              })}
            </div>
          </ScrollArea>
        </>
      )}

      <div className="flex justify-end gap-2 pt-1">
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
