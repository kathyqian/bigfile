import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

type AppTopBarProps = {
  fileLabel: string | null;
  hasSpreadsheet: boolean;
  className?: string;
};

export function AppTopBar({
  fileLabel,
  hasSpreadsheet,
  className,
}: AppTopBarProps) {
  return (
    <header
      className={cn(
        "border-border bg-background flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4",
        className,
      )}
    >
      <div className="text-foreground text-xs font-medium tracking-[0.14em] uppercase">
        Bigfile
      </div>
      <div className="flex min-w-0 items-center justify-end gap-2">
        {hasSpreadsheet && fileLabel ? (
          <span
            className="text-muted-foreground max-w-[40vw] truncate text-right text-xs font-mono md:max-w-[24rem]"
            title={fileLabel}
          >
            {fileLabel}
          </span>
        ) : null}
        <ThemeToggle />
      </div>
    </header>
  );
}
