import { DataViewer } from "@/components/data-viewer";
import { SITE_ABOUT_PARAGRAPHS, SITE_NAME } from "@/lib/site";

export default function Home() {
  return (
    <>
      <section className="sr-only">
        <h1>{SITE_NAME}</h1>
        {SITE_ABOUT_PARAGRAPHS.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
        <p>
          Drag and drop a file here, or choose one to load. Accepts CSV, TSV,
          TXT, JSON, JSONL, and Parquet. Data is processed locally and never
          leaves your browser.
        </p>
      </section>
      <DataViewer />
    </>
  );
}
