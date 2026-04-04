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
        "border-border bg-background flex shrink-0 items-center justify-between gap-4 border-b px-4 py-3 md:px-6",
        className,
      )}
    >
      <div className="text-foreground text-lg font-semibold tracking-tight">
        Bigfile
      </div>
      <div className="flex min-w-0 max-w-[70%] items-center justify-end gap-3 md:max-w-[60%]">
        {hasSpreadsheet && fileLabel ? (
          <span
            className="text-muted-foreground truncate text-right text-sm font-mono"
            title={fileLabel}
          >
            {fileLabel}
          </span>
        ) : null}
        {showOpenFileButton && !hasSpreadsheet ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={openFileDisabled}
            onClick={onOpenFile}
          >
            Choose CSV
          </Button>
        ) : null}
      </div>
    </header>
  );
}
