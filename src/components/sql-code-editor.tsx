"use client";

import { useMemo } from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { sql, PostgreSQL } from "@codemirror/lang-sql";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView, keymap, placeholder as cmPlaceholder } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { tags as t } from "@lezer/highlight";
import { useTheme } from "next-themes";

import { cn } from "@/lib/utils";

type Props = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onRun?: () => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  editorRef?: React.Ref<ReactCodeMirrorRef>;
};

/**
 * SQL highlighting: muted slate / teal / rust (not purple).
 * Double-quoted names are identifiers in SQL, not strings — style both.
 */
const sqlHighlightLight = HighlightStyle.define([
  {
    tag: [t.keyword, t.operatorKeyword, t.modifier, t.moduleKeyword],
    color: "#334155",
    fontWeight: "500",
  },
  { tag: [t.string, t.special(t.string)], color: "#0f766e" },
  { tag: [t.number, t.bool], color: "#9a3412" },
  { tag: t.null, color: "#334155", fontWeight: "500" },
  { tag: t.comment, color: "#a8a29e", fontStyle: "italic" },
  { tag: [t.operator, t.punctuation, t.separator], color: "#78716c" },
  { tag: [t.typeName, t.standard(t.typeName)], color: "#57534e" },
  { tag: t.variableName, color: "#0c0a09" },
  {
    tag: [t.special(t.variableName), t.name, t.standard(t.name)],
    color: "#0f766e",
  },
]);

const sqlHighlightDark = HighlightStyle.define([
  {
    tag: [t.keyword, t.operatorKeyword, t.modifier, t.moduleKeyword],
    color: "#94a3b8",
    fontWeight: "500",
  },
  { tag: [t.string, t.special(t.string)], color: "#5eead4" },
  { tag: [t.number, t.bool], color: "#fdba74" },
  { tag: t.null, color: "#94a3b8", fontWeight: "500" },
  { tag: t.comment, color: "#79716b", fontStyle: "italic" },
  { tag: [t.operator, t.punctuation, t.separator], color: "#a6a09b" },
  { tag: [t.typeName, t.standard(t.typeName)], color: "#a6a09b" },
  { tag: t.variableName, color: "#fafaf9" },
  {
    tag: [t.special(t.variableName), t.name, t.standard(t.name)],
    color: "#5eead4",
  },
]);

const editorChrome = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "12px",
    fontFamily: "var(--font-mono), ui-monospace, monospace",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono), ui-monospace, monospace",
    lineHeight: "1.625",
    overflow: "auto",
  },
  ".cm-content": {
    padding: "0.75rem 0",
    caretColor: "var(--foreground)",
    color: "var(--foreground)",
  },
  ".cm-line": {
    padding: "0 0.75rem",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-gutters": {
    backgroundColor: "var(--background)",
    color: "color-mix(in oklab, var(--muted-foreground) 55%, transparent)",
    border: "none",
    borderInlineEnd: "1px solid var(--border)",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    paddingInlineStart: "0.5rem",
    paddingInlineEnd: "0.5rem",
    minWidth: "2rem",
    color: "color-mix(in oklab, var(--muted-foreground) 55%, transparent)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
  },
  ".cm-activeLine": {
    backgroundColor: "transparent",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "color-mix(in oklch, var(--ring) 28%, transparent) !important",
  },
  ".cm-cursor": {
    borderLeftColor: "var(--foreground)",
  },
  ".cm-placeholder": {
    color: "var(--muted-foreground)",
    fontStyle: "normal",
  },
});

export function SqlCodeEditor({
  id,
  value,
  onChange,
  onRun,
  placeholder,
  disabled = false,
  className,
  editorRef,
}: Props) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const extensions = useMemo(() => {
    const runKeymap = Prec.high(
      keymap.of([
        {
          key: "Mod-Enter",
          run: () => {
            if (!onRun) return false;
            onRun();
            return true;
          },
        },
      ]),
    );

    return [
      sql({ dialect: PostgreSQL }),
      syntaxHighlighting(isDark ? sqlHighlightDark : sqlHighlightLight, {
        fallback: true,
      }),
      editorChrome,
      EditorView.lineWrapping,
      runKeymap,
      ...(placeholder ? [cmPlaceholder(placeholder)] : []),
      EditorView.editable.of(!disabled),
      EditorView.contentAttributes.of({
        id: id ?? "sql-query-editor",
        "aria-label": "SQL editor",
      }),
    ];
  }, [disabled, id, isDark, onRun, placeholder]);

  return (
    <div
      className={cn(
        "border-input bg-background relative min-h-0 w-full min-w-0 flex-1 overflow-hidden rounded-lg border",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      <CodeMirror
        ref={editorRef}
        value={value}
        height="100%"
        className="absolute inset-0 min-h-0 [&_.cm-editor]:h-full [&_.cm-editor]:bg-transparent"
        theme="none"
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          highlightSelectionMatches: false,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: true,
          rectangularSelection: false,
          crosshairCursor: false,
          searchKeymap: false,
        }}
        extensions={extensions}
        onChange={onChange}
        editable={!disabled}
        indentWithTab={false}
      />
    </div>
  );
}
