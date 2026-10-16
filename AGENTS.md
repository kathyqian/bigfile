<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Design system

Follow this for UI work. Tokens live in `src/app/globals.css`. Use shadcn components in `src/components/ui` and Tailwind utilities that reference those tokens. Do not add one-off colors, font sizes under 12px, or raw `<button>` elements.

## Fonts

- **Geist** (`font-sans`) — UI, titles, buttons, empty states.
- **Geist Mono** (`font-mono`) — file names, column types, cell values, SQL, chart ticks. Use `tabular-nums` for counts.
- **Wordmark** — “Bigfile” only: `text-xs font-medium uppercase tracking-[0.14em]`. No third font family.

Weights are 400 for reading text and 500 (`font-medium`) for labels and buttons. Do not use `font-semibold` or `font-bold`.

| Role | Classes |
| --- | --- |
| Title | `text-2xl font-normal tracking-tight leading-tight text-foreground` |
| Chrome title | `text-base font-medium` |
| Body | `text-sm` or `text-[15px]`, `font-normal`, `leading-relaxed`. Secondary copy: `text-foreground/80` |
| Control | `text-sm font-medium` (shadcn `Button`) |
| Meta | `text-xs` (12px). Smallest readable size |
| Data | `text-xs font-mono tabular-nums` |

Chart tick labels may be `text-[11px] font-mono` in `text-muted-foreground` / `fill-muted-foreground`. Nothing else goes below 12px.

## Color

Light is the default (`:root`). Dark is the `.dark` class on `<html>`, set only by the theme toggle (`next-themes`, `defaultTheme="light"`, `enableSystem={false}`). Do not put `dark` on the server markup.

Stone palette:

- Light: background `#fff`, foreground `#0c0a09`, primary `#1c1917` / `#fafaf9`, secondary and muted `#f5f5f4`, border `#e7e5e4`, ring `#a6a09b`, destructive `#e40014`.
- Dark: background `#000`, foreground `#fafaf9`, card and popover `#0c0a09`, primary `#fafaf9` / `#1c1917`, secondary, muted, and accent `#292524`, border `#292524`, ring `#79716b`, destructive `#fb2c36`.

Muted text is darker than a typical stone-500 so 12px copy stays readable: `#57534e` in light, `#a6a09b` in dark. Emphasis numbers use `text-foreground`. Grid and chart marks stay on the neutral tokens. Do not introduce a saturated chart palette.

## Radius, spacing, buttons

- `--radius: 0.2rem`. Controls follow it. The top bar, footer, and grid stay square.
- Borders are 1px `border-border`. Chrome dividers may use `border-foreground/10`.
- Spacing steps are 4px only: `gap-1` (icon and label), `gap-2` / `p-2` (inside a control cluster), `gap-3` / `py-3` (between groups; chrome bars are about 48px tall), `px-4` (top bar, footer, dialogs, query header, empty canvas). Menus stay `p-1`. Popovers stay `p-3`.

Button hierarchy, all shadcn `Button`:

- **Primary** (`default`) — the one forward action on a surface (Choose CSV, Run, Apply).
- **Outline** — secondary actions (Query Data, Dismiss, Clear).
- **Ghost** `size="icon-sm"` — theme toggle, sort, filter, icon-only controls.
- **Link** — inline text actions such as the footer filter and sort details.
