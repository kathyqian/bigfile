"use client";

import { useState } from "react";

import { AboutBigfileDialog } from "@/components/about-bigfile-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
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
  const [aboutOpen, setAboutOpen] = useState(false);

  return (
    <>
      <header
        className={cn(
          "border-border bg-background flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4",
          className,
        )}
      >
        <div className="text-muted-foreground flex min-w-0 items-baseline gap-x-3 text-xs">
          <Button
            type="button"
            variant="ghost"
            aria-label="About Bigfile"
            onClick={() => setAboutOpen(true)}
            className="text-foreground h-auto cursor-pointer px-0 py-0 text-xs font-medium tracking-[0.14em] uppercase hover:bg-transparent"
          >
            Bigfile
          </Button>
          <span className="font-normal">
            by{" "}
            <a
              href="https://kathyqian.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline-offset-3 hover:text-foreground hover:underline"
            >
              Kathy Qian
            </a>
          </span>
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
      <AboutBigfileDialog open={aboutOpen} onOpenChange={setAboutOpen} />
    </>
  );
}
