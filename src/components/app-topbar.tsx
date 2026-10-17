import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type AppTopBarProps = {
  fileLabel: string | null;
  hasSpreadsheet: boolean;
  /** When false (e.g. empty drop zone), upload lives only in the main content */
  showOpenFileButton?: boolean;
  openFileDisabled?: boolean;
  onOpenFile: () => void;
  className?: string;
};

export function AppTopBar({
  fileLabel,
  hasSpreadsheet,
  showOpenFileButton = true,
  openFileDisabled,
  onOpenFile,
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
        {showOpenFileButton && !hasSpreadsheet ? (
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={openFileDisabled}
            onClick={onOpenFile}
          >
            Choose File
          </Button>
        ) : null}
        <ThemeToggle />
      </div>
    </header>
  );
}
