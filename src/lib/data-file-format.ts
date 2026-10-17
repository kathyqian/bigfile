export type DataFileKind = "delimited" | "json" | "parquet";

const DELIMITED_EXTS = new Set([
  "csv",
  "tsv",
  "tab",
  "psv",
  "ssv",
  "txt",
]);

const JSON_EXTS = new Set(["json", "jsonl", "ndjson"]);

const PARQUET_EXTS = new Set(["parquet"]);

const DELIMITED_MIME = new Set([
  "text/csv",
  "text/tab-separated-values",
  "text/plain",
  "application/csv",
]);

const JSON_MIME = new Set([
  "application/json",
  "application/x-ndjson",
  "text/json",
]);

const PARQUET_MIME = new Set([
  "application/parquet",
  "application/vnd.apache.parquet",
  "application/x-parquet",
]);

/** Shown in empty-state copy and unsupported-file errors. */
export const ACCEPTED_FILE_HELP =
  "CSV, TSV, TXT, JSON, JSONL, and Parquet";

/** Value for `<input type="file" accept=…>`. */
export const ACCEPTED_FILE_INPUT =
  ".csv,.tsv,.tab,.psv,.ssv,.txt,.json,.jsonl,.ndjson,.parquet,text/csv,text/tab-separated-values,text/plain,application/json,application/x-ndjson,application/parquet,application/vnd.apache.parquet";

function fileExtension(fileName: string): string {
  const base =
    fileName.replace(/\\/g, "/").split("/").pop()?.trim() ?? fileName.trim();
  const i = base.lastIndexOf(".");
  if (i <= 0 || i === base.length - 1) return "";
  return base.slice(i + 1).toLowerCase();
}

function kindFromExtension(ext: string): DataFileKind | null {
  if (DELIMITED_EXTS.has(ext)) return "delimited";
  if (JSON_EXTS.has(ext)) return "json";
  if (PARQUET_EXTS.has(ext)) return "parquet";
  return null;
}

function kindFromMime(mime: string): DataFileKind | null {
  const t = mime.trim().toLowerCase();
  if (!t) return null;
  if (DELIMITED_MIME.has(t)) return "delimited";
  if (JSON_MIME.has(t)) return "json";
  if (PARQUET_MIME.has(t)) return "parquet";
  return null;
}

/** Infer import kind from file name, falling back to MIME type. */
export function detectDataFileKind(file: File): DataFileKind | null {
  return kindFromExtension(fileExtension(file.name)) ?? kindFromMime(file.type);
}

export function isSupportedDataFile(file: File): boolean {
  return detectDataFileKind(file) != null;
}

/**
 * Virtual path for DuckDB `registerFileBuffer`. Extension is preserved so
 * format sniffers can use it; the stem is always `upload`.
 */
export function registeredUploadName(file: File): string {
  const kind = detectDataFileKind(file);
  const ext = fileExtension(file.name);
  if (kind === "parquet") return "upload.parquet";
  if (kind === "json") {
    if (ext === "jsonl" || ext === "ndjson") return `upload.${ext}`;
    return "upload.json";
  }
  if (ext && DELIMITED_EXTS.has(ext)) return `upload.${ext}`;
  return "upload.csv";
}

/** SQL table expression that reads a previously registered upload file. */
export function duckdbReadSourceSql(
  registeredName: string,
  kind: DataFileKind,
): string {
  const path = registeredName.replace(/'/g, "''");
  switch (kind) {
    case "json":
      return `read_json_auto('${path}')`;
    case "parquet":
      return `read_parquet('${path}')`;
    case "delimited":
    default:
      return `read_csv_auto('${path}')`;
  }
}
