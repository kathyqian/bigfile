"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SITE_ABOUT_PARAGRAPHS } from "@/lib/site";

type AboutBigfileDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function AboutBigfileDialog({
  open,
  onOpenChange,
}: AboutBigfileDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(85dvh,44rem)] w-full max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="border-border shrink-0 border-b px-4 py-3 pr-14">
          <DialogTitle className="uppercase tracking-[0.14em]">
            About Bigfile
          </DialogTitle>
          <DialogDescription className="sr-only">
            What Bigfile is and how it keeps your data local.
          </DialogDescription>
        </DialogHeader>
        <div className="text-foreground/80 min-h-0 flex-1 overflow-y-auto px-4 py-4 text-sm leading-relaxed font-normal">
          <div className="flex flex-col gap-3">
            {SITE_ABOUT_PARAGRAPHS.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            <p>
              Built by{" "}
              <a
                href="https://kathyqian.com"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-3 hover:text-foreground"
              >
                Kathy Qian
              </a>
              .
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
