# UniM3U Interface Design System

Extracted from `renderer/style.css`. UniM3U is a **dark desktop interface** (tool, not
marketing): sidebar + channel list + video player. Depth is flat/borders-only — the
moving video is the only thing meant to draw the eye.

## Direction

Dark, dense, utilitarian. UI recedes around video. One accent color. No shadows.
Restraint over decoration. (See `docs/DESIGN.md` for the Tesla *principles* reference —
single-accent, motion consistency, weight discipline — but NOT its light/photography look.)

## Color tokens

Defined in `:root` (`style.css`). Keep using the CSS variables, not raw hex.

```
Surfaces (dark elevation, lowest → highest):
  --bg     #111      app background, player area sits on #000
  --bg2    #1a1a1a   sidebar, cards, modals, EPG bar
  --bg3    #222      inputs, hover states, pills, raised rows

Border:
  --border #333      all 1px separators and container edges

Text (primary → tertiary):
  --text   #eee      headings, active labels
  --text2  #aaa      body, secondary labels
  --text3  #666      tertiary, icons at rest, placeholders, counts

Accent:
  --accent  #e50914  the ONE chromatic color — active states, primary CTA, focus
  --accent2 #ff6b6b  light-red, hover emphasis only (e.g. back-header)
```

### Tokens to ADD (currently hardcoded strays — fix on next CSS pass)
```
--border-hover  #555      repeated ×3 as a raw value on hover
--favorite      #f0c040   gold star (semantic, off-palette by intent)
```
### Color fixes
- Toast uses `#c0392b` — a *different* red than `--accent`. Switch toast to `--accent`.
- Button text `#fff` is fine (on accent fill).

## Depth — borders-only (locked)

No `box-shadow` anywhere. Separation comes from:
1. Surface steps (`--bg` / `--bg2` / `--bg3`)
2. `1px solid var(--border)` edges; rgba(255,255,255,0.03–0.04) for in-list dividers
3. `z-index` + opacity for overlays (modal `rgba(0,0,0,0.6)`, player overlay gradient)

Do **not** introduce shadows.

## Spacing — base 4px

```
Scale: 4 · 8 · 12 · 16 · 20 · 24 · 32
```
Snap to the grid. Existing off-grid values to migrate when touched: `5, 6, 10, 11`
(10px gaps and 11px row padding are the common offenders). `28px` sidebar top is a
macOS traffic-light allowance — leave it. `40px` settings-card pad → 32.

## Radius

```
--radius-sm  4px    logos / small thumbnails
--radius     6px    inputs, buttons, small controls   (existing token)
--radius-lg  12px   cards, modals
--radius-pill 999px tabs, count pills, toast
```
Currently `count-pill` uses 10px and tabs use 20px — both should be `pill`.
Logos already use 4 (→ sm). Decide once: tabs stay pill (recommended for a filter row).

## Motion

```
--t-fast  0.15s    color/background/border state changes (default)
--t-slow  0.3s     overlay fade, toast
```
Collapse the stray `0.1s` / `0.12s` into `--t-fast`. Spinner stays `0.8s linear`.

## Typography

System stack: `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`.

```
Scale:    11 · 12 · 13 · 14 · 15 · 18 · 22   (14 = base body/button; + 64 empty-state icon only)
Weights:  500 (labels) · 600 (headings/UI emphasis) · 700 (titles)
```
Migrate stray 10px/16px toward the scale (10→11, 16 heading→15/18). 14px is the
documented base size — keep it.
Uppercase + letter-spacing is used on category/settings labels — keep sparingly; it's the
one place type is "styled."

## Components

```
Text button     padding 12×24 · --radius · weight 600 · 14px
  primary       bg --accent, text #fff
  secondary     bg --bg3, 1px --border, text --text2 → --text on hover
Small button    padding 5×10 (→ 4×8) · --radius · 12px · 1px --border
Icon button     transparent · no border · --text3 → --text on hover · ~4px pad
Tab (filter)    pill · 4×12 · 12px · 1px --border · active = --accent fill
Count pill      pill · 2×8 · 10px · --bg3 (transparent when .small)
Card / modal    --bg2 · 1px --border · --radius-lg · pad 20 · gap 12–20
List row        pad 8–12 × 12 · 1px rgba bottom divider · --bg3 hover
  active        bg accent-tint rgba(229,9,20,0.15) · 3px --accent left border
Input           --bg3 · 1px --border · --radius · 13px · focus border --accent
Spinner         44px · 3px ring · --accent top · spin 0.8s
```

## Do / Don't

Do: use CSS variables; borders for separation; one accent; snap to 4px grid; two
motion speeds; weights 500/600/700 only.

Don't: add box-shadows; introduce a second chromatic color; hardcode hex when a token
exists; use a third red (toast); invent new radius/spacing values off the scales.
