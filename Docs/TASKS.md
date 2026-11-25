# Tasks — UI Styling, Design Tokens & Dropdown Audit

> **Audit date:** 2026-11-25 | **Refs:** `Docs/DESIGN.md`, `assets/colors.jpeg`, `app/globals.css`

| # | Severity | Area | Finding & Fix |
|---|---:|---|---|
| 1 | 8/10 | `features/workspace/Panels/*.tsx` (8 files) | Replace hardcoded hexes (`#12131d`, `#0f1019`, `#141524`, `#1c1d2c`, `#161726`, `#F9CF00`, `#ffdb29`) with `hsl(var(--surface-0..2))` and `hsl(var(--primary))` tokens |
| 2 | 8/10 | `GeneratePanel.tsx:1047-1056`, `TexturePanel.tsx:1115-1118` | Model dropdowns squeeze/truncate `m.label` inline; stack vertically & remove `truncate` on model names |
| 3 | 7/10 | `TopHeader.tsx:123`, `RightAssetsPanel.tsx:276,453` | Narrow fixed widths (`w-44`/`w-48`) clip dropdown labels; widen to `min-w-[200px] w-max` / `w-52` |
| 4 | 6/10 | `features/workspace/Panels/*.tsx` | Low-contrast `text-zinc-500` labels upgraded to `text-zinc-400` for WCAG 4.5:1 readability |
