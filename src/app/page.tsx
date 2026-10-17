import { DataViewer } from "@/components/data-viewer";

export default function Home() {
  return (
    <>
      <section className="sr-only">
        <h1>Bigfile</h1>
        <p>
          Drag and drop a file here, or choose one to load. Accepts CSV, TSV,
          TXT, JSON, JSONL, and Parquet. Data stays in your browser and is
          processed locally.
        </p>
      </section>
      <DataViewer />
    </>
  );
}
