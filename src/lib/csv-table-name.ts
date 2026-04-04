/**
 * Builds a stable SQL identifier from a CSV file name (basename, extension stripped).
 * Intended for use with {@link quoteIdent} in DuckDB `CREATE TABLE` / `FROM` clauses.
 */
export function tableIdentifierFromFileName(fileName: string): string {
  const base =
    fileName.replace(/\\/g, "/").split("/").pop()?.trim() ?? fileName.trim();
  const withoutExt = base.replace(/\.csv$/i, "");
  let s = withoutExt
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  if (!s) s = "data";
  if (/^[0-9]/.test(s)) s = `_${s}`;
  if (s.length > 200) s = s.slice(0, 200);
  return s;
}
