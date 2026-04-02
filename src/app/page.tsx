import { CsvViewer } from "@/components/csv-viewer";

export default function Home() {
  return (
    <main className="bg-background flex min-h-screen flex-1 flex-col">
      <header className="border-border bg-card/50 border-b px-4 py-3 md:px-6">
        <h1 className="text-foreground text-lg font-semibold tracking-tight">
          CSV viewer
        </h1>
        <p className="text-muted-foreground text-sm">
          DuckDB WASM in your browser · read-only grid
        </p>
      </header>
      <CsvViewer />
    </main>
  );
}
