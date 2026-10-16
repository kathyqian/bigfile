import * as duckdb from "@duckdb/duckdb-wasm";
import duckdb_wasm from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm";
import duckdb_wasm_eh from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm";

export type DuckDBHandle = {
  db: duckdb.AsyncDuckDB;
  terminate: () => Promise<void>;
};

/** Serialize WASM init — overlapping Workers from Strict Mode remounts can hang. */
let createChain: Promise<unknown> = Promise.resolve();

export async function createDuckDB(): Promise<DuckDBHandle> {
  const run = async (): Promise<DuckDBHandle> => {
    const MANUAL_BUNDLES: duckdb.DuckDBBundles = {
      mvp: {
        mainModule: duckdb_wasm,
        mainWorker: new URL(
          "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js",
          import.meta.url,
        ).href,
      },
      eh: {
        mainModule: duckdb_wasm_eh,
        mainWorker: new URL(
          "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js",
          import.meta.url,
        ).href,
      },
    };
    const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);
    const worker = new Worker(bundle.mainWorker!);
    const logger = new duckdb.ConsoleLogger();
    const db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    return {
      db,
      terminate: () => db.terminate(),
    };
  };

  const next = createChain.then(run, run);
  createChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}
