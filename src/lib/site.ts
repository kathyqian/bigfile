export const SITE_URL = "https://bigfile.wtf";

export const SITE_NAME = "Bigfile";

export const SITE_DESCRIPTION =
  "Open CSV, TSV, JSON, JSONL, and Parquet files in your browser. Explore, filter, query with SQL, and build charts. All processing is done locally with DuckDB. Your data is never uploaded.";

/** Longer about copy for the About modal and crawlable homepage text. */
export const SITE_ABOUT_PARAGRAPHS = [
  "Bigfile is a free, browser-based tool for exploring large data files without uploading them to a server. Open CSV, TSV, TXT, JSON, JSONL, and Parquet files, then browse, filter, sort, run SQL queries, and build charts — all processed locally with DuckDB WebAssembly.",
  "Your data never leaves your device. There is no account, no cloud sync, and no server-side processing. Use it for a quick look at a spreadsheet export, a Parquet dump, or nested JSON without installing desktop software.",
] as const;
