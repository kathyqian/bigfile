import type { Table as ArrowTable } from "apache-arrow";

export function arrowTableToObjects(
  table: ArrowTable,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const fields = table.schema.fields;
  const n = table.numRows;
  for (let i = 0; i < n; i++) {
    const row: Record<string, unknown> = {};
    for (const f of fields) {
      const col = table.getChild(f.name);
      row[f.name] = col?.get(i) ?? null;
    }
    out.push(row);
  }
  return out;
}

export function arrowTableColumnNames(table: ArrowTable): string[] {
  return table.schema.fields.map((f) => f.name);
}
